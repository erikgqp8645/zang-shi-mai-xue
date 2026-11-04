# 桌面版（Windows）—— 使用与构建说明

> **状态**：已实现，可安装可用（2026-11-04 实测）。
> 实施方案见 [`desktop-plan.md`](./desktop-plan.md)，进度台账见 [`progress.md`](./progress.md)。

---

## 1. 这是什么

把「臧氏脉学 · 脉象记录表生成器」包成一个 **Windows 桌面程序**：双击图标就开一个独立窗口，
不用开终端、不用敲 `npm`、不用记网址。数据只存在这台电脑上。

**桌面壳只做三件事**：起服务进程、开窗口、管导出另存为。
脉象知识库、判读规则、方剂剂量、病例存储 —— **业务逻辑一行没改**，跑的还是同一份页面与同一份后端。

| | 网页版 | 桌面版 |
|---|---|---|
| 怎么开 | 浏览器打开 `http://127.0.0.1:5178/` | 双击桌面快捷方式 |
| 要不要装 Node | 要 | **不要**（Electron 自带） |
| 病例数据在哪 | `pulse-record/local-data/history.sqlite` | `%APPDATA%\臧氏脉学\history.sqlite` |
| 要不要登录 | 多用户模式下要 | **不用**（单机免登录） |
| 导出落在哪 | 浏览器的「下载」目录 | **系统另存为对话框**（自己选位置） |

---

## 2. 装与用

### 2.1 拿安装包

| 文件 | 说明 |
|---|---|
| `ZangShiMaiXue-<版本>-x64-setup.exe` | **安装包**：可选安装目录、创建桌面快捷方式、可卸载 |
| `ZangShiMaiXue-<版本>-x64-portable.exe` | **免安装版**：双击即用，整个文件可放 U 盘带走 |

> ⚠️ **安装时 Windows 会提示「未知发布者」** —— 本程序没有买代码签名证书，
> 是个人开发者的既定代价。点「更多信息」→「仍要运行」即可。
> 另存为桌面版不是安全风险：它只是个本地网页壳，数据不出这台电脑。

### 2.2 第一次打开

直接双击，窗口会打开「臧氏脉学 · 脉象记录表生成器」。页面右上角显示 **「单机模式」** 标识 ——
意思是「不用登录、数据只在这台电脑上」，不是出错了。

页面与网页版**逐屏一致**：开方三部曲、脉象记录表、符号录入、寸关尺图示、判读提示、依脉用方、用药记录、导出按钮，一个不少。

### 2.3 数据在哪

| 项 | 路径 |
|---|---|
| 病例库 | `%APPDATA%\臧氏脉学\history.sqlite` |
| 备份／临时副本 | 同目录 `history.sqlite-wal` / `-shm`（SQLite 的 WAL 机制，正常现象） |

菜单 **文件 → 打开数据目录** 直接打开这个文件夹。

### 2.4 导出

页面上的「导出 PNG / 导出 Markdown / 导出 CSV」在桌面版会弹**系统另存为对话框**，
自己选目录、自己起文件名 —— 不会再把文件甩进「下载」目录找不着。

### 2.5 备份（重要）

菜单 **文件 → 导出数据文件（备份）…** → 选个位置，会存一份 `.sqlite` 快照。

- 这份快照是**一致性快照**（含 WAL 里的数据），不是简单复制文件；
- 备份就是全部数据（病例、就诊、用药、自定义符号），没有遗漏；
- 建议定期备份，存到 U 盘或网盘。

**卸载不会删数据**（`%APPDATA%` 里的库留着），重装后数据还在。

### 2.6 把老数据带进来

场景：以前在网页版录的病例，想带进桌面版。

菜单 **文件 → 导入数据文件…** → 选一个旧的 `history.sqlite`（比如 `pulse-record/local-data/history.sqlite`）。

- 导入的病例**一律归到本机账号名下**，所以桌面版里**看得见**；
- 同 id 的记录不会重复导入（重复导入不会翻倍）；
- 老结构（没有 `owner_id` 的旧库）也能导 —— 缺的列自动跳过；
- **导入前不会动你原来的那个文件**（只读打开），导错了重新导一次即可。

