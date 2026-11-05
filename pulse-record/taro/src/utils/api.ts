import Taro from '@tarojs/taro'

import { callFunction } from '../platform/cloud'
import { request as platformRequest } from '../platform/request'
import { CLOUD_FUNCTION_NAME, TRANSPORT, resolveApiBase } from './config'
import { clearAuth, getToken } from './storage'

/**
 * API 传输层
 *
 * 上层（页面）只认一个签名：
 *
 *     request({ method, path, body }) → Promise<data>
 *
 * 底下用哪种传输（Taro.request / 云函数）由 `utils/config.ts` 的
 * TRANSPORT 决定 —— 迁到 CloudBase 时只改配置，页面代码一行不动。
 *
 * 鉴权：令牌放在 `Authorization: Bearer <token>` 头（与服务端一致）。
 * 401 → 清令牌 ＋ 跳回登录页（不静默失败）。
 *
 * 服务器地址**每次请求都从 config 现取**（`resolveApiBase()`），
 * 所以在「我的」页改完地址立刻生效，不用重启小程序。
 */

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  body?: unknown
}

/** 令牌失效：清掉本地凭证并回登录页 */
function onUnauthorized(): void {
  clearAuth()
  const pages = Taro.getCurrentPages()
  const cur = pages.length ? pages[pages.length - 1] : null
  if (!cur || cur.route !== 'pages/login/index') {
    Taro.reLaunch({ url: '/pages/login/index' })
  }
}

/* ------------------------------ Taro.request ------------------------------ */

async function viaRequest(options: RequestOptions): Promise<unknown> {
  const token = getToken()
  const header: Record<string, string> = { 'content-type': 'application/json' }
  if (token) header.Authorization = 'Bearer ' + token

  let res: { statusCode: number; data: unknown }
  try {
    res = await platformRequest({
      url: resolveApiBase() + options.path,
      method: options.method || 'GET',
      data: options.body,
      header,
    })
  } catch (err) {
    throw new ApiError((err as Error)?.message || '网络请求失败', 0)
  }

  const data = (res.data || {}) as { error?: string }
  if (res.statusCode === 401) {
    onUnauthorized()
    throw new ApiError(data.error || '请先登录', 401)
  }
  if (res.statusCode >= 400) {
    throw new ApiError(data.error || `请求失败（${res.statusCode}）`, res.statusCode)
  }
  return data
}

/* ------------------------------ 云函数调用 ------------------------------ */

async function viaCloud(options: RequestOptions): Promise<unknown> {
  let r: unknown
  try {
    r = await callFunction({
      name: CLOUD_FUNCTION_NAME,
      data: {
        path: options.path,
        method: options.method || 'GET',
        body: options.body || null,
        token: getToken() || '',
      },
    })
  } catch (err) {
    throw new ApiError((err as Error)?.message || '云调用失败', 0)
  }

  const res = (r || {}) as { statusCode?: number; body?: { error?: string } }
  const status = res.statusCode || 500
  const data = res.body || {}
  if (status === 401) {
    onUnauthorized()
    throw new ApiError(data.error || '请先登录', 401)
  }
  if (status >= 400) {
    throw new ApiError(data.error || `请求失败（${status}）`, status)
  }
  return data
}

/* --------------------------------- 对外 --------------------------------- */

/** 发一个请求 */
export function request(options: RequestOptions): Promise<unknown> {
  if (TRANSPORT === 'cloud') return viaCloud(options)
  return viaRequest(options)
}
