#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Excel 中间格式 —— 表结构定义（**唯一真源**）

## 这个文件是什么

人工编辑层与机器消费层之间的**契约**。两边都只认这份定义，不各写一套：

  · ``excel_from_json.py``  —— JSON 摊平成 Excel 行
  · ``excel_to_json.py``    —— Excel 行还原成 JSON

任何一边改了列，必须回来改这里 —— 否则往返测试会红。

## 摊平的三条规矩

① **一格一值，一行一条记录。** 不把两个字段塞进一格。
② **数组用换行分隔**（同一格内多行），不用顿号/逗号 ——
   讲稿原文里方名自带顿号（如「柴鳖骨（柴胡、鳖甲、地骨皮）」），
   用顿号分隔必然切错；换行则安全（已核：原始数据里没有任何字符串含换行）。
   读回时按行切开、去空白、丢空行。
③ **嵌套结构拆成带外键的多张表**，用「父 id + 序号」关联，
   读回时按序号排序还原顺序。

## 符号分隔符

脉象符号集（``0 - + ± ++ ±± ↑ | # X TTT DDX``）里**没有逗号**，
所以用逗号分隔是安全的。注意 ``|`` 本身是个符号，但它不是分隔符（分隔符是逗号），不冲突。

## 为什么用 Python

Excel 读写用 ``openpyxl``（本机已装 3.1.5）——**不新增 npm 依赖**。
项目工具链（Vite/Taro/tsc）因此不受影响，Excel 层是完全独立的编辑辅助层。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

#: Excel 里数组元素的分隔符（同一格内换行）
ARRAY_SEP = "\n"

#: 脉象符号集的分隔符（单行内逗号分隔）
CODE_SEP = ","

ColType = Literal["text", "int", "bool", "array", "codes", "blank"]


@dataclass(frozen=True)
class ColDef:
    """一列的定义。"""

    header: str  # 列头（中文，给人看）
    key: str  # 数据里的键
    width: int = 18  # 列宽（Excel 字符数）
    type: ColType = "text"  # 单元格类型
    note: str = ""  # 备注（写进「说明」表，让审核者知道这列什么意思）
    omit_empty: bool = False  # 空值时**省略该键**（不写进 JSON）
    """
    原文 JSON 是**稀疏**的：讲稿没写的字段，键根本不存在
    （不是写成空串）。这一列若为真，读回时空值不产出该键，
    保证往返后与原 JSON 的键集完全一致。
    """
    derived: bool = False  # **派生列**：不是原文的字段，读回时忽略
    """
    派生列由别的列算出来（如「符号含义」＝把符号集翻成中文），
    不对应原文的某个键。它只给人看 —— 读回时不参与还原。
    """


@dataclass(frozen=True)
class SheetDef:
    """一张表的定义。"""

    name: str  # sheet 名（≤31 字符，Excel 硬限制）
    purpose: str  # 这张表是什么（写进「说明」表）
    json_path: str  # 行数组在 JSON 里的位置（点号路径）
    cols: list[ColDef] = field(default_factory=list)
    row_key: str = ""  # 行级主键（数据里的字段名）
    parent_key: str = ""  # 从属表的外键：指向父行的哪个字段
    id_key: str = ""  # 本表自己的 id 字段（从属表用它作行 id）
    omit_empty_array: bool = False  # 读回时空数组是否省略该字段
    is_dict: bool = False  # 是否是「两列 → 字典」的表（alias / scienceByDoseId）
    dict_value: bool = False  # 字典的 value 是对象（键→对象，如 draftExtra）
    key_is_column: bool = False  # 字典表的键是否就是第一列（两列字典表为 True）


# ------------------------------------------------------------------
# 表定义
# ------------------------------------------------------------------

