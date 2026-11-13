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
 * - **名称里含查询词**（该资料的方名里含这个名字，如「上焦方」↔「1号上焦方／2号上焦方／3号上焦方」）
 *   → 列出全部候选，标明「同名不同号」，**不替读者选**；
 *   但**组合方**（名字带「+」）与「查询词是候选方的一味药」（「黄芪」之于「黄芪鳖甲」）不算候选。
 * 两者都没有 → 明说「未载」，不拿名字相近的方顶替。
 *
 * 另有一条**有明确对照依据**的路：讲义 p42 的方名 ↔ 同和堂版方名
 * （讲义「六味地黄丸」↔ 同和堂版「六味桂」），对照登记在 `medication.ts` 的
 * `FORMULA_REFERENCE`（每行带 `doseId` 与 `doseBasis`）。讲义方名先查这张表，
 * 才查得到它的克数 —— 不靠「名字相近」去猜。
 */

import { DRUGS, type Drug } from './drugs'
import {
  DOSE_SCIENCE_NAME,
  FORMULA_DOSE_BY_ID,
  FORMULA_DOSES,
  FORMULA_SCIENCE_BY_NAME,
  type FormulaDose,
} from './formula-table'
import { FORMULA_ALIAS, FORMULA_REFERENCE, type FormulaReference } from './medication'
import { getLibraryState } from './library-store'

/** 一条组成（来自某一套资料） */
export interface DoseEntry {
  /** 该资料里的方名（原文用字） */
  name: string
  /**
   * 这一条属于哪套资料 —— 决定「管理员点编辑」时打开哪一类的编辑弹层。
   *
   * · `dose` ＝ 同和堂版成方（克）
   * · `drug` ＝ 讲稿 2010·第二讲方剂（比例制）
   *
   * ⓘ 以前这个结构里不带 id，DoseLines 只能纯展示；要让它可编辑，
   *   就得知道**具体是哪一条** —— 名字可能重复、可能没被查到（未载）。
   */
  kind?: 'dose' | 'drug'
  /** 对应条目的 id（覆盖层按 `(kind, id)` 定位） */
  id?: string
  /** 组成与剂量（原文照录） */
  composition?: string
  /** 科中／科学中药比例 */
  science?: string
  /** 服法（讲稿 2010 才有） */
  usage?: string
  /** 出处标注 */
  source: string
  /** 对照依据（讲义 p42 方名 ↔ 该资料方名时，写明凭什么对上） */
  basis?: string
  /** 这一条在查表结果里的身份：主方 ／ 母方（讲稿原文明写母方关系才有） */
  role?: 'main' | 'parent'
}

/** 一次查找的结果 */
export interface DoseLookup {
  /** 完全同名（或其他明确对照）的一条 */
  exact?: DoseEntry
  /** 同名不同号的候选（该资料方名里含这个名字） */
  candidates: DoseEntry[]
  /** 与主方同列的**母方**成方（讲稿原文明写母方关系时才会有） */
  related?: DoseEntry[]
  /** 命中方式：完全同名 ／ 别名对照 ／ 同名不同号 */
  via?: 'exact' | 'alias'
}

/* ------------------------------------------------------------------ */
/* 同和堂版《臧氏脉学方剂汇总统表》—— 成方（药味＋克）                  */
/* ------------------------------------------------------------------ */

/**
 * **当前生效的**同和堂版成方。
 *
 * ⓘ 管理员在「剂量对照」那几行点「编辑」改的就是这一份：
 *   改动落服务端覆盖层 → 前端合并进 `doseData` → 这里优先用它。
 *   没有覆盖层（未登录／还没加载）⇒ 回落到静态基线 `FORMULA_DOSES`。
 *
 * ⚠️ 别再直接 `FORMULA_DOSES.find(...)` —— 那样管理员改了也查不到（静默不生效）。
 */
function effectiveDoses(): FormulaDose[] {
  const merged = getLibraryState().doseData
  if (Array.isArray(merged) && merged.length > 0) return merged as FormulaDose[]
  return FORMULA_DOSES
}

/** 按 id 取生效的那一条（对照表 `doseId`／`parentDoseId` 用） —— 同样优先生效集 */
function effectiveDoseById(id: string): FormulaDose | undefined {
  return effectiveDoses().find((d) => d.id === id) ?? FORMULA_DOSE_BY_ID[id]
}

/**
 * **当前生效的**讲稿方剂（比例制那套）。
 *
 * 与 `effectiveDoses()` 同理：管理员改了讲稿方剂，剂量对照里那一行要跟着变。
 */
function effectiveDrugs(): Drug[] {
  const merged = getLibraryState().drugData
  if (Array.isArray(merged) && merged.length > 0) return merged as Drug[]
  return DRUGS
}

