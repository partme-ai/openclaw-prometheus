/**
 * openclaw_prometheus 插件入口
 *
 * 独立的 Prometheus 指标导出插件，参考 rabbitmq_prometheus 设计。
 * 采集 Gateway、Agent、Channel、Runtime 等多维度指标，
 * 以 Prometheus text format 和 JSON 格式暴露。
 *
 * 端点：
 * - GET /metrics             - Prometheus text format（供 Prometheus scrape）
 * - GET /metrics/per-object  - 按 Agent/Channel 分组的 JSON 指标
 * - GET /metrics/detailed    - 过滤查询：?family=xxx&agent=xxx
 *
 * 采集器架构：
 * - GatewayCollector  - 连接数、会话数、消息率
 * - AgentCollector    - Agent 运行次数、错误数、Token 消耗
 * - ChannelCollector  - 渠道连接状态、消息量
 * - RuntimeCollector  - Node.js 堆内存、事件循环延迟、句柄数
 * - MemoryCollector   - 知识库索引状态
 */

import type { PluginApi, MetricCollector, MetricDefinition, MetricSample } from "./types.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { GatewayCollector } from "./collectors/gateway.js";
import { AgentCollector } from "./collectors/agent.js";
import { ChannelCollector } from "./collectors/channel.js";
import { RuntimeCollector } from "./collectors/runtime.js";
import { MemoryCollector } from "./collectors/memory.js";
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
 * GET /metrics - Prometheus text format
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
 * GET /metrics/per-object - 按对象分组的 JSON 指标
 */
async function perObjectHandler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { definitions, samples } = await collectAll();
  const output = formatJson(definitions, samples);

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(output, null, 2));
}

/**
 * GET /metrics/detailed - 过滤指标
 * 支持 query 参数：family（指标名前缀）、agent（Agent ID）
 */
async function detailedHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const familyFilter = url.searchParams.get("family");
  const agentFilter = url.searchParams.get("agent");

  const { definitions, samples } = await collectAll();

  // 应用过滤条件
  let filteredDefs = definitions;
  let filteredSamples = samples;

  if (familyFilter) {
    filteredDefs = definitions.filter((d) => d.name.includes(familyFilter));
    filteredSamples = samples.filter((s) => s.name.includes(familyFilter));
  }

  if (agentFilter) {
    filteredSamples = filteredSamples.filter(
      (s) => s.labels?.agent_id === agentFilter || !s.labels?.agent_id
    );
  }

  const output = formatJson(filteredDefs, filteredSamples);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(output, null, 2));
}

/**
 * 插件注册入口
 * 由 OpenClaw Gateway 在加载插件时调用
 *
 * @param api - Gateway 注入的插件 API
 */
export default function register(api: PluginApi): void {
  // 初始化采集器
  collectors = [
    new GatewayCollector(api.runtime),
    new AgentCollector(api.runtime),
    new ChannelCollector(api.runtime),
    new RuntimeCollector(),
    new MemoryCollector(api.runtime),
  ];

  // 注册 HTTP 端点
  api.registerHttpRoute({ path: "/metrics", handler: metricsHandler });
  api.registerHttpRoute({ path: "/metrics/per-object", handler: perObjectHandler });
  api.registerHttpRoute({ path: "/metrics/detailed", handler: detailedHandler });

  console.log("[openclaw_prometheus] Plugin registered - Prometheus metrics endpoints ready");
  console.log("[openclaw_prometheus] Endpoints:");
  console.log("  GET /metrics             - Prometheus text format");
  console.log("  GET /metrics/per-object  - JSON per-object metrics");
  console.log("  GET /metrics/detailed    - Filtered metrics (?family=&agent=)");
}
