import { useSyncExternalStore } from 'react'

import { getStorageSync, setStorageSync } from '../platform/storage'
import {
  contextAfterPatientChange,
  contextAfterVisitChange,
  emptyContext,
  normalizeContext,
  today,
} from './logic'
import { CONTEXT_KEY } from './types'
import type { VisitContext, VisitRef } from './types'

/**
 * 全局上下文 store —— **一份状态、四个 tab 共用、持久化**
 *
 * 订阅用 `useSyncExternalStore`（React 18 内置）：
 * 组件订阅这份状态，store 一变就重渲染，不会出现「各页各选各的」。
 *
 * 纯推导都在 `logic.ts`（可被回归脚本直接断言），这里只管存取与广播。
 */

type Listener = () => void

const listeners = new Set<Listener>()

function load(): VisitContext {
  try {
    const raw = getStorageSync(CONTEXT_KEY)
    return normalizeContext(raw ? JSON.parse(raw) : null)
  } catch {
    return emptyContext()
  }
}

let current: VisitContext = load()

/** 读当前上下文 */
export function getContext(): VisitContext {
  return current
}

/** 写当前上下文（落库 ＋ 广播） */
export function setContext(next: VisitContext): void {
  current = next
  try {
    setStorageSync(CONTEXT_KEY, JSON.stringify(next))
  } catch {
    /* 存不进去也不影响本次会话 */
  }
  listeners.forEach((fn) => fn())
}

/** 订阅（返回取消订阅函数） */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** React 订阅钩子 */
export function useVisitContext(): VisitContext {
  return useSyncExternalStore(subscribe, getContext, getContext)
}

/**
 * 切换患者。
 *
 * 规则见 `logic.ts` 的 `contextAfterPatientChange`：
 * 换人 → 就诊重置为该患者最近一次；没换人 → 尽量保留原就诊。
 */
export function selectPatient(patientId: string, visits: VisitRef[] | undefined | null): void {
  setContext(contextAfterPatientChange(patientId, visits, current))
}

/** 切换就诊（患者不变） */
export function selectVisit(visit: VisitRef | null): void {
  setContext(contextAfterVisitChange(current.patientId, visit))
}

/** 清空上下文（没选患者） */
export function clearContext(): void {
  setContext(emptyContext())
}

/** 「新建一次就诊」—— 上下文落到该患者、就诊待建 */
export function startNewVisit(patientId: string): void {
  setContext({ patientId, visitId: null, visitDate: today() })
}

export { CONTEXT_KEY, emptyContext, normalizeContext, today }
export type { VisitContext, VisitRef }
