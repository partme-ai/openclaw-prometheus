import { readFileSync } from 'fs';

// 读取编译后的代码
const code = readFileSync('/home/wandl/workspaces/workspace-partme-ai/openclaw-plugins/openclaw-prometheus/dist/index.js', 'utf8');

// 检查 observeHistogram 的实现
console.log('=== 检查 observeHistogram 函数 ===');
const observeHistogramMatch = code.match(/observeHistogram\([^)]+\)\s*\{[^}]+?\}/s);
if (observeHistogramMatch) {
  console.log('找到 observeHistogram 函数:');
  console.log(observeHistogramMatch[0].substring(0, 500) + '...');
} else {
  console.log('未找到 observeHistogram 函数');
}

// 检查 bucketBounds
console.log('\n=== 检查 bucketBounds ===');
const bucketBoundsMatch = code.match(/const bucketBounds\s*=\s*\[[^\]]+\]/);
if (bucketBoundsMatch) {
  console.log('找到 bucketBounds:');
  console.log(bucketBoundsMatch[0]);
} else {
  console.log('未找到 bucketBounds');
}

// 检查 registerToolHooks 是否调用了 observeHistogram
console.log('\n=== 检查 registerToolHooks ===');
const registerToolHooksMatch = code.match(/registerToolHooks\([^)]+\)\s*\{[^}]+?\}/s);
if (registerToolHooksMatch) {
  const hooksCode = registerToolHooksMatch[0];
  if (hooksCode.includes('observeHistogram')) {
    console.log('registerToolHooks 调用了 observeHistogram');
    console.log(hooksCode.substring(0, 300) + '...');
  } else {
    console.log('registerToolHooks 没有调用 observeHistogram');
  }
} else {
  console.log('未找到 registerToolHooks 函数');
}