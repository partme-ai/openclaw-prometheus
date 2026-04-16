/**
 * openclaw_prometheus 插件入口
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

import { setRuntime } from "./ws-bridge.js";
import { HealthCollector } from "./collectors/health.js";
import { ChannelCollector } from "./collectors/channels.js";
import { SessionCollector } from "./collectors/sessions.js";
import { UsageCollector } from "./collectors/usage.js";
import { PresenceCollector } from "./collectors/presence.js";
import { CronCollector } from "./collectors/cron.js";
import { ModelCollector } from "./collectors/models.js";
import { NodeCollector } from "./collectors/nodes.js";
import { SkillCollector } from "./collectors/skills.js";
import { RuntimeCollector } from "./collectors/runtime.js";
import { formatPrometheus } from "./formatters/prometheus.js";
import { formatJson } from "./formatters/json.js";
import { resolvePrometheusConfig } from "./plugin-config.js";
import { assertScrapeAuthorized } from "./scrape-auth.js";
import { CollectCache } from "./collect-cache.js";
import { PLUGIN_VERSION } from "./version.js";

const PLUGIN_ID = "openclaw_prometheus";

/** 内部采集状态（每个 register 调用一组） */
let collectors: MetricCollector[] = [];
let cache: CollectCache = new CollectCache(0);

/**
 * 组装采集器列表
 *
 * @param includeRuntime - 是否包含 Node 进程级指标
 */
function buildCollectors(includeRuntime: boolean): MetricCollector[] {
  const list: MetricCollector[] = [
    new HealthCollector(),
    new ChannelCollector(),
    new SessionCollector(),
    new UsageCollector(),
    new PresenceCollector(),
    new CronCollector(),
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
async function collectAll(): Promise<{ definitions: MetricDefinition[]; samples: MetricSample[] }> {
  const allDefinitions: MetricDefinition[] = [];
  const allSamples: MetricSample[] = [];

  const results = await Promise.allSettled(collectors.map((c) => c.collect()));

  for (let i = 0; i < collectors.length; i++) {
    allDefinitions.push(...collectors[i].definitions);
    const result = results[i];
    if (result.status === "fulfilled") {
      allSamples.push(...result.value);
    }
  }

  return { definitions: allDefinitions, samples: allSamples };
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
    return { definitions, samples };
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

  async function detailedHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
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

    const output = formatJson(filteredDefs, filteredSamples);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(output, null, 2));
  }

  api.registerHttpRoute({ path: base, handler: metricsHandler });
  api.registerHttpRoute({ path: metricsChildPath(base, "/per-object"), handler: perObjectHandler });
  api.registerHttpRoute({ path: metricsChildPath(base, "/detailed"), handler: detailedHandler });

  const names = collectors.map((c) => c.name).join(", ");
  console.log(`[openclaw_prometheus] Plugin registered — ${collectors.length} collectors: ${names}`);
  console.log(`[openclaw_prometheus] metrics path: ${base} (cache ${cfg.collectIntervalMs}ms, runtime ${cfg.includeRuntime ? "on" : "off"}, scrapeAuth ${cfg.scrapeAuthEnabled ? "on" : "off"})`);
  console.log(`  GET ${base}             — Prometheus text`);
  console.log(`  GET ${metricsChildPath(base, "/per-object")}  — JSON`);
  console.log(`  GET ${metricsChildPath(base, "/detailed")}    — JSON (?family=)`);
}

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "openclaw_prometheus",
  description:
    "Prometheus metrics exporter for OpenClaw Gateway — RPC-backed gauges and optional scrape auth",
  register(api: OpenClawPluginApi) {
    registerMetricsRoutes(api);
  },
});
