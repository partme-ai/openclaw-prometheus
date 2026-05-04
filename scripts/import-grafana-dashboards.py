#!/usr/bin/env python3
"""
将集群版 OpenClaw Grafana Dashboard 导入到指定 Grafana 实例。

认证（二选一）：
  - 用户名密码：设置 GRAFANA_USER（默认 admin）、GRAFANA_PASSWORD
  - API Key / Service Account Token：设置 GRAFANA_API_KEY（Bearer）

环境变量：
  GRAFANA_URL             默认 http://192.168.31.170:3000
  PROMETHEUS_DS_UID       可选；不设置时自动选取第一个 type=prometheus 的数据源
  GRAFANA_PASSWORD_FILE    可选；从文件读取密码（首行），避免出现在 shell 历史中

用法：
  export GRAFANA_PASSWORD='你的密码'
  python3 scripts/import-grafana-dashboards.py
"""
from __future__ import annotations

import getpass
from typing import Tuple
import json
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
CLUSTER = ROOT / "grafana" / "cluster"
DASHBOARDS = [
    CLUSTER / "dashboard-overview.json",
    CLUSTER / "dashboard-metrics.json",
]


def fix_datasource_template_variable(dash: dict, uid: str, name: str) -> None:
    """写入数据源模板变量的 current，避免导入后变量查询失败、Instance 无选项。"""
    for v in dash.get("templating", {}).get("list", []):
        if v.get("name") == "DS_PROMETHEUS" and v.get("type") == "datasource":
            v["current"] = {"selected": True, "text": name, "value": uid}
            v["options"] = [{"selected": True, "text": name, "value": uid, "isNone": False}]


def replace_datasource_uid(obj: object, uid: str) -> None:
    """将面板与变量中的 ${DS_PROMETHEUS} 替换为实际 Prometheus 数据源 UID。"""
    if isinstance(obj, dict):
        ds = obj.get("datasource")
        if isinstance(ds, dict) and ds.get("uid") == "${DS_PROMETHEUS}":
            ds["uid"] = uid
        elif isinstance(ds, list):
            for item in ds:
                if isinstance(item, dict) and item.get("uid") == "${DS_PROMETHEUS}":
                    item["uid"] = uid
        for v in obj.values():
            replace_datasource_uid(v, uid)
    elif isinstance(obj, list):
        for item in obj:
            replace_datasource_uid(item, uid)


def grafana_session() -> requests.Session:
    base = os.environ.get("GRAFANA_URL", "http://192.168.31.170:3000").rstrip("/")
    s = requests.Session()
    s.headers["Accept"] = "application/json"
    s.headers["Content-Type"] = "application/json"

    api_key = (os.environ.get("GRAFANA_API_KEY") or "").strip()
    if api_key:
        s.headers["Authorization"] = f"Bearer {api_key}"
        r = s.get(f"{base}/api/user", timeout=15)
        if r.status_code != 200:
            print(f"GRAFANA_API_KEY 无效: HTTP {r.status_code} {r.text[:300]}", file=sys.stderr)
            sys.exit(1)
        s._grafana_base = base  # type: ignore[attr-defined]
        return s

    user = os.environ.get("GRAFANA_USER", "admin")
    password = (os.environ.get("GRAFANA_PASSWORD") or "").strip()
    pw_file = (os.environ.get("GRAFANA_PASSWORD_FILE") or "").strip()
    if not password and pw_file:
        p = Path(pw_file).expanduser()
        if p.is_file():
            password = p.read_text(encoding="utf-8").splitlines()[0].strip()
    if not password and sys.stdin.isatty():
        password = getpass.getpass(f"Grafana 密码（用户 {user}）: ").strip()
    if not password:
        print(
            "请设置环境变量 GRAFANA_PASSWORD，或 GRAFANA_API_KEY（Service Account / API Key）。",
            file=sys.stderr,
        )
        sys.exit(1)

    r = s.post(f"{base}/login", json={"user": user, "password": password}, timeout=15)
    if r.status_code != 200:
        print(f"登录失败: HTTP {r.status_code} {r.text[:500]}", file=sys.stderr)
        sys.exit(1)
    try:
        msg = r.json().get("message", "")
    except json.JSONDecodeError:
        msg = ""
    if "Logged in" not in msg and r.status_code != 200:
        print(f"登录异常: {r.text[:500]}", file=sys.stderr)
        sys.exit(1)

    s._grafana_base = base  # type: ignore[attr-defined]
    return s


def pick_prometheus_uid(session: requests.Session) -> Tuple[str, str]:
    """返回 (uid, name)。"""
    base: str = session._grafana_base  # type: ignore[attr-defined]
    forced = (os.environ.get("PROMETHEUS_DS_UID") or "").strip()
    if forced:
        r = session.get(f"{base}/api/datasources", timeout=15)
        if r.status_code == 200:
            for x in r.json():
                if x.get("type") == "prometheus" and x.get("uid") == forced:
                    return forced, x.get("name") or forced
        return forced, forced

    r = session.get(f"{base}/api/datasources", timeout=15)
    if r.status_code != 200:
        print(f"无法列出数据源: HTTP {r.status_code} {r.text[:300]}", file=sys.stderr)
        sys.exit(1)
    rows = r.json()
    prom = [x for x in rows if x.get("type") == "prometheus"]
    if not prom:
        print("未找到 Prometheus 类型数据源，请设置 PROMETHEUS_DS_UID。", file=sys.stderr)
        sys.exit(1)
    # 优先 URL 含 9090 的实例（与 restore 脚本一致）
    for x in prom:
        url = (x.get("url") or "").lower()
        if "9090" in url:
            uid = x.get("uid")
            name = x.get("name") or uid
            print(f"选用 Prometheus 数据源: name={name} uid={uid} url={x.get('url')}")
            return uid, name
    x = prom[0]
    uid = x.get("uid")
    name = x.get("name") or uid
    print(f"选用 Prometheus 数据源: name={name} uid={uid} url={x.get('url')}")
    return uid, name


def import_one(session: requests.Session, path: Path, ds_uid: str, ds_name: str) -> None:
    base: str = session._grafana_base  # type: ignore[attr-defined]
    dash = json.loads(path.read_text(encoding="utf-8"))
    dash.pop("__inputs", None)
    dash.pop("__requires", None)
    fix_datasource_template_variable(dash, ds_uid, ds_name)
    replace_datasource_uid(dash, ds_uid)

    payload = {"dashboard": dash, "overwrite": True}
    r = session.post(f"{base}/api/dashboards/db", json=payload, timeout=60)
    if r.status_code != 200:
        print(f"导入失败 {path.name}: HTTP {r.status_code} {r.text[:800]}", file=sys.stderr)
        sys.exit(1)
    data = r.json()
    if not data.get("status") == "success":
        print(f"导入异常 {path.name}: {data}", file=sys.stderr)
        sys.exit(1)
    meta = data.get("url") or data.get("slug", "")
    print(f"已导入: {path.name} -> {base}{meta}")


def main() -> None:
    missing = [p for p in DASHBOARDS if not p.is_file()]
    if missing:
        print("缺少文件:", missing, file=sys.stderr)
        sys.exit(1)

    session = grafana_session()
    ds_uid, ds_name = pick_prometheus_uid(session)
    for p in DASHBOARDS:
        import_one(session, p, ds_uid, ds_name)
    print("全部完成。")


if __name__ == "__main__":
    main()
