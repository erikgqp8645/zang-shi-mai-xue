/**
 * 方剂脉象图 API —— 存服务端（server/schema.sql 的 formula_patterns 表）
 *
 * ## 只传「覆盖层」
 *
 * 内置基线在 `src/content/pulse-patterns.json`（Excel 管线产出，只读）。
 * 这里存的是**使用者手改过的**那几条：某条目一旦有覆盖，就整条接管（基线不再显示）。
 * 这样「恢复默认」＝删掉覆盖，回落到基线，语义干净。
 *
 * ## 为什么不做本地缓存兜底
 *
 * 这个功能的目的就是「在别的机器上也看得见」。本地兜底会让「保存成功」变成
 * 一句谎话 —— 服务端没写成，界面上却还在，换台机器就没了。
 * 所以失败必须**当场报错**，宁可让人重试。
 */

import type { PulsePattern } from '../domain/pulse-pattern'
import { request } from './http'

/** 条目 id → 手改过的图（没有这个键 ＝ 没改过，用内置基线） */
export type PatternOverrides = Record<string, PulsePattern[]>

/** 拉取全部覆盖层（登录后调用一次） */
export async function listPatternOverrides(): Promise<PatternOverrides> {
  const { overrides } = await request<{ overrides: PatternOverrides }>('/api/formula-patterns')
  return overrides ?? {}
}

/** 整条替换某方剂的脉象图（顺序即数组顺序；空数组 ＝ 这个方剂不挂图） */
export async function saveFormulaPatterns(
  formulaId: string,
  patterns: PulsePattern[],
): Promise<void> {
  await request<{ formulaId: string; patterns: PulsePattern[] }>(
    `/api/formula-patterns/${encodeURIComponent(formulaId)}`,
    { method: 'PUT', body: JSON.stringify({ patterns }) },
  )
}

/** 撤销某方剂的手改，回到内置基线 */
export async function resetFormulaPatterns(formulaId: string): Promise<void> {
  await request<{ ok: true }>(`/api/formula-patterns/${encodeURIComponent(formulaId)}`, {
    method: 'DELETE',
  })
}
