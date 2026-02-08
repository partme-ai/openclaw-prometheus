/**
 * Node.js 运行时指标采集器
 * 采集进程级指标：内存、CPU、事件循环延迟
 */

import type { MetricCollector, MetricDefinition, MetricSample } from "../types.js";

const PREFIX = "openclaw_nodejs";

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

  /** 事件循环延迟测量值 */
  private eventLoopLag = 0;
  /** 上次事件循环检测时间 */
  private lastCheck = Date.now();
  /** 定时器引用 */
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.startEventLoopMeasure();
  }

  /**
   * 启动事件循环延迟测量
   * 每 100ms 检查一次实际经过时间与预期的差值
   */
  private startEventLoopMeasure(): void {
    const measure = () => {
      const now = Date.now();
      const expected = 100;
      const actual = now - this.lastCheck;
      this.eventLoopLag = Math.max(0, actual - expected);
      this.lastCheck = now;
      this.timer = setTimeout(measure, expected);
    };
    this.timer = setTimeout(measure, 100);
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
      { name: `${PREFIX}_event_loop_lag_ms`, value: this.eventLoopLag },
      { name: `${PREFIX}_uptime_seconds`, value: process.uptime() },
    ];
  }
}
