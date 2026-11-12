/**
 * `library-core.mjs` 的类型声明
 *
 * ⓘ 实现是 `.mjs`（云函数跑 Node 16／18／20，不能 import `.ts`），
 *   这里手写一份声明给 TypeScript 看。
 *
 * ⚠️ **声明与实现可能漂移** —— 由 `scripts/e2e/library-runtime-edit.mjs`
 *    的 RE10 盯着（同一组 fixture，浏览器侧与命令行侧算出的结果必须一致）。
 *    改实现时**记得同步改这里**。
 */

/** 「未载」哨兵 —— 某套资料里没有这一项时的标准写法 */
export declare const NOT_CARRIED: string

/** 键顺序无关的稳定序列化 */
export declare function stableStringify(value: unknown): string

/** 两个条目是否「一样」（键顺序不算差别） */
export declare function sameEntry(a: unknown, b: unknown): boolean

/** 覆盖层的一行 */
export interface LibraryOverrideRow {
  /** 该条目的完整 JSON（墓碑里存的是「原条目快照」） */
  payload?: unknown
  /** 墓碑：这一条被删了 */
  deleted?: boolean
  updatedAt?: number | null
  updatedBy?: string | null
  note?: string | null
}

/** 合并一类时用到的登记信息（只有这两项是合并用得到的） */
export interface LibraryMergeSpec {
  /** 主键字段名 */
  idField: string
  /** 容器形状 */
  container: 'array' | 'object'
}

/** 合并结果 */
export interface LibraryMergeResult {
  container: unknown
  added: string[]
  changed: string[]
  removed: string[]
  bad: string[]
}

/** 合并一类：基线容器 ＋ 覆盖层 → 新容器 */
export declare function mergeKind(
  spec: LibraryMergeSpec,
  container: unknown,
  overridesForKind: Record<string, LibraryOverrideRow> | null | undefined,
): LibraryMergeResult

/** 合并后的文件包（按文件名索引，键形如 'formula-rules.json'） */
export type LibraryFiles = Record<string, any>

/** 被删掉的条目（按种类分组） */
export type LibraryRemoved = Record<string, string[]>

/** 级联清理：删掉一个东西，引用它的那些怎么办 */
export declare function cascadeCleanup(files: LibraryFiles, removed: LibraryRemoved): string[]
