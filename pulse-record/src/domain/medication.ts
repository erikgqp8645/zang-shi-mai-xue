import { DRUGS, type Drug } from './drugs'
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

/** 讲义 p42「依脉用方表」的一行 */
export interface FormulaReference {
  /** 原表序号 */
  no: number
  /** 处方名（讲义原名） */
  name: string
  /** 对应脉象及加减（原文照录，不改写、不简化） */
  indication: string
}

/**
 * 讲义 2026-10·p42「臧氏脉学处方 ｜ 对应脉象及加减」原表 28 行 —— 逐行照录。
 *
 * 讲义 p12 把这张表列为核心工具③「依脉用方表」。
 * 与讲稿第二讲（方剂的组成／服法／加减／禁忌）是**互补的两个视角**：
 * 讲义这张给「方 ↔ 脉象」，讲稿给「方 ↔ 组成与服法」。
 *
 * 方名沿用讲义原样（「天王芪」「理中术姜芪」「龙胆泻肝」等），
 * 不改写成现代教材方名；讲稿没写组成的一律留空，不臆造。
 */
export const FORMULA_REFERENCE: FormulaReference[] = [
  { no: 1, name: '一号上焦方', indication: '变脉，六弱脉' },
  { no: 2, name: '二号上焦方', indication: '同上，素食者' },
  { no: 3, name: '三号上焦方', indication: '变脉；左寸弱且右脉有' },
  { no: 4, name: '五味异功散', indication: '右关弱则拉高白术；右关浮大则拉高茯苓' },
  { no: 5, name: '参苓白术散', indication: '右关弱；治疗慢性腹泻' },
  { no: 6, name: '六神散', indication: '右关浮软；治疗烧退又烧' },
  { no: 7, name: '增液汤', indication: '右关浮大' },
  { no: 8, name: '加味增液汤', indication: '右关浮大；加当归郁李仁缓解便秘' },
  { no: 9, name: '易简地黄饮子', indication: '右三部脉浮洪大' },
  { no: 10, name: '加味理中', indication: '右关弱且左关有' },
  { no: 11, name: '理中术姜芪', indication: '右关微；治疗伤寒感冒' },
  { no: 12, name: '木香顺气', indication: '右关尺浮大顶手' },
  { no: 13, name: '养心汤', indication: '左寸弱迟' },
  { no: 14, name: '天王芪', indication: '左寸浮大数' },
  { no: 15, name: '肝心同治', indication: '左寸关浮大' },
  { no: 16, name: '肝肺同治', indication: '左关右寸浮大' },
  { no: 17, name: '黄芪鳖甲', indication: '双关右寸浮洪大' },
  { no: 18, name: '龙胆泻肝', indication: '左关洪或弦' },
  { no: 19, name: '参苏饮', indication: '右寸浮洪大' },
  { no: 20, name: '六味地黄丸', indication: '寸关浮大尺脉弱' },
  { no: 21, name: '明目六味地黄', indication: '寸关浮大尺脉弱 且左关大' },
  { no: 22, name: '知柏六味地黄', indication: '左右尺脉不平衡；尺脉亢' },
  { no: 23, name: '明目知柏地黄', indication: '左右尺脉不平衡；尺脉亢；外加左关大' },
  { no: 24, name: '七宝美髯丹', indication: '变脉' },
  { no: 25, name: '大补阴丸', indication: '尺脉洪大' },
  { no: 26, name: '还少丹', indication: '食疗补肾方（一付五天）' },
  { no: 27, name: '人参养荣汤', indication: '左右脉不平衡；治疗脱发、产后虚、大病初愈' },
  { no: 28, name: '补中益气汤', indication: '双关浮大；加散药用于虚人感冒' },
]

/**
 * 讲义 p42 用名 → 讲稿第二讲「方剂备查」的条目名。
 *
 * 两份资料的用名不一定相同（如讲义作「天王芪」，讲稿作「天王补心丹加芪」），
 * 这里只做**明确的同方对照**，供查组成／服法；讲稿第二讲没有条目的方（如
 * 五味异功散、参苓白术散、大补阴丸）就查不到，界面上明说「讲稿第二讲未载」。
 */
export const FORMULA_ALIAS: Record<string, string> = {
  天王芪: '左寸浮大 · 脉数（天王补心丹加芪）',
  六神散: '右关虚脏 · 浮大而软（六神汤）',
  加味增液汤: '右关尺浮大（增液汤加减）',
  补中益气汤: '肝脾（双关）同治（补中益气加散药）',
  龙胆泻肝: '左关浮洪大（加味龙胆泻肝）',
  加味龙胆: '左关浮洪大（加味龙胆泻肝）',
}

/**
 * 按方名找讲稿第二讲的方剂条目（查组成／服法／禁忌用）。
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

/** 在讲义 p42 的对照表里按关键字找行（方名或对应脉象） */
export function searchFormulaReference(kw: string): FormulaReference[] {
  const k = kw.trim()
  if (!k) return FORMULA_REFERENCE
  return FORMULA_REFERENCE.filter((r) => r.name.includes(k) || r.indication.includes(k))
}
