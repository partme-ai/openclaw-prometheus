/**
 * openclaw-prometheus 插件入口
 *
 * 通过 Gateway RPC（health / channels.status / sessions.list 等）采集指标，
 * 以 Prometheus text format 与 JSON 暴露；可选 Bearer 鉴权与采集缓存。
 *
 * @see https://docs.openclaw.ai/plugins/building-plugins
 */

import type { GatewayRuntime, MetricCollector, MetricDefinition, MetricSample } from "./types.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import { CollectorError } from "./collector-error.js";
import { getRpcStatus, setRuntime } from "./ws-bridge.js";
import { HealthCollector } from "./collectors/health.js";
import { StatusCollector } from "./collectors/status.js";
import { LastHeartbeatCollector } from "./collectors/last-heartbeat.js";
import { ChannelCollector } from "./collectors/channels.js";
import { SessionCollector } from "./collectors/sessions.js";
import { UsageCollector } from "./collectors/usage.js";
import { PresenceCollector } from "./collectors/presence.js";
import { CronCollector } from "./collectors/cron.js";
import { ModelCollector } from "./collectors/models.js";
import { ModelAuthCollector } from "./collectors/model-auth.js";
import { NodeCollector } from "./collectors/nodes.js";
import { SkillCollector } from "./collectors/skills.js";
import { RuntimeCollector } from "./collectors/runtime.js";
import { formatPrometheus } from "./formatters/prometheus.js";
import { formatJson } from "./formatters/json.js";
import { resolvePrometheusConfig } from "./plugin-config.js";
import { assertScrapeAuthorized } from "./scrape-auth.js";
import { CollectCache } from "./collect-cache.js";
import { PLUGIN_VERSION } from "./version.js";

const PLUGIN_ID = "openclaw-prometheus";

/** 内部采集状态（每个 register 调用一组） */
let collectors: MetricCollector[] = [];
let cache: CollectCache = new CollectCache(0);
let startedAtIso: string | null = null;
let lastCollectAtMs: number | null = null;
const collectorErrorsTotal = new Map<string, number>();

/**
 * 组装采集器列表
 *
 * @param includeRuntime - 是否包含 Node 进程级指标
 */
function buildCollectors(includeRuntime: boolean): MetricCollector[] {
  const list: MetricCollector[] = [
    new HealthCollector(),
    new StatusCollector(),
    new LastHeartbeatCollector(),
    new ChannelCollector(),
    new SessionCollector(),
    new UsageCollector(),
    new PresenceCollector(),
    new CronCollector(),
    new ModelAuthCollector(),
    new ModelCollector(),
    new NodeCollector(),
    new SkillCollector(),
  ];
  if (includeRuntime) {
    list.push(new RuntimeCollector());
  }
  return list;
}

/**
 * 并行采集所有指标
 */
