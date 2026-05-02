# OpenClaw Grafana Dashboards

Ready-to-import Grafana dashboards for metrics from **`@partme.ai/openclaw-prometheus`**.

The exporter is a **pure OpenClaw plugin**: metrics come from documented `api.runtime.*` helpers, plugin hooks, runtime events, and exporter-owned HTTP routes (see plugin [README](../README.md)).

---

## 📊 Dashboard Overview

| Dashboard | Panels | Type | Use Case |
|-----------|---------|------|----------|
| **[cluster/dashboard-overview.json](./cluster/dashboard-overview.json)** | 8 | Cluster Overview | **Production-ready.** Multi-instance SLO monitoring with instance switching. Recommended for production. |
| **[cluster/dashboard-metrics.json](./cluster/dashboard-metrics.json)** | 10 | Detailed Metrics | **Production-ready.** Multi-instance detailed metrics with repeat panels. Recommended for production. |

---

## 🎯 Dashboard 1: Cluster Overview

**File**: `cluster/dashboard-overview.json`

**Panels**: 8

| Panel | Type | Description |
|-------|------|-------------|
| Cluster Health | Stat | Instance count / Up / Ready / Healthy status |
| System Status | Stat | Avg uptime / Snapshot age / Scrape time |
| Message Throughput | Graph | Sent / Received / Error rates |
| Agent Activity | Graph | Started / Failed / Error rate |
| Tool Activity | Graph | Calls / Failures / Error rate |
| Channel Health | Graph | Failure rate / Health ratio |
| Metric Series | Gauge | Total series count (cardinality) |
| HTTP Latency | Gauge | P95 / P99 latency |

**Features**:
- ✅ Supports `$openclaw_instance` variable (multi-instance switching)
- ✅ Color-coded thresholds (green/yellow/red)
- ✅ Real-time 10s refresh
- ✅ Professional styling (lineWidth 2, fillOpacity 0.1)

---

## 🎯 Dashboard 2: Detailed Metrics

**File**: `cluster/dashboard-metrics.json`

**Panels**: 10

| Panel | Type | Description |
|-------|------|-------------|
| Agent Performance - All Instances | Timeseries | P95/P99 latency per instance (repeated 3x) |
| Tool Performance - All Instances | Timeseries | P95/P99 latency per instance (repeated 3x) |
| Message Throughput - All Instances | Graph | Sent/Received rate per instance (repeated 2x) |
| Channel Health - By Queue | Timeseries | Failure rate / Health ratio per queue (repeated 3x) |
| System Status - By Node | Timeseries | Up/Ready/Uptime per node (repeated 3x) |
| Collector Status - By Instance | Table | Scrape time / Success rate per instance (repeated 2x) |
| HTTP Request Latency - All Instances | Timeseries | P95/P95 latency per instance (repeated 2x) |
| Metric Series - By Instance | Graph | Total series count per instance (repeated 2x) |
| Agent Run Distribution - By Instance | Timeseries | Started/Failed rate per instance (repeated 1x) |

**Features**:
- ✅ Supports 3 variables: `$openclaw_instance`, `$openclaw_queue`, `$openclaw_node`
- ✅ Repeat panels for multi-instance comparison
- ✅ Table views for collector status
- ✅ Real-time 10s refresh
- ✅ Professional styling (lineWidth 2, fillOpacity 0.1)

---

## 🚀 Multi-Instance Support

### Variable Configuration

| Variable | Type | Query | Description |
|----------|------|--------|-------------|
| `$openclaw_instance` | Query | `label_values(openclaw_up, instance)` | Switch between all instances |
| `$openclaw_queue` | Query | `label_values(openclaw_channel, queue)` | Filter by channel/queue |
| `$openclaw_node` | Query | `label_values(openclaw_node, node)` | Filter by node (if configured) |

### Instance Label Setup

**Option 1: Environment Variable**
```bash
export INSTANCE="my-gateway-node-01"
```

**Option 2: Prometheus Relabel Config**
```yaml
scrape_configs:
  - job_name: 'openclaw'
    relabel_configs:
      - source_labels: [__address__]
        target_label: instance
        regex: '([^:]+)(:[0-9]+)?'
        replacement: '${1}'
```

