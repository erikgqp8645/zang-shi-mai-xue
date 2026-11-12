/**
 * 脉象图（条件示意表）—— 数据层
 *
 * ## 这是什么
 *
 * 一张照讲义 p34 体例的**符号表**（部位 × 取法 × 左/右），
 * 标出「讲稿／讲义写明的这一格应该是什么脉象」，
 * 挂在「用方知识库」的每条**用方条目**上，紧贴它所图解的那句条件文字。
 *
 * ⚠️ **它是「条件示意」，不是诊断**：
 *   · 空白格 ＝ **原文未提及**，不作要求；
 *   · 它只标示讲稿／讲义写明的条件，**不下诊断、不替读者加减方**。
 *
 * ## 为什么是「声明式」而不是从 `evaluate` 反推
 *
 * `FORMULA_RULES[].evaluate(ctx)` 的方向是**反的** ——
 * 它拿「使用者已录的脉象」去算「命中哪几条、命中哪几格」。
 * 本文件要的是**正的** —— 给定条目，反推它的脉象图。
 *
 * 两者的关系用**不变量断言**绑死（见 `scripts/e2e/pulse-pattern.mjs`）：
 *   ① `pattern` 的格必须落在 `evaluate` 的触达格集合内；
 *   ② 按 `pattern` 造一个合成 ctx ⇒ `evaluate` 必须命中；
 *   ③ 每个符号都必须**确实**被该条目接受；
 *   ④ 每个 AND 组单独填也要成立（防止把「且」写成「或」）。
 *
 * 任一边改了而另一边没改，断言立刻红 —— 这样「声明」与「判定」不会各说各话。
 *
 * ## 符号集按**原文用字**定，不按力度阈值自动推
 *
 * 讲义 p33 的力度分级：小＝无/弱 ｜ 中＝有/浮有 ｜ 大＝有力、洪大、顶手。
 * 讲义 p34 的主要脉象：无（小）＝`0`/`-`；有（中）＝`+`/`±`；力（大）＝`++`/`±±`/`↑`。
 *
 * ⚠️ 所以「浮大」写的是 `++`/`±±`/`+++`/`++++`，**不含 `↑`** ——
 *    「顶手」是另一个用字、讲稿里点名时才用 `↑`。
 *    这与代码里的 `fuDa`（力度 ≥ 2，含 `↑`）**不完全一致**，
 *    差在哪里由 `pattern.note` 显式写出，不静默取一边。
 */

import type { Depth, Hand, LayoutMode, Organ } from './types'
import { cellKey } from './types'
import { LAYOUTS } from './layout'
import type { RuleContext } from './pulse'
import { SYMBOLS } from './symbols'
import TERM_DATA from '../content/pulse-terms.json'

/* ------------------------------------------------------------------ */
/* 原文用字 → 符号集                                                    */
/* ------------------------------------------------------------------ */

/** 讲义 p34 的固定符号集（全部 code） */
export const ALL_CODES: string[] = SYMBOLS.map((s) => s.code)

/** 一个用字对应的符号集 */
export interface PatternTerm {
  /** 该格**允许**的取值（彼此是「或」关系） */
  codes: string[]
  /**
   * 同一格里**还必须**同时出现的符号（彼此是「或」关系）——
   * 如「变脉且无力」＝`codes` 里取一个变脉符号 ＋ `also` 里取一个无力符号。
   */
  also?: string[]
  /** 图上显示的代表符号 */
  display: string
  /** 这个用字的出处与说明（讲义 p33/p34 的不一致等） */
  note?: string
}

/**
 * 原文用字 → 符号集。
 *
 * **数据在 `src/content/pulse-terms.json`**（内容层快照，可编辑），
 * 这里只做类型收窄 —— 逻辑（判定、合成 ctx）留本文件。
 *
 * ⚠️ `有值` 的 codes 在 JSON 里是**物化后的 14 个符号**（不是 ALL_CODES 的引用）——
 *    JSON 里没有「引用」的概念，值必须写死。
 *
 * **每个集合都必须被对应条目的 `evaluate` 接受**（断言 ③ 会逐个验）。
 * 讲义没明说的一律不加 —— 宁可窄，不可臆造。
 */
