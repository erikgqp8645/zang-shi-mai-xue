/**
 * Electron 主进程 —— 臧氏脉学 · 脉象记录表（桌面版）
 *
 * 桌面壳只做三件事：**起服务进程、开窗口、管导出另存为**。
 * 业务逻辑一行不重写 —— 页面还是那份 `dist/`，接口还是那份 `server/`。
 *
 * 关键约定：
 * - 服务跑在 **utilityProcess 子进程**里（不是主进程）——
 *   SQLite 的句柄、WAL 状态都在那边，退出时正常 kill 即可。
 *   ⚠️ 桌面端代码里**禁止出现 wal_checkpoint**（历史上出过孤儿 WAL → 退出全丢的事故）。
 * - 窗口加载 `http://127.0.0.1:<端口>/`，**同源** → 页面里的 `/api/…` 相对路径直接可用。
 * - 数据只落在本机一个 SQLite 文件：%APPDATA%\臧氏脉学\history.sqlite
 * - 单机免登录：子进程固定带 PULSE_SINGLE_USER=1
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, shell, utilityProcess } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
/** 开发态的仓库根（打包后 this 指向 asar 内） */
const REPO = join(here, '..')
/** 前端构建产物：打包后放在 asar **外**（resources/ui）—— 静态托管路径要物理路径明确 */
const UI_DIR = app.isPackaged ? join(process.resourcesPath, 'ui') : join(REPO, 'dist')
/** 数据目录：%APPDATA%\臧氏脉学（可用 PULSE_DATA_DIR 覆盖，方便开发与测试） */
const DATA_DIR = process.env.PULSE_DATA_DIR ?? join(app.getPath('appData'), '臧氏脉学')
const DB_PATH = join(DATA_DIR, 'history.sqlite')

/** 窗口标题 */
const WINDOW_TITLE = '臧氏脉学 · 脉象记录表'

let mainWindow = null
let serverProcess = null
let serverPort = 0

/** 父进程 → 子进程的请求（导出／导入）用 id 配对 */
let reqSeq = 0
const pending = new Map()

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

// 单实例锁：第二次启动只把已有窗口顶到前面，不起第二个服务
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  // 数据目录固定到 %APPDATA%\臧氏脉学（要在 app ready 之前设）
  app.setPath('userData', DATA_DIR)

  app.whenReady().then(bootstrap)
}

async function bootstrap() {
  mkdirSync(DATA_DIR, { recursive: true })
  registerIpc()
  buildMenu()
  startServer()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('window-all-closed', () => {
  app.quit()
})

/** 退出时把服务子进程带走，让 SQLite 正常收尾（**不做 checkpoint**） */
app.on('before-quit', () => {
  app.isQuitting = true
  if (serverProcess) {
    try {
      serverProcess.kill()
    } catch {
      /* 子进程可能已经自己退了 */
    }
  }
})

/* ------------------------------------------------------------------ */
/* 服务子进程                                                          */
/* ------------------------------------------------------------------ */

function startServer() {
  serverProcess = utilityProcess.fork(join(here, 'server-entry.mjs'), [], {
    serviceName: '臧氏脉学 病例记录服务',
    stdio: 'pipe',
    env: {
      ...process.env,
      // 单机免登录
      PULSE_SINGLE_USER: '1',
      // 数据只落本机这一个文件
      PULSE_DB: DB_PATH,
      // 前端页面：打包后指向 asar 外的 resources/ui
      PULSE_DIST: UI_DIR,
    },
  })

  serverProcess.stdout?.on('data', (d) => process.stdout.write(d))
  serverProcess.stderr?.on('data', (d) => process.stderr.write(d))

  serverProcess.on('message', (msg) => {
    if (!msg) return
    if (msg.type === 'listening') {
      serverPort = msg.port
      console.log(`[臧氏脉学] 桌面版服务已启动：http://127.0.0.1:${serverPort}/`)
      console.log(`[臧氏脉学] 数据文件：${DB_PATH}`)
      createWindow()
      return
    }
    if (msg.type === 'result') {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.ok) p.resolve(msg.data)
      else p.reject(new Error(msg.error ?? '未知错误'))
    }
  })

  serverProcess.on('exit', (code) => {
    console.error(`[臧氏脉学] 服务子进程已退出（code=${code}）`)
    if (!app.isQuitting) {
      dialog.showErrorBox('臧氏脉学', `病例记录服务意外退出（code=${code}），请重新打开本程序。`)
      app.quit()
    }
  })
}

/** 让子进程做一件只有它能做的事（它握着打开着的 db 句柄） */
function askServer(action, payload) {
  const id = `r${++reqSeq}`
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    serverProcess.postMessage({ type: 'req', id, action, payload })
  })
}

/* ------------------------------------------------------------------ */
/* 窗口                                                                */
/* ------------------------------------------------------------------ */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    title: WINDOW_TITLE,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      // 渲染进程拿不到 db 路径／SQL／连接 —— 只给「另存为」这一个写文件能力
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  })

  const base = `http://127.0.0.1:${serverPort}/`

  // 导航收紧：只许在本地服务里跳，外部链接一律拦掉（要开就用系统浏览器）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(base)) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(base)) event.preventDefault()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.loadURL(base)
}

