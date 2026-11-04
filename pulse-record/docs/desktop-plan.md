# 桌面应用（Windows）—— 实施方案

> **状态**：方案已定，**尚未实施**。本文是实施方案，不是完成汇报。
>
> **写于** 2026-11-04 ｜ **基线 commit** `b9e3b19`（分支 `chore/multi-user`）｜
> **开发分支** `chore/desktop-electron`（从 `b9e3b19` 切出）｜
> **代码行号引用**均基于 `b9e3b19`，后续代码变动后请按符号名（`startServer`、`downloadPng` 等）定位。
>
> **用户已拍板**：① 打包形态＝**Windows 桌面 App**；② 数据模型＝**单机、免登录、只在这台电脑上**；
> ③ 方案与进度落库到 `pulse-record/docs/`，实现由维护者在本分支推进。

---

## 0. 一句话现状

| 项 | 现状 | 桌面版目标 |
|---|---|---|
| 形态 | 网站 + 微信小程序 | 再加一个 **Windows `.exe`**，双击即用 |
| 后端 | `server/`（`node:http`，**零第三方依赖**，只用 node: 内置） | **原样复用**，一行不重写 |
| 前端 | `dist/`（Vite 构建产物） | **原样复用**，跑的就是同一份 `dist/` |
| 数据库 | 单文件 SQLite（`local-data/history.sqlite`） | 同一个 SQLite 文件，**换到用户数据目录** |
| 账号 | 多用户（需登录）／单机（免登录）双模式 | **默认单机免登录**（`PULSE_SINGLE_USER=1`） |
| 技术栈 | Node 24 + Vite + React | 外面套一层 **Electron** |

**核心思路**：桌面壳只做三件事——**起服务进程、开窗口、管导出另存为**。业务逻辑一行不重写。

---

## 1. 目标与范围

### 1.1 交付物

1. **Windows 安装包** `臧氏脉学-<版本>-x64.exe`（NSIS：可选安装目录、创建桌面快捷方式、可卸载）
2. **免安装版** `臧氏脉学-<版本>-x64-portable.exe`
3. **本机可跑**：`npm run desktop:dev` 在 macOS / Windows 上直接开 Electron 窗口（开发自测，不产出包）
4. **CI**：`.github/workflows/desktop-windows.yml`，`workflow_dispatch` 或打 tag 触发，产出物作为 artifact 上传

### 1.2 明确不做

| 不做 | 原因 |
|---|---|
| 自动更新 | 单机、无服务器、无发布渠道；`electron-updater` 需要更新源 |
| 云同步 / 多机 | 用户拍板「只在这台电脑上」。多机同步由**网站 + 小程序**承担 |
| 代码签名证书 | 个人开发者无 OV 证书 → 安装时「未知发布者」+ SmartScreen 提示，**已知代价**，后续可买证书解决 |
| 桌面端多用户登录 | 用户拍板「免登录」。`PULSE_SINGLE_USER=0` 留作后路（架构不动，只改环境变量） |
| 移动端 / macOS 安装包 | 本轮只做 Windows。macOS 端只做开发自测 |
| 把 SQLite 塞进 asar | **物理上不行**（asar 只读，SQLite 要写 WAL/SHM） |

---

## 2. 已核实的事实

### 2.1 Electron 版本 → 内置 Node

> 来源：`https://releases.electronjs.org/releases.json`（已下载逐版统计，2026-11-04）

| Electron | 内置 Node | `node:sqlite` 可用？ |
|---|---|---|
| ≤ 34.x | 20.18 ~ 20.19 | ❌ 无 `node:sqlite` |
| **35.x** | 22.14 ~ 22.16 | ✅（Node 22.13 起解除 `--experimental-sqlite` flag） |
| 36.x | 22.14 ~ 22.19 | ✅ |
| 37 ~ 39.x | 22.16 ~ 22.22 | ✅ |
| 40 ~ 45.x | **24.11 ~ 24.22** | ✅（Node 24 已转正） |
| 最新 45.2.2（2026-11-03） | 24.22.2 | ✅ |

**结论**：**下限 Electron 35**；本方案选 **44.x**（Node 24.22.2，成熟稳定、NSIS 支持完整）。45.x 仅 5 个正式版，没必要追新。

