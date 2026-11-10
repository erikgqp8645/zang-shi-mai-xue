/**
 * 小程序数据层工具的**打包入口** —— 只给回归脚本用
 *
 * `taro-api.mjs` 用 esbuild 把这个文件打成一个 ESM bundle，
 * 并把 `@tarojs/taro` 指向垫片、`@domain` / `@export` 指向真源码，
 * 然后在 Node 里 import 进来 —— 跑的是**真实的小程序代码**，不是复刻品。
 *
 * 只导出数据层那几层，不导出页面（页面要 DOM，跑不了）。
 */
export * as config from './config'
export * as storage from './storage'
export * as api from './api'
export * as auth from './auth'
export * as data from './data'
/** 登录流程的**纯判断** —— 回归要能逐条断言「什么时候会自动进去」 */
export * as authFlow from './auth-flow'
/** 构建标识 —— 回归要能断言产物里带了版本号 */
export * as build from './build'
/** 网络失败的诊断 —— 纯函数，回归要能逐条断言「哪种原因给出哪种提示」 */
export * as netError from './net-error'
/** 构建期地址校验 —— 纯函数，回归要能逐条断言「拦得住什么、放得过什么」 */
export * as apiBaseGuard from './api-base-guard'
// 云通道那一层也导出 —— 回归脚本要能**真的**把云调用模拟成失败，
// 才能验「云调用不可用 → 自动退回直连」这条兜底（cloud.ts 的模块状态是单例，
// 单独打一份 bundle 会变成两个实例，状态不共享，验不了）。
export * as cloud from '../platform/cloud'
