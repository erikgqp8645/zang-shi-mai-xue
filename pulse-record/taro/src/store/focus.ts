import type { FormulaLink } from '@domain/formula-links'

/**
 * tab 之间的「跳转定位」意图 —— **内存态，不持久化**
 *
 * ## 为什么不能靠 URL 参数
 *
 * 微信小程序的 `switchTab` **不支持 query 参数**（`Taro.switchTab` 同理）。
 * 而 ③ 的方名要跳到「用方」tab 并定位到某一条 —— 只能另辟一条通道。
 *
 * ## 为什么是内存态而不是写进 storage
 *
 * ① 意图是**一次性的**：跳过去用掉就没了；
 * ② 写进 `pulse.*` 那些持久化键会跟用户数据混在一起，
 *    而且用户上次没跳完、这次打开小程序还莫名滚一下，体验很怪；
 * ③ 切 tab 不会卸载页面，也不会重载模块 → 模块级变量在切过去之后**还在**。
 *
 * ## 用完即取
 *
 * `takeFormulaFocus()` 取走就清空 —— 避免「第二次进用方页又滚一遍」。
 */
let pending: FormulaLink | null = null

/** 记下要跳到哪一条 */
export function setFormulaFocus(link: FormulaLink): void {
  pending = link
}

/** 取走跳转意图（取走即清空） */
export function takeFormulaFocus(): FormulaLink | null {
  const f = pending
  pending = null
  return f
}

/** 只看有没有待跳转（不取走）—— 调试与断言用 */
export function peekFormulaFocus(): FormulaLink | null {
  return pending
}
