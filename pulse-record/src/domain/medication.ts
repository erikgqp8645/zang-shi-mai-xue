import { DRUGS, type Drug } from './drugs'
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

export const PULSE_GROUPS: PulseGroup[] = [
  {
    id: 'g-shuangguan',
    name: '双关同治',
    positions: ['L|关', 'R|关'],
    ref: '双关',
    source:
      '讲稿 2010·第四讲「双关同治是两个关都有出现浮大」；讲稿 2010·第二讲「（三）肝脾（双关）同治」；讲义 2026-10·p44 图「（五）（双关同治）」',
  },
  {
    id: 'g-ganshu',
    name: '肝肺同治',
    positions: ['L|关', 'R|寸'],
    ref: '左关右寸',
    source:
      '讲稿 2010·第四讲「肝肺同治，也就是左关跟右寸」；讲义 2026-10·p44 图「（二）（肝肺同治）」；讲义 2026-10·p42「肝肺同治：左关右寸浮大」',
  },
  {
    id: 'g-ganxin',
    name: '肝心同治',
    positions: ['L|寸', 'L|关'],
    ref: '左寸关',
    source:
      '讲稿 2010·第四讲「第六个是肝心同治。左手寸关浮大的时候，用肝心同治」；讲义 2026-10·p44 图「（六）肝心同治」；讲义 2026-10·p42「肝心同治：左寸关浮大」',
  },
  {
    id: 'g-shuangcun',
    name: '双寸',
    positions: ['L|寸', 'R|寸'],
    ref: '双寸',
    source: '讲稿 2010·第二讲「（四）双寸比较浮大」、「双寸弱的不宜」（用上焦方）',
  },
  {
    id: 'g-shuangchi',
    name: '双尺',
    positions: ['L|尺', 'R|尺'],
    ref: '双尺',
    source: '讲稿 2010·第十四讲「双尺脉影响双关，双关再影响上面来」、「双尺不平衡」',
  },
  {
    id: 'g-shuangguan-youcun',
    name: '双关右寸',
    positions: ['L|关', 'R|关', 'R|寸'],
    ref: '双关右寸',
    source: '讲义 2026-10·p42「黄芪鳖甲：双关右寸浮洪大」；讲义 2026-10·p44 图「⑥双关右寸浮大：黄芪鳖甲」',
  },
  {
    id: 'g-youguanchi',
    name: '右关尺',
    positions: ['R|关', 'R|尺'],
    ref: '右关尺',
    source: '讲义 2026-10·p42「木香顺气：右关尺浮大顶手」；讲稿 2010·第二讲「右关尺浮大（增液汤加减）」',
  },
]

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
export const FORMULA_REFERENCE: FormulaReference[] = [
  {
    no: 1,
    name: '一号上焦方',
    indication: '变脉，六弱脉',
    doseId: 'th-1',
    doseBasis: '同名同方（讲义 p42 第 1 行 ↔ 同和堂版 p1「1号上焦方」）',
    draftName: '一号上焦方',
  },
  {
    no: 2,
    name: '二号上焦方',
    indication: '同上，素食者',
    doseId: 'th-2',
    doseBasis: '同名同方（讲义 p42 第 2 行 ↔ 同和堂版 p1「2号上焦方」）',
    draftName: '二号上焦方',
  },
  {
    no: 3,
    name: '三号上焦方',
    indication: '变脉；左寸弱且右脉有',
    doseId: 'th-3',
    doseBasis: '同名同方（讲义 p42 第 3 行 ↔ 同和堂版 p1「3号上焦方」）',
    draftName: '三号上焦方（二仁茯芪）',
  },
  {
    no: 4,
    name: '五味异功散',
    indication: '右关弱则拉高白术；右关浮大则拉高茯苓',
    doseId: 'th-wuwei',
    doseBasis: '同方异名（讲义作「五味异功散」，同和堂版作「五味异功（五异）」）',
    draftNote: '讲稿 2010 未载「五味异功散」的组成与剂量',
  },
  {
    no: 5,
    name: '参苓白术散',
    indication: '右关弱；治疗慢性腹泻',
    doseId: 'th-shenling',
    doseBasis: '同名同方（讲义 p42 第 5 行 ↔ 同和堂版 p1「参苓白术散」）',
    draftNote: '讲稿 2010 未载「参苓白术散」的组成与剂量',
  },
  {
    no: 6,
    name: '六神散',
    indication: '右关浮软；治疗烧退又烧',
    doseId: 'th-liushen',
    doseBasis: '同名同方（讲义 p42 第 6 行 ↔ 同和堂版 p1「六神散」）',
    draftName: '右关虚脏 · 浮大而软（六神汤）',
  },
  {
    no: 7,
    name: '增液汤',
    indication: '右关浮大',
    doseId: 'th-zengye',
    doseBasis: '同名同方（讲义 p42 第 7 行 ↔ 同和堂版 p1「增液汤」）',
    draftName: '右关尺浮大（增液汤加减）',
  },
  {
    no: 8,
    name: '加味增液汤',
    indication: '右关浮大；加当归郁李仁缓解便秘',
    doseId: 'th-jiawei-zengye',
    doseBasis: '同名同方（讲义 p42 第 8 行 ↔ 同和堂版 p1「加味增液汤」）',
    draftName: '右关尺浮大（增液汤加减）',
  },
  {
    no: 9,
    name: '易简地黄饮子',
    indication: '右三部脉浮洪大',
    doseId: 'th-yijian',
    doseBasis: '同名同方（讲义 p42 第 9 行 ↔ 同和堂版 p1「易简地黄饮子」）',
    draftName: '右脉浮大微弦（易简地黄饮子）',
  },
  {
    no: 10,
    name: '加味理中',
    indication: '右关弱且左关有',
    doseId: 'th-jiawei-lizhong',
    doseBasis:
      '同方异名（讲义作「加味理中」，同和堂版作「加味理中汤」）。注意讲稿另有三焦疗法的「中焦方（加味理中）」，与本条不是同一张方',
    draftName: '右关虚脏 · 软而无力（加味理中）',
  },
  {
    no: 11,
    name: '理中术姜芪',
    indication: '右关微；治疗伤寒感冒',
    doseId: 'th-lizhong-shujiangqi',
    doseBasis: '同名同方（讲义 p42 第 11 行 ↔ 同和堂版 p1「理中术姜芪」）',
    draftNote: '讲稿 2010 未载「理中术姜芪」的组成与剂量',
  },
  {
    no: 12,
    name: '木香顺气',
    indication: '右关尺浮大顶手',
    doseId: 'th-muxiang',
    doseBasis: '同名同方（讲义 p42 第 12 行 ↔ 同和堂版 p1「木香顺气」）',
    draftName: '右关尺浮大顶手（木香顺气）',
  },
  {
    no: 13,
    name: '养心汤',
    indication: '左寸弱迟',
    doseId: 'th-yangxin',
    doseBasis: '同名同方（讲义 p42 第 13 行 ↔ 同和堂版 p1「养心汤」）',
    draftName: '左寸浮大 · 脉迟（养心汤）',
  },
  {
    no: 14,
    name: '天王芪',
    indication: '左寸浮大数',
    doseId: 'th-tianwang',
    doseBasis: '同方异名（讲义作「天王芪」，同和堂版作「天王补心+芪（天王芪）」）',
    draftName: '左寸浮大 · 脉数（天王补心丹加芪）',
  },
  {
    no: 15,
    name: '肝心同治',
    indication: '左寸关浮大',
    doseId: 'th-ganxin',
    doseBasis: '同名同方（讲义 p42 第 15 行 ↔ 同和堂版 p2「肝心同治」）',
    draftName: '肝心同治（逍遥散加芪）',
  },
  {
    no: 16,
    name: '肝肺同治',
    indication: '左关右寸浮大',
    doseId: 'th-ganfei',
    doseBasis:
      '同名同方（讲义 p42 第 16 行 ↔ 同和堂版 p2「肝肺同治」）。讲义 p44「依脉用方」图把它列为（二）肝肺同治，治法名与方名在此合用',
    draftNote:
      '讲稿 2010·第二讲无同名方条（讲稿按脉位写作「左关右寸」两条：浮大带点→黄芪鳖甲／秦艽扶羸；浮洪大→黄芪鳖甲）；讲稿 2010·第四讲有「肝肺同治」这一治法名',
  },
  {
    no: 17,
    name: '黄芪鳖甲',
    indication: '双关右寸浮洪大',
    doseId: 'th-huangqibiejia',
    doseBasis:
      '同名同方（讲义 p42 第 17 行 ↔ 同和堂版 p2「黄芪鳖甲」）。脉位表述两套资料不同：讲义作「双关右寸浮洪大」，讲稿作「左关右寸浮洪大」',
    draftName: '左关右寸 · 浮洪大（黄芪鳖甲）',
  },
  {
    no: 18,
    name: '龙胆泻肝',
    indication: '左关洪或弦',
    doseId: 'th-longdan',
    doseBasis: '同名同方（讲义 p42 第 18 行 ↔ 同和堂版 p2「龙胆泻肝」）',
    draftName: '左关浮洪大（加味龙胆泻肝）',
  },
  {
    no: 19,
    name: '参苏饮',
    indication: '右寸浮洪大',
    doseId: 'th-cansuyin',
    doseBasis: '同名同方（讲义 p42 第 19 行 ↔ 同和堂版 p2「参苏饮」）',
    draftName: '右寸浮大（参苏饮）',
  },
  {
    no: 20,
    name: '六味地黄丸',
    indication: '寸关浮大尺脉弱',
    doseId: 'th-liuwei',
    doseBasis:
      '同方异名（讲义作「六味地黄丸」，同和堂版作「六味桂」＝六味地黄＋肉桂，另带天冬、五味子）',
    draftName: '引火归元（肾脏疗法）',
  },
  {
    no: 21,
    name: '明目六味地黄',
    indication: '寸关浮大尺脉弱 且左关大',
    doseId: 'th-mingmu-liuwei',
    doseBasis: '同方异名（讲义作「明目六味地黄」，同和堂版作「明目六味桂」＝柴胡＋当归＋六味桂）',
    draftName: '引火归元（肾脏疗法）',
  },
  {
    no: 22,
    name: '知柏六味地黄',
    indication: '左右尺脉不平衡；尺脉亢',
    doseId: 'th-zhibai',
    doseBasis: '同方异名（讲义作「知柏六味地黄」，同和堂版作「知柏六味桂」＝知母黄柏＋六味桂天味）',
    draftName: '引火归元（肾脏疗法）',
  },
  {
    no: 23,
    name: '明目知柏地黄',
    indication: '左右尺脉不平衡；尺脉亢；外加左关大',
    doseId: 'th-mingmu-zhibai',
    doseBasis: '同方异名（讲义作「明目知柏地黄」，同和堂版作「明目知柏六味桂」＝柴胡＋当归＋知柏六味桂）',
    draftNote: '讲稿 2010 未载该组合方（讲稿只分别写了「添加柴味归」与「添加知柏」两味加减）',
  },
  {
    no: 24,
    name: '七宝美髯丹',
    indication: '变脉',
    doseId: 'th-xiajiao',
    doseBasis:
      '同方异名：两套资料都把「七宝美髯丹」列为**下焦方**的科学中药 —— 同和堂版 p4「下焦方：七宝美髯丹3 小茴香0.3」，讲稿「下焦方（天乙丹）」同；讲义 p42 作「七宝美髯丹」、脉象「变脉」，与下焦方的适应症一致，故列其成方「下焦方」',
    draftName: '下焦方（天乙丹）',
  },
  {
    no: 25,
    name: '大补阴丸',
    indication: '尺脉洪大',
    doseId: 'th-dabuyin',
    doseBasis: '同名同方（讲义 p42 第 25 行 ↔ 同和堂版 p3「大补阴丸」）',
    draftName: 'DRAFT-大补阴丸',
  },
  {
    no: 26,
    name: '还少丹',
    indication: '食疗补肾方（一付五天）',
    doseId: 'th-huanshaodan',
    doseBasis: '同名同方（讲义 p42 第 26 行 ↔ 同和堂版 p3「还少丹」）',
    draftName: '食补肾（还少丹加减）',
  },
  {
    no: 27,
    name: '人参养荣汤',
    indication: '左右脉不平衡；治疗脱发、产后虚、大病初愈',
    doseId: 'th-renshenyangrong',
    doseBasis: '同名同方（讲义 p42 第 27 行 ↔ 同和堂版 p1「人参养荣汤」）',
    draftName: '左右脉不平衡（人参养荣汤）',
  },
  {
    no: 28,
    name: '补中益气汤',
    indication: '双关浮大；加散药用于虚人感冒',
    doseId: 'th-shuangguan',
    doseBasis:
      '同方异名（讲义作「补中益气汤」，同和堂版作「双关同治（补中益气）」）；讲稿作「肝脾（双关）同治（补中益气加散药）」',
    draftName: '肝脾（双关）同治（补中益气加散药）',
  },
]

