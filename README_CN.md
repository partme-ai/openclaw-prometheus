<div align="center">

# openclaw_prometheus

**Prometheus 指标导出 — Gateway · Agent · Channel · Runtime · Memory**

![Version](https://img.shields.io/badge/Version-0.1.0-blue) ![License](https://img.shields.io/badge/License-MIT-green)

</div>

中文 | [English](README.md)

---

## 功能

- **多维度指标**：Gateway、Agent、Channel、Runtime、Memory
- **Prometheus 文本格式**：标准 `/metrics` 端点，供 Prometheus 抓取
- **JSON 格式**：`/metrics/per-object`、`/metrics/detailed` 供程序化访问
- **过滤查询**：按指标族或 Agent ID 过滤
- **零配置**：开箱即用，合理默认值

## 端点

| 端点 | 格式 | 说明 |
|----------|--------|-------------|
| `GET /metrics` | Prometheus 文本 | 标准 Prometheus 抓取目标 |
| `GET /metrics/per-object` | JSON | 按对象类型分组的指标 |
| `GET /metrics/detailed?family=&agent=` | JSON | 按条件过滤的指标查询 |

## 指标族

- `openclaw_gateway_*` — 运行时间、连接数、会话数、消息速率
- `openclaw_agent_*` — Agent 数量、运行次数、错误、Token 使用
- `openclaw_channel_*` — 渠道数量、连接状态、消息数
- `openclaw_nodejs_*` — 堆内存、RSS、事件循环延迟、句柄数
- `openclaw_memory_*` — 记忆索引状态

## 安装

```bash
openclaw plugins install openclaw_prometheus
```

## 配置

在 `openclaw.plugin.json` 或 Control UI 中：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `port` | number | 9090 | 独立指标 HTTP 端口（0 表示使用 Gateway 端口） |
| `path` | string | `/metrics` | 指标端点路径 |
| `collectIntervalMs` | number | 15000 | 采集间隔（毫秒） |
| `includeRuntime` | boolean | true | 是否包含 Node.js 运行时指标 |

## 目录结构

```
openclaw_prometheus/
  package.json
  openclaw.plugin.json
  tsconfig.json
  tsup.config.ts
  src/
    index.ts           # 插件入口，注册 HTTP 路由
    types.ts           # 指标类型
    collectors/        # Gateway、Agent、Runtime、Channel、Memory
    formatters/        # Prometheus 文本、JSON
```

## 测试

```bash
pnpm test            # 运行单元测试
pnpm test:watch      # 监听模式
pnpm test:coverage   # 覆盖率报告
```

测试覆盖：
- `prometheus.test.ts` — Prometheus 格式化 + Labels + 转义（7 个测试）

## 开发

```bash
pnpm install
pnpm build
pnpm dev   # 监听模式
```

## OpenClaw 生态插件

| 插件 | 说明 |
|------|------|
| [openclaw_auth_oauth2](https://github.com/partme-ai/openclaw_auth_oauth2) | OAuth2 认证 |
| [openclaw_cluster](https://github.com/partme-ai/openclaw_cluster) | 集群协调（发现 / 配置同步 / 会话存储 / 代理） |
| [openclaw_management](https://github.com/partme-ai/openclaw_management) | 管理 REST API + Prometheus + 定义导出/导入 + Web UI |
| [openclaw_mqtt](https://github.com/partme-ai/openclaw_mqtt) | MQTT 协议接入 |
| [openclaw_prometheus](https://github.com/partme-ai/openclaw_prometheus) | Prometheus 指标导出 |
| [openclaw_stomp](https://github.com/partme-ai/openclaw_stomp) | STOMP 服务端 |
| [openclaw_tracing](https://github.com/partme-ai/openclaw_tracing) | 链路追踪 |
| [openclaw_web_mqtt](https://github.com/partme-ai/openclaw_web_mqtt) | WebSocket MQTT |
| [openclaw_web_stomp](https://github.com/partme-ai/openclaw_web_stomp) | WebSocket STOMP |

## 许可证

MIT
