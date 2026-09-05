#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QDII 海外指数基金申购监控 - 数据采集脚本

抓取公开的基金数据接口（东方财富/天天基金），覆盖所有场外跟踪
纳斯达克100 与标普500 的 QDII 指数基金，输出 data/data.json 供前端渲染。

用法:
    python collect.py            # 全量抓取
    python collect.py --limit 5  # 只抓前 5 只，调试用
    python collect.py --no-cache # 忽略缓存，强制更新
"""

import argparse
import datetime
import json
import os
import re
import time
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
CACHE_FILE = os.path.join(DATA_DIR, "_cache.json")
OUT_FILE = os.path.join(DATA_DIR, "data.json")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Referer": "https://fund.eastmoney.com/",
    "Accept": "*/*",
}


def http_get(url, timeout=25, tries=3, wait=0.7):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "ignore")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(wait * (i + 1))
    raise RuntimeError("GET failed: %s -> %s" % (url, last))


def fetch_fund_list():
    txt = http_get("https://fund.eastmoney.com/js/fundcode_search.js", timeout=45)
    m = re.search(r"\[(.*)\]", txt, re.S)
    data = json.loads("[" + m.group(1) + "]")
    out = []
    seen = set()
    for row in data:
        code, name, typ = row[0], row[2], row[3]
        if typ.strip() != "指数型-海外股票":
            continue
        if ("ETF" in name) and ("联接" not in name):
            continue
        if "纳斯达克100" in name or "纳指" in name:
            key = "nasdaq100"
        elif "标普500" in name:
            key = "sp500"
        else:
            continue
        if code in seen:
            continue
        seen.add(code)
        out.append((code, name, key))
    return out


def _grab(raw, names):
    """抓取 pingzhongdata 里若干变量的值（返回 name->值 或 None）。"""
    vals = {}
    for name in names:
        m = re.search(r"var\s+%s\s*=\s*" % re.escape(name) + r"(.+?);(?=\s*var\s)", raw, re.S)
        if m:
            vals[name] = m.group(1).strip()
    return vals


def fetch_pzd(code):
    """一次请求拿到：收益、规模、净值全历史、成立日。"""
    raw = http_get("https://fund.eastmoney.com/pingzhongdata/%s.js" % code, timeout=40)
    out = {"returns": {}, "size": None, "size_date": None, "inception": None, "nw": []}
    for m in re.finditer(r'var\s+(\w+)\s*=\s*"([0-9.\-]+)"', raw):
        out["returns"][m.group(1)] = float(m.group(2))
    # 规模
    ms = re.search(r"var\s+Data_fluctuationScale\s*=\s*(\{.*?\});", raw, re.S)
    if ms:
        try:
            sc = json.loads(ms.group(1))
            if sc.get("series"):
                out["size"] = sc["series"][-1].get("y")
                out["size_date"] = sc["categories"][-1] if sc.get("categories") else None
        except Exception:
            pass
    # 成立日（累计净值首条时间）
    ma = re.search(r"var\s+Data_ACWorthTrend\s*=\s*(\[\[.*?\]\]);", raw, re.S)
    if ma:
        try:
            arr = json.loads(ma.group(1))
            if arr:
                ms0 = arr[0][0]
                out["inception"] = datetime.datetime.fromtimestamp(
                    ms0 / 1000, datetime.timezone.utc
                ).strftime("%Y-%m-%d")
        except Exception:
            pass
    # 净值全历史
    mn = re.search(r"var\s+Data_netWorthTrend\s*=\s*(\[.*?\]);", raw, re.S)
    if mn:
        try:
            arr = json.loads(mn.group(1))
            # 每项 {x(ms), y(nav), equityReturn, unitMoney}
            out["nw"] = [
                {"date": datetime.datetime.fromtimestamp(
                    it["x"] / 1000, datetime.timezone.utc
                ).strftime("%Y-%m-%d"),
                 "nav": it.get("y"),
                 "chg": it.get("equityReturn")}
                for it in arr
                if it.get("y") is not None
            ]
        except Exception:
            pass
    return out


def fetch_lsjz(code):
    """最近 20 条净值 + 每条的 SGZT/SHZT（申购、赎回状态）。最新在前。"""
    url = "https://api.fund.eastmoney.com/f10/lsjz?fundCode=%s&pageIndex=1&pageSize=20" % code
    j = json.loads(http_get(url))
    arr = (j.get("Data") or {}).get("LSJZList") or []
    rows = []
    for it in arr:
        rows.append({
            "date": it.get("FSRQ"),
            "nav": it.get("DWJZ"),
            "chg": it.get("JZZZL"),
            "sgzt": it.get("SGZT"),
            "shzt": it.get("SHZT"),
        })
    return rows


def fetch_detail(code):
    """F10 基金概况。返回 {mgmt, custody, sales, inception}，均为 % 数值。"""
    try:
        html = http_get("https://fundf10.eastmoney.com/jbgk_%s.html" % code, timeout=40)
    except Exception:
        return {}
    def rate(label):
        m = re.search(label + r"率?</th><td>\s*([0-9.]+)\s*%", html)
        return float(m.group(1)) if m else None
    mgmt = rate("管理费")
    custody = rate("托管费")
    sales = rate("销售服务费")
    inception = None
    mi = re.search(r"成立日期</th><td>\s*([0-9\-]+)", html)
    if mi:
        inception = mi.group(1)
    return {
        "mgmt": mgmt,
        "custody": custody,
        "sales": sales,
        "inception": inception,
    }


def fetch_jjfl(code):
    """F10 基金费率。返回 {buy_fee}，取申购费率第一档（小额）的 % 数值。"""
    try:
        html = http_get("https://fundf10.eastmoney.com/jjfl_%s.html" % code, timeout=40)
    except Exception:
        return {}
    i = html.find("申购费率")
    if i < 0:
        return {}
    seg = html[i:i + 2000]
    m = re.search(r"<td[^>]*>\s*([0-9.]+)\s*%", seg)
    return {"buy_fee": float(m.group(1)) if m else None}


def fetch_page(code):
    """基金详情页。返回 {limit_amount(代销平台每日限额,元), tracking_error(年化跟踪误差,%)}。"""
    try:
        html = http_get("https://fund.eastmoney.com/%s.html" % code, timeout=40)
    except Exception:
        return {}
    # 代销平台每日限额：交易状态里“……单日累计购买上限 10.00元”
    limit = None
    m = re.search(r"单日累计购买上限\s*([0-9.]+)\s*元", html)
    if m:
        limit = float(m.group(1))
    te = None
    m2 = re.search(r"年化跟踪误差[：:][^0-9]*?([0-9.]+)\s*%", html)
    if m2:
        te = float(m2.group(1))
    return {"limit_amount": limit, "tracking_error": te}


def return_3y(nw):
    """近 3 年收益率(%)。nw 按时间升序，最新在最后。"""
    if len(nw) < 240:
        return None
    latest = nw[-1]
    cur = _num(latest["nav"])
    if cur is None:
        return None
    try:
        latest_date = datetime.date.fromisoformat(latest["date"])
        target_date = latest_date - datetime.timedelta(days=int(365.25 * 3))
        for it in reversed(nw):
            d = datetime.date.fromisoformat(it["date"])
            if d <= target_date:
                prev = _num(it["nav"])
                if prev:
                    return round((cur / prev - 1) * 100, 2)
                return None
    except Exception:
        return None
    return None


def _num(v):
    if v in (None, "--", ""):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def map_status(sgzt):
    if not sgzt:
        return None
    if "暂停大额" in sgzt:
        return "限大额"
    if "暂停" in sgzt:
        return "暂停"
    if "限制" in sgzt or "大额" in sgzt or "限" in sgzt:
        return "限大额"
    return "开放"


def map_redeem(shzt):
    if not shzt:
        return None
    if "暂停" in shzt:
        return "暂停"
    return "开放"


def compute_changes(fund, history):
    changes = []
    for i in range(len(history) - 1):
        cur, nxt = history[i], history[i + 1]
        if cur["status"] != nxt["status"]:
            changes.append({"date": cur["date"], "field": "status",
                            "old_val": nxt["status"], "new_val": cur["status"],
                            "code": fund["code"], "name": fund["name"]})
        elif cur["redeem"] != nxt["redeem"]:
            changes.append({"date": cur["date"], "field": "redeem",
                            "old_val": nxt["redeem"], "new_val": cur["redeem"],
                            "code": fund["code"], "name": fund["name"]})
    return changes


def load_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_cache(c):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(c, f, ensure_ascii=False, indent=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--no-cache", action="store_true")
    args = ap.parse_args()

    cache = {} if args.no_cache else load_cache()
    meta = fetch_fund_list()
    if args.limit:
        meta = meta[:args.limit]
    print("基金数量:", len(meta))

    # 加载上一次数据，失败时保留该基金最近一次已知数据，避免漏掉基金
    prev_map = {}
    if os.path.exists(OUT_FILE):
        try:
            with open(OUT_FILE, "r", encoding="utf-8") as f:
                prev_map = {x["code"]: x for x in json.load(f).get("funds", [])}
        except Exception:
            prev_map = {}

    funds = []
    errors = []

    def preserve(code):
        p = prev_map.get(code)
        if p and not any(f["code"] == code for f in funds):
            funds.append(p)

    for i, (code, name, key) in enumerate(meta):
        cached = cache.get(code, {})
        pzd = cached.get("pzd")
        lsjz = cached.get("lsjz")
        detail = cached.get("detail")
        page = cached.get("page")
        jjfl = cached.get("jjfl")
        ok = (pzd is not None and lsjz is not None and detail is not None
              and page is not None and jjfl is not None)
        if not ok:
            try:
                pzd = fetch_pzd(code)
                lsjz = fetch_lsjz(code)
                detail = fetch_detail(code)
                page = fetch_page(code)
                jjfl = fetch_jjfl(code)
                cache[code] = {"pzd": pzd, "lsjz": lsjz, "detail": detail,
                               "page": page, "jjfl": jjfl}
            except Exception as e:  # noqa: BLE001
                errors.append((code, name, str(e)))
                print("  [%d/%d] %s ERR %s" % (i + 1, len(meta), code, e))
                preserve(code)
                continue
        if not lsjz or not pzd.get("nw"):
            errors.append((code, name, "no data"))
            preserve(code)
            continue

        try:
            cur = lsjz[0]
            nw = pzd["nw"]
            latest = nw[-1]
            first = nw[0]
            since = None
            cur_nav = _num(latest["nav"])
            if cur_nav is not None and first["nav"]:
                try:
                    since = round((cur_nav / float(first["nav"]) - 1) * 100, 2)
                except Exception:
                    since = None
            history = [{"date": r["date"], "status": map_status(r["sgzt"]),
                        "redeem": map_redeem(r["shzt"])} for r in lsjz]
            mgmt = (detail or {}).get("mgmt")
            custody = (detail or {}).get("custody")
            sales = (detail or {}).get("sales")
            buy = (jjfl or {}).get("buy_fee")
            comps = [buy, mgmt, custody, sales]
            fee_total = round(sum(c for c in comps if c is not None), 2) if any(c is not None for c in comps) else None
            fund = {
                "code": code,
                "name": name,
                "index_key": key,
                "status": map_status(cur["sgzt"]),
                "redeem": map_redeem(cur["shzt"]),
                "nav": _num(cur["nav"]),
                "nav_date": cur["date"],
                "nav_chg": _num(cur["chg"]),
                "return_1m": pzd["returns"].get("syl_1y"),
                "return_6m": pzd["returns"].get("syl_6y"),
                "return_1y": pzd["returns"].get("syl_1n"),
                "return_3y": return_3y(nw),
                "return_since": since,
                "inception_date": pzd.get("inception"),
                "fund_size": pzd.get("size"),
                "fund_size_date": pzd.get("size_date"),
                "buy_fee": buy,
                "mgmt_fee": mgmt,
                "custody_fee": custody,
                "sales_fee": sales,
                "fee_total": fee_total,
                "limit_amount": (page or {}).get("limit_amount"),
                "tracking_error": (page or {}).get("tracking_error"),
                "history": history,
            }
            funds.append(fund)
        except Exception as e:  # noqa: BLE001
            errors.append((code, name, str(e)))
            print("  [%d/%d] %s ERR %s" % (i + 1, len(meta), code, e))
            preserve(code)
        if i % 5 == 0:
            print("  [%d/%d] ok %d" % (i + 1, len(meta), len(funds)))
        time.sleep(0.35)

    changes = []
    for f in funds:
        changes.extend(compute_changes(f, f["history"]))
    changes.sort(key=lambda x: (x.get("date") or "", x.get("code")), reverse=True)

    funds.sort(key=lambda f: (f["index_key"], f["name"]))
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    data = {
        "generated_at": now,
        "updated_at": now,
        "source": "公开基金数据接口（东方财富 / 天天基金）",
        "fund_count": len(funds),
        "funds": funds,
        "recent_changes": changes[:80],
    }
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    save_cache(cache)
    print("完成: %d 只基金, %d 条变更, %d 个错误" % (len(funds), len(changes), len(errors)))
    for e in errors:
        print("  ERR", e)


if __name__ == "__main__":
    main()
