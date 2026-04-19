# OpenClaw Grafana dashboards

Ready-to-import Grafana dashboards for metrics from **`@partme.ai/openclaw-prometheus`**.

The exporter is a **pure OpenClaw plugin**: metrics come from documented `api.runtime.*` helpers, plugin hooks, runtime events, and exporter-owned HTTP routes (see plugin [README](../README.md)).

---

## Which dashboard to import

| File | Scope | When to use |
|------|--------|-------------|
| **[openclaw-prometheus-cockpit.json](./openclaw-prometheus-cockpit.json)** | Single scrape target | **Recommended.** Dark “operations cockpit”: health, workload, LLM tokens, hook activity, compaction/subagent, model-auth probes, channels, Node.js process, exporter HTTP/collectors. Queries match **current plugin code**. |
| **[openclaw-prometheus-cockpit-cluster.json](./openclaw-prometheus-cockpit-cluster.json)** | Multi-target | Same layout as the cockpit, plus **`instance`** template variable (`label_values(openclaw_up, instance)`). Use when each Gateway has its own Prometheus target. |
| [openclaw-gateway-single.json](./openclaw-gateway-single.json) | Single node | **Legacy / optional.** Mix of panels that assumed extra Gateway RPC collectors; several series may show **no data** in plugin-only deployments. Prefer the cockpit JSON above. |
| [openclaw-gateway-cluster.json](./openclaw-gateway-cluster.json) | Cluster | **Legacy / optional.** Same caveat as single-node legacy file. |

---

## Import

1. Grafana → **Dashboards** → **New** → **Import** → upload JSON (or paste).
2. Map **`DS_PROMETHEUS`** to your Prometheus data source.
3. Optional: map **`DS_LOKI`** only if you attach log panels yourself (these JSON files do not require Loki).
4. Save.

**Troubleshooting**

- **`Old dashboard JSON format`**: Import the **raw `.json` file** from this folder, not an HTTP API wrapper (`meta` + `dashboard`).
- **No `instance` label**: Single-node cockpit does not need it. For the cluster cockpit, add a `relabel_config` that sets `instance` from `host:port` or your pod name, or change the variable query to your label.
- **Empty Node.js panels**: Set plugin config `includeRuntime: true` (default) so `openclaw_nodejs_*` is scraped.

**Tested schema:** Grafana 10.x+ (`schemaVersion` 39).

---

## Metric reference (plugin export)

The following groups reflect **metrics emitted by the current plugin implementation** (names and labels are stable for alerting and dashboards).

### Exporter / scrape meta

| Metric | Type | Labels / notes |
|--------|------|----------------|
| `openclaw_exporter_build_info` | gauge | `plugin`, `version` |
| `openclaw_up` | gauge | Plugin loaded |
| `openclaw_ready` | gauge | Observed `gateway_start` |
| `openclaw_plugin_uptime_seconds` | gauge | Plugin process uptime |
| `openclaw_metrics_last_scrape_duration_seconds` | gauge | Last collect wall time (includes cache) |
| `openclaw_metrics_collector_success` | gauge | `collector` — last collect ok (1/0) |
| `openclaw_metrics_collect_errors_total` | counter | `collector` — cumulative collect failures |
| `openclaw_metrics_http_requests_total` | counter | `method`, `route`, `status` |
| `openclaw_metrics_http_request_duration_seconds_*` | counter | Summary pairs; `method`, `route` |
| `openclaw_gateway_operator_rpc_requests_total` | counter | `method` — e.g. `openclaw.prometheus.status` |

### Runtime snapshot & model auth

| Metric | Type | Labels / notes |
|--------|------|----------------|
| `openclaw_runtime_snapshot_age_seconds` | gauge | Staleness since last snapshot refresh |
| `openclaw_runtime_snapshot_refresh_timestamp_seconds` | gauge | Unix time of last refresh |
| `openclaw_runtime_namespace_available` | gauge | `namespace`: `events`, `modelAuth`, `channel`, `state` |
| `openclaw_runtime_state_dir_configured` | gauge | State dir resolved |
| `openclaw_model_auth_provider_status` | gauge | One-hot per `provider`; `status` `ok` / `missing` / `error` |
| `openclaw_model_auth_provider_info` | gauge | `provider`, `source`, `mode` |
| `openclaw_model_auth_provider_probe_errors_total` | counter | `provider` — exceptions during probe |

### Messages & channels

| Metric | Type | Labels / notes |
|--------|------|----------------|
| `openclaw_messages_received_total` | counter | `channel` |
| `openclaw_messages_sent_total` | counter | `channel`, `result` |
| `openclaw_channel_failures_total` | counter | `channel`, `reason` |
| `openclaw_channel_last_event_timestamp_seconds` | gauge | `channel`, `account` |
| `openclaw_channel_last_inbound_age_seconds` | gauge | `channel`, `account` |
| `openclaw_channel_last_outbound_age_seconds` | gauge | `channel`, `account` |

### Sessions & transcript