SHEET_DRUGS = SheetDef(
    name="方剂·讲稿2010",
    purpose=(
        "讲稿 2010 的方剂条目（组成／服法／加减／禁忌／科学中药比例）。"
        "剂量单位＝讲稿的比例制，**不可与同和堂版的克换算**。"
    ),
    json_path="drugs",
    row_key="id",
    cols=[
        ColDef("ID", "id", 22, note="主键，勿改"),
        ColDef("方名", "name", 26, note="讲稿原名，勿改成现代教材方名"),
        ColDef("疗法", "therapy", 14, note="一体疗法／三焦疗法／五脏疗法（三者并列，勿合并）"),
        ColDef("组成", "composition", 46, omit_empty=True, note="讲稿原样转录，比例制（如「熟地5」）"),
        ColDef("服法", "usage", 34, omit_empty=True, note="讲稿未写明的留空，勿补写"),
        ColDef("科学中药比例", "science", 24, omit_empty=True, note="讲稿侧的比例制（g）；与同和堂版 p4 的「科中」是两套"),
        ColDef("加减", "adjustments", 40, "array", omit_empty=True, note="一条一行；讲稿写明的条件式加减，勿自行加减方"),
        ColDef("适应脉象", "indication", 34, omit_empty=True),
        ColDef("禁忌", "contraindication", 38, omit_empty=True),
        ColDef("出处", "source", 32, note="格式：讲稿 2010·第N讲"),
        ColDef("原文引述", "quote", 60, note="逐字引用，保持原文用字"),
    ],
)

SHEET_DOSES = SheetDef(
    name="成方·同和堂版",
    purpose=(
        "同和堂版《臧氏脉学方剂汇总统表》的成方（药味＋**克**）。"
        "这是三套资料里唯一可直接抓药的剂量。"
    ),
    json_path="doses",
    row_key="id",
    cols=[
        ColDef("ID", "id", 20, note="主键，勿改"),
        ColDef("方名", "name", 30, note="同和堂版原名；与讲义 p42 不同名处**并列**，勿替读者选一个"),
        ColDef("组成（克）", "composition", 60, note="照录原文；原文写错的字也照录"),
        ColDef("原文备注", "notes", 44, "array", omit_empty=True, note="原文的区间值、异体字等照录说明；一条一行"),
        ColDef("页码", "page", 8, "int", note="同和堂版第几页（p1~p4）"),
    ],
)

SHEET_SCIENCES = SheetDef(
    name="科学中药比例",
    purpose="同和堂版第 4 页「科中」＝科学中药比例表。",
    json_path="sciences",
    row_key="id",
    cols=[
        ColDef("ID", "id", 22, note="主键，勿改"),
        ColDef("名称", "name", 26, note="同和堂版原名（如「六神」「五异」）"),
        ColDef("比例", "ratio", 44, note="照录，如「四君子汤2 陈皮0.2 …」"),
        ColDef("页码", "page", 8, "int", note="同和堂版第几页"),
    ],
)

SHEET_SCIENCE_MAP = SheetDef(
    name="成方↔科中对照",
    purpose="哪个成方用哪条科学中药比例。",
    json_path="scienceByDoseId",
    is_dict=True,
    cols=[
        ColDef("成方ID", "doseId", 20, note="对应「成方·同和堂版」的 ID"),
        ColDef("科中名称", "scienceName", 22, note="对应「科学中药比例」的名称"),
    ],
)

SHEET_REF_ROWS = SheetDef(
    name="讲义p42用方表",
    purpose=(
        "讲义 2026-10·p42 的「依脉用方表」28 行"
        "（只有处方名＋对应脉象，**没有组成与剂量**）。"
    ),
    json_path="rows",
    row_key="no",
    cols=[
        ColDef("序号", "no", 8, "int", note="讲义 p42 原表行号"),
        ColDef("处方名", "name", 26, note="讲义 p42 原名"),
        ColDef("对应脉象及加减", "indication", 40),
        ColDef("同和堂版ID", "doseId", 20, note="对应「成方·同和堂版」；查不到留空"),
        ColDef("对照依据", "doseBasis", 40, note="为何能对上；没写明的就不对照"),
        ColDef("讲稿方名", "draftName", 26, omit_empty=True, note="与「讲稿备注」**二选一**：有方名就填这里、没有就填备注"),
        ColDef("讲稿备注", "draftNote", 44, omit_empty=True, note="与「讲稿方名」二选一（如「未载组成与剂量」）"),
    ],
)

