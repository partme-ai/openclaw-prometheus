/**
 * Cron 指标采集器
 *
 * 数据来源：
 * - Gateway `cron.status` RPC — 调度器状态
 * - Gateway `cron.list` RPC — 任务列表
 *
 * 从真实数据中提取：
 * - 调度器是否启用
 * - 注册的 Cron 任务数
 * - 启用 / 禁用任务分布
 * - 下次唤醒时间
 */

import type { MetricCollector, MetricDefinition, MetricSample, CronStatus, CronJob } from "../types.js";
import { rpcCall } from "../ws-bridge.js";

const PREFIX = "openclaw_cron";

/**
 * Cron 采集器
 * 调用 cron.status 和 cron.list RPC
 */
export class CronCollector implements MetricCollector {
  name = "cron";

  definitions: MetricDefinition[] = [
    { name: `${PREFIX}_scheduler_enabled`, help: "Cron scheduler enabled (1=yes, 0=no)", type: "gauge" },
    { name: `${PREFIX}_jobs_total`, help: "Total registered cron jobs", type: "gauge" },
    { name: `${PREFIX}_jobs_enabled`, help: "Enabled cron jobs", type: "gauge" },
    { name: `${PREFIX}_jobs_disabled`, help: "Disabled cron jobs", type: "gauge" },
    { name: `${PREFIX}_next_wake_in_seconds`, help: "Seconds until next cron wake", type: "gauge" },
  ];

  /**
   * 采集 Cron 指标
   * 并行调用 cron.status 和 cron.list
   */
  async collect(): Promise<MetricSample[]> {
    const samples: MetricSample[] = [];

    try {
      const [status, listResult] = await Promise.all([
        rpcCall<CronStatus>("cron.status").catch(() => ({} as CronStatus)),
        rpcCall<unknown>("cron.list").catch(() => []),
      ]);

      // 调度器状态
      samples.push({
        name: `${PREFIX}_scheduler_enabled`,
        value: status.enabled !== undefined ? (status.enabled ? 1 : 0) : 1,
      });

      // 任务列表
      let jobs: CronJob[] = [];
      if (Array.isArray(listResult)) {
        jobs = listResult;
      } else if (listResult && typeof listResult === "object") {
        const obj = listResult as Record<string, unknown>;
        if (Array.isArray(obj.jobs)) jobs = obj.jobs;
      }

      const totalJobs = status.jobCount ?? jobs.length;
      const enabledJobs = jobs.filter((j) => j.enabled !== false).length;

      samples.push({ name: `${PREFIX}_jobs_total`, value: totalJobs });
      samples.push({ name: `${PREFIX}_jobs_enabled`, value: enabledJobs });
      samples.push({ name: `${PREFIX}_jobs_disabled`, value: totalJobs - enabledJobs });

      // 下次唤醒
      if (status.nextWakeTime && status.nextWakeTime > 0) {
        const secondsUntil = Math.max(0, Math.round((status.nextWakeTime - Date.now()) / 1000));
        samples.push({ name: `${PREFIX}_next_wake_in_seconds`, value: secondsUntil });
      }
    } catch {
      samples.push({ name: `${PREFIX}_jobs_total`, value: 0 });
    }

    return samples;
  }
}
