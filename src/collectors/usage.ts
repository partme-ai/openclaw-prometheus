/**
 * Usage / Cost 指标采集器
 *
 * 数据来源：
 * - Gateway `usage.cost` RPC — `totals` 为时间窗内全局汇总（无 provider 标签，与 OpenClaw 成本页一致）
 * - Gateway `sessions.usage` RPC — `aggregates.byProvider` 按**模型供应商**拆分的 token / 费用（`provider` 标签）
 *
 * 说明：`usage.status` 返回的是各云厂商 API 配额快照，不是会话 token 累计；按供应商的 token 请使用带 `provider` 标签的 `openclaw_usage_provider_*` 系列。
 *
 * @see research/openclaw/src/gateway/server-methods/usage.ts
 */

import type { MetricCollector, MetricDefinition, MetricSample } from "../types.js";
import { rpcCall } from "../ws-bridge.js";

const PREFIX = "openclaw_usage";

/** 与 Gateway `sessions.usage` 请求对齐：分析最近若干天、最多条会话，用于聚合 byProvider */
const SESSIONS_USAGE_PARAMS: Record<string, unknown> = {
  days: 30,
  limit: 500,
};

type CostTotalsShape = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  totalCost?: number;
};

type SessionsUsageByProvider = {
  aggregates?: {
    byProvider?: Array<{
      provider?: string;
      model?: string;
      count?: number;
      totals?: CostTotalsShape & {
        inputCost?: number;
        outputCost?: number;
        cacheReadCost?: number;
        cacheWriteCost?: number;
        missingCostEntries?: number;
      };
    }>;
  };
};

/**
 * Usage 采集器
 */
export class UsageCollector implements MetricCollector {
  name = "usage";

  definitions: MetricDefinition[] = [
    // usage.cost 时间窗全局汇总（无 provider）
    {
      name: `${PREFIX}_requests_total`,
      help: "Request count when exposed by usage.cost payload (often 0 if not present)",
      type: "gauge",
    },
    {
      name: `${PREFIX}_tokens_input_total`,
      help: "Total input tokens in usage.cost window (totals.input)",
      type: "gauge",
    },
    {
      name: `${PREFIX}_tokens_output_total`,
      help: "Total output tokens in usage.cost window (totals.output)",
      type: "gauge",
    },
    {
      name: `${PREFIX}_tokens_total`,
      help: "Total tokens in usage.cost window (totals.totalTokens)",
      type: "gauge",
    },
    {
      name: `${PREFIX}_cost_usd_total`,
      help: "Total estimated cost USD in usage.cost window (totals.totalCost)",
      type: "gauge",
    },

    // sessions.usage → byProvider（label: provider = 模型供应商，如 openai、anthropic）
    {
      name: `${PREFIX}_provider_tokens_input_total`,
      help: "Input tokens by model provider (sessions.usage aggregates.byProvider)",
      type: "gauge",
      labels: ["provider"],
    },
    {
      name: `${PREFIX}_provider_tokens_output_total`,
      help: "Output tokens by model provider",
      type: "gauge",
      labels: ["provider"],
    },
    {
      name: `${PREFIX}_provider_tokens_cache_read_total`,
      help: "Cache-read tokens by model provider",
      type: "gauge",
      labels: ["provider"],
    },
    {
      name: `${PREFIX}_provider_tokens_cache_write_total`,
      help: "Cache-write tokens by model provider",
      type: "gauge",
      labels: ["provider"],
    },
    {
      name: `${PREFIX}_provider_tokens_total`,
      help: "Total tokens by model provider",
      type: "gauge",
      labels: ["provider"],
    },
    {
      name: `${PREFIX}_provider_cost_usd_total`,
      help: "Estimated cost USD by model provider",
      type: "gauge",
      labels: ["provider"],
    },
    {
      name: `${PREFIX}_provider_usage_entries_total`,
      help: "Usage entries counted toward this provider bucket",
      type: "gauge",
      labels: ["provider"],
    },
  ];

