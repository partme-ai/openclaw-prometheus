/**
 * openclaw-prometheus 插件入口
 *
 * 仅依赖官方插件机制：manifest、entrypoint、runtime、hooks、events、plugin-owned routes。
 */

import type { CollectorDiagnostic, MetricCollector, MetricDefinition, MetricSample } from "./types.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import { PluginRuntimeCollector } from "./collectors/plugin-runtime.js";
import { RuntimeCollector } from "./collectors/runtime.js";
import { formatPrometheus } from "./formatters/prometheus.js";
import { formatJson } from "./formatters/json.js";
import { resolvePrometheusConfig } from "./plugin-config.js";
import { assertScrapeAuthorized } from "./scrape-auth.js";
import { CollectCache } from "./collect-cache.js";
import { PLUGIN_VERSION } from "./version.js";
import { initializeRuntimeStore, getRuntimeStore } from "./runtime-store.js";
import { refreshHousekeepingMetrics, registerPluginObservers } from "./observer.js";

const PLUGIN_ID = "openclaw-prometheus";

/** 内部采集状态（每个 register 调用一组） */
let collectors: MetricCollector[] = [];
let cache: CollectCache = new CollectCache(0);
const collectorErrorCounts = new Map<string, number>();

/**
 * 组装采集器列表
 *
 * @param includeRuntime - 是否包含 Node 进程级指标
 */
function buildCollectors(includeRuntime: boolean): MetricCollector[] {
  const list: MetricCollector[] = [new PluginRuntimeCollector()];
  if (includeRuntime) {
    list.push(new RuntimeCollector());
  }
  return list;
}

/**
 * 并行采集所有指标
 */
const COLLECTOR_SUCCESS_DEF: MetricDefinition = {
  name: "openclaw_metrics_collector_success",
  help: "Whether a collector succeeded during the last scrape (1=yes, 0=no)",
  type: "gauge",
  labels: ["collector"],
};

const COLLECTOR_ERRORS_TOTAL_DEF: MetricDefinition = {
  name: "openclaw_metrics_collect_errors_total",
  help: "Cumulative collector failures observed by the exporter",
  type: "counter",
  labels: ["collector"],
};

