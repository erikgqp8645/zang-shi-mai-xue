import { DRUGS, type Drug } from './drugs'
import GROUP_DATA from '../content/pulse-groups.json'
import REF_DATA from '../content/formula-reference.json'
import {
  DOSE_SCIENCE_NAME,
  FORMULA_DOSE_BY_ID,
  FORMULA_DOSES,
  FORMULA_SCIENCE_BY_NAME,
  type FormulaDose,
  type FormulaScience,
} from './formula-table'
import { LAYOUTS } from './layout'
import { SYMBOL_BY_CODE } from './symbols'
import { HAND_LABEL, cellKey, type Hand, type LayoutMode, type Organ, type Session } from './types'
import type { CustomSymbol } from './symbols'

/**
 * 用药记录 —— 使用者自己填「实际用了什么方、加减、服法」
 *
 * 工具只负责记录，不替使用者加减方、不下诊断；
 * 讲义 p42 的「依脉用方表」只作**原文对照**，供查、供抄，不是处方建议。
 */

/** 一条用药记录（挂在某一次就诊下；一次就诊可挂多条方） */
export interface Medication {
  id: string
  /** 挂在哪一次就诊（＝主表那一列的记录 id） */
  visitId: string
  /** 方名（照讲义／讲稿原名，如「加味理中」「天王芪」） */
  name: string
  /** 对应脉象（**文字**表述，如「右关弱且左关有」） */
  pulse: string
  /**
   * 对应脉象（**符号**表述）—— 与上面的文字并存，两种说法同时记。
   * key 同 Session.values（`手|部位|取法`），值为符号代码数组（如 ['++']）。
   */
  symbols: Record<string, string[]>
  /** 加减 */
  adjust: string
  /** 服法 */
  usage: string
  /** 备注 */
  note: string
}

/**
 * 一次就诊里录到的某个脉点（带讲义 p33 的符号文字）。
 * 例：右关 沉 录的是 `++`，文字即「++ 有力」。
 */
export interface PulsePoint {
  /** `${hand}|${organ}|${depth}` */
  key: string
  hand: Hand
  organ: Organ
  depth: '浮' | '中' | '沉'
  codes: string[]
  /** 符号的文字说明（如「++ 有力」「| 弦」） */
  text: string
}

/** 脉位筛选用的分组（左列「全部」＋各脉位） */
export const PULSE_POSITIONS: { key: string; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'L|寸', label: '左寸' },
  { key: 'R|寸', label: '右寸' },
  { key: 'L|关', label: '左关' },
  { key: 'R|关', label: '右关' },
  { key: 'L|尺', label: '左尺' },
  { key: 'R|尺', label: '右尺' },
]

/**
 * 该次就诊录到的脉点（只列录了符号的），按 左寸→右尺 顺序。
 * 脉位筛选用 `${hand}|${organ}` 前缀。
 */
export function pulsePointsOf(session: Session, layout: LayoutMode): PulsePoint[] {
  const out: PulsePoint[] = []
  for (const hand of ['L', 'R'] as Hand[]) {
    for (const row of LAYOUTS[layout]) {
      const codes = session.values[cellKey(hand, row.organ, row.depth)] ?? []
      if (codes.length === 0) continue
      out.push({
        key: cellKey(hand, row.organ, row.depth),
        hand,
        organ: row.organ,
        depth: row.depth,
        codes,
        text: '',
      })
    }
  }
  return out
}

/** 符号代码 → 讲义 p33 的文字说明（如 ['++','|'] → 「++ 有力、| 弦」） */
export function describeCodes(codes: string[], customSymbols: CustomSymbol[] = []): string {
  return codes
    .map((code) => {
      const builtin = SYMBOL_BY_CODE[code]
      if (builtin) return `${code} ${builtin.label}`
      const custom = customSymbols.find((c) => c.code === code)
      return custom ? `${code} ${custom.name}` : code
    })
    .join('、')
}

/** 只取文字说明（不带符号本身）：如 ['++','|'] → 「有力、弦」 */
export function codeLabels(codes: string[], customSymbols: CustomSymbol[] = []): string {
  return codes
    .map((code) => {
      const builtin = SYMBOL_BY_CODE[code]
      if (builtin) return builtin.label
      const custom = customSymbols.find((c) => c.code === code)
      return custom ? custom.name : code
    })
    .join('、')
}

/** 脉位文字（如「右关」「左寸沉」） */
export function pulsePointLabel(p: PulsePoint): string {
  return `${HAND_LABEL[p.hand]}${p.organ} ${p.depth}`
}

