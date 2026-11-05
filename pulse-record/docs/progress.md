# 项目进度 —— 臧氏脉学 · 脉象记录表生成器

> **更新于** 2026-11-05 ｜ **仓库** `erikgqp8645/zang-shi-mai-xue` ｜ **当前分支** `feat/wechat-miniprogram`（基点 `c1814f3`）
>
> 本文是**进度台账**：记每条工作线做到哪了、卡在哪、下一手做什么。
> 桌面应用的**实施方案**另见 [`desktop-plan.md`](./desktop-plan.md)；上线手册见 [`deploy.md`](./deploy.md)；迁 CloudBase 见 [`cloudbase-migration.md`](./cloudbase-migration.md)；小程序 Taro 迁移约定见 [`taro-migration.md`](./taro-migration.md)。

---

## 0. 一张表看全局

| 工作线 | 状态 | 关键结论 | 下一步 |
|---|---|---|---|
| **P0 多用户与数据隔离** | ✅ 已完成 | `users`＋`identities`＋`sessions` 三表；四张业务表下沉 `owner_id`；跨用户一律 404 | 等 PR #6 合并 |
| **P1 网站上线** | ⏸ **卡在用户侧手续** | 脚本与文档已就绪，**域名／ICP 备案／服务器三样都没有** | 备案 7~20 工作日是整条时间线最长的一段 → **今天就去提交备案** |
| **P2 微信小程序** | 🟡 **已迁 Taro ＋ 界面重排完成**；模拟器逐页截图已验，未真机验证 | 8 个平级页面 → **4 个 tab（病例／就诊／用方／我的）**，「就诊」是工作台页（吸顶上下文条 ＋ 4 个页内 tab ＋ 底部操作条）；Taro 4.3.2 ＋ React 18，与网站**共用同一份 domain 源码**；鸿蒙 C-API 编译已通；回归 **321 项全绿** | 后台声明「相册（仅写入）」→ 真机跑一遍 |
| **P3 后期迁 CloudBase** | ⏸ 规划完成，待触发 | 存储已收敛成 `server/store.mjs` 一层；db/auth 全 async | 真正迁的时候只改一处 |
| **P4 Windows 桌面应用** | ✅ **已实现**，本机出包并实测 | Electron 44.10.2；复用现有 `server/`＋`dist/`，业务逻辑不重写 | 交给使用者安装使用；macOS 包另找 Mac 机器补 |

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
| 真实 AppID | ✅ 已填 `wx3a21eb903a16cbc4` | 开发者工具需登录对应管理员微信号 |
| AppSecret / 上传私钥 | ✅ 在 `pulse-record/.secrets/`（gitignore，600） | AppSecret 只给服务端；私钥给命令行上传，用前加 IP 白名单 |
| 用户隐私保护指引 | ❌ **未声明「相册（仅写入）」** | 后台没声明 → 真机 `saveImageToPhotosAlbum` 直接报 `privacy permission is not authorized`，且用户在设置里打不开（不是用户拒绝）。**现在就能配，不依赖备案** |
| 合法域名 | ❌ 未配置 | 依赖 P1 的域名与备案 |
| 真机验证 | ⬜ 未做 | 代码完成但**从未在真机上跑过** |

**账号打通方案（已拍板）**：小程序用**网站账号＋密码**绑定微信（`/api/auth/wechat/bind`），网站与小程序共用同一 `users` 行。

### 3.1 本机联调（2026-11-04，分支 `feat/wechat-miniprogram`）

**起点**：`chore/desktop-electron`（含 P0 多用户 ＋ 小程序 8 页 ＋ 共享包）。

| 做了什么 | 结果 |
|---|---|
| `npm run mp:dev` / `mp:dev:multi` | 一条命令：自动 `build:core` ＋ 起后端 ＋ 打印导入目录／本机局域网 IP／真机注意事项 |
| 服务器地址改成**运行时可改** | 「我的 → 服务器」卡片（保存／测试连接／恢复默认），存本地 `pulse.apiBase`；`api.js` 每次请求现取地址 → 真机换 IP 不用改代码重编译 |
| `npm run test:e2e:mp:api` | **wx 垫片**在 Node 里加载真实 `utils/{config,api,data,auth}.js` 连真后端跑全链路，**38 项全通过** |
| 修一个真 bug | `server/db.mjs` `putVisitMedication` 漏 `await getVisit()` → `cur.patientId` 是 `undefined` → **单次就诊保存用药必 500**。这条链路小程序与网页共用，等于网页版也一直是坏的（回归没覆盖到） |
| 文档 | `docs/miniprogram-dev.md`（三条路线／手工清单／卡点表）＋ README「微信小程序」一节重写 |

**回归**：core 26 ＋ mp 29 ＋ mp:api 38 全通过。