async function collectAll(): Promise<{
  definitions: MetricDefinition[];
  samples: MetricSample[];
  diagnostics: CollectorDiagnostic[];
}> {
  const allDefinitions: MetricDefinition[] = [];
  const allSamples: MetricSample[] = [];
  const diagnostics: CollectorDiagnostic[] = [];

  const results = await Promise.allSettled(collectors.map((c) => c.collect()));
  allDefinitions.push(COLLECTOR_SUCCESS_DEF, COLLECTOR_ERRORS_TOTAL_DEF);

  for (let i = 0; i < collectors.length; i++) {
    allDefinitions.push(...collectors[i].definitions);
    const result = results[i];
    const collector = collectors[i].name;
    if (result.status === "fulfilled") {
      allSamples.push(...result.value);
      allSamples.push({
        name: COLLECTOR_SUCCESS_DEF.name,
        labels: { collector },
        value: 1,
      });
      allSamples.push({
        name: COLLECTOR_ERRORS_TOTAL_DEF.name,
        labels: { collector },
        value: collectorErrorCounts.get(collector) ?? 0,
      });
      diagnostics.push({ collector, ok: true });
      continue;
    }
    const nextCount = (collectorErrorCounts.get(collector) ?? 0) + 1;
    collectorErrorCounts.set(collector, nextCount);
    allSamples.push({
      name: COLLECTOR_SUCCESS_DEF.name,
      labels: { collector },
      value: 0,
    });
    allSamples.push({
      name: COLLECTOR_ERRORS_TOTAL_DEF.name,
      labels: { collector },
      value: nextCount,
    });
    diagnostics.push({
      collector,
      ok: false,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  }

  return { definitions: allDefinitions, samples: allSamples, diagnostics };
}

const BUILD_INFO_DEF: MetricDefinition = {
  name: "openclaw_exporter_build_info",
  help: "OpenClaw Prometheus plugin build information",
  type: "gauge",
};

const SCRAPE_DURATION_DEF: MetricDefinition = {
  name: "openclaw_metrics_last_scrape_duration_seconds",
  help: "Wall time spent on last metrics collection (includes RPC), in seconds",
  type: "gauge",
};

/**
 * 在采集结果上追加 build info 与本次 scrape 耗时样本
 */
function appendMetaSamples(
  definitions: MetricDefinition[],
  samples: MetricSample[],
  scrapeSeconds: number,
): void {
  definitions.push(BUILD_INFO_DEF, SCRAPE_DURATION_DEF);
  samples.push({
    name: "openclaw_exporter_build_info",
    value: 1,
    labels: { plugin: PLUGIN_ID, version: PLUGIN_VERSION },
  });
  samples.push({
    name: "openclaw_metrics_last_scrape_duration_seconds",
    value: scrapeSeconds,
  });
}

/**
 * 规范化 metrics 根路径，生成子路径
 *
 * @param base - 例如 /metrics
 * @param suffix - 例如 /per-object
 */
function metricsChildPath(base: string, suffix: string): string {
  const b = base.replace(/\/$/, "") || "/metrics";
  return `${b}${suffix}`;
}

/**
 * 注册 HTTP 路由与采集逻辑
 */
function registerMetricsRoutes(api: OpenClawPluginApi): void {
  const cfg = resolvePrometheusConfig(api.pluginConfig as Record<string, unknown> | undefined);
  initializeRuntimeStore(api, cfg);
  refreshHousekeepingMetrics();
  registerPluginObservers(api);

  collectors = buildCollectors(cfg.includeRuntime);
  cache = new CollectCache(cfg.collectIntervalMs);
  cache.invalidate();

  const base = cfg.metricsPath;

  /**
   * 带鉴权与缓存的采集
   */
  async function runCollect(req: IncomingMessage, res: ServerResponse): Promise<{
    definitions: MetricDefinition[];
    samples: MetricSample[];
    diagnostics: CollectorDiagnostic[];
  } | null> {
    if (!assertScrapeAuthorized(req, res, cfg)) {
      return null;
    }

    const t0 = performance.now();
    const bundle = await cache.getOrCollect(() => collectAll());
    const scrapeSeconds = (performance.now() - t0) / 1000;

    const definitions = [...bundle.definitions];
    const samples = [...bundle.samples];
    appendMetaSamples(definitions, samples, scrapeSeconds);
    return { definitions, samples, diagnostics: bundle.diagnostics };
  }

  async function metricsHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await withRouteMetrics(base, req, res, async () => {
      const data = await runCollect(req, res);
      if (!data) {
        return;
      }
      const output = formatPrometheus(data.definitions, data.samples);
      res.writeHead(200, {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      });
      res.end(output);
    });
  }

  async function perObjectHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await withRouteMetrics(metricsChildPath(base, "/per-object"), req, res, async () => {
      const data = await runCollect(req, res);
      if (!data) {
        return;
      }
      const output = formatJson(data.definitions, data.samples, data.diagnostics);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(output, null, 2));
    });
  }

  async function detailedHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await withRouteMetrics(metricsChildPath(base, "/detailed"), req, res, async () => {
      if (!assertScrapeAuthorized(req, res, cfg)) {
        return;
      }

      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const familyFilter = url.searchParams.get("family");

      const t0 = performance.now();
      const bundle = await cache.getOrCollect(() => collectAll());
      const scrapeSeconds = (performance.now() - t0) / 1000;

      let filteredDefs = [...bundle.definitions];
      let filteredSamples = [...bundle.samples];

      if (familyFilter) {
        filteredDefs = filteredDefs.filter((d) => d.name.includes(familyFilter));
        filteredSamples = filteredSamples.filter((s) => s.name.includes(familyFilter));
      }

      appendMetaSamples(filteredDefs, filteredSamples, scrapeSeconds);

      const output = formatJson(filteredDefs, filteredSamples, bundle.diagnostics);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(output, null, 2));
    });
  }

  async function healthHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await withRouteMetrics(metricsChildPath(base, "/health"), req, res, async () => {
      if (!assertScrapeAuthorized(req, res, cfg)) {
        return;
      }
      const store = getRuntimeStore();
      const payload = {
        ok: true,
        plugin: PLUGIN_ID,
        version: PLUGIN_VERSION,
        startedAt: new Date(store.startedAt).toISOString(),
        lastSnapshotRefreshAt: store.lastSnapshotRefreshAt
          ? new Date(store.lastSnapshotRefreshAt).toISOString()
          : null,
        monitoredProviders: store.cfg.monitoredProviders,
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload, null, 2));
    });
  }

  // OpenClaw 要求显式声明 auth；未声明时路由会被静默丢弃。指标端点由插件内 scrapeAuth 可选保护，故使用 plugin。
  const routeOpts = { auth: "plugin" as const };
  api.registerHttpRoute({ ...routeOpts, path: base, handler: metricsHandler });
  api.registerHttpRoute({ ...routeOpts, path: metricsChildPath(base, "/per-object"), handler: perObjectHandler });
  api.registerHttpRoute({ ...routeOpts, path: metricsChildPath(base, "/detailed"), handler: detailedHandler });
  api.registerHttpRoute({ ...routeOpts, path: metricsChildPath(base, "/health"), handler: healthHandler });

  if (typeof api.registerGatewayMethod === "function") {
    api.registerGatewayMethod(
      "openclaw.prometheus.status",
      async (_req, res) => {
        const store = getRuntimeStore();
        store.registry.inc("openclaw_gateway_operator_rpc_requests_total", 1, {
          help: "Gateway operator RPC invocations handled by openclaw-prometheus",
          type: "counter",
          labels: { method: "openclaw.prometheus.status" },
        });
        res.respond(true, {
          ok: true,
          plugin: PLUGIN_ID,
          version: PLUGIN_VERSION,
          lastSnapshotRefreshAt: store.lastSnapshotRefreshAt ?? null,
          monitoredProviders: store.providerSnapshots,
        });
      },
      { scope: "operator.read" },
    );
  }

  const names = collectors.map((c) => c.name).join(", ");
  console.log(`[openclaw-prometheus] Plugin registered — ${collectors.length} collectors: ${names}`);
  console.log(
    `[openclaw-prometheus] metrics path: ${base} (cache ${cfg.collectIntervalMs}ms, snapshot ${cfg.snapshotIntervalMs}ms, runtime ${cfg.includeRuntime ? "on" : "off"}, scrapeAuth ${cfg.scrapeAuthEnabled ? "on" : "off"})`,
  );
  console.log(`  GET ${base}             — Prometheus text`);
  console.log(`  GET ${metricsChildPath(base, "/per-object")}  — JSON`);
  console.log(`  GET ${metricsChildPath(base, "/detailed")}    — JSON (?family=)`);
  console.log(`  GET ${metricsChildPath(base, "/health")}      — plugin health`);
}

