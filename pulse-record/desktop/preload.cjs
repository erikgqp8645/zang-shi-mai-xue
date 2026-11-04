/**
 * 渲染进程桥（preload）
 *
 * 只暴露**必要且最小**的能力：
 *   - saveBlob：把内容交给主进程，由系统「另存为」对话框落到用户选的位置
 *   - exportDb / importDb / openDataDir：主进程侧的整库操作
 *   - onDataChanged：主进程说「数据变了」，页面刷新病例列表
 *
 * **不暴露** db 路径、SQL、连接、原生能力 —— 渲染进程拿不到任意写盘的口子，
 * 只能写「用户在对话框里选定的那个路径」。
 *
 * 用 .cjs（CommonJS）：项目的 package.json 是 "type":"module"，
 * ESM preload 在部分 Electron 版本上有限制，CommonJS 最稳。
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('__pulseDesktop', {
  /** 把 blob 内容交给主进程另存为 */
  saveBlob: (base64, filename) => ipcRenderer.invoke('desktop:saveBlob', base64, filename),
  /** 导出整库快照 */
  exportDb: () => ipcRenderer.invoke('desktop:exportDb'),
  /** 导入别的库里的病例数据 */
  importDb: () => ipcRenderer.invoke('desktop:importDb'),
  /** 打开数据目录 */
  openDataDir: () => ipcRenderer.invoke('desktop:openDataDir'),
  /** 数据变了（导入后）→ 回调；返回一个取消订阅的函数 */
  onDataChanged: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('desktop:data-changed', listener)
    return () => ipcRenderer.removeListener('desktop:data-changed', listener)
  },
  platform: process.platform,
})
