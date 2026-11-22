import DATA from '../content/formulas.json'
import EDGES from '../content/rule-formulas.json'

/**
 * 方剂库快照（`formulas.json`，由 `local-data/formulas.db` 导出）
 *
 * 为什么有这一层：
 * 同一个方在四套资料里有不同写法（讲稿「右关虚脏 · 软而无力（加味理中）」＝
 * 同和堂「五味异功（五异）」＝讲义 p42「五味异功散」），归一的结论只该有一处。
 * 归一在 `formulas` 表里做，前端读这份快照 —— **不要**再在组件里各写一套对照。
 *
 * 边界：本文件只是**只读快照**，改内容仍回 `src/content/*.json`（原始真相）与
 * 管理员覆盖层；改归一关系则改核对表 → 重建库 → 重新导出本文件。
 */
export interface FormulaAlias {
  source: string
  name: string
}

export interface FormulaRow {
  id: string
  /** 规范名 */
  name: string
  /** 基名（去限定括注） */
  baseName: string
  /** 限定（如「五脏疗法」「中焦方」） */
  qualifier: string
  /** 关系：同一方·组成一致 ／ 同方·别名写法 ／ 加减方 ／ 组成差异大（需核） ／ 单套… */
  relation: string
  /** 讲义 p42 行号（只有 28 行有） */
  p42No: number | null
  /** 讲义 p42「对应脉象及加减」 */
  p42Indication: string
  /** 同和堂成方 id（只用于取页码／注，不用于取文字） */
  doseId: string | null
  /** 讲稿 2010 里的条目名（比例制来源） */
  drugName: string
  /** 同和堂版 · 克（原文串） */
  compositionTh: string
  /** 讲稿 2010 · 比例制（原文串） */
  compositionDraft: string
  /** 科中（科学中药）比例（原文串） */
  science: string
  usage: string
  adjustments: string
  contraindications: string
  note: string
  aliases: FormulaAlias[]
  ruleIds: string[]
}

export const FORMULAS = (DATA.formulas as FormulaRow[]).slice()

/** 讲义 p42 原表的 28 行，按行号排序 */
export const P42_FORMULAS = FORMULAS.filter((f) => f.p42No != null).sort(
  (a, b) => (a.p42No as number) - (b.p42No as number),
)

/** 按任意写法找方（规范名 / 别名 / 去括注的基名） */
export function findFormula(name: string): FormulaRow | undefined {
  const q = name.trim()
  if (!q) return undefined
  const exact = FORMULAS.find((f) => f.name === q)
  if (exact) return exact
  const byAlias = FORMULAS.find((f) => f.aliases.some((a) => a.name === q))
  if (byAlias) return byAlias
  return FORMULAS.find((f) => f.baseName === q)
}

/* ------------------------------------------------------------------ */
/* 规则 ↔ 方：多对多（rule_formulas 快照）                              */
/* ------------------------------------------------------------------ */

export interface RuleFormulaEdge {
  ruleId: string
  formulaId: string | null
  /** 原文写法（可能是「加味理中（加中温）」这种带限定的） */
  writing: string
}

const BY_ID = new Map(FORMULAS.map((f) => [f.id, f]))
const WRITING_TO_FORMULA = new Map<string, FormulaRow>()
for (const e of EDGES.edges as RuleFormulaEdge[]) {
  const f = e.formulaId ? BY_ID.get(e.formulaId) : undefined
  if (f && !WRITING_TO_FORMULA.has(e.writing)) WRITING_TO_FORMULA.set(e.writing, f)
}

/** 规则用了哪些方（按原文写法去重；解析不到的给 undefined，写作照样保留） */
export function formulasOfRule(ruleId: string): { formula?: FormulaRow; writing: string }[] {
  return (EDGES.edges as RuleFormulaEdge[])
    .filter((e) => e.ruleId === ruleId)
    .map((e) => ({ writing: e.writing, formula: e.formulaId ? BY_ID.get(e.formulaId) : undefined }))
}

/**
 * 任意写法 → 归一后的方。
 *
 * 先查 rule_formulas 的写法表（覆盖「加味理中（加中温）」这类限定写法），
 * 再退回规范名／别名／基名。
 */
export function resolveFormula(writing: string): FormulaRow | undefined {
  const q = writing.trim()
  if (!q) return undefined
  return WRITING_TO_FORMULA.get(q) ?? findFormula(q)
}

/** 显示用：能归一到某条方就显示规范名，否则原样显示写法 */
export function displayFormulaName(writing: string): string {
  return resolveFormula(writing)?.name ?? writing
}

/** 规则里所有写法 → 规范名（去重，按出现顺序） */
export function canonicalNamesOfRule(ruleId: string): string[] {
  const out: string[] = []
  for (const { writing, formula } of formulasOfRule(ruleId)) {
    const n = formula?.name ?? writing
    if (!out.includes(n)) out.push(n)
  }
  return out
}
