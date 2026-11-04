# 项目进度 —— 臧氏脉学 · 脉象记录表生成器

> **更新于** 2026-11-04 ｜ **仓库** `erikgqp8645/zang-shi-mai-xue` ｜ **当前分支** `chore/desktop-electron`（基点 `b9e3b19`）
>
> 本文是**进度台账**：记每条工作线做到哪了、卡在哪、下一手做什么。
> 桌面应用的**实施方案**另见 [`desktop-plan.md`](./desktop-plan.md)；上线手册见 [`deploy.md`](./deploy.md)；迁 CloudBase 见 [`cloudbase-migration.md`](./cloudbase-migration.md)。

---

## 0. 一张表看全局

| 工作线 | 状态 | 关键结论 | 下一步 |
|---|---|---|---|
| **P0 多用户与数据隔离** | ✅ 已完成 | `users`＋`identities`＋`sessions` 三表；四张业务表下沉 `owner_id`；跨用户一律 404 | 等 PR #6 合并 |
| **P1 网站上线** | ⏸ **卡在用户侧手续** | 脚本与文档已就绪，**域名／ICP 备案／服务器三样都没有** | 备案 7~20 工作日是整条时间线最长的一段 → **今天就去提交备案** |
| **P2 微信小程序** | 🟡 代码完成，未真机验证 | 个人主体（不能用 `web-view`、不能用 `getPhoneNumber`）→ 必须原生开发；8 个页面已写完 | 填真实 AppID 后真机跑一遍 |
| **P3 后期迁 CloudBase** | ⏸ 规划完成，待触发 | 存储已收敛成 `server/store.mjs` 一层；db/auth 全 async | 真正迁的时候只改一处 |
| **P4 Windows 桌面应用** | 📄 方案已成，**未实施** | Electron 路线；复用现有 `server/`＋`dist/`，业务逻辑不重写 | 在 `chore/desktop-electron` 上按方案 §11 的 P0→P4 推进 |

---

## 1. P0 · 多用户与数据隔离（已完成）

**成果**：`chore/multi-user` 分支 10 个提交，PR #6（base `main`，OPEN）。

| commit | 内容 |
|---|---|
| `c7c34a3` | 账号与数据隔离（多用户）＋ 为迁 CloudBase 预留存储抽象层 |
| `7c1f8f1` | 抽出共享包（小程序与网站共用知识库与绘制代码） |
| `f7ab57f` | 微信小程序端工程（8 个页面） |
| `b655e4c` | 部署脚本（初始化／systemd／Caddy／备份／恢复演练／发布） |
| `41ac54f` | 部署手册、迁 CloudBase 规划；AGENTS.md 三节、README 三章 |
| `5bcade4` | 修复老库迁移的 UPSERT 语法错，并让迁移能自愈中断残局 |
| `57517cc` | 加老库迁移回归（53 项断言） |
| `7279ba9` | AGENTS.md 质量检查清单补两条（改存储层必跑迁移回归／多连接下迁移备份要安全） |
| `805a52b` | `admin` 加「认领老数据」命令（`npm run admin -- claim <登录名>`） |
| `b9e3b19` | README 补「认领老数据」用法与迁移回归进全量回归说明 |

**验收状态**：全量回归 **174/174** 通过 —— core 26 ＋ mp 29 ＋ migration 53 ＋ auth 51 ＋ app 15。

**踩过的坑（已修，勿重犯）**

1. **迁移 UPSERT 缺 `WHERE`**：`INSERT…SELECT…ON CONFLICT` 在 SQLite 报 `near "DO": syntax error`（SQLite 要求 `INSERT…SELECT` 后带 `WHERE` 消歧义）。两库通用写法：`… FROM custom_symbols WHERE true ON CONFLICT … DO NOTHING`。
2. **WAL 共享状态事故**：`wal_checkpoint(TRUNCATE)` 会重置 WAL 的 wal-index header，导致另一个连接退出时把 `-wal/-shm` 删掉，服务端还持旧 fd → 之后的写入进**孤儿 WAL**，进程退出全丢（症状：刚注册好的账号在库里查不到）。**备份一律改用 `VACUUM INTO`**（一致性快照、含 WAL 数据、不碰现有连接），**禁止 `copyFileSync` ＋ checkpoint**。
3. **custom_symbols 重建必须包在单个事务内**（SQLite DDL 是事务性的，中断整体回滚），并能自愈两类中断残局（残留空中间表／老表已删只剩中间表）。判据必须看**行数**不能只看表在不在。

---

## 2. P1 · 网站上线（卡在用户侧手续）

**代码侧已就绪**：`scripts/deploy/`（install／deploy／backup／restore／systemd／Caddyfile）＋ `docs/deploy.md`（含备案、服务器、运维、备份恢复演练、域名与微信后台配置、小程序发布清单）。

**卡点（全部在用户侧，需用户去办）**

| 事项 | 状态 | 说明 |
|---|---|---|
| 域名 | ❌ 没有 | 需注册 |
| ICP 备案 | ❌ 没提交 | **7~20 工作日**（个别省份约 1 个月），整条时间线上最长的一段；主体须与域名注册一致 |
| 境内轻量服务器 | ❌ 没买 | 2 核 4G；个人主体备案要求境内服务器 |
| 微信小程序账号 | ❌ 没注册 | 个人主体 |

**下一步**：**域名注册 → 个人实名 → 立刻提交 ICP 备案（Day 0）→ 买服务器**。备案期间可以并行做 P2 真机验证与 P4 桌面实现。

