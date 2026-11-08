import { getStorageSync, removeStorageSync, setStorageSync } from '../platform/storage'

/**
 * 本地存储 —— 账号凭证
 *
 * 与网站端一一对应：
 *   localStorage['pulse.token'] → getStorageSync('pulse.token')
 */

export const TOKEN_KEY = 'pulse.token'
export const USER_KEY = 'pulse.user'

/**
 * 「刚被退出过」的标记
 *
 * ## 为什么需要它（2026-11-08）
 *
 * 单机模式本来是「进登录页就自动进去」（不用登录嘛）。但维护者反馈
 * 「点退出登录后又被自动带回病例页」—— **退出退不掉**。
 *
 * 光靠「登录页不自动登录」修不掉这一条：单机模式那条路**压根不登录**，
 * 它是 `health()` 说「我是单机模式」→ 直接 `goCases()`。
 *
 * → 所以要一个**跨页面的本地标记**：点了「退出登录」就记一笔，
 *   登录页看到这笔就不再自动进，改成给一个「继续使用（单机模式）」按钮。
 *
 * ⚠️ **这个标记不能被 `clearAuth()` 清掉** —— 登出流程是
 *   「先标记 → 再清凭证」，顺序反了这个标记就等于没写。
 */
export const LOGGED_OUT_KEY = 'pulse.loggedOut'

export interface StoredUser {
  id?: string
  loginName?: string
  displayName?: string
  roles?: string[]
  [k: string]: unknown
}

export function getToken(): string {
  return getStorageSync(TOKEN_KEY)
}

export function setToken(token: string): void {
  setStorageSync(TOKEN_KEY, token)
}

export function getUser(): StoredUser | null {
  const raw = getStorageSync(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredUser
  } catch {
    return null
  }
}

export function setUser(user: StoredUser): void {
  setStorageSync(USER_KEY, JSON.stringify(user))
}

export function clearAuth(): void {
  removeStorageSync(TOKEN_KEY)
  removeStorageSync(USER_KEY)
}

/* --------------------------- 「刚被退出过」的标记 --------------------------- */

/**
 * 记一笔「用户刚点了退出登录」
 *
 * ⚠️ **必须在清凭证之前调** —— 登出流程是「先标记 → 再清凭证」，
 *    顺序反了这个标记就等于没写（`clearAuth()` 只清 token/user，不碰这个键，
 *    但流程顺序仍按「先标记」写，别让人以后顺手调换）。
 */
export function markLoggedOut(): void {
  setStorageSync(LOGGED_OUT_KEY, '1')
}

/** 本地是否记着「刚被退出过」 */
export function wasLoggedOut(): boolean {
  return getStorageSync(LOGGED_OUT_KEY) === '1'
}

/** 清掉「刚被退出过」—— 登录成功、或用户主动点「继续使用」时调 */
export function clearLoggedOutMark(): void {
  removeStorageSync(LOGGED_OUT_KEY)
}