/* ------------------------------------------------------------------ */
/* IPC：写文件的能力都在主进程                                         */
/* ------------------------------------------------------------------ */

/** 系统对话框（有窗口时挂在窗口下，没有就独立弹） */
async function showSave(options) {
  return mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options)
}

/** 系统打开对话框 */
async function showOpen(options) {
  return mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
}

/** 系统提示框 */
async function showMessage(options) {
  return mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options)
}

function registerIpc() {
  /** 另存为：渲染进程只给「内容」和「建议文件名」，路径由用户在系统对话框里选 */
  ipcMain.handle('desktop:saveBlob', async (_event, base64, filename) => {
    try {
      const { canceled, filePath } = await showSave({
        title: '另存为',
        defaultPath: filename,
      })
      if (canceled || !filePath) return { ok: false, canceled: true }
      writeFileSync(filePath, Buffer.from(base64, 'base64'))
      return { ok: true, path: filePath }
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) }
    }
  })

  /** 导出整库快照（备份） */
  ipcMain.handle('desktop:exportDb', async () => {
    try {
      const { canceled, filePath } = await showSave({
        title: '导出数据文件（备份）',
        defaultPath: '臧氏脉学-数据备份.sqlite',
        filters: [{ name: 'SQLite 数据库', extensions: ['sqlite'] }],
      })
      if (canceled || !filePath) return { ok: false, canceled: true }
      await askServer('export-db', { target: filePath })
      return { ok: true, path: filePath }
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) }
    }
  })

  /** 导入老数据（把别的库里的病例并进来，一律归到本机账号名下） */
  ipcMain.handle('desktop:importDb', async () => {
    try {
      const { canceled, filePaths } = await showOpen({
        title: '导入数据文件',
        properties: ['openFile'],
        filters: [{ name: 'SQLite 数据库', extensions: ['sqlite', 'db'] }],
      })
      if (canceled || !filePaths || filePaths.length === 0) return { ok: false, canceled: true }
      const summary = await askServer('import-db', { source: filePaths[0] })
      notifyDataChanged()
      return { ok: true, path: filePaths[0], summary }
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) }
    }
  })

  /** 打开数据目录 */
  ipcMain.handle('desktop:openDataDir', async () => {
    await shell.openPath(DATA_DIR)
    return { ok: true, path: DATA_DIR }
  })
}

/** 通知页面：数据变了，刷新病例列表 */
function notifyDataChanged() {
  mainWindow?.webContents.send('desktop:data-changed')
}

/* ------------------------------------------------------------------ */
/* 菜单                                                                */
/* ------------------------------------------------------------------ */

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '导出数据文件（备份）…',
          click: () => void doExportDb(),
        },
        {
          label: '导入数据文件…',
          click: () => void doImportDb(),
        },
        {
          label: '打开数据目录',
          click: () => void shell.openPath(DATA_DIR),
        },
        { type: 'separator' },
        { label: '退出', role: 'quit' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于臧氏脉学',
          click: () => {
            void dialog.showMessageBox(mainWindow ?? undefined, {
              type: 'info',
              title: '关于',
              message: `臧氏脉学 · 脉象记录表\n\n版本 ${app.getVersion()}\n单机模式（不用登录）\n数据文件：${DB_PATH}`,
              detail:
                '本程序只是脉象记录的记录与整理工具，\n所载方剂与脉象判读均照录讲义与讲稿原文，不构成诊断。',
            })
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** 菜单里的「导出数据文件」 */
async function doExportDb() {
  const { canceled, filePath } = await showSave({
    title: '导出数据文件（备份）',
    defaultPath: '臧氏脉学-数据备份.sqlite',
    filters: [{ name: 'SQLite 数据库', extensions: ['sqlite'] }],
  })
  if (canceled || !filePath) return
  try {
    await askServer('export-db', { target: filePath })
    await showMessage({
      type: 'info',
      title: '导出数据文件',
      message: '已导出：',
      detail: filePath,
    })
  } catch (err) {
    await dialog.showErrorBox('导出失败', String(err?.message ?? err))
  }
}

/** 菜单里的「导入数据文件」 */
async function doImportDb() {
  const { canceled, filePaths } = await showOpen({
    title: '导入数据文件',
    properties: ['openFile'],
    filters: [{ name: 'SQLite 数据库', extensions: ['sqlite', 'db'] }],
  })
  if (canceled || !filePaths || filePaths.length === 0) return
  try {
    const summary = await askServer('import-db', { source: filePaths[0] })
    notifyDataChanged()
    const lines = Object.entries(summary ?? {}).map(
      ([table, s]) => `${table}：导入 ${s.imported} 条${s.skipped ? `，跳过 ${s.skipped} 条` : ''}`,
    )
    await showMessage({
      type: 'info',
      title: '导入数据文件',
      message: '已导入（全部归到本机账号名下）：',
      detail: lines.join('\n') || '（没有可导入的数据）',
    })
  } catch (err) {
    await dialog.showErrorBox('导入失败', String(err?.message ?? err))
  }
}
