#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""JSON → Excel —— 把可编辑数据层摊平成 Excel 工作簿

用法::

    python3 scripts/excel_from_json.py [输出路径]

默认输出 ``content/臧氏脉学-用方知识库.xlsx``。

## 为什么 Excel 是「中间格式」而不是真源

真源是 ``src/content/*.json``（机器消费层）。
Excel 是**人工编辑层**：用户审核、修改后，再用 ``excel_to_json.py`` 转回 JSON。
两个方向的脚本共用 ``excel_schema.py`` 的列定义 —— 那是唯一真源。

## 本轮的角色

首轮由本脚本产出工作簿交用户审核修改；
审核通过后工作簿定稿，用户继续在 Excel 上改，改完跑 ``excel_to_json.py`` 转回。

@see excel_schema.py
@see excel_to_json.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from excel_schema import ARRAY_SEP, CODE_SEP, README_COLS, SHEETS, ColDef, SheetDef

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "src" / "content"
DEFAULT_OUT = ROOT / "content" / "臧氏脉学-用方知识库.xlsx"

FONT = Font(name="微软雅黑", size=11)
HEADER_FONT = Font(name="微软雅黑", size=11, bold=True)
THIN = Side(style="thin", color="000000")
HAIR = Side(style="hair", color="888888")
MEDIUM = Side(style="medium", color="000000")

HEADER_FILL = None  # 不用底色，保持朴素、便于打印


def read_json(name: str) -> Any:
    return json.loads((CONTENT / name).read_text(encoding="utf-8"))


def cell_value(value: Any, ctype: str) -> Any:
    """把一个值摊成单元格的值。

    · ``array`` → 换行分隔（讲稿方名自带顿号，不能用顿号分隔）
    · ``codes`` → 逗号分隔（符号集里没有逗号）
    · 其余     → 原样
    """
    if value is None:
        return ""
    if ctype == "array":
        return ARRAY_SEP.join(str(v) for v in value) if isinstance(value, list) else str(value)
    if ctype == "codes":
        return CODE_SEP.join(str(v) for v in value) if isinstance(value, list) else str(value)
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return value


# ------------------------------------------------------------------
# 脉象图：两个从属表（格位 / 关系）
# ------------------------------------------------------------------


def pattern_cell_rows(patterns: dict[str, Any]) -> list[dict[str, Any]]:
    """把 pattern 摊成「格位」行。

    ``groups`` 恰好是 ``cells`` 的划分（每格只属一组），故用「组号」列承载：
    组号 1,2,3 … ＝第 1、2、3 个 AND 组（组内且、组间或）；留空 ＝ 无显式 groups。
    """
    rows: list[dict[str, Any]] = []
    for pid, p in patterns.items():
        group_of: dict[str, int] = {}
        for gi, grp in enumerate(p.get("groups") or [], start=1):
            for c in grp:
                group_of[c] = gi
        for c in p.get("cells") or []:
            rows.append(
                {
                    "patternId": pid,
                    "cell": c["cell"],
                    "term": c["term"],
                    "group": group_of.get(c["cell"], ""),
                    "note": c.get("note", ""),
                    "flex": "TRUE" if c.get("flex") else "",
                }
            )
    return rows


def pattern_relation_rows(patterns: dict[str, Any]) -> list[dict[str, Any]]:
    """把 pattern 摊成「关系」行。

    一个 relation 有 N 个 probe → **N 行，每行一个 probe**，
    关系种类与原文用语在每行重复。

    ⚠️ 不能写成「只在第一行填探针、其余行留空」——
       那样读回时无法区分「该关系有第 2 个探针」与「这一行只是续行」，
       探针会静默丢失（已踩过：尺脉不平衡的 4 个探针只剩 1 个）。
       改成每行一个 probe 后，读回按关系种类分组即可无歧义还原。
    """
    rows: list[dict[str, Any]] = []
    for pid, p in patterns.items():
        for rel in p.get("relations") or []:
            probes = rel.get("probe") or []
            if not probes:
                rows.append(
                    {
                        "patternId": pid,
                        "kind": rel["kind"],
                        "text": rel.get("text", ""),
                        "probeCell": "",
                        "probeCodes": "",
                    }
                )
                continue
            for probe in probes:
                rows.append(
                    {
                        "patternId": pid,
                        "kind": rel["kind"],
                        "text": rel.get("text", ""),
                        "probeCell": probe["cell"],
                        "probeCodes": CODE_SEP.join(probe.get("codes", [])),
                    }
                )
    return rows


# ------------------------------------------------------------------
# 说明表
# ------------------------------------------------------------------


def build_readme_rows() -> list[dict[str, Any]]:
    rows = [
        {
            "sheet": "（本表）",
            "purpose": (
                "**怎么改这份工作簿。**\n"
                "本工作簿是**人工编辑层**；机器消费层是仓库里的 src/content/*.json。\n"
                "改完存盘 → `python3 scripts/excel_to_json.py` 转回 JSON → `npm test`。\n"
                "⚠️ 只改**值**，不要改**主键**（主键被别的表引用）；"
                "留空＝原文没写，**不要替读者补**。"
            ),
            "cols": "表名 | 这张表是什么 | 各列说明 | 怎么填",
            "howto": (
                "① 主键列（ID／用字／符号／条目ID）不要动。\n"
                "② 空白＝原文没写，不作要求 —— 别为了「填满」而补。\n"
                "③ 剂量单位两套并存：讲稿是**比例制**（「熟地5」），"
                "同和堂版是**克**；**不换算、不合并**。\n"
                "④ 页面里的所有内容只是**资料整理**，不构成诊断，也不替读者加减方。"
            ),
        }
    ]
    for s in SHEETS:
        cols = "\n".join(f"{c.header}（{c.key}）" + (f" — {c.note}" if c.note else "") for c in s.cols)
        howto = _howto_for(s)
        rows.append({"sheet": s.name, "purpose": s.purpose, "cols": cols, "howto": howto})
    rows.append(
        {
            "sheet": "脉象图矩阵（P01-三焦疗法·肾虚 … P50-肝心同治·挡路六，每条用方条目一张）",
            "purpose": (
                "每条用方条目的**脉象图**，也是脉象图的**唯一编辑面**。\n"
                "体例照讲义 2026-10 p34 的记录表：左列**部位／取法**，右边**左手、右手**两列，"
                "9 行（寸浮／寸中／寸沉／关浮／关中／关沉／尺浮／尺中／尺沉）—— "
                "和讲义上的图对得上。\n"
                "「脉象图·格位」长表由这些矩阵**派生**出来，不要在那里改脉象。"
            ),
            "cols": "部位｜取法｜左手｜右手｜左组号｜右组号｜左格备注｜右格备注｜左柔性｜右柔性",
            "howto": (
                "① **表头区（第 2 行起）只有「条目ID」是校验用的**，"
                "其余（路线／触发条件／出处／与条件文字的出入／关系型要求）都是**只读副本** —— "
                "真源在「用方条目」表；要改内容去那张表改，改完重跑生成命令。\n"
                "② **格子（左手／右手）填「用字」**，不是符号代码。"
                "用字照抄「脉象用字」表第 1 列（如「大或顶」「虚脏」）。"
                "留空＝原文没提这一格，**不作要求**。\n"
                "③ **组号（左组号／右组号）**：填了用字**就要填组号**（1、2、3…）。"
                "组号＝AND 组的编号：填**同一个数字**＝同一组，组内是「且」；填**不同数字**＝不同组，组间是「或」。"
                "⚠️ 左列与右列**共用同一个编号空间** —— 左格与右格都填 1，它们是**同一组**（都要满足），不是两组。\n"
                "④ **格备注（左格备注／右格备注）**：写这一格原文的具体话（如「浮大而软」），没有就空着。\n"
                "⑤ **柔性（左柔性／右柔性）**：填 TRUE ＝「本格还须配合表头的『关系型要求』才成立」；"
                "不填 ＝ 本格自己就能成立。\n"
                "⑥ **关系型要求**（画不成单格的，如「忽大忽小」「跳跳停停」）写在表头那一行里，"
                "照抄原话 —— 这类条目九个格常常都是空的。\n"
                "⑦ sheet 名＝`P序号-图名`：**序号**（P01、P02…）是这条条目在「脉象图·条目」里的位置，**不要改**；"
                "**图名**（方剂名）取自「脉象图·条目」表的「图名」列，要改去那张表改，"
                "改完重跑 `npm run content:json` ＋ `npm run content:excel`。"
            ),
        }
    )
    return rows


def _howto_for(s: SheetDef) -> str:
    if s.is_dict:
        return "两列：左边＝键，右边＝值。**不要改键**（键会被别的表引用）。"
    if s.json_path == "__patternCells":
        return (
            "⚠️ **这张表是派生的，不要在这里改脉象。**\n"
            "它是各条矩阵 sheet（左手／右手 9 行）摊平后的样子，"
            "转回 JSON 时**以矩阵为准**，这里改了会被覆盖。\n"
            "要改脉象，请去对应的 P04-清挡路 / P05-引火归元·上盛下虚 … 矩阵 sheet 改格子里的话。"
        )
    if s.json_path == "__patternRelations":
        return (
            "每行＝一个关系（画不成单格的那些，如「忽大忽小」）。"
            "同一关系有多个探针时占多行：**每行都填自己的探针格位／探针符号**。\n"
            "· 「探针格位」留空 ＝ 该关系没有探针。\n"
            "⚠️ 矩阵 sheet 的表头区也写了「关系型要求」，"
            "**以这张表为准**（矩阵里那份是只读副本）。"
        )
    if s.json_path == "patterns":
        return (
            "每行＝一条用方条目的**元信息**（ID／图名／路线／触发条件／出处／与条件文字的出入）。\n"
            "· 这里的「触发条件」是**原文用语**，不改写。\n"
            "· 「**图名**」＝这张脉象图是**哪个方子**的（原文用词），"
            "矩阵 sheet 的 tab 名就是 `P序号-图名` —— 改完这一列，"
            "跑 `npm run content:json` ＋ `npm run content:excel`，tab 名就跟上。\n"
            "· **格位要求在矩阵 sheet 里改**（P04-清挡路 … P50-肝心同治·挡路六），这张表不管格位。"
        )
    if s.json_path == "terms":
        return (
            "「符号集」＝该格允许的取值（逗号分隔，是「或」的关系）。\n"
            "「须并带」＝同一格里还必须同时出现的符号（逗号分隔，也是「或」）。\n"
            "「符号含义」＝给你看的翻译（如 `++＝有力`），**不用改** —— "
            "改「符号集」时会自动重算。\n"
            "⚠️ 符号集按**代码实际接受的**取，不是按力度阈值自动推 —— "
            "「大」不含↑，「大或顶」含↑。"
        )
    if s.json_path == "symbols":
        return (
            "讲义 p34 的**固定符号集**（14 个）—— `0`＝无、`-`＝弱、`+`＝有、`++`＝有力、"
            "`↑`＝顶、`|`＝弦、`X`＝细、`#`＝变脉、`TTT`＝跳调停、`DDX`＝大大小 ……\n"
            "「脉象用字」表的符号集就是从这里挑的；"
            "看到 `++` 不知道是什么时，查这张表。\n"
            "· 「符号」「名称」是原文，**不要改**。"
        )
    if s.json_path == "drugs":
        return (
            "「加减」一格多行，一条一行。\n"
            "⚠️ 剂量是**讲稿的比例制**（如「熟地5」），"
            "与「成方·同和堂版」的**克**是两套，不可换算、不可合并。"
        )
    if s.json_path == "doses":
        return "组成是**克**。原文写错的字也照录，不要自己改。"
    return "每行一条记录。留空＝原文没写，不要替读者补。"


# ------------------------------------------------------------------
# 写工作簿
# ------------------------------------------------------------------


def style_header(ws, ncols: int) -> None:
    """表头：加粗、居中、换行、细边框。"""
    for i in range(1, ncols + 1):
        cell = ws.cell(row=1, column=i)
        cell.font = HEADER_FONT
        cell.alignment = Alignment(vertical="center", horizontal="center", wrap_text=True)
        cell.border = Border(left=THIN, right=THIN, top=THIN, bottom=MEDIUM)
    ws.row_dimensions[1].height = 26


#: 各类型的填写提示 —— 与「说明」表里的列说明**同源**（都来自 ColDef.note）
TYPE_HINT: dict[str, str] = {
    "array": "一条一行（同一格内换行分隔）",
    "codes": "逗号分隔（是「或」的关系）",
    "int": "整数",
    "bool": "TRUE／FALSE",
}


def column_comment(c: ColDef) -> Comment:
    """列头的批注 —— 鼠标悬停就能看见这一列怎么填。

    ⭐ 内容与「说明」表的列说明**同一来源**（`ColDef.note`），
    不另写一份 —— 否则两处会悄悄对不上。
    """
    lines: list[str] = []
    if c.note:
        lines.append(c.note)
    hint = TYPE_HINT.get(c.type)
    if hint:
        lines.append(f"【填写格式】{hint}")
    if c.derived:
        # 派生列不对应原文的字段 —— 说「留空＝原文没写」会误导
        lines.append("【只读】这一列是**算出来的**，转回 JSON 时不参与还原")
    elif c.omit_empty:
        lines.append("【留空】＝原文没写，不产出该字段 —— 别替读者补")
    text = "\n\n".join(lines) if lines else "这一列没有额外说明。"
    cm = Comment(text, "臧氏脉学")
    cm.width = 320
    cm.height = 140
    return cm


def style_body(ws, nrows: int, ncols: int) -> None:
    """正文：左上对齐、换行、发丝线边框。"""
    for r in range(2, nrows + 2):
        for c in range(1, ncols + 1):
            cell = ws.cell(row=r, column=c)
            cell.font = FONT
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            cell.border = Border(left=HAIR, right=HAIR, top=HAIR, bottom=HAIR)


def write_sheet(wb: Workbook, sheet: SheetDef, rows: list[dict[str, Any]]) -> None:
    """把一张表写成一个 sheet。"""
    ws = wb.create_sheet(sheet.name)
    ws.append([c.header for c in sheet.cols])
    style_header(ws, len(sheet.cols))

    # 列头挂批注：鼠标悬停就能看见这一列怎么填（内容与「说明」表同源）
    for i, c in enumerate(sheet.cols, start=1):
        ws.cell(row=1, column=i).comment = column_comment(c)

    for item in rows:
        ws.append([cell_value(item.get(c.key), c.type) for c in sheet.cols])

    style_body(ws, len(rows), len(sheet.cols))

    for i, c in enumerate(sheet.cols, start=1):
        ws.column_dimensions[get_column_letter(i)].width = c.width

    # 冻结首行 + 自动筛选
    ws.freeze_panes = "A2"
    if rows:
        ws.auto_filter.ref = f"A1:{get_column_letter(len(sheet.cols))}1"


# ------------------------------------------------------------------
# 脉象图矩阵（每条用方条目一个 sheet）
# ------------------------------------------------------------------

#: 矩阵里「已填格」的底色（橙色系 —— 与讲义 p34 实例表的部位列同色系）
FILLED_FILL = "FFE0B2"


def write_matrix_sheet(
    wb, index: int, pid: str, title: str, pattern: dict, rule: dict | None, terms: dict
) -> None:
    """把一条用方条目的脉象图写成一个矩阵 sheet。

    体例照讲义 p34 的记录表：**左列部位／取法，右边左、右手两列**，9 行
    （寸浮／寸中／寸沉／关浮／关中／关沉／尺浮／尺中／尺沉）。

    格子里填的是**用字**（如「大或顶」），不是符号代码 ——
    符号代码是「允许集合」，用字才是讲稿／讲义写下的那个词。

    ``title`` 是**图名**（方剂名），决定 sheet 的 tab 名 ——
    审核者一眼就能看出「这张表是哪个方子的」。
    """
    from excel_schema import (
        MATRIX_COLS,
        MATRIX_HEADER_ROWS,
        MATRIX_ROWS,
        matrix_sheet_name,
    )

    ws = wb.create_sheet(matrix_sheet_name(index, title, pid))

    # ---- 顶部提示行 ----
    # 用户多半是直接翻到某个 P01- 看的，看不到「说明」表；
    # 所以把最要紧的三句放在这里（完整版见「说明」表『脉象图矩阵』一行）。
    hint = (
        "填写说明见「说明」表『脉象图矩阵』一行。"
        "｜ 本 sheet 的名字＝`P序号-图名`（图名＝哪个方子的），**图名在「脉象图·条目」表改**。"
        "｜ 左手／右手格填**用字**（照抄「脉象用字」表第 1 列），不是符号代码；留空＝原文没提这一格。"
        "｜ 组号：同号＝一组（且），不同号＝不同组（或），左右两列**共用一个编号空间**（左格与右格同号即同组）；填了用字就要填组号。"
        "｜ 表头区与「关系型要求」是**只读副本**，真源在「用方条目」表／「脉象图·关系」表。"
    )
    hcell = ws.cell(row=1, column=1, value=hint)
    hcell.font = Font(name="微软雅黑", size=9, italic=True, color="808080")
    hcell.alignment = Alignment(vertical="center", wrap_text=True)
    ws.row_dimensions[1].height = 30

    # ---- 表头区 ----
    # ⭐ 表头区的「值」放在 B 列，但 B 列的宽度是按数据区的「取法」列设的（10），
    #    长文本（关系型要求、出处）会被**截断**显示 —— 审核者得点进单元格才看得到。
    #    所以把表头区的值格**合并到 J 列**（B..J），让它直接显示全。
    #    ⚠️ 合并只影响表头区，数据区不受影响；读回仍读 B 列 ✓。
    header_map = {
        "id": pid,
        "route": (rule or {}).get("route", ""),
        "condition": (rule or {}).get("condition", ""),
        "source": pattern.get("source", ""),
        "note": pattern.get("note", ""),
    }
    r = 2  # 第 1 行是顶部提示行
    for label, key in MATRIX_HEADER_ROWS:
        # ⚠️ 除「条目ID」外，表头区都是**只读副本**（真源在「用方条目」表）——
        #    不标出来，审核者改了会以为生效。条目ID 保持原样（读回要按它定位）。
        shown = label if key == "id" else f"{label}（只读）"
        ws.cell(row=r, column=1, value=shown).font = Font(name="微软雅黑", size=11, bold=True)
        cell = ws.cell(row=r, column=2, value=header_map.get(key, ""))
        cell.font = FONT
        cell.alignment = Alignment(vertical="top", wrap_text=True)
        r += 1

    # ---- 关系型要求（画不成单格的，写在矩阵下方）----
    rels = pattern.get("relations") or []
    if rels:
        ws.cell(row=r, column=1, value="关系型要求（只读）").font = Font(
            name="微软雅黑", size=11, bold=True
        )
        lines = []
        for rel in rels:
            probes = rel.get("probe") or []
            if probes:
                ps = "；".join(f"{p['cell']}＝{'/'.join(p.get('codes', []))}" for p in probes)
                lines.append(f"【{rel['kind']}】{rel.get('text', '')}\n    探针：{ps}")
            else:
                lines.append(f"【{rel['kind']}】{rel.get('text', '')}")
        cell = ws.cell(row=r, column=2, value="\n".join(lines))
        cell.font = FONT
        cell.alignment = Alignment(vertical="top", wrap_text=True)
        r += 1

    # ---- 列头 ----
    # ⚠️ 全部按行号写，**不用 append/insert_rows 混搭** ——
    #    那套组合会让表头与数据错位一行（已踩过）。
    header_row = r
    for ci, c in enumerate(MATRIX_COLS, start=1):
        cell = ws.cell(row=header_row, column=ci, value=c.header)
        cell.font = HEADER_FONT
        cell.alignment = Alignment(vertical="center", horizontal="center", wrap_text=True)
        cell.border = Border(left=THIN, right=THIN, top=THIN, bottom=MEDIUM)
        cell.comment = column_comment(c)  # 悬停看这一列怎么填
    ws.row_dimensions[header_row].height = 24

    # ---- 表头区合并：让长文本显示得开 ----
    # 值列（B）宽度是按数据区「取法」列设的（10），长文本会被截断显示 ——
    # 合并 B..J 之后总宽约 114 字符，「关系型要求」「出处」都能直接看全。
    # ⚠️ 只合并表头区（第 2 行 ~ 列头行前一行）与顶部提示行；数据区不动。
    # ⚠️ 第 1 行（提示行）的文字在 A 列，所以整行合 A..J —— 不能先合 B..J
    #    再合 A..J，那会**重叠**（Excel 会报错）。
    for rr in range(2, header_row):
        ws.merge_cells(start_row=rr, start_column=2, end_row=rr, end_column=10)
        ws.row_dimensions[rr].height = 22
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=10)
    ws.row_dimensions[1].height = 30

    # ---- 9 行数据 ----
    # 格位索引：cellKey → {term, group, note, flex}
    cell_index: dict[str, dict] = {}
    group_of: dict[str, int] = {}
    for gi, grp in enumerate(pattern.get("groups") or [], start=1):
        for c in grp:
            group_of[c] = gi
    for c in pattern.get("cells") or []:
        cell_index[c["cell"]] = c

    first_data_row = header_row + 1
    for ri, (organ, depth) in enumerate(MATRIX_ROWS):
        row_no = first_data_row + ri
        # ⚠️ 列序必须是**左右交错**（左手｜右手｜左组号｜右组号…），
        #    与 MATRIX_COLS 的列头一一对应 ——
        #    早先写成「左手四列块 + 右手四列块」，与列头差一位，读回就串了。
        def cell_values(hand: str) -> tuple[str, object, str, str]:
            key = f"{hand}|{organ}|{depth}"
            spec = cell_index.get(key)
            if spec is None:
                return ("", "", "", "")
            return (
                spec["term"],
                group_of.get(key, ""),
                spec.get("note", ""),
                "TRUE" if spec.get("flex") else "",
            )

        l_term, l_group, l_note, l_flex = cell_values("L")
        r_term, r_group, r_note, r_flex = cell_values("R")
        values = [
            organ,
            depth,
            l_term,
            r_term,
            l_group,
            r_group,
            l_note,
            r_note,
            l_flex,
            r_flex,
        ]
        for ci, v in enumerate(values, start=1):
            cell = ws.cell(row=row_no, column=ci, value=v)
            cell.font = FONT
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            cell.border = Border(left=HAIR, right=HAIR, top=HAIR, bottom=HAIR)

    # ---- 列宽 ----
    for i, c in enumerate(MATRIX_COLS, start=1):
        ws.column_dimensions[get_column_letter(i)].width = c.width

    # 已填的格染色，一眼看出哪些格有要求
    for ri in range(len(MATRIX_ROWS)):
        for ci in (3, 4):  # 左手、右手
            cell = ws.cell(row=first_data_row + ri, column=ci)
            if cell.value not in (None, ""):
                cell.fill = PatternFill("solid", fgColor=FILLED_FILL)
                cell.font = Font(name="微软雅黑", size=11, bold=True)

    # 部位列：三个部位各合并三行（与讲义 p34 的「部位合并、组内不画横线」一致）
    for gi in range(3):
        start = first_data_row + gi * 3
        ws.merge_cells(start_row=start, start_column=1, end_row=start + 2, end_column=1)
        cell = ws.cell(row=start, column=1)
        cell.alignment = Alignment(vertical="center", horizontal="center")
        cell.font = Font(name="微软雅黑", size=11, bold=True)

    ws.freeze_panes = ws.cell(row=first_data_row, column=3)


def main() -> int:
    out_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_OUT

    drugs_doc = read_json("drugs.json")
    doses_doc = read_json("doses.json")
    ref_doc = read_json("formula-reference.json")
    terms_doc = read_json("pulse-terms.json")
    patterns_doc = read_json("pulse-patterns.json")
    rules_doc = read_json("formula-rules.json")
    groups_doc = read_json("pulse-groups.json")
    symbols_doc = read_json("symbols.json")

    tables: dict[str, Any] = {
        "drugs": drugs_doc["drugs"],
        "doses": doses_doc["doses"],
        "sciences": doses_doc["sciences"],
        "scienceByDoseId": doses_doc["scienceByDoseId"],
        "rows": ref_doc["rows"],
        "alias": ref_doc["alias"],
        "draftExtra": ref_doc["draftExtra"],
        "terms": terms_doc["terms"],
        "symbols": symbols_doc["symbols"],
        "groups": groups_doc["groups"],
        "rules": rules_doc["rules"],
        "patterns": patterns_doc["patterns"],
    }
    derived: dict[str, Any] = {
        "__patternCells": pattern_cell_rows(tables["patterns"]),
        "__patternRelations": pattern_relation_rows(tables["patterns"]),
    }

    wb = Workbook()
    wb.remove(wb.active)  # 去掉默认空表

    # 说明表
    ws = wb.create_sheet("说明")
    ws.append([c.header for c in README_COLS])
    style_header(ws, len(README_COLS))
    for i, c in enumerate(README_COLS, start=1):
        cm = Comment(
            f"「说明」表是这份工作簿的**使用手册**：\n"
            f"每行＝一张表（最后一行是脉象图矩阵）。\n\n"
            f"· 「这张表是什么」—— 它的用途。\n"
            f"· 「列」—— 每列的名字（括号里是数据里的键名）。\n"
            f"· 「怎么编辑」—— 具体怎么填。\n\n"
            f"⚠️ 各表列头的**批注**与本表同源 —— 悬停列头即可看到该列怎么填。",
            "臧氏脉学",
        )
        cm.width = 340
        cm.height = 180
        ws.cell(row=1, column=i).comment = cm
    for item in build_readme_rows():
        ws.append([cell_value(item.get(c.key), c.type) for c in README_COLS])
    style_body(ws, len(build_readme_rows()), len(README_COLS))
    for i, c in enumerate(README_COLS, start=1):
        ws.column_dimensions[get_column_letter(i)].width = c.width
    ws.freeze_panes = "A2"

    for sheet in SHEETS:
        if sheet.json_path.startswith("__"):
            data = derived[sheet.json_path]
        else:
            data = tables.get(sheet.json_path)
            if data is None:
                raise SystemExit(f"[excel] 表 {sheet.name} 的数据路径取不到：{sheet.json_path}")

        if sheet.is_dict:
            # 字典表 → 行数组
            rows = []
            for k, v in data.items():
                if sheet.dict_value:
                    # 键 → 对象：键进第一列，value 的其余键进其余列
                    row = {sheet.row_key: k}
                    for c in sheet.cols:
                        if c.key != sheet.row_key and c.key in v:
                            row[c.key] = v[c.key]
                    rows.append(row)
                elif isinstance(v, str):
                    rows.append({sheet.cols[0].key: k, sheet.cols[1].key: v})
                else:
                    rows.append({sheet.cols[0].key: k, **v})
        elif sheet.json_path == "terms":
            # 用字表：字典 {用字: {codes, also, display}} → 行数组
            rows = [{"term": k, **v} for k, v in data.items()]
            # 「符号含义」：把符号翻译成中文（照抄「符号表」的名称）
            label_of = {s["code"]: s["label"] for s in tables["symbols"]}
            for r in rows:
                parts = [f"{c}＝{label_of.get(c, c)}" for c in r.get("codes", [])]
                if r.get("also"):
                    parts.append("须并带：" + "、".join(f"{c}＝{label_of.get(c, c)}" for c in r["also"]))
                if parts:
                    r["meaning"] = "；".join(parts)
        elif isinstance(data, dict):
            # 键 → 对象 的字典（如 draftExtra）：键进第一列
            rows = [{sheet.cols[0].key: k, **v} for k, v in data.items()]
        else:
            rows = list(data)

        write_sheet(wb, sheet, rows)

    # ---- 脉象图矩阵：每条用方条目一个 sheet ----
    rules_by_id = {r["id"]: r for r in tables["rules"]}
    pattern_ids = list(tables["patterns"].keys())
    for i, pid in enumerate(pattern_ids, start=1):
        pat = tables["patterns"][pid]
        write_matrix_sheet(
            wb, i, pid, pat.get("title", ""), pat, rules_by_id.get(pid), tables["terms"]
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out_path)

    print(f"[excel] 已写出 {out_path}")
    print(f"[excel]   说明  {len(build_readme_rows())} 行")
    for sheet in SHEETS:
        if sheet.json_path.startswith("__"):
            n = len(derived[sheet.json_path])
        else:
            data = tables.get(sheet.json_path) or {}
            n = len(data)
        print(f"[excel]   {sheet.name}  {n} 行 × {len(sheet.cols)} 列")
    print(f"[excel]   脉象图矩阵  {len(pattern_ids)} 个 sheet（每个 9 行 × 左右两列）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
