/**
 * 病例库与 Electron 缓存的落点判定 —— **纯函数，不依赖 electron**，方便单测。
 *
 * 两种发行形态落在不同地方：
 *
 * | 形态 | 病例库 | 怎么认出来的 |
 * |---|---|---|
 * | 安装版 | `%APPDATA%\臧氏脉学\history.sqlite` | 默认 |
 * | **免安装版** | **exe 旁边的 `data\history.sqlite`** | electron-builder 的 portable 目标会设 `PORTABLE_EXECUTABLE_DIR` |
 *
 * 为什么免安装版要单独落点：U 盘带着 exe 走，换台电脑打开，病例得还在。
 * 初版两个形态都写 `%APPDATA%` —— 那不叫便携。
 */

import { join } from 'node:path'

/** 安装版的目录名 */
export const INSTALLED_DIR_NAME = '臧氏脉学'
/** 免安装版的目录名（与安装版分开，见 resolveUserDataDir 的说明） */
export const PORTABLE_DIR_NAME = '臧氏脉学（便携版）'
/** 免安装版在 exe 旁边建的病例库子目录 */
export const PORTABLE_DATA_SUBDIR = 'data'

/**
 * 病例库所在目录。
 *
 * @param {object} opts
 * @param {string|null} opts.portableDir   便携版所在目录（PORTABLE_EXECUTABLE_DIR）
 * @param {string} opts.appDataRoot        Electron 的 appData 根目录（%APPDATA%）
 * @param {string|null} opts.override      显式覆盖（PULSE_DATA_DIR，开发／测试用）
 */
export function resolveDataDir({ portableDir = null, appDataRoot, override = null } = {}) {
  if (override) return override
  if (portableDir) return join(portableDir, PORTABLE_DATA_SUBDIR)
  return join(appDataRoot, INSTALLED_DIR_NAME)
}

/**
 * Electron 自己的 userData 目录（缓存 / Local Storage / 单实例锁）。
 *
 * **始终留在本机**，不跟 exe 走 —— Chromium 缓存又大又频繁写，放 U 盘上既污染又磨盘。
 *
 * 便携版与安装版**必须分开**：单实例锁是按 userData 路径算的，
 * 两者同目录的话，装了安装版再开便携版会被当成「同一个 App」——
 * 便携版双击毫无反应，只是把安装版的窗口顶到前面。
 */
export function resolveUserDataDir({ portableDir = null, appDataRoot } = {}) {
  return join(appDataRoot, portableDir ? PORTABLE_DIR_NAME : INSTALLED_DIR_NAME)
}
