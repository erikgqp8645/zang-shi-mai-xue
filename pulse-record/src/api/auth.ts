/**
 * 账号 API —— 注册、登录、登出、改密、微信绑定
 *
 * 令牌由服务端签发（见 server/auth.mjs），存在 localStorage；
 * 请求一律走 api/http.ts 的 request()，自动带上 Authorization 头。
 *
 * 「网站与小程序互通」就落在这一层：
 * 网站用「登录名＋密码」，小程序用 wx.login 的 code 换 openid；
 * 两者是同一个账号上的两种登录身份（identities 表）。
 */

import { request, setToken, getToken, API_BASE } from './http'

/** 一个账号（对外可见的部分） */
export interface AuthUser {
  id: string
  /** 登录名（手机号或用户名） */
  loginName: string
  /** 昵称 */
  displayName: string
  role: string
}

/** 服务端当前状态 */
export interface ServerState {
  mode: 'single' | 'multi'
  db?: string
}

/** 是否已登录（有令牌） */
export function hasToken(): boolean {
  return !!getToken()
}

/** 注册并直接登录 */
export async function register(input: {
  loginName: string
  displayName: string
  password: string
}): Promise<AuthUser> {
  const { user, token } = await request<{ user: AuthUser; token: string }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  setToken(token)
  return user
}

/** 登录 */
export async function login(input: { loginName: string; password: string }): Promise<AuthUser> {
  const { user, token } = await request<{ user: AuthUser; token: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  setToken(token)
  return user
}

/** 退出登录（清本地令牌） */
export async function logout(): Promise<void> {
  try {
    await request<{ ok: true }>('/api/auth/logout', { method: 'POST' })
  } finally {
    setToken(null)
  }
}

/** 当前登录者；没登录或令牌失效 → null */
export async function me(): Promise<{ user: AuthUser; wechatBound: boolean } | null> {
  if (!hasToken()) return null
  try {
    return await request<{ user: AuthUser; wechatBound: boolean }>('/api/auth/me')
  } catch {
    return null
  }
}

/** 改密码（改完所有旧令牌失效，需要重新登录） */
export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await request<{ ok: true }>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ oldPassword, newPassword }),
  })
}

/** 小程序：wx.login 的 code 换身份 */
export type WechatLoginResult =
  | { status: 'bound'; user: AuthUser; token: string }
  | { status: 'need_bind' }

/**
 * 小程序登录：code → openid → 看这个微信身份绑没绑账号。
 * 绑了 → 直接登录；没绑 → need_bind，让用户输入网站账号密码去绑。
 */
export async function wechatLogin(code: string): Promise<WechatLoginResult> {
  const r = await request<WechatLoginResult>('/api/auth/wechat/login', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
  if (r.status === 'bound') setToken(r.token)
  return r
}

/**
 * 小程序绑定：用「网站账号＋密码」把当前微信身份绑到这个账号上。
 * 绑完两端看到同一份数据。
 */
export async function wechatBind(
  code: string,
  loginName: string,
  password: string,
): Promise<AuthUser> {
  const { user, token } = await request<{ status: 'bound'; user: AuthUser; token: string }>(
    '/api/auth/wechat/bind',
    { method: 'POST', body: JSON.stringify({ code, loginName, password }) },
  )
  setToken(token)
  return user
}

/** 解绑微信身份 */
export async function unbindWechat(): Promise<void> {
  await request<{ ok: true }>('/api/auth/wechat', { method: 'DELETE' })
}

/** 服务端状态（单机／多用户、数据库位置） */
export async function serverState(): Promise<ServerState> {
  try {
    const res = await fetch(API_BASE + '/api/health')
    if (!res.ok) return { mode: 'multi' }
    const d = await res.json()
    return { mode: d?.mode === 'single' ? 'single' : 'multi', db: d?.db }
  } catch {
    return { mode: 'multi' }
  }
}
