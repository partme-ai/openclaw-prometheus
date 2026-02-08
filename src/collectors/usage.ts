/**
 * Usage / Cost 指标采集器
 *
 * 数据来源：
 * - Gateway `usage.status` RPC — 使用量统计
 * - Gateway `usage.cost` RPC — 成本跟踪
 *
 * 这两个 RPC 方法是 OpenClaw 内置的使用量追踪端点。
 * 响应结构可能因 Gateway 版本而异，采用宽松解析策略。
 */

import type { MetricCollector, MetricDefinition, MetricSample } from "../types.js";
import { rpcCall } from "../ws-bridge.js";

const PREFIX = "openclaw_usage";

/**
 * Usage 采集器
 * 调用 usage.status 和 usage.cost RPC
 */
export class UsageCollector implements MetricCollector {
  name = "usage";

  definitions: MetricDefinition[] = [
    // 使用量
    { name: `${PREFIX}_requests_total`, help: "Total LLM API requests (from usage tracking)", type: "gauge" },
    { name: `${PREFIX}_tokens_input_total`, help: "Total input tokens (from usage tracking)", type: "gauge" },
    { name: `${PREFIX}_tokens_output_total`, help: "Total output tokens (from usage tracking)", type: "gauge" },
    { name: `${PREFIX}_tokens_total`, help: "Total tokens (from usage tracking)", type: "gauge" },

    // 成本
    { name: `${PREFIX}_cost_usd_total`, help: "Total estimated cost in USD", type: "gauge" },
  ];

  /**
   * 采集 Usage 指标
   * 并行调用 usage.status 和 usage.cost
   */
  async collect(): Promise<MetricSample[]> {
    const samples: MetricSample[] = [];

    try {
      const [usageResult, costResult] = await Promise.all([
        rpcCall<Record<string, unknown>>("usage.status").catch(() => ({})),
        rpcCall<Record<string, unknown>>("usage.cost").catch(() => ({})),
      ]);

      // usage.status 解析 — 宽松取值
      const usage = usageResult ?? {};
      samples.push({
        name: `${PREFIX}_requests_total`,
        value: extractNumber(usage, "requests", "totalRequests", "count"),
      });
      samples.push({
        name: `${PREFIX}_tokens_input_total`,
        value: extractNumber(usage, "inputTokens", "tokensInput", "promptTokens"),
      });
      samples.push({
        name: `${PREFIX}_tokens_output_total`,
        value: extractNumber(usage, "outputTokens", "tokensOutput", "completionTokens"),
      });
      samples.push({
        name: `${PREFIX}_tokens_total`,
        value: extractNumber(usage, "totalTokens", "tokens", "tokensTotal"),
      });

      // usage.cost 解析
      const cost = costResult ?? {};
      samples.push({
        name: `${PREFIX}_cost_usd_total`,
        value: extractNumber(cost, "totalCostUsd", "costUsd", "total", "cost"),
      });
    } catch {
      // usage API 可能未启用
    }

    return samples;
  }
}

/**
 * 从对象中按候选键名提取第一个有效数字
 *
 * @param obj - 数据对象
 * @param keys - 候选键名（按优先级）
 * @returns 找到的数字或 0
 */
function extractNumber(obj: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "number" && !isNaN(val)) return val;
  }
  return 0;
}