/**
 * 讲稿 2010 里写明了组成、但**不在第二讲**的方 —— 单列，出处标到讲次。
 *
 * 第二讲是讲稿唯一系统给出「方 ↔ 组成／服法／加减／禁忌」的地方；
 * 这条是讲稿第五讲顺带写下的方，组成只给药味简称、没有剂量，照录不改。
 */
export const DRAFT_EXTRA: Record<
  string,
  { name: string; composition: string; source: string; note?: string }
> = {
  'DRAFT-大补阴丸': {
    name: '大补阴丸（讲稿 2010·第五讲）',
    composition: '柏、母、地、龟。柏，黄柏，母，知母，地，熟地，龟，龟板',
    source: '讲稿 2010·第五讲',
    note: '讲稿只给药味简称，未写剂量；剂量见同和堂版 p3「大补阴丸」',
  },
}

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
export const FORMULA_ALIAS: Record<string, string> = {
  天王芪: '左寸浮大 · 脉数（天王补心丹加芪）',
  六神散: '右关虚脏 · 浮大而软（六神汤）',
  加味增液汤: '右关尺浮大（增液汤加减）',
  补中益气汤: '肝脾（双关）同治（补中益气加散药）',
  龙胆泻肝: '左关浮洪大（加味龙胆泻肝）',
  加味龙胆: '左关浮洪大（加味龙胆泻肝）',
  // 五脏疗法的加味理中（讲义 p42 第 10 行「右关弱且左关有」）；
  // 注意与三焦疗法的「中焦方（加味理中）」不是同一张方
  加味理中: '右关虚脏 · 软而无力（加味理中）',
  六味地黄丸: '引火归元（肾脏疗法）',
  明目六味地黄: '引火归元（肾脏疗法）',
  知柏六味地黄: '引火归元（肾脏疗法）',
  明目知柏地黄: '引火归元（肾脏疗法）',
  黄芪鳖甲: '左关右寸 · 浮洪大（黄芪鳖甲）',
  还少丹: '食补肾（还少丹加减）',
  人参养荣汤: '左右脉不平衡（人参养荣汤）',
  // 讲义 p47「开方三部曲图」上的用名（p42 之外的第二处来源）
  冷热水: '一体疗法（冷热水疗法）',
}

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
