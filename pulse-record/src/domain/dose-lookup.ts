/**
 * 按方名查组成 —— 同和堂版（克）与讲稿 2010（比例制）**分开查、分开标注**。
 *
 * 为什么单独一个模块：
 * - ③开方药清单、用药记录行、方剂备查三处都要「按方名查组成」，
 *   口径必须一致，所以只写这一处。
 * - 两套资料的单位不同（克 ／ 比例制），**不可互相换算、也不合并**。
 *
 * 查得的两档（只认这两种，不猜）：
 * - **完全同名** → 这一条就是它；
 * - **同名不同号**（该资料的方名里含这个名字，如「上焦方」↔「1号上焦方／2号上焦方／3号上焦方」）
 *   → 列出全部候选，标明「同名不同号」，**不替读者选**。
 * 两者都没有 → 明说「未载」，不拿名字相近的方顶替。
 */

import { DRUGS, type Drug } from './drugs'
import {
  DOSE_SCIENCE_NAME,
  FORMULA_DOSES,
  FORMULA_SCIENCE_BY_NAME,
  type FormulaDose,
} from './formula-table'
import { FORMULA_ALIAS } from './medication'

/** 一条组成（来自某一套资料） */
export interface DoseEntry {
  /** 该资料里的方名（原文用字） */
  name: string
  /** 组成与剂量（原文照录） */
  composition?: string
  /** 科中／科学中药比例 */
  science?: string
  /** 服法（讲稿 2010 才有） */
  usage?: string
  /** 出处标注 */
  source: string
}

/** 一次查找的结果 */
export interface DoseLookup {
  /** 完全同名（或其他明确对照）的一条 */
  exact?: DoseEntry
  /** 同名不同号的候选（该资料方名里含这个名字） */
  candidates: DoseEntry[]
  /** 命中方式：完全同名 ／ 别名对照 ／ 同名不同号 */
  via?: 'exact' | 'alias'
}

/** 在一套条目里查：完全同名 → 命中；否则给同名不同号的候选 */
function lookupIn<T extends { name: string }>(
  entries: T[],
  name: string,
  to: (e: T) => DoseEntry,
): DoseLookup {
  const q = name.trim()
  if (!q) return { candidates: [] }
  const exact = entries.find((e) => e.name === q)
  if (exact) return { exact: to(exact), candidates: [], via: 'exact' }
  return { candidates: entries.filter((e) => e.name.includes(q)).map(to) }
}

/* ------------------------------------------------------------------ */
/* 同和堂版《臧氏脉学方剂汇总统表》—— 成方（药味＋克）                  */
/* ------------------------------------------------------------------ */

function toEntry(d: FormulaDose): DoseEntry {
  const sciName = DOSE_SCIENCE_NAME[d.id]
  const sci = sciName ? FORMULA_SCIENCE_BY_NAME[sciName] : undefined
  return {
    name: d.name,
    composition: d.composition,
    science: sci?.ratio,
    source: `《臧氏脉学方剂汇总统表（同和堂版）》· 第 ${d.page} 页 · 单位：克`,
  }
}

/** 按方名查同和堂版成方（单位：克） */
export function lookupThDose(name: string): DoseLookup {
  return lookupIn(FORMULA_DOSES, name, toEntry)
}

/* ------------------------------------------------------------------ */
/* 讲稿 2010·第二讲 —— 组成用比例制                                     */
/* ------------------------------------------------------------------ */

function toDraftEntry(d: Drug): DoseEntry {
  return {
    name: d.name,
    composition: d.composition,
    science: d.science,
    usage: d.usage,
    source: d.source,
  }
}

/**
 * 按方名查讲稿 2010 第二讲的方（组成用比例制）。
 *
 * 口径与 `medication.ts` 的 `findDrug` 一致，顺序：
 * 1. 完全同名 → 就是它；
 * 2. 讲稿的写法是「名（括号）」而括号里的正是它（如「天王补心丹加芪」）
 *    或方名里含它（如「上焦方」↔「一号上焦方／二号上焦方／三号上焦方」）
 *    → 列出**全部**候选，标明「同名不同号」，工具不替读者选；
 * 3. 都没有 → 用 `FORMULA_ALIAS` 里**有依据的对照**兜底（如讲义「天王芪」
 *    ↔ 讲稿「左寸浮大 · 脉数（天王补心丹加芪）」），标明「别名对照」；
 * 4. 仍没有 → 明说「未载」，不拿名字相近的方顶替。
 */
export function lookupDraftDrug(name: string): DoseLookup {
  const q = name.trim()
  if (!q) return { candidates: [] }

  const same = DRUGS.find((d) => d.name === q)
  if (same) return { exact: toDraftEntry(same), candidates: [], via: 'exact' }

  const cands = DRUGS.filter((d) => {
    const m = d.name.match(/^[^（]*（(.+)）$/)
    return (m ? m[1] === q : false) || d.name.includes(q)
  })
  if (cands.length > 0) return { candidates: cands.map(toDraftEntry) }

  const alias = FORMULA_ALIAS[q]
  if (alias) {
    const hit = DRUGS.find((d) => d.name === alias)
    if (hit) return { exact: toDraftEntry(hit), candidates: [], via: 'alias' }
  }

  return { candidates: [] }
}

/* ------------------------------------------------------------------ */
/* 给界面用的一层封装                                                   */
/* ------------------------------------------------------------------ */

/** 一套资料里的查得结果 */
export interface DoseSourceView {
  /** 查到的条目（完全同名一条，或同名不同号的一条／多条候选） */
  entries: DoseEntry[]
  /** 命中方式：完全同名 ／ 别名对照 ／ 同名不同号（该资料方名里含这个名字）／ 未载 */
  matched: 'exact' | 'alias' | 'contains' | 'none'
  /** 该套资料的单位说明 */
  unit: string
}

function toView(l: DoseLookup, unit: string): DoseSourceView {
  if (l.exact) return { entries: [l.exact], matched: l.via ?? 'exact', unit }
  if (l.candidates.length > 0) return { entries: l.candidates, matched: 'contains', unit }
  return { entries: [], matched: 'none', unit }
}

/** 同和堂版（克）这一套的查得结果 */
export function thDoseView(name: string): DoseSourceView {
  return toView(lookupThDose(name), '克')
}

/** 讲稿 2010（比例制）这一套的查得结果 */
export function draftDoseView(name: string): DoseSourceView {
  return toView(lookupDraftDrug(name), '比例制')
}