**仍未做**：真机验证（代码与数据层都已自动验证，但没在手机上跑过）、真实 AppID、合法域名。

### 3.2 模拟器自动化冒烟（2026-11-04）

官方 `wechatide` skill 需要在开发者工具里点一次**授权弹窗**才能用。点不了时的替代路径：
开发者工具自带的 `cli` ＋ `miniprogram-automator` —— **全程不需要点击**，
覆盖编译、导航、截图、console、预览二维码、上传。

```bash
cli auto --project "$PWD/miniprogram" --auto-port 9420 --trust-project --port 63190
npm run test:e2e:mp:sim        # 8 页逐页跑 + 逐页截图 + 断言
```

| 做了什么 | 结果 |
|---|---|
| `scripts/e2e/mp-sim.mjs`（新增，入库） | 8 个页面逐页跑通、逐页截图、console 干净 → **14 项全过** |
| **抓到并修掉一个真 bug** | 小程序侧 `planDiagram({width,height}, …)` 传的是**尺寸占位对象**而不是真图片 → `ctx.drawImage` 抛 TypeError → **表格和寸关尺图示一个都画不出来**，`tempFilePath` 永远为空（「存相册」是死的）。网站端 `src/export/png.ts` 传的是真图片，所以网站一直正常 —— 只有小程序坏。修完画布 636×988.69，与网站端共享包算出来的**尺寸完全一致** |
| 相册导出分支 | 区分「后台没声明隐私」与「用户拒绝授权」：前者如实告知（用户在设置里也打不开），后者才引导 `wx.openSetting` |
| **再抓到一个版式 bug** | **所有输入框把文字裁掉一半** —— 小程序 `<input>` 是原生组件，盒子高度不随 padding 撑开，UA 默认高度约 1.4em，配上 `box-sizing:border-box` 与上下 16rpx padding，内容盒只剩几 rpx。改成显式给 `height`/`line-height`（72rpx）后姓名、登录名、密码、方名全部完整显示 |
| 弃用接口 | `wx.getSystemInfoSync()` → `wx.getDeviceInfo()`（真机会一直告警） |
| 回归断言 | `mp-lint` 加两条：底图不能传尺寸占位、不能用 `wx.getSystemInfoSync`；**故意写坏验证过能抓到**（30/31 → 修好 31/31） |
| 8 个页面逐页截图 | ✅ 逐页看过 | 病例／依脉用方／三部曲／我的／录入／用药记录／病例详情／登录 —— 版式与讲义 p34、p47 对得上 |
| 依赖 | `miniprogram-automator` 进 devDependencies；静态检查 29 → **31 项** |

> 教训：这类「静默失败」静态检查抓不到 —— 页面看着像「图还没生成」，
> 只有把模拟器真跑一遍、盯住 console 才会露出来。

### 3.3 寸关尺图示改为单独窗体（2026-11-05）

**起因**：真机看下来，手部寸关尺示意图**看不清** —— 底图 1070×876 被塞进表格宽的画布里放大
（手机 dpr＝3 时放大 1.8 倍），又宽过手机屏，出来是一张糊掉的大手。

**改法**（用户拍板三点：导出保留图示 ／ 单独窗体 ／ 只改小程序）：

| | 画什么 | 尺寸 | dpr |
|---|---|---|---|
| 页面上的画布 `#pulse-canvas` | **只有表格**（`planTable` 的 layout） | 636 × 444（9 行体例） | 设备 dpr |
| 离屏画布 `#pulse-off-canvas` → 存相册／转发 | 表格 ＋ 寸关尺图示 | 1272 × 1977 | 固定 2（与网站 `src/export/png.ts` 一致） |
| 离屏画布 → 「寸关尺图示」预览 | **只有图示**，原图 1:1 | 1070 × 876 | 1 |

- 入口：操作行多一个「寸关尺图示」→ `wx.previewImage` 系统图片预览（可双指缩放、全屏，关掉即回页面）
- **导出仍然带图示**，与网站端同一套绘制代码、同一 dpr＝2 → 两端 PNG 尺寸一致
- 网站端**不动** —— 那边图示本来就是独立区块（`<img>`＋SVG 叠加，可点浮/中/沉选格子），没有糊的问题
- 离屏画布用 `position:fixed; left:-3000px`，**不能用 `display:none`**（那样拿不到 canvas 节点）

**验证**：冒烟 **14/14 全过**（新增三条断言：页面画布只有表格／导出图出得来／图示图出得来）；
导出 PNG 实测 1272×1977、图示 PNG 实测 1070×876；模拟器实点入口 → 预览窗体弹出，画面清晰。

### 3.4 体例只有一个真源 —— 记录表与录入记录不再打架（2026-11-05）

**现象**：同一位患者，**记录表**（病例详情页的画布）画 7 行，**录入记录**（录入页的表格）画 9 行。

