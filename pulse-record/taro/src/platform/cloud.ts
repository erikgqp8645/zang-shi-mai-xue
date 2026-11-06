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
    init(options: { env: string; traceUser?: boolean }): void
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

/** 云开发是否可用（微信端且已 init 成功） */
let cloudReady = false

/** 云初始化失败的原因（用于给使用者看明白） */
let cloudError = ''

/**
 * 初始化云开发。
 *
 * **必须在第一次 callFunction 之前调** —— `wx.cloud.callFunction` 依赖 init 过的云上下文。
 *
 * 失败不抛异常：调用方（api.ts）会**自动退回 request 传输**，
 * 这样「环境还没关联」时小程序仍然能用（连本地服务器），而不是整屏报错。
 *
 * @param env CloudBase 环境 id
 * @returns 是否可用
 */
export function initCloud(env: string): boolean {
  if (typeof wx === 'undefined' || !wx?.cloud) {
    cloudError = '当前平台没有云开发能力（微信端以外）'
    return false
  }
  if (!env) {
    cloudError = '没有配置 CloudBase 环境 id'
    return false
  }
  try {
    wx.cloud.init({ env, traceUser: true })
    cloudReady = true
    cloudError = ''
    return true
  } catch (e) {
    cloudReady = false
    cloudError = (e as Error)?.message || '云开发初始化失败'
    return false
  }
}

/** 云开发能不能用 */
export function cloudAvailable(): boolean {
  return cloudReady
}

/** 云初始化失败的原因（没有失败则空串） */
export function cloudErrorMessage(): string {
  return cloudError
}

/**
 * 把云通道**关掉**（并记下原因）。
 *
 * ## 为什么需要它
 *
 * `wx.cloud.init()` 在「这个 appid 还没被授权用这个环境」时**不会报错** ——
 * 它照样初始化成功，错误要到**第一次 `callFunction`** 才抛出来：
 *
 *     errCode: -501000 | errMsg: Environment not found
 *
 * 所以「云开发能不能用」**不能只看 init 的结果**，得看第一次真调用的结果。
 * 一旦发现云调用不可用，就地把它关掉 —— 后面的请求直接走 request 传输，
 * 不用每次都去撞同一堵墙（每次都撞 = 每次都等一次超时）。
 */
export function disableCloud(reason: string): void {
  cloudReady = false
  cloudError = reason
}

/**
 * 把云调用的原始 errMsg 翻译成**能给人看**的中文。
 *
 * 原始报错长这样，又长又带 callid，给使用者看等于没看：
 *     cloud.callFunction:fail Error: errCode: -501000 | errMsg: Environment not found
 *     更多错误信息请访问: https://docs.cloudbase.net/error-code/basic/INVALID_ENV
 *     (callid: 1793943240389-...) (trace: 13:34:0 start->13:34:0 system error ...)
 */
export function describeCloudError(raw: string): string {
  const msg = String(raw ?? '')
  if (!msg) return '云调用失败'
  if (/Environment not found|INVALID_ENV|-501000/i.test(msg)) {
    return '云环境还没关联本小程序（CloudBase 环境未授权这个 appid），暂时改走直连'
  }
  if (/function not exist|FUNCTIONS_NOT_FOUND|-501005/i.test(msg)) {
    return '云函数不存在（还没部署或名字不对），暂时改走直连'
  }
  if (/request:fail|timeout|Timeout|-501000/.test(msg)) {
    return '云调用连不上，暂时改走直连'
  }
  // 认不出来就把原文截短一点，别把 callid / trace 整坨甩给人看
  const brief = msg.replace(/\s*\(callid:.*$/s, '').trim()
  return `云调用失败：${brief.slice(0, 80)}`
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

/**
 * 本平台有没有云开发能力（**未 init 也算没有** —— callFunction 依赖 init 过的上下文）
 */
export function hasCloud(): boolean {
  return cloudReady
}
