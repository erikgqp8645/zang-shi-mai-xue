import { getStorageSync, removeStorageSync, setStorageSync } from '../platform/storage'

/**
 * 本地存储 —— 账号凭证
 *
 * 与网站端一一对应：
 *   localStorage['pulse.token'] → getStorageSync('pulse.token')
 */

export const TOKEN_KEY = 'pulse.token'
export const USER_KEY = 'pulse.user'

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