> `node:sqlite` 版本线：Node **22.5.0** 引入但需 `--experimental-sqlite`；**22.13.0 移除该 flag**；Node 24 转正。

### 2.2 `node:sqlite` 在 Electron 里确实可用

- **第三方实证**：同架构项目（主进程 + utilityProcess + `node:sqlite`）用 `ELECTRON_RUN_AS_NODE=1` 对 **Electron 37.10.3 / Node 22.21.1** 探测通过，确认提供 `node:sqlite`、SQLite 3.50.4、strict tables、prepared statements、foreign keys、事务回滚。
- **打包优势**：`node:sqlite` 是 Node 内置 → **无 `.node` 文件** → 无需 `asarUnpack`、无需 `electron-rebuild`、无需 VS Build Tools。本项目 `server/` 本来就零第三方依赖，天然受益。
- ⚠️ 「第三方验过」≠「本项目验过」→ **§9 的 P0 探测必须自己跑一遍**，探测脚本进 CI。

### 2.3 Electron 能力可用性

| 能力 | 最低版本 | 本方案 |
|---|---|---|
| `utilityProcess.fork()` | 22 | ✅ 44.x 有 |
| ESM 主进程（`"type":"module"`） | 28 | ✅ 44.x 有 |
| ESM preload | 28（需 `sandbox:false`） | 本方案用 **CJS preload（`.cjs`）** ＋ `sandbox:false`，更稳 |
| `dialog.showSaveDialog` | 全版本 | ✅ |

### 2.4 打包与交叉编译

- macOS 上打 Windows **NSIS 安装包需要 Wine**：`brew install --cask --no-quarantine wine-stable`（约 6GB），或用 Docker 镜像 `electronuserland/builder:wine`。
- **`windows-latest` runner 原生构建最省心** → 走 GitHub Actions。**仓库目前没有 `.github/` 目录、没有任何 CI workflow**，需新建。
- NSIS 安装包有 2GB 上限 —— 本项目产物远低于此。

---

## 3. 总体架构

```
┌──────────────────── Electron 主进程 (desktop/main.mjs) ─────────────────────┐
│                                                                              │
│  app.whenReady()                                                            │
│    ├─ 定位资源：DB = app.getPath('userData')/history.sqlite                  │
│    │           UI = app.isPackaged ? resourcesPath/ui : <repo>/dist        │
│    ├─ utilityProcess.fork(desktop/server-entry.mjs, env={                   │
│    │      PULSE_SINGLE_USER:'1', PULSE_DB:DB, PULSE_DIST:UI })              │
│    │      ← 子进程回 {type:'listening', port} → 主进程建窗口                 │
│    ├─ BrowserWindow({ webPreferences:{ preload, nodeIntegration:false,     │
│    │                                  contextIsolation:true, sandbox:false }})
│    │      win.loadURL('http://127.0.0.1:<port>/')  ← 同源，/api 相对路径可用  │
│    └─ ipcMain.handle('desktop:saveBlob') → dialog.showSaveDialog → 写盘    │
└──────────────────────────────────────────────────────────────────────────────┘
                │ postMessage(port)                │ fetch('/api/...') 同源
                ▼                                   ▼
┌────────── utilityProcess（服务子进程）──────────┐  ┌────────── 渲染进程 ──────────┐
│ desktop/server-entry.mjs                        │  │ 原封不动的 Web UI（dist/）      │
│   import { startServer } from '../server/index.mjs' │  │ ┌──────────────────────┐ │
│   const { port } = await startServer({port:0,      │  │ │ preload.cjs 桥：       │ │
│                            host:'127.0.0.1'})      │  │ │ window.__pulseDesktop │ │
│   process.parentPort.postMessage({type:'listening', │  │ │   .saveBlob(b64,name)│ │
│                                  port})            │  │ └──────────────────────┘ │
│   → 复用现有 server/index.mjs 路由层 + server/db.mjs│  │ nodeIntegration:false     │
│   → 复用现有 store.mjs / auth.mjs                  │  │ 拿不到 db 路径/SQL/连接    │
└─────────────────────────────────────────────────────┘  └───────────────────────────┘
                │ node:sqlite
                ▼
      %APPDATA%\臧氏脉学\history.sqlite   （WAL / SHM 同目录）
```

**数据流一句话**：UI 由 Vite 构建产物提供；API 由同进程内的子进程提供；两者**同源**；数据只落在本机一个 SQLite 文件。