**根因**：体例（7 脉点 / 9 行）有**两个真源**。

| 环节 | 读的是 | 后果 |
|---|---|---|
| 记录表（canvas / 导出 PNG） | 库里的 `patients.layout` | 7 行 |
| 录入记录 | `record.js` 的**页面状态** `data.layout` | 9 行 |

录入页的体例按钮**只改页面状态、不落库**（要等点「保存」）→ 同一位患者两个页面能同时是 7 行和 9 行。
实测数据佐证：guoguo 账号下「演示·马春霞」`layout=nine`，但每次就诊仍只有 **14 格**（7 行份）——
体例被改过，而「尺浮/尺中」两行**从来没有数据**，所以 9 行下那两行是空的（看着像数据丢了）。
其余三位 seven 体例的演示患者都是 14 格，只有她对不上。

**改法**（两端同一规则）：

1. **后端**：`PATCH /api/patients/:id` 支持 `{layout}`（原来只支持 `{name}`）；
   新增存储函数 `updatePatientLayout(db, id, ownerId, layout)`（`server/db.mjs` ＋ `server/store.mjs` 契约层）。
   **只改体例、不动格值** —— 7↔9 来回切，「尺浮/尺中」两行的数据仍原样留着。
2. **小程序录入页**：体例按钮**切换即落库**（新建患者还没 id 时才只改本地）；切换后提示影响
   （7→9 多出「尺浮、尺中」两行，没数据就是空行，导出也会多两行；9→7 那两行不再显示，数据仍留着）。
3. **小程序病例详情页**：记录表卡片上标出当前体例（「9 行体例（尺浮中沉）」／「7 脉点体例（尺只沉）」）；
   并加 `onShow` 回读 —— 从录入页返回时重新拉一次，体例改了记录表立刻跟上。
4. **网站端**：布局单选同样**切换即落库**（`doSwitchLayout`），并在下方写明「体例是这位患者的设置，切换立即保存」。
5. **数据层**：`scripts/lib/layout-check.mjs` 抽出体例自检（体例 ⇄ 格值行数）；
   `seed:demo` 写完逐位自检、对不上就报错退出；`npm run admin -- layout <登录名> <患者id或姓名> <nine|seven>` 运维兜底。

**验证**

| 断言 | 结果 |
|---|---|
| `mp-lint`（31 → **34**）：切换体例必须落库；两处都要显示体例 | 故意写坏 33/34 → 修好 34/34 |
| `mp-api`（38 → **43**）：PATCH layout 生效／落库／不动格值／非法值 400 | 全过 |
| `auth-isolation`（51 → **52**）：B 改 A 的体例 → 404 | 全过 |
| `app-regression`（15 → **18**）：网站端切换后表格立刻 7 行、库里也是 seven | 全过 |
| `mp-sim`（14 → **16**）：**录入记录的行数必须等于记录表的行数** | 故意写坏 15/16（录入 7 行 vs 记录表 9 行）→ 修好 16/16 |
| 模拟器端到端 | 切换前 9 行/9 行 → 点按钮 → 录入页 7 行 → 记录表 canvas 504×364（42×2＋7×40）＝7 行 ✅ |

**数据修正**：guoguo 账号下「演示·马春霞」体例改回 `seven`（与其 14 格数据、`seed-demo.mjs` 的定义一致），
用新加的 `admin -- layout` 改的，命令自带自检输出。


### 3.5 记录表与录入记录合流 —— 同一个组件、可就地编辑（2026-11-05）

**用户要求**（09:41，两张截图）：

1. 「还是不一样。我建议直接直接在记录表就可以直接编辑，绿色框框处为编辑按钮。」
2. 「记录表显示为第一个界面一模一样。」

截图事实：图1＝小程序**录入页**（何文斌，9 行，橙色部位列，表下有「（未判）」「体质（未定）」两行）；
图2＝小程序**病例详情页的「记录表」**（canvas 版，无体质两行、不可编辑）。

**根因**（和 3.4 同一个病根的另一半）：3.4 把「体例」统一到一个真源了，但**版式本身还是两份**——
录入页是 WXML 画的，病例详情页是 canvas 画的。**两套各画各的**，所以：
canvas 版没有表下「体质／（未判）」「（未定）」两行、不能点格编辑、字号行距也对不上。

**改法：把「录入记录表」抽成组件，两处都用它。**

| 位置 | 内容 |
|---|---|
| `miniprogram/components/record-sheet/` | 新组件：`record-sheet.{json,js,wxml,wxss}`。含主表（表头／正文／表下体质疗法两行）＋符号面板 ＋ 体质／疗法弹层 |
| `pages/record/record.*` | 录入页改成用 `<record-sheet>`（工具条、姓名、加记录、体例、载入示例、保存条都留在页面里） |
| `pages/case-detail/case-detail.*` | 记录表卡片改成用 `<record-sheet>`；可见 canvas **移除**（只留离屏 canvas 出图）；标题行右侧放「录入编辑」按钮（＝绿框位） |

