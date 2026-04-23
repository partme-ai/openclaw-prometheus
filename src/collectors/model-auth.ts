import type {
  MetricCollector,
  MetricDefinition,
  MetricSample,
  ModelAuthStatusResult,
} from "../types.js";
import { rpcCall } from "../ws-bridge.js";

const PREFIX = "openclaw_model_auth";

export class ModelAuthCollector implements MetricCollector {
  name = "model-auth";

  definitions: MetricDefinition[] = [
    { name: `${PREFIX}_providers_total`, help: "Number of auth providers reported by models.authStatus", type: "gauge" },
    { name: `${PREFIX}_providers_by_status`, help: "Providers grouped by auth status", type: "gauge", labels: ["status"] },
    { name: `${PREFIX}_provider_status`, help: "Provider auth status (one-hot by provider+status)", type: "gauge", labels: ["provider", "status"] },
    { name: `${PREFIX}_provider_expires_at_seconds`, help: "Provider credential expiry timestamp (seconds since epoch), if present", type: "gauge", labels: ["provider"] },
    { name: `${PREFIX}_provider_remaining_seconds`, help: "Provider credential remaining seconds, if present", type: "gauge", labels: ["provider"] },
  ];

  async collect(): Promise<MetricSample[]> {
    const payload = await rpcCall<ModelAuthStatusResult>("models.authStatus", { refresh: true });
    const providers = Array.isArray(payload?.providers) ? payload.providers : [];

    const samples: MetricSample[] = [];
    samples.push({ name: `${PREFIX}_providers_total`, value: providers.length });

    const byStatus: Record<string, number> = {};
    for (const p of providers) {
      const provider = sanitizeProvider(p.provider);
      const status = sanitizeStatus(p.status);
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      samples.push({
        name: `${PREFIX}_provider_status`,
        labels: { provider, status },
        value: 1,
      });

      const expiryAt = p.expiry?.at;
      if (typeof expiryAt === "number" && Number.isFinite(expiryAt) && expiryAt > 0) {
        samples.push({
          name: `${PREFIX}_provider_expires_at_seconds`,
          labels: { provider },
          value: Math.floor(expiryAt / 1000),
        });
      }
      const remainingMs = p.expiry?.remainingMs;
      if (typeof remainingMs === "number" && Number.isFinite(remainingMs)) {
        samples.push({
          name: `${PREFIX}_provider_remaining_seconds`,
          labels: { provider },
          value: Math.floor(remainingMs / 1000),
        });
      }
    }

    for (const [status, count] of Object.entries(byStatus)) {
      samples.push({
        name: `${PREFIX}_providers_by_status`,
        labels: { status },
        value: count,
      });
    }

    return samples;
  }
}

function sanitizeProvider(raw: unknown): string {
  const s = String(raw ?? "").trim() || "unknown";
  return s.replace(/["\\\n]/g, "_").slice(0, 128);
}

function sanitizeStatus(raw: unknown): string {
  const s = String(raw ?? "").trim() || "unknown";
  return s.replace(/["\\\n]/g, "_").slice(0, 64);
}