---

## 3. P2 · 微信小程序（代码完成，未真机验证）

**形态**：原生开发（个人主体**不支持 `web-view`**、**不可用 `getPhoneNumber`**）→ 只能原生写页面。

**已完成**：`miniprogram/pages/` 8 个页面（login／cases／record／findings／medication／triad／case-detail／me）＋ 传输层 `utils/api.js`（可换 `wx.request` / `wx.cloud.callFunction`）＋ 与网站共用的知识库编译产物（`utils/core/`，gitignore）。

**卡点**

| 事项 | 状态 | 说明 |
|---|---|---|
| 真实 AppID | ❌ `project.config.json` 里仍是 `touristappid` | 注册个人主体小程序后填入 |
| 合法域名 | ❌ 未配置 | 依赖 P1 的域名与备案 |
| 真机验证 | ⬜ 未做 | 代码完成但**从未在真机上跑过** |

**账号打通方案（已拍板）**：小程序用**网站账号＋密码**绑定微信（`/api/auth/wechat/bind`），网站与小程序共用同一 `users` 行。

---

## 4. P3 · 后期迁 CloudBase（规划完成，待触发）

**目标**：网站跑静态托管、API 跑云函数、数据存 **PostgreSQL**、小程序走 `wx.cloud.callFunction`（不走合法域名校验）。

**代码侧前期准备已落地**（迁的时候不用再改）

- db/auth 层全部 **async**；`server/store.mjs` 是**存储契约层** → 换后端只改这一处，路由层／前端／小程序不动
- `PULSE_STORE=pg` 的分支骨架已留好
- `docs/cloudbase-migration.md` 记了表结构映射与坑位清单

**触发条件**：P1 上线后、单机/多用户都跑顺了再迁。**不急** —— 现在迁反而多一层风险。

---

## 5. P4 · Windows 桌面应用（方案已成，未实施）

**用户已拍板**：① 打包形态＝Windows 桌面 App；② 数据模型＝**单机、免登录、只在这台电脑上**。

**方案全文**：[`docs/desktop-plan.md`](./desktop-plan.md)（含已核实的 Electron 版本→Node 映射、架构图、逐文件改动清单、风险表、验证计划）。

**当前状态**：**仅方案落库，实现一行未写**。分支 `chore/desktop-electron` 已开（基点 `b9e3b19`）并推到远端。

**待办（按方案 §11 的里程碑）**：P0 探测 `node:sqlite` → P1 桌面壳 → P2 打包配置 → P3 老数据带入 → P4 CI 与文档。

---

## 6. 当前仓库状态（2026-11-04 实测）

| 项 | 值 |
|---|---|
| 当前分支 | `chore/desktop-electron`（基点 `b9e3b19`） |
| 远端分支 | `main` = `a0f5c10`；`chore/multi-user` = `b9e3b19`；`chore/desktop-electron` = `b9e3b19` |
| PR | #6 `chore/multi-user → main`，**OPEN**，10 个提交，可合并（GitHub 已生成 test-merge ref） |
| 未推送提交 | 无（`origin/…..HEAD` 为空） |
| 全量回归 | **174/174 通过** |
| 本机库 | `pulse-record/local-data/history.sqlite`（73 KB） |
| 本机数据 | 账号 `local`（admin，**0 患者 0 就诊**）＋ `guoguo`（user，**14 患者 56 就诊**）；medication 0 条、custom_symbols 0 条 |
| dev server | 多用户模式在跑：后端 5178／前端 5180，日志 `/tmp/pulse-dev.log` |

> ⚠️ `local` 名下是 **0 行**、数据都在 `guoguo` 名下 —— 这正是桌面版「老数据带入」必须处理的 owner 归属陷阱，详见 `desktop-plan.md` §5.3。

---

## 7. 待用户办的事（按关键路径排序）

| 优先级 | 事项 | 为什么急 |
|---|---|---|
| 🔴 1 | **域名注册 → 个人实名 → 提交 ICP 备案** | 7~20 工作日，是整条时间线最长的一段；不今天提交，后面小程序、CloudBase 全在等 |
| 🔴 2 | **注册微信小程序（个人主体）→ 填真实 AppID** | 小程序代码已完成，卡在 AppID 与真机验证；与备案可并行 |
| 🟡 3 | **买境内轻量服务器（2 核 4G）** | 备案通过后要立刻部署 |
| 🟡 4 | **在 `chore/desktop-electron` 上实施桌面版** | 方案已就绪，5 个里程碑可自行推进；不依赖前 3 项 |
| ⚪ 5 | AGENTS.md「下游用途」空位 | 由维护者自行填写一行 |
| ⚪ 6 | 代码签名证书（可选） | 只影响安装时的 SmartScreen 提示，不影响功能 |

---

## 8. 维护约定

- **什么时候更新本文**：① 某条工作线状态变化（完成／被阻塞／方案变更）② 关键决策拍板 ③ 阻塞项清单变动 → 改完连同相关代码/文档一起提交。
- **提交前缀**：沿用 `AGENTS.md`「Git 约定」—— `docs:` 资料整理／笔记 ｜ `data:` 新增或更新原始资料 ｜ `chore:` 工具与配置 ｜ `ocr:` 识别文本落盘；**代码与文档分开提交**。
- **分支纪律**：不直推 `main`；从 `main`（或依赖已就绪的分支）切分支 → PR。
- **表格优先**：状态一律用表格写，行尾标注实测日期，别写「大概」「应该」。
