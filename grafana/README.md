# OpenClaw Grafana dashboards

Ready-to-import Grafana dashboard JSON for metrics exposed by `@partme.ai/openclaw_prometheus` (Prometheus scrape).

| File | Use case |
|------|----------|
| [openclaw-gateway-single.json](./openclaw-gateway-single.json) | One Gateway / one scrape target; no `instance` filter. |
| [openclaw-gateway-cluster.json](./openclaw-gateway-cluster.json) | Multiple Gateways; uses `instance` label and multi-select. |

## Import

1. Grafana → **Dashboards** → **New** → **Import** → upload JSON, or paste contents.
2. Select your **Prometheus** data source when prompted (template variable `datasource`).
3. Save.

**Tested schema:** Grafana 10.x (`schemaVersion` 39). Older Grafana may require minor panel edits.

## Prometheus labels

- **Cluster dashboard** expects a **`instance`** label on all `openclaw_*` series (Prometheus adds this automatically per scrape target, e.g. `host:port`).
- If your scrape config uses another label for node identity (e.g. `pod`), either:
  - add a **relabel** rule to copy it to `instance`, or
  - edit the dashboard variable query from `label_values(openclaw_up, instance)` to your label, and replace `instance=~"$instance"` in panels with your label name.

## Queries

- Panels use metrics such as `openclaw_up`, `openclaw_usage_provider_*`, `openclaw_channel_*`, `openclaw_nodejs_*`. See plugin [README](../README.md) for the full metric list.

## 中文说明

- **单节点**：导入 `openclaw-gateway-single.json`，适用于只有一个 Gateway 暴露指标端点。
- **集群**：导入 `openclaw-gateway-cluster.json`，通过变量 **Instance** 筛选多个抓取目标；多选「All」时使用正则匹配全部实例。
- 若 Prometheus 目标上没有 `instance` 标签，请用 relabel 对齐或按上文修改变量与查询中的标签名。
