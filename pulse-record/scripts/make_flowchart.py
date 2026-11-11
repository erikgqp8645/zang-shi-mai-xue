#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把工作簿里**真实**的矩阵 sheet 渲染成《填写流程图.html》里的示意图。

## 为什么要生成，而不是手画

流程图第 03 节那张「一个矩阵 sheet 长什么样」，是对**工作簿结构**的断言：
10 列、部位列各合并三行、表头区 6 行只读副本、已填格染色。
早先手写的 SVG 已经漂移过一次 —— 画成了 7 列、2 行表头区，还多出一条竖线，
表头文字和数值对不上同一套列定义。手写的东西迟早还会再漂，
所以改成**从工作簿直接读出来渲染**：工作簿改了，重新跑一次就同步。

片段包在页面里的 ``<!-- matrix:begin -->`` / ``<!-- matrix:end -->`` 之间，
``--check`` 模式只校验不写，用于挂进回归。

## 用法

    npm run content:flowchart                    # 生成并写回 docs/填写流程图.html
    （Windows 上 `python3` 可能只是 Microsoft Store 的空壳别名 —— 用上面这条 npm 命令，
      仓库会自己找能用的解释器，不会卡在「python3 不是内部或外部命令」上）
    npm run content:flowchart:check              # 只校验，不一致则退出码 1
