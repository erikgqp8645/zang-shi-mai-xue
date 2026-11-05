import type { PropsWithChildren } from 'react'
import './app.scss'

/**
 * 应用入口 —— 臧氏脉学 · 脉象记录表生成器（Taro 版）
 *
 * 与原生版 `miniprogram/app.js` 等价：拉起全局样式、注册全局登录态恢复。
 * 真正的「登录态恢复」在 `src/utils/auth.ts`（`restoreSession`），由各页在
 * `useEffect` 里调用 —— 这里不阻塞首屏。
 */
function App({ children }: PropsWithChildren) {
  return children
}

export default App
