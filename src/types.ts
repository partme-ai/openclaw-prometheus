/**
 * openclaw_prometheus 类型定义
 * Prometheus 指标导出插件的数据结构
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/** OpenClaw 插件 API 接口 */
export interface PluginApi {
  /** Gateway 运行时 */
  runtime: GatewayRuntime;
  /** 注册 HTTP 路由 */
  registerHttpRoute(route: HttpRouteDefinition): void;
  /** 插件就绪回调 */
  onReady(callback: () => Promise<void>): void;
  /** 注册后台服务 */
  registerService?(service: ServiceDefinition): void;
}

/** HTTP 路由定义 */
export interface HttpRouteDefinition {
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
}

/** Gateway 运行时 */
export interface GatewayRuntime {
  /** 当前配置 */
  config: Record<string, unknown>;
  /** Gateway 调用 */
  gatewayCall?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  /** 通用调用 */
  invoke?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
}

/** 后台服务定义 */
export interface ServiceDefinition {
  name: string;
  start: () => Promise<void>;
  stop?: () => Promise<void>;
}

/** Prometheus 指标类型 */
export type MetricType = "gauge" | "counter" | "histogram" | "summary";

/** 单个指标定义 */
export interface MetricDefinition {
  /** 指标名称 */
  name: string;
  /** 帮助说明 */
  help: string;
  /** 指标类型 */
  type: MetricType;
  /** 标签键列表 */
  labels?: string[];
}

/** 指标数据点 */
export interface MetricSample {
  /** 指标名称 */
  name: string;
  /** 标签 */
  labels?: Record<string, string>;
  /** 数值 */
  value: number;
  /** 时间戳（ms） */
  timestamp?: number;
}

/** 采集器接口 */
export interface MetricCollector {
  /** 采集器名称 */
  name: string;
  /** 指标定义列表 */
  definitions: MetricDefinition[];
  /** 执行采集 */
  collect(): Promise<MetricSample[]>;
}