function toEntry(d: FormulaDose): DoseEntry {
  const sciName = DOSE_SCIENCE_NAME[d.id]
  const sci = sciName ? FORMULA_SCIENCE_BY_NAME[sciName] : undefined
  return {
    kind: 'dose',
    id: d.id,
    name: d.name,
    composition: d.composition,
    science: sci?.ratio,
    source: `《臧氏脉学方剂汇总统表（同和堂版）》· 第 ${d.page} 页 · 单位：克`,
  }
}

/**
 * 两条排除规则 —— 用来把「只是碰巧名字里有这几个字」的方剔掉。
 *
 * 依脉用方的条目里，方名与加减药名是混在一起的（「天王补心丹／防风／黄芪／干姜」），
 * 若按「名字里含查询词」硬找，「黄芪」会撞上「黄芪鳖甲」、「参苏」会撞上「双关+参苏」。
 * 那不是同一个方，不能拿它顶替，故排除：
 *
 * 1. **组合方不作候选** —— 名字里带「+」的（「双关+参苏」「天王补心+芪」）是**另一个方**，
 *    与单方不是一回事。
 * 2. **单味药不作候选** —— 查询词恰是候选方**组成里的一味药**（「黄芪」之于「黄芪鳖甲」），
 *    说明查的是一味药，不是一个方名。整词相等才算，不做前缀匹配
 *    （「知柏」之于「知柏六味桂」不是一味药，前缀匹配会误杀）。
 */

/** 取一条组成里的药味（去掉注文、数字与单位） */
function herbsOf(composition?: string): string[] {
  if (!composition) return []
  return composition
    .replace(/[（(][^）)]*[）)]/g, ' ')
    .split(/[\s　、,，]+/)
    .map((t) =>
      t
        .replace(/[0-9].*$/, '')
        .replace(/(?:克|ｇ|g|片|个|分|枚|两|钱|克$)/g, '')
        .trim(),
    )
    .filter(Boolean)
}

/** 查询词是不是该候选组成里的一味药（整词相等才算） */
function isHerbInComposition(query: string, composition?: string): boolean {
  return herbsOf(composition).includes(query)
}

/** 该候选要不要剔掉（组合方／查询词是它的一味药） */
function isNotAFormulaName(query: string, name: string, composition?: string): boolean {
  if (name.includes('+')) return true
  return isHerbInComposition(query, composition)
}

/**
 * 两套资料里出现过的**药味**（不是方名）。
 *
 * 用来判断「查的是一个方名，还是一味药」：「黄芪」「干姜」「麦冬」这些是药味，
 * 两套资料里都没有以它们为名的方，查它们就该明说「未载」，而不是拿
 * 「黄芪鳖甲」这类名字里带这个药味的方去顶替。
 */
const HERB_NAMES: Set<string> = (() => {
  const formulaNames = new Set([...effectiveDoses().map((d) => d.name), ...effectiveDrugs().map((d) => d.name)])
  const set = new Set<string>()
  for (const d of [...effectiveDoses(), ...effectiveDrugs()]) {
    for (const h of herbsOf(d.composition)) {
      // 「六味桂」「知柏六味桂」这类是方名（别的方引它），不是药味
      if (formulaNames.has(h)) continue
      set.add(h)
    }
  }
  return set
})()

/** 查询词是不是一味药 */
function isHerbName(query: string): boolean {
  return HERB_NAMES.has(query)
}

/**
 * 方名后面挂的括号或「＋…」是**原文的说明／加法写法**，不是方名的一部分
 * （讲义 p44 写「天王芪（天王补心丹 + 黄芪）」，指的是「天王芪」；
 * 　讲稿写「六神散 + 陈皮 + 黄芪」，指的是「六神散」）。
 * 查不到时去掉后半截再查一次，并写明是按前段查到的。
 */
function stripTrailingNote(name: string): { q: string; note?: string } | null {
  const m = name.match(/^(.+?)[（(][^）)]*[）)]\s*$/)
  if (m) {
    const q = m[1].trim()
    if (!q) return null
    return { q, note: `方名括号里的说明（「${name.slice(m[1].length)}」）不算方名，按前段「${q}」查到` }
  }
  const p = name.match(/^(.+?)\s*[+＋]\s*.+$/)
  if (p) {
    const q = p[1].trim()
    if (!q) return null
    return { q, note: `方名后面的加法写法不算方名，按前段「${q}」查到` }
  }
  return null
}

