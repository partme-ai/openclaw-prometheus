# OpenClaw Grafana dashboards

Ready-to-import Grafana dashboard JSON for metrics exposed by `@partme.ai/openclaw-prometheus`.

The current exporter is built on the official OpenClaw plugin SDK. Dashboards should therefore focus on:

- exporter self health
- model-auth health
- channel activity
- agent / tool / usage workload metrics
- Prometheus for aggregates and Loki for historical logs

| File | Use case |
|------|----------|
| [openclaw-gateway-single.json](./openclaw-gateway-single.json) | One Gateway / one scrape target; no `instance` filter. |
| [openclaw-gateway-cluster.json](./openclaw-gateway-cluster.json) | Multiple Gateways; uses `instance` label and multi-select. |

## Import

1. Grafana → **Dashboards** → **New** → **Import** → upload JSON, or paste contents.
2. On the import screen, map **`DS_PROMETHEUS`** to your **Prometheus** data source.
3. If you want log history panels, also map **`DS_LOKI`** to your **Loki** data source.
4. Click **Import** / **Save**.

The JSON uses the **classic dashboard model** (`panels` + `gridPos`, `schemaVersion` ≥ 17) with portable **`__inputs`**. It is **not** the pre–Grafana 4 layout that used top-level **`rows`**.

### Troubleshooting

- **`Old dashboard JSON format` / link to Grafana 2.x–3.x import docs**  
  You are likely pasting **API response JSON** (`{ "meta": {...}, "dashboard": {...} }`) or another wrapper. For import, use **only** the dashboard object: either paste the contents of these `.json` files as-is, or paste only the inner `"dashboard"` object if you copied from the HTTP API.

- **Grafana 12+ / “Kubernetes dashboards”**  
  If your org uses the newer resource-only import UI, import via **Dashboards → New → Import** and upload this file; avoid mixing with raw v2-only flows unless your admin requires them.

**Tested schema:** Grafana 10.x+ (`schemaVersion` 39). Older Grafana may require minor panel edits.

## Prometheus labels

- **Cluster dashboard** expects a **`instance`** label on all `openclaw_*` series (Prometheus adds this automatically per scrape target, e.g. `host:port`).
- If your scrape config uses another label for node identity (e.g. `pod`), either:
  - add a **relabel** rule to copy it to `instance`, or
  - edit the dashboard variable query from `label_values(openclaw_up, instance)` to your label, and replace `instance=~"$instance"` in panels with your label name.

## Queries

- Panels should prefer metrics such as `openclaw_up`, `openclaw_ready`, `openclaw_metrics_*`, `openclaw_model_auth_*`, `openclaw_channel_*`, `openclaw_agent_*`, `openclaw_tool_*`, `openclaw_usage_*`, and `openclaw_nodejs_*`. See plugin [README](../README.md) for the current metric list.
- Historical logs should come from Loki rather than Prometheus text metrics.

## 中文说明

- **单节点**：导入 `openclaw-gateway-single.json`，适用于只有一个 Gateway 暴露指标端点。
- **集群**：导入 `openclaw-gateway-cluster.json`，通过变量 **Instance** 筛选多个抓取目标；多选「All」时使用正则匹配全部实例。导入时在向导里为 **`DS_PROMETHEUS`** 选择你的 Prometheus 数据源。
- 如需日志历史，请同时为 **`DS_LOKI`** 绑定 Loki 数据源；日志不要通过 Prometheus 指标承载。
- 若出现 **「Old dashboard JSON format」**：请直接上传仓库中的 `.json` 文件或粘贴**完整文件内容**，不要粘贴 API 返回的外层 `{ "meta", "dashboard" }` 整段；仅需内层 `dashboard` 对象时，只粘贴 `dashboard` 里的 JSON。
- 若 Prometheus 目标上没有 `instance` 标签，请用 relabel 对齐或按上文修改变量与查询中的标签名。
