# openclaw_prometheus

Prometheus metrics exporter plugin for OpenClaw Gateway.

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

## Related Plugins

| Plugin | Description |
|---|---|
| [openclaw_management](../openclaw_management) | REST API + management UI (has its own metrics overview) |
| [openclaw_cluster](../openclaw_cluster) | Cluster coordination |
| [openclaw_mqtt](../openclaw_mqtt) | MQTT protocol bridge |
| [openclaw_web_stomp](../openclaw_web_stomp) | STOMP over WebSocket |

## License

MIT
