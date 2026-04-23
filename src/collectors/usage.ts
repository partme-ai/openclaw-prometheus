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
import { CollectorError } from "../collector-error.js";

const PREFIX = "openclaw_usage";

const UTC_OFFSET = "UTC+8";
const WINDOW_DAYS = 30;

type CostTotalsShape = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  totalCost?: number;
  inputCost?: number;
  outputCost?: number;
  cacheReadCost?: number;
  cacheWriteCost?: number;
  missingCostEntries?: number;
};

type SessionsUsageResult = {
  totals?: CostTotalsShape;
  aggregates?: {
    messages?: {
      total?: number;
      user?: number;
      assistant?: number;
      toolCalls?: number;
      toolResults?: number;
      errors?: number;
    };
    tools?: {
      totalCalls?: number;
      uniqueTools?: number;
      tools?: Array<{ name?: string; count?: number }>;
    };
    byProvider?: Array<{ provider?: string; count?: number; totals?: CostTotalsShape }>;
    byModel?: Array<{ provider?: string; model?: string; count?: number; totals?: CostTotalsShape }>;
    byAgent?: Array<{ agentId?: string; totals?: CostTotalsShape }>;
    byChannel?: Array<{ channel?: string; totals?: CostTotalsShape }>;
    latency?: { count?: number; avgMs?: number; p95Ms?: number; minMs?: number; maxMs?: number };
    daily?: Array<{ date?: string; tokens?: number; cost?: number; messages?: number; toolCalls?: number; errors?: number }>;
    dailyLatency?: Array<{ date?: string; count?: number; avgMs?: number; p95Ms?: number; minMs?: number; maxMs?: number }>;
    modelDaily?: Array<{ date?: string; provider?: string; model?: string; tokens?: number; cost?: number; count?: number }>;
  };
};

/**
 * Usage 采集器
 */
export class UsageCollector implements MetricCollector {
  name = "usage";

  definitions: MetricDefinition[] = [
    { name: `${PREFIX}_requests_total`, help: "Request count when exposed by usage.cost payload (often 0 if not present)", type: "gauge" },
    { name: `${PREFIX}_tokens_input_total`, help: "Total input tokens in window", type: "gauge" },
    { name: `${PREFIX}_tokens_output_total`, help: "Total output tokens in window", type: "gauge" },
    { name: `${PREFIX}_tokens_cache_read_total`, help: "Total cache-read tokens in window", type: "gauge" },
    { name: `${PREFIX}_tokens_cache_write_total`, help: "Total cache-write tokens in window", type: "gauge" },
    { name: `${PREFIX}_tokens_total`, help: "Total tokens in window", type: "gauge" },
    { name: `${PREFIX}_cost_usd_total`, help: "Total estimated cost USD in window", type: "gauge" },
    { name: `${PREFIX}_missing_cost_entries_total`, help: "Missing cost entries in window", type: "gauge" },

    { name: `${PREFIX}_messages_total`, help: "Total messages in window", type: "gauge" },
    { name: `${PREFIX}_messages_user_total`, help: "User messages in window", type: "gauge" },
    { name: `${PREFIX}_messages_assistant_total`, help: "Assistant messages in window", type: "gauge" },
    { name: `${PREFIX}_messages_tool_calls_total`, help: "Tool calls in window", type: "gauge" },
    { name: `${PREFIX}_messages_tool_results_total`, help: "Tool results in window", type: "gauge" },
    { name: `${PREFIX}_messages_errors_total`, help: "Errors in window", type: "gauge" },

    { name: `${PREFIX}_tools_total_calls`, help: "Total tool calls in window", type: "gauge" },
    { name: `${PREFIX}_tools_unique_total`, help: "Unique tools used in window", type: "gauge" },
    { name: `${PREFIX}_tool_calls_total`, help: "Tool calls by tool", type: "gauge", labels: ["tool"] },

    { name: `${PREFIX}_latency_count`, help: "Latency sample count in window", type: "gauge" },
    { name: `${PREFIX}_latency_avg_seconds`, help: "Average latency seconds in window", type: "gauge" },
    { name: `${PREFIX}_latency_p95_seconds`, help: "P95 latency seconds in window", type: "gauge" },
    { name: `${PREFIX}_latency_min_seconds`, help: "Min latency seconds in window", type: "gauge" },
    { name: `${PREFIX}_latency_max_seconds`, help: "Max latency seconds in window", type: "gauge" },

    { name: `${PREFIX}_provider_requests_total`, help: "Requests by model provider", type: "gauge", labels: ["provider"] },
    { name: `${PREFIX}_provider_tokens_input_total`, help: "Input tokens by model provider", type: "gauge", labels: ["provider"] },
    { name: `${PREFIX}_provider_tokens_output_total`, help: "Output tokens by model provider", type: "gauge", labels: ["provider"] },
    { name: `${PREFIX}_provider_tokens_cache_read_total`, help: "Cache-read tokens by model provider", type: "gauge", labels: ["provider"] },
    { name: `${PREFIX}_provider_tokens_cache_write_total`, help: "Cache-write tokens by model provider", type: "gauge", labels: ["provider"] },
    { name: `${PREFIX}_provider_tokens_total`, help: "Total tokens by model provider", type: "gauge", labels: ["provider"] },
    { name: `${PREFIX}_provider_cost_usd_total`, help: "Estimated cost USD by model provider", type: "gauge", labels: ["provider"] },
    { name: `${PREFIX}_provider_missing_cost_entries_total`, help: "Missing cost entries by model provider", type: "gauge", labels: ["provider"] },

    { name: `${PREFIX}_model_requests_total`, help: "Requests by model", type: "gauge", labels: ["provider", "model"] },
    { name: `${PREFIX}_model_tokens_total`, help: "Tokens by model", type: "gauge", labels: ["provider", "model"] },
    { name: `${PREFIX}_model_cost_usd_total`, help: "Cost USD by model", type: "gauge", labels: ["provider", "model"] },

    { name: `${PREFIX}_agent_tokens_total`, help: "Tokens by agent", type: "gauge", labels: ["agent_id"] },
    { name: `${PREFIX}_agent_cost_usd_total`, help: "Cost USD by agent", type: "gauge", labels: ["agent_id"] },

    { name: `${PREFIX}_channel_tokens_total`, help: "Tokens by channel", type: "gauge", labels: ["channel"] },
    { name: `${PREFIX}_channel_cost_usd_total`, help: "Cost USD by channel", type: "gauge", labels: ["channel"] },

    { name: `${PREFIX}_daily_tokens_total`, help: "Daily token usage", type: "gauge", labels: ["date"] },
    { name: `${PREFIX}_daily_cost_usd_total`, help: "Daily cost USD", type: "gauge", labels: ["date"] },
  ];

