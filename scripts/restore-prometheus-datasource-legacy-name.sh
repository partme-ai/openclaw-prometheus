#!/usr/bin/env bash
# 将默认 Prometheus 数据源的显示名改回 Prometheus-192.168.1.170（URL 不变）。
# 解决 Grafana 报错：Failed to upgrade legacy queries Datasource Prometheus-192.168.1.170 was not found
# 原因：旧面板/变量曾按「数据源名称」绑定，改名后名称解析失败。
#
# 用法（在能访问 Grafana 的机器上执行）：
#   export GRAFANA_URL="http://192.168.31.170:3000"
#   export GRAFANA_USER="admin"
#   export GRAFANA_PASSWORD="你的密码"
#   bash scripts/restore-prometheus-datasource-legacy-name.sh
#
# 可选：指定数据源 UID（默认自动选取 URL 含 192.168.31.170:9090 的 prometheus 类型）
#   export PROMETHEUS_DS_UID="2kHivvLVz"

set -euo pipefail

GRAFANA_URL="${GRAFANA_URL:-http://127.0.0.1:3000}"
GRAFANA_USER="${GRAFANA_USER:-admin}"
GRAFANA_PASSWORD="${GRAFANA_PASSWORD:?请设置 GRAFANA_PASSWORD}"

COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

login_json="$(jq -n --arg u "$GRAFANA_USER" --arg p "$GRAFANA_PASSWORD" '{user:$u,password:$p}')"

curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  -X POST "${GRAFANA_URL%/}/login" \
  -d "$login_json" | jq -e '.message == "Logged in"' >/dev/null

auth_hdr=(-b "$COOKIE_JAR")

list_json="$(curl -sS "${auth_hdr[@]}" "${GRAFANA_URL%/}/api/datasources")"

if [[ -n "${PROMETHEUS_DS_UID:-}" ]]; then
  ds_id="$(echo "$list_json" | jq -r --arg uid "$PROMETHEUS_DS_UID" '.[] | select(.uid==$uid) | .id')"
else
  ds_id="$(echo "$list_json" | jq -r \
    '.[] | select(.type=="prometheus") | select(.url|test("192\\.168\\.31\\.170:9090")) | .id' | head -1)"
fi

if [[ -z "$ds_id" || "$ds_id" == "null" ]]; then
  echo "未找到 URL 为 192.168.31.170:9090 的 Prometheus 数据源；请设置 PROMETHEUS_DS_UID" >&2
  exit 1
fi

full="$(curl -sS "${auth_hdr[@]}" "${GRAFANA_URL%/}/api/datasources/${ds_id}")"
new="$(echo "$full" | jq '.name = "Prometheus-192.168.1.170"')"

curl -sS "${auth_hdr[@]}" -H 'Content-Type: application/json' \
  -X PUT "${GRAFANA_URL%/}/api/datasources/${ds_id}" \
  -d "$new" | jq '{message, name: .datasource.name, url: .datasource.url, uid: .datasource.uid}'

echo "已恢复数据源显示名为 Prometheus-192.168.1.170（请刷新浏览器）。"
