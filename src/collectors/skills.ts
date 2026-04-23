/**
 * Skills 指标采集器
 *
 * 数据来源：Gateway `skills.status` + `skills.bins` RPC 方法
 * 返回已安装 Skill 的状态和二进制列表。
 *
 * 从真实数据中提取：
 * - Skill 总数
 * - 已安装二进制数
 */

import type { MetricCollector, MetricDefinition, MetricSample } from "../types.js";
import { rpcCall } from "../ws-bridge.js";
import { CollectorError } from "../collector-error.js";

const PREFIX = "openclaw_skill";

/**
 * Skill 采集器
 * 调用 skills.status 和 skills.bins RPC
 */
export class SkillCollector implements MetricCollector {
  name = "skills";

  definitions: MetricDefinition[] = [
    { name: `${PREFIX}_total`, help: "Total registered skills", type: "gauge" },
    { name: `${PREFIX}_bins_total`, help: "Total skill binaries installed", type: "gauge" },
  ];

  /**
   * 采集 Skill 指标
   */
  async collect(): Promise<MetricSample[]> {
    const samples: MetricSample[] = [];

    try {
      const [statusRes, binsRes] = await Promise.allSettled([
        rpcCall<unknown>("skills.status"),
        rpcCall<unknown>("skills.bins"),
      ]);

      const statusResult = statusRes.status === "fulfilled" ? statusRes.value : null;
      const binsResult = binsRes.status === "fulfilled" ? binsRes.value : null;

      // skills.status
      let skillCount = 0;
      if (statusResult && typeof statusResult === "object") {
        const obj = statusResult as Record<string, unknown>;
        if (typeof obj.count === "number") skillCount = obj.count;
        else if (Array.isArray(obj.skills)) skillCount = obj.skills.length;
      }
      samples.push({ name: `${PREFIX}_total`, value: skillCount });

      // skills.bins
      let binCount = 0;
      if (Array.isArray(binsResult)) {
        binCount = binsResult.length;
      } else if (binsResult && typeof binsResult === "object") {
        const obj = binsResult as Record<string, unknown>;
        if (Array.isArray(obj.bins)) binCount = obj.bins.length;
      }
      samples.push({ name: `${PREFIX}_bins_total`, value: binCount });
      const errors: string[] = [];
      if (statusRes.status === "rejected") errors.push(`skills.status: ${String(statusRes.reason)}`);
      if (binsRes.status === "rejected") errors.push(`skills.bins: ${String(binsRes.reason)}`);
      if (errors.length > 0) {
        const cause =
          statusRes.status === "rejected"
            ? statusRes.reason
            : binsRes.status === "rejected"
              ? binsRes.reason
              : undefined;
        throw new CollectorError(errors.join("; "), samples, cause);
      }
    } catch (err) {
      if (err instanceof CollectorError) {
        throw err;
      }
      throw new CollectorError("skills rpc failed", [], err);
    }

    return samples;
  }
}
