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

FILES = [
    "drugs.json",
    "doses.json",
    "formula-reference.json",
    "pulse-terms.json",
    "pulse-patterns.json",
    "formula-rules.json",
    "pulse-groups.json",
]

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

        print("② Excel → JSON")
        r = run([sys.executable, str(SCRIPTS / "excel_to_json.py"), str(wb_path), "--out", str(out_dir)])
        ok(r.returncode == 0, f"还原 JSON 不报错（退出码 {r.returncode}）")
        if r.returncode != 0:
            print(r.stderr)
            return 1

        print("③ 逐字段比对")
        for name in FILES:
            disk = json.loads((CONTENT / name).read_text(encoding="utf-8"))
            back = json.loads((out_dir / name).read_text(encoding="utf-8"))
            eq(back, disk, f"{name} 往返一致")

        print("④ 关键计数")
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
