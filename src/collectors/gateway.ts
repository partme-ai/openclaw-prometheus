/**
 * Gateway 指标采集器
 * 采集 Gateway 核心运行指标：连接数、会话数、消息率
 */

import type { MetricCollector, MetricDefinition, MetricSample, GatewayRuntime } from "../types.js";

const PREFIX = "openclaw_gateway";

/**
 * Gateway 采集器
 * 通过 runtime.gatewayCall 获取 Gateway 概览数据
 */
export class GatewayCollector implements MetricCollector {
  name = "gateway";

  definitions: MetricDefinition[] = [
    { name: `${PREFIX}_uptime_seconds`, help: "Gateway uptime in seconds", type: "gauge" },
    { name: `${PREFIX}_connected_clients`, help: "Number of connected clients", type: "gauge" },
    { name: `${PREFIX}_active_sessions`, help: "Number of active sessions", type: "gauge" },
    { name: `${PREFIX}_messages_total`, help: "Total messages processed", type: "counter" },
    { name: `${PREFIX}_message_rate_per_minute`, help: "Messages per minute", type: "gauge" },
  ];

  constructor(private runtime: GatewayRuntime) {}

  /**
   * 采集 Gateway 指标
   */
  async collect(): Promise<MetricSample[]> {
    const runtimeAny = this.runtime as Record<string, unknown>;

    try {
      let overview: Record<string, unknown> = {};
      if (typeof runtimeAny.gatewayCall === "function") {
        const fn = runtimeAny.gatewayCall as (m: string) => Promise<unknown>;
        overview = (await fn("overview")) as Record<string, unknown> ?? {};
      }

      return [
        { name: `${PREFIX}_uptime_seconds`, value: (overview.uptimeSeconds as number) ?? process.uptime() },
        { name: `${PREFIX}_connected_clients`, value: (overview.connectedClients as number) ?? 0 },
        { name: `${PREFIX}_active_sessions`, value: (overview.activeSessionCount as number) ?? 0 },
        { name: `${PREFIX}_messages_total`, value: (overview.totalMessages as number) ?? 0 },
        { name: `${PREFIX}_message_rate_per_minute`, value: (overview.messageRate as number) ?? 0 },
      ];
    } catch {
      return [
        { name: `${PREFIX}_uptime_seconds`, value: process.uptime() },
        { name: `${PREFIX}_connected_clients`, value: 0 },
        { name: `${PREFIX}_active_sessions`, value: 0 },
        { name: `${PREFIX}_messages_total`, value: 0 },
        { name: `${PREFIX}_message_rate_per_minute`, value: 0 },
      ];
    }
  }
}
