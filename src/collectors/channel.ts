/**
 * Channel 指标采集器
 * 采集各渠道的连接状态和消息量
 */

import type { MetricCollector, MetricDefinition, MetricSample, GatewayRuntime } from "../types.js";

const PREFIX = "openclaw_channel";

/**
 * Channel 采集器
 * 通过 runtime.gatewayCall 获取渠道列表和状态
 */
export class ChannelCollector implements MetricCollector {
  name = "channel";

  definitions: MetricDefinition[] = [
    { name: `${PREFIX}_count`, help: "Total number of channels", type: "gauge" },
    { name: `${PREFIX}_connected`, help: "Channel connection status (1=connected)", type: "gauge", labels: ["channel_id"] },
    { name: `${PREFIX}_messages_total`, help: "Total messages per channel", type: "counter", labels: ["channel_id"] },
  ];

  constructor(private runtime: GatewayRuntime) {}

  /**
   * 采集 Channel 指标
   */
  async collect(): Promise<MetricSample[]> {
    const samples: MetricSample[] = [];
    const runtimeAny = this.runtime as Record<string, unknown>;

    try {
      let channels: Record<string, unknown>[] = [];
      if (typeof runtimeAny.gatewayCall === "function") {
        const fn = runtimeAny.gatewayCall as (m: string) => Promise<unknown>;
        const result = await fn("channels.list");
        channels = Array.isArray(result) ? result : [];
      }

      samples.push({ name: `${PREFIX}_count`, value: channels.length });

      for (const ch of channels) {
        const id = (ch.id as string) ?? "unknown";
        samples.push(
          { name: `${PREFIX}_connected`, labels: { channel_id: id }, value: ch.connected ? 1 : 0 },
          { name: `${PREFIX}_messages_total`, labels: { channel_id: id }, value: (ch.messageCount as number) ?? 0 },
        );
      }
    } catch {
      samples.push({ name: `${PREFIX}_count`, value: 0 });
    }

    return samples;
  }
}
