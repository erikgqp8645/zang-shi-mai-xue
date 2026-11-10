#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Excel → JSON —— 把人工编辑后的工作簿还原成机器消费层

用法::

    python3 scripts/excel_to_json.py [工作簿路径] [--out 目录] [--check]

默认读 ``content/臧氏脉学-用方知识库.xlsx``，写回 ``src/content/*.json``。

## ``--check`` 模式

只校验、不写文件：把工作簿还原后与磁盘上的 JSON 逐字段比对，
不一致就打印差异并以非零码退出。**用来确认「改完 Excel 转回去没有丢东西」。**

## 还原时的严格性

宁可报错，也不猜：

  · 空的主键 → 报错（行无从认起）
  · 重复的主键 → 报错（还原时哪一行被覆盖说不清）
  · 引用了不存在的父 id → 报错（外键悬空）
  · 用字不在「脉象用字」表里 → 报错（图上写了个没定义的字）
  · 组号不是正整数 → 报错（AND 组的「第几组」说不清）
  · 同一父条目的关系种类前后用语不一致 → 报错（probe 归属说不清）

@see excel_schema.py
@see excel_from_json.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from openpyxl import load_workbook

from excel_schema import ARRAY_SEP, CODE_SEP, SHEETS, SheetDef

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "src" / "content"
DEFAULT_WB = ROOT / "content" / "臧氏脉学-用方知识库.xlsx"

SCHEMA_PREFIX = "./schema/"


class RestoreError(Exception):
    """还原失败。"""


def read_cell(value: Any, ctype: str, where: str, errors: list[str]) -> Any:
    """把一格的文本还原成值。"""
    if value is None:
        text = ""
    else:
        text = str(value)

    if ctype == "array":
        return [s.strip() for s in text.split(ARRAY_SEP) if s.strip() != ""]
    if ctype == "codes":
        return [s.strip() for s in text.split(CODE_SEP) if s.strip() != ""]
    if ctype == "int":
        t = text.strip()
        if t == "":
            return ""
        try:
            return int(t)
        except ValueError:
            errors.append(f"{where}：「{t}」不是整数")
            return t
    if ctype == "bool":
        t = text.strip().upper()
        if t == "":
            return ""
        if t in ("TRUE", "1", "是", "YES"):
            return True
        if t in ("FALSE", "0", "否", "NO"):
            return False
        errors.append(f"{where}：「{text}」不是布尔值（写 TRUE／FALSE）")
        return text
    return text


def read_sheet(wb, sheet: SheetDef) -> list[dict[str, Any]]:
    """读一张表，返回行数组（每行带 ``__row`` 行号）。"""
    ws = wb[sheet.name] if sheet.name in wb.sheetnames else None
    if ws is None:
        raise RestoreError(f"工作簿里没有 sheet「{sheet.name}」")

    rows: list[dict[str, Any]] = []
    for r in range(2, ws.max_row + 1):
        values = [ws.cell(row=r, column=i + 1).value for i in range(len(sheet.cols))]
        if all(v is None or str(v).strip() == "" for v in values):
            continue  # 全空行跳过
        item: dict[str, Any] = {}
        for i, c in enumerate(sheet.cols):
            item[c.key] = values[i]
        item["__row"] = r
        rows.append(item)
    return rows


def main() -> int:
    args = [a for a in sys.argv[1:]]
    check_only = "--check" in args
    args = [a for a in args if a != "--check"]
    out_dir = CONTENT
    if "--out" in args:
        i = args.index("--out")
        out_dir = Path(args[i + 1]).resolve()
        del args[i : i + 2]
    wb_path = Path(args[0]).resolve() if args else DEFAULT_WB

    if not wb_path.exists():
        print(f"[excel] 找不到工作簿：{wb_path}", file=sys.stderr)
        return 1

    wb = load_workbook(wb_path, data_only=True)
    errors: list[str] = []

    # ---- 读各主表 ----
    restored: dict[str, Any] = {}

    # 用字表要先读（脉象图校验要用）
    terms: dict[str, Any] = {}
    for r in read_sheet(wb, next(s for s in SHEETS if s.json_path == "terms")):
        term = r["term"]
        if term is None or str(term).strip() == "":
            errors.append(f"「脉象用字」第 {r['__row']} 行：用字为空")
            continue
        term = str(term).strip()
        if term in terms:
            errors.append(f"「脉象用字」第 {r['__row']} 行：用字「{term}」重复")
            continue
        codes = read_cell(r["codes"], "codes", f"「脉象用字」第 {r['__row']} 行", errors)
        also = read_cell(r["also"], "codes", f"「脉象用字」第 {r['__row']} 行", errors)
        entry: dict[str, Any] = {"codes": codes}
        if also:
            entry["also"] = also
        entry["display"] = "" if r["display"] is None else str(r["display"])
        note = r.get("note")
        if note is not None and str(note).strip() != "":
            entry["note"] = str(note)
        terms[term] = entry
    restored["terms"] = terms

    for sheet in SHEETS:
        if sheet.json_path.startswith("__") or sheet.json_path == "terms":
            continue
        rows = read_sheet(wb, sheet)

        if sheet.dict_value:
            # 键 → 对象 的字典（键是第一列，value 是其余列）
            d2: dict[str, Any] = {}
            seen2: set[str] = set()
            for r in rows:
                k = r[sheet.row_key]
                if k is None or str(k).strip() == "":
                    errors.append(f"「{sheet.name}」第 {r['__row']} 行：主键（{sheet.row_key}）为空")
                    continue
                k = str(k).strip()
                if k in seen2:
                    errors.append(f"「{sheet.name}」第 {r['__row']} 行：主键「{k}」重复")
                    continue
                seen2.add(k)
                obj: dict[str, Any] = {}
                for c in sheet.cols:
                    if c.key == sheet.row_key:
                        continue  # 键是字典键，不进 value
                    v = r[c.key]
                    if c.type in ("array", "codes", "bool"):
                        val = read_cell(v, c.type, f"「{sheet.name}」第 {r['__row']} 行", errors)
                    else:
                        val = "" if v is None else str(v)
                    if c.omit_empty and (val == "" or val == [] or val is False):
                        continue
                    obj[c.key] = val
                d2[k] = obj
            restored[sheet.json_path] = d2
            continue

        if sheet.is_dict:
            # 两列 → 字典（value 是字符串）
            d: dict[str, Any] = {}
            for r in rows:
                k = r[sheet.cols[0].key]
                v = r[sheet.cols[1].key]
                if k is None or str(k).strip() == "":
                    errors.append(f"「{sheet.name}」第 {r['__row']} 行：主键为空")
                    continue
                d[str(k).strip()] = "" if v is None else str(v)
            restored[sheet.json_path] = d
            continue

        # 有主键的表
        list_out: list[dict[str, Any]] = []
        seen: set[str] = set()
        for r in rows:
            key = r[sheet.row_key]
            if key is None or str(key).strip() == "":
                errors.append(f"「{sheet.name}」第 {r['__row']} 行：主键（{sheet.row_key}）为空")
                continue
            key = str(key).strip()
            if key in seen:
                errors.append(f"「{sheet.name}」第 {r['__row']} 行：主键「{key}」重复")
                continue
            seen.add(key)
            item: dict[str, Any] = {}
            for c in sheet.cols:
                v = r[c.key]
                if c.type in ("array", "codes", "bool"):
                    val = read_cell(v, c.type, f"「{sheet.name}」第 {r['__row']} 行", errors)
                elif c.type == "int":
                    val = read_cell(v, "int", f"「{sheet.name}」第 {r['__row']} 行", errors)
                else:
                    val = "" if v is None else str(v)
                # 稀疏还原：空值不产出该键（原文 JSON 里讲稿没写的字段本就没有键）
                if c.omit_empty and (val == "" or val == [] or val is False):
                    continue
                item[c.key] = val
            list_out.append(item)
        restored[sheet.json_path] = list_out

    # ---- 脉象图：从属表还原 ----
    patterns = restored.get("patterns") or []
    pattern_ids = {p["id"] for p in patterns}

    cells_by_id: dict[str, list[dict[str, Any]]] = {}
    groups_by_id: dict[str, dict[int, list[str]]] = {}
    group_order: dict[str, list[int]] = {}

    for r in read_sheet(wb, next(s for s in SHEETS if s.json_path == "__patternCells")):
        pid = r["patternId"]
        where = f"「脉象图·格位」第 {r['__row']} 行"
        if pid is None or str(pid).strip() == "":
            errors.append(f"{where}：条目ID 为空")
            continue
        pid = str(pid).strip()
        if pid not in pattern_ids:
            errors.append(f"{where}：条目ID「{pid}」在「脉象图·条目」里不存在")
            continue
        cell = r["cell"]
        if cell is None or str(cell).strip() == "":
            errors.append(f"{where}：格位为空")
            continue
        cell = str(cell).strip()
        term = r["term"]
        if term is None or str(term).strip() == "":
            errors.append(f"{where}：用字为空")
            continue
        term = str(term).strip()
        if term not in terms:
            errors.append(f"{where}：用字「{term}」不在「脉象用字」表里")
            continue

        item: dict[str, Any] = {"cell": cell, "term": term}
        note = r["note"]
        if note is not None and str(note).strip() != "":
            item["note"] = str(note)
        flex = r["flex"]
        if flex is not None and str(flex).strip().upper() in ("TRUE", "1", "是"):
            item["flex"] = True

        cells_by_id.setdefault(pid, []).append(item)

        g = r["group"]
        gtxt = "" if g is None else str(g).strip()
        if gtxt != "":
            try:
                gi = int(gtxt)
            except ValueError:
                errors.append(f"{where}：组号「{gtxt}」不是正整数")
                gi = 0
            if gi >= 1:
                groups_by_id.setdefault(pid, {}).setdefault(gi, []).append(cell)
                order = group_order.setdefault(pid, [])
                if gi not in order:
                    order.append(gi)

    rels_by_id: dict[str, list[dict[str, Any]]] = {}
    rel_index: dict[str, dict[str, dict[str, Any]]] = {}

    for r in read_sheet(wb, next(s for s in SHEETS if s.json_path == "__patternRelations")):
        pid = r["patternId"]
        where = f"「脉象图·关系」第 {r['__row']} 行"
        if pid is None or str(pid).strip() == "":
            errors.append(f"{where}：条目ID 为空")
            continue
        pid = str(pid).strip()
        if pid not in pattern_ids:
            errors.append(f"{where}：条目ID「{pid}」在「脉象图·条目」里不存在")
            continue
        kind = r["kind"]
        if kind is None or str(kind).strip() == "":
            errors.append(f"{where}：关系种类为空")
            continue
        kind = str(kind).strip()
        text = "" if r["text"] is None else str(r["text"])

        bucket = rels_by_id.setdefault(pid, [])
        idx = rel_index.setdefault(pid, {})
        rel = idx.get(kind)
        if rel is None:
            rel = {"kind": kind, "text": text}
            idx[kind] = rel
            bucket.append(rel)
        elif rel["text"] != text:
            errors.append(f"{where}：条目「{pid}」的关系「{kind}」原文用语前后不一致")

        pc = r["probeCell"]
        if pc is not None and str(pc).strip() != "":
            codes = read_cell(r["probeCodes"], "codes", where, errors)
            rel.setdefault("probe", []).append({"cell": str(pc).strip(), "codes": codes})
    final_patterns: dict[str, Any] = {}
    for p in patterns:
        # ⚠️ 原 JSON 里 pattern 的 value **不含 id**（id 是字典的键），别加进去
        item: dict[str, Any] = {"cells": cells_by_id.get(p["id"], [])}
        gmap = groups_by_id.get(p["id"])
        if gmap:
            item["groups"] = [gmap[gi] for gi in group_order.get(p["id"], [])]
        rels = rels_by_id.get(p["id"])
        if rels:
            item["relations"] = rels
        item["source"] = p.get("source", "")
        if p.get("note"):
            item["note"] = p["note"]
        final_patterns[p["id"]] = item

    if errors:
        print(f"[excel] 还原失败，{len(errors)} 处问题：", file=sys.stderr)
        for e in errors:
            print(f"  · {e}", file=sys.stderr)
        return 1

    outputs = {
        "drugs.json": {"$schema": SCHEMA_PREFIX + "drugs.schema.json", "drugs": restored["drugs"]},
        "doses.json": {
            "$schema": SCHEMA_PREFIX + "doses.schema.json",
            "doses": restored["doses"],
            "sciences": restored["sciences"],
            "scienceByDoseId": restored["scienceByDoseId"],
        },
        "formula-reference.json": {
            "$schema": SCHEMA_PREFIX + "formula-reference.schema.json",
            "rows": restored["rows"],
            "alias": restored["alias"],
            "draftExtra": restored["draftExtra"],
        },
        "pulse-terms.json": {"$schema": SCHEMA_PREFIX + "pulse-terms.schema.json", "terms": restored["terms"]},
        "pulse-patterns.json": {
            "$schema": SCHEMA_PREFIX + "pulse-patterns.schema.json",
            "patterns": final_patterns,
        },
        "formula-rules.json": {
            "$schema": SCHEMA_PREFIX + "formula-rules.schema.json",
            "rules": restored["rules"],
        },
        "pulse-groups.json": {
            "$schema": SCHEMA_PREFIX + "pulse-groups.schema.json",
            "groups": restored["groups"],
        },
    }

    if check_only:
        bad = 0
        for name, obj in outputs.items():
            disk_path = CONTENT / name
            if not disk_path.exists():
                print(f"[excel] {name}: 磁盘上没有可读的文件", file=sys.stderr)
                bad += 1
                continue
            disk = json.loads(disk_path.read_text(encoding="utf-8"))
            if disk == obj:
                print(f"[excel] {name}: 一致 ✓")
            else:
                bad += 1
                print(f"[excel] {name}: 不一致", file=sys.stderr)
                for line in _diff_lines(disk, obj)[:20]:
                    print(f"  · {line}", file=sys.stderr)
        if bad:
            print(f"[excel] --check 失败：{bad} 个文件与工作簿不一致", file=sys.stderr)
            return 1
        print("[excel] --check 通过：工作簿与 JSON 完全一致")
        return 0

    out_dir.mkdir(parents=True, exist_ok=True)
    for name, obj in outputs.items():
        text = json.dumps(obj, ensure_ascii=False, indent=2) + "\n"
        (out_dir / name).write_text(text, encoding="utf-8")
        print(f"[excel] 已写出 {out_dir / name}  {len(text.encode('utf-8'))} 字节")
    print("[excel] 完毕")
    return 0


def _diff_lines(a: Any, b: Any, path: str = "") -> list[str]:
    """深比较，返回差异描述。"""
    out: list[str] = []
    ta = "array" if isinstance(a, list) else type(a).__name__
    tb = "array" if isinstance(b, list) else type(b).__name__
    if ta != tb:
        return [f"{path or '(根)'}: 类型 {ta} ≠ {tb}"]
    if ta == "array":
        if len(a) != len(b):
            out.append(f"{path}: 数组长度 {len(a)} ≠ {len(b)}")
        for i in range(max(len(a), len(b))):
            out.extend(_diff_lines(a[i] if i < len(a) else None, b[i] if i < len(b) else None, f"{path}[{i}]"))
        return out
    if ta == "dict":
        for k in sorted(set(a) | set(b)):
            out.extend(_diff_lines(a.get(k), b.get(k), f"{path}.{k}" if path else k))
        return out
    if a != b:
        out.append(f"{path}: {json.dumps(a, ensure_ascii=False)} ≠ {json.dumps(b, ensure_ascii=False)}")
    return out


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RestoreError as e:
        print(f"[excel] {e}", file=sys.stderr)
        raise SystemExit(1)
