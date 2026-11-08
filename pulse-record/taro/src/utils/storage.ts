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
 * ## 它管什么、不管什么（2026-11-08 改了定位）
 *
 * **管**：登录页据此**告知**用户「你刚才点了退出登录，要用请点下面的按钮」。
 *
 * **不管**：**不再决定「要不要自动进入」** —— 现在两种模式都得用户点一下
 * （维护者 2026-11-08 拍板），压根没有自动进入这回事。
 * （它曾经管过：单机模式自动进、退出后又被自动带回 —— 那条路已经整个拆掉了。）
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
