/**
 * Presence 指标采集器
 *
 * 数据来源：Gateway `system-presence` RPC 方法
 * 返回当前连接的客户端/节点列表。
 *
 * 从真实数据中提取：
 * - 已连接客户端总数
 * - 按平台分布（macos, linux, windows, ios, android, ...）
 * - 按角色分布（operator, node）
 */

import type { MetricCollector, MetricDefinition, MetricSample, PresenceEntry } from "../types.js";
import { rpcCall } from "../ws-bridge.js";
import { CollectorError } from "../collector-error.js";

const PREFIX = "openclaw_presence";

/**
 * Presence 采集器
 * 调用 Gateway `system-presence` RPC
 */
export class PresenceCollector implements MetricCollector {
  name = "presence";

  definitions: MetricDefinition[] = [
    { name: `${PREFIX}_connected_total`, help: "Total connected clients/nodes", type: "gauge" },
    { name: `${PREFIX}_by_platform`, help: "Connected clients by platform", type: "gauge", labels: ["platform"] },
    { name: `${PREFIX}_by_mode`, help: "Connected clients by mode (operator/node)", type: "gauge", labels: ["mode"] },
  ];

  /**
   * 采集 Presence 指标
   * 从 system-presence 真实响应中解析
   */
  async collect(): Promise<MetricSample[]> {
    const samples: MetricSample[] = [];

    try {
      const result = await rpcCall<unknown>("system-presence");

      // system-presence 可能返回数组或 { entries: [...] } 或 { presence: [...] }
      let entries: PresenceEntry[] = [];
      if (Array.isArray(result)) {
        entries = result;
      } else if (result && typeof result === "object") {
        const obj = result as Record<string, unknown>;
        if (Array.isArray(obj.entries)) entries = obj.entries;
        else if (Array.isArray(obj.presence)) entries = obj.presence;
      }

      samples.push({ name: `${PREFIX}_connected_total`, value: entries.length });

      // 按平台
      const byPlatform: Record<string, number> = {};
      const byMode: Record<string, number> = {};

      for (const entry of entries) {
        const platform = entry.platform ?? "unknown";
        byPlatform[platform] = (byPlatform[platform] ?? 0) + 1;

        const mode = entry.mode ?? "operator";
        byMode[mode] = (byMode[mode] ?? 0) + 1;
      }

      for (const [platform, count] of Object.entries(byPlatform)) {
        samples.push({ name: `${PREFIX}_by_platform`, labels: { platform }, value: count });
      }
      for (const [mode, count] of Object.entries(byMode)) {
        samples.push({ name: `${PREFIX}_by_mode`, labels: { mode }, value: count });
      }
    } catch (err) {
      throw new CollectorError("system-presence rpc failed", [], err);
    }

    return samples;
  }
}
