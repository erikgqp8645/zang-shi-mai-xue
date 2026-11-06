import { useEffect } from 'react'
import type { PropsWithChildren } from 'react'
import './app.scss'

import { initCloud } from './platform/cloud'
import { CLOUD_ENV_ID, TRANSPORT } from './utils/config'

/**
 * 应用入口 —— 臧氏脉学 · 脉象记录表生成器（Taro 版）
 *
 * 与原生版 `miniprogram/app.js` 等价：拉起全局样式、注册全局登录态恢复。
 * 真正的「登录态恢复」在 `src/utils/auth.ts`（`restoreSession`），由各页在
 * `useEffect` 里调用 —— 这里不阻塞首屏。
 *
 * ## 云开发初始化
 *
 * TRANSPORT='cloud' 时**必须**先 `wx.cloud.init` —— 否则 `callFunction` 不可用。
 * 初始化失败不阻塞首屏（见 platform/cloud.ts 的 initCloud）：
 * api.ts 会自动退回 request 传输，小程序仍然能用。
 */
function App({ children }: PropsWithChildren) {
  useEffect(() => {
    if (TRANSPORT !== 'cloud') return
    const ok = initCloud(CLOUD_ENV_ID)
    if (!ok) {
      console.warn(
        '[臧氏脉学] 云开发初始化未成功，本次将退回 request 传输方式（请确认微信后台已关联 CloudBase 环境）',
      )
    }
  }, [])

  return children
}

export default App