  async collect(): Promise<MetricSample[]> {
    const samples: MetricSample[] = [];

    try {
      const { startDate, endDate } = resolveWindowDates(UTC_OFFSET, WINDOW_DAYS);
      const baseParams = {
        startDate,
        endDate,
        mode: "specific",
        utcOffset: UTC_OFFSET,
      };
      const [costResult, sessionsUsageResult] = await Promise.all([
        rpcCall<Record<string, unknown>>("usage.cost", baseParams).catch(() => ({})),
        rpcCall<SessionsUsageResult>("sessions.usage", {
          ...baseParams,
          limit: 1000,
          includeContextWeight: true,
        }).catch(() => null),
      ]);

      const cost = costResult ?? {};
      const totals = (cost as { totals?: CostTotalsShape }).totals;

      if (totals && typeof totals === "object") {
        const t = totals;
        samples.push({ name: `${PREFIX}_tokens_input_total`, value: num(t.input) });
        samples.push({ name: `${PREFIX}_tokens_output_total`, value: num(t.output) });
        samples.push({ name: `${PREFIX}_tokens_cache_read_total`, value: num(t.cacheRead) });
        samples.push({ name: `${PREFIX}_tokens_cache_write_total`, value: num(t.cacheWrite) });
        samples.push({
          name: `${PREFIX}_tokens_total`,
          value: num(t.totalTokens) > 0
            ? num(t.totalTokens)
            : num(t.input) + num(t.output) + num(t.cacheRead) + num(t.cacheWrite),
        });
        samples.push({ name: `${PREFIX}_cost_usd_total`, value: num(t.totalCost) });
        samples.push({ name: `${PREFIX}_missing_cost_entries_total`, value: num(t.missingCostEntries) });
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
          name: `${PREFIX}_tokens_cache_read_total`,
          value: extractNumber(cost, "cacheRead", "cacheReadTokens", "cachedTokens"),
        });
        samples.push({
          name: `${PREFIX}_tokens_cache_write_total`,
          value: extractNumber(cost, "cacheWrite", "cacheWriteTokens"),
        });
        samples.push({
          name: `${PREFIX}_tokens_total`,
          value: extractNumber(cost, "totalTokens", "tokens", "tokensTotal"),
        });
        samples.push({
          name: `${PREFIX}_cost_usd_total`,
          value: extractNumber(cost, "totalCostUsd", "costUsd", "total", "cost"),
        });
        samples.push({
          name: `${PREFIX}_missing_cost_entries_total`,
          value: extractNumber(cost, "missingCostEntries", "missingCostEntriesTotal"),
        });
      }

