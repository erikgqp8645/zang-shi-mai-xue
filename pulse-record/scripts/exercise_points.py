#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""练习册的练习点 —— **生成脚本与验收脚本共用这一份**

一个「练习点」＝ 工作簿里的一格 ＋ 它的正确答案 ＋ 这一格在教什么。

⭐ 正确答案**不写死在这里**，而是从 `src/content/*.json`（真源）现取 ——
   所以练习册不会和真源脱节，验收也不会「按错误的答案判对错」。

## 为什么要有练习册

用户审核工作簿时最缺的是「手感」：填错一个地方，长什么样、报什么错。
练习册把主工作簿复制一份，**故意留空几格**并标黄 + 写明依据，
填完可以用 ``scripts/e2e/excel_exercise.py`` 验收。

@see make_exercise_workbook.py
@see e2e/excel_exercise.py
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "src" / "content"

#: 数组在单元格里的分隔符（与 excel_schema.ARRAY_SEP 一致）
ARRAY_SEP = "\n"
#: 符号集在单元格里的分隔符（与 excel_schema.CODE_SEP 一致）
CODE_SEP = ","


# ------------------------------------------------------------------
# 练习点定义
# ------------------------------------------------------------------
#:
#: ``where`` 说明这一格在哪：
#:   · 普通表：``{"sheet": 表名, "key_col": 主键列头, "key_value": 主键值, "col": 列头}``
#:   · 矩阵表：``{"sheet": "P04-xxx", "organ": "关", "depth": "浮", "col": "左手"}``
#:
#: ``expect`` 说明正确答案从哪个 JSON 路径取：
#:   · ``path`` ＝ 逐层键；末层若是 list，另给 ``cell_key``／``group_of``
#:
#: ``teach`` ＝ 这一格在教什么；``source`` ＝ 依据的原文出处。

EXERCISE_POINTS: list[dict[str, Any]] = [
    {
        "id": "E1",
        "title": "「加减」列 —— 一格多条，一条一行",
        "where": {
            "sheet": "方剂·讲稿2010",
            "key_col": "ID",
            "key_value": "zuocun-fuda-tianwang",
            "col": "加减",
        },
        "expect": {"file": "drugs.json", "path": ["drugs", "zuocun-fuda-tianwang", "adjustments"]},
        "teach": (
            "一格里有多条加减时，**一条一行**（同一格内换行分隔），不要用顿号或逗号 —— "
            "讲稿的方名自带顿号（「柴鳖骨（柴胡、鳖甲、地骨皮）」），用顿号必切错。"
        ),
        "source": (
            "讲稿 2010·第二讲（叁、用方·三、五脏疗法·（六）左寸浮大（脉数））末尾："
            "「加减。尺脉没有力量的，记住要加干姜0.3g；尺脉有力的，黄芪易防风0.3g。」"
        ),
    },
    {
        "id": "E2",
        "title": "「组成」列 —— 同和堂版用**克**",
        "where": {
            "sheet": "成方·同和堂版",
            "key_col": "ID",
            "key_value": "th-1",
            "col": "组成（克）",
        },
        "expect": {"file": "doses.json", "path": ["doses", "th-1", "composition"]},
        "teach": (
            "同和堂版的组成照录**克**（如「茯苓12」）；"
            "讲稿那边是**比例制**（如「熟地5」）。**两套不可换算、不可合并** —— "
            "别把克写成比例，也别把比例当成克。"
        ),
        "source": "同和堂版《臧氏脉学方剂汇总统表》p1「1号上焦方」",
    },
    {
        "id": "E3",
        "title": "矩阵格 —— 填**用字**，不是符号代码",
        "where": {"sheet": "P04-fx-ssx-qingdanglu", "organ": "关", "depth": "浮", "col": "左手"},
        "expect": {
            "file": "pulse-patterns.json",
            "path": ["patterns", "fx-ssx-qingdanglu", "cells"],
            "cell_key": "L|关|浮",
            "field": "term",
        },
        "teach": (
            "格子里填的是**用字**（讲稿写下的那个词，如「大」「大或顶」「虚脏」），"
            "照抄「脉象用字」表第 1 列；**不是**符号代码（`++`、`↑` 那些）。"
            "符号代码是「允许集合」，用字才是原文。"
            "留空＝原文没提这一格，不作要求。"
        ),
        "source": "讲义 2026-10·p44（上盛下虚框 1）／讲稿 2010·第五讲",
    },
    {
        "id": "E4",
        "title": "矩阵的「组号」—— 同号＝且，异号＝或",
        "where": {"sheet": "P04-fx-ssx-qingdanglu", "organ": "寸", "depth": "浮", "col": "左组号"},
        "expect": {
            "file": "pulse-patterns.json",
            "path": ["patterns", "fx-ssx-qingdanglu", "groups"],
            "group_of": "L|寸|浮",
        },
        "teach": (
            "组号＝AND 组的编号：填**同一个数字**＝同一组（组内是「且」）；"
            "填**不同数字**＝不同组（组间是「或」）。"
            "⚠️ 左右两列**共用同一个编号空间** —— 左格与右格都填 1，它们是**同一组**（都要满足），不是两组。"
            "填了用字就**必须**填组号。"
        ),
        "source": "讲义 2026-10·p44（上盛下虚框 1）",
    },
    {
        "id": "E5",
        "title": "「探针符号」—— 逗号分隔",
        "where": {
            "sheet": "脉象图·关系",
            "key_col": "条目ID",
            "key_value": "fx-ssx-qingdanglu",
            "col": "探针符号",
            "row_index": 0,  # 同一条关系有多行时，取第几行
        },
        "expect": {
            "file": "pulse-patterns.json",
            "path": ["patterns", "fx-ssx-qingdanglu", "relations"],
            "rel_index": 0,
            "probe_index": 0,
        },
        "teach": (
            "关系型要求（画不成单格的，如「尺脉不平衡」）的探针符号，"
            "**逗号分隔**（符号集里没有逗号）。"
            "同一关系有多个探针时**每行各填自己的** —— "
            "不要「只在第一行填、其余留空」，那样会被当成续行，探针就静默丢了。"
        ),
        "source": "讲义 2026-10·p44（上盛下虚框 1）／讲稿 2010·第五讲",
    },
]


