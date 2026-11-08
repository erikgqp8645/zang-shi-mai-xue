import Taro from '@tarojs/taro'

/**
 * 平台适配层 · 网络请求
 *
 * 只暴露一个 Promise 化的 `request`，微信与鸿蒙都走 `Taro.request`。
 * 状态码与错误对象的形状统一在这里定死，上层不必再判断平台。
 *
 * ## ⚠️ 失败时**必须把 `errMsg` 留下来**（2026-11-08 修）
 *
 * 微信的 `wx.request` 失败时给的是一个**普通对象**：
 *
 *     { errMsg: 'request:fail url not in domain list' }
 *
 * ⚠️ **它没有 `message` 字段** —— 字段名是 `errMsg`。
 *
 * 旧实现把失败对象整个丢掉（只 `.then()` 取 statusCode/data），
 * 于是上层 `(err as Error)?.message` 永远是 `undefined` →
 * 每次都落到「网络请求失败」那句兜底上 → **真实原因与目标地址全被吞掉**，
 * 使用者只看到一句「网络请求失败」，既不知道连的是哪台服务器，也不知道该改什么。
 *
 * 所以这里：**失败时抛一个带 `errMsg` 的 Error**（而不是让它以裸对象 reject），
 * 上层再拿 `err.errMsg` 去诊断（见 `utils/net-error.ts`）。
 */

export interface PlatformResponse {
  statusCode: number
  data: unknown
}

export interface PlatformRequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  data?: unknown
  header?: Record<string, string>
}

/** 网络层失败（HTTP 4xx/5xx 不算失败 —— 那是业务层的事） */
export interface PlatformRequestError extends Error {
  /** 平台给的原始原因（微信是 `errMsg`；鸿蒙/浏览器可能给 `message`） */
  errMsg: string
  /** 这次请求打到的地址 —— 诊断时要用 */
  url: string
}

/** 把平台给的失败对象归一成一个带 `errMsg` 的 Error */
export function toRequestError(err: unknown, url: string): PlatformRequestError {
  const src = (err || {}) as { errMsg?: unknown; message?: unknown }
  const raw = String(src.errMsg ?? src.message ?? '').trim()
  const e = new Error(raw || '网络请求失败') as PlatformRequestError
  e.name = 'PlatformRequestError'
  e.errMsg = raw || '网络请求失败'
  e.url = url
  return e
}

/** 发一个请求；HTTP 层错误（4xx/5xx）不抛，交给调用方按 statusCode 判断 */
export function request(options: PlatformRequestOptions): Promise<PlatformResponse> {
  return Taro.request({
    url: options.url,
    method: options.method || 'GET',
    data: options.data as never,
    header: options.header,
  }).then(
    (res) => ({ statusCode: res.statusCode, data: res.data }),
    // ⚠️ **失败分支必须显式接住** —— 不接的话 reject 的是裸对象，
    //    上层读 `.message` 读不到（微信给的是 `errMsg`）→ 真实原因丢失。
    (err) => {
      throw toRequestError(err, options.url)
    },
  )
}
