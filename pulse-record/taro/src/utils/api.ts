import Taro from '@tarojs/taro'

import { callFunction, cloudAvailable, describeCloudError, disableCloud } from '../platform/cloud'
import { request as platformRequest } from '../platform/request'
import { CLOUD_FUNCTION_NAME, TRANSPORT, isRelease, resolveApiBase } from './config'
import { describeNetFailure, formatNetFailure } from './net-error'
import type { NetFailure } from './net-error'
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
  /**
   * 网络失败的**结构化诊断**（见 `utils/net-error.ts`）
   *
   * 只有传输层失败（status 0）才有；业务错误（4xx/5xx）没有。
   * 页面用它渲染「结论 + 真实原因 + 目标地址 + 怎么改」，
   * 而不是只显示一句 `message`。
   */
  detail?: NetFailure

  constructor(message: string, status: number, detail?: NetFailure) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
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

  const url = resolveApiBase() + options.path
  let res: { statusCode: number; data: unknown }
  try {
    res = await platformRequest({
      url,
      method: options.method || 'GET',
      data: options.body,
      header,
    })
  } catch (err) {
    // ⚠️ **这里必须把平台给的真实原因取出来**（2026-11-08 修）
    //    微信的失败对象字段名是 `errMsg`，不是 `message` ——
    //    只读 `.message` 永远拿到 undefined，于是每次都显示笼统的「网络请求失败」，
    //    使用者既看不到真实原因，也看不到连的是哪台服务器。
    const raw = String((err as { errMsg?: unknown })?.errMsg ?? (err as Error)?.message ?? '')
    const detail = describeNetFailure({
      raw,
      url,
      transport: 'request',
      release: isRelease(),
    })
    throw new ApiError(formatNetFailure(detail), 0, detail)
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
    const raw = String((err as { errMsg?: unknown })?.errMsg ?? (err as Error)?.message ?? '')
    const detail = describeNetFailure({
      raw,
      url: '云函数 ' + CLOUD_FUNCTION_NAME,
      transport: 'cloud',
      release: isRelease(),
    })
    throw new ApiError(formatNetFailure(detail), 0, detail)
  }

  const res = (r || {}) as { statusCode?: number; body?: unknown }
  const status = res.statusCode || 500

  // 云函数返回的 body 是**JSON 字符串**（HTTP 语义），这里解出来当对象用 ——
  // 与 request 传输下 `res.data` 已经是对象的形状保持一致，页面不用区分两种传输。
  let data: { error?: string } = {}
  const raw = res.body
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      data = parsed && typeof parsed === 'object' ? parsed : { error: raw }
    } catch {
      data = { error: raw }
    }
  } else if (raw && typeof raw === 'object') {
    data = raw as { error?: string }
  }

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

/**
 * 发一个请求
 *
 * **传输方式在运行时还有一层兜底**：TRANSPORT='cloud' 但云调用不可用时，
 * 自动退回 'request' 传输。
 *
 * ## 兜底为什么要放在「调用失败」这一步，不是「init 失败」那一步
 *
 * `wx.cloud.init()` 在「这个 appid 还没被授权用这个环境」时**不会报错** ——
 * 它照样初始化成功，错误要到**第一次 `callFunction`** 才抛：
 *
 *     errCode: -501000 | errMsg: Environment not found
 *
 * 所以只看 `init` 的返回值是不够的 —— 会误以为云通道可用，
 * 然后每个请求都去撞同一堵墙（每次都等一次超时），用户只看到一屏原始报错。
 *
 * 现在的做法：云调用**传输层**失败（status 0）→ 把云通道关掉 → 本次请求改走直连。
 * 关掉之后，后面的请求直接走直连，不再重复试错。
 *
 * 为什么不直接报错：那样整个小程序会连「打开即白屏」——
 * 而退回 request 至少还能连本机/服务器上的服务（开发时）、或已备案域名（上线后）。
 *
 * **只对传输层失败兜底**：云函数自己返回的 401 等业务错误**不能**退回 ——
 * 那会让同一个错误被处理两遍（令牌清两次、reLaunch 两次）。
 */
export async function request(options: RequestOptions): Promise<unknown> {
  if (TRANSPORT === 'cloud' && cloudAvailable()) {
    try {
      return await viaCloud(options)
    } catch (err) {
      const transportFailed = err instanceof ApiError && err.status === 0
      if (!transportFailed) throw err

      // 云调用本身不可用 —— 关掉云通道，改走直连
      const reason = describeCloudError((err as Error)?.message ?? '')
      disableCloud(reason)
      try {
        return await viaRequest(options)
      } catch (err2) {
        const e2 = err2 as ApiError
        // ⚠️ **两条原因都要给，但「直连」那条才是最终诊断** ——
        //    云通道失败通常只是「这个 appid 没关联云环境」，
        //    而直连失败才是「连的这台服务器根本不通」——使用者在手机上真正撞到的是后者。
        const detail = e2.detail
        const message =
          reason + '；改走直连也失败：' + (detail ? formatNetFailure(detail) : e2.message || '未知错误')
        throw new ApiError(message, 0, detail)
      }
    }
  }
  return viaRequest(options)
}