export const PATTERN_TERMS: Record<string, PatternTerm> = (() => {
  // ⚠️ 不用 Object.fromEntries —— 那是 ES2019，本项目编译目标是 ES2017，
  //    老机型（微信小程序基础库）上会白屏。core-smoke.mjs 有专门的断言盯着这条。
  const out: Record<string, PatternTerm> = {}
  const raw = TERM_DATA.terms as Record<
    string,
    { codes: string[]; also?: string[]; display: string; note?: string }
  >
  for (const term of Object.keys(raw)) {
    const t = raw[term]
    const item: PatternTerm = { codes: t.codes, display: t.display }
    if (t.also) item.also = t.also
    if (t.note) item.note = t.note
    out[term] = item
  }
  return out
})()

/* ------------------------------------------------------------------ */
/* 类型                                                                */
/* ------------------------------------------------------------------ */

/** 一格的要求：讲稿／讲义写明的这一格应该是什么 */
export interface CellRequirement {
  /** 格键，如 'R|关|浮'（`cellKey(hand, organ, depth)`） */
  cell: string
  /**
   * 原文用字（`PATTERN_TERMS` 的键）。
   *
   * 与 `codes` 二选一：转录自讲稿／讲义的老数据写 `term`；
   * 使用者手填的新数据直接写 `codes`（符号本身就是所见即所得，没有可查的原文用字）。
   */
  term: string
  /**
   * 直接给出的符号（彼此是「或」关系）—— 手填脉象图用。
   *
   * 给了 `codes` 就以它为准，`term` 仅作说明性保留。
   * 老数据没有这个字段，不受影响。
   */
  codes?: string[]
  /** 该格的补充说明（图上小注） */
  note?: string
  /**
   * **柔性格** —— 本格的取值还要配合关系型要求才成立，
   * 所以「单个符号填进去会不会命中」这条断言对它**不适用**。
   *
   * 例：「右关尺浮大顶手」要求**至少有一处**是顶手（↑），
   * 单独把某格换成 `±±` 就不成立了 —— 这不是符号写错，是关系约束。
   */
  flex?: boolean
}

/** 关系型要求 —— 画不成单格，用通栏注记表达 */
export interface PatternRelation {
  /** 关系种类，如 '左右同名取法不同' */
  kind: string
  /** 原文用语 */
  text: string
  /**
   * **满足该关系的一组具体格** —— 断言用它验证「照这个关系去录脉，确实能命中」。
   *
   * 例：「尺脉不平衡」＝ 左尺一个值 ＋ 右尺另一个不同的值。
   */
  probe?: { cell: string; codes: string[] }[]
}

/** 一条用方条目的脉象图 */
export interface PulsePattern {
  /**
   * 图名（如「清挡路」）。
   *
   * 50 条老数据都写了，但类型上一直没声明 —— 这里补上，
   * 免得界面只能拿条件文字当标题。
   */
  title?: string
  /** 格位要求 */
  cells: CellRequirement[]
  /**
   * AND 组：每组内的格必须**同时**满足；**组间是「或」**。
   *
   * 缺省 ＝ 所有格合成一组。
   * 例：「右关浮无、中有力」＝两组（左手一组、右手一组），任一组成立即命中。
   */
  groups?: string[][]
  /** 画不成单格的关系型要求 */
  relations?: PatternRelation[]
  /** 本图覆盖的取法布局（缺省 'nine' —— 9 行版，尺含浮中沉） */
  layout?: LayoutMode
  /** 出处（照抄原话所在处） */
  source: string
  /**
   * 这张图从哪来：
   *   · `text`   —— 转录自讲稿／讲义（内置基线都是这一类）
   *   · `manual` —— 使用者在网页上手动填的
   *
   * 界面上要能分开看：手填的图不是原文，读者不该拿它当「书上这么写」。
   */
  origin?: 'text' | 'manual'
  /**
   * **与 `condition` 文字的出入** —— 显式写出，不静默取一边。
   *
   * 例：讲义 p44 标「右关」，讲稿原文未分左右 —— 本图按讲稿：任一侧。
   */
  note?: string
}

/* ------------------------------------------------------------------ */
/* 解析与构造                                                          */
/* ------------------------------------------------------------------ */

/** 该用字对应的符号集（未知用字返回 null） */
export function termOf(name: string): PatternTerm | null {
  return PATTERN_TERMS[name] ?? null
}

/** 拆格键 */
export function parseCell(cell: string): { hand: Hand; organ: Organ; depth: Depth } | null {
  const m = /^([LR])\|(寸|关|尺)\|(浮|中|沉)$/.exec(cell)
  if (!m) return null
  return { hand: m[1] as Hand, organ: m[2] as Organ, depth: m[3] as Depth }
}

/** 该布局下全部格键（按 部位→取法→左/右 顺序） */
export function allCells(layout: LayoutMode = 'nine'): string[] {
  const out: string[] = []
  for (const row of LAYOUTS[layout]) {
    out.push(cellKey('L', row.organ, row.depth))
    out.push(cellKey('R', row.organ, row.depth))
  }
  return out
}

