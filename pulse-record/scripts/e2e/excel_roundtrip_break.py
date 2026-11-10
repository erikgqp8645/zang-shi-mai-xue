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

① 主键为空              → 行无从认起
② 主键重复              → 还原时哪一行被覆盖说不清
③ 父 id 悬空            → 关系指向不存在的条目
④ 矩阵：用字未定义      → 图上写了个「脉象用字」表里没有的字
⑤ 矩阵：组号非正整数    → AND 组的「第几组」说不清
⑥ 同一关系前后用语不一致 → probe 归属说不清
⑦ 矩阵：表头条目ID 与序号不符 → 张冠李戴，条目会挂错图
⑧ 矩阵：漏了一个 sheet  → 漏掉一张脉象图
⑨ 矩阵：sheet 改名导致序号重复 → 张冠李戴（另一张图挂错条目）
⑩ 矩阵：填了用字却没填组号 → 这一格被悄悄丢出任何组，图上还留着用字

⭐ 注入点**按结构定位**（找列头行、找第一个有值的格），
   不靠硬编码行号 —— 表头区行数会变，硬编码会失效。
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

#: 拿来开刀的矩阵 sheet（第一条：fx-bianmai-wuli 之外的、有点位的那条）
MATRIX_SHEET = "P04-fx-ssx-qingdanglu"

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


# ------------------------------------------------------------------
# 矩阵 sheet 的结构定位（不硬编码行号）
# ------------------------------------------------------------------


def find_col_header_row(ws) -> int:
    """找列头行（A 列 == 「部位」的那一行）。"""
    for r in range(1, min(ws.max_row, 20) + 1):
        if str(ws.cell(row=r, column=1).value or "").strip() == "部位":
            return r
    raise AssertionError(f"矩阵 sheet 里找不到列头行（{ws.title}）")


def find_header_row(ws, label: str) -> int:
    """找表头区里 A 列 == label 的那一行。"""
    for r in range(1, min(ws.max_row, 20) + 1):
        if str(ws.cell(row=r, column=1).value or "").strip() == label:
            return r
    raise AssertionError(f"矩阵 sheet 里找不到「{label}」行（{ws.title}）")


def find_filled_cell(ws, col: int) -> tuple[int, int]:
    """找第 col 列里第一个有值的格，返回 (行, 列)。"""
    first = find_col_header_row(ws)
    for r in range(first + 1, ws.max_row + 1):
        v = ws.cell(row=r, column=col).value
        if v is not None and str(v).strip() != "":
            return r, col
    raise AssertionError(f"矩阵 sheet 第 {col} 列里没有已填的格（{ws.title}）")


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

        # ---- 先确认注入点找得到（找不到就是测试自身坏了）----
        probe_wb = load_workbook(base_wb)
        probe_ws = probe_wb[MATRIX_SHEET]
        probe_ws  # 结构定位函数在下面各 case 里复用

        cases: list[dict] = [
            {
                "name": "① 主键为空（方剂·讲稿2010 的 ID 列）",
                "expect": "主键",
                "mutate": _break_empty_key,
            },
            {
                "name": "② 主键重复（成方·同和堂版 的 ID 列）",
                "expect": "重复",
                "mutate": _break_dup_key,
            },
            {
                "name": "③ 父 id 悬空（脉象图·关系 的 条目ID 列）",
                "expect": "不存在",
                "mutate": _break_dangling_fk,
            },
            {
                "name": "④ 矩阵：用字未定义（左手格）",
                "expect": "脉象用字",
                "mutate": _break_matrix_term,
            },
            {
                "name": "⑤ 矩阵：组号不是正整数（左组号列）",
                "expect": "组号",
                "mutate": _break_matrix_group,
            },
            {
                "name": "⑥ 同一关系前后用语不一致（脉象图·关系 的 原文用语 列）",
                "expect": "不一致",
                "mutate": _break_relation_text,
            },
            {
                "name": "⑦ 矩阵：表头条目ID 与序号不符",
                "expect": "不一致",
                "mutate": _break_matrix_id,
            },
            {
                "name": "⑧ 矩阵：漏了一个 sheet（少一张脉象图）",
                "expect": "没有条目",
                "mutate": _break_missing_sheet,
            },
            {
                "name": "⑨ 矩阵：sheet 改名导致序号重复（张冠李戴）",
                "expect": "不一致",
                "mutate": _break_renamed_sheet,
            },
            {
                "name": "⑩ 矩阵：填了用字却没填组号（这一格会被悄悄丢掉）",
                "expect": "组号",
                "mutate": _break_matrix_group_empty,
            },
        ]

        for i, c in enumerate(cases):
            wb = load_workbook(base_wb)
            c["mutate"](wb)
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
        print("⑨ 反向：未改坏时必须成功")
        r = run_restore(base_wb, tmp / "out-good")
        ok(r.returncode == 0, f"原样工作簿还原成功（退出码 {r.returncode}）")
        back = json.loads((tmp / "out-good/pulse-patterns.json").read_text(encoding="utf-8"))
        disk = json.loads((CONTENT / "pulse-patterns.json").read_text(encoding="utf-8"))
        ok(back == disk, "原样工作簿还原结果与磁盘 JSON 完全一致")

        print("")
        print("⑩ 派生长表不是编辑面：改「脉象图·格位」必须不影响还原结果")
        wb = load_workbook(base_wb)
        ws_cells = wb["脉象图·格位"]
        for rr in range(2, ws_cells.max_row + 1):
            for cc in range(1, 11):
                ws_cells.cell(row=rr, column=cc).value = None
        derived_wb = tmp / "derived-only.xlsx"
        wb.save(derived_wb)
        r = run_restore(derived_wb, tmp / "out-derived")
        ok(r.returncode == 0, f"清空派生长表后还原仍成功（退出码 {r.returncode}）")
        if r.returncode == 0:
            back2 = json.loads((tmp / "out-derived/pulse-patterns.json").read_text(encoding="utf-8"))
            ok(back2 == disk, "清空派生长表后结果不变（矩阵才是唯一编辑面）")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("")
    if failures:
        print(f"[excel-break] EXIT=1 —— {failures}/{checks} 项失败")
        return 1
    print(f"[excel-break] EXIT=0 —— {checks} 项全过")
    return 0


