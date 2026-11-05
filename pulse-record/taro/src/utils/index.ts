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
