/**
 * openclaw_prometheus 插件入口
 *
 * 独立的 Prometheus 指标导出插件。
 * 通过 Gateway RPC 方法（health / channels.status / sessions.list 等）
 * 采集真实运行数据，以 Prometheus text format 和 JSON 格式暴露。
 *
 * 端点：
 * - GET /metrics             — Prometheus text format（供 Prometheus scrape）
 * - GET /metrics/per-object  — 按对象分组的 JSON 指标
 * - GET /metrics/detailed    — 过滤查询：?family=xxx
 *
 * 采集器架构（9 个，全部基于真实 RPC 方法）：
 * - HealthCollector    — `health` RPC → 健康状态/uptime/Agent数/Session数/Channel链接
 * - ChannelCollector   — `channels.status` RPC → 渠道详情/账号数
 * - SessionCollector   — `sessions.list` RPC → 会话数/Token消耗聚合
 * - UsageCollector     — `usage.status` + `usage.cost` RPC → 使用量/成本
 * - PresenceCollector  — `system-presence` RPC → 在线客户端/节点
 * - CronCollector      — `cron.status` + `cron.list` RPC → 定时任务
 * - ModelCollector     — `models.list` RPC → 可用模型
 * - NodeCollector      — `node.list` RPC → IoT 设备节点
 * - SkillCollector     — `skills.status` + `skills.bins` RPC → Skills
 * - RuntimeCollector   — Node.js process.* → 堆内存/事件循环延迟
 */

import type { GatewayRuntime, MetricCollector, MetricDefinition, MetricSample } from "./types.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { setRuntime } from "./ws-bridge.js";

// 采集器导入
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

// 格式化器导入
import { formatPrometheus } from "./formatters/prometheus.js";
import { formatJson } from "./formatters/json.js";

/** 所有采集器实例 */
let collectors: MetricCollector[] = [];

/**
 * 收集所有指标
 * 并行调用所有采集器，汇总定义和样本
 */
async function collectAll(): Promise<{ definitions: MetricDefinition[]; samples: MetricSample[] }> {
  const allDefinitions: MetricDefinition[] = [];
  const allSamples: MetricSample[] = [];

  const results = await Promise.allSettled(
    collectors.map((c) => c.collect())
  );

  for (let i = 0; i < collectors.length; i++) {
    allDefinitions.push(...collectors[i].definitions);
    const result = results[i];
    if (result.status === "fulfilled") {
      allSamples.push(...result.value);
    }
  }

  return { definitions: allDefinitions, samples: allSamples };
}

/**
 * GET /metrics — Prometheus text format
 * 标准 Prometheus 采集端点
 */
async function metricsHandler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { definitions, samples } = await collectAll();
  const output = formatPrometheus(definitions, samples);

  res.writeHead(200, {
    "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
  });
  res.end(output);
}

/**
 * GET /metrics/per-object — 按对象分组的 JSON 指标
 */
async function perObjectHandler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { definitions, samples } = await collectAll();
  const output = formatJson(definitions, samples);

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(output, null, 2));
}

/**
 * GET /metrics/detailed — 过滤指标
 * 支持 query 参数：family（指标名前缀过滤）
 */
async function detailedHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const familyFilter = url.searchParams.get("family");

  const { definitions, samples } = await collectAll();

  let filteredDefs = definitions;
  let filteredSamples = samples;

  if (familyFilter) {
    filteredDefs = definitions.filter((d) => d.name.includes(familyFilter));
    filteredSamples = samples.filter((s) => s.name.includes(familyFilter));
  }

  const output = formatJson(filteredDefs, filteredSamples);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(output, null, 2));
}

/**
 * 插件注册入口（旧版兼容：直接导出 register(api)）
 */
export default function register(api: {
  runtime: unknown;
  registerHttpRoute: (params: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void }) => void;
}): void {
    setRuntime(api.runtime as unknown as GatewayRuntime);

    collectors = [
      new HealthCollector(),
      new ChannelCollector(),
      new SessionCollector(),
      new UsageCollector(),
      new PresenceCollector(),
      new CronCollector(),
      new ModelCollector(),
      new NodeCollector(),
      new SkillCollector(),
      new RuntimeCollector(),
    ];

    api.registerHttpRoute({ path: "/metrics", handler: metricsHandler });
    api.registerHttpRoute({ path: "/metrics/per-object", handler: perObjectHandler });
    api.registerHttpRoute({ path: "/metrics/detailed", handler: detailedHandler });

    const collectorNames = collectors.map((c) => c.name).join(", ");
    console.log(`[openclaw_prometheus] Plugin registered — ${collectors.length} collectors: ${collectorNames}`);
    console.log("[openclaw_prometheus] Endpoints:");
    console.log("  GET /metrics             — Prometheus text format");
    console.log("  GET /metrics/per-object  — JSON per-object metrics");
    console.log("  GET /metrics/detailed    — Filtered metrics (?family=)");
}