SHEET_ALIAS = SheetDef(
    name="方名别名对照",
    purpose="同一张方在两条资料线里的不同叫法。**并列登记，不替读者选一个**。",
    json_path="alias",
    is_dict=True,
    cols=[
        ColDef("讲义用名", "alias", 26),
        ColDef("讲稿用名", "target", 30),
    ],
)

SHEET_DRAFT = SheetDef(
    name="讲稿草稿方",
    purpose="讲稿里给了方子但没给剂量的条目（剂量要去同和堂版查）。",
    json_path="draftExtra",
    row_key="id",
    is_dict=True,
    dict_value=True,
    cols=[
        ColDef("ID", "id", 24, note="主键，勿改"),
        ColDef("名称", "name", 30),
        ColDef("组成", "composition", 46, note="讲稿只给药味简称时照录"),
        ColDef("出处", "source", 26),
        ColDef("备注", "note", 40),
    ],
)
SHEET_TERMS = SheetDef(
    name="脉象用字",
    purpose=(
        "「原文用字」→「符号集」对照。"
        "**符号集按代码实际接受的取，不按力度阈值自动推** —— "
        "所以「大」（不含↑）与「大或顶」（含↑）是两个不同的用字。"
        "讲义 p33/p34 自身不一致处见备注。"
    ),
    json_path="terms",
    row_key="term",
    cols=[
        ColDef("用字", "term", 16, note="原文用字，主键"),
        ColDef("符号集", "codes", 34, "codes", note="该格允许的取值，逗号分隔（或关系）"),
        ColDef("须并带", "also", 24, "codes", omit_empty=True, note="同一格里还必须同时出现的符号，逗号分隔（或关系）"),
        ColDef("图上显示", "display", 12, note="图上印的代表符号"),
        ColDef("符号含义", "meaning", 56, omit_empty=True, derived=True, note="**自动算出来的，只读** —— 把「符号集」里的每个符号翻成中文（如 `++＝有力`）。要改含义去「符号表」改「名称」，要改可接受的取值就改「符号集」"),
        ColDef("出处与说明", "note", 48, omit_empty=True, note="讲义 p33/p34 的不一致等；无则空"),
    ],
)

SHEET_SYMBOLS = SheetDef(
    name="符号表",
    purpose=(
        "讲义 2026-10 p34「④ 脉象记录」的固定符号集（14 个）。"
        "「脉象用字」表里的符号集就是从这里挑的 —— "
        "看到 `++` 不知道是什么时，查这张表。"
    ),
    json_path="symbols",
    row_key="code",
    cols=[
        ColDef("符号", "code", 10, note="格子里显示的字符"),
        ColDef("名称", "label", 16, note="讲义 p34 给的中文名"),
        ColDef("类别", "group", 12, note="主要脉象／变脉／其他"),
        ColDef("说明", "hint", 30, omit_empty=True, note="讲义 p33「③ 标准脉象」的补充说明"),
    ],
)

SHEET_PULSE_GROUPS = SheetDef(
    name="脉位组合",
    purpose=(
        "讲稿／讲义写明的**脉位组合**（双关同治、肝肺同治、双寸……）。"
        "这里只是把原文写明的部位整理成可点的组合，方便一次选多个脉位；"
        "不是诊断，也不替使用者选方。"
    ),
    json_path="groups",
    row_key="id",
    cols=[
        ColDef("ID", "id", 20, note="主键，勿改"),
        ColDef("组合名", "name", 16, note="原文用字，不改写"),
        ColDef("成员脉位", "positions", 26, "array", note="格式 手|部位（L=左手 R=右手）；一条一行"),
        ColDef("联动检索词", "ref", 16, note="讲义 p42 处方表的**原文检索词**，不自造"),
        ColDef("出处", "source", 60),
    ],
)

