/**
 * Node.js 运行时指标采集器
 * 采集进程级指标：内存、CPU、事件循环延迟
 */

import type { MetricCollector, MetricDefinition, MetricSample } from "../types.js";

const PREFIX = "openclaw_nodejs";

let eventLoopLag = 0;
let lastCheck = Date.now();
let eventLoopMeasureStarted = false;

function ensureEventLoopMeasure(): void {
  if (eventLoopMeasureStarted) {
    return;
  }
  eventLoopMeasureStarted = true;
  const expected = 100;
  const measure = () => {
    const now = Date.now();
    const actual = now - lastCheck;
    eventLoopLag = Math.max(0, actual - expected);
    lastCheck = now;
    const t = setTimeout(measure, expected);
    t.unref?.();
  };
  const t0 = setTimeout(measure, expected);
  t0.unref?.();
}

/**
 * 运行时采集器
 * 采集 Node.js 进程级别的资源使用指标
 */
export class RuntimeCollector implements MetricCollector {
  name = "runtime";

  definitions: MetricDefinition[] = [
    { name: `${PREFIX}_heap_used_bytes`, help: "Node.js heap used in bytes", type: "gauge" },
    { name: `${PREFIX}_heap_total_bytes`, help: "Node.js heap total in bytes", type: "gauge" },
    { name: `${PREFIX}_external_bytes`, help: "Node.js external memory in bytes", type: "gauge" },
    { name: `${PREFIX}_rss_bytes`, help: "Resident set size in bytes", type: "gauge" },
    { name: `${PREFIX}_event_loop_lag_ms`, help: "Event loop lag in milliseconds", type: "gauge" },
    { name: `${PREFIX}_uptime_seconds`, help: "Node.js process uptime", type: "gauge" },
  ];

  constructor() {
    ensureEventLoopMeasure();
  }

  /**
   * 采集运行时指标
   */
  async collect(): Promise<MetricSample[]> {
    const mem = process.memoryUsage();

    return [
      { name: `${PREFIX}_heap_used_bytes`, value: mem.heapUsed },
      { name: `${PREFIX}_heap_total_bytes`, value: mem.heapTotal },
      { name: `${PREFIX}_external_bytes`, value: mem.external },
      { name: `${PREFIX}_rss_bytes`, value: mem.rss },
      { name: `${PREFIX}_event_loop_lag_ms`, value: eventLoopLag },
      { name: `${PREFIX}_uptime_seconds`, value: process.uptime() },
    ];
  }
}