**组件对外接口**

| 类别 | 内容 |
|---|---|
| properties | `sessions` / `layout` / `customSymbols` / `name` / `editable` |
| events | `change`（detail: `{ sessions }`）—— 格值／体质／疗法有改动；`sessiontap`（detail: `{ id }`）—— 点了表头日期 |

组件**只管显示与交互**，落库由页面决定：录入页收到 `change` 更新本地 state、点「保存」才落库；
病例详情页**没有保存按钮**，收到 `change` **立即落库**（逐次就诊 `PATCH /api/visits/:id`，只写回被改动的那一次）。

**顺手修掉的两个真 bug**

1. **`.pr-grp` 撞名** —— 表格的部位分组和符号面板的分组都叫 `.pr-grp`，样式互相串
   （面板分组被拉成一行、底下多一条黑线）。面板另起 `.pr-pal-*` 一套。
2. **视图层把嵌套数组压成对象**（**最隐蔽的一个**）—— 自定义组件的属性（`sessions`）会走一圈
   **逻辑层 → 视图层 → 逻辑层**，视图层的数据协议把**嵌套数组**压成「数字下标的普通对象」：
   `["X"]` 回来变成 `{"0":"X"}`。于是 `formatCodes` 里的 `codes.join` 抛
   「codes.join is not a function」，**而且是静默失败**——表格那一列画不出来，页面上看不出所以然。
   更要命的是**第二次编辑**会把 `{"0":"X"}` 这种形状**存进数据库**，以后这一格就废了。
   **两端都兜住**：小程序侧读写前按数字下标还原成数组（`toCodeArray`／`cleanValues`／`cleanSessions`）；
   服务端侧写库前规整、读出来也规整（`server/db.mjs` 的 `normalizeValues`，老脏数据照样读得对）。

**验证**

| 断言 | 结果 |
|---|---|
| `mp-lint`（34 → **50**）：组件存在且是组件／两页都用 `<record-sheet>`／两页都不许自己画表格骨架／组件抛 `change`／病例详情页改完立刻落库／绿框位有「录入编辑」；另加组件自身的「WXML 不调函数／事件都有方法／require 路径存在」 | 故意写坏 49/50（4 种破坏各被抓 1 条）→ 修好 50/50 |
| `mp-api`（43 → **46**）：服务端把 `{"0":"X"}` 还原成 `["X"]`、多符号顺序不乱、读回来没有脏形状 | 故意写坏 43/46（3 条全被抓）→ 修好 46/46 |
| `mp-sim`（16 → **26**）：两页用同一个组件／两页版式完全一致（部位·取法·列数逐项对账）／记录表可就地编辑／改完立刻落库（重新拉取能读到新值）／**连续改两格不能把第一格写坏**／冒烟改的格子已复原 | 故意写坏 22/26 → 修好 26/26 |
| 模拟器截图逐页核对 | 病例详情页与录入页的表格**逐行逐列一致**：橙色部位列（寸／关／尺纵向合并）、浮中沉行、表下体质／疗法两行 |
| 全量回归 | **278/278 全绿**（core 26 ＋ mp 50 ＋ mp:api 46 ＋ migration 53 ＋ auth 52 ＋ app 18 ＋ 桌面端 33） |

**教训**：这次三处「不一样」都出在**同一件事有两个来源**（体例两个真源 → 版式两份实现 → 组件属性被视图层改写）。
所以规矩是：**能合成一个来源的，绝不留在两处**；跨进程的形状，一律在边界上规整，不指望对端守规矩。


### 3.6 小程序迁 Taro ＋ 界面重排（2026-11-05）

**触发**：使用者反馈「界面零散，手机用户需要多次返回，查看才能进行操作」—— 根因是**每个域一套页面**（8 个平级页面，来回跳）。
决定重排信息架构，并把框架从原生小程序换成 **Taro 4.3.2 ＋ React 18**（近期要上鸿蒙，多端必须同源）。

#### 界面重排：8 个平级页面 → 4 个 tab

| tab | 是什么 | 取代了原来的 |
|---|---|---|
| **病例** | 患者列表 ＋ 新建 ＋ 搜索 | `cases` ＋ `findings` 的入口 |
| **就诊** | **工作台页**：吸顶上下文条（患者 × 就诊）＋ 4 个页内 tab（脉象／判读／用药／出图）＋ 底部固定操作条 | `record` ＋ `triad` ＋ `medication` ＋ 出图 |
| **用方** | 知识库（分组 chips：讲稿原序／按五行／按左右手） | `findings` |
| **我的** | 账号／微信绑定／服务器／改密码 | `me` |

