/**
 * 验证 definePluginEntry 注册的路由与处理器可调用（不启动真实 Gateway）
 */

import { describe, it, expect, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import prometheusPlugin from "./index.js";

function mockGatewayCall(method: string): Promise<unknown> {
  if (method === "health") {
    return Promise.resolve({
      ok: true,
      uptimeSeconds: 1,
      agents: [],
      sessions: { count: 0 },
      channels: {},
      channelLabels: {},
    });
  }
  return Promise.resolve({});
}

describe("prometheusPlugin register", () => {
  it("registers three HTTP routes and /metrics returns prometheus text", async () => {
    const routes: Array<{ path: string; handler: (a: IncomingMessage, b: ServerResponse) => Promise<void> }> = [];

    const api = {
      id: "openclaw_prometheus",
      runtime: {
        gatewayCall: mockGatewayCall,
      },
      config: { gateway: { port: 18789 } },
      pluginConfig: {
        collectIntervalMs: 0,
        includeRuntime: false,
      },
      registerHttpRoute: (p: { path: string; handler: (a: IncomingMessage, b: ServerResponse) => Promise<void> }) => {
        routes.push(p);
      },
    };

    prometheusPlugin.register(api as never);

    expect(routes.map((r) => r.path)).toEqual(["/metrics", "/metrics/per-object", "/metrics/detailed"]);

    const metricsRoute = routes.find((r) => r.path === "/metrics")!;
    const chunks: string[] = [];
    const res = {
      writeHead: vi.fn(),
      end: (b: string) => {
        chunks.push(b);
      },
    } as unknown as ServerResponse;

    await metricsRoute.handler({ headers: {}, url: "/metrics" } as IncomingMessage, res);

    const body = chunks.join("");
    expect(body).toContain("# HELP openclaw_exporter_build_info");
    expect(body).toContain("openclaw_up");
  });
});
