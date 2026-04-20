# OpenClaw Grafana Dashboards - Cluster Edition

Ready-to-import Grafana dashboards for metrics from **`@partme.ai/openclaw-prometheus`** with **multi-instance support**.

The exporter is a **pure OpenClaw plugin**: metrics come from documented `api.runtime.*` helpers, plugin hooks, runtime events, and exporter-owned HTTP routes (see plugin [README](../README.md)).

---

## 📊 Cluster Dashboard Overview

参考 **RabbitMQ Grafana Dashboard** 的企业级设计风格，支持多实例切换和详细指标监控。

| Dashboard | 面板数 | 用途 | 场景 |
|-----------|--------|------|------|
| **[dashboard-overview.json](./dashboard-overview.json)** | 8 | 集群总览 | 生产环境 SLO 监控 + 性能分析 |
| **[dashboard-metrics.json](./dashboard-metrics.json)** | 10 | 详细指标 | 多实例性能对比 + 详细指标分析 |

---

## 🎯 Dashboard 1: Cluster Overview（8 个面板）

**文件**：`grafana/cluster/dashboard-overview.json`

**用途**：集群级别的 SLO 监控 + 系统健康概览

**面板列表**：

| 面板 | 类型 | 说明 | 变量 |
|------|------|------|--------|
| Cluster Health | Stat | 实例数、Up 状态、Ready 状态、Healthy 状态 | `$openclaw_instance` |
| System Status | Stat | 平均运行时间、Snapshot 年龄、Scrape 时长、指标基数 | - |
| Message Throughput | Graph | 发送/接收速率 | - |
| Agent Activity | Graph | 启动/失败速率 + 错误率 | - |
| Tool Activity | Graph | 调用速率 + 错误率 | - |
| Channel Health | Graph | 失败速率 + 健康率 | - |
| Metric Series | Gauge | 总指标基数（0~100K） | - |
| HTTP Latency | Gauge | P95/P99 延迟 | - |

**特性**：
- ✅ 支持 `$openclaw_instance` 变量（多实例切换）
- ✅ 彩色梯度显示（绿色=健康，黄色=警告，红色=错误）
- ✅ 实时 10s 刷新
- ✅ 企业级配色方案

---

## 🎯 Dashboard 2: Detailed Metrics（10 个面板）

**文件**：`grafana/cluster/dashboard-metrics.json`

**用途**：多实例详细性能分析

**面板列表**：

| 面板 | 类型 | 说明 | 变量 |
|------|------|------|--------|
| Agent Performance - All Instances | Timeseries | P95/P99 延迟（每个实例单独曲线） | `$openclaw_instance`（重复 3 次） |
| Tool Performance - All Instances | Timeseries | P95/P99 延迟（每个实例单独曲线） | `$openclaw_instance`（重复 3 次） |
| Message Throughput - All Instances | Graph | 发送/接收速率（每个实例单独曲线） | `$openclaw_instance`（重复 2 次） |
| Tool Calls Rate - All Instances | Timeseries | 调用速率（每个实例单独曲线） | - |
| HTTP Request Latency - All Instances | Timeseries | P95/P99 延迟（每个实例单独曲线） | `$openclaw_instance`（重复 2 次） |
| Channel Health - By Queue | Timeseries | 失败率 + 健康率（按队列分组） | `$openclaw_queue`（重复 3 次） |
| System Status - By Node | Timeseries | Up/Ready/Healthy 状态（按节点分组） | `$openclaw_node`（重复 3 次） |
| Collector Status - By Instance | Table | Scrape 时长 + 成功率（每个实例） | `$openclaw_instance`（重复 1 次） |
| HTTP Latency Buffer | Gauge | 缓冲区使用率（每个实例） | `$openclaw_instance`（重复 1 次） |
| Agent Run Distribution - By Instance | Timeseries | 启动/失败速率（每个实例） | `$openclaw_instance`（重复 1 次） |

**特性**：
- ✅ 支持 3 个变量（`$openclaw_instance`、`$openclaw_queue`、`$openclaw_node`）
- ✅ 按 Instance 重复显示（最多 3 个实例）
- ✅ Table 面板支持排序
- ✅ 实时 10s 刷新

---

## 🚀 多实例支持