# ------------------------------------------------------------------
# 取期望值
# ------------------------------------------------------------------


def _dig(doc: Any, path: list[str]) -> Any:
    """逐层取键。

    ⚠️ 顶层集合有两种形态：**dict**（`pulse-patterns.json` 的 `patterns`
    按 id 索引）与 **list**（`drugs.json` 的 `drugs`、`doses.json` 的 `doses`
    是数组）。遇到 list 且键是字符串时，按 `id` 字段找那一项。
    """
    cur = doc
    for k in path:
        if isinstance(cur, list):
            if not isinstance(k, str):
                raise TypeError(f"路径 {path} 落在 list 上，键得是字符串（按 id 找），不是 {k!r}")
            hit = None
            for item in cur:
                if isinstance(item, dict) and str(item.get("id")) == k:
                    hit = item
                    break
            if hit is None:
                raise KeyError(f"路径 {path}：list 里找不到 id＝{k!r} 的项")
            cur = hit
        else:
            cur = cur[k]
    return cur


def expected_value(point: dict[str, Any], disk: dict[str, dict[str, Any]]) -> str:
    """从真源 JSON 算出这一格的**正确答案**（单元格里的文本形态）。

    ``disk`` ＝ ``{文件名: 解析后的 JSON}``。
    """
    exp = point["expect"]
    doc = disk[exp["file"]]
    val = _dig(doc, exp["path"])

    if "cell_key" in exp:
        for c in val:
            if c["cell"] == exp["cell_key"]:
                return str(c[exp.get("field", "term")])
        raise KeyError(f"练习点 {point['id']}：找不到格位 {exp['cell_key']}")

    if "group_of" in exp:
        for gi, grp in enumerate(val, start=1):
            if exp["group_of"] in grp:
                return str(gi)
        raise KeyError(f"练习点 {point['id']}：{exp['group_of']} 不在任何组里")

    if "rel_index" in exp:
        rel = val[exp["rel_index"]]
        probe = rel["probe"][exp["probe_index"]]
        return CODE_SEP.join(probe["codes"])

    if isinstance(val, list):
        return ARRAY_SEP.join(str(v) for v in val)
    return str(val)


# ------------------------------------------------------------------
# 在工作簿里定位这一格
# ------------------------------------------------------------------


def locate_cell(wb, point: dict[str, Any]) -> tuple[int, int]:
    """找到练习点对应的那一格，返回 ``(行号, 列号)``（1 起）。"""
    from openpyxl.utils import get_column_letter

    where = point["where"]
    ws = wb[where["sheet"]]

    if "key_col" in where:
        # 普通表：列头行是第 1 行，按主键找到行
        headers = [ws.cell(row=1, column=c).value for c in range(1, ws.max_column + 1)]
        if where["col"] not in headers:
            raise KeyError(f"练习点 {point['id']}：表里没有列「{where['col']}」")
        col = headers.index(where["col"]) + 1
        key_col = headers.index(where["key_col"]) + 1
        hits = [
            r
            for r in range(2, ws.max_row + 1)
            if str(ws.cell(row=r, column=key_col).value or "").strip() == where["key_value"]
        ]
        if not hits:
            raise KeyError(f"练习点 {point['id']}：找不到 {where['key_value']} 行")
        row = hits[where.get("row_index", 0)]
        return row, col

    # 矩阵表：列头行是 A 列 ==「部位」的那一行
    col_header_row = 0
    for r in range(1, min(ws.max_row, 20) + 1):
        if str(ws.cell(row=r, column=1).value or "").strip() == "部位":
            col_header_row = r
            break
    if not col_header_row:
        raise KeyError(f"练习点 {point['id']}：矩阵里找不到列头行")

    headers = [
        ws.cell(row=col_header_row, column=c).value for c in range(1, ws.max_column + 1)
    ]
    if where["col"] not in headers:
        raise KeyError(f"练习点 {point['id']}：矩阵里没有列「{where['col']}」")
    col = headers.index(where["col"]) + 1

    # 部位列是合并单元格 → 按行上溯取部位
    current_organ = ""
    target_row = 0
    for r in range(col_header_row + 1, ws.max_row + 1):
        v = ws.cell(row=r, column=1).value
        if v is not None and str(v).strip() != "":
            current_organ = str(v).strip()
        depth = str(ws.cell(row=r, column=2).value or "").strip()
        if current_organ == where["organ"] and depth == where["depth"]:
            target_row = r
            break
    if not target_row:
        raise KeyError(f"练习点 {point['id']}：矩阵里找不到 {where['organ']}{where['depth']} 行")
    return target_row, col


def read_disk() -> dict[str, dict[str, Any]]:
    """读真源 JSON。"""
    out: dict[str, dict[str, Any]] = {}
    for f in sorted(CONTENT.glob("*.json")):
        out[f.name] = json.loads(f.read_text(encoding="utf-8"))
    return out