async function collectAll(): Promise<{ definitions: MetricDefinition[]; samples: MetricSample[]; diagnostics: Array<{ collector: string; ok: boolean; durationMs: number; error?: string }> }> {
  const allDefinitions: MetricDefinition[] = [];
  const allSamples: MetricSample[] = [];

  const results = await Promise.all(
    collectors.map(async (c) => {
      const t0 = performance.now();
      try {
        const samples = await c.collect();
        const durationMs = performance.now() - t0;
        return {
          collector: c.name,
          ok: true as const,
          durationMs,
          samples,
        };
      } catch (err) {
        const durationMs = performance.now() - t0;
        const message = err instanceof Error ? err.message : String(err);
        const samples = err instanceof CollectorError ? err.samples : ([] as MetricSample[]);
        return {
          collector: c.name,
          ok: false as const,
          durationMs,
          error: message,
          samples,
        };
      }
    }),
  );

  for (let i = 0; i < collectors.length; i++) {
    allDefinitions.push(...collectors[i].definitions);
    const result = results[i];
    allSamples.push(...result.samples);
    if (!result.ok) {
      collectorErrorsTotal.set(
        result.collector,
        (collectorErrorsTotal.get(result.collector) ?? 0) + 1,
      );
    }
  }

  const diagnostics = results.map((r) => ({
    collector: r.collector,
    ok: r.ok,
    durationMs: Math.round(r.durationMs),
    ...(r.ok ? {} : { error: r.error }),
  }));

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

const COLLECTOR_SUCCESS_DEF: MetricDefinition = {
  name: "openclaw_metrics_collector_success",
  help: "Whether the last collection for a collector succeeded",
  type: "gauge",
  labels: ["collector"],
};

const COLLECTOR_ERRORS_TOTAL_DEF: MetricDefinition = {
  name: "openclaw_metrics_collect_errors_total",
  help: "Total collection errors per collector since plugin start",
  type: "counter",
  labels: ["collector"],
};

const EXPORTER_LAST_COLLECT_TIMESTAMP_DEF: MetricDefinition = {
  name: "openclaw_exporter_last_collect_timestamp_seconds",
  help: "Unix timestamp (seconds) when metrics were last collected (not served from cache)",
  type: "gauge",
};

const EXPORTER_LAST_COLLECT_AGE_DEF: MetricDefinition = {
  name: "openclaw_exporter_last_collect_age_seconds",
  help: "Seconds since metrics were last collected (not served from cache)",
  type: "gauge",
};

const GATEWAY_RPC_INITIALIZED_DEF: MetricDefinition = {
  name: "openclaw_gateway_rpc_initialized",
  help: "Whether Gateway RPC call strategy is initialized (1=yes, 0=no)",
  type: "gauge",
};

const GATEWAY_RPC_LAST_SUCCESS_AGE_DEF: MetricDefinition = {
  name: "openclaw_gateway_rpc_last_success_age_seconds",
  help: "Seconds since last successful Gateway RPC call",
  type: "gauge",
};

const GATEWAY_RPC_LAST_ERROR_PRESENT_DEF: MetricDefinition = {
  name: "openclaw_gateway_rpc_last_error_present",
  help: "Whether the last Gateway RPC attempt ended with an error (1=yes, 0=no)",
  type: "gauge",
};

const EXPORTER_CACHE_HIT_DEF: MetricDefinition = {
  name: "openclaw_exporter_cache_hit",
  help: "Whether the last scrape was served from cache (1=hit, 0=miss)",
  type: "gauge",
};

const EXPORTER_CACHE_AGE_DEF: MetricDefinition = {
  name: "openclaw_exporter_cache_age_seconds",
  help: "Age (seconds) of the cached bundle that served the last scrape (0 when cache is empty)",
  type: "gauge",
};

const COLLECTOR_LAST_DURATION_DEF: MetricDefinition = {
  name: "openclaw_metrics_collector_last_duration_seconds",
  help: "Duration (seconds) of last collection attempt per collector",
  type: "gauge",
  labels: ["collector"],
};

const COLLECTOR_LAST_ERROR_PRESENT_DEF: MetricDefinition = {
  name: "openclaw_metrics_collector_last_error_present",
  help: "Whether the last collection attempt for a collector ended with error (1=yes, 0=no)",
  type: "gauge",
  labels: ["collector"],
};

/**
 * 在采集结果上追加 build info 与本次 scrape 耗时样本
 */
function appendMetaSamples(
  definitions: MetricDefinition[],
  samples: MetricSample[],
  scrapeSeconds: number,
  cacheHit: number,
  cacheAgeSeconds: number,
  diagnostics: Array<{ collector: string; ok: boolean; durationMs: number; error?: string }>,
): void {
  definitions.push(
    BUILD_INFO_DEF,
    SCRAPE_DURATION_DEF,
    COLLECTOR_SUCCESS_DEF,
    COLLECTOR_ERRORS_TOTAL_DEF,
    EXPORTER_LAST_COLLECT_TIMESTAMP_DEF,
    EXPORTER_LAST_COLLECT_AGE_DEF,
    GATEWAY_RPC_INITIALIZED_DEF,
    GATEWAY_RPC_LAST_SUCCESS_AGE_DEF,
    GATEWAY_RPC_LAST_ERROR_PRESENT_DEF,
    EXPORTER_CACHE_HIT_DEF,
    EXPORTER_CACHE_AGE_DEF,
    COLLECTOR_LAST_DURATION_DEF,
    COLLECTOR_LAST_ERROR_PRESENT_DEF,
  );
  samples.push({
    name: "openclaw_exporter_build_info",
    value: 1,
    labels: { plugin: PLUGIN_ID, version: PLUGIN_VERSION },
  });
  samples.push({
    name: "openclaw_metrics_last_scrape_duration_seconds",
    value: scrapeSeconds,
  });

  const now = Date.now();
  samples.push({
    name: "openclaw_exporter_last_collect_timestamp_seconds",
    value: lastCollectAtMs ? Math.floor(lastCollectAtMs / 1000) : 0,
  });
  samples.push({
    name: "openclaw_exporter_last_collect_age_seconds",
    value: lastCollectAtMs ? (now - lastCollectAtMs) / 1000 : 0,
  });

  const rpc = getRpcStatus();
  samples.push({ name: "openclaw_gateway_rpc_initialized", value: rpc.initialized ? 1 : 0 });
  samples.push({
    name: "openclaw_gateway_rpc_last_success_age_seconds",
    value: rpc.lastSuccessAt ? (now - rpc.lastSuccessAt) / 1000 : 0,
  });
  samples.push({
    name: "openclaw_gateway_rpc_last_error_present",
    value: rpc.lastError ? 1 : 0,
  });

  samples.push({ name: "openclaw_exporter_cache_hit", value: cacheHit });
  samples.push({ name: "openclaw_exporter_cache_age_seconds", value: cacheAgeSeconds });

  for (const diag of diagnostics) {
    samples.push({
      name: "openclaw_metrics_collector_success",
      labels: { collector: diag.collector },
      value: diag.ok ? 1 : 0,
    });
    samples.push({
      name: "openclaw_metrics_collect_errors_total",
      labels: { collector: diag.collector },
      value: collectorErrorsTotal.get(diag.collector) ?? 0,
    });
    samples.push({
      name: "openclaw_metrics_collector_last_duration_seconds",
      labels: { collector: diag.collector },
      value: diag.durationMs / 1000,
    });
    samples.push({
      name: "openclaw_metrics_collector_last_error_present",
      labels: { collector: diag.collector },
      value: diag.ok ? 0 : 1,
    });
  }
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
  if (!startedAtIso) {
    startedAtIso = new Date().toISOString();
  }

  const runtimeBridge: GatewayRuntime = {
    ...(api.runtime as unknown as GatewayRuntime),
    config: api.config as unknown as Record<string, unknown>,
  };
  setRuntime(runtimeBridge);

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
    diagnostics: Array<{ collector: string; ok: boolean; durationMs: number; error?: string }>;
  } | null> {
    if (!assertScrapeAuthorized(req, res, cfg)) {
      return null;
    }

    const t0 = performance.now();
    const beforeAt = cache.getLastCollectedAtMs();
    const bundle = await cache.getOrCollect(() => collectAll());
    const afterAt = cache.getLastCollectedAtMs();
    const scrapeSeconds = (performance.now() - t0) / 1000;
    const nowMs = Date.now();
    const cacheAgeSeconds = afterAt ? (nowMs - afterAt) / 1000 : 0;
    const cacheHit = cfg.collectIntervalMs > 0 && beforeAt !== null && afterAt === beforeAt ? 1 : 0;
    if (afterAt && beforeAt !== afterAt) {
      lastCollectAtMs = afterAt;
    }

    const definitions = [...bundle.definitions];
    const samples = [...bundle.samples];
    appendMetaSamples(definitions, samples, scrapeSeconds, cacheHit, cacheAgeSeconds, bundle.diagnostics);
    return { definitions, samples, diagnostics: bundle.diagnostics };
  }

  async function metricsHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const data = await runCollect(req, res);
    if (!data) {
      return;
    }
    const output = formatPrometheus(data.definitions, data.samples);
    res.writeHead(200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    });
    res.end(output);
  }

  async function perObjectHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const data = await runCollect(req, res);
    if (!data) {
      return;
    }
    const output = formatJson(data.definitions, data.samples);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(output, null, 2));
  }

  async function healthHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!assertScrapeAuthorized(req, res, cfg)) {
      return;
    }
    const rpc = getRpcStatus();
    const output = {
      ok: true,
      healthy: rpc.initialized && rpc.lastError === null,
      plugin: PLUGIN_ID,
      version: PLUGIN_VERSION,
      startedAt: startedAtIso,
      lastCollectAt: lastCollectAtMs ? new Date(lastCollectAtMs).toISOString() : null,
      rpc: {
        initialized: rpc.initialized,
        lastSuccessAt: rpc.lastSuccessAt ? new Date(rpc.lastSuccessAt).toISOString() : null,
        lastMethod: rpc.lastMethod,
        lastError: rpc.lastError,
      },
      collectors: {
        total: collectors.length,
        failed: Array.from(collectorErrorsTotal.values()).filter((v) => v > 0).length,
      },
      cache: {
        collectIntervalMs: cfg.collectIntervalMs,
      },
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(output, null, 2));
  }

  async function detailedHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const familyFilter = url.searchParams.get("family");
    const data = await runCollect(req, res);
    if (!data) {
      return;
    }
    let filteredDefs = [...data.definitions];
    let filteredSamples = [...data.samples];

    if (familyFilter) {
      filteredDefs = filteredDefs.filter((d) => d.name.includes(familyFilter));
      filteredSamples = filteredSamples.filter((s) => s.name.includes(familyFilter));
    }
    const output = formatJson(filteredDefs, filteredSamples);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(output, null, 2));
  }

  api.registerHttpRoute({ path: base, handler: metricsHandler });
  api.registerHttpRoute({ path: metricsChildPath(base, "/health"), handler: healthHandler });
  api.registerHttpRoute({ path: metricsChildPath(base, "/per-object"), handler: perObjectHandler });
  api.registerHttpRoute({ path: metricsChildPath(base, "/detailed"), handler: detailedHandler });

  const names = collectors.map((c) => c.name).join(", ");
  console.log(`[openclaw-prometheus] Plugin registered — ${collectors.length} collectors: ${names}`);
  console.log(`[openclaw-prometheus] metrics path: ${base} (cache ${cfg.collectIntervalMs}ms, runtime ${cfg.includeRuntime ? "on" : "off"}, scrapeAuth ${cfg.scrapeAuthEnabled ? "on" : "off"})`);
  console.log(`  GET ${base}             — Prometheus text`);
  console.log(`  GET ${metricsChildPath(base, "/health")}      — JSON`);
  console.log(`  GET ${metricsChildPath(base, "/per-object")}  — JSON`);
  console.log(`  GET ${metricsChildPath(base, "/detailed")}    — JSON (?family=)`);
}

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "openclaw-prometheus",
  description:
    "Prometheus metrics exporter for OpenClaw Gateway — RPC-backed gauges and optional scrape auth",
  register(api: OpenClawPluginApi) {
    registerMetricsRoutes(api);
  },
});
