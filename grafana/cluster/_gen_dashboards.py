#!/usr/bin/env python3
"""生成与 OpenClaw 原生 UI 对齐的 Grafana Dashboard JSON（概览 + 使用情况）。"""
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent


def ds():
    return {"type": "prometheus", "uid": "${DS_PROMETHEUS}"}


def nz(inner: str) -> str:
    """PromQL：无匹配序列时返回单点 0，避免 Stat 整块无数据。"""
    return f"({inner}) or vector(0)"


def row(title, y, rid):
    return {
        "collapsed": False,
        "gridPos": {"h": 1, "w": 24, "x": 0, "y": y},
        "id": rid,
        "panels": [],
        "title": title,
        "type": "row",
    }


def stat_panel(
    pid,
    title,
    expr,
    grid,
    unit="short",
    graph="area",
    text_mode="value_and_name",
    desc="",
    mappings=None,
    thresholds=None,
    decimals=None,
):
    fc = {
        "defaults": {
            "color": {"mode": "background"},
            "unit": unit,
            "noValue": "0",
        },
        "overrides": [],
    }
    if decimals is not None:
        fc["defaults"]["decimals"] = decimals
    if mappings:
        fc["defaults"]["mappings"] = mappings
        fc["defaults"]["color"] = {"mode": "thresholds"}
    if thresholds:
        fc["defaults"]["thresholds"] = thresholds
    return {
        "id": pid,
        "type": "stat",
        "title": title,
        "description": desc,
        "gridPos": grid,
        "datasource": ds(),
        "fieldConfig": fc,
        "options": {
            "colorMode": "background",
            "graphMode": graph,
            "justifyMode": "center",
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "textMode": text_mode,
        },
        "targets": [{"expr": expr, "refId": "A"}],
    }


def ts_panel(pid, title, targets, grid, unit="short", stacked=False):
    custom = {
        "drawStyle": "line",
        "fillOpacity": 12 if stacked else 8,
        "lineWidth": 2,
        "showPoints": "never",
        "spanNulls": True,
        "stacking": {"group": "A", "mode": "normal" if stacked else "none"},
    }
    return {
        "id": pid,
        "type": "timeseries",
        "title": title,
        "gridPos": grid,
        "datasource": ds(),
        "fieldConfig": {
            "defaults": {
                "color": {"mode": "palette-classic"},
                "custom": custom,
                "min": 0,
                "unit": unit,
            },
            "overrides": [],
        },
        "options": {
            "legend": {"calcs": ["lastNotNull"], "displayMode": "table", "placement": "bottom", "showLegend": True},
            "tooltip": {"mode": "multi", "sort": "desc"},
        },
        "targets": targets,
    }


def heatmap_panel(pid, title, expr, grid):
    """Prometheus histogram → Grafana heatmap。"""
    return {
        "id": pid,
        "type": "heatmap",
        "title": title,
        "gridPos": grid,
        "datasource": ds(),
        "fieldConfig": {"defaults": {"color": {"mode": "scheme"}}, "overrides": []},
        "options": {
            "calculate": False,
            "color": {"mode": "scheme", "scheme": "Oranges"},
            "legend": {"show": True},
            "tooltip": {"show": True},
        },
        "targets": [
            {
                "expr": expr,
                "format": "heatmap",
                "legendFormat": "{{le}}",
                "refId": "A",
            }
        ],
    }


def bar_panel(pid, title, expr, legend, grid, unit="short"):
    return {
        "id": pid,
        "type": "bargauge",
        "title": title,
        "gridPos": grid,
        "datasource": ds(),
        "fieldConfig": {"defaults": {"unit": unit, "min": 0}, "overrides": []},
        "options": {
            "displayMode": "basic",
            "orientation": "horizontal",
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "showUnfilled": False,
        },
        "targets": [{"expr": expr, "legendFormat": legend, "instant": True, "refId": "A"}],
    }


