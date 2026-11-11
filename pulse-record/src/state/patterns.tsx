import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PulsePattern } from '../domain/pulse-pattern'
import { PATTERNS } from '../domain/pulse-patterns'
import { listPatternOverrides, resetFormulaPatterns, saveFormulaPatterns } from '../api/patterns'

/**
 * 方剂脉象图的**合并层**（内置基线 ＋ 服务端覆盖）
 *
 * ## 为什么用 Context 而不是一路传 props
 *
 * 读数的地方在 `FormulaItem` 里 —— 它在 ② 命中区、③ 用方知识库、
 * 以及「用药禁忌」三个位置各渲染一次，中间隔着 `Findings` / `FormulaLibrary` 两层。
 * 一路传 props 会让三个组件都多一个与自身职责无关的参数。
 *
 * ## 合并规则只有一条
 *
 * ```
 * 有覆盖（哪怕是被删成空数组）→ 只用覆盖
 * 没有覆盖                    → 用内置基线
 * ```
 *
 * 「有覆盖但为空」是合法的：意思是「这个方剂我确认不挂图」，不能回落到基线。
 * 用 `hasOwnProperty` 判断，不能用 `overrides[id] ?? baseline` —— 空数组也是真值，
 * 但写成 `??` 会让人以为空数组能触发回落，读起来误导。
 *
 * ## 不在本地留缓存
 *
 * 目的就是「别的机器上也能看到」。本地兜底会让「已保存」变成谎话。
 */

export interface PatternsApi {
  /** 条目 id → 手改过的图 */
  overrides: Record<string, PulsePattern[]>
  /** 加载失败时的原因（界面要能看见，不能静默） */
  error: string | null
  /** 某条目最终显示哪几张 */
  patternsOf: (formulaId: string, baseline?: PulsePattern[]) => PulsePattern[]
  /** 这条有没有被手改过（决定要不要显示「恢复默认」） */
  isOverridden: (formulaId: string) => boolean
  /** 整条替换并落库 */
  save: (formulaId: string, patterns: PulsePattern[]) => Promise<void>
  /** 撤销覆盖，回到内置基线 */
  reset: (formulaId: string) => Promise<void>
  /** 重新拉一遍（导入数据、切账号后用） */
  reload: () => Promise<void>
}

const EMPTY: PatternsApi = {
  overrides: {},
  error: null,
  patternsOf: (formulaId, baseline) => {
    if (baseline && baseline.length > 0) return baseline
    const base = PATTERNS[formulaId]
    return base ? [base] : []
  },
  isOverridden: () => false,
  save: async () => {
    throw new Error('没有登录，改不了脉象图')
  },
  reset: async () => {
    throw new Error('没有登录，改不了脉象图')
  },
  reload: async () => {},
}

const PatternsCtx = createContext<PatternsApi>(EMPTY)

/** 组件里读合并结果：`const { patternsOf } = usePatterns()` */
export function usePatterns(): PatternsApi {
  return useContext(PatternsCtx)
}

/**
 * 登录后的子树外面包一层。挂载即拉一次覆盖层。
 *
 * ⚠️ 必须挂在「已登录」分支里 —— 未登录时拉会 401，
 *    而 401 会顺手清掉令牌并把页面踢回登录页（见 api/http.ts）。
 */
export function PatternsProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Record<string, PulsePattern[]>>({})
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const next = await listPatternOverrides()
      setOverrides(next)
      setError(null)
    } catch (e) {
      // 拉不到不影响看内置基线 —— 但要让人知道「你现在看到的是基线，手改的没取到」
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const save = useCallback(async (formulaId: string, patterns: PulsePattern[]) => {
    await saveFormulaPatterns(formulaId, patterns)
    // 服务端已确认落库，才更新本地 —— 顺序反了就会出现「界面有、库里没有」
    setOverrides((prev) => ({ ...prev, [formulaId]: patterns }))
    setError(null)
  }, [])

  const reset = useCallback(async (formulaId: string) => {
    await resetFormulaPatterns(formulaId)
    setOverrides((prev) => {
      const next = { ...prev }
      delete next[formulaId]
      return next
    })
  }, [])

  const value = useMemo<PatternsApi>(() => {
    const isOverridden = (formulaId: string) =>
      Object.prototype.hasOwnProperty.call(overrides, formulaId)

    return {
      overrides,
      error,
      isOverridden,
      patternsOf: (formulaId, baseline) => {
        if (isOverridden(formulaId)) return overrides[formulaId]
        if (baseline && baseline.length > 0) return baseline
        const base = PATTERNS[formulaId]
        return base ? [base] : []
      },
      save,
      reset,
      reload,
    }
  }, [overrides, error, save, reset, reload])

  return <PatternsCtx.Provider value={value}>{children}</PatternsCtx.Provider>
}