  async collect(): Promise<MetricSample[]> {
    const samples: MetricSample[] = [];

    try {
      const [costResult, sessionsUsageResult] = await Promise.all([
        rpcCall<Record<string, unknown>>("usage.cost").catch(() => ({})),
        rpcCall<SessionsUsageByProvider>("sessions.usage", SESSIONS_USAGE_PARAMS).catch(() => null),
      ]);

      const cost = costResult ?? {};
      const totals = (cost as { totals?: CostTotalsShape }).totals;

      if (totals && typeof totals === "object") {
        const t = totals;
        samples.push({ name: `${PREFIX}_tokens_input_total`, value: num(t.input) });
        samples.push({ name: `${PREFIX}_tokens_output_total`, value: num(t.output) });
        samples.push({
          name: `${PREFIX}_tokens_total`,
          value: num(t.totalTokens) > 0
            ? num(t.totalTokens)
            : num(t.input) + num(t.output) + num(t.cacheRead) + num(t.cacheWrite),
        });
        samples.push({ name: `${PREFIX}_cost_usd_total`, value: num(t.totalCost) });
      } else {
        samples.push({
          name: `${PREFIX}_tokens_input_total`,
          value: extractNumber(cost, "inputTokens", "tokensInput", "promptTokens"),
        });
        samples.push({
          name: `${PREFIX}_tokens_output_total`,
          value: extractNumber(cost, "outputTokens", "tokensOutput", "completionTokens"),
        });
        samples.push({
          name: `${PREFIX}_tokens_total`,
          value: extractNumber(cost, "totalTokens", "tokens", "tokensTotal"),
        });
        samples.push({
          name: `${PREFIX}_cost_usd_total`,
          value: extractNumber(cost, "totalCostUsd", "costUsd", "total", "cost"),
        });
      }

      samples.push({
        name: `${PREFIX}_requests_total`,
        value: extractNumber(cost, "requests", "totalRequests", "count"),
      });

      const byProvider = sessionsUsageResult?.aggregates?.byProvider;
      if (Array.isArray(byProvider)) {
        for (const row of byProvider) {
          const provider = sanitizeProviderLabel(row.provider ?? "unknown");
          const t = row.totals;
          if (!t) {
            continue;
          }
          const input = num(t.input);
          const output = num(t.output);
          const cacheRead = num(t.cacheRead);
          const cacheWrite = num(t.cacheWrite);
          const totalTok =
            num(t.totalTokens) > 0
              ? num(t.totalTokens)
              : input + output + cacheRead + cacheWrite;
          const costUsd = num(t.totalCost);
          const entries = typeof row.count === "number" ? row.count : 0;

          samples.push({
            name: `${PREFIX}_provider_tokens_input_total`,
            labels: { provider },
            value: input,
          });
          samples.push({
            name: `${PREFIX}_provider_tokens_output_total`,
            labels: { provider },
            value: output,
          });
          samples.push({
            name: `${PREFIX}_provider_tokens_cache_read_total`,
            labels: { provider },
            value: cacheRead,
          });
          samples.push({
            name: `${PREFIX}_provider_tokens_cache_write_total`,
            labels: { provider },
            value: cacheWrite,
          });
          samples.push({
            name: `${PREFIX}_provider_tokens_total`,
            labels: { provider },
            value: totalTok,
          });
          samples.push({
            name: `${PREFIX}_provider_cost_usd_total`,
            labels: { provider },
            value: costUsd,
          });
          samples.push({
            name: `${PREFIX}_provider_usage_entries_total`,
            labels: { provider },
            value: entries,
          });
        }
      }
    } catch {
      // RPC 不可用
    }

    return samples;
  }
}

function num(v: unknown): number {
  if (typeof v === "number" && !Number.isNaN(v)) {
    return v;
  }
  return 0;
}

function extractNumber(obj: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "number" && !Number.isNaN(val)) {
      return val;
    }
  }
  return 0;
}

function sanitizeProviderLabel(raw: string): string {
  const s = String(raw).trim() || "unknown";
  return s.replace(/["\\\n]/g, "_").slice(0, 128);
}