SHEET_FORMULA_RULES = SheetDef(
    name="用方条目",
    purpose=(
        "依脉用方的 61 条条目（主线／挡路／加味／禁忌）。"
        "「触发条件」是**原文用语**，不改写。"
        "脉象图挂在这些条目上 —— 「脉象图·条目」的条目ID 与本表 ID 一一对应，"
        "方便对照审核「条件文字 ↔ 脉象图」是否一致。"
    ),
    json_path="rules",
    row_key="id",
    cols=[
        ColDef("ID", "id", 24, note="主键，勿改；与「脉象图·条目」同名对应"),
        ColDef("路线", "route", 16, note="肾虚／上盛下虚／挡路一…／讲稿方剂／用药禁忌"),
        ColDef("触发条件", "condition", 30, note="**原文用语**，不改写"),
        ColDef("治法", "therapy", 34),
        ColDef("方剂", "formulas", 30, "array", note="一条一行；方名照录，不改成现代教材方名"),
        ColDef("添加药", "adds", 24, "array", omit_empty=True, note="是「往主方里加什么药」，**不是方名**，一条一行"),
        ColDef("关联方剂ID", "drugs", 24, "array", omit_empty=True, note="对应「方剂·讲稿2010」的 ID；一条一行"),
        ColDef("出处", "source", 34),
        ColDef("原文引述", "quote", 60),
        ColDef("类别", "kind", 10, note="主线／挡路／加味／禁忌"),
        ColDef("常驻", "always", 8, "bool", omit_empty=True, note="TRUE＝不依赖脉象，始终列出（如用药禁忌）"),
    ],
)

SHEET_PATTERNS = SheetDef(
    name="脉象图·条目",
    purpose=(
        "一条用方条目一张脉象图。图只标示讲稿／讲义写明的条件，"
        "**不下诊断、不替读者加减方**。"
        "「与条件文字的出入」一列显式写出差异，不静默取一边。"
    ),
    json_path="patterns",
    row_key="id",
    cols=[
        ColDef("条目ID", "id", 24, note="主键；与用方条目的 ID 同名（脉象图挂在用方条目上）"),
        ColDef("出处", "source", 34, note="格式：讲稿 2010·第N讲／讲义 2026-10·pNN"),
        ColDef("与条件文字的出入", "note", 44, note="讲义标「右关」但讲稿未分左右之类；有则写，无则空"),
    ],
)

SHEET_PATTERN_CELLS = SheetDef(
    name="脉象图·格位",
    purpose=(
        "每条用方条目要求哪些格是什么脉象。照抄讲稿／讲义写明的格位，"
        "**空白格＝原文未提及，不作要求**。"
        "「且／或」由组号表达：同一组号内的格必须同时成立，不同组号之间任一组成立即可。"
    ),
    json_path="__patternCells",
    parent_key="patternId",
    id_key="id",
    cols=[
        ColDef("条目ID", "patternId", 24, note="对应「脉象图·条目」的条目ID"),
        ColDef("格位", "cell", 14, note="格式 L|寸|浮（L=左手 R=右手；寸/关/尺；浮/中/沉）"),
        ColDef("用字", "term", 14, note="必须是「脉象用字」表里有的用字"),
        ColDef("组号", "group", 8, "int", note="留空＝不分组（默认合成一组）；数字＝第几个且组"),
        ColDef("格备注", "note", 22),
        ColDef("柔性", "flex", 8, note="TRUE＝本格还须配合关系型要求，单填不成立"),
    ],
)

SHEET_PATTERN_RELATIONS = SheetDef(
    name="脉象图·关系",
    purpose=(
        "关系型要求：画不成单格的条件。探针＝验证用的具体录法（格位＋符号）。"
        "探针里的格位可以不在「格位」表里（那正是「图上画不出来的那部分约束」）。"
    ),
    json_path="__patternRelations",
    parent_key="patternId",
    id_key="id",
    cols=[
        ColDef("条目ID", "patternId", 24, note="对应「脉象图·条目」的条目ID"),
        ColDef("关系种类", "kind", 22, note="如「尺脉不平衡」「任意格变脉」"),
        ColDef("原文用语", "text", 44),
        ColDef("探针格位", "probeCell", 14, note="留空＝该关系无探针"),
        ColDef("探针符号", "probeCodes", 20, "codes", note="逗号分隔"),
    ],
)

