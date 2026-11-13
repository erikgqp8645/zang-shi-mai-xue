/**
 * `library-merge.mjs` 的类型声明
 *
 * ⓘ 实现是 `.mjs`（浏览器、Node、断言脚本三处共用同一份）；
 *   这里手写一份声明给 TypeScript 看。
 *
 * ⚠️ **声明与实现可能漂移** —— 由 `scripts/e2e/library-runtime-edit.mjs`
 *    的 RE10 盯着（同一组 fixture，浏览器侧与命令行侧算出的结果必须一致）。
 *    改实现时**记得同步改这里**。
 */

import type { LibraryOverrideRow } from './library-core.mjs'

/** 覆盖层（按种类分组，再按条目 id） */
export type LibraryOverridesShape = Record<string, Record<string, LibraryOverrideRow>>

/**
 * 只保留**基线里有的**那些覆盖行。
 *
 * @param overrides 覆盖层
 * @param kind     种类（`rule`／`drug`）
 * @param baselineIds 基线里已有的 id
 */
export declare function onlyBaseline(
  overrides: LibraryOverridesShape | null | undefined,
  kind: string,
  baselineIds: Set<string>,
): { kept: Record<string, LibraryOverrideRow>; stray: string[] }

/**
 * 合并：基线 ⊕ 覆盖层 → 生效集（规则 ＋ 方剂）。
 *
 * @param kinds         注册表（来自 `GET /api/library/kinds`）
 * @param overrides     覆盖层（来自 `GET /api/library/overrides`）
 * @param baselineRules 内置基线里的规则
 * @param baselineDrugs 内置基线里的讲稿方剂
 */
export declare function mergeLibrary(
  kinds: Record<string, any> | null | undefined,
  overrides: LibraryOverridesShape | null | undefined,
  baselineRules: any[] | null | undefined,
  baselineDrugs: any[] | null | undefined,
  /** 同和堂版成方的基线；给了才合并 `dose` 这一类（不传 ⇒ doseData 为 null） */
  baselineDoses?: any[] | null | undefined,
): { ruleData: any[]; drugData: any[]; doseData: any[] | null; problems: string[] }
