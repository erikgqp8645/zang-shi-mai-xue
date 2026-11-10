#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Excel 中间格式 —— 「故意写坏」验证

用法::

    python3 scripts/e2e/excel_roundtrip_break.py

## 为什么要有这个

``excel_roundtrip.py`` 只证明「好数据能无损往返」。
它**不能**证明「坏数据会被拦住」—— 因为还原脚本和测试用的是同一套逻辑。

所以这里往工作簿里**故意注入坏数据**，断言还原脚本**必须报错**。
每一条坏数据对应一条会「悄悄吞掉错误」的还原缺陷：
没有这些用例，还原脚本可能把错数据当对数据写进 JSON —— 那比直接报错更糟。

## 注入的坏数据

① 主键为空        → 行无从认起
② 主键重复        → 还原时哪一行被覆盖说不清
③ 父 id 悬空      → 格位/关系指向不存在的条目
④ 用字未定义      → 图上写了个「脉象用字」表里没有的字
⑤ 组号非正整数    → AND 组的「第几组」说不清
⑥ 同一关系前后用语不一致 → probe 归属说不清
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPTS = ROOT / "scripts"
CONTENT = ROOT / "src" / "content"

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


def run_restore(wb_path: Path, out_dir: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPTS / "excel_to_json.py"), str(wb_path), "--out", str(out_dir)],
        capture_output=True,
        text=True,
    )


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="pulse-excel-break-"))
    try:
        base_wb = tmp / "base.xlsx"
        r = subprocess.run(
            [sys.executable, str(SCRIPTS / "excel_from_json.py"), str(base_wb)],
            capture_output=True,
            text=True,
        )
        if r.returncode != 0:
            print(r.stderr)
            return 1

        cases = [
            {
                "name": "① 主键为空（方剂·讲稿2010 的 ID 列）",
                "sheet": "方剂·讲稿2010",
                "col": 1,
                "row": 2,
                "value": "",
                "expect": "主键",
            },
            {
                "name": "② 主键重复（成方·同和堂版 的 ID 列）",
                "sheet": "成方·同和堂版",
                "col": 1,
                "row": 3,
                "value": "th-1",  # 与第 2 行重复
                "expect": "重复",
            },
            {
                "name": "③ 父 id 悬空（脉象图·格位 的 条目ID 列）",
                "sheet": "脉象图·格位",
                "col": 1,
                "row": 2,
                "value": "不存在的条目",
                "expect": "不存在",
            },
            {
                "name": "④ 用字未定义（脉象图·格位 的 用字 列）",
                "sheet": "脉象图·格位",
                "col": 3,
                "row": 2,
                "value": "不存在的用字",
                "expect": "脉象用字",
            },
            {
                "name": "⑤ 组号不是正整数（脉象图·格位 的 组号 列）",
                "sheet": "脉象图·格位",
                "col": 4,
                "row": 2,
                "value": "零",
                "expect": "组号",
            },
            {
                "name": "⑥ 同一关系前后用语不一致（脉象图·关系 的 原文用语 列）",
                "sheet": "脉象图·关系",
                "col": 3,
                # 第 5、6、7 行是同一条关系「fx-ssx-qingdanglu／尺脉不平衡」的三个 probe，
                # 改第 6 行 ⇒ 与第 5 行的原文用语冲突 ⇒ 必须报错
                "row": 6,
                "value": "与别处不一样的说法",
                "expect": "不一致",
            },
        ]

        for i, c in enumerate(cases):
            wb = load_workbook(base_wb)
            ws = wb[c["sheet"]]
            ws.cell(row=c["row"], column=c["col"]).value = c["value"]
            bad_wb = tmp / f"bad-{i}.xlsx"
            wb.save(bad_wb)

            r = run_restore(bad_wb, tmp / f"out-{i}")
            msg = (r.stderr or "") + (r.stdout or "")
            ok(r.returncode != 0, f"{c['name']} → 还原必须失败（实际退出码 {r.returncode}）")
            ok(
                c["expect"] in msg,
                f"{c['name']} → 错误信息要提到「{c['expect']}」"
                f"（实际：{' / '.join([x for x in msg.splitlines() if x.strip()][:3])}）",
            )

        print("")
        print("⑦ 反向：未改坏时必须成功")
        r = run_restore(base_wb, tmp / "out-good")
        ok(r.returncode == 0, f"原样工作簿还原成功（退出码 {r.returncode}）")
        back = json.loads((tmp / "out-good/pulse-patterns.json").read_text(encoding="utf-8"))
        disk = json.loads((CONTENT / "pulse-patterns.json").read_text(encoding="utf-8"))
        ok(back == disk, "原样工作簿还原结果与磁盘 JSON 完全一致")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("")
    if failures:
        print(f"[excel-break] EXIT=1 —— {failures}/{checks} 项失败")
        return 1
    print(f"[excel-break] EXIT=0 —— {checks} 项全过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
