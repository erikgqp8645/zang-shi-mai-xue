/**
 * 桌面版桥接层的类型声明
 *
 * 页面跑在两种环境里：
 *   - Web 端（浏览器打开）：没有 `window.__pulseDesktop` → 走原来的浏览器下载
 *   - 桌面版（Electron）：有 → 走系统「另存为」对话框
 *
 * 这个文件没有 import/export，是**全局脚本**，
 * 所以 `interface Window` 直接与 lib.dom 的 Window 合并。
 */

interface PulseDesktopBridge {
  /** 把 base64 内容交给主进程，走系统另存为对话框 */
  saveBlob(base64: string, filename: string): Promise<{
    ok: boolean
    path?: string
    canceled?: boolean
    error?: string
  }>
  /** 导出整库快照（备份） */
  exportDb(): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
  /** 导入别的库里的病例数据 */
  importDb(): Promise<{
    ok: boolean
    path?: string
    canceled?: boolean
    error?: string
    summary?: Record<string, { imported: number; skipped: number }>
  }>
  /** 打开数据目录 */
  openDataDir(): Promise<{ ok: boolean; path?: string; error?: string }>
  /** 数据变了（导入后）→ 回调；返回一个取消订阅的函数 */
  onDataChanged(cb: () => void): () => void
  /** 桌面端平台（win32 / darwin / linux） */
  platform: string
}

interface Window {
  /** 桌面版才有；Web 端是 undefined */
  __pulseDesktop?: PulseDesktopBridge
}
