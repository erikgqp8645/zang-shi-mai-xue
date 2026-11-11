/**
 * 用方知识库 · 检索 —— 纯函数，零 DOM
 *
 * ## 为什么放在 domain
 *
 * 网站与小程序各自写界面（见 `docs/taro-migration.md` §0.1），
 * 但「输入什么算命中哪一条」是**规则**，不是版式。放这里，两边共用一份。
 *
 * ## 匹配方式：子串 ＋ 多词 AND
 *
 * 不做分词、不做拼音、不做模糊纠错 —— 中医用字必须精确，
 * 「右寸」被纠成「左寸」比搜不到更糟。
 *
 * ```
 * 五味异功散      → 整串出现在检索文本里
 * 右寸            → 出现在格位标签「右寸浮」里即算
 * 右寸 浮大       → 两个词都要出现（空格分隔）
 * ```
 *
 * 检索文本把**结构化字段展开成中文**：
 * 格键 `'R|寸|浮'` 本身搜不到「右寸」，`cellLabel()` 把它变成「右寸浮」。
 */

import { HAND_LABEL, type Hand } from './types'
import type { Drug } from './drugs'
import type { FormulaRule } from './formulas'
import type { FormulaReference } from './medication'
import type { PulsePattern } from './pulse-pattern'

/* ------------------------------------------------------------------ */
/* 格键 → 中文                                                          */
/* ------------------------------------------------------------------ */

/**
 * 格键 `'R|寸|浮'` → `'右寸浮'`。
 *
 * 不是合法格键（段数不对、手别不认识）时**原样返回** ——
 * 宁可搜不到，也不要拼出一个看似正常的错标签。
 */
export function cellLabel(key: string): string {
  const parts = key.split('|')
  if (parts.length !== 3) return key
  const hand = HAND_LABEL[parts[0] as Hand]
  if (!hand) return key
  return `${hand}${parts[1]}${parts[2]}`
}

/* ------------------------------------------------------------------ */
/* 检索文本                                                             */
/* ------------------------------------------------------------------ */

/**
 * 一张脉象图的可检索文字。
 *
 * 含：图名、出处、每格的**中文格位**与原文用字、关系型要求的原话。
 * 五十条基线里的关系型图（`cells` 为空、`relations` 有）也能被「变脉」「尺脉不平衡」这类词搜到。
 */
export function patternSearchText(pattern: PulsePattern): string {
  const out: string[] = []
  if (pattern.title) out.push(pattern.title)
  if (pattern.source) out.push(pattern.source)
  if (pattern.note) out.push(pattern.note)

  for (const cell of pattern.cells ?? []) {
    out.push(cellLabel(cell.cell))
    if (cell.term) out.push(cell.term)
    if (cell.note) out.push(cell.note)
  }
  for (const rel of pattern.relations ?? []) {
    out.push(rel.kind)
    out.push(rel.text)
  }
  return out.join('\n')
}

/**
 * 一条「依脉用方」规则的可检索文字。
 *
 * `patterns` 由调用方传入**合并结果**（基线 ＋ 覆盖层），
 * 这样网页上手填的脉象图也能被搜到 —— 否则刚填完就搜不到，人会以为没保存。
 */
export function ruleSearchText(rule: FormulaRule, patterns: PulsePattern[] = []): string {
  const out: string[] = [
    rule.id,
    rule.route,
    rule.condition,
    rule.therapy,
    rule.source,
    rule.quote,
  ]
  for (const name of rule.formulas ?? []) out.push(name)
  for (const name of rule.adds ?? []) out.push(name)
  for (const pattern of patterns) out.push(patternSearchText(pattern))
  return out.join('\n')
}

/** 一方（讲稿方剂）的可检索文字 */
export function drugSearchText(drug: Drug): string {
  const out: string[] = [
    drug.id,
    drug.name,
    drug.therapy,
    drug.source,
    drug.quote,
  ]
  if (drug.composition) out.push(drug.composition)
  if (drug.usage) out.push(drug.usage)
  if (drug.science) out.push(drug.science)
  if (drug.indication) out.push(drug.indication)
  if (drug.contraindication) out.push(drug.contraindication)
  for (const adj of drug.adjustments ?? []) out.push(adj)
  return out.join('\n')
}

/**
 * 讲义 p42「依脉用方表」一行的可检索文字。
 *
 * 这张表渲染在「用药记录」里、不在本区块，但它是同一个知识库的另一份转录 ——
 * 搜方名时不该因为「在另一块」就搜不到。
 */
export function refSearchText(ref: FormulaReference): string {
  const out: string[] = [ref.name, ref.indication]
  if (ref.doseBasis) out.push(ref.doseBasis)
  if (ref.draftName) out.push(ref.draftName)
  if (ref.draftNote) out.push(ref.draftNote)
  return out.join('\n')
}

/* ------------------------------------------------------------------ */
/* 查询                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 拆词：全角空格、连续空格都当分隔符；转小写（方名 id 里有拉丁字母）。
 *
 * 空串 → `[]`，调用方据此判断「没在搜」。
 */
export function splitQuery(query: string): string[] {
  const trimmed = query.replace(/\s+/g, ' ').trim()
  if (!trimmed) return []
  return trimmed.toLowerCase().split(' ')
}

/** 每个词都要在文本里出现（AND）；无词恒真 */
export function matchQuery(text: string, terms: string[]): boolean {
  if (terms.length === 0) return true
  const hay = text.toLowerCase()
  for (const term of terms) {
    if (hay.indexOf(term) === -1) return false
  }
  return true
}

/** 一条「条目 ＋ 预建检索文本」 */
export interface SearchEntry<T> {
  item: T
  text: string
}

/** 按查询过滤，保持原顺序 */
export function searchEntries<T>(entries: SearchEntry<T>[], query: string): SearchEntry<T>[] {
  const terms = splitQuery(query)
  if (terms.length === 0) return entries
  return entries.filter((entry) => matchQuery(entry.text, terms))
}

/* ------------------------------------------------------------------ */
/* 索引                                                                 */
/* ------------------------------------------------------------------ */

/** 规则索引 —— `patternsOf` 传合并层读数，手填的图才搜得到 */
export function buildRuleIndex(
  rules: FormulaRule[],
  patternsOf: (rule: FormulaRule) => PulsePattern[],
): SearchEntry<FormulaRule>[] {
  return rules.map((rule) => ({ item: rule, text: ruleSearchText(rule, patternsOf(rule)) }))
}

export function buildDrugIndex(drugs: Drug[]): SearchEntry<Drug>[] {
  return drugs.map((drug) => ({ item: drug, text: drugSearchText(drug) }))
}

export function buildRefIndex(refs: FormulaReference[]): SearchEntry<FormulaReference>[] {
  return refs.map((ref) => ({ item: ref, text: refSearchText(ref) }))
}