/** 脉位顺序（左寸→右尺） */
export const POSITION_ORDER = ['L|寸', 'R|寸', 'L|关', 'R|关', 'L|尺', 'R|尺']

/** 脉点顺序：先按脉位，再按浮→中→沉 */
export function pointOrder(key: string): number {
  const [hand, organ, depth] = key.split('|')
  const p = POSITION_ORDER.indexOf(`${hand}|${organ}`)
  const d = ['浮', '中', '沉'].indexOf(depth)
  return (p < 0 ? 99 : p) * 10 + (d < 0 ? 9 : d)
}

/**
 * 脉位组合 —— 跨脉位的一组脉象（「同治」类治法）。
 *
 * **名称与成员一律取原文，不自造**：
 * - 讲义 2026-10·p44「依脉用方」图把六道「挡路」标成
 *   （一）右关、（二）肝肺同治、（三）左寸、（四）尺、（五）双关同治、（六）肝心同治；
 * - 讲稿 2010·第四讲写明「肝肺同治，也就是左关跟右寸」「双关同治是两个关都有出现浮大」
 *   「左手寸关浮大的时候，用肝心同治」；
 * - 讲稿 2010·第二讲另有「双寸」「双尺」的写法；
 * - 讲义 2026-10·p42 另有「双关右寸」（黄芪鳖甲）、「右关尺」（木香顺气）。
 *
 * 这里只是把**原文写明的部位**整理成可点的组合，方便一次选多个脉位；
 * 不是诊断，也不替使用者选方。
 */
export interface PulseGroup {
  id: string
  /** 组合名（原文用字） */
  name: string
  /** 成员脉位（`手|部位`） */
  positions: string[]
  /**
   * 联动到左列（讲义 p42 处方表）的**原文检索词** ——
   * 右列点这一组时，左列的搜索框自动填这个词，两列看同一件事。
   * 取原文用字，不自造（如「双关同治」→ 双关、「肝肺同治」→ 左关右寸）。
   */
  ref: string
  /** 出处（讲次／页码） */
  source: string
}

export const PULSE_GROUPS: PulseGroup[] = GROUP_DATA.groups as PulseGroup[]

/** 脉位文字（如「左关＋右寸」） */
export function groupPositionsLabel(g: PulseGroup): string {
  return g.positions.map((p) => `${HAND_LABEL[p.split('|')[0] as Hand]}${p.split('|')[1]}`).join('＋')
}

/**
 * 脉位 key（`手|部位`）→ 文字（如「右关」）。
 *
 * 右列选了哪个脉位，左列（讲义 p42 处方表）就用同一个词去筛 ——
 * 两列看同一件事。空 key ＝「全部」＝不筛。
 */
export function positionLabel(key: string): string {
  if (!key) return ''
  return PULSE_POSITIONS.find((p) => p.key === key)?.label ?? ''
}

/** 找出与所选脉位**完全一致**的组合（多选后自动带出组合名用） */
export function matchGroup(positions: string[]): PulseGroup | undefined {
  const set = new Set(positions)
  if (set.size === 0) return undefined
  const hits = PULSE_GROUPS.filter((g) => {
    if (g.positions.length !== set.size) return false
    return g.positions.every((p) => set.has(p))
  })
  // 同尺寸时取成员多的（更具体）
  return hits.sort((a, b) => b.positions.length - a.positions.length)[0]
}

/** 已选符号覆盖了哪些脉位（`手|部位`） */
export function positionsOf(symbols: Record<string, string[]>): string[] {
  return [
    ...new Set(
      Object.keys(symbols ?? {})
        .filter((k) => (symbols[k] ?? []).length > 0)
        .map((k) => k.split('|').slice(0, 2).join('|')),
    ),
  ]
}

/**
 * 从「对应脉象」文字里认出**主组合**（文字形如「肝肺同治（左关 …；右寸 …）」）。
 *
 * 组合之间成员互相重叠（右关同属双关同治／双关右寸／右关尺），
 * 所以「哪一组」要由使用者点的那一组说了算 —— 文字前缀就是记下来的那一条。
 */