def table_panel(pid, title, expr, grid, transforms):
    return {
        "id": pid,
        "type": "table",
        "title": title,
        "gridPos": grid,
        "datasource": ds(),
        "fieldConfig": {"defaults": {"color": {"mode": "thresholds"}}, "overrides": []},
        "options": {"showHeader": True, "footer": {"show": False}},
        "targets": [{"expr": expr, "format": "table", "instant": True, "refId": "A"}],
        "transformations": transforms,
    }


def templating_instance_only():
    return {
        "list": [
            {
                "name": "DS_PROMETHEUS",
                "type": "datasource",
                "query": "prometheus",
                "refresh": 1,
                "hide": 0,
                "label": "Data source",
                "multi": False,
                "includeAll": False,
                "options": [],
                "current": {},
                "regex": "",
            },
            {
                "name": "instance",
                "type": "query",
                "label": "Instance",
                "datasource": ds(),
                "definition": "label_values(openclaw_up, instance)",
                "query": {"qryType": 1, "query": "label_values(openclaw_up, instance)", "refId": "v1"},
                "refresh": 2,
                "includeAll": True,
                "multi": True,
                "current": {"selected": True, "text": "All", "value": "$__all"},
                "options": [],
                "hide": 0,
                "regex": "",
                "skipUrlSync": False,
                "sort": 1,
                # Grafana 选「All」时作为正则传入 PromQL；不设则可能变成空串，instance=~"" 无数据
                "allValue": ".*",
            },
        ]
    }


def templating_usage_filters():
    base = templating_instance_only()["list"]
    q = lambda metric, lbl: {
        "name": lbl,
        "type": "query",
        "label": lbl.capitalize(),
        "datasource": ds(),
        "definition": f'label_values({metric}, {lbl})',
        "query": {"qryType": 1, "query": f'label_values({metric}, {lbl})', "refId": f"v_{lbl}"},
        "refresh": 2,
        "includeAll": True,
        "multi": True,
        "current": {"selected": True, "text": "All", "value": "$__all"},
        "options": [],
        "hide": 0,
        "regex": "",
        "skipUrlSync": False,
        "sort": 1,
        "allValue": ".*",
    }
    base.extend(
        [
            q("openclaw_usage_channel_tokens_total", "channel"),
            q("openclaw_usage_provider_cost_usd_total", "provider"),
            q("openclaw_usage_model_cost_usd_total", "model"),
            q("openclaw_usage_tool_calls_total", "tool"),
            q("openclaw_usage_agent_tokens_total", "agent_id"),
        ]
    )
    return {"list": base}


