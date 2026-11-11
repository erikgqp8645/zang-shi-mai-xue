import { getStorageSync, removeStorageSync, setStorageSync } from '../platform/storage'

/**
 * 小程序端配置
 *
 * 两件事：连哪台服务器、走哪种传输方式。
 *
 * **服务器地址可以在「我的」页里改**（改完存在本地，重开小程序仍然生效），
 * 所以换电脑、换局域网、真机调试时都不用改代码、不用重新编译 —— 这里这一份只是默认值。
 */

/**
 * 默认 API 根地址（**不带路径**，只到端口或域名）
 *
 * - 本机联调：微信开发者工具里勾上「不校验合法域名」，用 `http://127.0.0.1:5178`
 * - 真机联调：填电脑的局域网 IP，例如 `http://192.168.1.20:5178`（手机与电脑同一网段）
 * - 上线：填已备案域名的 https 地址，例如 `https://mai.example.com`
 *   —— 微信的 request 合法域名**不接受端口、不接受 IP、必须是 HTTPS 且已 ICP 备案**
 *
 * **上线包用环境变量注入**（编译期替换，见 `config/index.ts` 的 defineConstants）：
 *
 * ```bash
 * PULSE_API_BASE=https://mai.example.com npm run mp:taro:build
 * ```
 *
 * 不注入就用下面这个本机默认值；「我的」页里可以改（存在本地），不写死在包里。
 */
export const API_BASE = process.env.PULSE_API_BASE || 'http://127.0.0.1:5178'

/** 本地存储的键：使用者改过的服务器地址 */
export const API_BASE_KEY = 'pulse.apiBase'

/**
 * 传输方式
 *
 * - 'request'：走 `Taro.request`。受「request 合法域名」约束，需要 HTTPS ＋ 备案。
 * - 'cloud'  ：走 `wx.cloud.callFunction`，**不走合法域名校验**。
 *               迁到 CloudBase 后用这个，备案没下来也能先跑通。
 *
 * 两种方式的调用签名完全一样，页面代码不用改。
 *
 * **取值在编译期注入**（见 `config/index.ts` 的 defineConstants）：
 *
 * ```bash
 * PULSE_TRANSPORT=request npm --prefix taro run build:weapp   # 强制走 request
 * ```
 *
 * 不注入时：微信端默认 'cloud'，鸿蒙端默认 'request'
 * —— 鸿蒙没有 `wx.cloud`（见 platform/cloud.ts）。
 *
 * **运行时还有一层兜底**：云开发没初始化成功时，api.ts 会自动退回 'request'
 * （见 `utils/api.ts` 的 request()）。这样「微信后台还没关联 CloudBase 环境」
 * 时小程序仍然能用，而不是整屏报错。
 */
export const TRANSPORT: 'request' | 'cloud' =
  (process.env.PULSE_TRANSPORT as 'request' | 'cloud') || 'cloud'

/** TRANSPORT='cloud' 时的云函数名（CloudBase 上要部署一个同名云函数） */
export const CLOUD_FUNCTION_NAME = 'pulse-api'

/**
 * CloudBase 环境 id（`wx.cloud.init` 用）
 *
 * 编译期注入（`PULSE_CLOUD_ENV`），不注入就用下面这个默认值 ——
 * 即 `ambitious-parrot` 环境（ap-shanghai）。
 */
export const CLOUD_ENV_ID = process.env.PULSE_CLOUD_ENV || 'pulse-1-d0g880ydl8ddc57f6'

/**
 * 规范化一个地址：只认 http/https，去掉末尾斜杠
 * @returns 合法则返回规范化后的地址，否则返回空串
 */
export function normalizeBase(raw: unknown): string {
  const v = String(raw == null ? '' : raw).trim()
  if (!v) return ''
  if (!/^https?:\/\//i.test(v)) return ''
  // 末尾斜杠去掉：api.ts 里是 base + path，path 自带前导斜杠
  return v.replace(/\/+$/, '')
}

/** 使用者改过的地址（没改过 / 改坏了都返回空串） */
export function savedApiBase(): string {
  return normalizeBase(getStorageSync(API_BASE_KEY))
}

/** 当前实际用的地址：本地改过的优先，否则用默认值 */
export function resolveApiBase(): string {
  return savedApiBase() || API_BASE
}

export interface SetApiBaseResult {
  ok: boolean
  base: string
  error?: string
}

/**
 * 改服务器地址
 * @param raw 新地址；传空串＝恢复默认
 */
export function setApiBase(raw: unknown): SetApiBaseResult {
  const v = String(raw == null ? '' : raw).trim()
  try {
    if (!v) {
      removeStorageSync(API_BASE_KEY)
      return { ok: true, base: API_BASE }
    }
    const normalized = normalizeBase(v)
    if (!normalized) {
      return { ok: false, base: resolveApiBase(), error: '地址要以 http:// 或 https:// 开头' }
    }
    setStorageSync(API_BASE_KEY, normalized)
    return { ok: true, base: normalized }
  } catch (e) {
    return {
      ok: false,
      base: resolveApiBase(),
      error: '保存失败：' + ((e as Error)?.message || '本地存储不可用'),
    }
  }
}

/** 恢复默认地址 */
export function resetApiBase(): SetApiBaseResult {
  return setApiBase('')
}
