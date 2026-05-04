#!/usr/bin/env python3
"""
1) 可选：执行 grafana/cluster/_gen_dashboards.py 重新生成 JSON
2) 可选：将 dashboard 导入 Grafana（需 GRAFANA_PASSWORD / GRAFANA_API_KEY 或 GRAFANA_PASSWORD_FILE）
3) 必选：对 Prometheus 执行 Dashboard 内 PromQL 抽样校验（替换 Grafana 变量后）

环境变量：
  PROMETHEUS_URL      默认 http://192.168.31.170:9090
  VERIFY_INSTANCE_RE  默认 .* ，用于替换 $instance（可设为 192.168.31.201）
  GRAFANA_*           同 import-grafana-dashboards.py

可选本地文件（不提交仓库，已加入 .gitignore）：
  .env.grafana        每行 KEY=VALUE，例如 GRAFANA_PASSWORD=xxx

用法：
  python3 scripts/import-and-verify-openclaw-dashboards.py
  python3 scripts/import-and-verify-openclaw-dashboards.py --skip-generate --skip-import
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, DefaultDict, List, Set, Tuple

import requests

ROOT = Path(__file__).resolve().parent.parent
CLUSTER = ROOT / "grafana" / "cluster"
GEN = CLUSTER / "_gen_dashboards.py"
DOTENV = ROOT / ".env.grafana"
IMPORT_SCRIPT = ROOT / "scripts" / "import-grafana-dashboards.py"


def load_import_module():
    """加载 import-grafana-dashboards.py（文件名含连字符，不能常规 import）。"""
    spec = importlib.util.spec_from_file_location("openclaw_grafana_import", IMPORT_SCRIPT)
    if spec is None or spec.loader is None:
        return None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_dotenv_file() -> None:
    """从 .env.grafana 注入环境变量（不覆盖已 export 的值）。"""
    if not DOTENV.is_file():
        return
    for raw in DOTENV.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def run_generate() -> None:
    if not GEN.is_file():
        print(f"缺少生成脚本: {GEN}", file=sys.stderr)
        sys.exit(1)
    r = subprocess.run([sys.executable, str(GEN)], cwd=str(CLUSTER), check=False)
    if r.returncode != 0:
        print("生成 Dashboard JSON 失败", file=sys.stderr)
        sys.exit(1)
    print("已执行 _gen_dashboards.py")


def collect_target_exprs(dashboard: dict, dash_title: str) -> List[Tuple[str, str, str, str]]:
    """
    返回 (dashboard_title, panel_title, refId, expr)。
    跳过 Grafana 专有函数（非 Prometheus query API）。
    """
    out: List[Tuple[str, str, str, str]] = []
    seen: Set[str] = set()

    def walk_panels(panels: Any, default_title: str = "") -> None:
        if not isinstance(panels, list):
            return
        for p in panels:
            if not isinstance(p, dict):
                continue
            ptype = p.get("type")
            title = (p.get("title") or default_title or "(无标题)").strip()
            if ptype == "row" and p.get("panels"):
                walk_panels(p.get("panels"), title)
            for t in p.get("targets") or []:
                if not isinstance(t, dict):
                    continue
                expr = (t.get("expr") or "").strip()
                if not expr:
                    continue
                low = expr.lower()
                if "label_values(" in low or "metrics(" in low or "query_result(" in low:
                    continue
                ref = (t.get("refId") or "A").strip()
                key = f"{dash_title}|{title}|{ref}|{expr}"
                if key in seen:
                    continue
                seen.add(key)
                out.append((dash_title, title, ref, expr))
            nested = p.get("panels")
            if nested and ptype != "row":
                walk_panels(nested, title)

    walk_panels(dashboard.get("panels") or [], dashboard.get("title") or "")
    return out


def normalize_for_prometheus(expr: str, instance_re: str) -> str:
    """将 Grafana 变量替换为 Prometheus 可执行的查询字符串。"""
    e = expr.replace("$__rate_interval", "5m").replace("$__interval", "5m")
    e = e.replace("${instance}", instance_re).replace("$instance", instance_re)
    for v in ("channel", "provider", "model", "tool", "agent_id"):
        e = e.replace("${%s}" % v, ".*").replace("$%s" % v, ".*")
    return e


def prometheus_query_vector(url: str, expr: str, timeout: float = 20.0) -> Tuple[bool, str]:
    """
    执行 instant query。
    返回 (是否有至少一条瞬时结果, 说明)。
    """
    qurl = f"{url.rstrip('/')}/api/v1/query"
    try:
        r = requests.get(qurl, params={"query": expr}, timeout=timeout)
    except requests.RequestException as ex:
        return False, f"请求异常: {ex}"
    try:
        data = r.json()
    except json.JSONDecodeError:
        return False, f"非 JSON 响应 HTTP {r.status_code}: {r.text[:200]}"
    if data.get("status") != "success":
        return False, data.get("error") or data.get("errorType") or str(data)[:300]
    res = data.get("data", {}).get("result") or []
    if not res:
        return False, "result 为空"
    return True, f"OK {len(res)} 条序列"


def verify_dashboards(
    paths: List[Path],
    prom_url: str,
    instance_re: str,
) -> Tuple[int, int, List[str]]:
    """按「规范化后的 expr」去重校验，返回 (通过数, 失败数, 失败详情行)。"""
    by_expr: DefaultDict[str, List[str]] = defaultdict(list)
    for path in paths:
        dash = json.loads(path.read_text(encoding="utf-8"))
        title = dash.get("title") or path.name
        for _, panel, ref, raw in collect_target_exprs(dash, title):
            norm = normalize_for_prometheus(raw, instance_re)
            by_expr[norm].append(f"[{title}] {panel} ref={ref}")

    ok_n, bad_n = 0, 0
    bad_lines: List[str] = []
    for expr, refs in sorted(by_expr.items(), key=lambda x: x[0]):
        ok, msg = prometheus_query_vector(prom_url, expr)
        if ok:
            ok_n += 1
        else:
            bad_n += 1
            loc = "; ".join(refs[:5])
            if len(refs) > 5:
                loc += f" …共 {len(refs)} 处"
            snippet = expr.replace("\n", " ")[:200]
            bad_lines.append(f"{loc}\n  {snippet}\n  -> {msg}")
    return ok_n, bad_n, bad_lines


def main() -> None:
    load_dotenv_file()
    ap = argparse.ArgumentParser(description="生成 / 导入 OpenClaw Grafana Dashboard 并校验 PromQL")
    ap.add_argument("--skip-generate", action="store_true", help="不运行 _gen_dashboards.py")
    ap.add_argument("--skip-import", action="store_true", help="不调用 Grafana 导入 API")
    ap.add_argument("--prometheus-url", default=os.environ.get("PROMETHEUS_URL", "http://192.168.31.170:9090"))
    ap.add_argument(
        "--instance-regex",
        default=os.environ.get("VERIFY_INSTANCE_RE", ".*"),
        help="替换 $instance 的正则片段，默认 .*",
    )
    args = ap.parse_args()

    paths = [CLUSTER / "dashboard-overview.json", CLUSTER / "dashboard-metrics.json"]
    for p in paths:
        if not p.is_file():
            print(f"缺少 {p}", file=sys.stderr)
            sys.exit(1)

    if not args.skip_generate:
        run_generate()

    import_ok = True
    if not args.skip_import:
        pwd = (os.environ.get("GRAFANA_PASSWORD") or "").strip()
        key = (os.environ.get("GRAFANA_API_KEY") or "").strip()
        pwf = (os.environ.get("GRAFANA_PASSWORD_FILE") or "").strip()
        if not pwd and not key and not (pwf and Path(pwf).expanduser().is_file()):
            print("未配置 Grafana 凭据，跳过导入。请设置 GRAFANA_PASSWORD、GRAFANA_API_KEY 或 GRAFANA_PASSWORD_FILE / .env.grafana")
            import_ok = False
        else:
            igd = load_import_module()
            if igd is None:
                print(f"无法加载 {IMPORT_SCRIPT}", file=sys.stderr)
                sys.exit(1)
            try:
                session = igd.grafana_session()
                ds_uid, ds_name = igd.pick_prometheus_uid(session)
                for p in paths:
                    igd.import_one(session, p, ds_uid, ds_name)
                print("Grafana 导入完成。")
            except SystemExit:
                raise
            except Exception as ex:
                print(f"导入失败: {ex}", file=sys.stderr)
                import_ok = False

    print(f"\n开始 Prometheus 校验: {args.prometheus_url}  instance=~{args.instance_regex!r}")
    ok_n, bad_n, bad_lines = verify_dashboards(paths, args.prometheus_url, args.instance_regex)
    print(f"校验通过: {ok_n}  失败: {bad_n}")
    if bad_lines:
        print("\n---- 失败明细 ----")
        print("\n\n".join(bad_lines[:50]))
        if len(bad_lines) > 50:
            print(f"\n... 另有 {len(bad_lines) - 50} 条未列出")
        sys.exit(1)

    if not args.skip_import and not import_ok:
        print(
            "\nPromQL 校验已全部通过，但 Grafana 未导入（缺少凭据）。"
            "请设置 GRAFANA_PASSWORD、GRAFANA_API_KEY 或写入 .env.grafana / GRAFANA_PASSWORD_FILE 后重新运行（勿加 --skip-import）。"
        )
        sys.exit(2)

    tail = ""
    if not args.skip_import and import_ok:
        tail = " Grafana 已导入。"
    elif args.skip_import:
        tail = "（已跳过 Grafana 导入）"
    print(f"\n全部完成：PromQL 均有瞬时结果。{tail}")


if __name__ == "__main__":
    main()
