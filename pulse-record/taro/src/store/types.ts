/**
 * 全局上下文 —— **患者 × 就诊**
 *
 * ## 为什么要有它（2026-11-05 的病根）
 *
 * 原生版里 `findings`／`triad`／`medication` 三页**各自都带一套「选患者＋选日期」chip**，
 * 同一个上下文散在 5 个地方各选各的、互不同步，而且**完全不持久化**
 * （`utils/storage.js` 只存 token/user，`utils/config.js` 只存 API_BASE）。
 * 结果一次完整就诊要 6~8 次跳页 ＋ 3 次重复选上下文。
 *
 * 现在：上下文是**一份全局状态**，持久化，四个 tab 共用，吸顶条统一展示与切换。
 *
 * ## 纯函数与副作用分开
 *
 * 本文件里与状态无关的推导（挑最近一次就诊、规范化、拼标签）都是**纯函数**，
 * 放在 `logic.ts` 里，能被回归脚本直接断言 —— Taro 下没法再驱动页面实例，
 * 纯函数是主要的可测面。
 */

export const CONTEXT_KEY = 'pulse.context'

/** 当前上下文 */
export interface VisitContext {
  /** 当前患者 id；null＝没选 */
  patientId: string | null
  /** 当前就诊 id；null＝「还没建这一次」（新建状态） */
  visitId: string | null
  /** 就诊日期标签（新建时是今天） */
  visitDate: string
}

export interface PatientRef {
  id: string
  name: string
}

export interface VisitRef {
  id: string
  label: string
  at?: number
}