### 变量配置

| 变量 | 类型 | 说明 | 值 |
|------|------|------|------|
| `$openclaw_instance` | Query | Instance 标签（支持多选） | `label_values(openclaw_up, instance)` |
| `$openclaw_queue` | Query | Queue 标签（支持多选） | `label_values(openclaw_channel, queue)` |
| `$openclaw_node` | Query | Node 标签（支持多选） | `label_values(openclaw_node, node)` |
| `$datasource` | Datasource | Prometheus 数据源 | `DS_PROMETHEUS` |

### 实例 Label 配置

在 **openclaw.plugin.json** 中设置：
```json
{
  "instance": "my-gateway-node-01"
}
```

在 **Prometheus scrape 配置** 中添加 `instance` label：
```yaml
scrape_configs:
  - job_name: 'openclaw'
    relabel_configs:
      - source_labels: [__address__]
        target_label: instance
        regex: '([^:]+)(:[0-9]+)?'
        replacement: '${1}'
```

---

## 🎨 设计参考：RabbitMQ Grafana Dashboard

### 1. 概览页（Overview）

类似 RabbitMQ 的 Overview Dashboard：
- **系统健康**：彩色状态卡片（绿色/黄色/红色）
- **关键指标**：消息吞吐、Agent 活跃度、工具调用速率
- **趋势图**：时间序列图，显示最近 1 小时的变化趋势

### 2. 详细指标页（Metrics）

类似 RabbitMQ 的 Metrics Dashboard：
- **多实例对比**：每个实例单独显示，便于横向对比
- **Percentile 分析**：P95/P99 延迟，使用 `histogram_quantile()`
- **分组视图**：按 Queue、Node 分组，便于管理大规模部署
- **表格视图**：Collector 状态、Agent 运行分布

### 3. 企业级特性

- **响应式设计**：1920x1080 + 2560x1440
- **彩色编码**：语义化颜色（红色=错误，黄色=警告，绿色=健康）
- **实时刷新**：10s 自动刷新
- **变量支持**：支持多实例、队列、节点切换

---

## 📋 导入步骤

### 1. 导入 Dashboard

```bash
# 方式 1：上传文件
grafana/import grafana/cluster/dashboard-overview.json
grafana/import grafana/cluster/dashboard-metrics.json

# 方式 2：粘贴 JSON
cat grafana/cluster/dashboard-overview.json | xclip
# 在 Grafana 界面中粘贴
```

### 2. 配置数据源

- **DS_PROMETHEUS**：URL `http://localhost:9090`
- **Scrape Interval**：10s（与 Dashboard 刷新同步）
- **Time Range**：Last 15 minutes（Overview）、Last 1 hour（Metrics）

### 3. 选择实例

- 使用 `$openclaw_instance` 变量选择 1 个或多个实例
- 使用 `$openclaw_queue` 变量过滤特定队列
- 使用 `$openclaw_node` 变量过滤特定节点

---

## 🔧 自定义建议

### 1. 添加更多指标

在 `dashboard-overview.json` 中添加：
- Node.js 进程指标（`openclaw_nodejs_*`）
- 集群聚合指标（跨实例统计）

### 2. 调整布局

- 修改 `gridPos` 调整面板位置
- 使用 `row` / `col` 组织面板分组
- 使用 `collapsed: true` 默认折叠复杂面板

### 3. 添加告警规则

在 `dashboard-overview.json` 中添加：
- **Annotation**：链接到 Alertmanager
- **Panel Links**：快速跳转到详情面板

---

## 🎯 推荐使用场景

### 场景 1：单实例监控

**使用**：`dashboard-overview.json`

**原因**：
- 单实例无需复杂变量切换
- 概览页面简洁直观

**配置**：
- 选择 `All` 作为 `$openclaw_instance` 值

---

### 场景 2：多实例监控（推荐）

**使用**：`dashboard-metrics.json`

**原因**：
- 支持横向对比多个实例
- 详细指标分析更灵活

**配置**：
- 选择 2~3 个实例作为 `$openclaw_instance` 值
- 使用 `$openclaw_queue` 过滤特定队列

---

### 场景 3：大规模集群（>10 实例）

**使用**：`dashboard-metrics.json`