---

## 4. 代码改动清单（逐文件）

> 全部改动在 `pulse-record/` 目录下。**`data/` 只读区不碰；`miniprogram/` 不碰**（桌面端跑的是 `dist/`，与小程序无关）。

### 4.1 `server/index.mjs`（改）—— 拆出入口 ＋ 支持外部指定前端目录

现有结构问题（行号基于 `b9e3b19`）：

| 行 | 现状 | 问题 |
|---|---|---|
| `:88` | `const PORT = Number(process.env.PORT ?? 5178)` | 端口写死 |
| `:89` | `const DIST = join(import.meta.dirname, '..', 'dist')` | **写死相对路径**，打包后不成立 |
| `:91-92` | `const db = openDb()` / `await purgeExpiredSessions(db)` | **模块加载期副作用** |
| `:292` | `const server = createServer(async (req,res) => {...})` | handler 闭包捕获模块级 `db` |
| `:622` | `server.listen(PORT, ...)` | 模块加载即监听 |

改动（**零重新缩进**，约 25 行 diff）：

```js
// 1) DIST 支持环境变量覆盖（桌面端指向 resources/ui）
const DIST = process.env.PULSE_DIST ?? join(import.meta.dirname, '..', 'dist')

// 2) db 改为可变绑定，由 startServer() 赋值
let db = null

// 3) 新增导出：把「开库 → 清过期会话 → 监听」收成可复用的函数
export async function startServer({ port = 0, host = '127.0.0.1' } = {}) {
  db = openDb()
  await purgeExpiredSessions(db)
  await new Promise((resolve) => server.listen(port, host, resolve))
  return { server, db, port: server.address().port }
}

// 4) 文件末尾：CLI 直跑才监听（被 import 时不自动起服务）
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const { port } = await startServer({ port: Number(process.env.PORT ?? 5178) })
  console.log(`[臧氏脉学] 病例记录服务已启动：http://localhost:${port}/api/health`)
  console.log(`[臧氏脉学] SQLite 文件：${DB_PATH}`)
  console.log(`[臧氏脉学] 模式：${SINGLE_USER ? '单机（不用登录）' : '多用户（需登录）'}`)
  if (existsSync(DIST)) console.log(`[臧氏脉学] 同时托管已构建页面：${DIST}`)
}
```

- `pathToFileURL` 从 `node:url` 引入（新增 1 行 import）。
- 原 `:622-627` 的 `server.listen` 回调被上面对应代码取代。
- **兼容性**：`node server/index.mjs` 行为完全不变（`isMain` 为真）；`scripts/e2e/*.mjs` 全部通过 `spawn('node', ['server/index.mjs'])` 起服务 → 行为不变，**174 项回归应全绿**。

### 4.2 `desktop/main.mjs`（新增）—— 主进程

职责：定位资源路径 → fork 服务子进程 → 收到端口后开窗口 → 提供另存为 IPC → 单实例锁 → 退出收尾。

要点：

- `app.requestSingleInstanceLock()`：第二次启动只聚焦已有窗口，**不起第二个服务**。
- `app.whenReady()` 之后才 `utilityProcess.fork()`（Electron 要求）。
- fork 的 `env` 显式传 `PULSE_SINGLE_USER:'1'`、`PULSE_DB`、`PULSE_DIST`；**不要**继承外部 `PORT`（用端口 0）。
- `child.on('message', m => m.type==='listening' && createWindow(m.port))`；`child.on('exit')` 时提示并退出。
- `BrowserWindow`：`width:1440 height:960 minWidth:1180 minHeight:760`、`title:'臧氏脉学 · 脉象记录表'`、`backgroundColor:'#ffffff'`、`webPreferences:{ preload, nodeIntegration:false, contextIsolation:true, sandbox:false }`。
- **导航收紧**：`webContents.setWindowOpenHandler(() => ({action:'deny'}))`；`will-navigate` 只放行 `http://127.0.0.1:<port>/` 前缀。
- 退出：`before-quit` 时 `child.kill()`，让 SQLite 正常收尾。**不要**再碰 `wal_checkpoint`（见 §9 的 WAL 事故记录）。
- 菜单：精简应用菜单（`文件` → 导出当前表 / 导出数据文件 / 退出；`帮助` → 关于）。

### 4.3 `desktop/server-entry.mjs`（新增）—— 服务子进程入口

```js
import { startServer } from '../server/index.mjs'
const { port } = await startServer({ port: 0, host: '127.0.0.1' })
const msg = { type: 'listening', port }
if (process.parentPort) process.parentPort.postMessage(msg)   // Electron utilityProcess
else if (process.send) process.send(msg)                       // 普通 node fork（供 e2e 复用）
```

- 端口 **0** → 由 OS 分配空闲端口，**天然免端口冲突**（用户电脑上可能已跑着 5178 的开发服务）。
- `process.parentPort` / `process.send` 双通道 → 同一份入口既能在 Electron 里跑，也能被普通 Node `fork()` 起来做 e2e 回归（§10 的 `desktop-smoke.mjs`）。

### 4.4 `desktop/preload.cjs`（新增）—— 渲染进程桥

```js
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('__pulseDesktop', {
  saveBlob: (base64, filename) => ipcRenderer.invoke('desktop:saveBlob', base64, filename),
  platform: process.platform,
})
```

- 只暴露**一个**写文件能力（另存为），**不暴露** db 路径、SQL、连接、原生能力。
- 用 `.cjs`（项目 `package.json` 是 `"type":"module"`，`.cjs` 显式 CommonJS，避开 ESM preload 的坑）。

### 4.5 `src/export/download.ts`（新增）—— 统一下载入口

现有两处下载实现要合并：

| 位置 | 现状 |
|---|---|
| `src/export/png.ts:93-107` `downloadPng()` | `URL.createObjectURL` ＋ `<a download>` ＋ `a.click()` |
| `src/App.tsx:59-69` `downloadText()` | 同样的 blob ＋ `<a download>` 写法 |

新模块对外暴露 `downloadBlob(filename, blob)`：

1. 若 `window.__pulseDesktop?.saveBlob` 存在 → `blob.arrayBuffer()` → base64 → `invoke('desktop:saveBlob', base64, filename)`（走系统另存为对话框）
2. 否则 → **保留现有 `<a download>` 行为**（Web / 小程序不受影响）

配套 `src/global.d.ts` 声明 `__pulseDesktop` 的类型（避免 `any`）。

**改动点**：`src/export/png.ts` 的 `downloadPng` 末尾改为调用 `downloadBlob`；`src/App.tsx` 的 `downloadText` 改为调用 `downloadBlob` 并删除本地实现。**Web 端行为逐字节不变**（兜底路径原样保留）。

### 4.6 `electron-builder.yml`（新增）

```yaml
appId: com.zangshimai.pulserecord
productName: 臧氏脉学
directories:
  output: release
  buildResources: build
files:
  - package.json
  - desktop/**/*
  - server/**/*
  - '!**/*.map'
