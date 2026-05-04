# OpenClaw Grafana Dashboards — Cluster Edition

面向 `@partme.ai/openclaw-prometheus` 的 Cluster 版 Grafana 仪表盘说明。

## 设计目标

Cluster 版重点解决两个问题：

1. **多实例可筛选**：统一使用 `$instance` 变量做实例级下钻。
2. **图表与业务语义一致**：不再混排指标，而是按 OpenClaw UI 的监控心智和业务域组织。

## 变量约定

| 变量 | 说明 | Query |
|------|------|-------|
| `$DS_PROMETHEUS` | Prometheus 数据源 | Grafana datasource |
| `$instance` | 实例筛选 | `label_values(openclaw_up, instance)` |

所有 PromQL 默认带：

```promql
{instance=~"$instance"}
```

## Dashboard 1: Overview

**文件**：`cluster/dashboard-overview.json`

概览页强调“先看是否健康，再看哪里值得点进去”：

| 区域 | 关注点 |
|------|--------|
| `STATUS & FRESHNESS` | Exporter / Gateway 是否在线，采集是否变慢，快照是否陈旧 |
| `KPI CARDS` | Sessions、Tokens、Cost、Channels、Skills、Cron、Auth |
| `ATTENTION & RELIABILITY` | Collector 失败、认证异常、SLI 波动 |
| `ACTIVITY TRENDS` | 消息流量、token 吞吐、HTTP 延迟、Node 资源 |
| `TOP BREAKDOWN` | 最近最活跃的 provider / model / agent / tool |

## Dashboard 2: Detailed Metrics

**文件**：`cluster/dashboard-metrics.json`

详细页用于排查与归因：

| 区域 | 关注点 |
|------|--------|
| `EXPORTER / GATEWAY` | Collector 健康、scrape、HTTP、RPC |
| `SESSIONS / MESSAGE FLOW` | 会话规模、消息速率、transcript / reset / compaction |
| `USAGE / MODEL / AUTH` | Provider / Model token 与 cost、认证剩余时间、认证异常 |
| `AGENT / TOOL` | Agent 运行速率、P50/P95/P99、Tool 调用和失败 |
| `CHANNELS / INSTANCES / SYSTEM` | 渠道健康、账号数、节点与 presence |
| `SYSTEM / CRON / SKILLS` | Node.js 资源、Cron 延迟、技能分布与错误 |
| `DIAGNOSTICS / SLI / HISTOGRAMS` | SLI、queue、tool loop、heatmap 分布 |

## 图表选型

本目录的 Dashboard 约定如下：

- `stat`：状态和容量，例如 `openclaw_up`、`openclaw_model_auth_providers_expired_total`
- `timeseries`：速率、趋势、P95/P99，例如 `rate(...)`、`histogram_quantile(...)`
- `bar gauge`：Top-N 与低基数比较，例如 tool / model / provider / skill 排行
- `table`：Collector 和认证异常明细
- `heatmap`：队列等待、Agent 时长等 histogram bucket 分布

更完整的映射见 [COVERAGE_MATRIX.md](./COVERAGE_MATRIX.md)。

## Quick Import

```bash
# Grafana -> Dashboards -> New -> Import
# Upload:
#   grafana/cluster/dashboard-overview.json
#   grafana/cluster/dashboard-metrics.json
# Bind the Prometheus datasource
```

## 导入后建议

1. 先在 Overview 检查 `Exporter Up`、`Plugin Ready`、`Gateway Up` 是否为绿色。
2. 再切换 `$instance`，确认多实例筛选不会让面板空掉。
3. 若 Diagnostics 面板暂无数据，优先确认 OpenClaw diagnostics 是否开启，以及是否真的产生了相关事件。

## Version

v3.0 — 2026-05-04 — 按 OpenClaw Overview / Usage / Sessions / Debug 心智重构，补齐 SLI、Diagnostics、Top-N 与 histogram 视图。
