/**
 * Memory 索引指标采集器
 * 采集知识库/记忆索引的状态指标
 *
 * 采集策略：
 * 1. 从 runtime 配置中获取 Agent 列表
 * 2. 逐 Agent 调用 gatewayCall("memory.stats") 获取索引统计
 * 3. 导出 openclaw_memory_indexed_files_total 和 openclaw_memory_index_size_bytes
 * 4. 优雅处理无 memory 的 Agent（返回零值）
 */

import type { MetricCollector, MetricDefinition, MetricSample, GatewayRuntime } from "../types.js";

const PREFIX = "openclaw_memory";

/**
 * Memory 采集器
 * 采集 Agent 级别的记忆索引指标
 */
export class MemoryCollector implements MetricCollector {
  name = "memory";

  definitions: MetricDefinition[] = [
    { name: `${PREFIX}_indexed_files_total`, help: "Total indexed memory files per agent", type: "gauge", labels: ["agent_id"] },
    { name: `${PREFIX}_index_size_bytes`, help: "Memory index size in bytes per agent", type: "gauge", labels: ["agent_id"] },
  ];

  constructor(private runtime: GatewayRuntime) {}

  /**
   * 采集 Memory 指标
   * 遍历所有 Agent，收集各自的记忆索引统计
   *
   * @returns 指标样本数组
   */
  async collect(): Promise<MetricSample[]> {
    const samples: MetricSample[] = [];
    const agentIds = this.getAgentIds();

    if (agentIds.length === 0) {
      return samples;
    }

    // 并行采集所有 Agent 的 memory 统计
    const results = await Promise.allSettled(
      agentIds.map((agentId) => this.collectAgentMemory(agentId))
    );

    for (let i = 0; i < agentIds.length; i++) {
      const agentId = agentIds[i];
      const result = results[i];

      if (result.status === "fulfilled" && result.value) {
        const stats = result.value;
        samples.push(
          {
            name: `${PREFIX}_indexed_files_total`,
            value: stats.indexedFiles ?? 0,
            labels: { agent_id: agentId },
          },
          {
            name: `${PREFIX}_index_size_bytes`,
            value: stats.indexSizeBytes ?? 0,
            labels: { agent_id: agentId },
          }
        );
      } else {
        // Agent 无 memory 或采集失败，导出零值
        samples.push(
          {
            name: `${PREFIX}_indexed_files_total`,
            value: 0,
            labels: { agent_id: agentId },
          },
          {
            name: `${PREFIX}_index_size_bytes`,
            value: 0,
            labels: { agent_id: agentId },
          }
        );
      }
    }

    return samples;
  }

  /**
   * 采集单个 Agent 的 memory 统计
   *
   * @param agentId - Agent ID
   * @returns memory 统计或 null
   */
  private async collectAgentMemory(
    agentId: string
  ): Promise<{ indexedFiles: number; indexSizeBytes: number } | null> {
    const runtimeAny = this.runtime as Record<string, unknown>;

    // 策略 1: gatewayCall
    if (typeof runtimeAny.gatewayCall === "function") {
      try {
        const result = await (runtimeAny.gatewayCall as (
          m: string, p?: Record<string, unknown>
        ) => Promise<Record<string, unknown>>)(
          "memory.stats", { agentId }
        );
        return {
          indexedFiles: (result?.indexedFiles as number) ?? (result?.files as number) ?? 0,
          indexSizeBytes: (result?.indexSizeBytes as number) ?? (result?.sizeBytes as number) ?? 0,
        };
      } catch {
        // Agent 可能没有 memory 功能
        return null;
      }
    }

    // 策略 2: invoke
    if (typeof runtimeAny.invoke === "function") {
      try {
        const result = await (runtimeAny.invoke as (
          m: string, p?: Record<string, unknown>
        ) => Promise<Record<string, unknown>>)(
          "memory_stats", { agentId }
        );
        return {
          indexedFiles: (result?.indexedFiles as number) ?? 0,
          indexSizeBytes: (result?.indexSizeBytes as number) ?? 0,
        };
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * 从 runtime 配置中提取 Agent ID 列表
   *
   * @returns Agent ID 数组
   */
  private getAgentIds(): string[] {
    const config = this.runtime.config;
    const agentsConfig = config.agents as Record<string, unknown> | undefined;
    if (!agentsConfig) return [];

    return Object.keys(agentsConfig).filter((key) => key !== "defaults");
  }
}