**Option 3: Kubernetes Config**
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: openclaw-prometheus
spec:
  containers:
    - name: openclaw-prometheus
      env:
        - name: INSTANCE
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
```

---

## 🎨 Dashboard Design

### Color Scheme

| Level | Color | Scenario |
|-------|-------|----------|
| **Normal** | Green (#73BF69) | All metrics OK |
| **Warning** | Yellow (#FFD700) | SLO near threshold |
| **Error** | Red (#FF3B30) | SLO breached or system down |

### Layout

- **Grid-based**: 4 columns, responsive (1920x1080 + 2560x1440)
- **Collapsed panels**: Complex panels collapsed by default (expandable)
- **Table sorting**: Collector status table sorted by instance
- **Time sync**: Browser local timezone, 10s refresh

---

## 📊 Metric Reference

### SLO Ratios

| Metric | Description | Calculation | Alert Threshold |
|--------|-------------|-------------|------------------|
| `openclaw_sli_message_success_ratio` | Message success rate | `sent_ok / (sent_ok + sent_error)` | < 0.95 |
| `openclaw_sli_agent_error_ratio` | Agent error rate | `agent_failed / agent_started` | > 0.1 |
| `openclaw_sli_tool_error_ratio` | Tool error rate | `tool_failures / tool_total` | > 0.05 |
| `openclaw_sli_channel_health_ratio` | Channel health rate | `linked / total` | < 0.95 |

### Performance Metrics

| Metric | Type | Query | Alert Threshold |
|--------|------|--------|------------------|
| `openclaw_agent_run_duration_seconds` | Histogram | `histogram_quantile(0.95, rate(..._bucket[5m]))` | > 300s |
| `openclaw_tool_call_duration_seconds` | Histogram | `histogram_quantile(0.95, rate(..._bucket[5m]))` | > 10s |
| `openclaw_sli_http_request_p95_seconds` | Gauge | Direct query | > 0.5s |
| `openclaw_sli_http_request_p99_seconds` | Gauge | Direct query | > 1s |

### Health Metrics

| Metric | Description | Alert Threshold |
|--------|-------------|------------------|
| `openclaw_up` | Plugin loaded status | = 0 |
| `openclaw_ready` | Plugin initialized status | = 0 |
| `openclaw_gateway_healthz_healthy` | Overall health status | = 0 |
| `openclaw_runtime_snapshot_age_seconds` | Snapshot staleness | > 60s |
| `openclaw_metrics_series_total` | Metric cardinality | > 100K |

---

## 📋 Import Steps

### 1. Import Dashboards

```bash
# Option 1: Upload files
grafana/import cluster/dashboard-overview.json
grafana/import cluster/dashboard-metrics.json

# Option 2: Paste JSON
cat cluster/dashboard-overview.json | xclip
cat cluster/dashboard-metrics.json | xclip
# In Grafana UI: Dashboards → New → Import → Paste JSON
```

### 2. Configure Data Source

- **DS_PROMETHEUS**: `http://localhost:9090`
- **Scrape Interval**: 10s (syncs with dashboard refresh)
- **Time Range**:
  - Overview Dashboard: Last 15 minutes
  - Metrics Dashboard: Last 1 hour

### 3. Select Instance

1. Click the dropdown arrow next to the dashboard title
2. Select an instance from `$openclaw_instance` variable
3. All panels will filter to show only that instance
4. To view all instances: Select `All` from the dropdown

---

## 🔧 Customization

### 1. Add More Metrics

In `cluster/dashboard-overview.json` add:
- Node.js process metrics (`openclaw_nodejs_*`)
- Memory usage trends
- Event loop latency (`openclaw_nodejs_event_loop_lag_ms`)

### 2. Add Cross-Instance Aggregation

Add summary panels:
```promql
# Total throughput (all instances)
sum(rate(openclaw_session_messages_sent_total{result="ok"}[5m]))

# Average error rate (all instances)
avg(openclaw_sli_agent_error_ratio)

# Total active sessions (all instances)
sum(openclaw_sessions_active_estimated)
```

### 3. Add Topology View

Use instance and node variables to create a network topology:
- **Center node**: All instances
- **Connections**: Channels linking instances
- **Status**: Color-coded by health status

---

## 📈 Performance Tuning

### 1. Reduce Query Load

- Use specific time ranges: `time > now-1h` instead of `time > now-24h`
- Set reasonable refresh intervals: 10s (Overview), 30s (Metrics)
- Use table legends: `displayMode: "table"` instead of `displayMode: "list"`

### 2. Optimize Repeat Panels

- Set `collapsed: true` for complex repeat panels
- Limit `maxPerRow` to 3-4 panels per row
- Use `min_span: 12` for better comparison

### 3. Cache Variable Results

- Set `refresh: 2` for variable queries (less frequent)
- Use `allValue: "All"` instead of `null` (avoid empty states)
- Enable `multi: false` for single-select variables

