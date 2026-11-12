/**
 * 统一编辑弹层（条目 ＋ 脉象图）的**纯逻辑**
 *
 * ## 为什么抽出来
 *
 * 「这一条到底改了哪些字段」「这些图归一之后变了没有」原来写在组件里，
 * 没法单独测 ⇒ 抽成纯函数，组件与断言脚本共用同一份。
 *
 * ⚠️ **一处真源**：组件里不许再另写一遍比较逻辑 —— 否则断言测的是
 *   函数、界面跑的是另一套，改一处对不上。
 */

/**
 * 条目草稿 → **只发改了的字段**
 *
 * 字段级改：服务端以「当前生效的那条」为底合并 ⇒ 只发真变了的，
 * 其余字段一字不动。
 *
 * @param {Record<string, unknown>} draft 草稿
 * @param {Record<string, unknown>} base  当前生效的那条
 * @returns {Record<string, unknown>} 真变了的字段
 */
export function diffEntryFields(draft, base) {
  const changed = {}
  for (const key of Object.keys(draft ?? {})) {
    if (JSON.stringify(draft[key]) !== JSON.stringify((base ?? {})[key])) changed[key] = draft[key]
  }
  return changed
}

/**
 * 脉象图归一 —— 保存前做一次清理
 *
 *  · 去掉**空格子**（既没有符号也没有用字）—— 空格子在图上就是「原文未提及」
 *  · 给没名字的图补个默认名（`脉象 1`、`脉象 2`…）
 *
 * @param {any[]} patterns
 * @returns {any[]}
 */
export function normalizePatterns(patterns) {
  return (patterns ?? []).map((p, i) => ({
    ...p,
    cells: (p.cells ?? []).filter((c) => (c.codes && c.codes.length > 0) || !!c.term),
    title: (p.title ?? '').trim() || `脉象 ${i + 1}`,
  }))
}

/**
 * 图草稿 → **归一之后**与当前生效的是否不同
 *
 * ⚠️ 必须先归一再比：草稿里可能留着空格子、没名字的图 —— 那些不算改动。
 *
 * @param {any[]} draft  草稿
 * @param {any[]} current 当前生效的图
 * @returns {boolean}
 */
export function patternsChanged(draft, current) {
  return JSON.stringify(normalizePatterns(draft)) !== JSON.stringify(normalizePatterns(current))
}
