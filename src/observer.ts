import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import { getRuntimeStore, listObservedChannelAccounts, rememberObservedChannelAccount, setSnapshotState } from "./runtime-store.js";

const PROVIDER_STATUSES = ["ok", "missing", "error"] as const;

export function registerPluginObservers(api: OpenClawPluginApi): void {
  registerLifecycleHooks(api);
  registerMessageHooks(api);
  registerToolHooks(api);
  registerAgentHooks(api);
  registerRuntimeEventListeners(api);
}

function registerLifecycleHooks(api: OpenClawPluginApi): void {
  api.on("gateway_start", () => {
    const { registry } = getRuntimeStore();
    registry.set("openclaw_ready", 1, {
      help: "Whether the plugin observed gateway_start and considers the exporter ready",
    });
  });

  api.on("gateway_stop", () => {
    const { registry } = getRuntimeStore();
    registry.set("openclaw_ready", 0, {
      help: "Whether the plugin observed gateway_start and considers the exporter ready",
    });
  });

  api.on("session_start", (_event, ctx) => {
    const { registry } = getRuntimeStore();
    registry.inc("openclaw_sessions_started_total", 1, {
      help: "Session starts observed through plugin hooks",
      type: "counter",
    });
    if (ctx.sessionKey) {
      registry.inc("openclaw_sessions_active_estimated", 1, {
        help: "Estimated active sessions observed by the plugin",
      });
    }
  });

  api.on("session_end", (event) => {
    const { registry } = getRuntimeStore();
    registry.inc("openclaw_sessions_ended_total", 1, {
      help: "Session ends observed through plugin hooks",
      type: "counter",
      labels: { reason: event.reason ?? "unknown" },
    });
    registry.dec("openclaw_sessions_active_estimated", 1, {
      help: "Estimated active sessions observed by the plugin",
    });
  });
}

function registerMessageHooks(api: OpenClawPluginApi): void {
  api.on("message_received", (_event, ctx) => {
    const { registry } = getRuntimeStore();
    const channelId = stringOr(ctx.channelId, "unknown");
    const accountId = optionalString(ctx.accountId);
    rememberObservedChannelAccount(channelId, accountId);
    registry.inc("openclaw_messages_received_total", 1, {
      help: "Inbound messages observed through plugin hooks",
      type: "counter",
      labels: { channel: channelId },
    });
    registry.set("openclaw_channel_last_event_timestamp_seconds", Date.now() / 1000, {
      help: "Last observed event timestamp by channel/account",
      labels: {
        channel: channelId,
        account: accountId ?? "default",
      },
    });
  });

  api.on("message_sent", (event, ctx) => {
    const { registry } = getRuntimeStore();
    const channelId = stringOr(ctx.channelId, "unknown");
    const accountId = optionalString(ctx.accountId);
    rememberObservedChannelAccount(channelId, accountId);
    registry.inc("openclaw_messages_sent_total", 1, {
      help: "Outbound messages observed through plugin hooks",
      type: "counter",
      labels: {
        channel: channelId,
        result: event.success ? "ok" : "error",
      },
    });
    if (!event.success) {
      registry.inc("openclaw_channel_failures_total", 1, {
        help: "Channel send failures observed through plugin hooks",
        type: "counter",
        labels: {
          channel: channelId,
          reason: event.error ? "send-error" : "unknown",
        },
      });
    }
  });
}

function registerToolHooks(api: OpenClawPluginApi): void {
  api.on("before_tool_call", (event) => {
    const { registry } = getRuntimeStore();
    registry.inc("openclaw_tool_calls_total", 1, {
      help: "Tool calls observed through plugin hooks",
      type: "counter",
      labels: { tool: event.toolName },
    });
    registry.inc("openclaw_inflight_operations", 1, {
      help: "Estimated in-flight operations tracked by the plugin",
      labels: { kind: "tool" },
    });
  });

  api.on("after_tool_call", (event) => {
    const { registry } = getRuntimeStore();
    registry.dec("openclaw_inflight_operations", 1, {
      help: "Estimated in-flight operations tracked by the plugin",
      labels: { kind: "tool" },
    });
    if (event.error) {
      registry.inc("openclaw_tool_call_failures_total", 1, {
        help: "Tool call failures observed through plugin hooks",
        type: "counter",
        labels: { tool: event.toolName },
      });
    }
    if (typeof event.durationMs === "number") {
      registry.observeSummary("openclaw_tool_call_duration_seconds", event.durationMs / 1000, {
        help: "Observed tool call duration",
        labels: { tool: event.toolName },
      });
    }
  });
}

