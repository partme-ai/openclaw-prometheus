# OpenClaw Grafana 指标覆盖矩阵

> 适用范围：`@partme.ai/openclaw-prometheus` v0.3.0  
> 目标：把 exporter 的主要指标家族，映射到合适的 Grafana 图表类型、Dashboard 区域和 PromQL 模板。

---

## 设计原则

1. **概览优先**：先回答“系统是否健康、当前是否有风险、哪些域最值得点进去看”。
2. **详细下钻**：再按 OpenClaw Control UI 的心智，把详细内容拆到 Usage、Sessions、Channels、Instances、Cron、Debug 等域。
3. **按指标语义选图表**：
   - `stat / gauge`：单值状态、容量、当前健康度
   - `timeseries`：趋势、速率、窗口聚合
   - `bar chart / bar gauge`：Top-N 排行、分类对比、低基数分布
   - `table`：明细、告警清单、Collector 健康、账号/Provider 状态
   - `heatmap`：histogram bucket 的时间分布
4. **不追求“一指标一面板”**：以指标家族为单位组织，保证每个家族至少有清晰入口。

---

## 信息架构

### Overview

参考 OpenClaw UI 的 `overview` 页，Grafana 概览页遵循：

1. 状态与新鲜度
2. KPI 卡片
3. Attention / Reliability
4. 活动趋势
5. Top-N 支持视图

### Detailed Metrics

详细页按业务域拆成连续章节：

1. Exporter / Gateway
2. Sessions / Message Flow
3. Usage / Model / Auth
4. Agent / Tool
5. Channels / Instances / System
6. Diagnostics / SLI / Histogram

---

## 指标家族覆盖矩阵

