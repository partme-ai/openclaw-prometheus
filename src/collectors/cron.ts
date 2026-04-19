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
    { name: `${PREFIX}_jobs_errors_total`, help: "Cron jobs whose last run failed", type: "gauge" },
    { name: `${PREFIX}_jobs_running_total`, help: "Cron jobs currently running", type: "gauge" },
    { name: `${PREFIX}_next_wake_in_seconds`, help: "Seconds until next cron wake", type: "gauge" },
    { name: `${PREFIX}_next_run_in_seconds`, help: "Soonest next run among listed cron jobs", type: "gauge" },
  ];

  /**
   * 采集 Cron 指标
   * 并行调用 cron.status 和 cron.list
   */
  async collect(): Promise<MetricSample[]> {
    const [status, listResult] = await Promise.all([
      rpcCall<CronStatus>("cron.status"),
      rpcCall<unknown>("cron.list"),
    ]);
    const samples: MetricSample[] = [];

    samples.push({
      name: `${PREFIX}_scheduler_enabled`,
      value: status.enabled !== undefined ? (status.enabled ? 1 : 0) : 1,
    });

    const jobs = normalizeJobs(listResult);
    const totalJobs =
      typeof (listResult as { total?: unknown })?.total === "number"
        ? ((listResult as { total: number }).total)
        : status.jobCount ?? jobs.length;
    const enabledJobs = jobs.filter((j) => j.enabled !== false).length;
    const runningJobs = jobs.filter((j) => {
      const state = j.state as Record<string, unknown> | undefined;
      return state?.running === true;
    }).length;
    const erroredJobs = jobs.filter((j) => {
      const state = j.state as Record<string, unknown> | undefined;
      return (
        state?.lastRunStatus === "error" ||
        state?.lastStatus === "error" ||
        typeof state?.consecutiveErrors === "number" && state.consecutiveErrors > 0
      );
    }).length;

    samples.push({ name: `${PREFIX}_jobs_total`, value: totalJobs });
    samples.push({ name: `${PREFIX}_jobs_enabled`, value: enabledJobs });
    samples.push({ name: `${PREFIX}_jobs_disabled`, value: Math.max(totalJobs - enabledJobs, 0) });
    samples.push({ name: `${PREFIX}_jobs_errors_total`, value: erroredJobs });
    samples.push({ name: `${PREFIX}_jobs_running_total`, value: runningJobs });

    const nextWakeAt = numberLike((status as Record<string, unknown>).nextWakeAtMs)
      || numberLike((status as Record<string, unknown>).nextWakeTime);
    if (nextWakeAt > 0) {
      samples.push({
        name: `${PREFIX}_next_wake_in_seconds`,
        value: Math.max(0, Math.round((nextWakeAt - Date.now()) / 1000)),
      });
    }

    const nextRuns = jobs
      .map((job) => numberLike((job as Record<string, unknown>).nextRunAtMs) || numberLike((job as Record<string, unknown>).nextRunAt))
      .filter((value) => value > 0);
    if (nextRuns.length > 0) {
      samples.push({
        name: `${PREFIX}_next_run_in_seconds`,
        value: Math.max(0, Math.round((Math.min(...nextRuns) - Date.now()) / 1000)),
      });
    }

    return samples;
  }
}

function normalizeJobs(listResult: unknown): CronJob[] {
  if (Array.isArray(listResult)) {
    return listResult as CronJob[];
  }
  if (listResult && typeof listResult === "object") {
    const obj = listResult as Record<string, unknown>;
    if (Array.isArray(obj.jobs)) {
      return obj.jobs as CronJob[];
    }
  }
  return [];
}

function numberLike(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
