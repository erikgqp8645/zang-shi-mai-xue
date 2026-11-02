/**
 * 符号系统 —— 讲义 2026-10 p34「④ 脉象记录」
 *
 * 全部脉象（原文顺序）：
 *   0＝无、-＝弱、+＝有（± 比有弱）、++＝有力（±± 比有力弱）、+++＝很有力、++++＝非常有力、
 *   ↑＝顶、|＝弦、#＝变脉、X＝细、TTT＝跳调停、DDX＝大大小
 *
 * 主要脉象（p34 另一栏）：无（小）＝0 或 -；有（中）＝+、±；力（大）＝++、±±、↑
 *
 * 常用脉象（p48–50 记录表表头）：
 *   ① 无、弱、有、大、顶、弦   ② 忽大小、跳调停、忽快慢   ③ 细、数、迟、左右脉不平衡
 */

export type SymbolGroup = '主要脉象' | '变脉' | '其他'

export interface SymbolDef {
  code: string
  label: string
  group: SymbolGroup
  /** 补充说明，出自讲义 p33「③ 标准脉象」 */
  hint?: string
}

export const SYMBOLS: SymbolDef[] = [
  { code: '0', label: '无', group: '主要脉象', hint: '力度·小' },
  { code: '-', label: '弱', group: '主要脉象', hint: '力度·小，弱于正常' },
  { code: '+', label: '有', group: '主要脉象', hint: '力度·中，不大不小' },
  { code: '±', label: '有（比有弱）', group: '主要脉象', hint: '力度·中' },
  { code: '++', label: '有力', group: '主要脉象', hint: '力度·大' },
  { code: '±±', label: '有力（比有力弱）', group: '主要脉象', hint: '力度·大' },
  { code: '+++', label: '很有力', group: '主要脉象', hint: '力度·大' },
  { code: '++++', label: '非常有力', group: '主要脉象', hint: '力度·大' },
  { code: '↑', label: '顶', group: '主要脉象', hint: '比「大」还大，称洪大、顶' },
  { code: '|', label: '弦', group: '主要脉象' },
  { code: '#', label: '变脉', group: '变脉', hint: '忽大忽小' },
  { code: 'TTT', label: '跳调停', group: '变脉' },
  { code: 'DDX', label: '大大小', group: '变脉', hint: '忽快忽慢' },
  { code: 'X', label: '细', group: '其他' },
]

export const SYMBOL_BY_CODE: Record<string, SymbolDef> = Object.fromEntries(
  SYMBOLS.map((s) => [s.code, s]),
)

/** 常用脉象三组 —— 与 p48–50 记录表表头一致 */
export const COMMON_GROUPS: { title: string; codes: string[] }[] = [
  { title: '① 无、弱、有、大、顶、弦', codes: ['0', '-', '+', '±', '++', '±±', '+++', '++++', '↑', '|'] },
  { title: '② 忽大小、跳调停、忽快慢', codes: ['#', 'TTT', 'DDX'] },
  { title: '③ 细、数、迟、左右脉不平衡', codes: ['X'] },
]

/**
 * 力度分级（讲义 p33「力度」分支）
 *   小：无、弱    中：有、浮有    大：有力、洪大、顶手
 * 归并为 0~3 级便于比较。
 */
export type Strength = 0 | 1 | 2 | 3

export function strengthOf(codes: string[]): Strength {
  if (codes.length === 0) return 0
  if (codes.includes('++++') || codes.includes('+++') || codes.includes('↑')) return 3
  if (codes.includes('++') || codes.includes('±±')) return 2
  if (codes.includes('+') || codes.includes('±')) return 1
  return 0
}

/** 虚脏：讲稿中「虚脏」＝该脉点弱或无（讲稿 2010·第十四讲） */
export function isXuZang(codes: string[]): boolean {
  if (codes.length === 0) return false
  return (codes.includes('-') || codes.includes('0')) && strengthOf(codes) === 0
}

/** 大：力度为大（++ / ±± / +++ / ++++），不含顶手 */
export function isDa(codes: string[]): boolean {
  return (
    codes.includes('++') ||
    codes.includes('±±') ||
    codes.includes('+++') ||
    codes.includes('++++')
  )
}

/** 顶手 */
export function isDing(codes: string[]): boolean {
  return codes.includes('↑')
}

/** 变脉（# / TTT / DDX 任一） */
export function isBianMai(codes: string[]): boolean {
  return codes.includes('#') || codes.includes('TTT') || codes.includes('DDX')
}

/** 符号数组 → 展示文本，如 ['X','↑'] → "X↑"，['0','#'] → "0+#" */
export function formatCodes(codes: string[]): string {
  return codes.join('')
}

/** 解析手输文本为符号数组：按已知符号贪心匹配，未知字符忽略 */
export function parseCodes(text: string): string[] {
  const sorted = [...SYMBOLS].sort((a, b) => b.code.length - a.code.length)
  const out: string[] = []
  let i = 0
  while (i < text.length) {
    const hit = sorted.find((s) => text.startsWith(s.code, i))
    if (hit) {
      out.push(hit.code)
      i += hit.code.length
    } else {
      i += 1
    }
  }
  return out
}
