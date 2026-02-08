/**
 * Agent 指标采集器
 * 采集 Agent 运行指标：运行次数、错误数、Token 消耗
 */

import type { MetricCollector, MetricDefinition, MetricSample, GatewayRuntime } from "../types.js";

const PREFIX = "openclaw_agent";

/**
 * Agent 采集器
 * 通过 runtime.gatewayCall 获取 Agent 统计数据
 */
export class AgentCollector implements MetricCollector {
  name = "agent";

  definitions: MetricDefinition[] = [
    { name: `${PREFIX}_count`, help: "Total number of agents", type: "gauge" },
    { name: `${PREFIX}_runs_total`, help: "Total agent runs", type: "counter" },
    { name: `${PREFIX}_errors_total`, help: "Total agent errors", type: "counter" },
    { name: `${PREFIX}_tokens_input_total`, help: "Total input tokens consumed", type: "counter" },
    { name: `${PREFIX}_tokens_output_total`, help: "Total output tokens consumed", type: "counter" },
  ];

  constructor(private runtime: GatewayRuntime) {}

  /**
   * 采集 Agent 指标
   */
  async collect(): Promise<MetricSample[]> {
    const runtimeAny = this.runtime as Record<string, unknown>;

    try {
      let agentData: Record<string, unknown> = {};
      if (typeof runtimeAny.gatewayCall === "function") {
        const fn = runtimeAny.gatewayCall as (m: string) => Promise<unknown>;
        agentData = (await fn("agents.stats")) as Record<string, unknown> ?? {};
      }

      return [
        { name: `${PREFIX}_count`, value: (agentData.count as number) ?? 0 },
        { name: `${PREFIX}_runs_total`, value: (agentData.totalRuns as number) ?? 0 },
        { name: `${PREFIX}_errors_total`, value: (agentData.totalErrors as number) ?? 0 },
        { name: `${PREFIX}_tokens_input_total`, value: (agentData.totalInputTokens as number) ?? 0 },
        { name: `${PREFIX}_tokens_output_total`, value: (agentData.totalOutputTokens as number) ?? 0 },
      ];
    } catch {
      return this.definitions.map((d) => ({ name: d.name, value: 0 }));
    }
  }
}