> 不想走菜单的话，也可以在服务器上用命令转归属：
> `npm run admin -- claim-local <登录名>`（把该账号名下的数据转给内置单机账号）。

---

## 3. 已知限制

| 限制 | 说明 |
|---|---|
| **Windows only** | 本轮只出 Windows 包。macOS / Linux 上能跑 `npm run desktop:dev` 自测，但不出安装包 |
| **未签名** | 安装时「未知发布者」提示（见 §2.1） |
| **单机免登录** | 桌面版只有一个身份，没有多用户隔离 —— 这是有意的设计（"只在这台电脑上"） |
| **不自动更新** | 没有更新源，升级要自己重新装 |
| **不开自动备份** | 备份是手动动作（见 §2.5），避免目录膨胀 |

---

## 4. 开发者：本机构建

> **在 Windows 上直接出包，不需要 Wine**（方案原先按 macOS 写的那条交叉编译路线用不上了）。

```bash
cd pulse-record
npm install
npm run desktop:dev     # 构建前端 + 开 Electron 窗口自测（不产出包）
npm run desktop:pack    # 只出解包目录 release/win-unpacked（秒级，用于验证打包产物能启动）
npm run desktop:dist    # 出安装包 + 免安装版（release/*.exe）
```

### 4.1 脚本一览

| script | 作用 |
|---|---|
| `desktop:dev` | 构建前端 ＋ 起 Electron 窗口 |
| `desktop:pack` | `--dir`：只出解包目录，验证打包产物能启动 |
| `desktop:dist` | 出安装包与免安装版 |
| `desktop:dist:win` | `--win --x64`（macOS 上需 Wine；Windows 上不需要） |
| `test:e2e:desktop` | 桌面端回归（不依赖 Electron／Chrome） |
| `test:e2e:probe`（`scripts/e2e/electron-probe.mjs`） | 探测 Electron 内的 `node:sqlite` 是否可用 |

### 4.2 回归

```bash
npm test                    # 全量：core 26 ＋ mp 29 ＋ migration 53 ＋ auth 51 ＋ app 15 ＋ desktop 24
npm run test:e2e:desktop    # 只跑桌面端那条（最快）
```

### 4.3 CI

`.github/workflows/desktop-windows.yml`：打 `v*` tag 或手动触发，在 `windows-latest` 上出包并传 artifact。

---

## 5. 代码结构

| 文件 | 职责 |
|---|---|
| `desktop/main.mjs` | Electron 主进程：定位资源 → fork 服务子进程 → 开窗口 → 另存为／导入导出 IPC → 单实例锁 |
| `desktop/server-entry.mjs` | 服务子进程入口：`startServer()` → 报端口 → 响应父进程的数据搬运请求 |
| `desktop/preload.cjs` | 渲染进程桥：只暴露「另存为」「导入导出」「打开数据目录」 |
| `desktop/db-transfer.mjs` | 导出快照（`VACUUM INTO`）／导入老数据（改挂 owner） |
| `src/export/download.ts` | 统一下载入口：桌面版走系统对话框，Web 端保留原行为 |
| `electron-builder.yml` | 打包配置 |
| `build/icon.png` | 应用图标 |

### 5.1 三条纪律

1. **桌面端代码里禁止出现 `wal_checkpoint`**。
   历史上 `wal_checkpoint(TRUNCATE)` 重置过 WAL 的 wal-index header，
   导致后续写入进**孤儿 WAL**、进程退出全丢。备份一律 `VACUUM INTO`。
2. **禁止 `copyFileSync` 直接拷库**。库里开着 WAL，活跃数据不在主文件里。
   要备份就 `VACUUM INTO`。
3. **数据只落在 `%APPDATA%\臧氏脉学\`**。SQLite 不能放进 asar（只读），
   也不能放进 Program Files（要写 WAL/SHM）。

### 5.2 桌面版与网页版共用的东西

- `dist/`（页面）—— **原封不动**
- `server/`（API ＋ 存储）—— 只拆出一个 `startServer()`，业务没改
- `src/domain/`（知识库：方剂、剂量、规则、符号、版式）—— **一字未改**
- 「不构成诊断」声明、逐字引用标注、出处与年代标注 —— 桌面版**不新增任何文案**