- 「就诊」不再是「先进病例、再进就诊、再进录入」的三级下钻 —— **上下文条一直挂在顶上**，随手切患者／切就诊。
- 录入支持 **宽表** ＋「**一次一屏**」竖排两种视图：**同一组件两个渲染分支、同一份 `values`**；视图偏好存本地（`pulse.recordView`，不落库），
  **只有体例 `layout` 落库**。表格体例本身**一个字没改**（讲义 p34 的宽表仍是「记录表」本体）。

#### 工程：Taro

| 项 | 值 |
|---|---|
| 工程 | `pulse-record/taro/`（**原生 `miniprogram/` 原样保留作回退**） |
| 版本 | Taro 4.3.2 ＋ React 18.3.1 ＋ Vite 4.5.5 ＋ TS 5.7.3 |
| 共享包 | alias `@domain/*` → `src/domain/*`（**零复制，直接引同一份源码**）；`@export/*` 只准引 4 个绘制器 |
| 平台适配层 | `taro/src/platform/` —— **业务代码里不许出现 `wx.`**（`taro-lint` 有断言） |
| 包体 | **0.99 MB**（微信上限 2 MB）—— 分包**不启用**（tabBar 页必须在主包，分包省包体这条路不成立） |
| tabBar 图标 | `scripts/gen-tabbar-icons.mjs` 自写 PNG 编码器生成 8 张 81×81（配色 `#7c8974`／`#2c2925`） |

#### 鸿蒙（C-API）—— 本轮最大的技术突破

`npm run mp:taro:harmony` **编译成功**，产出 `harmony/entry/src/main/ets/`：`app.ets` / `render.ets` / `taro_tabbar.ets` / 各页 `index_taro_comp.js`。

| 坑 | 怎么绕过去的 |
|---|---|
| `Error: 不存在编译平台 harmony_cpp` | CLI 4.3.2 内置平台清单**没有** `harmony_cpp` → 须在 `config/index.ts` 的 `plugins` 里挂 `@tarojs/plugin-platform-harmony-cpp` |
| `Cannot find module '@babel/preset-typescript'` | 该插件**漏声明依赖** → 补 `npm i -D @babel/preset-typescript` |
| `SyntaxError: src/app.tsx: Unexpected token, expected "from"` | 上游 `@tarojs/vite-runner` 的 `dist/harmony/babel.js` 里有个 `enforce:'pre'`、插件名为空串的 babel 插件，`transformSync` **没给 preset** → 写 `taro/config/harmony-workaround.ts` 摊平 vite 插件数组，给它的 `transform` 套一层「`.ts`/`.tsx` 原样放行」 |
| 绕行补丁注册四坑 | ① 钩子不能写成插件对象的方法 ② 不能写在 `config/index.ts` 的配置字段里（CLI 会覆盖）③ 默认导出必须是**工厂函数** ④ `config.plugins` 只收**字符串** |

> 绕行补丁**收敛在 `taro/config/harmony-workaround.ts` 一个文件里**，用上游同款 `ctx.modifyViteConfig?.(cb)` 注册方式，只在 `TARO_ENV=harmony_cpp` 时注册；上游修好后删该文件即可。

#### 回归改写

| 套 | 脚本 | 结果 |
|---|---|---|
| 静态 | `scripts/e2e/taro-lint.mjs` | **94/94**（扫 TSX：禁 `wx.` 直调／禁 WXML-WXSS 残留／组件同源／术语用字／知识库入口收得住） |
| 数据层 | `scripts/e2e/taro-api.mjs` | **45/45**（垫一个 Taro，连真后端跑全链路） |
| 真机渲染 | `scripts/e2e/taro-sim.mjs` | 39 项 / 38 通过（纯函数 25 ＋ 产物段全绿；截图段需 `MP_SIM_WS` 指向 `cli auto` 实际打印的端口） |

- **断言本身要先「故意写坏」验证能抓到** —— 本轮四连验全部按预期抓到：① 业务代码真直调 `wx.` ② URL 后同一行藏 `wx.` ③ `cleanValues` 改名 ④ 非白名单组件引知识库。
- 根 `package.json` 的 `test:e2e:mp` / `:api` / `:sim` **切到 Taro 三套**；原生三套保留为 `test:e2e:mp:legacy` / `:legacy:api` / `:legacy:sim`。
- **全量回归 278 → 321 全绿**（core 26 ＋ taro-lint 94 ＋ taro-api 45 ＋ migration 53 ＋ auth 52 ＋ app 18 ＋ 桌面端 33）。

#### 模拟器真实渲染验证（端口 9421）