def build_overview():
    inst = '{instance=~"$instance"}'
    panels = []
    y = 0
    pid = 200

    def next_id():
        nonlocal pid
        pid += 1
        return pid

    panels.append(row("快照（对齐 OpenClaw 概览）", y, 100))
    y += 1
    panels.append(
        stat_panel(
            next_id(),
            "状态 / Ready",
            nz(f"max(openclaw_ready{inst})"),
            {"h": 4, "w": 4, "x": 0, "y": y},
            unit="none",
            graph="none",
            text_mode="value",
            mappings=[
                {
                    "type": "value",
                    "options": {"0": {"text": "异常", "color": "red"}, "1": {"text": "正常", "color": "green"}},
                }
            ],
            thresholds={"mode": "absolute", "steps": [{"color": "red"}, {"color": "green", "value": 1}]},
        )
    )
    panels.append(stat_panel(next_id(), "运行时间", nz(f"max(openclaw_plugin_uptime_seconds{inst})"), {"h": 4, "w": 4, "x": 4, "y": y}, unit="s"))
    panels.append(stat_panel(next_id(), "快照年龄", nz(f"max(openclaw_runtime_snapshot_age_seconds{inst})"), {"h": 4, "w": 4, "x": 8, "y": y}, unit="s"))
    panels.append(stat_panel(next_id(), "采集耗时", nz(f"max(openclaw_metrics_last_scrape_duration_seconds{inst})"), {"h": 4, "w": 4, "x": 12, "y": y}, unit="s"))
    panels.append(
        stat_panel(
            next_id(),
            "Gateway Healthz",
            nz(f"max(openclaw_gateway_healthz_healthy{inst})"),
            {"h": 4, "w": 4, "x": 16, "y": y},
            mappings=[
                {"type": "value", "options": {"0": {"text": "异常", "color": "red"}, "1": {"text": "健康", "color": "green"}}}
            ],
            thresholds={"mode": "absolute", "steps": [{"color": "red"}, {"color": "green", "value": 1}]},
        )
    )
    panels.append(
        stat_panel(
            next_id(),
            "Exporter",
            nz(f"max(openclaw_up{inst})"),
            {"h": 4, "w": 4, "x": 20, "y": y},
            mappings=[
                {"type": "value", "options": {"0": {"text": "DOWN", "color": "red"}, "1": {"text": "UP", "color": "green"}}}
            ],
            thresholds={"mode": "absolute", "steps": [{"color": "red"}, {"color": "green", "value": 1}]},
        )
    )
    y += 4

    panels.append(row("关键指标（费用 · 会话 · 活跃 · 定时 · 认证）", y, 101))
    y += 1
    panels.append(
        stat_panel(
            next_id(),
            "费用 USD",
            nz(f"sum(openclaw_usage_cost_usd_total{inst})"),
            {"h": 5, "w": 5, "x": 0, "y": y},
            unit="currencyUSD",
            decimals=4,
        )
    )
    panels.append(stat_panel(next_id(), "Tokens", nz(f"sum(openclaw_usage_tokens_total{inst})"), {"h": 5, "w": 4, "x": 5, "y": y}))
    panels.append(stat_panel(next_id(), "消息", nz(f"sum(openclaw_usage_messages_total{inst})"), {"h": 5, "w": 4, "x": 9, "y": y}))
    panels.append(stat_panel(next_id(), "会话数", nz(f"sum(openclaw_session_total{inst})"), {"h": 5, "w": 4, "x": 13, "y": y}))
    panels.append(stat_panel(next_id(), "活跃 Presence", nz(f"sum(openclaw_presence_total{inst})"), {"h": 5, "w": 4, "x": 17, "y": y}))
    panels.append(stat_panel(next_id(), "进行中", nz(f"sum(openclaw_inflight_operations{inst})"), {"h": 5, "w": 3, "x": 21, "y": y}))
    y += 5
    panels.append(stat_panel(next_id(), "定时任务数", nz(f"sum(openclaw_cron_total{inst})"), {"h": 4, "w": 4, "x": 0, "y": y}))
    panels.append(stat_panel(next_id(), "Cron 运行中", nz(f"sum(openclaw_cron_running{inst})"), {"h": 4, "w": 4, "x": 4, "y": y}))
    panels.append(stat_panel(next_id(), "认证即将过期", nz(f"sum(openclaw_model_auth_providers_expiring_total{inst})"), {"h": 4, "w": 4, "x": 8, "y": y}))
    panels.append(
        stat_panel(
            next_id(),
            "认证已过期",
            nz(f"sum(openclaw_model_auth_providers_expired_total{inst})"),
            {"h": 4, "w": 4, "x": 12, "y": y},
            thresholds={"mode": "absolute", "steps": [{"color": "green"}, {"color": "red", "value": 1}]},
        )
    )
    panels.append(stat_panel(next_id(), "已链接渠道", nz(f"sum(openclaw_channel_linked_total{inst})"), {"h": 4, "w": 4, "x": 16, "y": y}))
    panels.append(
        stat_panel(
            next_id(),
            "采集失败数",
            nz(f"sum(openclaw_metrics_collect_errors_total{inst})"),
            {"h": 4, "w": 4, "x": 20, "y": y},
            thresholds={"mode": "absolute", "steps": [{"color": "green"}, {"color": "red", "value": 1}]},
        )
    )
    y += 4

    panels.append(row("最近活动（Agent 用量排行，近似「会话」列表）", y, 102))
    y += 1
    panels.append(
        table_panel(
            next_id(),
            "Top Agents（tokens）",
            f"topk(25, sum by (agent_id) (openclaw_usage_agent_tokens_total{inst}))",
            {"h": 10, "w": 14, "x": 0, "y": y},
            [
                {
                    "id": "organize",
                    "options": {
                        "excludeByName": {"Time": True, "__name__": True, "instance": True, "job": True},
                        "renameByName": {"agent_id": "会话/Agent", "Value": "Tokens"},
                    },
                }
            ],
        )
    )
    panels.append(
        bar_panel(
            next_id(),
            "热门模型（成本）",
            f"topk(10, sum by (provider, model) (openclaw_usage_model_cost_usd_total{inst}))",
            "{{provider}} / {{model}}",
            {"h": 10, "w": 10, "x": 14, "y": y},
            unit="currencyUSD",
        )
    )
    y += 10

    panels.append(row("趋势（轻量）", y, 103))
    y += 1
    panels.append(
        ts_panel(
            next_id(),
            "消息与 Token（累计走势）",
            [
                {"expr": f"sum(openclaw_usage_messages_total{inst})", "legendFormat": "消息", "refId": "A"},
                {"expr": f"sum(openclaw_usage_tokens_total{inst})", "legendFormat": "Tokens", "refId": "B"},
            ],
            {"h": 8, "w": 12, "x": 0, "y": y},
        )
    )
    panels.append(
        ts_panel(
            next_id(),
            "费用 USD（累计）",
            [{"expr": f"sum(openclaw_usage_cost_usd_total{inst})", "legendFormat": "Cost", "refId": "A"}],
            {"h": 8, "w": 12, "x": 12, "y": y},
            unit="currencyUSD",
        )
    )

    return {
        "__inputs": [
            {"name": "DS_PROMETHEUS", "label": "prometheus", "type": "datasource", "pluginId": "prometheus", "pluginName": "Prometheus"}
        ],
        "__requires": [
            {"type": "grafana", "id": "grafana", "name": "Grafana", "version": "11.0.0"},
            {"type": "datasource", "id": "prometheus", "name": "Prometheus", "version": "1.0.0"},
            {"type": "panel", "id": "stat", "name": "Stat", "version": ""},
            {"type": "panel", "id": "table", "name": "Table", "version": ""},
            {"type": "panel", "id": "timeseries", "name": "Time series", "version": ""},
            {"type": "panel", "id": "bargauge", "name": "Bar gauge", "version": ""},
        ],
        "annotations": {"list": []},
        "description": "对齐 OpenClaw 控制台「概览」：快照 → 关键指标 → 最近活动（Agent 排行）→ 轻量趋势。",
        "editable": True,
        "graphTooltip": 1,
        "id": None,
        "links": [{"title": "使用情况（详细）", "type": "dashboards", "tags": ["openclaw", "detailed"], "asDropdown": False}],
        "panels": panels,
        "refresh": "15s",
        "schemaVersion": 41,
        "tags": ["openclaw", "overview", "production"],
        "templating": templating_instance_only(),
        "time": {"from": "now-7d", "to": "now"},
        "timepicker": {"refresh_intervals": ["5s", "10s", "30s", "1m", "5m", "15m", "30m", "1h"]},
        "timezone": "browser",
        "title": "OpenClaw - Overview",
        "uid": "openclaw-overview",
        "version": 1,
    }


