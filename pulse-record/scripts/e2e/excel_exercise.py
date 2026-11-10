#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""练习册验收 —— 填对没有？差在哪儿？

用法::

    python3 scripts/e2e/excel_exercise.py [工作簿路径]

默认验收 ``content/示例-填写示范.xlsx``。

## 怎么验

⭐ **不写死答案** —— 期望值从真源 `src/content/*.json` 现取，
   所以练习册不会和真源脱节，也不会「按错误的答案判对错」。

① 对每个练习点：读工作簿里那一格的**当前值** ＋ 从真源算出的**期望值**；
② 逐点比较，列出「✔ 对了 ／ ✗ 还差什么」；
③ 全部通过 → 练习完成。

## 顺带做一次「整体往返」

除了练习点，还把整个工作簿还原一遍，与真源 JSON 逐字段比对 ——
   确认除了练习点以外，你没有**误伤**别的地方（比如不小心删了一行）。

@see exercise_points.py
@see make_exercise_workbook.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPTS = ROOT / "scripts"
CONTENT = ROOT / "src" / "content"

sys.path.insert(0, str(SCRIPTS))
from excel_to_json import restore  # noqa: E402
from exercise_points import (  # noqa: E402
    EXERCISE_POINTS,
    expected_value,
    locate_cell,
    read_disk,
)

DEFAULT_WB = ROOT / "content" / "示例-填写示范.xlsx"

failures = 0
checks = 0


def ok(cond: bool, msg: str) -> None:
    global failures, checks
    checks += 1
    if cond:
        print(f"  ✓ {msg}")
    else:
        failures += 1
        print(f"  ✗ {msg}")


def main() -> int:
    wb_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_WB
    if not wb_path.exists():
        print(f"[exercise] 找不到工作簿：{wb_path}", file=sys.stderr)
        return 1

    disk = read_disk()
    wb = load_workbook(wb_path)

    print("① 练习点逐格验收")
    for p in EXERCISE_POINTS:
        try:
            row, col = locate_cell(wb, p)
        except KeyError as e:
            ok(False, f"{p['id']} {p['title']} —— {e}")
            continue
        want = expected_value(p, disk)
        raw = wb[p["where"]["sheet"]].cell(row=row, column=col).value
        got = "" if raw is None else str(raw)
        if got == want:
            ok(True, f"{p['id']} {p['title']} —— 已填对")
        else:
            ok(
                False,
                f"{p['id']} {p['title']}\n"
                f"      位置：{p['where']['sheet']} 第 {row} 行\n"
                f"      期望：{want!r}\n"
                f"      现在：{got!r}",
            )

    print("")
    print("② 整体往返（确认没误伤别的地方）")
    outputs, errors, _coords = restore(wb_path)
    if errors:
        for e in errors:
            print(f"  · {e}", file=sys.stderr)
        ok(False, f"还原时报 {len(errors)} 处问题")
    else:
        ok(True, "还原过程无报错")

        # 把练习点**补回期望值**后，应当与真源完全一致 ——
        # 这才说明「除了练习点，没别的地方被误伤」。
        patched = _patch_exercise_points(outputs, disk)
        for name, obj in sorted(outputs.items()):
            disk_doc = disk.get(name)
            if disk_doc is None:
                continue
            same = disk_doc == patched[name]
            ok(same, f"{name} —— 补回练习点后与真源完全一致")

    print("")
    if failures:
        print(f"[exercise] EXIT=1 —— {failures}/{checks} 项失败")
        return 1
    print(f"[exercise] EXIT=0 —— {checks} 项全过，练习完成 ✓")
    return 0


def _patch_exercise_points(outputs: dict, disk: dict) -> dict:
    """把还原结果里各练习点对应的那一处，替换成真源里的值。

    这样就能问出「除了练习点，还有没有别的地方不一样」。
    """
    patched = json.loads(json.dumps(outputs))  # 深拷贝
    for p in EXERCISE_POINTS:
        exp = p["expect"]
        want = expected_value(p, disk)
        obj = patched[exp["file"]]
        src = disk[exp["file"]]
        path = exp["path"]

        if "cell_key" in exp:
            # 未填的格在还原时会**整个消失**（不是值为空），
            # 所以补回时要按真源的顺序把它**插回去**；
            # 已存在的格保留还原结果 —— 这样「别的格被改错」仍会被抓到。
            src_cells = _reach_list(src, path)
            tgt_cells = _reach_list(obj, path)
            by_key = {c["cell"]: c for c in tgt_cells}
            merged = []
            for sc in src_cells:
                merged.append(by_key.get(sc["cell"], dict(sc)))
            tgt_cells[:] = merged
        elif "group_of" in exp:
            # 组号没有独立字段：整组照抄真源
            _assign(obj, path, _reach_list(src, path))
        elif "rel_index" in exp:
            rels = _reach_list(obj, path)
            rels[exp["rel_index"]]["probe"][exp["probe_index"]]["codes"] = want.split(",")
        else:
            _assign(obj, path, _reach_list(src, path))
    return patched


def _reach_list(doc: dict, path: list[str]) -> list:
    """取到 list 本身（list 按 id 找）。"""
    cur = doc
    for k in path:
        if isinstance(cur, list):
            cur = [x for x in cur if str(x.get("id")) == k][0]
        else:
            cur = cur[k]
    return cur


def _assign(doc: dict, path: list[str], value) -> None:
    """把 path 指向的位置设成 value。"""
    cur = doc
    for k in path[:-1]:
        if isinstance(cur, list):
            cur = [x for x in cur if str(x.get("id")) == k][0]
        else:
            cur = cur[k]
    last = path[-1]
    if isinstance(cur, list):
        for x in cur:
            if str(x.get("id")) == last:
                x.update(value)
                return
        raise KeyError(f"路径 {path}：list 里找不到 id＝{last}")
    cur[last] = value


if __name__ == "__main__":
    raise SystemExit(main())