**原因**：
- 按实例分组显示，避免面板过于复杂
- 表格视图便于快速定位问题实例

**配置**：
- 使用 `$openclaw_node` 按节点分组查看
- 调整 `maxPerRow` 增加每行显示数量

---

## 📊 指标参考

### SLO 比率指标

| 指标 | 说明 | 计算 | 告警阈值 |
|------|------|------|----------|
| `openclaw_sli_message_success_ratio` | 消息成功率 | `sent_ok / (sent_ok + sent_error)` | < 0.95 |
| `openclaw_sli_agent_error_ratio` | Agent 错误率 | `agent_failed / agent_started` | > 0.1 |
| `openclaw_sli_tool_error_ratio` | 工具错误率 | `tool_failures / tool_total` | > 0.05 |
| `openclaw_sli_channel_health_ratio` | 渠道健康率 | `linked / total` | < 0.95 |

### 性能指标

| 指标 | 说明 | 聚合 | 告警阈值 |
|------|------|------|----------|
| `openclaw_agent_run_duration_seconds` | Agent 运行时长（Histogram） | `histogram_quantile(0.95, rate(..._bucket[5m]))` | > 300s |
| `openclaw_tool_call_duration_seconds` | 工具调用时长（Histogram） | `histogram_quantile(0.95, rate(..._bucket[5m]))` | > 10s |
| `openclaw_sli_http_request_p95_seconds` | HTTP 请求 P95 延迟（Gauge） | 直接查询 | > 0.5s |

### 健康指标

| 指标 | 说明 | 告警阈值 |
|------|------|----------|
| `openclaw_up` | 插件加载状态 | = 0 |
| `openclaw_ready` | 插件初始化状态 | = 0 |
| `openclaw_gateway_healthz_healthy` | 整体健康状态 | = 0 |
| `openclaw_runtime_snapshot_age_seconds` | Snapshot 年龄 | > 60s |

---

## 🎨 界面特性

### 配色方案

