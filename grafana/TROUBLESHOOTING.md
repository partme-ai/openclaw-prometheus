# OpenClaw Grafana Dashboards - Troubleshooting Guide

> 版本：1.1 | 日期：2026-04-20 | 状态：🔧 **排查中**

---

## 🚨 常见问题：Dashboard 完全空白

### 问题 1：Dashboard 界面空白

**可能原因**：
1. **Dashboard JSON 格式错误**：缺少必要字段（`uid`、`schemaVersion`、`datasource`）
2. **Prometheus 无数据**：指标未导出或 scrape 失败
3. **变量查询失败**：`label_values(openclaw_up, instance)` 返回空结果
4. **数据源配置错误**：URL 或认证问题

---

## 🔧 排查步骤

### Step 1：验证 Prometheus 数据源

```bash
# 1. 检查 Prometheus 是否返回数据
curl http://192.168.31.170:3000/metrics | grep openclaw_up

# 预期输出
openclaw_up 1
openclaw_ready 1
```

**如果无数据**：
- 检查插件是否安装：`openclaw plugins list`
- 检查插件是否加载：`openclaw plugins status openclaw-prometheus`
- 检查日志：`journalctl -u openclaw-prometheus -f`

---

### Step 2：检查 Instance Label

```bash
# 检查 instance label 是否存在
curl http://192.168.31.170:3000/metrics | grep 'instance='

# 预期输出
openclaw_up{instance="gateway-01"} 1
openclaw_up{instance="gateway-02"} 1
```

**如果没有 instance 标签**：
- 需要配置 Prometheus relabel_config
- 参考：`config/prometheus.example.yaml` 中的配置

---

### Step 3：验证 Grafana 数据源配置

1. 访问 Grafana：`http://192.168.31.170:3000`
2. **Configuration** → **Data Sources**
3. 点击 `DS_PROMETHEUS` 数据源
4. 点击 **"Test"** 按钮

**预期结果**：
```
Data source is working
```

**如果失败**：
- 检查 URL：`http://192.168.31.170:3000`（不是 `/metrics`）
- 检查网络：`curl -I http://192.168.31.170:3000`
- 检查认证：如果启用了 Basic Auth

---

### Step 4：导入最小化测试 Dashboard

```bash
# 导入简单测试 Dashboard
grafana/import grafana/simple-test.json
```

**预期结果**：
- 显示 "OpenClaw Up Status" 面板
- 显示 "Message Sent Total" 面板
- 如果有数据，说明 Prometheus 和数据源配置正确

---

### Step 5：检查变量查询

在 Grafana Dashboard 中：
1. 点击变量下拉框（`$openclaw_instance`）
2. 打开浏览器开发者工具（F12）
3. 查看网络请求

**预期请求**：
```
http://192.168.31.170:3000/api/datasources/proxy/1/api/v1/label_values(...)
query: label_values(openclaw_up, instance)
```

**如果返回空**：
- 检查 Prometheus 数据源配置
- 检查 instance label 是否导出

---

### Step 6：查看 Dashboard JSON 格式

在 Grafana 导入后，打开 Dashboard 设置：

1. 点击右上角 ⚙️ 图标
2. 选择 **"JSON Model"**
3. 检查 JSON 结构

**必要字段**：
- `schemaVersion`: 必须为 `39`（Grafana 10.x+）
- `uid`: 必须为唯一字符串
- `panels`: 数组，至少包含 1 个面板

**常见错误**：
- `"templating"`: 拼写错误（应该是 `"templating"`）
- `"datasource"`: 使用了错误的 uid（应该使用 `datasource` 对象）

---

## 🎯 最小化测试 Dashboard

如果上述步骤都正确，但 Dashboard 仍然空白，导入最小化测试版本：

**文件**：`grafana/simple-test.json`

**包含面板**：
1. **OpenClaw Up Status**（Stat 类型）
   - 指标：`openclaw_up`
   - 目的：验证 Prometheus 数据源是否工作

2. **Message Sent Total**（Stat 类型）
   - 指标：`openclaw_session_messages_sent_total`
   - 目的：验证指标是否可查询

**如果测试 Dashboard 有数据，说明**：
- ✅ Prometheus 数据源配置正确
- ✅ 指标导出正常
- ❌ 原始 Dashboard JSON 格式有问题

---

## 🚀 完整故障排查

### 问题：导入失败

**错误信息**：
```
Dashboard JSON is not in the supported format
```