/** 按方名查同和堂版成方（单位：克） */
export function lookupThDose(name: string): DoseLookup {
  const q = name.trim()
  if (!q) return { candidates: [] }
  const hit = lookupThByName(q)
  if (hit.exact || hit.candidates.length > 0) return hit
  // 方名后面挂的括号或「＋…」是原文的说明，去掉再查一次
  // （只认「完全同名／有据对照」那一种命中，含名撞上的不算）
  const alt = stripTrailingNote(q)
  if (!alt) return hit
  const hit2 = lookupThByName(alt.q)
  if (!hit2.exact) return hit
  return {
    exact: { ...hit2.exact, basis: [hit2.exact.basis, alt.note].filter(Boolean).join('　') },
    candidates: [],
    related: hit2.related,
    via: hit2.via,
  }
}

/** 同和堂版：按方名查（不含「去掉括号说明」那一层） */
function lookupThByName(q: string): DoseLookup {
  // 1. 讲义 p42 的显式对照（有依据）：讲义方名 → 同和堂版方名
  //    这一行还可能带一个**母方**成方（讲稿原文明写母方关系时才登记）
  const ref = lookupByReference(q)
  if (ref) return { exact: ref.exact, candidates: [], related: ref.related, via: ref.via }
  // 2. 完全同名
  const exact = effectiveDoses().find((d) => d.name === q)
  if (exact) return { exact: toEntry(exact), candidates: [], via: 'exact' }
  // 3. 查的是一味药（黄芪、干姜、麦冬…）→ 两套资料都没有以它为名的方，明说未载
  if (isHerbName(q)) return { candidates: [] }
  // 4. 同名不同号：列出全部候选，工具不替读者选（组合方与「查询词是药味」的剔掉）
  const cands = effectiveDoses().filter(
    (d) => d.name.includes(q) && !isNotAFormulaName(q, d.name, d.composition),
  ).map(toEntry)
  // 5. 讲义 p42 的方名里含查询词 → 按那一行的对照找同和堂版（每条都带对照依据）
  for (const row of FORMULA_REFERENCE) {
    if (!row.doseId || !row.name.includes(q)) continue
    const d = effectiveDoseById(row.doseId)
    if (!d || isNotAFormulaName(q, d.name, d.composition)) continue
    if (cands.some((c) => c.name === d.name)) continue
    cands.push({
      ...toEntry(d),
      basis: `讲义 p42 第 ${row.no} 行 · ${row.doseBasis}`,
    })
  }
  return { candidates: cands }
}

/**
 * 讲义 p42 的方名 → 同和堂版成方。
 *
 * 两套资料的方名常常不同，讲义 p42 用的是「六味地黄丸」「补中益气汤」这类通用名，
 * 同和堂版写的是「六味桂」「双关同治（补中益气）」。这类**有明确对照依据**的关系
 * 登记在 `medication.ts` 的 `FORMULA_REFERENCE` 里（每行带 `doseId` 与 `doseBasis`），
 * 查表时先认这张对照表 —— 讲义方名才能查到它的克数，不必靠「名字相近」去猜。
 *
 * 同名的行（讲义 p42 ↔ 同和堂版用同一个名）不在这里处理：那种情况走「完全同名」那条路，
 * 不必标「别名对照」。
 */
function lookupByReference(
  name: string,
): { exact: DoseEntry; related: DoseEntry[]; via: 'exact' | 'alias' } | undefined {
  const row = FORMULA_REFERENCE.find((r) => r.name === name && r.doseId)
  if (!row?.doseId) return undefined
  const d = effectiveDoseById(row.doseId)
  if (!d) return undefined
  const basis = `讲义 p42 第 ${row.no} 行 · ${row.doseBasis}`
  const related = parentEntry(row, basis)
  if (d.name === row.name) {
    // 同名同方 —— 不必标「别名对照」，但母方照样要带出来
    return { exact: toEntry(d), related, via: 'exact' }
  }
  return { exact: { ...toEntry(d), basis }, related, via: 'alias' }
}

/**
 * 母方成方 —— **讲稿原文明写母方关系**时才登记在 `parentDoseId` 里。
 *
 * 例：讲义 p42 第 10 行「加味理中」的母方是「理中汤」
 * （讲稿 2010·第二讲：「原先我们是以理中汤为母方……（注：即本门加味理中）」）。
 * 没有登记的就不给 —— 不凭名字相近自己认个母方。
 */
function parentEntry(row: FormulaReference, basis: string): DoseEntry[] {
  if (!row.parentDoseId) return []
  const p = effectiveDoseById(row.parentDoseId)
  if (!p) return []
  return [{ ...toEntry(p), role: 'parent', basis: `母方 · ${basis}` }]
}

/* ------------------------------------------------------------------ */
/* 讲稿 2010·第二讲 —— 组成用比例制                                     */
/* ------------------------------------------------------------------ */