/** 该布局下的格数（nine ＝ 18，seven ＝ 14） */
export function cellCount(layout: LayoutMode = 'nine'): number {
  return allCells(layout).length
}

/**
 * 合成 ctx：按 `pattern` 把每一格填上它允许的**第一个**符号。
 *
 * 用来验证「按这张图去录脉，确实能命中这条条目」。
 *
 * **关系型的 probe 覆盖在最后** —— 它表达的是「图上画不出来的那个额外约束」，
 * 必须同时成立才算命中，所以它填的值优先。
 */
export function syntheticContext(
  pattern: PulsePattern,
  pick: (term: string) => string[] = defaultPick,
): RuleContext {
  const layout = pattern.layout ?? 'nine'
  const assign: Record<string, string[]> = {}
  for (const c of pattern.cells) {
    const term = termOf(c.term)
    if (!term) continue
    assign[c.cell] = pick(c.term)
  }
  for (const rel of pattern.relations ?? []) {
    for (const p of rel.probe ?? []) assign[p.cell] = p.codes
  }
  return {
    layout,
    get: (hand, organ, depth) => assign[cellKey(hand, organ, depth)] ?? [],
    depths: (organ) => LAYOUTS[layout].filter((r) => r.organ === organ).map((r) => r.depth),
  }
}

/** 默认取法：取该用字的第一个符号（＋ 第一个附带符号） */
export function defaultPick(term: string): string[] {
  const t = termOf(term)
  if (!t) return []
  return t.also && t.also.length ? [t.codes[0], t.also[0]] : [t.codes[0]]
}

/**
 * AND 组：缺省＝所有格合成一组。
 *
 * 返回「格键数组」数组 —— 每组内的格必须同时满足，组间是「或」。
 */
export function andGroups(pattern: PulsePattern): string[][] {
  if (pattern.groups && pattern.groups.length) return pattern.groups
  return [pattern.cells.map((c) => c.cell)]
}

/**
 * 这条 pattern 有没有**关系型要求**（画不成单格的那些）。
 *
 * 关系型条目不画格内符号，只在图下注记 —— 所以它们的图上**不该有 `is-set` 格**。
 */
export function hasRelation(pattern: PulsePattern): boolean {
  return !!pattern.relations && pattern.relations.length > 0
}

/* ------------------------------------------------------------------ */
/* 组说明（组号角标去掉后，组信息改用文字）                             */
/* ------------------------------------------------------------------ */

/** 手别 → 中文（组说明里用） */
const HAND_TEXT: Record<Hand, string> = { L: '左', R: '右' }

/**
 * 格键 → 人话：「L|关|浮」→「左关浮」。
 *
 * 格键写不出来时**原样返回** —— 不猜、不替读者编一个部位。
 */
export function cellLabel(cell: string): string {
  const p = parseCell(cell)
  return p ? `${HAND_TEXT[p.hand]}${p.organ}${p.depth}` : cell
}

/**
 * 组说明文字 —— 如「组 1：左关浮；组 2：右关浮」。
 *
 * ## 为什么用文字，不用格角上标
 *
 * 组号角标是**程序自己加的**，资料原图上没有；而且它跟脉象符号挤在一格里：
 * `0²` 看着像「另一种脉象」，空格中央飘一个 `1` 更莫名其妙
 * （那是因为 `groups` 引用了 `cells` 之外的格，角标没有依附对象）。
 * 去掉角标后组信息挪到这里，读者看的是「**哪几格属于哪一组**」。
 *
 * ## 只列**有要求**的格
 *
 * `groups` 里可能引用到 `cells` 之外的格（导入时漏一格就会这样）。
 * 那种格没有取值要求，列出来是假的 —— 过滤掉。
 *
 * ## 单组（或没有 `groups`）时返回 null
 *
 * 「所有格同时成立」是默认语义，不需要额外说明。
 */
export function groupLegend(pattern: PulsePattern): string | null {
  const groups = pattern.groups
  if (!groups || groups.length <= 1) return null
  const has = new Set(pattern.cells.map((c) => c.cell))
  const lines: string[] = []
  groups.forEach((cells, i) => {
    const labels = cells.filter((k) => has.has(k)).map(cellLabel)
    if (labels.length === 0) return
    lines.push(`组 ${i + 1}：${labels.join('、')}`)
  })
  if (lines.length === 0) return null
  return lines.join('；')
}
