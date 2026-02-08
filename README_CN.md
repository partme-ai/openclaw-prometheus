# openclaw_prometheus

OpenClaw Gateway 的 Prometheus 指标导出插件。

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

## 相关插件

| 插件 | 说明 |
|---|---|
| [openclaw_management](../openclaw_management) | REST API + 管理 UI（自带指标概览） |
| [openclaw_cluster](../openclaw_cluster) | 集群协调 |
| [openclaw_mqtt](../openclaw_mqtt) | MQTT 协议桥接 |
| [openclaw_web_stomp](../openclaw_web_stomp) | STOMP over WebSocket |

## 许可证

MIT