function toDraftEntry(d: Drug): DoseEntry {
  return {
    kind: 'drug',
    id: d.id,
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
 * 2. `FORMULA_ALIAS` 里**有依据的对照**（如讲义「天王芪」↔ 讲稿
 *    「左寸浮大 · 脉数（天王补心丹加芪）」、讲义「加味理中」↔ 讲稿
 *    「右关虚脏 · 软而无力（加味理中）」）→ 标明「别名对照」；
 *    **这一条走在前面**：讲稿里同名的方不止一张（「加味理中」还有三焦疗法的
 *    「中焦方（加味理中）」），对照表指了哪一张就用哪一张，别又查回另一张；
 * 3. 讲稿的写法是「名（括号）」而括号里的正是它（如「天王补心丹加芪」）
 *    或方名里含它（如「上焦方」↔「一号上焦方／二号上焦方／三号上焦方」）
 *    → 列出**全部**候选，标明「同名不同号」，工具不替读者选；
 * 4. 仍没有 → 明说「未载」，不拿名字相近的方顶替。
 */
export function lookupDraftDrug(name: string): DoseLookup {
  const q = name.trim()
  if (!q) return { candidates: [] }

  const hit = lookupDraftByName(q)
  if (hit.exact || hit.candidates.length > 0) return hit
  // 方名后面挂的括号或「＋…」是原文的说明，去掉再查一次
  // （只认「完全同名／有据对照」那一种命中，含名撞上的不算）
  const alt = stripTrailingNote(q)
  if (!alt) return hit
  const hit2 = lookupDraftByName(alt.q)
  if (!hit2.exact) return hit
  return {
    exact: { ...hit2.exact, basis: [hit2.exact.basis, alt.note].filter(Boolean).join('　') },
    candidates: [],
    via: hit2.via,
  }
}

/** 讲稿 2010：按方名查（不含「去掉括号说明」那一层） */
function lookupDraftByName(q: string): DoseLookup {
  // 1. 完全同名
  const same = effectiveDrugs().find((d) => d.name === q)
  if (same) return { exact: toDraftEntry(same), candidates: [], via: 'exact' }

  // 2. 有依据的对照先走（见上）
  const alias = FORMULA_ALIAS[q]
  if (alias) {
    const hit = effectiveDrugs().find((d) => d.name === alias)
    if (hit) {
      return {
        exact: { ...toDraftEntry(hit), basis: `讲义 p42 方名「${q}」↔ 讲稿 2010「${hit.name}」（对照表有依据）` },
        candidates: [],
        via: 'alias',
      }
    }
  }

  // 3. 查的是一味药（黄芪、干姜、麦冬…）→ 讲稿里也没有以它为名的方，明说未载
  if (isHerbName(q)) return { candidates: [] }

  // 4. 讲稿的条目名按脉位写，如「右关虚脏 · 软而无力（加味理中）」
  //    —— 括号里的方名或括号前那段就是查的那个名，算**对上**（不是「名字里含」）
  const strong = effectiveDrugs().filter((d) => {
    const m = d.name.match(/^([^（]*)[（](.+)[）]$/)
    if (!m) return false
    const hit = m[1].trim() === q || m[2].trim() === q
    return hit && !isNotAFormulaName(q, d.name, d.composition)
  })
  if (strong.length > 0) {
    return {
      exact: {
        ...toDraftEntry(strong[0]),
        basis: `讲稿 2010 条目名里的方名就是「${q}」〔${strong[0].name}〕`,
      },
      candidates: [],
      via: 'exact',
    }
  }

  // 5. 方名里含它（如「上焦方」↔「一号上焦方／二号上焦方／三号上焦方」）
  //    → 列出全部候选，工具不替读者选
  const cands = effectiveDrugs().filter((d) => {
    const hit = d.name.includes(q)
    return hit && !isNotAFormulaName(q, d.name, d.composition)
  })
  if (cands.length > 0) return { candidates: cands.map(toDraftEntry) }

  // 6. 讲义 p42 的方名里含查询词 → 按对照表找讲稿条目（讲义 p42 方名 ↔ 讲稿条目名）
  const byRef: DoseEntry[] = []
  for (const row of FORMULA_REFERENCE) {
    if (!row.name.includes(q)) continue
    const aliasName = FORMULA_ALIAS[row.name]
    if (!aliasName) continue
    const hit = effectiveDrugs().find((d) => d.name === aliasName)
    if (!hit || byRef.some((c) => c.name === hit.name)) continue
    byRef.push({
      ...toDraftEntry(hit),
      basis: `讲义 p42 第 ${row.no} 行 · 讲稿 2010「${hit.name}」（对照表有依据）`,
    })
  }
  if (byRef.length > 0) return { candidates: byRef }

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
  const related = l.related ?? []
  if (l.exact) return { entries: [l.exact, ...related], matched: l.via ?? 'exact', unit }
  if (l.candidates.length > 0) return { entries: [...l.candidates, ...related], matched: 'contains', unit }
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