| Metric | Type | Labels / notes |
|--------|------|----------------|
| `openclaw_sessions_started_total` | counter | — |
| `openclaw_sessions_ended_total` | counter | `reason` |
| `openclaw_sessions_active_estimated` | gauge | Estimated from hooks |
| `openclaw_session_transcript_updates_total` | counter | — |
| `openclaw_session_transcript_last_update_timestamp_seconds` | gauge | — |
| `openclaw_session_transcript_last_seen_timestamp_seconds` | gauge | `scope` |
| `openclaw_session_compaction_events_total` | counter | `phase`: `before` / `after` |
| `openclaw_session_compaction_messages_compacted_total` | counter | — |
| `openclaw_session_compaction_last_tokens_before` | gauge | Last `before_compaction` token estimate |
| `openclaw_session_compaction_last_tokens_after` | gauge | Last `after_compaction` token estimate |
| `openclaw_session_reset_requests_total` | counter | `reason` (normalized / low cardinality) |

### Agent / tools / subagent

| Metric | Type | Labels / notes |
|--------|------|----------------|
| `openclaw_agent_runs_started_total` | counter | `agent_id`, `channel` |
| `openclaw_agent_runs_total` | counter | `agent_id`, `result` |
| `openclaw_agent_run_duration_seconds_*` | counter | Summary; `agent_id`, `result` |
| `openclaw_agent_events_total` | counter | `stream` |
| `openclaw_agent_item_events_total` | counter | `kind`, `phase`, `status` |
| `openclaw_tool_calls_total` | counter | `tool` |
| `openclaw_tool_call_failures_total` | counter | `tool` |
| `openclaw_tool_call_duration_seconds_*` | counter | Summary; `tool` |
| `openclaw_tool_result_persist_total` | counter | `tool` |
| `openclaw_inflight_operations` | gauge | `kind`: `agent`, `tool`, … |
| `openclaw_subagent_ended_total` | counter | `outcome` |

### LLM usage & extended hooks

| Metric | Type | Labels / notes |
|--------|------|----------------|
| `openclaw_usage_tokens_input_total` | counter | `provider`, `model` |
| `openclaw_usage_tokens_output_total` | counter | `provider`, `model` |
| `openclaw_usage_tokens_cache_read_total` | counter | `provider`, `model` |
| `openclaw_usage_tokens_cache_write_total` | counter | `provider`, `model` |
| `openclaw_usage_tokens_total` | counter | `provider`, `model` |
| `openclaw_llm_input_images_total` | counter | `provider`, `model` |
| `openclaw_plugin_hook_invocations_total` | counter | `hook` — full `PluginHookName` coverage for supplementary hooks |

### Node.js process (`includeRuntime`)

| Metric | Type | Notes |
|--------|------|--------|
| `openclaw_nodejs_heap_used_bytes` | gauge | |
| `openclaw_nodejs_heap_total_bytes` | gauge | |
| `openclaw_nodejs_external_bytes` | gauge | |
| `openclaw_nodejs_array_buffers_bytes` | gauge | |
| `openclaw_nodejs_rss_bytes` | gauge | |
| `openclaw_nodejs_event_loop_lag_ms` | gauge | |
| `openclaw_nodejs_uptime_seconds` | gauge | |
| `openclaw_nodejs_process_cpu_user_seconds_total` | counter | Cumulative CPU user time |
| `openclaw_nodejs_process_cpu_system_seconds_total` | counter | Cumulative CPU system time |

### Optional / not wired in default plugin build

The repository may still contain **collector modules** (e.g. health, channels, cron) that expect Gateway private RPC. Those metrics are **not** registered by the current plugin `index.ts` entrypoint. Legacy dashboards that reference names such as `openclaw_channel_linked_total`, `openclaw_usage_cost_usd_total`, or `openclaw_session_total` may stay empty unless you run a custom build that wires those collectors.

---

## Prometheus labels

- **Cluster cockpits** assume an **`instance`** label on scrape targets (Prometheus adds `host:port` by default).
- To use another identity label, edit the dashboard variable query and replace `instance=~"$instance"` in panel expressions.

---

## Queries & alerting hints

- **Availability**: `openclaw_up == 0`, `openclaw_ready == 0`.
- **Scrape health**: rising `openclaw_metrics_collect_errors_total` or `openclaw_metrics_last_scrape_duration_seconds` SLO breach.
- **Auth**: non-zero `rate(openclaw_model_auth_provider_probe_errors_total[15m])` or `openclaw_model_auth_provider_status{status="error"} == 1`.
- **Workload**: `rate(openclaw_agent_runs_total[5m])`, token rates from `openclaw_usage_*_total`.
- **Process**: `rate(openclaw_nodejs_process_cpu_user_seconds_total[2m])`, `openclaw_nodejs_heap_used_bytes`, `openclaw_nodejs_event_loop_lag_ms`.

---

## 中文说明

- **推荐使用**：**[openclaw-prometheus-cockpit.json](./openclaw-prometheus-cockpit.json)**（单实例）与 **[openclaw-prometheus-cockpit-cluster.json](./openclaw-prometheus-cockpit-cluster.json)**（多实例，带 **Instance** 变量）。布局为深色运营驾驶舱风格，PromQL 与 **当前插件实现** 一致。
- **旧版看板** `openclaw-gateway-*.json` 中部分面板依赖历史上假设的 Gateway RPC 采集数据，在仅启用本插件时可能出现 **无数据**，请以新驾驶舱为准。
- 导入时在向导中为 **`DS_PROMETHEUS`** 绑定 Prometheus；指标表见上文 **Metric reference**。
- 日志与长期审计请走 **Loki**，不要塞进 Prometheus 指标。
