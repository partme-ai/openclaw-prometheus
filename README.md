<div align="center">

# OpenClaw Prometheus

**OpenClaw plugin — Gateway RPC–backed Prometheus metrics and JSON inspection endpoints**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw__prometheus-blue)
![Node](https://img.shields.io/badge/Node.js-20+-green)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

[English](./README.md) | [简体中文](./README_CN.md)

## Introduction

`@partme.ai/openclaw_prometheus` is a **non-channel** plugin for [OpenClaw](https://github.com/openclaw/openclaw). It uses [`definePluginEntry`](https://docs.openclaw.ai/plugins/sdk-entrypoints#definepluginentry) (see [Building plugins](https://docs.openclaw.ai/plugins/building-plugins)) to register HTTP routes on the Gateway. Collectors call documented Gateway RPC methods (`health`, `channels.status`, `sessions.list`, `usage.*`, `system-presence`, `cron.*`, `models.list`, `node.list`, `skills.*`) and expose the result as Prometheus text or JSON.

## Core capabilities

- **Multi-collector**: health, channels, sessions, usage, presence, cron, models, nodes, skills, and optional Node.js runtime (`openclaw_nodejs_*`).
- **Endpoints**: Prometheus exposition on `{path}` (default `/metrics`), JSON on `{path}/per-object` and `{path}/detailed?family=`.
- **Collection cache**: `collectIntervalMs` reuses the last successful scrape bundle to reduce RPC load under frequent Prometheus scrapes (set `0` to disable).
- **Meta metrics**: `openclaw_exporter_build_info`, `openclaw_metrics_last_scrape_duration_seconds`.
- **Optional scrape auth**: Bearer token via `OPENCLAW_PROMETHEUS_BEARER_TOKEN` (recommended) or dev-only `scrapeAuth.bearerToken` in config.
- **Enterprise-style operations** (aligned with common Prometheus exporter practice and ideas from [RabbitMQ’s Prometheus guide](https://www.rabbitmq.com/docs/prometheus)): stable metric names, separate “full text” vs JSON drill-down, TLS termination at the Gateway/reverse proxy, and cardinality-aware use of `/detailed?family=`.

### Plugin lifecycle

- Loaded like any OpenClaw extension (`package.json` → `openclaw.extensions`).
- `register()` wires `api.runtime` (for `gatewayCall` / `invoke` RPC) and `api.config`, then registers routes with `api.registerHttpRoute`.
- Dedicated `port` in manifest is informational for operators; actual listen port follows the Gateway unless you front it with a separate listener in core.

## Endpoints

| Method & path | Format | Description |
| --- | --- | --- |
| `GET {path}` | Prometheus text | Scrape target (`Content-Type: text/plain; version=0.0.4`) |
| `GET {path}/per-object` | JSON | Grouped metrics for tooling |
| `GET {path}/detailed?family=` | JSON | Filter by substring of metric name |

Default `{path}` is `/metrics`.

## Metric families (prefixes)

| Prefix | Source |
| --- | --- |
| `openclaw_*` | `health` RPC (gateway uptime, channels, agents, sessions) |
| `openclaw_channel_*` | `channels.status` |
| `openclaw_session_*` | `sessions.list` |
| `openclaw_usage_*` | `usage.status` / `usage.cost` |
| `openclaw_presence_*` | `system-presence` |
| `openclaw_cron_*` | `cron.status` / `cron.list` |
| `openclaw_model_*` | `models.list` |
| `openclaw_node_*` | `node.list` |
| `openclaw_skill_*` | `skills.status` / `skills.bins` |
| `openclaw_nodejs_*` | Local process (optional via `includeRuntime`) |
| `openclaw_exporter_*`, `openclaw_metrics_*` | Plugin meta |

## Quick start

### Prerequisites

- OpenClaw `>= 2026.4.0`
- Node.js `20+`

### Install

```bash
openclaw plugins install @partme.ai/openclaw_prometheus
```

### Minimal config (`openclaw.json`)

```json
{
  "plugins": {
    "entries": {
      "openclaw_prometheus": {
        "enabled": true,
        "config": {
          "path": "/metrics",
          "collectIntervalMs": 15000,
          "includeRuntime": true,
          "scrapeAuth": {
            "enabled": false
          }
        }
      }
    }
  }
}
```

### Prometheus scrape (with Bearer)

```yaml
scrape_configs:
  - job_name: openclaw
    scrape_interval: 15s
    bearer_token_file: /etc/prometheus/openclaw-metrics.token
    static_configs:
      - targets: ["127.0.0.1:18789"]
    metrics_path: /metrics
```

Set `scrapeAuth.enabled: true` and store the same secret in `OPENCLAW_PROMETHEUS_BEARER_TOKEN` on the Gateway host.

### Manual probe (CLI)

```bash
pnpm run test:client -- http://127.0.0.1:18789/metrics
OPENCLAW_PROMETHEUS_BEARER_TOKEN=secret pnpm run test:client -- http://127.0.0.1:18789/metrics
```

## Development

```bash
pnpm install
pnpm run build
pnpm dev
pnpm test
```

## Release version sync

Bump **`package.json` `version`** and [`src/version.ts`](src/version.ts) **`PLUGIN_VERSION`** together before tagging.

## Related plugins

| Plugin | Role |
| --- | --- |
| [openclaw-mqtt](https://github.com/partme-ai/openclaw-mqtt) | MQTT channel bridge |
| [openclaw-nacos](https://github.com/partme-ai/openclaw-nacos) | Nacos naming / config |
| [openclaw-web-mqtt](https://github.com/partme-ai/openclaw-web-mqtt) | Web MQTT helpers |

## License

MIT
