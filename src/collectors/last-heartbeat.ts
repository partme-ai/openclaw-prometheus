import type {
  HeartbeatEventPayload,
  MetricCollector,
  MetricDefinition,
  MetricSample,
} from "../types.js";
import { rpcCall } from "../ws-bridge.js";
import { CollectorError } from "../collector-error.js";

const PREFIX = "openclaw_gateway";

export class LastHeartbeatCollector implements MetricCollector {
  name = "last-heartbeat";

  definitions: MetricDefinition[] = [
    { name: `${PREFIX}_last_heartbeat_present`, help: "Whether a heartbeat event exists (1=yes, 0=no)", type: "gauge" },
    { name: `${PREFIX}_last_heartbeat_timestamp_seconds`, help: "Unix timestamp (seconds) of last heartbeat event", type: "gauge" },
    { name: `${PREFIX}_last_heartbeat_age_seconds`, help: "Seconds since last heartbeat event", type: "gauge" },
    { name: `${PREFIX}_last_heartbeat_duration_ms`, help: "Duration (ms) of last heartbeat send attempt if available", type: "gauge" },
    { name: `${PREFIX}_last_heartbeat_status`, help: "Last heartbeat status (value is always 1)", type: "gauge", labels: ["status"] },
    { name: `${PREFIX}_last_heartbeat_indicator`, help: "Last heartbeat indicator type (value is always 1)", type: "gauge", labels: ["indicator"] },
    { name: `${PREFIX}_last_heartbeat_channel_info`, help: "Channel for last heartbeat (value is always 1)", type: "gauge", labels: ["channel"] },
    { name: `${PREFIX}_last_heartbeat_silent`, help: "Whether last heartbeat message was silent (1=yes, 0=no)", type: "gauge" },
    { name: `${PREFIX}_last_heartbeat_has_media`, help: "Whether last heartbeat message had media (1=yes, 0=no)", type: "gauge" },
  ];

  async collect(): Promise<MetricSample[]> {
    let last: HeartbeatEventPayload | null;
    try {
      last = await rpcCall<HeartbeatEventPayload | null>("last-heartbeat");
    } catch (err) {
      throw new CollectorError("last-heartbeat rpc failed", [], err);
    }

    const samples: MetricSample[] = [];
    if (!last) {
      samples.push({ name: `${PREFIX}_last_heartbeat_present`, value: 0 });
      samples.push({ name: `${PREFIX}_last_heartbeat_timestamp_seconds`, value: 0 });
      samples.push({ name: `${PREFIX}_last_heartbeat_age_seconds`, value: 0 });
      samples.push({ name: `${PREFIX}_last_heartbeat_duration_ms`, value: 0 });
      samples.push({ name: `${PREFIX}_last_heartbeat_silent`, value: 0 });
      samples.push({ name: `${PREFIX}_last_heartbeat_has_media`, value: 0 });
      return samples;
    }

    const now = Date.now();
    samples.push({ name: `${PREFIX}_last_heartbeat_present`, value: 1 });
    samples.push({
      name: `${PREFIX}_last_heartbeat_timestamp_seconds`,
      value: Math.floor(last.ts / 1000),
    });
    samples.push({
      name: `${PREFIX}_last_heartbeat_age_seconds`,
      value: (now - last.ts) / 1000,
    });
    samples.push({
      name: `${PREFIX}_last_heartbeat_duration_ms`,
      value: typeof last.durationMs === "number" && Number.isFinite(last.durationMs) ? last.durationMs : 0,
    });

    samples.push({
      name: `${PREFIX}_last_heartbeat_status`,
      labels: { status: last.status },
      value: 1,
    });

    samples.push({
      name: `${PREFIX}_last_heartbeat_indicator`,
      labels: { indicator: last.indicatorType ?? "unknown" },
      value: 1,
    });

    samples.push({
      name: `${PREFIX}_last_heartbeat_channel_info`,
      labels: { channel: last.channel ?? "unknown" },
      value: 1,
    });

    samples.push({ name: `${PREFIX}_last_heartbeat_silent`, value: last.silent ? 1 : 0 });
    samples.push({ name: `${PREFIX}_last_heartbeat_has_media`, value: last.hasMedia ? 1 : 0 });

    return samples;
  }
}