四个 tab **逐页截图通过**：病例页（真实患者数据 ＋ 4 个自绘图标）／就诊工作台（吸顶条 ＋ 4 个页内 tab ＋ 底部操作条）／用方页（分组 chips）／我的页（账号・微信绑定・服务器・改密码全渲染）／登录页（服务端没配 AppID → 自动降级到账号密码步并给提示文案）／病例详情页（记录表 72 格 ＋ 录入编辑 ＋ 出图按钮）。
**记录表渲染逐项核对**：橙色部位列 `#FFC000`、浅绿表底 `#CCE8CF`、宽表横滚、符号 `++ ↑ X | 0 −` 齐全。

#### 还差的

| 项 | 说明 |
|---|---|
| **鸿蒙出 HAP** | 本机**没装 DevEco Studio / ohpm** → 在 DevEco 里 Sync Now 即可（`build-profile.json5` 也要在 DevEco 工程里备好，用 `TARO_HARMONY_PROJECT` 指过去） |
| 鸿蒙侧能力验证 | `saveImageToPhotosAlbum`／`previewImage`／一键登录的替代能力待验；Canvas 2D 能否拿到节点待验（降级路径：页内显示 ＋ 自行截图，**不得让就诊流程不可用**） |
| 鸿蒙上游隐患 | `@tarojs/plugin-framework-react` 判平台用 `TARO_ENV === 'harmony'`，我们用 `'harmony_cpp'` → 会落到 mini 分支（当前靠绕行补丁兜住） |
| 真机验证 | 同 3.1 —— 需扫新二维码，见 §7 |


---

## 4. P3 · 后期迁 CloudBase（规划完成，待触发）

**目标**：网站跑静态托管、API 跑云函数、数据存 **PostgreSQL**、小程序走 `wx.cloud.callFunction`（不走合法域名校验）。

**代码侧前期准备已落地**（迁的时候不用再改）

- db/auth 层全部 **async**；`server/store.mjs` 是**存储契约层** → 换后端只改这一处，路由层／前端／小程序不动
- `PULSE_STORE=pg` 的分支骨架已留好
- `docs/cloudbase-migration.md` 记了表结构映射与坑位清单

**触发条件**：P1 上线后、单机/多用户都跑顺了再迁。**不急** —— 现在迁反而多一层风险。

---

## 5. P4 · Windows 桌面应用（✅ 已实现）

**用户已拍板**：① 打包形态＝Windows 桌面 App；② 数据模型＝**单机、免登录、只在这台电脑上**。

**方案全文**：[`docs/desktop-plan.md`](./desktop-plan.md)（含已核实的 Electron 版本→Node 映射、架构图、逐文件改动清单、风险表、验证计划）。
**使用与构建说明**：[`docs/desktop.md`](./desktop.md)。

**当前状态**：**已实现并实测通过**（2026-11-04，本机 Windows）。

### 5.1 里程碑执行结果

| 阶段 | 结果 |
|---|---|
| **P0 探测** | ✅ 通过。Electron 44.10.2 内置 Node **24.22.2**，`node:sqlite` **3.53.4** 可用，读回／回滚／外键行为与普通 Node 一致。**风险 R1 解除** |
| **P1 桌面壳** | ✅ `server/index.mjs` 拆出 `startServer()`；`desktop/{main,server-entry,preload.cjs,db-transfer}` 就位；导出改走系统另存为，Web 端行为不变 |
| **P2 打包** | ✅ `electron-builder.yml`＋`build/icon.png`；**本机 Windows 直接出包，不需要 Wine** |
| **P3 老数据带入** | ✅ 「导入数据文件」＋ `admin claim-local`；owner 归属已改挂 |
| **P4 CI 与文档** | ✅ `.github/workflows/desktop-windows.yml`＋`docs/desktop.md`＋README 一章＋AGENTS.md 一节 |

### 5.2 产物（实测）

| 文件 | 大小 |
|---|---|
| `release/ZangShiMaiXue-0.1.0-x64-setup.exe`（安装包） | 115.9 MB |
| `release/ZangShiMaiXue-0.1.0-x64-portable.exe`（免安装） | 105.1 MB |
| `release/win-unpacked/`（解包目录） | ≈ 300 MB |

**打包产物已实测可跑**：进程存活、服务起在随机端口、页面完整渲染、同源 `/api/health` 200、
写入往返正常（POST → GET 读回）、零 console 报错、数据落在 `%APPDATA%\臧氏脉学\history.sqlite`。

### 5.3 验收实测

