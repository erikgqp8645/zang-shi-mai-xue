/**
 * 共用的 HTTP 层 —— 带登录令牌的请求封装
 *
 * 令牌存在 localStorage（`pulse.token`），每次请求带 `Authorization: Bearer <token>`。
 *
 * **401 的处理**：令牌过期或没登录 → 清掉令牌 ＋ 抛 `ApiError(401)`，
 * 同时广播一个 `pulse:unauthorized` 事件，让 App 切回登录页。
 * 不能静默失败 —— 使用者要看得见「该重新登录了」。
 */

/** 令牌在 localStorage 里的键 */
const TOKEN_KEY = 'pulse.token'

/**
 * API 根地址。
 *
 * 默认空串＝同源（页面与 API 由同一个进程托管，本地与自建服务器部署都是这样）。
 *
 * **迁到 CloudBase 时需要设成绝对地址** —— 静态托管（`*.tcloudbaseapp.com`）
 * 与云函数 API 是两个不同的源，页面里要指向云函数那个域名：
 *
 *   VITE_API_BASE=https://<云函数域名或网关域名>
 *
 * 前端其余代码一律用相对路径 `/api/...`，只有这一处需要知道根地址。
 */
export const API_BASE = String(import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '')

/** 未授权事件名（App 监听它来切回登录页） */
export const UNAUTHORIZED_EVENT = 'pulse:unauthorized'

/** 带 HTTP 状态码的错误 */
export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** 取当前令牌 */
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

/** 存／清令牌 */
export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* 隐私模式等场景存不了，忽略 */
  }
}

/** 服务端没起／起不来时，给出可照做的提示，而不是静默丢数据 */
const OFFLINE =
  '连不上病例记录服务（/api/patients）。请用 npm run dev 起前后端（开发），或 npm run build && npm start（本地应用）。'

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  const token = getToken()
  try {
    res = await fetch(API_BASE + path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    })
  } catch {
    throw new ApiError(0, OFFLINE)
  }
  if (!res.ok) {
    // 502/503/504 多为代理连不上后端（服务没起），给可照做的提示
    if ([502, 503, 504].includes(res.status)) throw new ApiError(res.status, OFFLINE)
    let msg = `请求失败（${res.status}）`
    try {
      const body = await res.json()
      if (body?.error) msg = String(body.error)
    } catch {
      /* 保留默认信息 */
    }
    if (res.status === 401) {
      // 令牌失效：清掉 ＋ 通知 App 切回登录页
      setToken(null)
      try {
        window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
      } catch {
        /* 忽略 */
      }
    }
    throw new ApiError(res.status, msg)
  }
  return (await res.json()) as T
}
