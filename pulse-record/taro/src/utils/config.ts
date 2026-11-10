import { getStorageSync, removeStorageSync, setStorageSync } from '../platform/storage'
import { isRelease } from '../platform/version'

export { isRelease }

/**
 * 小程序端配置
 *
 * 两件事：连哪台服务器、走哪种传输方式。
 *
 * **服务器地址可以在「我的」页里改**（改完存在本地，重开小程序仍然生效），
 * 所以换电脑、换局域网、真机调试时都不用改代码、不用重新编译 —— 这里这一份只是默认值。
 */

/**
 * 默认 API 根地址（只到域名或端口；也可带一段路径，如 CloudBase 的 `/pulse-api` 网关）
 *
 * - 本机联调：微信开发者工具里勾上「不校验合法域名」，用 `http://127.0.0.1:5178`
 * - 真机联调：填电脑的局域网 IP，例如 `http://192.168.1.20:5178`（手机与电脑同一网段）
 * - 上线：填已备案域名的 https 地址，例如 `https://pulse.your-domain.cn`
 *   —— 微信的 request 合法域名**不接受端口、不接受 IP、必须是 HTTPS 且已 ICP 备案**
 *
 * ## 上线包请用环境变量注入（编译期替换，见 `config/index.ts` 的 defineConstants）
 *
 * ```bash
 * PULSE_API_BASE=https://pulse.your-domain.cn npm run mp:taro:build
 * ```
 *
 * 注入的值会先过**构建期校验**（`api-base-guard.ts`）：示例域名、占位写法、
 * 非 http(s) 一律让构建中止。
 *
 * ⚠️ **直接改下面这行的字面量也能生效，但绕过了那道校验。**
 * 2026-11-08 的事故就是从这条路来的：把文档示例域名写进了源码，
 * 构建一声不响地产出一个「装上就必然连不上」的包。
 * 真要改字面量，先确认那是你能连上的真实域名。
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
 * （见 `utils/api.ts` 的 request()）。这样「云通道在这个小程序里不可用」
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
 * 即 `pulse-1` 环境（ap-shanghai，PostgreSQL 后端）。
 *
 * ⚠️ **默认值必须指向当前在用的环境**：
 * 写死一个**已销毁**的环境 id，`wx.cloud.init` 照样「成功」（它不报错），
 * 错误要到第一次 `callFunction` 才抛 `-501000 Environment not found` ——
 * 表现是「云通道怎么都不通」，但根因只是这行字写旧了。
 * （2026-11-07 实测踩过：默认值还指着已销毁的 `ambitious-parrot`，
 *  于是「PG 环境小程序用不了」这个结论，一直建立在一个**从没测过 `pulse-1`** 的观测上。）
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

/**
 * 当前实际用的地址：本地改过的优先，否则用默认值
 *
 * ⚠️ **正式发布版例外**：固定用打包时写进去的 `API_BASE`，**忽略手机本地存的地址**。
 *
 * 原因：正式版里「我的」页的「服务器」界面**已经隐藏**（用户明确要求），
 * 使用者没有入口改地址 —— 若这里还读本地存的旧地址，
 * 手机上残留过一次旧地址的小程序就会连到一台**没人能改的服务器**，
 * 而且没有任何自救入口（界面藏了、地址也定死了）。
 */
export function resolveApiBase(): string {
  if (isRelease()) return API_BASE
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