export function groupOfText(text: string): PulseGroup | undefined {
  const m = (text ?? '').trim().match(/^([^（(]{1,12})[（(]/)
  if (!m) return undefined
  return PULSE_GROUPS.find((g) => g.name === m[1])
}

/**
 * 按所选符号生成「对应脉象」文字 —— 供右列选完**自动填进左格**。
 *
 * 文字形如「肝肺同治（左关 沉 ++ 有力；右寸 浮 + 有）」：
 * 组合名（使用者点选的那一组 `groupName`；没点就按脉位精确匹配推一个）
 * ＋ 各脉点的符号与讲义 p33 的文字。
 * 这只是把使用者自己选的东西照实写出来，不是判读、不是诊断。
 */
export function buildPulseText(
  symbols: Record<string, string[]>,
  customSymbols: CustomSymbol[] = [],
  groupName?: string,
): string {
  const keys = Object.keys(symbols ?? {})
    .filter((k) => (symbols[k] ?? []).length > 0)
    .sort((a, b) => pointOrder(a) - pointOrder(b))
  if (keys.length === 0) return ''
  const items = keys.map((k) => {
    const [hand, organ, depth] = k.split('|')
    return {
      pos: `${hand}|${organ}`,
      label: `${HAND_LABEL[hand as Hand]}${organ} ${depth}`,
      text: describeCodes(symbols[k], customSymbols),
    }
  })
  const group = groupName ?? matchGroup([...new Set(items.map((i) => i.pos))])?.name
  const detail = items.map((i) => `${i.label} ${i.text}`).join('；')
  return group ? `${group}（${detail}）` : detail
}

/** 讲义 p42「依脉用方表」的一行 */
export interface FormulaReference {
  /** 原表序号 */
  no: number
  /** 处方名（讲义原名） */
  name: string
  /** 对应脉象及加减（原文照录，不改写、不简化） */
  indication: string
  /**
   * 同和堂版《臧氏脉学方剂汇总统表》里的对应条目 id。
   *
   * 只在**明确的同方对照**时填写；本表没有该方就留空，
   * 不拿名字相近的方顶替。
   */
  doseId?: string
  /** 同方对照的依据／差异说明（写清楚两套资料哪里不同） */
  doseBasis?: string
  /** 讲稿 2010·第二讲里对应的方剂条目名（比例制来源） */
  draftName?: string
  /** 讲稿侧查不到时的说明（讲稿未载／无同名方条） */
  draftNote?: string
}

/**
 * 讲义 2026-10·p42「臧氏脉学处方 ｜ 对应脉象及加减」原表 28 行 —— 逐行照录。
 *
 * 讲义 p12 把这张表列为核心工具③「依脉用方表」。
 * 原表只有「处方 ｜ 对应脉象及加减」两列，**没有组成与剂量**，
 * 这一点已逐页核过讲义 PDF p42（物理页码）。
 *
 * 三条资料线在这张表上的分工：
 * - 讲义 2026-10·p42 —— **方 ↔ 脉象**（本表「处方」「对应脉象及加减」两列）
 * - 讲稿 2010·第二讲 —— **方 ↔ 组成（比例制）＋ 服法／禁忌**
 * - 《方剂汇总统表（同和堂版）》 —— **方 ↔ 成方（药味＋克数）**
 *
 * 方名沿用各资料原样（「天王芪」「理中术姜芪」「六味桂」等），不改写成现代教材方名；
 * 某套资料没有的，一律留空并写明「未载」，不臆造。
 */
export const FORMULA_REFERENCE: FormulaReference[] = REF_DATA.rows as FormulaReference[]

/**
 * 讲稿 2010 里写明了组成、但**不在第二讲**的方 —— 单列，出处标到讲次。
 *
 * 第二讲是讲稿唯一系统给出「方 ↔ 组成／服法／加减／禁忌」的地方；
 * 这条是讲稿第五讲顺带写下的方，组成只给药味简称、没有剂量，照录不改。
 */
export const DRAFT_EXTRA: Record<string, { name: string; composition: string; source: string; note?: string }> = REF_DATA.draftExtra

/**
 * 一行方剂的「配伍与剂量」视图 —— 把三套资料的对应内容并到一起。
 *
 * - `dose` ＝ 同和堂版《方剂汇总统表》的成方（药味＋**克**）
 * - `drug` ＝ 讲稿 2010 的方剂条目（组成用**比例制**，另带服法／加减／禁忌）
 * 两套剂量单位不同，**不可互相换算**，界面上分栏标注出处。
 */
export interface FormulaDoseView {
  /** 同和堂版条目（本表没有就空） */
  dose?: FormulaDose
  /** 同和堂版第 4 页「科中」对应行 */
  science?: FormulaScience
  /** 讲稿 2010 的方剂条目（本表没有就空） */
  drug?: Drug
  /** 讲稿第五讲等处的补充条目 */
  draftExtra?: { name: string; composition: string; source: string; note?: string }
  /** 这一行查不到任何组成时给出的说明 */
  missing: string[]
}

/** 取某一行方剂的配伍与剂量（讲义 p42 行 → 同和堂版 / 讲稿） */
export function formulaDoseView(r: FormulaReference): FormulaDoseView {
  const dose = r.doseId ? FORMULA_DOSE_BY_ID[r.doseId] : undefined
  const scienceName = r.doseId ? DOSE_SCIENCE_NAME[r.doseId] : undefined
  const science = scienceName ? FORMULA_SCIENCE_BY_NAME[scienceName] : undefined

  let drug: Drug | undefined
  let draftExtra: FormulaDoseView['draftExtra']
  if (r.draftName?.startsWith('DRAFT-')) {
    draftExtra = DRAFT_EXTRA[r.draftName]
  } else if (r.draftName) {
    drug = DRUGS.find((d) => d.name === r.draftName)
  }

  const missing: string[] = []
  if (!dose && !draftExtra) missing.push('同和堂版《方剂汇总统表》未载其组成')
  if (!drug && !draftExtra) missing.push('讲稿 2010 未载其组成')
  if (r.draftNote) missing.push(r.draftNote)

  return { dose, science, drug, draftExtra, missing }
}


/**
 * 讲义用名 → 讲稿 2010 第二讲「方剂备查」的条目名。
 *
 * 两份资料的用名不一定相同（如讲义作「天王芪」，讲稿作「天王补心丹加芪」），
 * 这里只做**明确的同方对照**，供查组成／服法；讲稿第二讲没有条目的方（如
 * 五味异功散、参苓白术散、大补阴丸）就查不到，界面上明说「讲稿第二讲未载」。
 *
 * 来源页不止 p42 —— 「冷热水」来自讲义 p47「开方三部曲图」
 * （平和体质 → 一体疗法 → 1.清挡路方 2.冷热水），
 * 对应讲稿第二讲「一体疗法（冷热水疗法）·服法为『热的就给他冷水，冷的就给他热水』」。
 */
export const FORMULA_ALIAS: Record<string, string> = REF_DATA.alias

/**
 * 按方名找讲稿 2010 的方剂条目（查组成／服法／禁忌用）。
 * 先按别名表，再按方名本身在括号里的部分匹配。
 */
export function findDrug(name: string): Drug | undefined {
  const q = name.trim()
  if (!q) return undefined
  const alias = FORMULA_ALIAS[q]
  if (alias) {
    const hit = DRUGS.find((d) => d.name === alias)
    if (hit) return hit
  }
  return DRUGS.find((d) => {
    if (d.name === q) return true
    const m = d.name.match(/^[^（]*（(.+)）$/)
    const base = m ? m[1] : d.name
    return base === q || d.name.includes(q)
  })
}

/**
 * 按方名找讲稿 2010 里**不在第二讲**的组成条目（如大补阴丸，第五讲）。
 *
 * 与 `findDrug` 分开：这两条的出处讲次不同，服法／禁忌也不在讲稿里。
 */
export function findDraftExtra(name: string): (typeof DRAFT_EXTRA)[string] | undefined {
  const q = name.trim()
  if (!q) return undefined
  for (const [key, val] of Object.entries(DRAFT_EXTRA)) {
    if (key === q || key === `DRAFT-${q}` || val.name.includes(q)) return val
  }
  return undefined
}

/**
 * 按方名找同和堂版《方剂汇总统表》的成方条目（药味＋克数）。
 *
 * 只认**明确同方**：讲义 p42 的方名、同和堂版的原名，以及本文件里登记的异名对照。
 */
export function findFormulaDose(name: string): FormulaDose | undefined {
  const q = name.trim()
  if (!q) return undefined
  const byName = FORMULA_DOSES.find((d) => d.name === q)
  if (byName) return byName
  const hit = FORMULA_REFERENCE.find((r) => r.name === q && r.doseId)
  if (hit?.doseId) return FORMULA_DOSE_BY_ID[hit.doseId]
  return undefined
}

/** 在讲义 p42 的对照表里按关键字找行（方名或对应脉象） */
export function searchFormulaReference(kw: string): FormulaReference[] {
  const k = kw.trim()
  if (!k) return FORMULA_REFERENCE
  return FORMULA_REFERENCE.filter((r) => r.name.includes(k) || r.indication.includes(k))
}
