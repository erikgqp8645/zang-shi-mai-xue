/**
 * `library-chips.mjs` 的类型声明
 *
 * ⓘ 实现是 `.mjs`（浏览器与断言脚本共用）；这里手写一份声明给 TypeScript 看。
 *
 * ⚠️ **声明与实现可能漂移** —— 由 `scripts/e2e/library-runtime-edit.mjs`
 *    的 RE5 盯着（同一个数组，改／删之后必须只剩该剩的那几项）。
 *    改实现时**记得同步改这里**。
 */

/** 改一个标签（✎）：空文字或与原来一样 ⇒ 原样返回 */
export declare function setChip(list: string[] | null | undefined, index: number, text: string): string[]

/** 删一个标签（✕）：只删那一项，其余原样保留 */
export declare function removeChip(
  list: string[] | null | undefined,
  index: number,
): string[]

/** 加一个标签（＋）：空文字不算，重复的不加 */
export declare function addChip(list: string[] | null | undefined, text: string): string[]