      samples.push({
        name: `${PREFIX}_requests_total`,
        value: extractNumber(cost, "requests", "totalRequests", "count"),
      });

      const msg = sessionsUsageResult?.aggregates?.messages;
      if (msg) {
        samples.push({ name: `${PREFIX}_messages_total`, value: num(msg.total) });
        samples.push({ name: `${PREFIX}_messages_user_total`, value: num(msg.user) });
        samples.push({ name: `${PREFIX}_messages_assistant_total`, value: num(msg.assistant) });
        samples.push({ name: `${PREFIX}_messages_tool_calls_total`, value: num(msg.toolCalls) });
        samples.push({ name: `${PREFIX}_messages_tool_results_total`, value: num(msg.toolResults) });
        samples.push({ name: `${PREFIX}_messages_errors_total`, value: num(msg.errors) });
      }

      const tools = sessionsUsageResult?.aggregates?.tools;
      if (tools) {
        samples.push({ name: `${PREFIX}_tools_total_calls`, value: num(tools.totalCalls) });
        samples.push({ name: `${PREFIX}_tools_unique_total`, value: num(tools.uniqueTools) });
        if (Array.isArray(tools.tools)) {
          for (const t of tools.tools) {
            const tool = sanitizeLabel(t.name ?? "unknown");
            samples.push({
              name: `${PREFIX}_tool_calls_total`,
              labels: { tool },
              value: num(t.count),
            });
          }
        }
      }

      const lat = sessionsUsageResult?.aggregates?.latency;
      if (lat) {
        samples.push({ name: `${PREFIX}_latency_count`, value: num(lat.count) });
        samples.push({ name: `${PREFIX}_latency_avg_seconds`, value: num(lat.avgMs) / 1000 });
        samples.push({ name: `${PREFIX}_latency_p95_seconds`, value: num(lat.p95Ms) / 1000 });
        samples.push({ name: `${PREFIX}_latency_min_seconds`, value: num(lat.minMs) / 1000 });
        samples.push({ name: `${PREFIX}_latency_max_seconds`, value: num(lat.maxMs) / 1000 });
      }

      const byProvider = sessionsUsageResult?.aggregates?.byProvider;
      if (Array.isArray(byProvider)) {
        for (const row of byProvider) {
          const provider = sanitizeLabel(row.provider ?? "unknown");
          const t = row.totals ?? {};
          const input = num(t.input);
          const output = num(t.output);
          const cacheRead = num(t.cacheRead);
          const cacheWrite = num(t.cacheWrite);
          const totalTok = num(t.totalTokens) > 0 ? num(t.totalTokens) : input + output + cacheRead + cacheWrite;
          const costUsd = num(t.totalCost);
          const missing = num(t.missingCostEntries);
          samples.push({ name: `${PREFIX}_provider_requests_total`, labels: { provider }, value: num(row.count) });
          samples.push({ name: `${PREFIX}_provider_tokens_input_total`, labels: { provider }, value: input });
          samples.push({ name: `${PREFIX}_provider_tokens_output_total`, labels: { provider }, value: output });
          samples.push({ name: `${PREFIX}_provider_tokens_cache_read_total`, labels: { provider }, value: cacheRead });
          samples.push({ name: `${PREFIX}_provider_tokens_cache_write_total`, labels: { provider }, value: cacheWrite });
          samples.push({ name: `${PREFIX}_provider_tokens_total`, labels: { provider }, value: totalTok });
          samples.push({ name: `${PREFIX}_provider_cost_usd_total`, labels: { provider }, value: costUsd });
          samples.push({ name: `${PREFIX}_provider_missing_cost_entries_total`, labels: { provider }, value: missing });
        }
      }

