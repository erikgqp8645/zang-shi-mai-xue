/**
 * 平台适配层 · 小程序版本
 *
 * 只有一个用途：**判断当前跑的是不是「正式发布版」**。
 *
 * 微信用 `wx.getAccountInfoSync().miniProgram.envVersion`：
 *
 * | 值 | 对应 |
 * |---|---|
 * | `develop` | 开发者工具 / 真机调试 |
 * | `trial` | 上传后的体验版 |
 * | `release` | 审核通过、正式发布 |
 *
 * 鸿蒙侧没有这个概念 → 返回 `'unknown'`，一律按「非正式版」处理
 * （界面照常显示，行为与现在完全一致）。
 *
 * ## 为什么放在 platform 层
 *
 * 「业务代码里不许出现 `wx.`」是本工程的硬规矩（见 `AGENTS.md`）——
 * `wx.` 只能出现在 `platform/` 下的适配文件里，将来换平台只改这一处。
 *
 * ## 为什么用 `getAccountInfoSync` 而不是 `__wxConfig`
 *
 * `__wxConfig` 是微信内部对象、不是公开 API，随时可能变；
 * `getAccountInfoSync` 是官方接口（基础库 2.2.2+），行为有保证。
 */

/** 小程序运行环境版本 */
export type EnvVersion = 'develop' | 'trial' | 'release' | 'unknown'

declare const wx:
  | {
      getAccountInfoSync?: () => {
        miniProgram?: { envVersion?: string }
      }
    }
  | undefined

/**
 * ⚠️ **不缓存** —— `getAccountInfoSync` 是本地同步读，很便宜；
 *    而且缓存会让「同一个进程里切换版本」变得不可能
 *    （回归脚本要在一趟里分别验正式版／体验版／开发版三条分支）。
 */
export function envVersion(): EnvVersion {
  // 编译期注入的「预览正式版」开关（见 config/index.ts 的 defineConstants）。
  // 正式发布版要等备案＋审核才看得到那个界面 —— 本地想先看一眼就用它。
  // ⚠️ 这里的 `process.env.PULSE_FORCE_RELEASE` 在构建时被**替换成字面量**，
  //    产物里不会残留 `process.`（小程序运行时没有 process → 整屏白，2026-11-05 真出过）。
  if (process.env.PULSE_FORCE_RELEASE === '1') return 'release'
  if (typeof wx !== 'undefined' && typeof wx?.getAccountInfoSync === 'function') {
    try {
      const v = wx.getAccountInfoSync()?.miniProgram?.envVersion
      if (v === 'develop' || v === 'trial' || v === 'release') return v
    } catch {
      /* 读不到就当 unknown，不致命 */
    }
  }
  return 'unknown'
}

/**
 * 是不是**正式发布版**
 *
 * 正式版与开发版／体验版的差别不只是「界面」：
 * 正式版里「我的」页不暴露服务器地址与存储位置（见 `pages/me/index.tsx`），
 * 并且**固定用打包时写进去的地址**（见 `utils/config.ts` 的 `resolveApiBase`）。
 */
export function isRelease(): boolean {
  return envVersion() === 'release'
}
