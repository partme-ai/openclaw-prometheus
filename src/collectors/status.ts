import type { MetricCollector, MetricDefinition, MetricSample, StatusSummary } from "../types.js";
import { rpcCall } from "../ws-bridge.js";
import { CollectorError } from "../collector-error.js";

const PREFIX = "openclaw_gateway";

export class StatusCollector implements MetricCollector {
  name = "status";

  definitions: MetricDefinition[] = [
    { name: `${PREFIX}_status_info`, help: "Gateway status summary information (value is always 1)", type: "gauge", labels: ["runtime_version"] },
    { name: `${PREFIX}_link_channel_linked`, help: "Whether the link channel is currently linked (1=linked, 0=unlinked)", type: "gauge", labels: ["channel_id", "channel_label"] },
    { name: `${PREFIX}_link_channel_auth_age_seconds`, help: "Seconds since link channel auth was last refreshed", type: "gauge", labels: ["channel_id", "channel_label"] },
    { name: `${PREFIX}_queued_system_events_total`, help: "Number of queued system events", type: "gauge" },
    { name: `${PREFIX}_tasks_total`, help: "Total tasks in registry", type: "gauge" },
    { name: `${PREFIX}_tasks_active`, help: "Active tasks in registry", type: "gauge" },
    { name: `${PREFIX}_tasks_terminal`, help: "Terminal tasks in registry", type: "gauge" },
    { name: `${PREFIX}_tasks_failures`, help: "Task failures in registry", type: "gauge" },
    { name: `${PREFIX}_tasks_by_status_total`, help: "Task counts by status", type: "gauge", labels: ["status"] },
    { name: `${PREFIX}_tasks_by_runtime_total`, help: "Task counts by runtime", type: "gauge", labels: ["runtime"] },
    { name: `${PREFIX}_heartbeat_default_agent_info`, help: "Default heartbeat agent (value is always 1)", type: "gauge", labels: ["agent_id"] },
    { name: `${PREFIX}_heartbeat_agent_enabled`, help: "Whether heartbeat is enabled for agent (1=enabled, 0=disabled)", type: "gauge", labels: ["agent_id"] },
    { name: `${PREFIX}_heartbeat_agent_every_ms`, help: "Configured heartbeat interval for agent (ms)", type: "gauge", labels: ["agent_id"] },
  ];

  async collect(): Promise<MetricSample[]> {
    let status: StatusSummary;
    try {
      status = await rpcCall<StatusSummary>("status");
    } catch (err) {
      throw new CollectorError("status rpc failed", [], err);
    }

    const samples: MetricSample[] = [];
    samples.push({
      name: `${PREFIX}_status_info`,
      labels: { runtime_version: status.runtimeVersion ?? "unknown" },
      value: 1,
    });

    if (status.linkChannel) {
      const labels = {
        channel_id: status.linkChannel.id,
        channel_label: status.linkChannel.label,
      };
      samples.push({
        name: `${PREFIX}_link_channel_linked`,
        labels,
        value: status.linkChannel.linked ? 1 : 0,
      });
      if (typeof status.linkChannel.authAgeMs === "number" && Number.isFinite(status.linkChannel.authAgeMs)) {
        samples.push({
          name: `${PREFIX}_link_channel_auth_age_seconds`,
          labels,
          value: status.linkChannel.authAgeMs / 1000,
        });
      }
    }

    samples.push({
      name: `${PREFIX}_queued_system_events_total`,
      value: Array.isArray(status.queuedSystemEvents) ? status.queuedSystemEvents.length : 0,
    });

    samples.push({ name: `${PREFIX}_tasks_total`, value: status.tasks?.total ?? 0 });
    samples.push({ name: `${PREFIX}_tasks_active`, value: status.tasks?.active ?? 0 });
    samples.push({ name: `${PREFIX}_tasks_terminal`, value: status.tasks?.terminal ?? 0 });
    samples.push({ name: `${PREFIX}_tasks_failures`, value: status.tasks?.failures ?? 0 });

    if (status.tasks?.byStatus && typeof status.tasks.byStatus === "object") {
      for (const [k, v] of Object.entries(status.tasks.byStatus)) {
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        samples.push({
          name: `${PREFIX}_tasks_by_status_total`,
          labels: { status: k },
          value: v,
        });
      }
    }

    if (status.tasks?.byRuntime && typeof status.tasks.byRuntime === "object") {
      for (const [k, v] of Object.entries(status.tasks.byRuntime)) {
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        samples.push({
          name: `${PREFIX}_tasks_by_runtime_total`,
          labels: { runtime: k },
          value: v,
        });
      }
    }

    const defaultAgentId = status.heartbeat?.defaultAgentId;
    if (typeof defaultAgentId === "string" && defaultAgentId) {
      samples.push({
        name: `${PREFIX}_heartbeat_default_agent_info`,
        labels: { agent_id: defaultAgentId },
        value: 1,
      });
    }

    const hbAgents = Array.isArray(status.heartbeat?.agents) ? status.heartbeat.agents : [];
    for (const hb of hbAgents) {
      if (!hb || typeof hb !== "object") continue;
      if (typeof hb.agentId !== "string" || !hb.agentId) continue;
      samples.push({
        name: `${PREFIX}_heartbeat_agent_enabled`,
        labels: { agent_id: hb.agentId },
        value: hb.enabled ? 1 : 0,
      });
      if (typeof hb.everyMs === "number" && Number.isFinite(hb.everyMs)) {
        samples.push({
          name: `${PREFIX}_heartbeat_agent_every_ms`,
          labels: { agent_id: hb.agentId },
          value: hb.everyMs,
        });
      }
    }

    return samples;
  }
}

