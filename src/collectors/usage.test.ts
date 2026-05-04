import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcCallMock = vi.fn();

vi.mock("../ws-bridge.js", () => ({
  rpcCall: (method: string, params?: unknown) => rpcCallMock(method, params),
}));

describe("UsageCollector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T00:00:00.000Z"));
    rpcCallMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("对 sessions.usage 使用长 TTL，避免每轮 scrape 都触发重聚合", async () => {
    rpcCallMock.mockImplementation(async (method: string) => {
      if (method === "usage.cost") {
        return {
          totals: {
            input: 11,
            output: 7,
            totalTokens: 18,
            totalCost: 0.01,
          },
          daily: [],
        };
      }
      if (method === "sessions.usage") {
        return {
          totals: {
            input: 11,
            output: 7,
            totalTokens: 18,
            totalCost: 0.01,
          },
          aggregates: {
            messages: { total: 2, user: 1, assistant: 1 },
            tools: { totalCalls: 0, uniqueTools: 0, tools: [] },
            byProvider: [],
            byModel: [],
            byAgent: [],
            byChannel: [],
            daily: [],
            dailyLatency: [],
            modelDaily: [],
            latency: { count: 1, avgMs: 100, p95Ms: 100, minMs: 100, maxMs: 100 },
          },
        };
      }
      throw new Error(`unexpected rpc method: ${method}`);
    });

    const { UsageCollector } = await import("./usage.js");
    const collector = new UsageCollector();

    await collector.collect();
    vi.setSystemTime(new Date("2026-05-04T00:00:20.000Z"));
    await collector.collect();
    vi.setSystemTime(new Date("2026-05-04T00:02:10.000Z"));
    await collector.collect();

    expect(rpcCallMock.mock.calls.filter(([method]) => method === "usage.cost")).toHaveLength(3);
    expect(rpcCallMock.mock.calls.filter(([method]) => method === "sessions.usage")).toHaveLength(2);
  });

  it("在 sessions.usage 刷新失败时回退到最近一次成功值", async () => {
    let sessionsUsageCalls = 0;
    rpcCallMock.mockImplementation(async (method: string) => {
      if (method === "usage.cost") {
        return {
          totals: {
            input: 3,
            output: 2,
            totalTokens: 5,
            totalCost: 0.001,
          },
          daily: [],
        };
      }
      if (method === "sessions.usage") {
        sessionsUsageCalls += 1;
        if (sessionsUsageCalls === 1) {
          return {
            totals: {
              input: 3,
              output: 2,
              totalTokens: 5,
              totalCost: 0.001,
            },
            aggregates: {
              messages: { total: 4, user: 2, assistant: 2 },
              tools: { totalCalls: 0, uniqueTools: 0, tools: [] },
              byProvider: [],
              byModel: [],
              byAgent: [],
              byChannel: [],
              daily: [],
              dailyLatency: [],
              modelDaily: [],
              latency: { count: 1, avgMs: 200, p95Ms: 200, minMs: 200, maxMs: 200 },
            },
          };
        }
        throw new Error("sessions.usage timeout");
      }
      throw new Error(`unexpected rpc method: ${method}`);
    });

    const { UsageCollector } = await import("./usage.js");
    const collector = new UsageCollector();

    const first = await collector.collect();
    vi.setSystemTime(new Date("2026-05-04T00:02:10.000Z"));
    const second = await collector.collect();

    const firstMessages = first.find((sample) => sample.name === "openclaw_usage_messages_total");
    const secondMessages = second.find((sample) => sample.name === "openclaw_usage_messages_total");

    expect(firstMessages?.value).toBe(4);
    expect(secondMessages?.value).toBe(4);
    expect(sessionsUsageCalls).toBe(2);
  });
});
