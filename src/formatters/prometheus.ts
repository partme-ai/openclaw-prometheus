/**
 * Prometheus 文本格式序列化器
 * 将内部指标数据转换为 Prometheus exposition format
 * https://prometheus.io/docs/instrumenting/exposition_formats/
 */

import type { MetricDefinition, MetricSample } from "../types.js";

/**
 * 格式化指标定义为 Prometheus HELP/TYPE 行
 */
function formatDefinition(def: MetricDefinition): string {
  return `# HELP ${def.name} ${def.help}\n# TYPE ${def.name} ${def.type}`;
}

/**
 * 格式化单个样本为 Prometheus 行
 */
function formatSample(sample: MetricSample): string {
  let line = sample.name;

  if (sample.labels && Object.keys(sample.labels).length > 0) {
    const labelStr = Object.entries(sample.labels)
      .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
      .join(",");
    line += `{${labelStr}}`;
  }

  line += ` ${sample.value}`;

  if (sample.timestamp) {
    line += ` ${sample.timestamp}`;
  }

  return line;
}

/**
 * 转义 label 值中的特殊字符
 */
function escapeLabel(value: unknown): string {
  const s = value === undefined || value === null ? "unknown" : String(value);
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/**
 * 将所有指标数据序列化为 Prometheus text format
 *
 * @param definitions - 指标定义列表
 * @param samples - 指标样本列表
 * @returns Prometheus text format 字符串
 */
export function formatPrometheus(
  definitions: MetricDefinition[],
  samples: MetricSample[]
): string {
  const lines: string[] = [];
  const uniqueDefs: MetricDefinition[] = [];
  const seenDefs = new Set<string>();
  for (const d of definitions) {
    if (seenDefs.has(d.name)) {
      continue;
    }
    seenDefs.add(d.name);
    uniqueDefs.push(d);
  }
  const defMap = new Map(uniqueDefs.map((d) => [d.name, d]));

  // 按指标名分组样本
  const samplesByName = new Map<string, MetricSample[]>();
  for (const sample of samples) {
    const existing = samplesByName.get(sample.name) ?? [];
    existing.push(sample);
    samplesByName.set(sample.name, existing);
  }

  // 按定义顺序输出
  for (const def of uniqueDefs) {
    lines.push(formatDefinition(def));
    const metricSamples = samplesByName.get(def.name) ?? [];
    for (const sample of metricSamples) {
      lines.push(formatSample(sample));
    }
    lines.push("");
  }

  // 输出未定义的样本（自动发现）
  for (const [name, metricSamples] of samplesByName) {
    if (!defMap.has(name)) {
      lines.push(`# HELP ${name} (auto-discovered)`);
      lines.push(`# TYPE ${name} gauge`);
      for (const sample of metricSamples) {
        lines.push(formatSample(sample));
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