async function withRouteMetrics(
  routePath: string,
  req: IncomingMessage,
  res: ServerResponse,
  fn: () => Promise<void>,
): Promise<void> {
  const startedAt = performance.now();
  try {
    await fn();
  } finally {
    const statusCode =
      typeof (res as ServerResponse & { statusCode?: number }).statusCode === "number"
        ? String((res as ServerResponse & { statusCode?: number }).statusCode)
        : "200";
    const { registry } = getRuntimeStore();
    const labels = {
      route: routePath,
      method: req.method ?? "GET",
      status: statusCode,
    };
    registry.inc("openclaw_metrics_http_requests_total", 1, {
      help: "HTTP requests served by the Prometheus plugin routes",
      type: "counter",
      labels,
    });
    registry.observeSummary("openclaw_metrics_http_request_duration_seconds", (performance.now() - startedAt) / 1000, {
      help: "HTTP request duration served by the Prometheus plugin routes",
      labels: {
        route: routePath,
        method: req.method ?? "GET",
      },
    });
  }
}

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "openclaw-prometheus",
  description:
    "Prometheus metrics exporter for OpenClaw Gateway — built on official plugin runtime, hooks, events, and plugin-owned routes",
  register(api: OpenClawPluginApi) {
    registerMetricsRoutes(api);
  },
});
