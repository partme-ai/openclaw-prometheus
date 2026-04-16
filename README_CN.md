
<div align="center">

# OpenClaw Prometheus

**OpenClaw 插件：基于 Gateway RPC 的 Prometheus 指标与 JSON 诊断端点**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw__prometheus-blue)
![Node](https://img.shields.io/badge/Node.js-20+-green)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

[简体中文](./README_CN.md) | [English](./README.md)

## 简介

`@partme.ai/openclaw_prometheus` 是面向 [OpenClaw](https://github.com/openclaw/openclaw) 的**非渠道**插件，按官方文档使用 [`definePluginEntry`](https://docs.openclaw.ai/plugins/sdk-entrypoints#definepluginentry)（见 [Building plugins](https://docs.openclaw.ai/plugins/building-plugins)），在 Gateway 上注册 HTTP 路由。采集器通过 `gatewayCall` / `invoke` 调用 `health`、`channels.status`、`sessions.list`、`usage.*`、`system-presence`、`cron.*`、`models.list`、`node.list`、`skills.*` 等 RPC，并输出 Prometheus 文本或 JSON。

## 核心能力

- **多采集器**：健康、渠道、会话、用量、在线、cron、模型、节点、skills，以及可选的 Node 运行时指标（`openclaw_nodejs_*`）。
- **端点**：`{path}`（默认 `/metrics`）暴露 Prometheus；`{path}/per-object`、`{path}/detailed?family=` 提供 JSON。
- **采集缓存**：`collectIntervalMs` 在多次抓取间复用上一次成功结果，减轻 RPC 压力；设为 `0` 则每次抓取全量采集。
- **元指标**：`openclaw_exporter_build_info`、`openclaw_metrics_last_scrape_duration_seconds`。
- **可选抓取鉴权**：推荐使用环境变量 `OPENCLAW_PROMETHEUS_BEARER_TOKEN`；仅本地调试可在配置中写 `scrapeAuth.bearerToken`。
- **企业级运维取向**（命名与分层方式参考 [RabbitMQ Prometheus 文档](https://www.rabbitmq.com/docs/prometheus) 中的实践：专用路径、聚合与按实体 JSON、TLS 由 Gateway/反向代理终止、控制高基数标签使用等）。

### 生命周期

- 通过 `package.json` → `openclaw.extensions` 随 Gateway 加载。
- `register()` 注入 `api.runtime`（RPC）与 `api.config`，并 `registerHttpRoute` 注册路由。
- manifest 中的 `port` 主要供运维参考；实际监听端口以 Gateway 为准（或由前置代理暴露）。

## 端点说明

| 路径 | 格式 | 说明 |
| --- | --- | --- |
| `GET {path}` | Prometheus text | 标准抓取 |
| `GET {path}/per-object` | JSON | 按对象分组 |
| `GET {path}/detailed?family=` | JSON | 按名称子串过滤 |

默认 `{path}` 为 `/metrics`。

## 指标族（前缀）

| 前缀 | 数据来源 |
| --- | --- |
| `openclaw_*` | `health` |
| `openclaw_channel_*` | `channels.status` |
| `openclaw_session_*` | `sessions.list` |
| `openclaw_usage_*` | `usage.cost` → `totals`（时间窗全局汇总） |
| `openclaw_usage_provider_*{provider=""}` | `sessions.usage` → `aggregates.byProvider`（按模型供应商拆分的 token/费用） |
| `openclaw_presence_*` | `system-presence` |
| `openclaw_cron_*` | `cron.status` / `cron.list` |
| `openclaw_model_*` | `models.list` |
| `openclaw_node_*` | `node.list` |
| `openclaw_skill_*` | `skills.status` / `skills.bins` |
| `openclaw_nodejs_*` | 本进程（`includeRuntime`） |
| `openclaw_exporter_*`、`openclaw_metrics_*` | 插件自身 |

## 快速开始

### 前置条件

- OpenClaw `>= 2026.4.0`
- Node.js `20+`

### 安装

```bash
openclaw plugins install @partme.ai/openclaw_prometheus
```

### 最小配置（`openclaw.json`）

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

### Prometheus 抓取（Bearer）

在 Gateway 环境设置 `OPENCLAW_PROMETHEUS_BEARER_TOKEN`，配置中 `scrapeAuth.enabled: true`，Prometheus 使用 `bearer_token_file` 指向同一密钥文件。

### 命令行探测

```bash
pnpm run test:client -- http://127.0.0.1:18789/metrics
OPENCLAW_PROMETHEUS_BEARER_TOKEN=secret pnpm run test:client -- http://127.0.0.1:18789/metrics
```

## Grafana 看板

从 [`grafana/`](./grafana/) 导入单节点与集群两套 JSON，说明见 [`grafana/README.md`](./grafana/README.md)。

## 开发与测试

```bash
pnpm install
pnpm run build
pnpm test
```

## 发版注意

同步更新 **`package.json` 的 `version`** 与 [`src/version.ts`](src/version.ts) 中的 **`PLUGIN_VERSION`**。

## 相关插件

| 插件 | 说明 |
| --- | --- |
| [openclaw-mqtt](https://github.com/partme-ai/openclaw-mqtt) | MQTT 渠道 |
| [openclaw-nacos](https://github.com/partme-ai/openclaw-nacos) | Nacos 注册/配置 |
| [openclaw-web-mqtt](https://github.com/partme-ai/openclaw-web-mqtt) | Web MQTT |

## 许可证

MIT
