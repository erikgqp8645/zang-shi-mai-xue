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

import { toRecord } from './to-record'

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

export const SYMBOL_BY_CODE: Record<string, SymbolDef> = toRecord(
  SYMBOLS.map((s) => [s.code, s] as [string, SymbolDef]),
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
 * 「看不见」的字符 —— 不止零宽空格一种。
 *
 * 实测这一批都能绕过「非空」检查，而且存进去之后**肉眼与正常符号完全一样**
 * （软连字符能造出 `S` 的影子符号，删一个另一个还在）：
 *
 *   · 软连字符 U+00AD、阿拉伯字母标记 U+061C —— 格式字符，`trim()` 删不掉
 *   · 盲文空白 U+2800、韩文填充符 U+3164／U+115F／U+FFA0 —— 有字形，但字形是空白
 *   · 变体选择符 U+FE00–FE0F、组合附加符 U+0300–036F —— 单独出现什么都不显示
 *   · 标签字符 U+E0020–E007F、BOM U+FEFF、方向控制符 U+202A–202E
 *
 * ⚠️ 这个集合**含各种空白**（U+2000–200A、U+202F、U+205F、U+3000），只用于**符号代码**。
 * 名称用的是下面那个宽松版 —— 中文输入法打出的空格常常是 U+3000，
 * 那是**看得见宽度**的空白，不该按「看不见」拒掉。
 */
const INVISIBLE_CODE =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u0300-\u036f\u0483-\u0489\u0600-\u0605\u061c\u06dd\u070f\u115f\u1160\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u2066-\u206f\u20d0-\u20f0\u2800\u3000\u3164\ufe00-\ufe0f\ufe20-\ufe2f\ufeff\uffa0\ufff9-\ufffb\u1ab0-\u1aff\u1dc0-\u1dff\u{1d173}-\u{1d17a}\u{e0001}\u{e0020}-\u{e007f}]/u

/** 名称用：只拦没有任何字形的字符，各种宽度的空格一律放行（见上） */
const INVISIBLE_NAME =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u0300-\u036f\u0483-\u0489\u0600-\u0605\u061c\u06dd\u070f\u115f\u1160\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\u20d0-\u20f0\u2800\u3164\ufe00-\ufe0f\ufe20-\ufe2f\ufeff\uffa0\ufff9-\ufffb\u1ab0-\u1aff\u1dc0-\u1dff\u{1d173}-\u{1d17a}\u{e0001}\u{e0020}-\u{e007f}]/u

/** 不能当符号代码的两个值：URL 客户端会把它们当成「当前／上一级」，建得进、删不掉 */
const UNUSABLE_CODES = ['.', '..']

/**
 * 自定义符号的校验 —— 返回错误信息，通过则返回 null。
 *
 * 与服务端 `server/symbol-codes.mjs` 的 `RESERVED_SYMBOL_CODES` 同一套规则
 * （前端 TS 与服务端 .mjs 无法互相 import，知识常量两边各留一份，改动要一起改）。
 *
 * **硬性规定：符号不能为空。** 一格脉象必须写出一个看得见的符号或字母（如 S），
 * 名称也必须填（如 涩）—— 否则导出时读表的人只看到一个无从解释的代码。
 */
export function validateCustomSymbol(
  code: string,
  name: string,
  existing: CustomSymbol[] = [],
): string | null {
  const c = code.trim()
  const n = name.trim()
  if (!c) return '符号不能为空 —— 必须填一个符号或字母（如 S）'
  if (INVISIBLE_CODE.test(c)) return '符号里有看不见的字符，换一个能看见的'
  if (c.length > 3) return '符号代码最多 3 个字符'
  if (/\s/.test(c)) return '符号代码里不能有空格'
  if (c.includes('/')) return '符号代码里不能有「/」'
  if (UNUSABLE_CODES.includes(c)) return '不能把「.」或「..」当符号（这种地址删不掉）'
  if (!n) return '请填写符号名称（如 涩）'
  if (INVISIBLE_NAME.test(n)) return '名称里有看不见的字符，换一个能看见的'
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