#: 全部表（顺序＝工作簿里的 sheet 顺序）
SHEETS: list[SheetDef] = [
    SHEET_DRUGS,
    SHEET_DOSES,
    SHEET_SCIENCES,
    SHEET_SCIENCE_MAP,
    SHEET_REF_ROWS,
    SHEET_ALIAS,
    SHEET_DRAFT,
    SHEET_TERMS,
    SHEET_SYMBOLS,
    SHEET_PULSE_GROUPS,
    SHEET_FORMULA_RULES,
    SHEET_PATTERNS,
    SHEET_PATTERN_CELLS,
    SHEET_PATTERN_RELATIONS,
]

# ------------------------------------------------------------------
# 脉象图矩阵（每条用方条目一个 sheet）
# ------------------------------------------------------------------

#: 矩阵表的 9 行 —— 讲义 p34 记录表体例：寸(浮中沉)／关(浮中沉)／尺(浮中沉)
MATRIX_ROWS: list[tuple[str, str]] = [
    ("寸", "浮"),
    ("寸", "中"),
    ("寸", "沉"),
    ("关", "浮"),
    ("关", "中"),
    ("关", "沉"),
    ("尺", "浮"),
    ("尺", "中"),
    ("尺", "沉"),
]

#: 矩阵表的列（左边是部位／取法，右边是左、右手两列）
MATRIX_COLS: list[ColDef] = [
    ColDef("部位", "organ", 10, note="**只读** —— 寸／关／尺，三个部位各合并三行（与讲义 p34 一致），不要改"),
    ColDef("取法", "depth", 10, note="**只读** —— 浮／中／沉，每部位三行，不要改"),
    ColDef("左手", "L", 16, note="讲稿／讲义写明的**用字**（照抄「脉象用字」表第 1 列，如「大或顶」）；留空＝原文未提及，不作要求"),
    ColDef("右手", "R", 16, note="同「左手」"),
    ColDef("左组号", "Lgroup", 8, "int", note="留空＝本格单独成立；填**同一个数字**＝同一组（组内是「且」）；不同数字＝不同组（组间是「或」）。与右列的组号**各自独立**"),
    ColDef("右组号", "Rgroup", 8, "int", note="同「左组号」"),
    ColDef("左格备注", "Lnote", 20, note="这一格原文的具体话（如「浮大而软」）；没有就空着"),
    ColDef("右格备注", "Rnote", 20, note="同「左格备注」"),
    ColDef("左柔性", "Lflex", 8, note="TRUE＝本格还须配合表头的「关系型要求」才成立；不填＝本格自己就能成立"),
    ColDef("右柔性", "Rflex", 8, note="同「左柔性」"),
]

#: 矩阵 sheet 的表头区（在 9 行之前写这几行）
MATRIX_HEADER_ROWS = [
    ("条目ID", "id"),
    ("路线", "route"),
    ("触发条件", "condition"),
    ("出处", "source"),
    ("与条件文字的出入", "note"),
]

#: sheet 名前缀（带序号，保证唯一且便于按顺序找；Excel sheet 名上限 31 字符）
MATRIX_SHEET_PREFIX = "P"


def matrix_sheet_name(index: int, pattern_id: str) -> str:
    """矩阵 sheet 的名字：`P01-<条目ID>`。

    ⚠️ Excel 的 sheet 名上限 **31 字符**，而有两个条目 ID 就超了
    （``fx2-youguanchi-fuda-ding-muxiang`` 35 字）。所以加两位序号前缀 ——
    序号即「脉象图·条目」表里的行序，用户能对上号。

    ⚠️ 名字**以序号为准**，不靠 ID 还原 —— 截断后的 ID 认不出来了。
    读回时按序号定位条目（见 ``excel_to_json.py``）。
    """
    name = f"{MATRIX_SHEET_PREFIX}{index:02d}-{pattern_id}"
    return name[:31]


#: 「说明」表的列（写工作簿的第一张表）
README_COLS = [
    ColDef("表名", "sheet", 22),
    ColDef("这张表是什么", "purpose", 70),
    ColDef("列", "cols", 60),
    ColDef("怎么编辑", "howto", 60),
]
