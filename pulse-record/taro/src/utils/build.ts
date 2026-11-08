/**
 * 构建标识 —— **一眼确认「现在跑的是不是刚构建的那一份」**
 *
 * ## 为什么要有它（2026-11-08 维护者反馈「依然还会自动登录」）
 *
 * 小程序的 JS bundle 在**服务上下文**里是缓存的：`reLaunch` 只换页面，
 * **不重新 require 产物**。所以「我改了代码、重新构建了」≠「模拟器里跑的是新代码」。
 * 那天就是：代码已经改了、提交已经推了，**但跑的还是旧 bundle**，
 * 于是「依然会自动登录」—— 改的地方根本没被执行到。
 *
 * → 光靠嘴上说「我改了」说服不了人，**界面上直接写出版本号**才有用。
 *   登录页与「我的」页底部都显示这一行：
 *
 *     版本 2026-11-08 13:52 · 6b997bc
 *
 *   看到的时间戳／提交号对不上，就是**旧包**，不是新代码没修好。
 *
 * ## 注入方式
 *
 * 两个常量都在**编译期**注入（见 `config/index.ts` 的 defineConstants）：
 *
 *     PULSE_BUILD_AT=2026-11-08 20:00 npm run mp:taro:build
 *
 * 不注入时用**构建那一刻**的时间戳与当时的 git 提交号（`6b997bc`，
 * 后面带 `*` 表示「构建时工作区有未提交改动」）。
 *
 * ⚠️ **产物里不许残留 `process.env.`** —— 小程序运行时没有 `process` 这个全局量，
 *    残留就是启动即抛「process is not defined」→ 整屏白（2026-11-05 真出过）。
 *    回归第 23 节专门盯这个。
 */

/** 构建时间（编译期注入，形如 `2026-11-08 13:52`） */
export const BUILD_AT = process.env.PULSE_BUILD_AT || ''

/** 构建时的 git 提交号（短 sha；带 `*` = 构建时工作区有未提交改动） */
export const BUILD_GIT = process.env.PULSE_BUILD_GIT || ''

/** 一行版本标识 —— 界面底部显示用 */
export function buildLabel(): string {
  const at = BUILD_AT || '构建时间未知'
  const git = BUILD_GIT ? ' · ' + BUILD_GIT : ''
  return '版本 ' + at + git
}
