/**
 * 用方知识库 · **运行期生效集**的存放处（浏览器这一侧的唯一真源）
 *
 * ## 是什么
 *
 * 管理员在 ③ 知识库里改一条／删一条 ⇒ 改动落**服务端覆盖层**
 * （`library_items` 表，公共资料，所有账号共享一份）。
 * 前端拿到覆盖层的行，**合并到「自己那份基线」上**，得出「运行期生效的那一份」。
 *
 * ⓘ 生效集只有这一处 ⇒ 界面显示的、② 命中的、导出的，都是这一份。
 *
 * ## 为什么合并在**前端**做（而不是服务端整份下发）
 *
 * 命中判定是**代码**（`src/domain/formulas.ts` 的 `EVALUATORS`），不是数据。
 * 若服务端按远端已发布内容整份算好再下发，那份内容里可能有前端这版代码
 * **没有判定函数**的规则 id ⇒ `loadRules` 直接抛错 ⇒ 整站崩。
 * ⇒ 生效集必须以「**前端自己那份基线**」为底合并 ⇒ id 永远是基线的子集
 * ⇒ 判定函数必定存在。
 *
 * ## 为什么这个文件放在 `src/domain/`
 *
 * `src/domain` 下的 `.ts` 会被 `tsconfig.core.json` 编译成 CommonJS 给小程序用。
 * ⇒ 这里的东西必须：**DOM-free、ES2017-safe、不 import 小程序那边没有的东西**。
 * ⚠️ 合并逻辑在 `src/domain/library-core.mjs`（`.mjs` **不进**小程序编译产物）
 *    ⇒ **这个 store 绝不能 import 它** —— 合并放在 `src/state/library.tsx` 里做。
 *
 * ## 小程序端
 *
 * 小程序不设这个 store ⇒ 生效集永远是 `null` ⇒ 各 getter 返回基线 ⇒ 行为零变化。
 * （网站端改了覆盖层、小程序看不到 —— 这是**已知缺口**，记在 docs/progress.md。）
 */

import type { Drug } from './drugs'
import type { RuleDataJson } from './formulas'

/** 覆盖层的一行（服务端 `groupOverrides` 的形状） */
export interface LibraryOverrideRow {
  /** 该条目的完整 JSON；墓碑里存的是「原条目快照」 */
  payload: Record<string, unknown> | null
  /** 墓碑：这一条被删了 */
  deleted: boolean
  updatedAt: number | null
  updatedBy: string | null
  note: string | null
}

/** 覆盖层：按种类分组，再按条目 id */
export type LibraryOverrides = Record<string, Record<string, LibraryOverrideRow>>

/** 注册表里的一个字段 */
export interface LibraryKindField {
  key: string
  /** 字段的中文标签（表单上显示的） */
  label: string
  type: 'string' | 'number' | 'positiveInt' | 'boolean' | 'string[]' | 'enum' | 'page' | 'json'
  required?: boolean
  /** `type === 'enum'` 时的可选值 */
  values?: string[]
  /** 长文本（编辑时用多行框，不用单行） */
  long?: boolean
  /**
   * 表单里**默认不显示**这一栏（数据仍保留）。
   *
   * ⓘ 用于「出处」这类转录元信息：日常编辑用不着，但删掉字段会丢数据 ⇒
   *   只是不渲染，值原样留着。2026-11-13 用户定。
   */
  hidden?: boolean
}

/** 注册表里的一类（服务端 `LIBRARY_KINDS` 的形状） */
export interface LibraryKind {
  label: string
  idField: string
  idType: string
  container: 'array' | 'object'
  addable: boolean
  deletable: boolean
  fields: LibraryKindField[]
  blocked: { add?: string; del?: string } | null
  /** 本轮这个类开不开放网站端编辑 */
  runtimeEditable: boolean
}

/** 运行期状态 */
export interface LibraryState {
  /**
   * 合并后的规则（**原始 JSON**，不是 `FormulaRule`）—— null ＝ 用内置基线。
   *
   * ⓘ 存原始 JSON 而不是成品对象，是为了不与 `formulas.ts` 形成运行时循环依赖。
   */
  ruleData: RuleDataJson[] | null
  /** 合并后的方剂 —— null ＝ 用内置基线 */
  drugData: Drug[] | null
  /**
   * 合并后的同和堂版成方 —— null ＝ 用内置基线。
   *
   * ⓘ 2026-11-13 加：让「剂量对照」里那几行（同和堂版，克）也能被管理员编辑。
   *   以前 `dose` 不进生效集，改了覆盖层前端也看不见。
   */
  doseData: unknown[] | null
  /** 覆盖层原始行（界面显示「已删除的条目（可撤销）」用） */
  overrides: LibraryOverrides
  /** 注册表（字段表）—— null ＝ 还没拿到 */
  kinds: Record<string, LibraryKind> | null
  /** 加载失败时的原因（界面要能看见，不能静默） */
  error: string | null
  /** 加载过没有（成功或失败都算） */
  loaded: boolean
}

/** 初始状态：什么都还没加载 ⇒ 一律用基线 */
const INITIAL: LibraryState = {
  ruleData: null,
  drugData: null,
  doseData: null,
  overrides: {},
  kinds: null,
  error: null,
  loaded: false,
}

let state: LibraryState = INITIAL

/** 订阅者（React 的 `useSyncExternalStore` 用） */
const listeners = new Set<() => void>()

/** 当前状态（**同一个引用**，直到有人改它 ⇒ `useSyncExternalStore` 才不会死循环） */
export function getLibraryState(): LibraryState {
  return state
}

/** 订阅状态变化；返回退订函数 */
export function subscribeLibrary(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 写状态（**唯一**写入口）。
 *
 * ⚠️ 每次都换一个新对象 ⇒ `useSyncExternalStore` 才知道变了。
 */
export function setLibraryState(next: Partial<LibraryState>): void {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

/**
 * 取某一条**当前生效的原始 JSON**（编辑弹层要的就是这个）。
 *
 * ⓘ 为什么要「原始 JSON」而不是 `FormulaRule`：
 *   `FormulaRule` 里多了 `evaluate`／`patterns` 这些**运行期**字段，
 *   存回覆盖层会把它们一起带进去 ⇒ 不是资料，是代码。
 *
 * @param id 条目 id
 * @returns 原始条目；没有（或已被删掉）⇒ null
 */
export function getEffectiveRuleRaw(id: string): Record<string, unknown> | null {
  const data = getLibraryState().ruleData
  if (!data) return null
  const hit = data.find((r) => String(r.id) === String(id))
  return hit ? ({ ...hit } as unknown as Record<string, unknown>) : null
}

/**
 * 取同和堂版成方（`dose`）当前生效的原始 JSON。
 *
 * ⓘ 用法与另外两个 getter 一样，只是这一类的数据在 `doseData` 里
 *   （「剂量对照」那几行点「编辑」时按 id 取）。
 */
export function getEffectiveDoseRaw(id: string): Record<string, unknown> | null {
  const list = getLibraryState().doseData
  if (!Array.isArray(list)) return null
  const hit = list.find((d) => String((d as { id?: string })?.id) === String(id))
  return hit ? ({ ...(hit as object) } as Record<string, unknown>) : null
}

/** 同上，讲稿方剂 */
export function getEffectiveDrugRaw(id: string): Record<string, unknown> | null {
  const data = getLibraryState().drugData
  if (!data) return null
  const hit = data.find((d) => String(d.id) === String(id))
  return hit ? ({ ...hit } as unknown as Record<string, unknown>) : null
}