extraResources:
  - from: dist          # 前端构建产物放 asar 外 → resources/ui
    to: ui
asar: true
win:
  target:
    - target: nsis
      arch: [x64]
    - target: portable
      arch: [x64]
  artifactName: ZangShiMaiXue-${version}-${arch}.${ext}
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  shortcutName: 臧氏脉学
```

- `files` 用**白名单**：不打 `src/`、`miniprogram/`、`scripts/`、`docs/`、`test/`。生产 `node_modules`（react/react-dom，约 1MB）由 electron-builder 默认带上 —— 桌面渲染的是已构建的 `dist/`，运行时其实用不到 react，但留着无害、不折腾。
- `extraResources` 而不是把 `dist` 塞进 asar：静态托管路径直接 `resourcesPath/ui`，物理路径明确、无 asar 前缀问题。
- **`artifactName` 用 ASCII**（`ZangShiMaiXue-…`）：安装包文件名会进 CI artifact 名、压缩包内部路径与部分旧版 Windows 的解压路径，中文名容易出问题；**界面上的中文名由 `productName` / `shortcutName` / 窗口标题承担**。

### 4.7 `build/icon.png`（新增）—— 应用图标

- 现有素材只有 `src/assets/hands-pulse.png`（1070×876，手摸脉照片）与 `src/assets/triad-p47.png`（701×605，讲义 p47 三部曲截图）—— **都不是方形、没有 `.ico`**。
- 方案：用现有素材做**中心正方形裁切** → 512×512 PNG 存为 `build/icon.png`；**electron-builder 会自动把 png 转成 `icon.ico`**（Windows 目标下自动转换，不需要额外的转换工具）。
- 若成品观感不佳，再单独设计一版（不影响打包流水线）。

### 4.8 `package.json`（改）

- 新增 `"main": "desktop/main.mjs"`（Electron 入口；`"type":"module"` 保持不变 → ESM 主进程，Electron ≥28 支持）。
- `devDependencies` 新增：`electron`（锁 `^44.10.2`）、`electron-builder`（`^26.x`），具体版本以安装时 npm 解析为准并提交 lockfile。
- 新增 scripts：

| script | 作用 |
|---|---|
| `desktop:dev` | `npm run build && electron .` —— 本机开窗口自测（macOS / Windows 均可） |
| `desktop:pack` | `npm run build && electron-builder --dir` —— 只出解包目录，秒级，用于验证打包产物能启动 |
| `desktop:dist` | `npm run build && electron-builder` —— 出安装包 |
| `desktop:dist:win` | `npm run build && electron-builder --win --x64` —— **需 Wine**（或只在 Windows 上跑） |

- `build` 脚本保持 `npm run build:core && tsc --noEmit && vite build` 不变；桌面打包复用它。

### 4.9 `.gitignore`（改）

追加 `release/`（electron-builder 输出目录）。`build/icon.ico` 是自动生成物，只提交 `build/icon.png`。

### 4.10 `.github/workflows/desktop-windows.yml`（新增）

仓库**目前无任何 CI**，这是第一个 workflow。

```yaml
name: desktop-windows
on:
  workflow_dispatch:
  push:
    tags: ['v*']
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24' }
      - run: npm ci
      - run: npm run build:core
      - run: npx tsc --noEmit
      - run: npx vite build
      - run: npx electron-builder --win --x64
      - uses: actions/upload-artifact@v4
        with:
          name: zangshimai-windows-x64
          path: |
            release/*.exe
            release/win-unpacked/
```

- artifact 名用 ASCII，避免中文名在 runner 上的编码问题。

### 4.11 `scripts/e2e/desktop-smoke.mjs`（新增）—— 不依赖 Electron 的回归

用普通 Node `fork()` 起 `desktop/server-entry.mjs`（`PULSE_SINGLE_USER=1`、临时 `PULSE_DB`、`PULSE_DIST=dist`、端口 0），断言：

1. 子进程回报端口
2. `GET /api/health` → `{ ok:true, mode:'single', db:<临时路径> }`
3. `GET /` → 200 且 HTML 含应用标题
4. `POST /api/patients` → 成功；`GET /api/patients` → 能读回（**单机免登录链路通**）
5. `POST /api/auth/register` → **409**（单机模式下注册被拒，现有实现见 `server/index.mjs:209-211`）
6. 数据落在临时目录，退出后 `.sqlite` 存在

→ 串进 `npm test`（`test:e2e:desktop`），**不依赖 Electron、不依赖 Chrome**，CI 与本机都能跑。

---

## 5. 数据模型：单机、免登录、只在这台电脑上

### 5.1 存储位置

| 项 | 值 |
|---|---|
| 库文件 | `app.getPath('userData')/history.sqlite` → Windows: `%APPDATA%\臧氏脉学\history.sqlite` |
| WAL / SHM | 同目录（`history.sqlite-wal` / `-shm`） |
| 前端资源 | `process.resourcesPath/ui`（只读） |
| 备份 | 建议用「导出数据文件」菜单 → `VACUUM INTO` 到用户选定位置（复用 `server/db.mjs:105` 已有的 `backupDb`，它已经是 `VACUUM INTO`，**不要再用 `copyFileSync`**） |

### 5.2 免登录链路（**已核实，现成可用，无需改动前端**）

```
渲染进程启动 → GET /api/health → mode === 'single'
   → src/App.tsx:106-111  setUser({id:'local',...}) → setAuthReady(true)
   → src/App.tsx:666-668  有 user → 不渲染 <LoginPanel>
   → 页面右上角显示「单机模式」徽标（src/App.tsx:716-718）
```

服务端侧：`server/auth.mjs:20` `SINGLE_USER = process.env.PULSE_SINGLE_USER === '1'`；`server/index.mjs:170` `if (SINGLE_USER) return await getLocalUser(db)` —— **所有请求自动归属内置 `local` 账号**，无需令牌。

### 5.3 ⚠️ 老数据带入的陷阱（**本方案最容易踩的坑**）

**现状**（2026-11-04 实测本机库 `local-data/history.sqlite`）：

| 账号 | 角色 | 患者数 | 就诊数 |
|---|---|---|---|
| `local` | admin | **0** | **0** |
| `guoguo` | user | **14** | **56** |

**问题**：桌面端跑单机模式 → 所有读写都挂到 `local` 名下。**即使把 `history.sqlite` 原样拷到 Windows，桌面 App 也只会显示 `local` 名下的 0 行 —— 现有 70 行数据一条也看不到。**

**为什么**：`owner_id` 是四张业务表的归属列，读写一律按 owner 过滤（`server/db.mjs:12-18` 硬规则：`ownerId` 必填，跨用户当作「不存在」）。`local` 与 `guoguo` 是两个不同的 owner。

**解法（推荐）**：桌面端加「**导入数据文件**」——

1. 菜单 `文件 → 导入数据文件…` → 选一个外部 `history.sqlite`
2. 读取其中四张业务表的所有行，**统一改挂到 `local`**（父子表同事务转移，保持 `owner_id` 一致性不变量）
3. 写入本机 `userData/history.sqlite`（用 `VACUUM INTO` 做一致快照）
4. 导入前自动备份现有库

复用现有 `scripts/admin.mjs` 的 `claim` 实现（`:100-119`，父子表同事务转），**方向反过来**（别人 → local）；并在 `admin.mjs` 加一条对称命令 `npm run admin -- claim-local <登录名>` 供 Mac 侧预演。

**替代方案（更省事，但放弃免登录）**：桌面端改跑多用户模式（`PULSE_SINGLE_USER=0`），用网站账号 `guoguo` 登录 → 直接看到现有数据，且与网站/小程序同账号同数据。**这与用户拍板的「免登录」冲突**，故列为备选而非默认。

### 5.4 备份与迁移

- 桌面 App 每次启动不自动备份（避免目录膨胀）；提供「导出数据文件」手动备份。
- NSIS 卸载时**默认不删** `%APPDATA%` 下的数据 → 重装不丢数据。

---

## 6. 导出「另存为」改造

| 场景 | 现状 | 改造后 |
|---|---|---|
| Web 端导出 PNG | `<a download>` → 浏览器下载 | **不变**（兜底路径原样保留） |
| 桌面端导出 PNG | 同上（落到 Downloads，无对话框） | **系统另存为对话框** → 选目录 → 写入 |
| 导出 Markdown / CSV | `src/App.tsx:59-69` 同款 blob 下载 | 同上，桌面端走对话框 |

- 渲染进程把 blob 转 base64 → IPC → 主进程 `dialog.showSaveDialog` → `writeFileSync`。
- **主进程才是唯一写盘方**，渲染进程拿不到任意路径写入能力（只提供「用户选定的那个路径」）。
- 「导出数据文件（.sqlite）」走另一条 IPC：`desktop:exportDb` → 主进程 `VACUUM INTO` 到用户选定路径。

---

## 7. 打包配置与产物

| 产物 | 大小（估） | 说明 |
|---|---|---|
| `ZangShiMaiXue-0.1.0-x64.exe`（NSIS） | ~90~110 MB | 安装包，可选安装目录、桌面快捷方式、卸载 |
| `ZangShiMaiXue-0.1.0-x64-portable.exe` | ~90~110 MB | 免安装，双击即用 |
| `release/win-unpacked/` | ~250 MB | 解包目录，便于验证与分发 |

- 体积主要来自 Electron/Chromium 运行时本身，与业务代码无关（业务只占几百 KB）。
- 安装包**无签名** → Windows SmartScreen 可能提示「未知发布者」，用户需「更多信息 → 仍要运行」。这是个人开发者的既定代价（§1.2）。

---

## 8. 构建流水线

### 8.1 本机 macOS（开发自测，不出 Windows 包）

```bash
cd pulse-record
npm install                       # 会装 electron + electron-builder
npm run desktop:dev               # 构建前端 + 起 Electron 窗口
npm run desktop:pack              # 出解包目录，验证打包后能启动
```

### 8.2 Windows 包 —— 走 GitHub Actions（推荐）

```bash
git tag v0.1.0 && git push origin v0.1.0
# 或在 Actions 页面手动 workflow_dispatch
```

### 8.3 Windows 包 —— 本机 macOS 交叉编译（备选）

```bash
brew install --cask --no-quarantine wine-stable    # 约 6GB
npm run desktop:dist:win
```

- 需要 Wine 的环节：NSIS 安装器生成 ＋ `rcedit`（写 exe 的图标/版本元数据）。
- 失败率高一些、耗时长。**不作为主路径**。

### 8.4 与现有发布纪律的衔接

- 仓库 Git 约定：**不直推 `main`**，从 `main` 切分支 → PR（见 `AGENTS.md` 的「Git 约定」）。
- **代码与文档分开提交**，前缀沿用 `chore:` / `docs:`。
- 本方案在 **`chore/desktop-electron`** 分支上开发（基点 `b9e3b19`）。PR 目标先指 `chore/multi-user`（避免依赖倒置），待 `chore/multi-user` 合入 `main` 后再改指 `main`。

---

## 9. 风险清单与对策

| # | 风险 | 等级 | 对策 |
|---|---|---|---|
| R1 | Electron 的 `node:sqlite` 在目标平台缺失／行为不同 | 🔴 高 | **P0 探测**必做；探测脚本进 CI；失败则退回 `better-sqlite3`（需 `electron-rebuild` ＋ Windows VS Build Tools，代价大） |
| R2 | macOS 上打不出 Windows 包 | 🟡 中 | 走 GH Actions `windows-latest`（§8.2） |
| R3 | 现有 `server/index.mjs` 顶层副作用导致 Electron 复用失败 | 🟡 中 | §4.1 的 `startServer()` 拆分；回归 174 项必须全绿 |
| R4 | SQLite 库放错位置（asar 内／只读目录）→ 写入失败 | 🔴 高 | 强制 `app.getPath('userData')`；启动时校验目录可写；`openDb()` 已有的 `mkdirSync(recursive)` 兜底 |
| R5 | **WAL 共享状态事故复发**（历史上 `wal_checkpoint(TRUNCATE)` 重置 wal-index header → 写入进孤儿 WAL → 进程退出全丢） | 🔴 高 | **桌面端代码里禁止出现 `wal_checkpoint`**；备份一律 `VACUUM INTO`；退出时正常 kill 子进程，不做 checkpoint |
| R6 | 老数据拷过去看不到（owner 归属） | 🟡 中 | §5.3 的「导入数据文件」；或桌面端临时切多用户模式 |
| R7 | 导出文件被甩进 Downloads，用户找不到 | 🟢 低 | §6 的另存为对话框 |
| R8 | 安装包「未知发布者」被用户当成病毒 | 🟡 中 | 说明文档写清；后续买 OV 证书 |
| R9 | `productName` 中文 → Windows 某些环境下路径/编码问题 | 🟢 低 | `appId` 用 ASCII；`artifactName` 用 ASCII；界面中文名走 `productName` / `shortcutName` / 窗口标题 |
| R10 | Electron 自动升级后 `node:sqlite` API 变动 | 🟢 低 | 锁 `electron` 版本（package-lock）；升版本时重跑 §10 的全套回归 |

---

## 10. 验证计划

### 10.1 既有回归不能破

```bash
cd pulse-record
npm test        # 期望 174/174（core 26 + mp 29 + migration 53 + auth 51 + app 15）
```

`server/index.mjs` 的入口拆分是**唯一**触碰既有后端的改动 → 这一步是硬门槛。

### 10.2 新增回归

| 脚本 | 覆盖 | 依赖 |
|---|---|---|
| `scripts/e2e/desktop-smoke.mjs` | 单机免登录链路、静态页托管、临时库落盘、注册被拒 | 仅 Node |
| `scripts/e2e/electron-probe.mjs`（可选，进 CI） | Electron 内 `node:sqlite` 可用性 | Electron |

### 10.3 人工验收（macOS 本机）

1. `npm run desktop:dev` → 窗口打开、页面完整渲染（与 Web 版**逐屏一致**）
2. 新建患者 → 填表 → 保存 → 刷新页面仍在
3. 导出 PNG → 弹出**另存为**框 → 选目录 → 文件落地且可打开
4. 导出 Markdown / CSV → 同上
5. 退出 App → 重开 → 数据仍在
6. 确认 `%APPDATA%/臧氏脉学/` 下有 `history.sqlite`
7. 确认页面右上角显示「单机模式」徽标、无登录页

### 10.4 人工验收（Windows 包）

1. CI 产出 `ZangShiMaiXue-0.1.0-x64.exe` → 安装 → 桌面快捷方式可启动
2. 装到含中文路径 / 非管理员账户的机器上跑一遍
3. 免安装版双击即用
4. 「导入数据文件」能导入 Mac 导出的库并看到 14 位患者
5. 卸载后重装 → 数据仍在

---

## 11. 实施顺序（里程碑）

| 阶段 | 内容 | 产出 | 验收 |
|---|---|---|---|
| **P0 探测** | 装 `electron@44`，跑 `ELECTRON_RUN_AS_NODE=1` 探测 `node:sqlite`；确认 `utilityProcess` 可用 | 一条命令的结论 | 通过 → 架构成立；不通过 → 停下来重新评估（R1） |
| **P1 桌面壳** | §4.1 拆入口 → §4.3 服务入口 → §4.2 主进程 → §4.4 preload → §4.5 统一下载 | `npm run desktop:dev` 能开窗并完整使用 | `npm test` 174/174；人工验收 §10.3 前 5 条 |
| **P2 打包** | §4.6 配置 → §4.7 图标 → §4.8 scripts → §4.9 gitignore → `desktop:pack` 能启动 | `release/` 解包目录 | 解包产物能启动、数据能落盘 |
| **P3 数据带入** | §5.3「导入数据文件」＋ `admin.mjs claim-local` | 可把 Mac 的 70 行带进桌面 App | 导入后桌面端能看到 14 位患者 / 56 次就诊 |
| **P4 CI 与文档** | §4.10 workflow → `docs/desktop.md`（给使用者看的说明）→ README 一章 → AGENTS.md 补一节 | 一条命令出 Windows 安装包 | CI 产出 `.exe`；文档写明数据位置、备份、导入步骤、已知限制（未签名） |

**建议提交拆分**（遵守仓库「代码与文档分开提交」约定）：

```
chore: server/index.mjs 拆出可复用的 startServer()
chore: 新增 Electron 桌面壳（主进程/服务子进程/preload）
chore: 导出改走系统另存为，Web 端保留原行为
chore: 新增 electron-builder 配置与图标
chore: 新增桌面端回归测试并串进 npm test
chore: 新增 Windows 桌面打包 CI
docs: 新增桌面版说明文档与 README 章节
docs: AGENTS.md 补桌面端约定（禁 wal_checkpoint、DB 位置、owner 归属）
```

---

## 12. 待确认的点

| # | 问题 | 本文采用的默认值 |
|---|---|---|
| 1 | 应用名 / 安装包名 | `productName: 臧氏脉学`、窗口标题「臧氏脉学 · 脉象记录表」、`artifactName` 用 ASCII `ZangShiMaiXue-…` |
| 2 | 老数据是否要带进 Windows 版（§5.3） | **要** —— 现有 70 行病历是真实资产 → 做 P3 |
| 3 | 是否接受「未知发布者」提示（R8） | 接受 → 本轮不买证书 |
| 4 | CI 用 GitHub Actions 还是本机 Wine | **GitHub Actions**（§8.2） |

---

## 附：本方案触及的既有约束（复核结论）

- `data/` 只读区**完全不碰**；PDF md5 保持 `4eb40d3fdac4a184965baabeb714cc5c`。
- `miniprogram/` **不碰**（小程序端与桌面端唯一的共享物是 `src/domain/` 知识库，经 `build:core` 编译；桌面端打包的是 `dist/`）。
- 术语、方剂、脉象表结构**不改** —— 桌面端跑的是**原封不动**的 `dist/`。
- 「不构成诊断」声明、逐字引用标注、出处与年代标注 —— 全部由现有前端负责，桌面端**不新增任何文案**。
- 现有 `.gitignore` 已排除 `dist/`、`local-data/`、`*.sqlite*`；本方案新增 `release/`。
- 遵守 `AGENTS.md`「Git 约定」：不直推 `main`、代码与文档分开提交、提交前缀 `chore:` / `docs:`。