**解决方案**：
1. 验证 JSON 格式：使用 [JSONLint](https://jsonlint.com/)
2. 检查 `schemaVersion`: 必须为 `39`
3. 检查 `uid`: 必须为唯一字符串
4. 检查 `datasource`: 必须使用 `datasource` 对象，不能直接使用 uid

---

### 问题：数据源连接失败

**错误信息**：
```
Data source is not working
```

**解决方案**：
1. 检查 URL：`http://192.168.31.170:3000`（不是 `http://192.168.31.170:3000/metrics`）
2. 检查网络：`curl -I http://192.168.31.170:3000`
3. 检查认证：如果 Prometheus 启用了 Basic Auth
4. 检查 CORS：确保 Grafana 可访问 Prometheus

---

### 问题：变量查询失败

**错误信息**：
```
Variable query failed
```

**解决方案**：
1. 检查 Prometheus 是否返回 `openclaw_up` 指标
2. 检查指标是否包含 `instance` 标签
3. 使用简化查询：`label_values(up, instance)` 替代 `label_values(openclaw_up, instance)`
4. 手动添加变量值：在 Dashboard 设置中手动输入实例名

---

### 问题：面板显示 "No Data"

**原因**：
1. 查询时间范围不正确
2. 指标名称拼写错误
3. 变量未正确替换

**解决方案**：
1. 检查查询：确保指标名称正确（`openclaw_up`）
2. 检查时间范围：使用 `Last 15 minutes` 而不是 `Last 7 days`
3. 检查变量：确保 `$openclaw_instance` 已选择

---

## 🔍 详细排查步骤

### 1. 验证指标导出

```bash
# 检查插件是否安装
openclaw plugins list

# 检查插件状态
openclaw plugins status openclaw-prometheus

# 直接访问 metrics 端点
curl http://192.168.31.170:3000/metrics | head -50

# 搜索特定指标
curl http://192.168.31.170:3000/metrics | grep openclaw_up
```

**预期输出**：
```
# HELP openclaw_up Whether OpenClaw Prometheus plugin is loaded
# TYPE openclaw_up gauge
openclaw_up 1
```

**如果看不到指标**：
- 插件未安装或未启用
- HTTP 路由未注册
- 认证失败（scrapeAuth enabled）

---

### 2. 验证 Prometheus Scrape 配置

```bash
# 查看 Prometheus 配置
cat /etc/prometheus/prometheus.yml | grep -A10 "openclaw"

# 预期配置
scrape_configs:
  - job_name: 'openclaw'
    static_configs:
      - targets: ['192.168.31.170:3000']
    scrape_interval: 15s
    metrics_path: /metrics
```

**如果配置错误**：
- 检查 `job_name`：必须为 `openclaw`
- 检查 `targets`：必须是 `[ip:port]` 格式
- 检查 `scrape_interval`：推荐 15s
- 检查 `metrics_path`：必须是 `/metrics`

---

### 3. 检查 Grafana 网络请求

打开浏览器开发者工具（F12），检查网络请求：

**预期请求**：
```
GET /api/datasources/proxy/1/api/v1/query?query=...
Accept: application/json
Content-Type: application/json
```

**如果请求失败**：
- 检查网络连接
- 检查 CORS 配置
- 检查 Prometheus 是否正常运行

---

### 4. 导入最小化 Dashboard

1. **Dashboard** → **New** → **Import**
2. 上传 `grafana/simple-test.json`
3. 点击 **"Load"** 按钮
4. 选择数据源：`DS_PROMETHEUS`

**预期结果**：
- 显示 2 个简单面板
- 如果有数据，说明配置正确
- 如果仍然空白，说明 Prometheus 问题

---

## 🎯 下一步建议

### 如果测试 Dashboard 有数据

1. **导入修复后的完整 Dashboard**：
   ```bash
   grafana/import grafana/cluster/dashboard-overview.json
   ```

2. **检查变量**：
   - 在 Dashboard 中选择 `$openclaw_instance`
   - 确保显示实例列表

3. **调整时间范围**：
   - 使用 `Last 15 minutes`
   - 不要使用 `Last 7 days` 或 `Last 30 days`

### 如果测试 Dashboard 仍然空白

1. **检查 Prometheus 日志**：
   ```bash
   journalctl -u prometheus -f | tail -100
   ```

2. **检查插件日志**：
   ```bash
   journalctl -u openclaw-prometheus -f | tail -100
   ```

3. **重新安装插件**：
   ```bash
   openclaw plugins remove openclaw-prometheus
   openclaw plugins install
   ```

---

## 📊 已创建的文件

| 文件 | 说明 | 用途 |
|------|------|------|
| `grafana/simple-test.json` | 最小化测试 Dashboard | 2 个简单面板，用于快速排查 |
| `grafana/cluster/dashboard-overview.json` | 完整集群 Dashboard | 8 个面板，用于生产监控 |

---

## 🚀 快速修复清单

- [ ] 验证 Prometheus 返回 `openclaw_up` 指标
- [ ] 验证 Prometheus 包含 `instance` 标签
- [ ] 验证 Grafana 数据源连接成功
- [ ] 导入最小化测试 Dashboard
- [ ] 如果测试 Dashboard 有数据，导入完整 Dashboard
- [ ] 选择 `$openclaw_instance` 变量
- [ ] 调整时间范围为 `Last 15 minutes`

---

## 📝 日志收集

如果问题仍然存在，请收集以下信息：

```bash
# Prometheus 日志
journalctl -u prometheus -f | tail -50 > prometheus.log

# 插件日志
journalctl -u openclaw-prometheus -f | tail -50 > openclaw-prometheus.log

# 网络请求
curl http://192.168.31.170:3000/metrics | head -20 > metrics.log

# 压缩文件
tar -czvf debug-logs.tar.gz prometheus.log openclaw-prometheus.log metrics.log
```

---

**版本**：1.1  
**日期**：2026-04-20  
**状态**：🔧 **排查中**