| 项 | 结果 |
|---|---|
| 全量回归 | 桌面端验收时 **207/207 全绿**（174 ＋ 桌面端 33）；**2026-11-05 体例改动后为 259/259 全绿**（core 26 ＋ mp 34 ＋ mp:api 43 ＋ migration 53 ＋ auth 52 ＋ app 18 ＋ 桌面端 33）；**2026-11-05 组件合流后为 278/278 全绿**（core 26 ＋ mp 50 ＋ mp:api 46 ＋ migration 53 ＋ auth 52 ＋ app 18 ＋ 桌面端 33） |
| 桌面端回归 | 新增 `scripts/e2e/desktop-smoke.mjs`（33 项，**不依赖 Electron／Chrome**，CI 也能跑；含 9 项数据落点断言） |
| Electron 探测 | 新增 `scripts/e2e/electron-probe.mjs`（Node baseline ＋ Electron 对照） |
| 另存为链路 | 端到端实测：preload → IPC → 主进程写盘 → 文件落盘、内容逐字节一致 |
| 老数据带入 | 用**真实库**实测：15 患者／57 就诊／1 自定义符号（S＝涩）全部进桌面版且**归属改挂到本机账号**，原库一个字节没动 |

### 5.4 顺手修掉的 3 个 Windows 平台 bug

方案原按 macOS 开发写的，下列三处在 Windows 上会让回归跑不完 —— 已修：

