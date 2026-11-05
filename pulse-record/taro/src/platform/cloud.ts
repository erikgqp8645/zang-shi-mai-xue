/**
 * 平台适配层 · 云函数传输（可选）
 *
 * `utils/config.ts` 的 `TRANSPORT` 为 `'cloud'` 时走这条路。
 *
 * ## 为什么保留它
 *
 * 2026-11-05 已核实：`wx.cloud` 的 6 处引用**全在可选传输分支里**，
 * 不是遗留死代码 —— 迁到 CloudBase 后（见 `docs/cloudbase-migration.md`），
 * 把 TRANSPORT 改成 `'cloud'` 就能**绕过 request 合法域名校验**，
 * 备案没下来也能先跑通。所以这条路要留着。
 *
 * `wx.cloud` 属云开发 SDK，**不受 Taro 影响** —— 它不进 Taro 的 API 面，
 * 在微信端运行时 `wx` 仍然是全局对象。鸿蒙侧没有 `wx`，
 * 所以这里全程 `typeof wx !== 'undefined'` 守卫。
 */

declare const wx: {
  cloud?: {
    callFunction(options: {
      name: string
      data: Record<string, unknown>
      success(res: { result?: unknown }): void
      fail(err: { errMsg?: string }): void
    }): void
  }
} | undefined

export interface CloudCallOptions {
  name: string
  data: Record<string, unknown>
}

/** 本平台有没有云开发能力 */
export function hasCloud(): boolean {
  return typeof wx !== 'undefined' && !!wx?.cloud
}

/**
 * 调一个云函数。
 *
 * CloudBase 云函数约定：
 *     exports.main = async (event, context) => {
 *       // event = { path, method, body, token }
 *       // 返回 { statusCode, body }
 *     }
 * 这样服务端那一套路由逻辑可以整体搬进云函数，小程序端不用改。
 */
export function callFunction(options: CloudCallOptions): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!hasCloud()) {
      reject(new Error('当前平台不支持云调用，请改用 request 传输方式'))
      return
    }
    wx!.cloud!.callFunction({
      name: options.name,
      data: options.data,
      success(res) {
        resolve(res.result)
      },
      fail(err) {
        reject(new Error(err.errMsg || '云调用失败'))
      },
    })
  })
}
