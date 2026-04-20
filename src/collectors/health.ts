/**
 * Health 指标采集器
 *
 * 数据来源：Gateway `health` RPC 方法
 * 这是 OpenClaw 最可靠的数据端点，返回完整的健康快照。
 *
 * 从 health 快照中提取：
 * - Gateway 整体健康状态 (ok / degraded)
 * - uptime、版本信息
 * - Agent 数量
 * - Session 总数
 * - Channel 链接状态（按渠道）
 * - 心跳间隔
 */

import type { MetricCollector, MetricDefinition, MetricSample, HealthSnapshot } from "../types.js";
import { rpcCall } from "../ws-bridge.js";

const PREFIX = "openclaw";
const GATEWAY_PREFIX = "openclaw_gateway";

/**
 * Health 采集器
 * 调用 Gateway `health` RPC，解析真实的 HealthSnapshot
 */
export class HealthCollector implements MetricCollector {
  name = "health";

  definitions: MetricDefinition[] = [
    // Gateway 整体
    { name: `${GATEWAY_PREFIX}_up`, help: "Gateway health status (1=ok, 0=error)", type: "gauge" },
    { name: `${GATEWAY_PREFIX}_health_check_duration_ms`, help: "Gateway health check probe duration (ms)", type: "gauge" },
    { name: `${GATEWAY_PREFIX}_uptime_seconds`, help: "Gateway uptime in seconds", type: "gauge" },
    { name: `${GATEWAY_PREFIX}_heartbeat_interval_seconds`, help: "Gateway heartbeat interval (seconds)", type: "gauge" },

    // Agent
    { name: `${PREFIX}_agents_configured_total`, help: "Number of configured agents", type: "gauge" },

    // Session
    { name: `${PREFIX}_sessions_count`, help: "Total sessions in store", type: "gauge" },

    // Channel 链接状态
    { name: `${PREFIX}_channels_linked_total`, help: "Number of linked channels", type: "gauge" },
    { name: `${PREFIX}_channels_total`, help: "Total number of configured channels", type: "gauge" },
  ];

  /**
   * 采集 Health 指标
   * 调用 Gateway `health` RPC 并解析返回的 HealthSnapshot
   */
  async collect(): Promise<MetricSample[]> {
    const samples: MetricSample[] = [];
    const health = await rpcCall<HealthSnapshot>("health");

    // Gateway 整体
    samples.push({ name: `${GATEWAY_PREFIX}_up`, value: health.ok ? 1 : 0 });
    samples.push({ name: `${GATEWAY_PREFIX}_health_check_duration_ms`, value: health.durationMs ?? 0 });
    samples.push({ name: `${GATEWAY_PREFIX}_uptime_seconds`, value: health.uptimeSeconds ?? (process.uptime()) });
    samples.push({ name: `${GATEWAY_PREFIX}_heartbeat_interval_seconds`, value: health.heartbeatSeconds ?? 0 });

    // Agent 数量
    const agentCount = Array.isArray(health.agents) ? health.agents.length : 0;
    samples.push({ name: `${PREFIX}_agents_configured_total`, value: agentCount });

    // Session 数量
    const sessionsCount =
      typeof health.sessions?.count === "number"
        ? health.sessions.count
        : sumAgentSessions(health.agents);
    samples.push({ name: `${PREFIX}_sessions_count`, value: sessionsCount });

    // Channel 链接状态
    const channels = health.channels ?? {};
    let linkedCount = 0;
    let totalCount = 0;

    for (const [channelId, chHealth] of Object.entries(channels)) {
      totalCount++;
      const linked = chHealth.linked ? 1 : 0;
      if (linked) linkedCount++;
    }

    samples.push({ name: `${PREFIX}_channels_linked_total`, value: linkedCount });
    samples.push({ name: `${PREFIX}_channels_total`, value: totalCount });

    return samples;
  }
}

function sumAgentSessions(agents: HealthSnapshot["agents"]): number {
  if (!Array.isArray(agents)) {
    return 0;
  }

  return agents.reduce((sum, agent) => {
    const sessionCount = (agent as Record<string, unknown>).sessions;
    if (sessionCount && typeof sessionCount === "object") {
      const count = (sessionCount as Record<string, unknown>).count;
      if (typeof count === "number" && Number.isFinite(count)) {
        return sum + count;
      }
    }
    return sum;
  }, 0);
}
