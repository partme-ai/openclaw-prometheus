/**
 * 兼容层
 *
 * `openclaw-prometheus` 已切换为纯插件机制实现。
 * 这里保留仅为兼容旧 collector 文件，避免构建期间出现导入错误。
 */

import type { GatewayRuntime } from "./types.js";

/** 缓存的 Gateway Runtime 引用 */
let _runtime: GatewayRuntime | null = null;

/**
 * 设置 Gateway Runtime 引用
 * 在插件 register() 时调用
 *
 * @param runtime - Gateway 注入的运行时
 */
export function setRuntime(runtime: GatewayRuntime): void {
  _runtime = runtime;
}

/**
 * 获取 Gateway Runtime 引用
 *
 * @throws 如果 runtime 未初始化
 */
export function getRuntime(): GatewayRuntime {
  if (!_runtime) {
    throw new Error(
      "[openclaw-prometheus] Gateway runtime not initialized. Plugin not registered?"
    );
  }
  return _runtime;
}

/**
 * 通过 Runtime 内部 API 执行 Gateway RPC 调用
 *
 * 实现策略（按优先级）：
 * 1. runtime.gatewayCall(method, params) — 最常见
 * 2. runtime.invoke(method, params) — 替代接口
 * 3. runtime 属性遍历 — 按 "." 分割方法名逐级查找
 *
 * 如果所有策略均不可用，返回空对象。
 *
 * @param method - RPC 方法名（如 "health", "sessions.list"）
 * @param params - 请求参数
 * @returns 响应 payload
 */
export async function rpcCall<T = unknown>(
  method: string,
  params?: Record<string, unknown>
): Promise<T> {
  throw new Error(
    `[openclaw-prometheus] rpcCall("${method}") is not available in pure plugin mode. Use documented api.runtime.* helpers, hooks, events, or plugin-owned routes instead.`
  );
}

/**
 * 并行执行多个 RPC 调用
 * 失败的请求返回 null，不影响其他请求
 *
 * @param requests - 请求列表 [方法名, 参数?]
 * @returns 响应列表（与请求顺序对应）
 */
export async function rpcBatch(
  requests: Array<[string, Record<string, unknown>?]>
): Promise<Array<unknown | null>> {
  const results = await Promise.allSettled(
    requests.map(([method, params]) => rpcCall(method, params))
  );
  return results.map((r) => (r.status === "fulfilled" ? r.value : null));
}

/**
 * 读取当前 Gateway 配置
 */
export function getConfig(): Record<string, unknown> {
  return getRuntime().config;
}

/**
 * 检查 Runtime 是否可用
 */
export function isReady(): boolean {
  return _runtime !== null;
}
