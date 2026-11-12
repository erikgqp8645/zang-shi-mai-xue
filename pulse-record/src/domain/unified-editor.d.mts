/**
 * `unified-editor.mjs` 的类型声明
 *
 * ⓘ 实现是 `.mjs`（浏览器与断言脚本共用）；这里手写一份声明给 TypeScript 看。
 *
 * ⚠️ **声明与实现可能漂移** —— 由 `scripts/e2e/unified-editor.mjs` 的
 *    UE7／UE8 盯着（字段级 diff 与图的归一化）。改实现时**记得同步改这里**。
 */

import type { PulsePattern } from './pulse-pattern'

/** 条目草稿 → 只发改了的字段（字段级改） */
export declare function diffEntryFields(
  draft: Record<string, unknown> | null | undefined,
  base: Record<string, unknown> | null | undefined,
): Record<string, unknown>

/** 脉象图归一：去掉空格子、给没名字的图补默认名 */
export declare function normalizePatterns(patterns: PulsePattern[] | null | undefined): PulsePattern[]

/** 图草稿归一之后与当前生效的是否不同 */
export declare function patternsChanged(
  draft: PulsePattern[] | null | undefined,
  current: PulsePattern[] | null | undefined,
): boolean
