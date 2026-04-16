import { describe, it, expect } from "vitest";
import { resolvePrometheusConfig, scrapeTokenEnvName } from "./plugin-config.js";

describe("resolvePrometheusConfig", () => {
  it("uses defaults when raw is empty", () => {
    const c = resolvePrometheusConfig(undefined);
    expect(c.metricsPath).toBe("/metrics");
    expect(c.collectIntervalMs).toBe(15000);
    expect(c.includeRuntime).toBe(true);
    expect(c.scrapeAuthEnabled).toBe(false);
  });

  it("respects custom path and interval", () => {
    const c = resolvePrometheusConfig({
      path: "/openclaw/metrics",
      collectIntervalMs: 5000,
      includeRuntime: false,
    });
    expect(c.metricsPath).toBe("/openclaw/metrics");
    expect(c.collectIntervalMs).toBe(5000);
    expect(c.includeRuntime).toBe(false);
  });

  it("reads bearer token from env when scrapeAuth enabled", () => {
    const c = resolvePrometheusConfig(
      { scrapeAuth: { enabled: true } },
      { openclaw-prometheus_BEARER_TOKEN: "abc" } as NodeJS.ProcessEnv,
    );
    expect(c.scrapeAuthEnabled).toBe(true);
    expect(c.scrapeBearerToken).toBe("abc");
  });

  it("exposes env name helper", () => {
    expect(scrapeTokenEnvName()).toBe("openclaw-prometheus_BEARER_TOKEN");
  });
});