      const byModel = sessionsUsageResult?.aggregates?.byModel;
      if (Array.isArray(byModel)) {
        for (const row of byModel) {
          const provider = sanitizeLabel(row.provider ?? "unknown");
          const model = sanitizeLabel(row.model ?? "unknown");
          const t = row.totals ?? {};
          const totalTok = num(t.totalTokens) > 0 ? num(t.totalTokens) : num(t.input) + num(t.output) + num(t.cacheRead) + num(t.cacheWrite);
          samples.push({ name: `${PREFIX}_model_requests_total`, labels: { provider, model }, value: num(row.count) });
          samples.push({ name: `${PREFIX}_model_tokens_total`, labels: { provider, model }, value: totalTok });
          samples.push({ name: `${PREFIX}_model_cost_usd_total`, labels: { provider, model }, value: num(t.totalCost) });
        }
      }

      const byAgent = sessionsUsageResult?.aggregates?.byAgent;
      if (Array.isArray(byAgent)) {
        for (const row of byAgent) {
          const agent_id = sanitizeLabel(row.agentId ?? "unknown");
          const t = row.totals ?? {};
          const totalTok = num(t.totalTokens) > 0 ? num(t.totalTokens) : num(t.input) + num(t.output) + num(t.cacheRead) + num(t.cacheWrite);
          samples.push({ name: `${PREFIX}_agent_tokens_total`, labels: { agent_id }, value: totalTok });
          samples.push({ name: `${PREFIX}_agent_cost_usd_total`, labels: { agent_id }, value: num(t.totalCost) });
        }
      }

      const byChannel = sessionsUsageResult?.aggregates?.byChannel;
      if (Array.isArray(byChannel)) {
        for (const row of byChannel) {
          const channel = sanitizeLabel(row.channel ?? "unknown");
          const t = row.totals ?? {};
          const totalTok = num(t.totalTokens) > 0 ? num(t.totalTokens) : num(t.input) + num(t.output) + num(t.cacheRead) + num(t.cacheWrite);
          samples.push({ name: `${PREFIX}_channel_tokens_total`, labels: { channel }, value: totalTok });
          samples.push({ name: `${PREFIX}_channel_cost_usd_total`, labels: { channel }, value: num(t.totalCost) });
        }
      }

      const dailyFromCost = (cost as { daily?: Array<{ date?: string; totalTokens?: number; totalCost?: number }> }).daily;
      if (Array.isArray(dailyFromCost)) {
        for (const row of dailyFromCost) {
          const date = sanitizeDate(row.date);
          if (!date) continue;
          samples.push({ name: `${PREFIX}_daily_tokens_total`, labels: { date }, value: num(row.totalTokens) });
          samples.push({ name: `${PREFIX}_daily_cost_usd_total`, labels: { date }, value: num(row.totalCost) });
        }
      } else {
        const daily = sessionsUsageResult?.aggregates?.daily;
        if (Array.isArray(daily)) {
          for (const row of daily) {
            const date = sanitizeDate(row.date);
            if (!date) continue;
            samples.push({ name: `${PREFIX}_daily_tokens_total`, labels: { date }, value: num(row.tokens) });
            samples.push({ name: `${PREFIX}_daily_cost_usd_total`, labels: { date }, value: num(row.cost) });
          }
        }
      }
    } catch (err) {
      throw new CollectorError("usage rpc failed", samples, err);
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

function sanitizeLabel(raw: string): string {
  const s = String(raw).trim() || "unknown";
  return s.replace(/["\\\n]/g, "_").slice(0, 128);
}

function sanitizeDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function resolveWindowDates(utcOffset: string, days: number): { startDate: string; endDate: string } {
  const offsetMinutes = parseUtcOffsetMinutes(utcOffset);
  const now = Date.now();
  const end = formatDateAtOffset(now, offsetMinutes);
  const start = formatDateAtOffset(now - (days - 1) * 24 * 60 * 60 * 1000, offsetMinutes);
  return { startDate: start, endDate: end };
}

function parseUtcOffsetMinutes(utcOffset: string): number {
  const m = /^UTC([+-])(\d{1,2})(?::(\d{2}))?$/.exec(utcOffset);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  const hh = Number(m[2]);
  const mm = m[3] ? Number(m[3]) : 0;
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 0;
  return sign * (hh * 60 + mm);
}

function formatDateAtOffset(epochMs: number, offsetMinutes: number): string {
  const shifted = new Date(epochMs + offsetMinutes * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
