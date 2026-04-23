/**
 * Session 指标采集器
 *
 * 数据来源：Gateway `sessions.list` RPC 方法
 * sessions.list 返回所有会话条目，每个条目包含：
 * - sessionId、key、updatedAt
 * - inputTokens、outputTokens、totalTokens、contextTokens
 * - channel、origin 信息
 *
 * 从真实数据中提取：
 * - 会话总数、按渠道分布
 * - Token 消耗聚合（input/output/total/context）
 * - 最近活跃会话数
 * - 平均/最大 Token 使用量
 */

import type { MetricCollector, MetricDefinition, MetricSample, SessionEntry } from "../types.js";
import { rpcCall } from "../ws-bridge.js";
import { CollectorError } from "../collector-error.js";

const PREFIX = "openclaw_session";

/**
 * Session 采集器
 * 调用 Gateway `sessions.list` RPC，聚合会话统计
 */
export class SessionCollector implements MetricCollector {
  name = "sessions";

  definitions: MetricDefinition[] = [
    // 会话数量
    { name: `${PREFIX}_total`, help: "Total sessions in store", type: "gauge" },
    { name: `${PREFIX}_active_recent`, help: "Sessions active in last 30 minutes", type: "gauge" },
    { name: `${PREFIX}_by_channel`, help: "Sessions per channel", type: "gauge", labels: ["channel"] },

    // Token 消耗（全局聚合）
    { name: `${PREFIX}_tokens_input_total`, help: "Total input tokens across all sessions", type: "gauge" },
    { name: `${PREFIX}_tokens_output_total`, help: "Total output tokens across all sessions", type: "gauge" },
    { name: `${PREFIX}_tokens_total`, help: "Total tokens (input+output) across all sessions", type: "gauge" },
    { name: `${PREFIX}_tokens_context_total`, help: "Total context tokens across active sessions", type: "gauge" },

    // Token 平均值
    { name: `${PREFIX}_tokens_avg_per_session`, help: "Average total tokens per session", type: "gauge" },
    { name: `${PREFIX}_tokens_max_per_session`, help: "Max total tokens in a single session", type: "gauge" },
  ];

  /**
   * 采集 Session 指标
   * 调用 sessions.list 并从真实会话数据中聚合
   */
  async collect(): Promise<MetricSample[]> {
    const samples: MetricSample[] = [];

    try {
      const result = await rpcCall<unknown>("sessions.list", {
        includeGlobal: true,
        includeUnknown: false,
        limit: 120,
      });

      // sessions.list 可能返回数组或 { sessions: [...] } 或 { entries: [...] }
      let sessions: SessionEntry[] = [];
      if (Array.isArray(result)) {
        sessions = result;
      } else if (result && typeof result === "object") {
        const obj = result as Record<string, unknown>;
        if (Array.isArray(obj.sessions)) sessions = obj.sessions;
        else if (Array.isArray(obj.entries)) sessions = obj.entries;
      }

      // 会话总数
      samples.push({ name: `${PREFIX}_total`, value: sessions.length });

      // 最近活跃会话（30 分钟内）
      const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
      const recentCount = sessions.filter(
        (s) => s.updatedAt && s.updatedAt > thirtyMinAgo
      ).length;
      samples.push({ name: `${PREFIX}_active_recent`, value: recentCount });

      // 按渠道分布
      const byChannel: Record<string, number> = {};
      let totalInput = 0;
      let totalOutput = 0;
      let totalTokens = 0;
      let totalContext = 0;
      let maxTokens = 0;

      for (const session of sessions) {
        // 渠道统计
        const channel = session.channel ?? session.origin?.label ?? "unknown";
        byChannel[channel] = (byChannel[channel] ?? 0) + 1;

        // Token 聚合
        const input = session.inputTokens ?? 0;
        const output = session.outputTokens ?? 0;
        const total = session.totalTokens ?? (input + output);
        const context = session.contextTokens ?? 0;

        totalInput += input;
        totalOutput += output;
        totalTokens += total;
        totalContext += context;
        if (total > maxTokens) maxTokens = total;
      }

      // 按渠道
      for (const [channel, count] of Object.entries(byChannel)) {
        samples.push({ name: `${PREFIX}_by_channel`, labels: { channel }, value: count });
      }

      // Token 聚合
      samples.push({ name: `${PREFIX}_tokens_input_total`, value: totalInput });
      samples.push({ name: `${PREFIX}_tokens_output_total`, value: totalOutput });
      samples.push({ name: `${PREFIX}_tokens_total`, value: totalTokens });
      samples.push({ name: `${PREFIX}_tokens_context_total`, value: totalContext });

      // 平均/最大
      const avg = sessions.length > 0 ? Math.round(totalTokens / sessions.length) : 0;
      samples.push({ name: `${PREFIX}_tokens_avg_per_session`, value: avg });
      samples.push({ name: `${PREFIX}_tokens_max_per_session`, value: maxTokens });
    } catch (err) {
      throw new CollectorError("sessions.list rpc failed", [], err);
    }

    return samples;
  }
}