| # | 位置 | 症状 | 修法 |
|---|---|---|---|
| 1 | `scripts/e2e/mp-lint.mjs` | 「排除共享包」规则写死 `'/core/'`，Windows 下路径是 `\core\` → 排除失效，把编译产物当小程序页面来查 | 路径统一转 POSIX 再判断 |
| 2 | `scripts/e2e/migration.mjs` | `await import('D:\\…\\db.mjs')` → `ERR_UNSUPPORTED_ESM_URL_SCHEME`（协议 `d:`） | 用 `pathToFileURL(...).href` |
| 3 | `scripts/e2e/lib.mjs` | `spawnSync('npm')` 在 Windows 上找不到（且 Node ≥18.20 起 spawn `.cmd` 报 EINVAL）；`chromePath()` 只有 macOS/Linux 路径 | 统一走 `cmd.exe /c`；补 Windows 的 Chrome 路径 |

### 5.5 与方案的两处偏差（都是往好的方向）

| 方案原文 | 实际 | 为什么更好 |
|---|---|---|
| §8.2/8.3：macOS 上用 GH Actions 或 Wine 交叉编译出 Windows 包 | **在 Windows 上本机原生出包**（无需 Wine、无需 CI） | 本机就是 Windows：省掉 6 GB Wine 与 CI 往返。CI 仍然保留（换机器／追版本时用） |
| §4.7：用 `hands-pulse.png` 中心裁切当图标 | 另做一枚「脉」字图标（`build/icon.png`） | 那两张素材都是**带文字的技术图**（寸关尺示意图、三部曲流程图），方形裁切后既不好看也认不出是什么 |

### 5.6 免安装版的「便携」原来不成立（已修）

**问题**：初版免安装版与安装版**把数据存在同一个地方**（`%APPDATA%\臧氏脉学\history.sqlite`）——
U 盘带着 exe 走，换台电脑打开，读的还是那台电脑的 %APPDATA%（空库），**病例带不过去**。
文档里「整个文件可放 U 盘带走」这句话当时是说过头了。

**修法**：落点判定收在 **`desktop/data-dir.mjs`**（纯函数、不依赖 electron，好单测），
`desktop/main.mjs` 只负责把真值喂进去：

| 形态 | 病例库落点 | 怎么认出来的 |
|---|---|---|
| 安装版 | `%APPDATA%\臧氏脉学\history.sqlite` | 默认 |
| **免安装版** | **exe 旁边的 `data\history.sqlite`** | electron-builder 的 portable 目标会设 `PORTABLE_EXECUTABLE_DIR`（便携版跑起来时 exe 是解压到临时目录执行的，只有这个变量知道「用户把它放哪了」） |
| 开发／测试 | `PULSE_DATA_DIR` 指定 | 环境变量 |

另外两处配套：

- Electron 自己的缓存（Cache / GPUCache）**始终留在本机 %APPDATA%** —— 缓存又大又频繁写，不往 U 盘上放。
  U 盘上只有 `exe` ＋ `data\` 两个东西。
- 便携版与安装版**用不同的 userData 目录**（`臧氏脉学（便携版）` vs `臧氏脉学`）——
  单实例锁按 userData 路径算，同目录的话装了安装版再开便携版会被当成同一个 App，
  便携版双击会毫无反应。

**实测**：便携版拷到别的目录运行 → exe 旁边自动建出 `data\` 并落库；
写入一条中文病例 → 杀进程 → 重启 → 数据还在；U 盘上除 exe 与 `data\` 外没有任何缓存文件。

**回归**：`scripts/e2e/desktop-smoke.mjs` 补了 9 项落点断言（24 → 33 项）——
两种形态的落点、缓存留本机、两种 userData 不相同、覆盖优先级，
外加一条端到端：按判定出来的目录建库，库文件真的生成在 exe 旁边。

### 5.7 还差的

| 项 | 说明 |
|---|---|
| macOS 安装包 | 本轮只出 Windows；macOS 需在 Mac 上补构建（代码是跨平台的，`desktop:dev` 在 macOS 上能开窗自测） |
| 代码签名 | 未买证书 → 安装时「未知发布者」提示（已知代价，方案 §12 第 3 条已确认接受） |
| 自动更新 | 不做（无更新源） |

---

## 6. 当前仓库状态（2026-11-05 实测）

| 项 | 值 |
|---|---|
| 当前分支 | `feat/wechat-miniprogram`（基点 `c1814f3`） |
| 远端分支 | `main` = `a0f5c10`；`chore/multi-user` = `b9e3b19`；`feat/wechat-miniprogram` = 小程序 Taro 迁移实施中 |
| PR | #6 `chore/multi-user → main`，**OPEN**；#7 `chore/desktop-electron → chore/multi-user`，**OPEN**（避免依赖倒置）；`feat/wechat-miniprogram` **暂不开 PR**（上线时统一收口） |
| 全量回归 | **321/321 全绿**（core 26 ＋ taro-lint 94 ＋ taro-api 45 ＋ migration 53 ＋ auth 52 ＋ app 18 ＋ 桌面端 33） |
| 小程序工程 | `pulse-record/taro/`（Taro 4.3.2 ＋ React 18）；**原生 `miniprogram/` 原样保留作回退** |
| 小程序包体 | **0.99 MB**（微信上限 2 MB） |
| 本机库 | `pulse-record/local-data/history.sqlite`（已迁移到多用户结构：15 患者／57 就诊／1 自定义符号，归属归到 `local`；迁移前快照 `history.sqlite.bak-20261104102030`） |
| 桌面版产物 | `pulse-record/release/`（安装包 ＋ 免安装版，已 gitignore） |
| 桌面版数据 | 安装版 `%APPDATA%\臧氏脉学\`；**免安装版 exe 旁边的 `data\`** |

> ✅ 本机库**已完成迁移**（幂等，迁移前自动留 `.bak-<ts>` 备份）：补上 `owner_id`、
> 回填归属到 `local`、建立 `local` 账号 —— 15 患者／57 就诊／1 自定义符号一个没丢。
> 桌面版「导入数据文件」也支持老结构（缺的列自动跳过），**两条路都能把老数据带进桌面版**。

---

## 7. 待用户办的事（按关键路径排序）

| 优先级 | 事项 | 为什么急 |
|---|---|---|
| 🔴 1 | **域名注册 → 个人实名 → 提交 ICP 备案** | 7~20 工作日，是整条时间线最长的一段；不今天提交，后面小程序、CloudBase 全在等 |
| 🔴 2 | **后台声明《用户隐私保护指引》「相册（仅写入）」** | 不声明则真机「存相册」必挂（`privacy permission is not authorized`），且用户在设置里打不开；**现在就能配，不依赖备案** |
| 🟡 2b | 注册微信小程序（个人主体）→ 填真实 AppID | ✅ 已完成（`wx3a21eb903a16cbc4`）；开发者工具需登录对应管理员微信号才能预览／上传 |
| 🟡 3 | **买境内轻量服务器（2 核 4G）** | 备案通过后要立刻部署 |
| 🟡 4 | **桌面版装到自己的电脑上试一遍** | 已出包（`release/*.exe`），试过再决定要不要换签名证书 |
| ⚪ 5 | AGENTS.md「下游用途」空位 | 由维护者自行填写一行 |
| ⚪ 6 | 代码签名证书（可选） | 只影响安装时的 SmartScreen 提示，不影响功能 |

---

## 8. 维护约定

- **什么时候更新本文**：① 某条工作线状态变化（完成／被阻塞／方案变更）② 关键决策拍板 ③ 阻塞项清单变动 → 改完连同相关代码/文档一起提交。
- **提交前缀**：沿用 `AGENTS.md`「Git 约定」—— `docs:` 资料整理／笔记 ｜ `data:` 新增或更新原始资料 ｜ `chore:` 工具与配置 ｜ `ocr:` 识别文本落盘；**代码与文档分开提交**。
- **分支纪律**：**小程序上线之前，所有开发集中在 `feat/wechat-miniprogram` 一条分支上做**（2026-11-04 起）—— 该分支已包含账号与数据隔离、小程序端、Windows 桌面应用的全部内容；上线后再恢复按工作线切分支。仍然**不直推 `main`**。详见 `AGENTS.md`「Git 约定」。
- **PR 状态**：#6（`chore/multi-user → main`）、#7（`chore/desktop-electron → chore/multi-user`）**保持原样，既不合也不关**；`feat/wechat-miniprogram` **暂不开 PR**。小程序上线时再统一收口（届时只需决定：先合 #6/#7，还是关掉改开一个到 `main` 的单 PR）。
- **表格优先**：状态一律用表格写，行尾标注实测日期，别写「大概」「应该」。
