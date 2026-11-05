import Taro from '@tarojs/taro'

/**
 * 平台适配层 · 网络请求
 *
 * 只暴露一个 Promise 化的 `request`，微信与鸿蒙都走 `Taro.request`。
 * 状态码与错误对象的形状统一在这里定死，上层不必再判断平台。
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

/** 发一个请求；HTTP 层错误（4xx/5xx）不抛，交给调用方按 statusCode 判断 */
export function request(options: PlatformRequestOptions): Promise<PlatformResponse> {
  return Taro.request({
    url: options.url,
    method: options.method || 'GET',
    data: options.data as never,
    header: options.header,
  }).then((res) => ({ statusCode: res.statusCode, data: res.data }))
}
