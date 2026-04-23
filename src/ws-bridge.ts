/**
 * Gateway Runtime 桥接层
 *
 * 与 openclaw_management 使用相同的 Runtime 内部调用模式，
 * 通过 runtime.gatewayCall / runtime.invoke / 属性遍历
 * 执行 Gateway RPC 方法调用。
 *
 * 只调用 Gateway 已确认暴露的 RPC 方法：
 * - health / status
 * - channels.status
 * - sessions.list
 * - agents.list / models.list / node.list
 * - cron.status / cron.list
 * - system-presence
 * - usage.status / usage.cost
 * - skills.status / skills.bins
 */

import type { GatewayRuntime } from "./types.js";

/** 缓存的 Gateway Runtime 引用 */
let _runtime: GatewayRuntime | null = null;
let _rpcClientInitialized = false;
let _lastRpcSuccessAt: number | null = null;
let _lastRpcMethod: string | null = null;
let _lastRpcError: string | null = null;

/**
 * 设置 Gateway Runtime 引用
 * 在插件 register() 时调用
 *
 * @param runtime - Gateway 注入的运行时
 */
export function setRuntime(runtime: GatewayRuntime): void {
  _runtime = runtime;
  _rpcClientInitialized = true;
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
  const runtime = getRuntime();
  const runtimeAny = runtime as unknown as Record<string, unknown>;

  // 策略 1: gatewayCall（首选）
  if (typeof runtimeAny.gatewayCall === "function") {
    try {
      const payload = await (runtimeAny.gatewayCall as (
        m: string,
        p?: Record<string, unknown>
      ) => Promise<T>)(method, params);
      _lastRpcSuccessAt = Date.now();
      _lastRpcMethod = method;
      _lastRpcError = null;
      return payload;
    } catch (err) {
      _lastRpcMethod = method;
      _lastRpcError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  // 策略 2: invoke（通用接口）
  if (typeof runtimeAny.invoke === "function") {
    try {
      const payload = await (runtimeAny.invoke as (
        m: string,
        p?: Record<string, unknown>
      ) => Promise<T>)(method, params);
      _lastRpcSuccessAt = Date.now();
      _lastRpcMethod = method;
      _lastRpcError = null;
      return payload;
    } catch (err) {
      _lastRpcMethod = method;
      _lastRpcError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  // 策略 3: 属性遍历（"agents.list" → runtime.agents.list()）
  const parts = method.split(".");
  let target: unknown = runtime;
  for (const part of parts.slice(0, -1)) {
    target = (target as Record<string, unknown>)?.[part];
    if (!target) break;
  }
  const funcName = parts[parts.length - 1];
  if (target && typeof (target as Record<string, unknown>)[funcName] === "function") {
    try {
      const payload = await (target as Record<string, (...args: unknown[]) => Promise<T>>)[
        funcName
      ](params);
      _lastRpcSuccessAt = Date.now();
      _lastRpcMethod = method;
      _lastRpcError = null;
      return payload;
    } catch (err) {
      _lastRpcMethod = method;
      _lastRpcError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  _lastRpcMethod = method;
  _lastRpcError = "no runtime call strategy available";
  throw new Error(`[openclaw-prometheus] rpcCall("${method}") unavailable: no runtime call strategy`);
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

export function getRpcStatus(): {
  initialized: boolean;
  lastSuccessAt: number | null;
  lastMethod: string | null;
  lastError: string | null;
} {
  return {
    initialized: _rpcClientInitialized,
    lastSuccessAt: _lastRpcSuccessAt,
    lastMethod: _lastRpcMethod,
    lastError: _lastRpcError,
  };
}
