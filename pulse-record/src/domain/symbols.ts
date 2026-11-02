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

/**
 * 自定义符号 —— 使用者自建，讲义 p33–34 固定符号集之外另加（如「涩」记作 S）。
 *
 * 固定符号集一个字不改；自定义符号与它并列使用，只在录入、图示、导出里带着代码走，
 * 不参与任何判读规则与依脉用方比对（讲义、讲稿里没有的符号，讲稿自然没有点名）。
 */
export interface CustomSymbol {
  /** 代码：格子里显示的字符，如 S（也可直接用一个汉字当代码） */
  code: string
  /** 名称：如 涩 */
  name: string
}

/** 讲义固定符号的代码，自定义符号不得占用 */
export const BUILTIN_CODES: string[] = SYMBOLS.map((s) => s.code)

/**
 * 自定义符号的校验 —— 返回错误信息，通过则返回 null。
 * 与服务端 server/db.mjs 的 RESERVED_SYMBOL_CODES 同一套规则。
 */
export function validateCustomSymbol(
  code: string,
  name: string,
  existing: CustomSymbol[] = [],
): string | null {
  const c = code.trim()
  const n = name.trim()
  if (!c) return '请填写符号代码'
  if (c.length > 3) return '符号代码最多 3 个字符'
  if (/\s/.test(c)) return '符号代码里不能有空格'
  if (c.includes('/')) return '符号代码里不能有「/」'
  if (!n) return '请填写符号名称'
  if (n.length > 12) return '符号名称最多 12 个字符'
  if (BUILTIN_CODES.includes(c)) return `代码「${c}」与讲义固定符号重复，换一个`
  if (existing.some((s) => s.code === c)) return `代码「${c}」已经有了`
  return null
}

/** 符号数组 → 展示文本，如 ['X','↑'] → "X↑"，['0','#'] → "0+#" */
export function formatCodes(codes: string[]): string {
  return codes.join('')
}

/** 记录里用到的全部符号代码（去重，顺序按出现） */
export function collectUsedCodes(sessions: { values: Record<string, string[]> }[]): string[] {
  const out = new Set<string>()
  for (const s of sessions) {
    for (const codes of Object.values(s.values)) {
      for (const c of codes) out.add(c)
    }
  }
  return [...out]
}

/**
 * 导出图例：自定义符号表 ＋ 记录里用到、但已从符号表删掉的代码。
 *
 * 删符号不改历史记录（已录入的代码仍在格子里），所以导出时仍要给出说明，
 * 否则读表的人看到一个没解释的代码就不知道那是什么。
 */
export function buildCustomLegend(
  custom: CustomSymbol[],
  usedCodes: string[],
): { code: string; name: string }[] {
  const map = new Map<string, string>()
  for (const s of custom) map.set(s.code, s.name)
  for (const c of usedCodes) {
    if (!map.has(c) && !BUILTIN_CODES.includes(c)) map.set(c, '已从符号表删除')
  }
  return [...map].map(([code, name]) => ({ code, name }))
}

/** 解析手输文本为符号数组：按已知符号贪心匹配，未知字符忽略 */
export function parseCodes(text: string, extraCodes: string[] = []): string[] {
  const known = [...new Set([...SYMBOLS.map((s) => s.code), ...extraCodes])].sort(
    (a, b) => b.length - a.length,
  )
  const out: string[] = []
  let i = 0
  while (i < text.length) {
    const hit = known.find((code) => text.startsWith(code, i))
    if (hit) {
      out.push(hit)
      i += hit.length
    } else {
      i += 1
    }
  }
  return out
}
