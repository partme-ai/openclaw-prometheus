/**
 * 验证 definePluginEntry 注册的路由与处理器可调用（不启动真实 Gateway）
 */

import { describe, it, expect, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import prometheusPlugin from "./index.js";

describe("prometheusPlugin register", () => {
  it("registers plugin-owned routes and exports hook/runtime metrics", async () => {
    const routes: Array<{
      path: string;
      auth: string;
      handler: (a: IncomingMessage, b: ServerResponse) => Promise<void>;
    }> = [];
    const hookHandlers = new Map<string, Array<(event: any, ctx: any) => Promise<void> | void>>();
    const agentEventListeners: Array<(event: any) => void> = [];
    const transcriptListeners: Array<(event: any) => void> = [];
    const gatewayMethods: string[] = [];

    const api = {
      id: "openclaw-prometheus",
      name: "openclaw-prometheus",
      runtime: {
        events: {
          onAgentEvent: (listener: (event: any) => void) => {
            agentEventListeners.push(listener);
            return () => undefined;
          },
          onSessionTranscriptUpdate: (listener: (event: any) => void) => {
            transcriptListeners.push(listener);
            return () => undefined;
          },
        },
        state: {
          resolveStateDir: () => "/tmp/openclaw-state",
        },
        channel: {
          activity: {
            get: () => ({ inboundAt: Date.now() - 5000, outboundAt: Date.now() - 2000 }),
          },
        },
        modelAuth: {
          resolveApiKeyForProvider: async ({ provider }: { provider: string }) => ({
            apiKey: provider === "openai" ? "sk-test" : undefined,
            source: provider === "openai" ? "env" : "missing",
            mode: provider === "openai" ? "api-key" : "api-key",
          }),
        },
      },
      config: { gateway: { port: 18789 } },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      pluginConfig: {
        collectIntervalMs: 0,
        includeRuntime: false,
        monitoredProviders: ["openai", "anthropic"],
      },
      registerHttpRoute: (p: {
        path: string;
        auth: string;
        handler: (a: IncomingMessage, b: ServerResponse) => Promise<void>;
      }) => {
        routes.push(p);
      },
      registerService: vi.fn(),
      on: (hookName: string, handler: (event: any, ctx: any) => Promise<void> | void) => {
        const existing = hookHandlers.get(hookName) ?? [];
        existing.push(handler);
        hookHandlers.set(hookName, existing);
      },
      registerGatewayMethod: (method: string) => {
        gatewayMethods.push(method);
      },
    };

    prometheusPlugin.register(api as never);

    expect(routes.map((r) => r.path)).toEqual([
      "/metrics",
      "/metrics/per-object",
      "/metrics/detailed",
      "/metrics/health",
    ]);
    expect(routes.every((r) => r.auth === "plugin")).toBe(true);
    expect(gatewayMethods).toContain("openclaw.prometheus.status");

    for (const handler of hookHandlers.get("message_received") ?? []) {
      await handler({ from: "u1", content: "hello" }, { channelId: "discord", accountId: "acc-1" });
    }
    for (const handler of hookHandlers.get("before_tool_call") ?? []) {
      await handler({ toolName: "web_search", params: {} }, { toolName: "web_search" });
    }
    for (const handler of hookHandlers.get("after_tool_call") ?? []) {
      await handler(
        { toolName: "web_search", params: {}, durationMs: 120, error: undefined },
        { toolName: "web_search" },
      );
    }
    for (const handler of hookHandlers.get("before_agent_start") ?? []) {
      await handler({}, { agentId: "agent-main", channelId: "discord" });
    }
    for (const handler of hookHandlers.get("llm_output") ?? []) {
      await handler(
        {
          provider: "openai",
          model: "gpt-5",
          usage: { input: 10, output: 5, total: 15 },
        },
        { agentId: "agent-main" },
      );
    }
    for (const handler of hookHandlers.get("agent_end") ?? []) {
      await handler({ success: true, durationMs: 800, messages: [] }, { agentId: "agent-main" });
    }

    agentEventListeners.forEach((listener) =>
      listener({
        runId: "run-1",
        seq: 1,
        stream: "item",
        ts: Date.now(),
        data: { kind: "tool", phase: "end", status: "completed" },
      }),
    );
    transcriptListeners.forEach((listener) =>
      listener({
        sessionFile: "/tmp/session.json",
        sessionKey: "s-1",
      }),
    );

    const metricsRoute = routes.find((r) => r.path === "/metrics")!;
    const chunks: string[] = [];
    const res = {
      writeHead: vi.fn(),
      statusCode: 200,
      end: (b: string) => {
        chunks.push(b);
      },
    } as unknown as ServerResponse;

    await metricsRoute.handler({ headers: {}, url: "/metrics" } as IncomingMessage, res);

    const body = chunks.join("");
    expect(body).toContain("# HELP openclaw_exporter_build_info");
    expect(body).toContain("openclaw_up");
    expect(body).toContain("openclaw_model_auth_provider_status{provider=\"openai\",status=\"ok\"} 1");
    expect(body).toContain("openclaw_messages_received_total{channel=\"discord\"} 1");
    expect(body).toContain("openclaw_tool_calls_total{tool=\"web_search\"} 1");
    expect(body).toContain("openclaw_agent_events_total{stream=\"item\"} 1");
  });
});