| 指标家族 | 关键指标 | 推荐图表 | Dashboard 区域 | PromQL 模板 |
|---------|---------|---------|----------------|------------|
| Exporter / 采集 | `openclaw_up`, `openclaw_ready`, `openclaw_metrics_collector_success`, `openclaw_metrics_last_scrape_duration_seconds` | `stat`, `table`, `timeseries` | Overview 顶部状态；Detailed 的 Exporter / Gateway | `max(metric{instance=~"$instance"})`、`sum(clamp_min(1 - openclaw_metrics_collector_success{instance=~"$instance"}, 0))` |
| HTTP / RPC | `openclaw_metrics_http_requests_total`, `openclaw_metrics_http_request_duration_seconds`, `openclaw_gateway_operator_rpc_requests_total` | `timeseries`, `heatmap`, `bar gauge` | Overview 趋势区；Detailed 的 Exporter / Gateway | `sum(rate(openclaw_metrics_http_requests_total{instance=~"$instance"}[$__rate_interval])) by (status)`、`histogram_quantile(0.95, sum by (le) (rate(openclaw_metrics_http_request_duration_seconds_bucket{instance=~"$instance"}[$__rate_interval])))` |
| SLI | `openclaw_sli_message_success_ratio`, `openclaw_sli_agent_error_ratio`, `openclaw_sli_tool_error_ratio`, `openclaw_sli_channel_health_ratio` | `stat`, `timeseries` | Overview Attention；Detailed Diagnostics / SLI | `openclaw_sli_message_success_ratio{instance=~"$instance"}`、`1 - openclaw_sli_agent_error_ratio{instance=~"$instance"}` |
| Sessions / Messages | `openclaw_session_total`, `openclaw_session_active_recent`, `openclaw_session_by_channel`, `openclaw_session_messages_received_total`, `openclaw_session_messages_sent_total`, `openclaw_session_transcript_updates_total` | `stat`, `timeseries`, `bar gauge` | Overview KPI + 趋势；Detailed Sessions / Message Flow | `sum(rate(openclaw_session_messages_sent_total{instance=~"$instance",result="ok"}[$__rate_interval]))`、`topk(10, openclaw_session_by_channel{instance=~"$instance"})` |
| Usage / Cost | `openclaw_usage_tokens_total`, `openclaw_usage_cost_usd_total`, `openclaw_usage_provider_*`, `openclaw_usage_model_*`, `openclaw_usage_daily_cost_usd_total` | `stat`, `timeseries`, `bar gauge`, `table` | Overview KPI + Top-N；Detailed Usage / Model | `sum(openclaw_usage_cost_usd_total{instance=~"$instance"})`、`topk(10, sum by (model) (openclaw_usage_model_tokens_total{instance=~"$instance"}))` |
| 实时模型吞吐 | `openclaw_model_llm_tokens_*`, `openclaw_model_llm_input_images_total` | `timeseries`, `bar gauge` | Overview 趋势；Detailed Usage / Model | `sum by (provider) (rate(openclaw_model_llm_tokens_total{instance=~"$instance"}[$__rate_interval]))` |
| 模型认证 | `openclaw_model_auth_provider_status`, `openclaw_model_auth_providers_expired_total`, `openclaw_model_auth_provider_remaining_seconds`, `openclaw_model_auth_provider_usage_used_ratio` | `stat`, `table`, `bar gauge`, `timeseries` | Overview KPI + Attention；Detailed Usage / Model | `sum(openclaw_model_auth_providers_expired_total{instance=~"$instance"})`、`openclaw_model_auth_provider_status{instance=~"$instance",status!="ok"}` |
| Agent | `openclaw_agent_runs_started_total`, `openclaw_agent_runs_total`, `openclaw_agent_runs_failed_total`, `openclaw_agent_run_duration_seconds`, `openclaw_agent_subagent_ended_total` | `timeseries`, `bar gauge`, `heatmap`, `table` | Overview Top-N；Detailed Agent / Tool | `sum(rate(openclaw_agent_runs_started_total{instance=~"$instance"}[$__rate_interval]))`、`histogram_quantile(0.95, sum by (le) (rate(openclaw_agent_run_duration_seconds_bucket{instance=~"$instance"}[$__rate_interval])))` |
| Tool | `openclaw_tool_calls_total`, `openclaw_tool_call_failures_total`, `openclaw_tool_call_duration_seconds`, `openclaw_tool_result_persist_total` | `timeseries`, `bar gauge`, `heatmap`, `table` | Overview Top-N；Detailed Agent / Tool | `topk(10, sum by (tool) (increase(openclaw_tool_calls_total{instance=~"$instance"}[1h])))`、`histogram_quantile(0.95, sum by (le) (rate(openclaw_tool_call_duration_seconds_bucket{instance=~"$instance"}[$__rate_interval])))` |
| Channels | `openclaw_channel_total`, `openclaw_channel_linked_total`, `openclaw_channel_accounts`, `openclaw_channel_failures_total`, `openclaw_channel_last_inbound_age_seconds`, `openclaw_channel_last_outbound_age_seconds` | `stat`, `timeseries`, `bar gauge`, `table` | Overview KPI + Attention；Detailed Channels / Instances / System | `sum(openclaw_channel_linked_total{instance=~"$instance"})`、`topk(10, sum by (channel) (increase(openclaw_channel_failures_total{instance=~"$instance"}[6h])))` |
| Cron | `openclaw_cron_total`, `openclaw_cron_running`, `openclaw_cron_overdue_seconds`, `openclaw_cron_consecutive_failures_total`, `openclaw_cron_last_duration_seconds` | `stat`, `timeseries`, `table`, `bar gauge` | Overview KPI；Detailed Channels / Instances / System | `sum(openclaw_cron_consecutive_failures_total{instance=~"$instance"})`、`topk(10, openclaw_cron_overdue_seconds{instance=~"$instance"})` |
| Skills | `openclaw_skill_total`, `openclaw_skill_active_total`, `openclaw_skill_by_category`, `openclaw_skill_invocations_by_name_total`, `openclaw_skill_errors_total` | `stat`, `bar gauge`, `timeseries` | Overview KPI；Detailed Channels / Instances / System | `sum(openclaw_skill_active_total{instance=~"$instance"})`、`topk(10, sum by (skill) (increase(openclaw_skill_invocations_by_name_total{instance=~"$instance"}[1h])))` |
| Nodes / Presence | `openclaw_node_total`, `openclaw_node_connected`, `openclaw_presence_total`, `openclaw_presence_by_channel` | `stat`, `bar gauge`, `timeseries` | Overview KPI；Detailed Channels / Instances / System | `sum(openclaw_node_connected{instance=~"$instance"})`、`topk(10, openclaw_presence_by_channel{instance=~"$instance"})` |
| Node.js Runtime | `openclaw_nodejs_heap_used_bytes`, `openclaw_nodejs_rss_bytes`, `openclaw_nodejs_event_loop_lag_ms`, `openclaw_nodejs_process_cpu_*_seconds_total` | `timeseries`, `stat` | Overview 趋势；Detailed Channels / Instances / System | `rate(openclaw_nodejs_process_cpu_user_seconds_total{instance=~"$instance"}[$__rate_interval])` |
| Diagnostics | `openclaw_diagnostic_model_*`, `openclaw_diagnostic_message_*`, `openclaw_diagnostic_queue_*`, `openclaw_diagnostic_session_*`, `openclaw_diagnostic_tool_loop_*`, `openclaw_diagnostic_webhook_*` | `timeseries`, `stat`, `bar gauge`, `table`, `heatmap` | Detailed Diagnostics / SLI | `sum by (provider, model) (rate(openclaw_diagnostic_model_usage_total{instance=~"$instance"}[$__rate_interval]))`、`histogram_quantile(0.95, sum by (le, lane) (rate(openclaw_diagnostic_queue_wait_seconds_bucket{instance=~"$instance"}[$__rate_interval])))` |

---

## Heatmap 约定

以下 histogram 应至少提供一个 percentile 折线图和一个热力图入口：

- `openclaw_metrics_http_request_duration_seconds`
- `openclaw_agent_run_duration_seconds`
- `openclaw_tool_call_duration_seconds`
- `openclaw_diagnostic_model_duration_seconds`
- `openclaw_diagnostic_webhook_duration_seconds`
- `openclaw_diagnostic_message_duration_seconds`
- `openclaw_diagnostic_queue_wait_seconds`
- `openclaw_diagnostic_session_stuck_age_seconds`

Prometheus 热力图查询模板：

```promql
sum by (le) (
  rate(metric_bucket{instance=~"$instance"}[$__rate_interval])
)
```

若要按维度分组：

```promql
sum by (le, tool) (
  rate(metric_bucket{instance=~"$instance"}[$__rate_interval])
)
```

---

## 变量约定

- `$DS_PROMETHEUS`：Prometheus 数据源
- `$instance`：`label_values(openclaw_up, instance)`

所有 Dashboard 查询默认使用：

```promql
{instance=~"$instance"}
```

这样既兼容单实例，也便于多实例场景下钻。
