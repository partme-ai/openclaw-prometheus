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
    { name: `${PREFIX}_enabled_total`, help: "Enabled skills", type: "gauge" },
    { name: `${PREFIX}_disabled_total`, help: "Disabled skills", type: "gauge" },
    { name: `${PREFIX}_eligible_total`, help: "Eligible skills", type: "gauge" },
    { name: `${PREFIX}_blocked_total`, help: "Skills blocked by allowlist", type: "gauge" },
  ];

  /**
   * 采集 Skill 指标
   */
  async collect(): Promise<MetricSample[]> {
    const statusResult = await rpcCall<unknown>("skills.status");

    const samples: MetricSample[] = [];
    const statusObj = statusResult && typeof statusResult === "object"
      ? (statusResult as Record<string, unknown>)
      : {};
    const skills = Array.isArray(statusObj.skills)
      ? (statusObj.skills as Array<Record<string, unknown>>)
      : [];
    const skillCount = typeof statusObj.count === "number" ? statusObj.count : skills.length;
    const enabledCount = skills.filter((skill) => skill.disabled !== true).length;
    const blockedCount = skills.filter((skill) => skill.blockedByAllowlist === true).length;
    const eligibleCount = skills.filter((skill) => skill.eligible !== false).length;

    samples.push({ name: `${PREFIX}_total`, value: skillCount });
    samples.push({ name: `${PREFIX}_enabled_total`, value: enabledCount });
    samples.push({ name: `${PREFIX}_disabled_total`, value: Math.max(skillCount - enabledCount, 0) });
    samples.push({ name: `${PREFIX}_eligible_total`, value: eligibleCount });
    samples.push({ name: `${PREFIX}_blocked_total`, value: blockedCount });

    let binCount = 0;
    try {
      const binsResult = await rpcCall<unknown>("skills.bins");
      if (Array.isArray(binsResult)) {
        binCount = binsResult.length;
      } else if (binsResult && typeof binsResult === "object") {
        const obj = binsResult as Record<string, unknown>;
        if (Array.isArray(obj.bins)) {
          binCount = obj.bins.length;
        }
      }
    } catch {
      // 某些角色无权访问 skills.bins；保留 skills.status 主体指标，bins_total 回退为 0。
    }
    samples.push({ name: `${PREFIX}_bins_total`, value: binCount });

    return samples;
  }
}
