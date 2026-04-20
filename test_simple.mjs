/**
 * 简化测试：直接验证 MetricsRegistry 的行为
 */

import { MetricsRegistry } from "./src/metrics-registry.js";

console.log("=== 简化测试：MetricsRegistry ===\n");

const registry = new MetricsRegistry();

// 测试：直接调用 inc() 方法
console.log("测试：直接调用 inc() 方法");

// 测试 _count
registry.inc("test_histogram_count", 1, {
  help: "Test histogram count",
  type: "counter",
  labels: { test: "test" },
});

// 测试 _sum
registry.inc("test_histogram_sum", 0.05, {
  help: "Test histogram sum",
  type: "counter",
  labels: { test: "test" },
});

// 测试 _bucket (第一个 bucket)
registry.inc("test_histogram_bucket", 1, {
  help: "Test histogram bucket",
  type: "counter",
  labels: { test: "test", le: "0.001" },
});

// 测试 _bucket (第二个 bucket)
registry.inc("test_histogram_bucket", 1, {
  help: "Test histogram bucket",
  type: "counter",
  labels: { test: "test", le: "0.005" },
});

// 测试 _bucket (+Inf)
registry.inc("test_histogram_bucket", 1, {
  help: "Test histogram bucket",
  type: "counter",
  labels: { test: "test", le: "+Inf" },
});

// 检查样本
const samples = registry.snapshotSamples();
console.log(`\n总样本数: ${samples.length}`);

// 查找 _bucket 样本
const bucketSamples = samples.filter(s => s.name === "test_histogram_bucket");
console.log(`_bucket 样本数: ${bucketSamples.length}`);

if (bucketSamples.length > 0) {
  console.log("\n✅ _bucket 样本已存储！");
  console.log("\n_bucket 样本列表:");
  for (const sample of bucketSamples) {
    console.log(`  ${JSON.stringify(sample)}`);
  }

  // 验证 le 标签
  const leValues = bucketSamples.map(s => s.labels.le);
  console.log(`\nle 标签值: [${leValues.join(", ")}]`);

  // 验证 le 标签是否符合预期
  const expectedLe = ["0.001", "0.005", "+Inf"];
  const expectedLeMatch = leValues.every(v => expectedLe.includes(v));

  if (expectedLeMatch) {
    console.log("✅ le 标签值符合预期！");
  } else {
    console.log("❌ le 标签值不符合预期！");
    console.log(`   预期: [${expectedLe.join(", ")}]`);
    console.log(`   实际: [${leValues.join(", ")}]`);
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
