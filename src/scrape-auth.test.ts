import { describe, it, expect, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { assertScrapeAuthorized } from "./scrape-auth.js";
import type { ResolvedPrometheusConfig } from "./plugin-config.js";

function mockRes(): ServerResponse {
  const writeHead = vi.fn();
  const end = vi.fn();
  return { writeHead, end } as unknown as ServerResponse;
}

describe("assertScrapeAuthorized", () => {
  it("allows when auth disabled", () => {
    const cfg: ResolvedPrometheusConfig = {
      port: 9090,
      metricsPath: "/metrics",
      collectIntervalMs: 0,
      snapshotIntervalMs: 30000,
      workloadWindowMs: 300000,
      includeRuntime: true,
      monitoredProviders: [],
      scrapeAuthEnabled: false,
      scrapeBearerToken: undefined,
    };
    const req = { headers: {} } as IncomingMessage;
    const res = mockRes();
    expect(assertScrapeAuthorized(req, res, cfg)).toBe(true);
  });

  it("503 when enabled but no token", () => {
    const cfg: ResolvedPrometheusConfig = {
      port: 9090,
      metricsPath: "/metrics",
      collectIntervalMs: 0,
      snapshotIntervalMs: 30000,
      workloadWindowMs: 300000,
      includeRuntime: true,
      monitoredProviders: [],
      scrapeAuthEnabled: true,
      scrapeBearerToken: undefined,
    };
    const req = { headers: {} } as IncomingMessage;
    const res = mockRes();
    expect(assertScrapeAuthorized(req, res, cfg)).toBe(false);
    expect(res.writeHead).toHaveBeenCalledWith(503, expect.any(Object));
  });

  it("401 when token mismatch", () => {
    const cfg: ResolvedPrometheusConfig = {
      port: 9090,
      metricsPath: "/metrics",
      collectIntervalMs: 0,
      snapshotIntervalMs: 30000,
      workloadWindowMs: 300000,
      includeRuntime: true,
      monitoredProviders: [],
      scrapeAuthEnabled: true,
      scrapeBearerToken: "secret",
    };
    const req = { headers: { authorization: "Bearer wrong" } } as IncomingMessage;
    const res = mockRes();
    expect(assertScrapeAuthorized(req, res, cfg)).toBe(false);
    expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
  });

  it("allows matching bearer", () => {
    const cfg: ResolvedPrometheusConfig = {
      port: 9090,
      metricsPath: "/metrics",
      collectIntervalMs: 0,
      snapshotIntervalMs: 30000,
      workloadWindowMs: 300000,
      includeRuntime: true,
      monitoredProviders: [],
      scrapeAuthEnabled: true,
      scrapeBearerToken: "ok",
    };
    const req = { headers: { authorization: "Bearer ok" } } as IncomingMessage;
    const res = mockRes();
    expect(assertScrapeAuthorized(req, res, cfg)).toBe(true);
  });
});