def _break_empty_key(wb) -> None:
    """方剂·讲稿2010 的 ID 清空。"""
    wb["方剂·讲稿2010"].cell(row=2, column=1).value = ""


def _break_dup_key(wb) -> None:
    """成方·同和堂版 的 ID 与第 2 行重复。"""
    wb["成方·同和堂版"].cell(row=3, column=1).value = "th-1"


def _break_dangling_fk(wb) -> None:
    """脉象图·关系 指向不存在的条目。"""
    wb["脉象图·关系"].cell(row=2, column=1).value = "不存在的条目"


def _break_relation_text(wb) -> None:
    """同一条关系的原文用语前后不一致。

    第 5、6、7 行是同一条关系「fx-ssx-qingdanglu／尺脉不平衡」的三个 probe，
    改第 6 行 ⇒ 与第 5 行的原文用语冲突 ⇒ 必须报错。
    """
    wb["脉象图·关系"].cell(row=6, column=3).value = "与别处不一样的说法"


def _break_missing_sheet(wb) -> None:
    """删掉一张矩阵 sheet ⇒ 少一条脉象图。"""
    wb.remove(wb["P02-fx-bianmai-youli"])


def _break_renamed_sheet(wb) -> None:
    """把 P03 改名成 P04 ⇒ 序号重复、条目张冠李戴。

    序号是权威的（sheet 名会被 31 字符上限截断），所以改名必须被发现。
    """
    wb["P03-fx-shenyong-mubiao"].title = "P04-fx-shenyong-mubiao"


def _break_matrix_term(wb) -> None:
    """把矩阵里第一个已填的左手格改成未定义的用字。"""
    ws = wb[MATRIX_SHEET]
    row, col = find_filled_cell(ws, 3)  # 第 3 列＝左手
    ws.cell(row=row, column=col).value = "不存在的用字"


def _break_matrix_group(wb) -> None:
    """把矩阵里第一个已填的左手格的组号改成非正整数。"""
    ws = wb[MATRIX_SHEET]
    row, _ = find_filled_cell(ws, 3)
    ws.cell(row=row, column=5).value = "零"  # 第 5 列＝左组号


def _break_matrix_group_empty(wb) -> None:
    """把矩阵里第一个已填的左手格的**组号清空**。

    ⚠️ 这一格用字还在，但不属于任何组 ⇒ 判定时被丢掉，
    而图上还显示着那个用字 —— 看着像有要求，其实没有。
    必须报错，不能静默写进 JSON。
    """
    ws = wb[MATRIX_SHEET]
    row, _ = find_filled_cell(ws, 3)
    ws.cell(row=row, column=5).value = None  # 第 5 列＝左组号


def _break_matrix_id(wb) -> None:
    """把矩阵表头区的条目ID 改成别的条目的 ID。"""
    ws = wb[MATRIX_SHEET]
    row = find_header_row(ws, "条目ID")
    ws.cell(row=row, column=2).value = "fx-bianmai-wuli"


if __name__ == "__main__":
    raise SystemExit(main())
