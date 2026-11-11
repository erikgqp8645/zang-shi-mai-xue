#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成**练习册** —— 一份「故意留空几格」的示例工作簿

用法::

    npm run content:exercise
    （Windows 上 `python3` 可能只是 Microsoft Store 的空壳别名 —— 用上面这条 npm 命令，
      仓库会自己找能用的解释器，不会卡在「python3 不是内部或外部命令」上）

默认输出 ``content/示例-填写示范.xlsx``。

## 它是什么

主工作簿的**副本**，但有 5 格被**故意清空并标黄**，旁边写了批注：
这一格该填什么、依据哪句原文。填完可以用::

    npm run content:exercise:check

验收 —— 每一格填对没有，差在哪儿。

## 为什么做成「留空」而不是「填好给你看」

填好的样子只能看，留空的格子才能**练**。而且填完能自动验收，
知道自己到底学会了没有 —— 只看一遍说明表是学不会填格的。

⚠️ **别把练习册当主工作簿跑 `npm run content:json`** ——
   那会把空掉的格子当成「原文没写」写回 JSON，真的把内容丢了。
   `excel_to_json.py` 对文件名含「示例／练习／示范」的工作簿会**拒绝写回**。
   验收请用 ``scripts/e2e/excel_exercise.py``。

@see exercise_points.py
@see e2e/excel_exercise.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from excel_schema import MATRIX_SHEET_PREFIX
from exercise_points import EXERCISE_POINTS, expected_value, locate_cell, read_disk

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_WB = ROOT / "content" / "臧氏脉学-用方知识库.xlsx"
DEFAULT_OUT = ROOT / "content" / "示例-填写示范.xlsx"

#: 待填格的底色（黄 —— 一眼看出哪里要填）
TODO_FILL = PatternFill("solid", fgColor="FFF2B2")
#: 已填格的底色（绿 —— 示范里给出正确答案的地方）
DONE_FILL = PatternFill("solid", fgColor="C6EFCE")

THIN = Side(style="thin", color="000000")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
FONT = Font(name="微软雅黑", size=11)
HEADER_FONT = Font(name="微软雅黑", size=11, bold=True)


def build_guide_sheet(wb, disk) -> None:
    """加一张「填写示范」sheet —— 逐步骤说明。"""
    if "填写示范" in wb.sheetnames:
        del wb["填写示范"]
    ws = wb.create_sheet("填写示范", 0)

    rows: list[list[str]] = [
        ["怎样填写《臧氏脉学·用方知识库》", "", "", ""],
        ["", "", "", ""],
        [
            "这是**练习册** —— 主工作簿的副本，有 5 格被故意清空并标黄。",
            "",
            "",
            "",
        ],
        [
            "填完验收：",
            "python3 scripts/e2e/excel_exercise.py content/示例-填写示范.xlsx",
            "",
            "",
        ],
        [
            "⚠️ 别对练习册跑 `npm run content:json`",
            "那会把空掉的格子当成「原文没写」写回 JSON，真的把内容丢了。",
            "",
            "",
        ],
        ["", "", "", ""],
        ["练习点", "位置", "这一格在教什么", "依据"],
    ]
    for p in EXERCISE_POINTS:
        w = p["where"]
        if "key_col" in w:
            where = f"{w['sheet']} → 主键「{w['key_value']}」→ 「{w['col']}」列"
        else:
            where = f"{w['sheet']} → {w['organ']}{w['depth']} 行 → 「{w['col']}」列"
        rows.append([p["id"], where, p["teach"], p["source"]])

    for r, row in enumerate(rows, start=1):
        for c, v in enumerate(row, start=1):
            cell = ws.cell(row=r, column=c, value=v)
            cell.font = FONT if r != 1 else HEADER_FONT
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            cell.border = BORDER

    ws.cell(row=1, column=1).font = Font(name="微软雅黑", size=14, bold=True)
    ws.row_dimensions[1].height = 26
    for c in range(1, 5):
        ws.cell(row=7, column=c).font = HEADER_FONT
        ws.cell(row=7, column=c).fill = PatternFill("solid", fgColor="D9E1F2")
    for r in range(8, 8 + len(EXERCISE_POINTS)):
        ws.row_dimensions[r].height = 90

    for c, wdt in zip("ABCD", (10, 44, 62, 52)):
        ws.column_dimensions[c].width = wdt
    ws.freeze_panes = "A8"


def main() -> int:
    out_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_OUT
    if not DEFAULT_WB.exists():
        print(f"[exercise] 找不到主工作簿：{DEFAULT_WB}", file=sys.stderr)
        return 1

    disk = read_disk()
    wb = load_workbook(DEFAULT_WB)

    # ---- 1) 清空练习点并标注 ----
    for p in EXERCISE_POINTS:
        row, col = locate_cell(wb, p)
        cell = wb[p["where"]["sheet"]].cell(row=row, column=col)
        answer = expected_value(p, disk)
        cell.value = None
        cell.fill = TODO_FILL
        cell.font = FONT
        cell.border = BORDER
        cm = Comment(
            f"【练习 {p['id']}】这一格要填：\n"
            f"{answer if answer else '（空）'}\n\n"
            f"—— 要点 ——\n{p['teach']}\n\n"
            f"—— 依据 ——\n{p['source']}\n\n"
            f"（位置：第 {row} 行 · {get_column_letter(col)} 列）",
            "臧氏脉学",
        )
        cm.width = 460
        cm.height = 260
        cell.comment = cm

    # ---- 2) 「脉象图·格位」是派生长表 —— 加个警告，别让人改它 ----
    ws = wb["脉象图·格位"]
    cm = Comment(
        "⚠️ **这张表是派生的，不要在这里改脉象。**\n\n"
        "它是各条矩阵 sheet（左手／右手 9 行）摊平后的样子，\n"
        "转回 JSON 时**以矩阵为准**，这里改了会被覆盖。\n\n"
        "要改脉象，请去对应的 "
        f"{MATRIX_SHEET_PREFIX}01-／{MATRIX_SHEET_PREFIX}02- … 矩阵 sheet 改格子里的话。",
        "臧氏脉学",
    )
    cm.width = 400
    cm.height = 200
    ws.cell(row=1, column=1).comment = cm

    # ---- 3) 加「填写示范」sheet ----
    build_guide_sheet(wb, disk)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out_path)

    print(f"[exercise] 已写出 {out_path}")
    print(f"[exercise]   练习点 {len(EXERCISE_POINTS)} 处（已清空并标黄、写了批注）")
    print(f"[exercise]   验收：npm run content:exercise:check")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