| 级别 | 颜色 | 说明 | 场景 |
|------|------|------|------|
| **正常** | 绿色 (#73BF69) | 所有指标正常 | 生产环境 |
| **警告** | 黄色 (#FFD700) | SLO 接近阈值但未突破 | 预警 |
| **错误** | 红色 (#FF3B30) | SLO 突破或系统不可用 | 紧急 |

### 布局优化

| 优化项 | 说明 |
|------|------|
| **紧凑布局** | 使用 `gridPos` 精确定位面板 |
| **隐藏图例** | `legend.displayMode: "hidden"` 减少干扰 |
| **固定时间范围** | `time.from: "now-15m"` 避免频繁查询 |
| **表格排序** | `sortBy: [{ desc: true, displayName: "Instance" }]` 便于快速定位 |

---

## 🔍 高级功能

### 1. 跨实例聚合

在 Dashboard 中添加跨实例统计面板：
```promql
# 总消息吞吐（所有实例）
sum(rate(openclaw_session_messages_sent_total{result="ok"}[5m]))

# 总 Agent 启动率（所有实例）
sum(rate(openclaw_agent_runs_started_total[5m]))
```

### 2. 拓扑视图

使用实例和节点变量创建拓扑图：
- **中心节点**：所有 OpenClaw 实例
- **连接关系**：通过 `channel`、`node` 标签关联
- **状态显示**：每个节点的 Up/Ready/Healthy 状态

### 3. 资源利用率

添加 Node.js 进程和内存监控：
```promql
# CPU 使用率
sum(rate(openclaw_nodejs_process_cpu_user_seconds_total{instance=~\"$openclaw_instance\"}[5m]))

# 内存使用量
sum(openclaw_nodejs_heap_used_bytes{instance=~\"$openclaw_instance\"})

# 事件循环延迟
avg(openclaw_nodejs_event_loop_lag_ms{instance=~\"$openclaw_instance\"})
```

---

## 🚀 部署建议

### 1. 单实例部署

```bash
# 1. 导入 Dashboard
grafana/import grafana/cluster/dashboard-overview.json

# 2. 配置数据源
# 在 Grafana 界面中添加 Prometheus 数据源：http://localhost:9090

# 3. 设置变量
# 将 `$openclaw_instance` 设置为 `All`
```

### 2. 多实例部署（推荐）

```bash
# 1. 导入 Dashboard
grafana/import grafana/cluster/dashboard-metrics.json

# 2. 配置数据源
# 添加 Prometheus 数据源：http://prometheus-server:9090

# 3. 设置变量
# 在 Prometheus scrape 配置中添加 `instance` label：
scrape_configs:
  - job_name: 'openclaw'
    static_configs:
      - targets: ['gateway-01:9090', 'gateway-02:9090']
    relabel_configs:
      - source_labels: [__address__]
        target_label: instance
        regex: '([^:]+)(:[0-9]+)?'
        replacement: '${1}'

# 4. 在 Grafana 中选择多个实例
# 使用 `$openclaw_instance` 变量选择 2~3 个实例
```

### 3. Kubernetes 部署

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-openclaw-dashboards
data:
  dashboard-overview.json: |
    { "uid": "openclaw-cluster-overview", "title": "OpenClaw - Cluster Overview" }
  dashboard-metrics.json: |
    { "uid": "openclaw-cluster-metrics", "title": "OpenClaw - Detailed Metrics" }
---
apiVersion: v1
kind: Deployment
metadata:
  name: grafana
spec:
  template:
    spec:
      containers:
        - name: grafana
          env:
            - name: GF_INSTALL_PLUGINS
              value: "openclaw-prometheus"
            - name: GF_DASHBOARDS_JSON_TO_IMPORT
              value: "/etc/grafana/provisioning/dashboards/dashboard-overview.json"
```

---

## 📚 文档更新历史

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| v1.0 | 2026-04-20 | 初始版本，创建 2 个集群 Dashboard |
| v1.1 | 2026-04-20 | 添加 RabbitMQ 设计参考 + 变量说明 |
| v1.2 | 2026-04-20 | 添加部署建议 + 高级功能 |

---

## 🎯 快速开始

### 1. 最小化配置（5 分钟）

```bash
# 导入 Dashboard
# 访问 Grafana → Dashboards → New → Import
# 上传 `grafana/cluster/dashboard-overview.json`
# 设置数据源：http://localhost:9090
# 保存 Dashboard
```

### 2. 推荐配置（15 分钟）

```bash
# 导入 Dashboard
# 上传 `grafana/cluster/dashboard-overview.json` 和 `grafana/cluster/dashboard-metrics.json`

# 配置变量
# `$openclaw_instance` = All（查看集群总览）
# `$openclaw_instance` = 具体实例名（查看单实例详情）

# 设置刷新间隔
# 在 Dashboard 右上角选择 10s
# 设置时间范围
# Last 15 minutes（Overview）、Last 1 hour（Metrics）
```

---

## 💡 最佳实践

### 1. 性能优化

- **使用实例变量**：减少查询返回的数据量
- **设置合理的时间范围**：避免查询过长历史
- **禁用不使用的面板**：使用 `collapsed: true` 默认折叠

### 2. 告警配置

- **基于 SLO**：使用 SLO 比率指标设置告警
- **合理阈值**：参考文档中的告警阈值
- **告警分组**：使用 `category` 标签分类

### 3. 可视化优化

- **使用阈值显示**：为关键指标设置彩色阈值
- **使用表格视图**：便于快速定位问题
- **使用时间序列图**：便于观察趋势

---

## 🔗 相关资源

- **OpenClaw 文档**：https://docs.openclaw.ai
- **Prometheus 文档**：https://prometheus.io/docs
- **Grafana 文档**：https://grafana.com/docs
- **RabbitMQ Dashboard 参考**：https://grafana.com/grafana/dashboards/4371-rabbitmq-metrics/

---

**适用场景**：
- **生产环境**：推荐使用 `dashboard-metrics.json`（详细指标 + 多实例支持）
- **开发环境**：推荐使用 `dashboard-overview.json`（简洁概览）
- **大规模集群**：推荐使用 `dashboard-metrics.json` + 自定义变量（按节点/队列分组）

**版本兼容性**：
- **Grafana 10.x+**：Schema Version 39
- **Prometheus 2.45+**：支持 `histogram_quantile()`
- **OpenClaw 0.2.9+**：支持 Instance Label