def build_metrics():
    inst = '{instance=~"$instance"}'
    ch = '{instance=~"$instance",channel=~"$channel"}'
    pr = '{instance=~"$instance",provider=~"$provider"}'
    md = '{instance=~"$instance",provider=~"$provider",model=~"$model"}'
    tl = '{instance=~"$instance",tool=~"$tool"}'
    ag = '{instance=~"$instance",agent_id=~"$agent_id"}'

    panels = []
    y = 0
    pid = 300

    def next_id():
        nonlocal pid
        pid += 1
        return pid

    panels.append(
        {
            "type": "text",
            "id": next_id(),
            "title": "",
            "gridPos": {"h": 2, "w": 24, "x": 0, "y": y},
            "options": {
                "content": "## 使用情况（对齐 OpenClaw）\n顶部变量：**Instance / Channel / Provider / Model / Tool / Agent**。左侧为概览 Stat，右侧为 Top-N，底部为 Token 类型与延迟趋势。",
                "mode": "markdown",
            },
            "transparent": True,
        }
    )
    y += 2

    panels.append(row("使用概览（Stat 网格 + 右侧排行）", y, 400))
    y += 1
    y_block = y
    stats = [
        ("消息", nz(f"sum(openclaw_usage_messages_total{inst})")),
        ("Token 吞吐 /min", nz(f"sum(rate(openclaw_usage_tokens_total{inst}[5m])) * 60")),
        ("工具调用", nz(f"sum(openclaw_usage_tool_calls_total{tl})")),
        ("Tokens 累计", nz(f"sum(openclaw_usage_tokens_total{inst})")),
        (
            "缓存命中（估计）",
            nz(f"(sum(openclaw_usage_tokens_cache_read_total{inst}) / clamp_min(sum(openclaw_usage_tokens_total{inst}), 1))"),
        ),
        (
            "错误率（消息）",
            nz(f"(sum(openclaw_usage_messages_errors_total{inst}) / clamp_min(sum(openclaw_usage_messages_total{inst}), 1))"),
        ),
        ("费用 USD", nz(f"sum(openclaw_usage_cost_usd_total{inst})")),
        ("会话数", nz(f"sum(openclaw_session_total{inst})")),
        ("消息错误数", nz(f"sum(openclaw_usage_messages_errors_total{inst})")),
    ]
    for i, (title, expr) in enumerate(stats):
        col = i % 4
        row_i = i // 4
        gx = col * 4
        gy = y_block + row_i * 4
        unit = "percentunit" if "率" in title or "命中" in title else ("currencyUSD" if "USD" in title else "short")
        dec = 4 if "USD" in title else None
        p = stat_panel(next_id(), title, expr, {"h": 4, "w": 4, "x": gx, "y": gy}, unit=unit, decimals=dec)
        if "错误率" in title or "命中" in title:
            p["fieldConfig"]["defaults"]["thresholds"] = {
                "mode": "absolute",
                "steps": [{"color": "green"}, {"color": "yellow", "value": 0.05}, {"color": "red", "value": 0.15}],
            }
            p["fieldConfig"]["defaults"]["color"] = {"mode": "thresholds"}
        panels.append(p)

    rx, rw = 16, 8
    for bi, (btitle, bexpr, bleg, bunit) in enumerate(
        [
            ("热门模型（Tokens）", f"topk(8, sum by (provider, model) (openclaw_usage_model_tokens_total{md}))", "{{provider}} / {{model}}", "short"),
            ("热门提供商（成本）", f"topk(8, sum by (provider) (openclaw_usage_provider_cost_usd_total{pr}))", "{{provider}}", "currencyUSD"),
            ("热门工具（调用）", f"topk(8, sum by (tool) (openclaw_usage_tool_calls_total{tl}))", "{{tool}}", "short"),
            ("热门渠道（Tokens）", f"topk(8, sum by (channel) (openclaw_usage_channel_tokens_total{ch}))", "{{channel}}", "short"),
        ]
    ):
        panels.append(
            bar_panel(
                next_id(),
                btitle,
                bexpr,
                bleg,
                {"h": 3, "w": rw, "x": rx, "y": y_block + bi * 3},
                unit=bunit,
            )
        )

    y = y_block + 12

    panels.append(row("Token 组成与 Provider 请求（对齐「按类型」）", y, 401))
    y += 1
    panels.append(
        ts_panel(
            next_id(),
            "Token 分量（累计，多序列）",
            [
                {"expr": f"sum(openclaw_usage_tokens_input_total{inst})", "legendFormat": "输入", "refId": "A"},
                {"expr": f"sum(openclaw_usage_tokens_output_total{inst})", "legendFormat": "输出", "refId": "B"},
                {"expr": f"sum(openclaw_usage_tokens_cache_read_total{inst})", "legendFormat": "缓存读取", "refId": "C"},
                {"expr": f"sum(openclaw_usage_tokens_cache_write_total{inst})", "legendFormat": "缓存写入", "refId": "D"},
            ],
            {"h": 8, "w": 12, "x": 0, "y": y},
            stacked=True,
        )
    )
    panels.append(
        ts_panel(
            next_id(),
            "Provider 请求（累计）",
            [
                {"expr": f"sum by (provider) (openclaw_usage_provider_requests_total{pr})", "legendFormat": "{{provider}}", "refId": "A"},
            ],
            {"h": 8, "w": 12, "x": 12, "y": y},
        )
    )
    y += 8

    panels.append(row("会话维度（Agent 排行 + 渠道分布）", y, 402))
    y += 1
    panels.append(
        table_panel(
            next_id(),
            "Top Agents（tokens，受 Agent 变量过滤）",
            f"topk(30, sum by (agent_id) (openclaw_usage_agent_tokens_total{ag}))",
            {"h": 10, "w": 14, "x": 0, "y": y},
            [
                {
                    "id": "organize",
                    "options": {
                        "excludeByName": {"Time": True, "__name__": True, "instance": True, "job": True},
                        "renameByName": {"agent_id": "Agent / 会话键", "Value": "Tokens"},
                    },
                }
            ],
        )
    )
    panels.append(
        bar_panel(
            next_id(),
            "Agent Token Top 12",
            f"topk(12, sum by (agent_id) (openclaw_usage_agent_tokens_total{ag}))",
            "{{agent_id}}",
            {"h": 10, "w": 10, "x": 14, "y": y},
        )
    )
    y += 10

    panels.append(row("延迟与 SLI（稳定指标）", y, 403))
    y += 1
    panels.append(
        ts_panel(
            next_id(),
            "Usage 延迟（gauge，秒）",
            [
                {"expr": nz(f"avg(openclaw_usage_latency_avg_seconds{inst})"), "legendFormat": "avg", "refId": "A"},
                {"expr": nz(f"avg(openclaw_usage_latency_p95_seconds{inst})"), "legendFormat": "p95", "refId": "B"},
                {"expr": nz(f"avg(openclaw_usage_latency_max_seconds{inst})"), "legendFormat": "max", "refId": "C"},
            ],
            {"h": 8, "w": 12, "x": 0, "y": y},
            unit="s",
        )
    )
    panels.append(
        ts_panel(
            next_id(),
            "Reliability Ratios",
            [
                {"expr": nz(f"avg(openclaw_sli_message_success_ratio{inst})"), "legendFormat": "Message Success", "refId": "A"},
                {"expr": nz(f"avg(1 - openclaw_sli_agent_error_ratio{inst})"), "legendFormat": "Agent Reliability", "refId": "B"},
                {"expr": nz(f"avg(1 - openclaw_sli_tool_error_ratio{inst})"), "legendFormat": "Tool Reliability", "refId": "C"},
                {"expr": nz(f"avg(openclaw_sli_channel_health_ratio{inst})"), "legendFormat": "Channel Health", "refId": "D"},
            ],
            {"h": 8, "w": 12, "x": 12, "y": y},
            unit="percentunit",
        )
    )
    # 为 SLI 面板补充 0~1 纵轴
    panels[-1]["fieldConfig"]["defaults"]["max"] = 1
    panels[-1]["fieldConfig"]["defaults"]["min"] = 0
    y += 8

    panels.append(row("HTTP 与 Skills（运维补充）", y, 404))
    y += 1
    panels.append(
        ts_panel(
            next_id(),
            "metrics_http 请求速率",
            [
                {
                    "expr": f'sum by (route, method, status) (rate(openclaw_metrics_http_requests_total{inst}[$__rate_interval]))',
                    "legendFormat": "{{route}} {{method}} {{status}}",
                    "refId": "A",
                }
            ],
            {"h": 7, "w": 12, "x": 0, "y": y},
        )
    )
    panels.append(
        heatmap_panel(
            next_id(),
            "HTTP 请求耗时 heatmap",
            f'sum by (le) (rate(openclaw_metrics_http_request_duration_seconds_bucket{inst}[$__rate_interval]))',
            {"h": 7, "w": 12, "x": 12, "y": y},
        )
    )
    y += 7
    panels.append(stat_panel(next_id(), "Skills 总数", nz(f"sum(openclaw_skill_total{inst})"), {"h": 4, "w": 6, "x": 0, "y": y}))
    panels.append(stat_panel(next_id(), "Skills 激活", nz(f"sum(openclaw_skill_active_total{inst})"), {"h": 4, "w": 6, "x": 6, "y": y}))
    panels.append(
        bar_panel(
            next_id(),
            "Skills 按分类",
            f"topk(12, openclaw_skill_by_category{inst})",
            "{{category}}",
            {"h": 4, "w": 12, "x": 12, "y": y},
        )
    )

    return {
        "__inputs": [
            {"name": "DS_PROMETHEUS", "label": "prometheus", "type": "datasource", "pluginId": "prometheus", "pluginName": "Prometheus"}
        ],
        "__requires": [
            {"type": "grafana", "id": "grafana", "name": "Grafana", "version": "11.0.0"},
            {"type": "datasource", "id": "prometheus", "name": "Prometheus", "version": "1.0.0"},
            {"type": "panel", "id": "stat", "name": "Stat", "version": ""},
            {"type": "panel", "id": "table", "name": "Table", "version": ""},
            {"type": "panel", "id": "timeseries", "name": "Time series", "version": ""},
            {"type": "panel", "id": "bargauge", "name": "Bar gauge", "version": ""},
            {"type": "panel", "id": "text", "name": "Text", "version": ""},
            {"type": "panel", "id": "heatmap", "name": "Heatmap", "version": ""},
        ],
        "annotations": {"list": []},
        "description": "对齐 OpenClaw「使用情况 / 会话」：变量过滤 + Stat + Top-N + Token 分量 + 延迟/SLI。",
        "editable": True,
        "graphTooltip": 1,
        "id": None,
        "links": [{"title": "返回概览", "type": "dashboards", "tags": ["openclaw", "overview"], "asDropdown": False}],
        "panels": panels,
        "refresh": "15s",
        "schemaVersion": 41,
        "tags": ["openclaw", "metrics", "detailed", "production"],
        "templating": templating_usage_filters(),
        "time": {"from": "now-7d", "to": "now"},
        "timepicker": {"refresh_intervals": ["5s", "10s", "30s", "1m", "5m", "15m", "30m", "1h"]},
        "timezone": "browser",
        "title": "OpenClaw - Detailed Metrics",
        "uid": "openclaw-metrics",
        "version": 1,
    }


def main():
    for name, builder in [
        ("dashboard-overview.json", build_overview),
        ("dashboard-metrics.json", build_metrics),
    ]:
        path = BASE / name
        data = builder()
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print("Wrote", path)


if __name__ == "__main__":
    main()