---

## 🚀 Deployment

### 1. Single-Instance Deployment

**Dashboard**: `cluster/dashboard-overview.json`

**Configuration**:
- Select `All` from `$openclaw_instance` variable
- Time range: Last 15 minutes

**Reason**: Simplified view, no complex variable switching needed.

### 2. Multi-Instance Deployment (Recommended)

**Dashboard**: `cluster/dashboard-metrics.json`

**Configuration**:
- Select 2-3 instances from `$openclaw_instance` variable
- Use `$openclaw_queue` to filter by channel
- Use `$openclaw_node` to filter by node

**Reason**: Detailed metrics comparison, ideal for production monitoring.

### 3. Kubernetes Deployment

**ConfigMap**: Configure instance label from pod metadata
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: openclaw-prometheus-config
data:
  INSTANCE_NAME: "my-gateway-01"
```

**Deployment**: Mount ConfigMap as environment variable
```yaml
apiVersion: v1
kind: Deployment
metadata:
  name: openclaw-prometheus
spec:
  template:
    spec:
      containers:
        - name: openclaw-prometheus
          env:
            - name: INSTANCE
              valueFrom:
                configMapKeyRef:
                  name: openclaw-prometheus-config
                  key: INSTANCE_NAME
```

---

## 🔍 Troubleshooting

### 1. Empty Panels

**Problem**: Panels show "No Data"

**Solution**:
1. Check Prometheus scrape interval: `curl http://localhost:9090/metrics | grep openclaw_up`
2. Verify instance label is set: `curl http://localhost:9090/metrics | grep 'instance="'`
3. Check dashboard time range: Should be `now-1h` or `now-15m`

### 2. No Variable Options

**Problem**: `$openclaw_instance` dropdown shows "No options"

**Solution**:
1. Verify instance label is exported: Check `openclaw.plugin.json` has `instance` field
2. Check Prometheus relabel config: Verify `target_label: instance` is set
3. Wait 2 scrape intervals: Variables refresh every 2s

### 3. High Cardinality

**Problem**: Dashboard loading is slow

**Solution**:
1. Reduce time range: Use Last 1 hour instead of Last 7 days
2. Use `$openclaw_instance` variable: Filter to single instance
3. Review high-cardinality labels: `agent_id`, `channel`, `account`

### 4. Wrong Data

**Problem**: Instance shows metrics from another instance

**Solution**:
1. Verify Prometheus relabel regex: `'([^:]+)(:[0-9]+)?'`
2. Check for duplicate scrape targets: Ensure each target has unique `__address__`
3. Use `label_values(openclaw_up{job="openclaw"}, instance)` (add job filter)

---

## 🎯 Best Practices

### 1. Dashboard Organization

- **Group related panels**: Use rows/cols to organize (e.g., "Health", "Performance", "Metrics")
- **Collapsible sections**: Use `collapsed: true` for complex sections (expand on demand)
- **Consistent naming**: Use descriptive titles (e.g., "Agent Performance" instead of "Metrics")

### 2. Variable Usage

- **Single-select for primary filters**: `$openclaw_instance` (choose one at a time)
- **Multi-select for secondary filters**: `$openclaw_queue`, `$openclaw_node`
- **Include "All" option**: Allows viewing aggregate metrics

### 3. Query Optimization

- **Use label filters**: `{instance=~"$openclaw_instance"}` instead of no filter
- **Use rate functions**: `rate(...[5m])` for per-second calculations
- **Avoid full scans**: Use specific metric names instead of regex patterns

### 4. Alert Integration

- **Link to Alertmanager**: Use annotation panel to link alerts
- **Use alert variables**: `$alertname`, `$alertseverity`
- **Show alert count**: Stat panel showing number of active alerts

---

## 📚 Related Resources

- **OpenClaw Documentation**: https://docs.openclaw.ai
- **Prometheus Documentation**: https://prometheus.io/docs
- **Grafana Documentation**: https://grafana.com/docs
- **Plugin README**: [../README.md](../README.md)
- **Architecture Doc**: [../ARCHITECTURE.md](../ARCHITECTURE.md)
- **Alert Rules**: [../alerts/prometheus.yml](../alerts/prometheus.yml)
- **Config Template**: [../config/prometheus.example.yaml](../config/prometheus.example.yaml)

---

## 📝 Version History

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | 2026-04-20 | Initial cluster edition with 2 dashboards (Overview + Metrics), supporting multi-instance switching via `$openclaw_instance`, `$openclaw_queue`, and `$openclaw_node` variables |
