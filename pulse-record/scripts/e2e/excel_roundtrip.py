#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Excel 中间格式 —— 往返一致性测试

用法::

    python3 scripts/e2e/excel_roundtrip.py

## 测什么

「JSON → Excel → JSON」必须与原 JSON **完全一致**（逐字段）。
这一条守住的是：用户在 Excel 里改的东西，能一字不差地转回机器消费层。

## 怎么测

① 从磁盘 JSON 生成工作簿（写到临时目录）
② 从工作簿还原 JSON
③ 与磁盘 JSON 逐字段比对

⭐ **必须按结构比对，不能靠「全文搜词」** ——
   全文搜词会被「值恰好出现在别处」骗过。

⚠️ 本测试自己就是被测对象的一部分，所以它**不能**同时验证「自己写的对不对」。
   为此另有一组「故意写坏」的用例（见 ``excel_roundtrip_break.py``）：
   往工作簿里注入坏数据，断言还原脚本**必须报错** ——
   证明它不是无脑接受一切。
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPTS = ROOT / "scripts"
CONTENT = ROOT / "src" / "content"

sys.path.insert(0, str(SCRIPTS))
from excel_schema import MATRIX_ROWS, MATRIX_SHEET_PREFIX  # noqa: E402

FILES = [
    "drugs.json",
    "doses.json",
    "formula-reference.json",
    "pulse-terms.json",
    "pulse-patterns.json",
    "formula-rules.json",
    "pulse-groups.json",
    "symbols.json",
]

#: 格位键 → (手序, 行序) —— 矩阵派生序（左手 9 行读完，再右手 9 行）
ROW_IDX = {(organ, depth): i for i, (organ, depth) in enumerate(MATRIX_ROWS)}


def cell_sort_key(cell_key: str) -> tuple[int, int]:
    hand, organ, depth = cell_key.split("|")
    return (0 if hand == "L" else 1, ROW_IDX[(organ, depth)])

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


def eq(a: object, b: object, msg: str) -> None:
    same = a == b
    ok(same, msg if same else f"{msg}\n      期望: {b!r}\n      实际: {a!r}")


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True)


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="pulse-excel-"))
    wb_path = tmp / "roundtrip.xlsx"
    out_dir = tmp / "out"
    try:
        print("① JSON → Excel")
        r = run([sys.executable, str(SCRIPTS / "excel_from_json.py"), str(wb_path)])
        ok(r.returncode == 0, f"生成工作簿不报错（退出码 {r.returncode}）")
        if r.returncode != 0:
            print(r.stderr)
            return 1

        print("② 矩阵 sheet 结构（**必须在还原之前查** —— 还原失败会短路，"
              "放到后面就永远抓不到序号错乱）")
        from openpyxl import load_workbook

        wb = load_workbook(wb_path)
        matrix_sheets = [n for n in wb.sheetnames if n.startswith(MATRIX_SHEET_PREFIX) and "-" in n]
        eq(len(matrix_sheets), 50, f"矩阵 sheet 50 个（实际 {len(matrix_sheets)}）")
        # 序号必须连续无缺 —— 缺一个就等于漏掉一张脉象图
        seqs = sorted(
            int(n[len(MATRIX_SHEET_PREFIX) :].split("-", 1)[0]) for n in matrix_sheets
        )
        eq(seqs, list(range(1, 51)), "矩阵序号连续 1..50 无缺号")

        print("③ Excel → JSON")
        r = run([sys.executable, str(SCRIPTS / "excel_to_json.py"), str(wb_path), "--out", str(out_dir)])
        ok(r.returncode == 0, f"还原 JSON 不报错（退出码 {r.returncode}）")
        if r.returncode != 0:
            print(r.stderr)
            return 1

        print("④ 逐字段比对")
        for name in FILES:
            disk = json.loads((CONTENT / name).read_text(encoding="utf-8"))
            back = json.loads((out_dir / name).read_text(encoding="utf-8"))
            eq(back, disk, f"{name} 往返一致")

        print("⑤ 关键计数")
        patterns = json.loads((out_dir / "pulse-patterns.json").read_text(encoding="utf-8"))["patterns"]
        disk_patterns = json.loads((CONTENT / "pulse-patterns.json").read_text(encoding="utf-8"))["patterns"]
        eq(len(patterns), 50, f"脉象图 50 条（实际 {len(patterns)}）")

        def count(src: dict, key: str) -> int:
            return sum(len(v.get(key) or []) for v in src.values())

        eq(count(patterns, "cells"), count(disk_patterns, "cells"), "格位总数一致")
        eq(count(patterns, "groups"), count(disk_patterns, "groups"), "AND 组总数一致")
        eq(count(patterns, "relations"), count(disk_patterns, "relations"), "关系总数一致")

        def probe_count(src: dict) -> int:
            return sum(
                len(r.get("probe") or [])
                for v in src.values()
                for r in (v.get("relations") or [])
            )

        eq(probe_count(patterns), probe_count(disk_patterns), "探针总数一致")

        print("⑥ 格位顺序已规范化（矩阵派生序）")
        bad_order: list[str] = []
        for pid, v in disk_patterns.items():
            keys = [c["cell"] for c in v["cells"]]
            if keys != sorted(keys, key=cell_sort_key):
                bad_order.append(f"{pid}:cells")
            for gi, g in enumerate(v.get("groups") or []):
                if g != sorted(g, key=cell_sort_key):
                    bad_order.append(f"{pid}:groups[{gi}]")
        eq(bad_order, [], f"磁盘 JSON 的格位顺序＝矩阵派生序（异常 {bad_order[:3]}）")

        print("⑦ 派生长表不是编辑面（清空「脉象图·格位」后还原仍一致）")
        wb2 = load_workbook(wb_path)
        ws_cells = wb2["脉象图·格位"]
        for r in range(2, ws_cells.max_row + 1):
            for c in range(1, 11):
                ws_cells.cell(row=r, column=c).value = None
        wb2_path = tmp / "roundtrip-no-cells.xlsx"
        wb2.save(wb2_path)
        out2 = tmp / "out2"
        r = run([sys.executable, str(SCRIPTS / "excel_to_json.py"), str(wb2_path), "--out", str(out2)])
        ok(r.returncode == 0, f"清空派生长表后还原不报错（退出码 {r.returncode}）")
        if r.returncode == 0:
            back2 = json.loads((out2 / "pulse-patterns.json").read_text(encoding="utf-8"))["patterns"]
            eq(back2, disk_patterns, "清空派生长表后结果不变（矩阵才是唯一编辑面）")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("")
    if failures:
        print(f"[excel-roundtrip] EXIT=1 —— {failures}/{checks} 项失败")
        return 1
    print(f"[excel-roundtrip] EXIT=0 —— {checks} 项全过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