function registerAgentHooks(api: OpenClawPluginApi): void {
  api.on("before_agent_start", (_event, ctx) => {
    const { registry } = getRuntimeStore();
    const agentId = stringOr(ctx.agentId, "unknown");
    const channelId = stringOr(ctx.channelId, "unknown");
    registry.inc("openclaw_inflight_operations", 1, {
      help: "Estimated in-flight operations tracked by the plugin",
      labels: { kind: "agent" },
    });
    registry.inc("openclaw_agent_runs_started_total", 1, {
      help: "Agent runs observed through plugin hooks",
      type: "counter",
      labels: {
        agent_id: agentId,
        channel: channelId,
      },
    });
  });

  api.on("llm_output", (event) => {
    const { registry } = getRuntimeStore();
    const labels = {
      provider: event.provider,
      model: event.model,
    };
    registry.inc("openclaw_usage_tokens_input_total", event.usage?.input ?? 0, {
      help: "Input tokens observed through llm_output hooks",
      type: "counter",
      labels,
    });
    registry.inc("openclaw_usage_tokens_output_total", event.usage?.output ?? 0, {
      help: "Output tokens observed through llm_output hooks",
      type: "counter",
      labels,
    });
    registry.inc(
      "openclaw_usage_tokens_total",
      event.usage?.total ??
        (event.usage?.input ?? 0) +
          (event.usage?.output ?? 0) +
          (event.usage?.cacheRead ?? 0) +
          (event.usage?.cacheWrite ?? 0),
      {
        help: "Total tokens observed through llm_output hooks",
        type: "counter",
        labels,
      },
    );
  });

  api.on("agent_end", (event, ctx) => {
    const { registry } = getRuntimeStore();
    const agentId = stringOr(ctx.agentId, "unknown");
    registry.dec("openclaw_inflight_operations", 1, {
      help: "Estimated in-flight operations tracked by the plugin",
      labels: { kind: "agent" },
    });
    registry.inc("openclaw_agent_runs_total", 1, {
      help: "Agent runs observed through plugin hooks",
      type: "counter",
      labels: {
        agent_id: agentId,
        result: event.success ? "ok" : "error",
      },
    });
    if (typeof event.durationMs === "number") {
      registry.observeSummary("openclaw_agent_run_duration_seconds", event.durationMs / 1000, {
        help: "Observed agent run duration",
        labels: {
          agent_id: agentId,
          result: event.success ? "ok" : "error",
        },
      });
    }
  });
}

function registerRuntimeEventListeners(api: OpenClawPluginApi): void {
  api.runtime.events?.onAgentEvent?.((event) => {
    const { registry } = getRuntimeStore();
    registry.inc("openclaw_agent_events_total", 1, {
      help: "Agent runtime events observed through api.runtime.events.onAgentEvent",
      type: "counter",
      labels: { stream: event.stream },
    });

    if (event.stream === "item") {
      const kind = typeof event.data.kind === "string" ? event.data.kind : "unknown";
      const phase = typeof event.data.phase === "string" ? event.data.phase : "unknown";
      const status = typeof event.data.status === "string" ? event.data.status : "unknown";
      registry.inc("openclaw_agent_item_events_total", 1, {
        help: "Agent item events grouped by kind/status/phase",
        type: "counter",
        labels: { kind, phase, status },
      });
    }
  });

  api.runtime.events?.onSessionTranscriptUpdate?.((update) => {
    const { registry } = getRuntimeStore();
    registry.inc("openclaw_session_transcript_updates_total", 1, {
      help: "Session transcript updates observed through api.runtime.events.onSessionTranscriptUpdate",
      type: "counter",
    });
    registry.set("openclaw_session_transcript_last_update_timestamp_seconds", Date.now() / 1000, {
      help: "Last transcript update timestamp observed by the plugin",
    });
    if (update.sessionKey) {
      registry.set("openclaw_session_transcript_last_seen_timestamp_seconds", Date.now() / 1000, {
        help: "Last transcript update timestamp by session key",
        labels: { scope: "aggregate" },
      });
    }
  });
}

