/**
 * 测试 observeHistogram 是否正确存储 _bucket 样本
 */

import { MetricsRegistry } from "./src/metrics-registry.js";

console.log("=== 测试 observeHistogram ===\n");

const registry = new MetricsRegistry();

// 测试 1：观测一个持续时间
console.log("测试 1：观测 0.05 秒");
registry.observeHistogram("test_histogram", 0.05, {
  help: "Test histogram",
  labels: { test: "test" },
});

// 检查样本
const samples = registry.snapshotSamples();
console.log(`\n总样本数: ${samples.length}`);

// 查找 _bucket 样本
const bucketSamples = samples.filter(s => s.name === "test_histogram_bucket");
console.log(`\n_bucket 样本数: ${bucketSamples.length}`);

if (bucketSamples.length > 0) {
  console.log("\n✅ _bucket 样本已存储！");
  console.log("\n_bucket 样本列表:");
  for (const sample of bucketSamples) {
    console.log(`  ${JSON.stringify(sample)}`);
  }
} else {
  console.log("\n❌ _bucket 样本未存储！");

  // 检查 _count 和 _sum 样本
  const countSamples = samples.filter(s => s.name === "test_histogram_count");
  const sumSamples = samples.filter(s => s.name === "test_histogram_sum");

  console.log(`\n_count 样本数: ${countSamples.length}`);
  console.log(`_sum 样本数: ${sumSamples.length}`);

  if (countSamples.length > 0) {
    console.log("\n_count 样本列表:");
    for (const sample of countSamples) {
      console.log(`  ${JSON.stringify(sample)}`);
    }
  }

  if (sumSamples.length > 0) {
    console.log("\n_sum 样本列表:");
    for (const sample of sumSamples) {
      console.log(`  ${JSON.stringify(sample)}`);
    }
  }
}

// 测试 2：观测多个持续时间
console.log("\n\n=== 测试 2：观测多个持续时间 ===");
const durations = [0.001, 0.005, 0.01, 0.05, 0.1, 1.0];
for (const duration of durations) {
  registry.observeHistogram("test_histogram", duration, {
    help: "Test histogram",
    labels: { test: "test" },
  });
  console.log(`观测到: ${duration} 秒`);
}

// 再次检查样本
const samples2 = registry.snapshotSamples();
const bucketSamples2 = samples2.filter(s => s.name === "test_histogram_bucket");

console.log(`\n总样本数: ${samples2.length}`);
console.log(`_bucket 样本数: ${bucketSamples2.length}`);

if (bucketSamples2.length > 0) {
  console.log("\n✅ _bucket 样本已正确累积！");

  // 统计每个 le 值的数量
  const leCounts = {};
  for (const sample of bucketSamples2) {
    const le = sample.labels.le;
    leCounts[le] = (leCounts[le] || 0) + 1;
  }

  console.log("\n_le 值统计:");
  for (const [le, count] of Object.entries(leCounts).sort()) {
    console.log(`  le="${le}": ${count}`);
  }
}
