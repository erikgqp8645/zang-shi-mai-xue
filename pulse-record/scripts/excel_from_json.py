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
from openpyxl.styles import Alignment, Border, Font, Side
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
                "怎么改这份工作簿。本工作簿是**人工编辑层**，机器消费层是仓库里的 "
                "src/content/*.json；改完这里，跑 scripts/excel_to_json.py 转回 JSON。"
            ),
            "cols": "",
            "howto": "改完存盘 → python3 scripts/excel_to_json.py → npm test",
        }
    ]
    for s in SHEETS:
        cols = "\n".join(f"{c.header}（{c.key}）" + (f" — {c.note}" if c.note else "") for c in s.cols)
        howto = _howto_for(s)
        rows.append({"sheet": s.name, "purpose": s.purpose, "cols": cols, "howto": howto})
    return rows


def _howto_for(s: SheetDef) -> str:
    if s.is_dict:
        return "两列：左边＝键，右边＝值。**不要改键**（键会被别的表引用）。"
    if s.json_path == "__patternCells":
        return (
            "每行＝一个格位要求。\n"
            "· 「组号」留空＝该条目全部格合成一组（且）；填 1、2、3 ＝第几个且组，"
            "组内是「且」、组间是「或」。\n"
            "· 要新增格位：在下方插入一行，填全四列即可。\n"
            "· 要删格位：删掉整行。"
        )
    if s.json_path == "__patternRelations":
        return (
            "每行＝一个关系。同一关系有多个探针时，占多行："
            "**只在第一行填「探针格位／探针符号」，其余行留空**。\n"
            "· 「探针格位」留空 ＝ 该关系没有探针。"
        )
    if s.json_path == "patterns":
        return (
            "每行＝一条用方条目的脉象图主记录。格位在「脉象图·格位」表、"
            "关系在「脉象图·关系」表，靠「条目ID」关联。"
        )
    if s.json_path == "terms":
        return (
            "「符号集」＝该格允许的取值（逗号分隔，是「或」的关系）。\n"
            "「须并带」＝同一格里还必须同时出现的符号（逗号分隔，也是「或」）。\n"
            "⚠️ 符号集按**代码实际接受的**取，不是按力度阈值自动推 —— "
            "「大」不含↑，「大或顶」含↑。"
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

    for item in rows:
        ws.append([cell_value(item.get(c.key), c.type) for c in sheet.cols])

    style_body(ws, len(rows), len(sheet.cols))

    for i, c in enumerate(sheet.cols, start=1):
        ws.column_dimensions[get_column_letter(i)].width = c.width

    # 冻结首行 + 自动筛选
    ws.freeze_panes = "A2"
    if rows:
        ws.auto_filter.ref = f"A1:{get_column_letter(len(sheet.cols))}1"


def main() -> int:
    out_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_OUT

    drugs_doc = read_json("drugs.json")
    doses_doc = read_json("doses.json")
    ref_doc = read_json("formula-reference.json")
    terms_doc = read_json("pulse-terms.json")
    patterns_doc = read_json("pulse-patterns.json")
    rules_doc = read_json("formula-rules.json")
    groups_doc = read_json("pulse-groups.json")

    tables: dict[str, Any] = {
        "drugs": drugs_doc["drugs"],
        "doses": doses_doc["doses"],
        "sciences": doses_doc["sciences"],
        "scienceByDoseId": doses_doc["scienceByDoseId"],
        "rows": ref_doc["rows"],
        "alias": ref_doc["alias"],
        "draftExtra": ref_doc["draftExtra"],
        "terms": terms_doc["terms"],
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
        elif isinstance(data, dict):
            # 键 → 对象 的字典（如 draftExtra）：键进第一列
            rows = [{sheet.cols[0].key: k, **v} for k, v in data.items()]
        else:
            rows = list(data)

        write_sheet(wb, sheet, rows)

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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
