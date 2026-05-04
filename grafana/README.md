# OpenClaw Grafana Dashboards

适用于 `@partme.ai/openclaw-prometheus` v0.3.0 的 Grafana Dashboard 集合。

本次重构的目标不是简单“把指标堆上墙”，而是让 Grafana 的信息层级尽量贴近 OpenClaw Control UI：

1. 概览页先展示状态、新鲜度和 KPI。
2. 详细页再按业务域下钻到 Sessions、Usage、Agent、Channels、Diagnostics。
3. histogram 指标同时提供 percentile 和分布视图。

## Dashboard 列表

| Dashboard | 用途 | 结构特点 |
|-----------|------|----------|
| [cluster/dashboard-overview.json](./cluster/dashboard-overview.json) | 生产概览 | 状态条、KPI、Attention、趋势、Top-N |
| [cluster/dashboard-metrics.json](./cluster/dashboard-metrics.json) | 详细分析 | 按业务域分章节下钻 |

## Overview 信息架构

`cluster/dashboard-overview.json` 按以下顺序组织：

1. `STATUS & FRESHNESS`
2. `KPI CARDS`
3. `ATTENTION & RELIABILITY`
4. `ACTIVITY TRENDS`
5. `TOP BREAKDOWN`

适合回答这些问题：

- Exporter / Gateway 当前是否正常
- 当前会话、成本、渠道、认证是否存在明显风险
- 流量与 token 是否正在增长
- 最近 1 小时最活跃的 provider / model / agent / tool 是谁

## Detailed 信息架构

`cluster/dashboard-metrics.json` 按业务域拆分为：

1. `EXPORTER / GATEWAY`
2. `SESSIONS / MESSAGE FLOW`
3. `USAGE / MODEL / AUTH`
4. `AGENT / TOOL`
5. `CHANNELS / INSTANCES / SYSTEM`
6. `SYSTEM / CRON / SKILLS`
7. `DIAGNOSTICS / SLI / HISTOGRAMS`

适合用于排查：

- Collector、HTTP、RPC、scrape 是否异常
- 会话消息流和 transcript / compaction / reset 是否异常波动
- Model / Provider 成本和认证是否有风险
- Agent / Tool 是否变慢、失败率是否上升
- Queue / Tool loop / Diagnostics 是否开始堆积

## 变量

| 变量 | 说明 | Query |
|------|------|-------|
| `$DS_PROMETHEUS` | Prometheus 数据源 | Grafana datasource variable |
| `$instance` | 实例筛选，兼容单实例和多实例 | `label_values(openclaw_up, instance)` |

## 图表选型基准

推荐结合 [COVERAGE_MATRIX.md](./COVERAGE_MATRIX.md) 使用：

- `stat`：单值状态、容量、异常数量
- `timeseries`：趋势、速率、SLI、P95/P99
- `bar gauge`：Top-N、按类比较、渠道/技能/工具排行
- `table`：Collector 健康、认证异常
- `heatmap`：histogram bucket 分布

## 导入方式

```bash
# Grafana -> Dashboards -> New -> Import -> Upload JSON
grafana/cluster/dashboard-overview.json
grafana/cluster/dashboard-metrics.json
```

推荐导入后检查：

1. Prometheus 数据源是否正确绑定到 `DS_PROMETHEUS`
2. `$instance` 是否能列出目标实例
3. 时间范围是否覆盖最近有流量的区间

## 相关文档

- [COVERAGE_MATRIX.md](./COVERAGE_MATRIX.md) - 指标家族与图表覆盖矩阵
- [CLUSTER.md](./CLUSTER.md) - Cluster 版使用说明
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - 故障排查
