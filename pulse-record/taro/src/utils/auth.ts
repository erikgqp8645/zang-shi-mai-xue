import { loginCode } from '../platform/auth'
import { request } from './api'
import { clearAuth, getToken, setToken, setUser, type StoredUser } from './storage'

/**
 * 账号 —— 微信登录 / 账号密码绑定 / 注册 / 登出
 *
 * 账号模型（与服务端一致）：一个 `users` 账号挂多种登录身份（`identities`）。
 * 小程序用「网站账号＋密码」把微信身份绑到同一个账号上，绑定后两端看到同一份数据。
 *
 * 登录 code **一次性、时效短**，服务端收到后立即用掉；
 * 失败要能重试 —— 所以每次都重新拿新 code。
 */

export interface AuthPayload {
  status?: 'bound' | 'need_bind'
  token?: string
  user?: StoredUser
}

/** 记住登录结果 */
export function acceptAuth(payload: AuthPayload): AuthPayload {
  if (payload && payload.token) setToken(payload.token)
  if (payload && payload.user) setUser(payload.user)
  return payload
}

/**
 * 微信登录
 * @returns `{status:'bound',user,token}` 或 `{status:'need_bind'}`
 */
export async function wechatLogin(): Promise<AuthPayload> {
  const code = await loginCode()
  const data = (await request({
    method: 'POST',
    path: '/api/auth/wechat/login',
    body: { code },
  })) as AuthPayload
  if (data && data.status === 'bound') acceptAuth(data)
  return data
}

/**
 * 用「网站账号＋密码」把当前微信身份绑到该账号
 */
export async function wechatBind(loginName: string, password: string): Promise<AuthPayload> {
  const code = await loginCode()
  const data = (await request({
    method: 'POST',
    path: '/api/auth/wechat/bind',
    body: { code, loginName, password },
  })) as AuthPayload
  if (data && data.token) acceptAuth(data)
  return data
}

/** 账号密码登录 */
export async function login(loginName: string, password: string): Promise<AuthPayload> {
  const data = (await request({
    method: 'POST',
    path: '/api/auth/login',
    body: { loginName, password },
  })) as AuthPayload
  return acceptAuth(data)
}

/** 注册新账号（同时登录） */
export async function register(
  loginName: string,
  displayName: string,
  password: string,
): Promise<AuthPayload> {
  const data = (await request({
    method: 'POST',
    path: '/api/auth/register',
    body: { loginName, displayName, password },
  })) as AuthPayload
  return acceptAuth(data)
}

/** 当前登录者 ＋ 微信绑定状态 */
export async function me(): Promise<AuthPayload> {
  const data = (await request({ method: 'GET', path: '/api/auth/me' })) as AuthPayload
  if (data && data.user) setUser(data.user)
  return data
}

/** 改密码（改完服务端会清掉本人全部会话） */
export function changePassword(oldPassword: string, newPassword: string): Promise<unknown> {
  return request({
    method: 'POST',
    path: '/api/auth/change-password',
    body: { oldPassword, newPassword },
  })
}

/** 解绑微信身份 */
export function unbindWechat(): Promise<unknown> {
  return request({ method: 'DELETE', path: '/api/auth/wechat' })
}

/** 登出（本地清凭证；服务端会话由服务端删） */
export async function logout(): Promise<void> {
  try {
    await request({ method: 'POST', path: '/api/auth/logout' })
  } catch {
    /* 令牌已失效也算登出成功 */
  }
  clearAuth()
}

/** 本地有没有登录态 */
export function isLoggedIn(): boolean {
  return !!getToken()
}
