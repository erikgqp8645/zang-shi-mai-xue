import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { mergeLibrary } from '../domain/library-merge.mjs'
import {
  deleteLibraryEntry as apiDeleteEntry,
  listLibraryKinds,
  listLibraryOverrides,
  patchLibraryEntry as apiPatchEntry,
  restoreLibraryEntry as apiRestoreEntry,
  reviveLibraryEntry as apiReviveEntry,
} from '../api/library'
import {
  getLibraryState,
  setLibraryState,
  subscribeLibrary,
  type LibraryKind,
  type LibraryState,
} from '../domain/library-store'
import type { Drug } from '../domain/drugs'
import type { RuleDataJson } from '../domain/formulas'
import RULE_DATA from '../content/formula-rules.json'
import DRUG_DATA from '../content/drugs.json'

/**
 * 用方知识库 · **运行期生效集**的装载 ＋ 合并
 *
 * ## 三层真源
 *
 * ```
 *   ① 基线层（只读）        ② 覆盖层（可写）          ③ 生效层（运行期）
 *   src/content/*.json      library_items 表           基线 ⊕ 覆盖层
 *   已发布内容（发布流程维护） 管理员的运行时改动          前端真正显示/判读的那份
 * ```
 *
 * ③ 在**前端**算（不是服务端整份下发）——
 * 命中判定是代码（`EVALUATORS`），服务端下发的内容里可能有这版代码没有判定函数的
 * 规则 id ⇒ `loadRules` 抛错 ⇒ 整站崩。⇒ 生效集必须以「前端自己那份基线」为底合并。
 *
 * ## 合并逻辑在 `src/domain/library-merge.mjs`（纯函数，可被断言脚本直接调用）
 *
 * ⓘ 底层（`mergeKind`／`cascadeCleanup`）在 `src/domain/library-core.mjs`，
 *   与命令行 `npm run admin -- library apply` **共用同一份** ⇒
 *   网站里看到的与写进基线的，永远是同一个结果。
 * ⚠️ 那两个文件是 `.mjs`（云函数跑 Node 16／18／20，不能 import `.ts`），
 *   **不进小程序编译产物** ⇒ 小程序端不设这个 store，行为零变化。
 */

/** 本轮开放的两种（与服务端 `RUNTIME_EDITABLE_KINDS` 一致） */
const MERGE_KINDS = ['rule', 'drug'] as const

/** 组件里读生效集：`const { ruleData } = useLibrary()` */
export function useLibrary(): LibraryState {
  return useSyncExternalStore(subscribeLibrary, getLibraryState, getLibraryState)
}

/* ------------------------------------------------------------------ *
 * 合并（纯逻辑在 src/domain/library-merge.mjs）                          *
 * ------------------------------------------------------------------ */

/**
 * 拉一次覆盖层 ＋ 注册表，合并出生效集，写进 store。
 *
 * ⚠️ **失败要看得见**：拉不到就保留基线，并把原因放进 `error`
 *   （与 `src/state/patterns.tsx` 同一纪律 —— 不做本地缓存兜底）。
 */
export async function reloadLibrary(): Promise<void> {
  try {
    const [kinds, overrides] = await Promise.all([listLibraryKinds(), listLibraryOverrides()])
    const merged = mergeLibrary(
      kinds as unknown as Record<string, LibraryKind>,
      overrides,
      RULE_DATA.rules as RuleDataJson[],
      DRUG_DATA.drugs as Drug[],
    )
    setLibraryState({
      ruleData: merged.ruleData,
      drugData: merged.drugData,
      overrides,
      kinds,
      error: merged.problems.length > 0 ? merged.problems.join('\n') : null,
      loaded: true,
    })
  } catch (e) {
    setLibraryState({
      error: e instanceof Error ? e.message : String(e),
      loaded: true,
    })
  }
}

/* ------------------------------------------------------------------ *
 * 四个动作（写接口 → 落库成功后才刷新生效集）                            *
 * ------------------------------------------------------------------ */

/**
 * **改一条**（字段级）。
 *
 * ⚠️ 顺序：**服务端确认落库**之后才刷新生效集 ——
 *    顺序反了就会出现「界面有、库里没有」（与 `src/state/patterns.tsx` 同一纪律）。
 */
export async function saveLibraryPatch(
  kind: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await apiPatchEntry(kind, id, patch)
  await reloadLibrary()
}

/** **删一条**（写墓碑，带原内容快照 ⇒ 之后能撤销） */
export async function removeLibraryEntry(kind: string, id: string): Promise<void> {
  await apiDeleteEntry(kind, id)
  await reloadLibrary()
}

/** **恢复默认**（撤覆盖层这一行 → 回到内置基线） */
export async function restoreLibraryDefault(kind: string, id: string): Promise<void> {
  await apiRestoreEntry(kind, id)
  await reloadLibrary()
}

/** **撤销删除**（把墓碑里的原内容快照放回去） */
export async function undoLibraryDelete(kind: string, id: string): Promise<void> {
  await apiReviveEntry(kind, id)
  await reloadLibrary()
}

/**
 * 登录后的子树外面包一层。挂载即拉一次覆盖层。
 *
 * ⚠️ 必须挂在「已登录」分支里 —— 未登录时拉会 401，
 *    而 401 会顺手清掉令牌并把页面踢回登录页（见 api/http.ts）。
 */
export function LibraryProvider({ children }: { children: ReactNode }) {
  const reload = useCallback(() => {
    void reloadLibrary()
  }, [])
  useEffect(() => {
    reload()
  }, [reload])
  return <>{children}</>
}

/** 本轮开放的种类（给界面判断「哪些条目能编辑」） */
export function isRuntimeEditableKind(kind: string): boolean {
  return (MERGE_KINDS as readonly string[]).includes(kind)
}