"""

from __future__ import annotations

import html
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import openpyxl  # noqa: E402

from excel_schema import MATRIX_COLS  # noqa: E402

WORKBOOK = ROOT / "content" / "臧氏脉学-用方知识库.xlsx"
PAGE = ROOT / "docs" / "填写流程图.html"

BEGIN = "<!-- matrix:begin -->"
END = "<!-- matrix:end -->"

# 演示用的矩阵 sheet：清挡路（上方下虚）。
# 选它是因为它六行只读表头区齐（含「关系型要求」）、且九行里填了六格。
# ⚠️ sheet 名＝`P序号-图名` —— 图名变了这里要跟着改（找不到会退回按序号取第一个）。
DEMO_SHEET_PREFIX = "P04-"
DEMO_SHEET_NAME = "P04-清挡路"

# Excel 里配色（与 excel_from_json.py 同源）：
#   部位列橙 FFC000、已填的左手/右手格 FFE0B2
FILL_PART = "#FFC000"
FILL_CELL = "#FFE0B2"

# 哪些列是**只读**（结构固定，审核者不要改）。
# 与 excel_from_json.py 写矩阵 sheet 时固定 MATRIX_ROWS 的那两列一致。
READONLY_KEYS = {"organ", "depth"}

# 每列在示意图里的角色 → 决定画成什么
ROLE = {
    "organ": "part",
    "depth": "depth",
    "L": "chip",
    "R": "chip",
    "Lgroup": "grp",
    "Rgroup": "grp",
    "Lnote": "plain",
    "Rnote": "plain",
    "Lflex": "plain",
    "Rflex": "plain",
}

# 图例分组：（标题，列 key）
LEGEND_GROUPS = [
    ("部位／取法", ["organ", "depth"]),
    ("左手／右手", ["L", "R"]),
    ("左组号／右组号", ["Lgroup", "Rgroup"]),
    ("左格备注／右格备注", ["Lnote", "Rnote"]),
    ("左柔性／右柔性", ["Lflex", "Rflex"]),
]


# ── 文本处理 ───────────────────────────────────────────────

def esc(text: object) -> str:
    return html.escape("" if text is None else str(text))


def rich(text: object) -> str:
    """把 Excel 批注里那套 ``**强调**`` 记号转成 <strong>。"""
    out = esc(text)
    return re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", out)


def br(text: object) -> str:
    """单元格里的换行 → <br>（表头区那段长文本就是多行的）。"""
    return "<br>".join(rich(line.strip()) for line in str(text or "").split("\n"))


# ── 读工作簿 ───────────────────────────────────────────────

def pick_demo_sheet(wb) -> str:
    # 先按**全名**找（图名改了也能精准命中），再退回按前缀找。
    if DEMO_SHEET_NAME in wb.sheetnames:
        return DEMO_SHEET_NAME
    for name in wb.sheetnames:
        if name.startswith(DEMO_SHEET_PREFIX):
            return name
    for name in wb.sheetnames:
        if name.startswith("P") and "-" in name:
            return name
    raise SystemExit("工作簿里找不到矩阵 sheet")


def read_sheet(ws) -> dict:
    ncols = len(MATRIX_COLS)
    rows = [
        [ws.cell(r, c).value for c in range(1, ncols + 1)]
        for r in range(1, ws.max_row + 1)
    ]
    first_header = MATRIX_COLS[0].header
    try:
        hdr_i = next(i for i, r in enumerate(rows) if str(r[0] or "").strip() == first_header)
    except StopIteration:
        raise SystemExit(f"{ws.title} 里找不到列头行（首列应为「{first_header}」）")
    return {
        "hint": rows[0][0],
        "head_area": rows[1:hdr_i],
        "col_head": rows[hdr_i],
        "data": rows[hdr_i + 1 :],
    }


# ── 渲染 ───────────────────────────────────────────────────

def render_head_area(rows: list) -> str:
    """只读表头区 —— 单独一块两列表。

    ⚠️ 为什么不并进主表：主表第一列只有 8% 宽（照 Excel 的 A 列 = 10 字符），
    「与条件文字的出入（只读）」这种标签会被裁掉。Excel 里也是裁的，
    但示意图是拿来**教人看**的，标签必须读得全，所以拆开排。
    """
    out: list[str] = ['<table class="mx-head">']
    for row in rows:
        label = str(row[0] or "").strip()
        if not label:
            continue
        out.append(f"<tr><th>{esc(label)}</th><td>{br(row[1])}</td></tr>")
    out.append("</table>")
    return "\n".join(out)


def render_table(data: dict) -> str:
    out: list[str] = []

    # 列宽按工作簿真源（Excel 字符宽）换算成百分比
    total = sum(c.width for c in MATRIX_COLS)
    out.append("<colgroup>")
    for c in MATRIX_COLS:
        out.append(f'<col style="width:{c.width / total * 100:.4f}%">')
    out.append("</colgroup>")

    # 列头
    heads = "".join(f"<th>{esc(h)}</th>" for h in data["col_head"])
    out.append(f'<tr class="mx-cols">{heads}</tr>')

    # 9 行数据：部位列合并（遇到非空部位就是一组，组内行数 = rowspan）
    # ⚠️ **每一行都要出一条 <tr>** —— 部位格用 rowspan 跨行，不是因为它吃掉了几行。
    #    早先写成「遇非空部位就跳过整组」，结果只出了 3 行（浮），中／沉 两行没了。
    rows = data["data"]
    spans: dict[int, int] = {}
    i = 0
    while i < len(rows):
        if str(rows[i][0] or "").strip():
            span = 1
            j = i + 1
            while j < len(rows) and not str(rows[j][0] or "").strip():
                span += 1
                j += 1
            spans[i] = span
            i = j
        else:
            i += 1

    for i, row in enumerate(rows):
        cells: list[str] = []
        if i in spans:
            cells.append(
                f'<th class="mx-part" rowspan="{spans[i]}">{esc(str(row[0]).strip())}</th>'
            )
        cells += render_data_cells(row)
        out.append(f'<tr>{"".join(cells)}</tr>')

    return "\n".join(out)


def render_data_cells(row: list) -> list[str]:
    cells: list[str] = []
    for col, spec in zip(row[1:], MATRIX_COLS[1:]):
        role = ROLE.get(spec.key, "plain")
        value = "" if col is None else str(col).strip()
        if role == "chip" and value:
            cells.append(f'<td><span class="mx-chip">{esc(value)}</span></td>')
        elif role == "grp" and value:
            cells.append(f'<td class="mx-grp">{esc(value)}</td>')
        elif role == "depth":
            cells.append(f'<td class="mx-depth">{esc(value)}</td>')
        else:
            cells.append(f"<td>{esc(value)}</td>")
    return cells


def expand_note(key: str, by_header: dict) -> str:
    """「右手」的批注写的是「同「左手」」—— 展开成左手那条，读者才看得到。"""
    spec = next(c for c in MATRIX_COLS if c.key == key)
    note = spec.note or ""
    m = re.fullmatch(r"同「(.+)」", note.strip())
    if m:
        ref = by_header.get(m.group(1))
        return ref.note if ref else note
    return note


def render_legend() -> str:
    by_header = {c.header: c for c in MATRIX_COLS}
    by_key = {c.key: c for c in MATRIX_COLS}
    out: list[str] = []
    for title, keys in LEGEND_GROUPS:
        readonly = all(k in READONLY_KEYS for k in keys)
        badge = (
            '<span class="mx-badge ro">只读</span>'
            if readonly
            else '<span class="mx-badge fill">归你填</span>'
        )
        note = rich(expand_note(keys[0], by_header))
        cols = "／".join(by_key[k].header for k in keys)
        out.append(
            f'<div class="mx-legend-row"><div class="lg-name">{badge}'
            f'<span class="lg-cols">{esc(cols)}</span></div>'
            f'<div class="lg-note">{note}</div></div>'
        )
    return "\n".join(out)


def build_fragment() -> str:
    wb = openpyxl.load_workbook(WORKBOOK, data_only=True)
    name = pick_demo_sheet(wb)
    data = read_sheet(wb[name])
    wb.close()

    hint = rich(data["hint"])
    head_html = render_head_area(data["head_area"])
    table_html = render_table(data)
    # ⭐ 生成即自检：行数、每行列数不对就**拒绝写进页面**
    head_rows = len([r for r in data["head_area"] if str(r[0] or "").strip()])
    verify_head_area(head_html, head_rows)
    verify_table(table_html, len(MATRIX_COLS), 1 + len(data["data"]))

    parts = [
        BEGIN,
        '<div class="matrix-card">',
        f'<div class="mx-hint">{hint}</div>',
        head_html,
        f'<table class="mx">{table_html}</table>',
        "</div>",
        '<div class="mx-legend">',
        render_legend(),
        "</div>",
        END,
    ]
    return "\n".join(parts)


# ── 自检（按结构解析，不全文搜词） ──────────────────────────

class _Tally(HTMLParser):
    """把表格按 DOM 结构摊成「每行的单元格（含 rowspan/colspan）」。"""

    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[tuple[int, int]]] = []
        self.in_table = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table":
            self.in_table = True
        elif tag == "tr" and self.in_table:
            self.rows.append([])
        elif tag in ("td", "th") and self.in_table and self.rows:
            self.rows[-1].append(
                (int(a.get("rowspan", 1)), int(a.get("colspan", 1)))
            )

    def handle_endtag(self, tag):
        if tag == "table":
            self.in_table = False


def grid_widths(rows: list[list[tuple[int, int]]]) -> list[int]:
    """按浏览器的算法把 rowspan/colspan 摊平，返回每一行占了几列。"""
    occupied: set[tuple[int, int]] = set()
    widths: dict[int, int] = {}
    for r, cells in enumerate(rows):
        c = 0
        for rs, cs in cells:
            while (r, c) in occupied:
                c += 1
            for dr in range(rs):
                for dc in range(cs):
                    occupied.add((r + dr, c + dc))
            c += cs
        widths[r] = c
    for r, c in occupied:
        widths[r] = max(widths.get(r, 0), c + 1)
    return [widths.get(r, 0) for r in range(len(rows))]


def verify_table(table_html: str, ncols: int, n_rows: int) -> None:
    """⭐ 生成完必须自己验一遍 —— 早先手绘那版就是「只出了 3 行」才发现的。

    断言：行数对得上；每行摊平后恰好 ncols 列。
    """
    tally = _Tally()
    # render_table 返回的是表**内部**，外面补一层 <table> 才能按 DOM 结构解析
    tally.feed(f"<table>{table_html}</table>")
    rows = tally.rows
    if len(rows) != n_rows:
        raise SystemExit(f"✗ 生成的表有 {len(rows)} 行，应为 {n_rows} 行")
    widths = grid_widths(rows)
    bad = [(i, w) for i, w in enumerate(widths) if w != ncols]
    if bad:
        raise SystemExit(f"✗ 这些行摊平后不是 {ncols} 列：{bad}")


def verify_head_area(head_html: str, n_rows: int) -> None:
    tally = _Tally()
    tally.feed(head_html)
    if len(tally.rows) != n_rows:
        raise SystemExit(f"✗ 只读表头区有 {len(tally.rows)} 行，应为 {n_rows} 行")
    for i, cells in enumerate(tally.rows):
        if len(cells) != 2:
            raise SystemExit(f"✗ 只读表头区第 {i + 1} 行有 {len(cells)} 格，应为 2 格")


# ── 写回页面 ───────────────────────────────────────────────

def apply_to_page(page_text: str, fragment: str) -> str:
    start = page_text.find(BEGIN)
    stop = page_text.find(END)
    if start < 0 or stop < 0 or stop < start:
        raise SystemExit(f"页面里找不到 {BEGIN} / {END} 标记")
    return page_text[:start] + fragment + page_text[stop + len(END) :]


def main() -> int:
    check = "--check" in sys.argv[1:]
    fragment = build_fragment()
    page_text = PAGE.read_text(encoding="utf-8")
    new_text = apply_to_page(page_text, fragment)

    if check:
        if new_text != page_text:
            print(f"✗ {PAGE.name} 与工作簿不一致 —— 跑 npm run content:flowchart 同步")
            return 1
        print(f"✓ {PAGE.name} 与工作簿一致")
        return 0

    PAGE.write_text(new_text, encoding="utf-8")
    print(f"✓ 已写入 {PAGE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