export async function refreshRuntimeSnapshots(force = false): Promise<void> {
  const store = getRuntimeStore();
  const now = Date.now();
  if (
    !force &&
    typeof store.lastSnapshotRefreshAt === "number" &&
    now - store.lastSnapshotRefreshAt < store.cfg.snapshotIntervalMs
  ) {
    refreshChannelActivityGauges();
    return;
  }

  const providerSnapshots = await Promise.all(
    store.cfg.monitoredProviders.map(async (provider) => {
      try {
        const auth = await store.api.runtime.modelAuth?.resolveApiKeyForProvider?.({
          provider,
          cfg: store.api.config as Record<string, unknown>,
        });
        const status = auth?.apiKey || auth?.source ? "ok" : "missing";
        return {
          provider,
          status,
          source: auth?.source,
          mode: auth?.mode,
          checkedAt: now,
        } as const;
      } catch (error) {
        return {
          provider,
          status: "error",
          checkedAt: now,
          error: error instanceof Error ? error.message : String(error),
        } as const;
      }
    }),
  );

  setSnapshotState({
    refreshedAt: now,
    providerSnapshots: [...providerSnapshots],
  });

  const { registry } = store;
  registry.set("openclaw_runtime_snapshot_refresh_timestamp_seconds", now / 1000, {
    help: "Last successful runtime snapshot refresh timestamp",
  });
  registry.set("openclaw_runtime_snapshot_age_seconds", 0, {
    help: "Age of the last runtime snapshot refresh",
  });

  for (const snapshot of providerSnapshots) {
    registry.setOneHotStatus(
      "openclaw_model_auth_provider_status",
      snapshot.status,
      PROVIDER_STATUSES,
      {
        help: "Provider auth resolution status from api.runtime.modelAuth.resolveApiKeyForProvider",
        labels: { provider: snapshot.provider },
      },
    );
    if (snapshot.source || snapshot.mode) {
      registry.set("openclaw_model_auth_provider_info", 1, {
        help: "Provider auth source/mode info from the last successful runtime snapshot",
        labels: {
          provider: snapshot.provider,
          source: snapshot.source ?? "unknown",
          mode: snapshot.mode ?? "unknown",
        },
      });
    }
  }

  refreshChannelActivityGauges();
}

export function refreshHousekeepingMetrics(): void {
  const store = getRuntimeStore();
  const { registry } = store;
  registry.set("openclaw_up", 1, {
    help: "Whether the OpenClaw Prometheus plugin is loaded",
  });
  registry.set("openclaw_ready", 1, {
    help: "Whether the OpenClaw Prometheus plugin runtime is initialized",
  });
  registry.set("openclaw_plugin_uptime_seconds", (Date.now() - store.startedAt) / 1000, {
    help: "Plugin uptime in seconds",
  });

  const lastRefresh = store.lastSnapshotRefreshAt ?? store.startedAt;
  registry.set("openclaw_runtime_snapshot_age_seconds", Math.max(0, (Date.now() - lastRefresh) / 1000), {
    help: "Age of the last runtime snapshot refresh",
  });

  registry.set("openclaw_runtime_namespace_available", store.api.runtime.events ? 1 : 0, {
    help: "Whether a runtime namespace is available",
    labels: { namespace: "events" },
  });
  registry.set("openclaw_runtime_namespace_available", store.api.runtime.modelAuth ? 1 : 0, {
    help: "Whether a runtime namespace is available",
    labels: { namespace: "modelAuth" },
  });
  registry.set("openclaw_runtime_namespace_available", store.api.runtime.channel ? 1 : 0, {
    help: "Whether a runtime namespace is available",
    labels: { namespace: "channel" },
  });
  registry.set("openclaw_runtime_namespace_available", store.api.runtime.state ? 1 : 0, {
    help: "Whether a runtime namespace is available",
    labels: { namespace: "state" },
  });

  const stateDir = store.api.runtime.state?.resolveStateDir?.();
  registry.set("openclaw_runtime_state_dir_configured", stateDir ? 1 : 0, {
    help: "Whether api.runtime.state.resolveStateDir returned a value",
  });
}

function refreshChannelActivityGauges(): void {
  const store = getRuntimeStore();
  const getActivity = store.api.runtime.channel?.activity?.get;
  if (typeof getActivity !== "function") {
    return;
  }
  const nowSeconds = Date.now() / 1000;
  for (const observed of listObservedChannelAccounts()) {
    const activity = getActivity({
      channel: observed.channelId,
      ...(observed.accountId ? { accountId: observed.accountId } : {}),
    });
    const labels = {
      channel: observed.channelId,
      account: observed.accountId ?? "default",
    };
    if (typeof activity.inboundAt === "number") {
      store.registry.set("openclaw_channel_last_inbound_age_seconds", Math.max(0, nowSeconds - activity.inboundAt / 1000), {
        help: "Age of the last inbound activity seen for a channel/account",
        labels,
      });
    }
    if (typeof activity.outboundAt === "number") {
      store.registry.set("openclaw_channel_last_outbound_age_seconds", Math.max(0, nowSeconds - activity.outboundAt / 1000), {
        help: "Age of the last outbound activity seen for a channel/account",
        labels,
      });
    }
  }
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stringOr(value: unknown, fallback: string): string {
  return optionalString(value) ?? fallback;
}
