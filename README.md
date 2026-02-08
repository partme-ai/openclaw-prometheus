<div align="center">

# openclaw_prometheus

**Prometheus metrics exporter — Gateway · Agent · Channel · Runtime · Memory**

![Version](https://img.shields.io/badge/Version-0.1.0-blue) ![License](https://img.shields.io/badge/License-MIT-green)

</div>

[中文](README_CN.md) | English

---

## Features

- **Multi-dimensional metrics**: Gateway, Agent, Channel, Runtime, Memory
- **Prometheus text format**: Standard `/metrics` endpoint for Prometheus scraping
- **JSON format**: `/metrics/per-object` and `/metrics/detailed` for programmatic access
- **Filtered queries**: Filter by metric family or agent ID
- **Zero-config**: Works out of the box with sensible defaults

## Endpoints

| Endpoint | Format | Description |
|----------|--------|-------------|
| `GET /metrics` | Prometheus text | Standard Prometheus scrape target |
| `GET /metrics/per-object` | JSON | Metrics grouped by object type |
| `GET /metrics/detailed?family=&agent=` | JSON | Filtered metric queries |

## Metric Families

- `openclaw_gateway_*` — Uptime, connections, sessions, message rates
- `openclaw_agent_*` — Agent count, runs, errors, token usage
- `openclaw_channel_*` — Channel count, connection status, message counts
- `openclaw_nodejs_*` — Heap, RSS, event loop lag, handles
- `openclaw_memory_*` — Memory index status

## Installation

```bash
openclaw plugins install openclaw_prometheus
```

## Configuration

In `openclaw.plugin.json`:
- `port`: Dedicated metrics port (default: 9090, 0 for Gateway port)
- `path`: Metrics path (default: `/metrics`)
- `collectIntervalMs`: Collection interval (default: 15000)
- `includeRuntime`: Include Node.js runtime metrics (default: true)

## Directory Structure

```
openclaw_prometheus/
  package.json
  openclaw.plugin.json
  tsconfig.json
  tsup.config.ts
  src/
    index.ts           # Plugin entry, registers HTTP routes
    types.ts           # Metric types
    collectors/        # Gateway, Agent, Runtime, Channel, Memory
    formatters/        # Prometheus text, JSON
```

## Development

```bash
pnpm install
pnpm build
pnpm dev   # watch mode
```

## Related OpenClaw plugins

| Plugin | Description |
|--------|--------------|
| [openclaw_auth_oauth2](https://github.com/partme-ai/openclaw_auth_oauth2) | OAuth2 authentication |
| [openclaw_cluster](https://github.com/partme-ai/openclaw_cluster) | Cluster coordination (discovery, config sync, session store, proxy) |
| [openclaw_ics](https://github.com/partme-ai/openclaw_ics) | Intelligent Customer Service API |
| [openclaw_management](https://github.com/partme-ai/openclaw_management) | Management REST API, Prometheus, definitions, Web UI |
| [openclaw_mqtt](https://github.com/partme-ai/openclaw_mqtt) | MQTT protocol adapter |
| [openclaw_prometheus](https://github.com/partme-ai/openclaw_prometheus) | Prometheus metrics exporter |
| [openclaw_stomp](https://github.com/partme-ai/openclaw_stomp) | STOMP server |
| [openclaw_tracing](https://github.com/partme-ai/openclaw_tracing) | Distributed tracing |
| [openclaw_web_mqtt](https://github.com/partme-ai/openclaw_web_mqtt) | WebSocket MQTT |
| [openclaw_web_stomp](https://github.com/partme-ai/openclaw_web_stomp) | WebSocket STOMP |
| [openclaw_wecom_kf](https://github.com/partme-ai/openclaw_wecom_kf) | WeChat Work customer service channel |

## License

MIT
