import { onDiagnosticEvent } from "openclaw/plugin-sdk";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { MetricSample } from "./types.js";
import { getRuntimeStore, listObservedChannelAccounts, rememberObservedChannelAccount, setSnapshotState } from "./runtime-store.js";

const PROVIDER_STATUSES = ["ok", "missing", "error"] as const;

// ─────────── HTTP 延迟环形缓冲区（用于计算 P95/P99） ───────────
const HTTP_LATENCY_SAMPLES: number[] = [];
const HTTP_LATENCY_MAX_SAMPLES = 1000;
let stopDiagnosticSubscription: (() => void) | null = null;

type DiagnosticEventPayload =
  | {
      type: "model.usage";
      sessionKey?: string;
      sessionId?: string;
      channel?: string;
      provider?: string;
      model?: string;
      usage?: {
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
        promptTokens?: number;
        total?: number;
      };
      lastCallUsage?: {
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
        total?: number;
      };
      context?: {
        limit?: number;
        used?: number;
      };
      costUsd?: number;
      durationMs?: number;
    }
  | {
      type: "webhook.received";
      channel?: string;
      updateType?: string;
    }
  | {
      type: "webhook.processed";
      channel?: string;
      updateType?: string;
      durationMs?: number;
    }
  | {
      type: "webhook.error";
      channel?: string;
      updateType?: string;
    }
  | {
      type: "message.queued";
      channel?: string;
      source?: string;
      queueDepth?: number;
    }
  | {
      type: "message.processed";
      channel?: string;
      outcome?: "completed" | "skipped" | "error";
      durationMs?: number;
    }
  | {
      type: "session.state";
      state?: "idle" | "processing" | "waiting";
      prevState?: "idle" | "processing" | "waiting";
      queueDepth?: number;
    }
  | {
      type: "session.stuck";
      state?: "idle" | "processing" | "waiting";
      ageMs: number;
      queueDepth?: number;
    }
  | {
      type: "queue.lane.enqueue";
      lane?: string;
      queueSize?: number;
    }
  | {
      type: "queue.lane.dequeue";
      lane?: string;
      queueSize?: number;
      waitMs?: number;
    }
  | {
      type: "diagnostic.heartbeat";
      active?: number;
      waiting?: number;
      queued?: number;
      webhooks?: {
        received?: number;
        processed?: number;
        errors?: number;
      };
    }
  | {
      type: "tool.loop";
      toolName?: string;
      detector?: string;
      action?: string;
      level?: string;
      count?: number;
      pairedToolName?: string;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

export function registerPluginObservers(api: OpenClawPluginApi): void {
  registerLifecycleHooks(api);
  registerMessageHooks(api);
  registerToolHooks(api);
  registerAgentHooks(api);
  registerRuntimeEventListeners(api);
  registerDiagnosticEventBridge();
  registerSupplementaryPluginHooks(api);
}

function registerLifecycleHooks(api: OpenClawPluginApi): void {
  api.on("gateway_start", () => {
    const { registry, cfg } = getRuntimeStore();
    registry.set("openclaw_ready", 1, {
      help: "Whether the plugin observed gateway_start and considers the exporter ready",
      labels: { deployment: cfg.instance || "default" },
    });
  });

  api.on("gateway_stop", () => {
    const { registry, cfg } = getRuntimeStore();
    registry.set("openclaw_ready", 0, {
      help: "Whether the plugin observed gateway_start and considers the exporter ready",
      labels: { deployment: cfg.instance || "default" },
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
    registry.inc("openclaw_session_messages_received_total", 1, {
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
    registry.inc("openclaw_session_messages_sent_total", 1, {
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
      registry.observeHistogram("openclaw_tool_call_duration_seconds", event.durationMs / 1000, {
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

  api.on("llm_output", (event, ctx) => {
    const { registry } = getRuntimeStore();
    const labels = {
      provider: stringOr(event.provider, "unknown"),
      model: stringOr(event.model, "unknown"),
    };
    const diagnosticLabels = {
      channel: stringOr(ctx.channelId, "unknown"),
      ...labels,
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
    const cacheRead = event.usage?.cacheRead ?? 0;
    const cacheWrite = event.usage?.cacheWrite ?? 0;
    if (cacheRead > 0) {
      registry.inc("openclaw_usage_tokens_cache_read_total", cacheRead, {
        help: "Cache read tokens observed through llm_output hooks",
        type: "counter",
        labels,
      });
    }
    if (cacheWrite > 0) {
      registry.inc("openclaw_usage_tokens_cache_write_total", cacheWrite, {
        help: "Cache write tokens observed through llm_output hooks",
        type: "counter",
        labels,
      });
    }
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

    // 兼容兜底：部分网关部署下 diagnostics 总线对扩展插件不可见，
    // 这里用 llm_output 的同源 usage 数据同步补齐 diagnostic model 指标。
    registry.inc("openclaw_diagnostic_model_usage_total", 1, {
      help: "Model usage events observed through OpenClaw diagnostics or llm_output fallback",
      type: "counter",
      labels: diagnosticLabels,
    });
    registry.inc("openclaw_diagnostic_model_tokens_total", event.usage?.input ?? 0, {
      help: "Token totals reported by OpenClaw diagnostics or llm_output fallback",
      type: "counter",
      labels: { ...diagnosticLabels, kind: "input" },
    });
    registry.inc("openclaw_diagnostic_model_tokens_total", event.usage?.output ?? 0, {
      help: "Token totals reported by OpenClaw diagnostics or llm_output fallback",
      type: "counter",
      labels: { ...diagnosticLabels, kind: "output" },
    });
    if (cacheRead > 0) {
      registry.inc("openclaw_diagnostic_model_tokens_total", cacheRead, {
        help: "Token totals reported by OpenClaw diagnostics or llm_output fallback",
        type: "counter",
        labels: { ...diagnosticLabels, kind: "cache_read" },
      });
    }
    if (cacheWrite > 0) {
      registry.inc("openclaw_diagnostic_model_tokens_total", cacheWrite, {
        help: "Token totals reported by OpenClaw diagnostics or llm_output fallback",
        type: "counter",
        labels: { ...diagnosticLabels, kind: "cache_write" },
      });
    }
    registry.inc(
      "openclaw_diagnostic_model_tokens_total",
      event.usage?.total ??
        (event.usage?.input ?? 0) +
          (event.usage?.output ?? 0) +
          (event.usage?.cacheRead ?? 0) +
          (event.usage?.cacheWrite ?? 0),
      {
        help: "Token totals reported by OpenClaw diagnostics or llm_output fallback",
        type: "counter",
        labels: { ...diagnosticLabels, kind: "total" },
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
    if (!event.success) {
      registry.inc("openclaw_agent_runs_failed_total", 1, {
        help: "Agent run failures observed through plugin hooks (no result label to avoid cardinality explosion)",
        type: "counter",
        labels: { agent_id: agentId },
      });
    }
    if (typeof event.durationMs === "number") {
      registry.observeHistogram("openclaw_agent_run_duration_seconds", event.durationMs / 1000, {
        help: "Observed agent run duration",
        labels: {
          agent_id: agentId,
        },
      });
    }
  });
}

function registerRuntimeEventListeners(api: OpenClawPluginApi): void {
  api.runtime.events?.onAgentEvent?.((event) => {
    try {
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
    } catch {
      // 静默吞下 listener 异常，避免中断事件流
    }
  });

  api.runtime.events?.onSessionTranscriptUpdate?.((update) => {
    try {
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
    } catch {
      // 静默吞下 listener 异常
    }
  });
}

/**
 * 订阅 OpenClaw 官方 diagnostic-events 总线，将诊断事件桥接为 Prometheus 指标。
 *
 * 这条链路来自上游 `openclaw/plugin-sdk` 根导出的 `onDiagnosticEvent`，
 * 与 Hook/RPC 采集互补，尤其适合 session stuck、queue lane、webhook、tool loop 等信号。
 */
function registerDiagnosticEventBridge(): void {
  stopDiagnosticSubscription?.();
  stopDiagnosticSubscription = onDiagnosticEvent((event: DiagnosticEventPayload) => {
    try {
      recordDiagnosticEvent(event);
    } catch {
      // 诊断事件仅用于可观测性，不应影响主业务执行。
    }
  });
}

/**
 * 将官方诊断事件转为低基数 Prometheus 指标。
 *
 * @param event - OpenClaw `onDiagnosticEvent` 推送的事件
 */
function recordDiagnosticEvent(event: DiagnosticEventPayload): void {
  const { registry } = getRuntimeStore();
  switch (event.type) {
    case "model.usage": {
      const labels = {
        channel: stringOr(event.channel, "unknown"),
        provider: stringOr(event.provider, "unknown"),
        model: stringOr(event.model, "unknown"),
      };
      const usage = event.usage && typeof event.usage === "object" ? event.usage : undefined;
      const usagePayload =
        usage && typeof usage === "object"
          ? (usage as {
              input?: unknown;
              output?: unknown;
              cacheRead?: unknown;
              cacheWrite?: unknown;
              promptTokens?: unknown;
              total?: unknown;
            })
          : undefined;
      const context =
        event.context && typeof event.context === "object"
          ? (event.context as { used?: unknown; limit?: unknown })
          : undefined;

      registry.inc("openclaw_diagnostic_model_usage_total", 1, {
        help: "Model usage events observed through OpenClaw diagnostic-events",
        type: "counter",
        labels,
      });
      registry.inc("openclaw_diagnostic_model_tokens_total", nonNegative(usagePayload?.input), {
        help: "Token totals reported by model.usage diagnostic events",
        type: "counter",
        labels: { ...labels, kind: "input" },
      });
      registry.inc("openclaw_diagnostic_model_tokens_total", nonNegative(usagePayload?.output), {
        help: "Token totals reported by model.usage diagnostic events",
        type: "counter",
        labels: { ...labels, kind: "output" },
      });
      registry.inc("openclaw_diagnostic_model_tokens_total", nonNegative(usagePayload?.cacheRead), {
        help: "Token totals reported by model.usage diagnostic events",
        type: "counter",
        labels: { ...labels, kind: "cache_read" },
      });
      registry.inc("openclaw_diagnostic_model_tokens_total", nonNegative(usagePayload?.cacheWrite), {
        help: "Token totals reported by model.usage diagnostic events",
        type: "counter",
        labels: { ...labels, kind: "cache_write" },
      });
      registry.inc("openclaw_diagnostic_model_tokens_total", nonNegative(usagePayload?.promptTokens), {
        help: "Token totals reported by model.usage diagnostic events",
        type: "counter",
        labels: { ...labels, kind: "prompt" },
      });
      registry.inc("openclaw_diagnostic_model_tokens_total", nonNegative(usagePayload?.total), {
        help: "Token totals reported by model.usage diagnostic events",
        type: "counter",
        labels: { ...labels, kind: "total" },
      });
      registry.inc("openclaw_diagnostic_model_cost_usd_total", nonNegative(event.costUsd), {
        help: "Estimated cost reported by model.usage diagnostic events",
        type: "counter",
        labels,
      });
      registry.set("openclaw_diagnostic_model_context_tokens", nonNegative(context?.used), {
        help: "Latest context tokens reported by model.usage diagnostic events",
        labels: { ...labels, kind: "used" },
      });
      registry.set("openclaw_diagnostic_model_context_tokens", nonNegative(context?.limit), {
        help: "Latest context tokens reported by model.usage diagnostic events",
        labels: { ...labels, kind: "limit" },
      });
      if (typeof event.durationMs === "number" && event.durationMs >= 0) {
        registry.observeHistogram("openclaw_diagnostic_model_duration_seconds", event.durationMs / 1000, {
          help: "Model completion duration observed through model.usage diagnostic events",
          labels,
        });
      }
      return;
    }
    case "webhook.received": {
      const labels = {
        channel: stringOr(event.channel, "unknown"),
        update_type: stringOr(event.updateType, "unknown"),
      };
      registry.inc("openclaw_diagnostic_webhook_received_total", 1, {
        help: "Webhook receive events observed through OpenClaw diagnostic-events",
        type: "counter",
        labels,
      });
      return;
    }
    case "webhook.processed": {
      const labels = {
        channel: stringOr(event.channel, "unknown"),
        update_type: stringOr(event.updateType, "unknown"),
      };
      registry.inc("openclaw_diagnostic_webhook_processed_total", 1, {
        help: "Webhook processed events observed through OpenClaw diagnostic-events",
        type: "counter",
        labels,
      });
      if (typeof event.durationMs === "number" && event.durationMs >= 0) {
        registry.observeHistogram("openclaw_diagnostic_webhook_duration_seconds", event.durationMs / 1000, {
          help: "Webhook processing duration observed through OpenClaw diagnostic-events",
          labels,
        });
      }
      return;
    }
    case "webhook.error": {
      registry.inc("openclaw_diagnostic_webhook_errors_total", 1, {
        help: "Webhook processing errors observed through OpenClaw diagnostic-events",
        type: "counter",
        labels: {
          channel: stringOr(event.channel, "unknown"),
          update_type: stringOr(event.updateType, "unknown"),
        },
      });
      return;
    }
    case "message.queued": {
      const labels = {
        channel: stringOr(event.channel, "unknown"),
        source: stringOr(event.source, "unknown"),
      };
      registry.inc("openclaw_diagnostic_message_queued_total", 1, {
        help: "Queued message events observed through OpenClaw diagnostic-events",
        type: "counter",
        labels,
      });
      if (typeof event.queueDepth === "number" && event.queueDepth >= 0) {
        registry.set("openclaw_diagnostic_message_queue_depth", event.queueDepth, {
          help: "Latest queue depth reported by message.queued diagnostic events",
          labels: { scope: "message" },
        });
      }
      return;
    }
    case "message.processed": {
      const labels = {
        channel: stringOr(event.channel, "unknown"),
        outcome: stringOr(event.outcome, "unknown"),
      };
      registry.inc("openclaw_diagnostic_message_processed_total", 1, {
        help: "Processed message events observed through OpenClaw diagnostic-events",
        type: "counter",
        labels,
      });
      if (typeof event.durationMs === "number" && event.durationMs >= 0) {
        registry.observeHistogram("openclaw_diagnostic_message_duration_seconds", event.durationMs / 1000, {
          help: "Message processing duration observed through OpenClaw diagnostic-events",
          labels,
        });
      }
      return;
    }
    case "session.state": {
      const state = stringOr(event.state, "unknown");
      registry.inc("openclaw_diagnostic_session_state_transitions_total", 1, {
        help: "Session state transitions observed through OpenClaw diagnostic-events",
        type: "counter",
        labels: {
          state,
          prev_state: stringOr(event.prevState, "unknown"),
        },
      });
      registry.setOneHotStatus("openclaw_diagnostic_session_state_current", state, ["idle", "processing", "waiting", "unknown"], {
        help: "Latest session state seen through OpenClaw diagnostic-events",
      });
      if (typeof event.queueDepth === "number" && event.queueDepth >= 0) {
        registry.set("openclaw_diagnostic_message_queue_depth", event.queueDepth, {
          help: "Latest queue depth reported by session.state diagnostic events",
          labels: { scope: "session" },
        });
      }
      return;
    }
    case "session.stuck": {
      const state = stringOr(event.state, "unknown");
      const ageSeconds = typeof event.ageMs === "number" && event.ageMs >= 0 ? event.ageMs / 1000 : 0;
      registry.inc("openclaw_diagnostic_session_stuck_total", 1, {
        help: "Session stuck events observed through OpenClaw diagnostic-events",
        type: "counter",
        labels: { state },
      });
      registry.observeHistogram("openclaw_diagnostic_session_stuck_age_seconds", ageSeconds, {
        help: "Age of stuck sessions observed through OpenClaw diagnostic-events",
        labels: { state },
      });
      if (typeof event.queueDepth === "number" && event.queueDepth >= 0) {
        registry.set("openclaw_diagnostic_message_queue_depth", event.queueDepth, {
          help: "Latest queue depth reported by session.stuck diagnostic events",
          labels: { scope: "stuck" },
        });
      }
      return;
    }
    case "queue.lane.enqueue": {
      const lane = stringOr(event.lane, "unknown");
      registry.inc("openclaw_diagnostic_queue_lane_events_total", 1, {
        help: "Queue lane enqueue/dequeue events observed through OpenClaw diagnostic-events",
        type: "counter",
        labels: { lane, event: "enqueue" },
      });
      if (typeof event.queueSize === "number" && event.queueSize >= 0) {
        registry.set("openclaw_diagnostic_queue_lane_depth", event.queueSize, {
          help: "Latest queue size by lane reported through OpenClaw diagnostic-events",
          labels: { lane },
        });
      }
      return;
    }
    case "queue.lane.dequeue": {
      const lane = stringOr(event.lane, "unknown");
      registry.inc("openclaw_diagnostic_queue_lane_events_total", 1, {
        help: "Queue lane enqueue/dequeue events observed through OpenClaw diagnostic-events",
        type: "counter",
        labels: { lane, event: "dequeue" },
      });
      if (typeof event.queueSize === "number" && event.queueSize >= 0) {
        registry.set("openclaw_diagnostic_queue_lane_depth", event.queueSize, {
          help: "Latest queue size by lane reported through OpenClaw diagnostic-events",
          labels: { lane },
        });
      }
      if (typeof event.waitMs === "number" && event.waitMs >= 0) {
        registry.observeHistogram("openclaw_diagnostic_queue_wait_seconds", event.waitMs / 1000, {
          help: "Queue wait time observed through OpenClaw diagnostic-events",
          labels: { lane },
        });
      }
      return;
    }
    case "diagnostic.heartbeat": {
      const heartbeatWebhooks =
        event.webhooks && typeof event.webhooks === "object"
          ? (event.webhooks as {
              received?: unknown;
              processed?: unknown;
              errors?: unknown;
            })
          : undefined;
      registry.set("openclaw_diagnostic_active_sessions", nonNegative(event.active), {
        help: "Active sessions reported by OpenClaw diagnostic heartbeat",
      });
      registry.set("openclaw_diagnostic_waiting_sessions", nonNegative(event.waiting), {
        help: "Waiting sessions reported by OpenClaw diagnostic heartbeat",
      });
      registry.set("openclaw_diagnostic_queued_messages", nonNegative(event.queued), {
        help: "Queued messages reported by OpenClaw diagnostic heartbeat",
      });
      registry.set("openclaw_diagnostic_webhook_events", nonNegative(heartbeatWebhooks?.received), {
        help: "Webhook received count snapshot reported by OpenClaw diagnostic heartbeat",
        labels: { event: "received" },
      });
      registry.set("openclaw_diagnostic_webhook_events", nonNegative(heartbeatWebhooks?.processed), {
        help: "Webhook processed count snapshot reported by OpenClaw diagnostic heartbeat",
        labels: { event: "processed" },
      });
      registry.set("openclaw_diagnostic_webhook_events", nonNegative(heartbeatWebhooks?.errors), {
        help: "Webhook error count snapshot reported by OpenClaw diagnostic heartbeat",
        labels: { event: "errors" },
      });
      return;
    }
    case "tool.loop": {
      registry.inc("openclaw_diagnostic_tool_loop_total", 1, {
        help: "Tool loop warnings/blocks observed through OpenClaw diagnostic-events",
        type: "counter",
        labels: {
          tool: stringOr(event.toolName, "unknown"),
          detector: stringOr(event.detector, "unknown"),
          action: stringOr(event.action, "unknown"),
          level: stringOr(event.level, "unknown"),
          paired_tool: stringOr(event.pairedToolName, "none"),
        },
      });
      if (typeof event.count === "number" && event.count >= 0) {
        registry.set("openclaw_diagnostic_tool_loop_count", event.count, {
          help: "Latest loop repetition count observed through OpenClaw diagnostic-events",
          labels: {
            tool: stringOr(event.toolName, "unknown"),
            detector: stringOr(event.detector, "unknown"),
          },
        });
      }
      return;
    }
    default:
      return;
  }
}

/**
 * 将 before_reset 等原因归一为低基数标签。
 *
 * @param reason - hook 事件中的 reason 字段
 */
function normalizeSessionResetReason(reason: unknown): string {
  if (typeof reason !== "string") {
    return "unknown";
  }
  const trimmed = reason.trim();
  if (
    trimmed === "new" ||
    trimmed === "reset" ||
    trimmed === "idle" ||
    trimmed === "daily" ||
    trimmed === "compaction" ||
    trimmed === "deleted"
  ) {
    return trimmed;
  }
  return trimmed.length > 0 ? "other" : "unknown";
}

/**
 * 递增通用 hook 调用计数（补充尚未在其它 register* 中单独建模的 SDK hooks）。
 *
 * @param hook - OpenClaw `PluginHookName`
 */
function incHookInvocation(hook: string): void {
  const { registry } = getRuntimeStore();
  registry.inc("openclaw_plugin_hook_invocations_total", 1, {
    help: "Plugin SDK hook invocations observed by openclaw-prometheus",
    type: "counter",
    labels: { hook },
  });
}

/**
 * 补充注册 OpenClaw 其余 Plugin SDK hooks（模型解析、压缩、子代理、派发、安装等）。
 */
function registerSupplementaryPluginHooks(api: OpenClawPluginApi): void {
  api.on("before_model_resolve", () => {
    incHookInvocation("before_model_resolve");
  });
  api.on("before_prompt_build", () => {
    incHookInvocation("before_prompt_build");
  });
  api.on("before_agent_reply", () => {
    incHookInvocation("before_agent_reply");
  });
  api.on("llm_input", (event) => {
    incHookInvocation("llm_input");
    const { registry } = getRuntimeStore();
    const provider = typeof event?.provider === "string" ? event.provider : "unknown";
    const model = typeof event?.model === "string" ? event.model : "unknown";
    const images =
      typeof event?.imagesCount === "number" && event.imagesCount > 0 ? event.imagesCount : 0;
    if (images > 0) {
      registry.inc("openclaw_model_llm_input_images_total", images, {
        help: "Images attached to LLM inputs observed through llm_input hooks",
        type: "counter",
        labels: { provider, model },
      });
    }
  });
  api.on("before_compaction", (event) => {
    incHookInvocation("before_compaction");
    const { registry } = getRuntimeStore();
    registry.inc("openclaw_session_compaction_events_total", 1, {
      help: "Session compaction-related hook events",
      type: "counter",
      labels: { phase: "before" },
    });
    const tokenCount = typeof event?.tokenCount === "number" ? event.tokenCount : undefined;
    if (typeof tokenCount === "number") {
      registry.set("openclaw_session_compaction_last_tokens_before", tokenCount, {
        help: "Token count observed on the last before_compaction hook",
      });
    }
  });
  api.on("after_compaction", (event) => {
    incHookInvocation("after_compaction");
    const { registry } = getRuntimeStore();
    registry.inc("openclaw_session_compaction_events_total", 1, {
      help: "Session compaction-related hook events",
      type: "counter",
      labels: { phase: "after" },
    });
    const compacted = typeof event?.compactedCount === "number" ? event.compactedCount : 0;
    if (compacted > 0) {
      registry.inc("openclaw_session_compaction_messages_compacted_total", compacted, {
        help: "Messages removed by compaction (after_compaction.compactedCount)",
        type: "counter",
      });
    }
    const tokenCountAfter = typeof event?.tokenCount === "number" ? event.tokenCount : undefined;
    if (typeof tokenCountAfter === "number") {
      registry.set("openclaw_session_compaction_last_tokens_after", tokenCountAfter, {
        help: "Token count observed on the last after_compaction hook",
      });
    }
  });
  api.on("before_reset", (event) => {
    incHookInvocation("before_reset");
    const { registry } = getRuntimeStore();
    const reason = normalizeSessionResetReason(event?.reason);
    registry.inc("openclaw_session_reset_requests_total", 1, {
      help: "Session reset requests observed through before_reset hooks",
      type: "counter",
      labels: { reason },
    });
  });
  api.on("inbound_claim", () => {
    incHookInvocation("inbound_claim");
  });
  api.on("message_sending", () => {
    incHookInvocation("message_sending");
  });
  api.on("tool_result_persist", (event) => {
    incHookInvocation("tool_result_persist");
    const tool = typeof event?.toolName === "string" ? event.toolName : "unknown";
    const { registry } = getRuntimeStore();
    registry.inc("openclaw_tool_result_persist_total", 1, {
      help: "Tool results persisted (tool_result_persist hook)",
      type: "counter",
      labels: { tool },
    });
  });
  api.on("before_message_write", () => {
    incHookInvocation("before_message_write");
  });
  api.on("subagent_spawning", () => {
    incHookInvocation("subagent_spawning");
  });
  api.on("subagent_delivery_target", () => {
    incHookInvocation("subagent_delivery_target");
  });
  api.on("subagent_spawned", () => {
    incHookInvocation("subagent_spawned");
  });
  api.on("subagent_ended", (event) => {
    incHookInvocation("subagent_ended");
    const { registry } = getRuntimeStore();
    const outcome = typeof event?.outcome === "string" ? event.outcome : "unknown";
    registry.inc("openclaw_agent_subagent_ended_total", 1, {
      help: "Subagent ended events by outcome",
      type: "counter",
      labels: { outcome },
    });
  });
  api.on("before_dispatch", () => {
    incHookInvocation("before_dispatch");
  });
  api.on("reply_dispatch", () => {
    incHookInvocation("reply_dispatch");
  });
  api.on("before_install", () => {
    incHookInvocation("before_install");
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
    if (snapshot.status === "error") {
      registry.inc("openclaw_model_auth_provider_probe_errors_total", 1, {
        help: "Errors while probing provider API keys during runtime snapshot refresh",
        type: "counter",
        labels: { provider: snapshot.provider },
      });
    }
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
  const { registry, cfg } = store;
  registry.set("openclaw_up", 1, {
    help: "Whether the OpenClaw Prometheus plugin is loaded",
    labels: { deployment: cfg.instance || "default" },
  });
  registry.set("openclaw_ready", 1, {
    help: "Whether the OpenClaw Prometheus plugin runtime is initialized",
    labels: { deployment: cfg.instance || "default" },
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

  // ─────────── 新增：时间序列基数监控 ───────────
  registry.set("openclaw_metrics_series_total", registry.snapshotSamples().length, {
    help: "Total number of metric series (cardinality)",
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

function nonNegative(value: unknown): number {
  return typeof value === "number" && value >= 0 ? value : 0;
}

// ─────────── HTTP 延迟环形缓冲区（用于计算 P95/P99） ───────────

export function recordHttpLatency(seconds: number): void {
  HTTP_LATENCY_SAMPLES.push(seconds);
  if (HTTP_LATENCY_SAMPLES.length > HTTP_LATENCY_MAX_SAMPLES) {
    HTTP_LATENCY_SAMPLES.shift();
  }
}

export function refreshHttpLatencyMetrics(): void {
  const { registry } = getRuntimeStore();

  if (HTTP_LATENCY_SAMPLES.length > 0) {
    const sortedValues = [...HTTP_LATENCY_SAMPLES].sort((a, b) => a - b);
    const p95Index = Math.floor(sortedValues.length * 0.95);
    const p99Index = Math.floor(sortedValues.length * 0.99);

    registry.set("openclaw_sli_http_request_p95_seconds", sortedValues[p95Index], {
      help: "HTTP request duration P95 (95th percentile).",
    });
    registry.set("openclaw_sli_http_request_p99_seconds", sortedValues[p99Index], {
      help: "HTTP request duration P99 (99th percentile).",
    });
  }

  // ─────────── 环形缓冲区使用率监控 ───────────
  registry.set("openclaw_http_latency_samples_used", HTTP_LATENCY_SAMPLES.length, {
    help: "Number of HTTP latency samples in buffer",
  });
  registry.set("openclaw_http_latency_samples_usage_ratio", HTTP_LATENCY_SAMPLES.length / HTTP_LATENCY_MAX_SAMPLES, {
    help: "HTTP latency buffer usage ratio (0~1)",
  });
}

export function refreshSliMetrics(): void {
  const store = getRuntimeStore();
  const { registry } = store;

  // SLI 1: 消息投递成功率
  const msgOk = sumSamplesByLabel(registry.getSamplesByName("openclaw_session_messages_sent_total"), "result", "ok");
  const msgErr = sumSamplesByLabel(registry.getSamplesByName("openclaw_session_messages_sent_total"), "result", "error");
  const msgTotal = msgOk + msgErr;
  registry.set("openclaw_sli_message_success_ratio", msgTotal > 0 ? msgOk / msgTotal : 1, {
    help: "Message delivery success ratio (0~1). Source: openclaw_session_messages_sent_total{result}.",
  });

  // SLI 2: Agent 错误率
  const agentFailed = sumSamplesByLabel(registry.getSamplesByName("openclaw_agent_runs_total"), "result", "error");
  const agentStarted = registry.getSampleValue("openclaw_agent_runs_started_total");
  registry.set("openclaw_sli_agent_error_ratio", agentStarted > 0 ? agentFailed / agentStarted : 0, {
    help: "Agent run error ratio (0~1). Source: openclaw_agent_runs_total{result=error} / openclaw_agent_runs_started_total.",
  });

  // SLI 3: 工具调用错误率
  const toolFails = registry.getSampleValue("openclaw_tool_call_failures_total");
  const toolTotal = registry.getSampleValue("openclaw_tool_calls_total");
  registry.set("openclaw_sli_tool_error_ratio", toolTotal > 0 ? toolFails / toolTotal : 0, {
    help: "Tool call error ratio (0~1). Source: openclaw_tool_call_failures_total / openclaw_tool_calls_total.",
  });

  // SLI 4: 渠道健康率（从 rpcSamples 线性查找——RPC 样本量小，可接受）
  const channelLinked = store.rpcSamples.find((s: MetricSample) => s.name === "openclaw_channel_linked_total")?.value ?? 0;
  const channelTotal = store.rpcSamples.find((s: MetricSample) => s.name === "openclaw_channel_total")?.value ?? 0;
  registry.set("openclaw_sli_channel_health_ratio", channelTotal > 0 ? channelLinked / channelTotal : 1, {
    help: "Channel health ratio (0~1). Source: openclaw_channel_linked_total / openclaw_channel_total (RPC).",
  });
}

function sumSamplesByLabel(
  samples: Array<{ labels?: Record<string, string>; value: number }>,
  label: string,
  expectedValue: string,
): number {
  return samples.reduce((sum, sample) => {
    if (sample.labels?.[label] === expectedValue) {
      return sum + sample.value;
    }
    return sum;
  }, 0);
}
