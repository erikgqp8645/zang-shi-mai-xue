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
| **P2 微信小程序** | 🟡 **已迁 Taro ＋ 界面重排完成**；模拟器逐页截图已验，未真机验证 | 8 个平级页面 → **4 个 tab（病例／就诊／用方／我的）**，「就诊」是工作台页（吸顶上下文条 ＋ **4 个页内 tab（摸脉／体质／疗法／方药）** ＋ 底部操作条）；Taro 4.3.2 ＋ React 18，与网站**共用同一份 domain 源码**；鸿蒙 C-API 编译已通；**寸关尺关系图直接显示在页面上**（不提供导出 → 隐私接口 0 个）；微信「代码质量」两条已修（JS 压缩已开、图片 298 KB → 116.3 KB）；回归 **441 项全绿** | 真机跑一遍（备案前先用局域网 IP） |
| **P3 后期迁 CloudBase** | ⏸ 规划完成，待触发 | 存储已收敛成 `server/store.mjs` 一层；db/auth 全 async | 真正迁的时候只改一处 |
| **P4 Windows 桌面应用** | ✅ **已实现**，本机出包并实测 | Electron 44.10.2；复用现有 `server/`＋`dist/`，业务逻辑不重写 | 交给使用者安装使用；macOS 包另找 Mac 机器补 |
| **P5 鸿蒙端** | 🟡 **已出 HAP**，未实测 | 同一套 Taro 源码走 `harmony_cpp`（C-API）；`pulse-record/harmony/` 是工程真源，编译时镜像到纯 ASCII 路径；9.1 MB unsigned 包 | DevEco 里下模拟器镜像 → 打开镜像目录 Run → 验四个 tab |

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
| 用户隐私保护指引 | ✅ **不用勾隐私类型**（2026-11-05） | 上线包**一个隐私接口都不调**（导出选项与相册／剪切板两个接口都删了，见 §3.11）→ 后台「隐私类型」一栏**不用勾**；只需在「用户信息收集」里如实填「用户输入内容／账号信息」（清单见 `docs/miniprogram-release-checklist.md` §1.3） |
| 合法域名 | ❌ 未配置 | 依赖 P1 的域名与备案 |
| 真机验证 | 🟡 **流程就绪，待实跑** | 逐步清单已写入 `docs/miniprogram-dev.md` 第 5 节（6 步 + 10 项验收表）；**尚未在手机上跑过** |

**账号打通方案（已拍板）**：小程序用**网站账号＋密码**绑定微信（`/api/auth/wechat/bind`），网站与小程序共用同一 `users` 行。

### 3.1 本机联调（2026-11-04，分支 `feat/wechat-miniprogram`）

**起点**：`chore/desktop-electron`（含 P0 多用户 ＋ 小程序 8 页 ＋ 共享包）。

| 做了什么 | 结果 |
|---|---|
| `npm run mp:dev` / `mp:dev:multi` | 一条命令：自动构建 Taro 产物 ＋ 起后端（**监听 0.0.0.0**，真机才连得上）＋ 打印导入目录／本机局域网 IP／真机注意事项 |
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
| **就诊** | **工作台页**：吸顶上下文条（患者 × 就诊）＋ **4 个页内 tab（摸脉／体质／疗法／方药）** ＋ 底部固定操作条 | `record` ＋ `triad` ＋ `medication` |
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

四个 tab **逐页截图通过**：病例页（真实患者数据 ＋ 4 个自绘图标）／就诊工作台（吸顶条 ＋ 4 个页内 tab ＋ 底部操作条）／用方页（分组 chips）／我的页（账号・微信绑定・服务器・改密码全渲染）／登录页（服务端没配 AppID → 自动降级到账号密码步并给提示文案）／病例详情页（记录表 72 格 ＋ 录入编辑 ＋ 寸关尺关系图）。
**记录表渲染逐项核对**：橙色部位列 `#FFC000`、浅绿表底 `#CCE8CF`、宽表横滚、符号 `++ ↑ X | 0 −` 齐全。

#### 还差的

| 项 | 说明 |
|---|---|
| **鸿蒙出 HAP** | 本机**没装 DevEco Studio / ohpm** → 在 DevEco 里 Sync Now 即可（`build-profile.json5` 也要在 DevEco 工程里备好，用 `TARO_HARMONY_PROJECT` 指过去） |
| 鸿蒙侧能力验证 | `saveImageToPhotosAlbum`／`previewImage`／一键登录的替代能力待验；Canvas 2D 能否拿到节点待验（降级路径：页内显示 ＋ 自行截图，**不得让就诊流程不可用**） |
| 鸿蒙上游隐患 | `@tarojs/plugin-framework-react` 判平台用 `TARO_ENV === 'harmony'`，我们用 `'harmony_cpp'` → 会落到 mini 分支（当前靠绕行补丁兜住） |
| 真机验证 | 同 3.1 —— 需扫新二维码，见 §7 |

### 3.7 上线前合规准备（2026-11-05）

**触发**：用户决定「先不做桌面版，转小程序分支」，先做**上线前合规准备**（这一段是纯技术活，不依赖后台操作）。

#### 隐私接口调用面：全量扫清 —— **现在是 0 个**（2026-11-05 更新，见 §3.11）

| 接口 | 状态 |
|---|---|
| `saveImageToPhotosAlbum`（相册·仅写入） | ❌ **已删**（`platform/album.ts` 整个文件删掉）——「存相册」选项去掉了 |
| `setClipboardData`（剪切板·写入） | ❌ **已删**（`platform/clipboard.ts` 整个文件删掉）——「复制」选项去掉了 |

→ **微信后台《用户隐私保护指引》一项都不用勾。**

**没有**的（代码里确实没调，勾了反而是「声明了没用」）：位置、通讯录、摄像头、麦克风、手机号、昵称头像、
**读取相册**、**读取剪贴板**、**写入相册**、**写入剪贴板**。

`getSetting` / `openSetting` / `login` 不是隐私接口，不用声明（`getSetting`/`openSetting` 也随相册模块删了）。

#### 补上的三处

| # | 做了什么 | 为什么 |
|---|---|---|
| 1 | **新增隐私政策页**（`taro/src/pages/privacy/index.tsx` ＋ 「我的」页入口） | 审核要求「小程序内可见」；内容逐条对着代码写（密码 scrypt+盐不存明文、登录名是手机号时才写 `users.phone`；2026-11-05 起改为「不碰相册与剪贴板」——见 §3.11） |
| 2 | **默认 API 地址改成编译期注入**（`PULSE_API_BASE` → `config/index.ts` 的 `defineConstants`） | 上线包必须指向已备案的 https 域名；不注入就是 `http://127.0.0.1:5178`。**实测**：注入后产物 `common.js` 里的地址变成注入的域名，不注入就是本机默认值 |
| 3 | **上线前检查清单**（`docs/miniprogram-release-checklist.md`） | 后台隐私指引的勾选项与**可直接复制的用途文案**、服务器域名要求、类目/截图、审核常见退路对照表 |

#### 隐私接口清单锁进回归（防止合规漂移）

`taro-lint` 新增 4 条断言（96 → 100）：

| 断言 | 拦什么 |
|---|---|
| 调用的隐私接口都在已知清单里 | **新增**了第 3 个隐私接口却没去后台声明 → 直接红，并提示「① 本清单 ② 微信后台隐私指引 ③ 上线前检查清单」三处要同步 |
| 已知清单里的隐私接口都还在用 | 清单留着**已废弃**的接口 → 后台多勾了一项 |
| 隐私政策页写明了每种隐私类型 | 改了代码里的隐私类型，政策页文案没跟着改 |
| **隐私政策页没声明上线包没用到的隐私类型**（2026-11-05 加） | 「声明了却没用」＝ 声明与后台对不上 |
| 「我的」页有隐私政策入口 | 审核要求「小程序内可见」，入口被删了 |

**断言本身验过能抓到**：临时在 `taro/src/utils/` 放一个调 `Taro.getLocation` 的文件 → 断言变红并点名 `getLocation`；撤掉后恢复全绿。

#### 实测

- 全量回归 **321 → 327 全绿**（taro-lint 94 → 100：新增页面存在性断言 ×2 ＋ 隐私接口清单断言 ×4）
- `npm run mp:taro:typecheck` 全绿 ／ `npm run mp:taro:build` 全绿（包体 0.63 MB）
- 编译期注入**双向验过**：带 `PULSE_API_BASE=https://mai.example.com` 构建 → 产物里是它；不带 → 产物里是 `http://127.0.0.1:5178`（构建后已还原，没留 example.com）

#### 还差的（要用户操作）

| 项 | 说明 |
|---|---|
| 微信后台隐私指引 | ✅ **不再是阻塞**（2026-11-05）：隐私接口降到 **0 个**，后台**一项都不用勾**（见 §3.11）。只剩「用户信息收集」那一栏要如实填（上线清单 §1.3） |
| 运营者与联系方式 | 隐私政策第九节是占位文字（`运营者：（待填写）`／`联系邮箱：（待填写）`）→ 要填 |
| 备案域名 | 等 ICP 备案；域名定下来后 `PULSE_API_BASE=https://…` 重新构建 + 后台配 request 合法域名 |


### 3.8 小程序出图底图不进包（2026-11-05）

**症状**：真机上点「看寸关尺图示」提示**「底图没载入」** —— `taro/src/platform/canvas.ts`
的 `renderDiagramImage` 抛出来的（底图取不到就整张图出不来）。

**根因不是「忘了拷」，是 copy 的写法踩了两条规则**（两条都**不报错**，只是图安安静静地没进包）：

| # | 规则 | 踩了会怎样 |
|---|---|---|
| 1 | `from` 必须用**正斜杠** | copy 插件底层是 fast-glob，而 fast-glob 里 `\` 是转义符 → Windows 上 `path.resolve()` 给的反斜杠绝对路径**一律匹配 0 个，且不报错**（静默跳过） |
| 2 | `to` 必须**带扩展名** | Taro 的 `convertCopyOptions`：`to` 带扩展名 → `to` 取目录部分、`rename` 取文件名；`to` 不带扩展名（写成 `assets/`）→ `rename` 被塞成 `'/'`，而复制器把字符串型 `rename` **直接当目标文件名** → 所有图撞到同一路径 → 只剩最后一张 |

**顺带排掉两条死路**：

- `import img from '../assets/x.png'` → Taro 4 的 `vite-plugin-assets` 报
  「fileName 必须是既非绝对路径也非相对路径的字符串」→ **这两张图不能走 import**；
- 「copy 插件不拷工程目录外的文件」→ **当时的判断是错的**。真因是反斜杠：
  实测正斜杠的**工程外**绝对路径照样拷得到（真源 `pulse-record/src/assets/` 直接指过去即可）。

**改法**：

- `taro/config/index.ts`：删掉 `syncSharedAssets()`，改成**一图一 pattern** ——
  `from` = `pulse-record/src/assets/<名>.png`（正斜杠），`to` = `assets/<名>.png`；
- `taro/src/platform/canvas.ts`：底图路径改回 `/assets/hands-pulse.png`
  （与原生版 `miniprogram/pages/case-detail/case-detail.js` 的写法**完全一致**）。

**实测**：构建日志出现 `[vite-plugin-static-copy] Copied 2 items.`；
`dist/assets/hands-pulse.png`（305 137 B）与 `triad-p47.png`（93 828 B）都在，
**SHA256 与真源逐字节一致**；包体 0.99 → **1.02 MB**（上限 2 MB）。

**决定性验证（不是看文件在不在，是问运行时）**：automator 的 `evaluate` 可以在小程序
**运行时上下文**里执行代码，于是直接问它「这张图在包里吗」：

```
wx.getImageInfo({ src: '/assets/hands-pulse.png' })
  → { ok: true, width: 1070, height: 876, path: 'assets/hands-pulse.png' }
wx.getImageInfo({ src: '/assets/triad-p47.png' })
  → { ok: true, width: 701, height: 605 }
wx.getImageInfo({ src: '/assets/NO-SUCH-IMAGE.png' })   # 对照组
  → { ok: false, err: 'getImageInfo:fail file not found' }
```

1070×876 正是「寸关尺图示底图（原图，1070 × 876）」的尺寸，701×605 正是「讲义 p47 三部曲原图」。
**这就是「底图没载入」的判据** —— 图在包里且运行时读得到，出图就不会再抛那句错。

> 为什么不用 `wx.createImage`：它是**渲染层** API，在服务层上下文里没有；
> `wx.getImageInfo` 是服务层 API，能读包内图片。

#### 锁进回归（`taro-lint` 第 22 节，100 → 111）

不靠正则猜配置长什么样，而是**用 esbuild 把 `taro/config/index.ts` 真跑一遍**：
打成 **CJS**（配置用了 `__dirname`，ESM 里没这个变量）＋ 桩掉 `@tarojs/cli`，
调一次工厂拿合并后的 `copy.patterns`，然后逐条验规则：

| 断言 | 拦什么 |
|---|---|
| copy 的 `from` 全用正斜杠 | fast-glob 的反斜杠陷阱（静默匹配 0 个） |
| copy 的 `to` 都带扩展名 | `rename` 被塞成 `'/'` → 图互相覆盖 |
| copy 的 `from` 都指向真实存在的文件 | 图被删／改名了，配置还指着老路 |
| `canvas.ts` 的底图路径与 copy 规则能对上 | 代码里写的包内路径与实际产物对不上 |
| 产物与真源逐字节一致（编过才有） | 图被改坏／拷错文件 |

**三连写坏验过**（每条**隔离**验的，不是叠着验）：

| 故意写坏 | 变红的断言 |
|---|---|
| `from` 改回 `path.resolve()` 原样 | copy 的 from 全用正斜杠 |
| `to` 写成 `assets/` | copy 的 to 都带扩展名（＋ 底图路径对不上） |
| `canvas.ts` 底图路径改成不存在的图 | canvas.ts 的底图路径与 copy 规则能得上 |

#### 顺手修掉的

- `scripts/e2e/taro-sim.mjs` 的截图段：截图目录**没建** → automator 写文件直接 ENOENT
  （补 `mkdirSync(OUT, { recursive: true })`）；
- 自动化端口**每次用完都会掉**：`mp.disconnect()` 之后开发者工具把 9421 收了 →
  跑模拟器回归前必须先 `cli auto --auto-port 9421` 重新拉起。

### 3.9 一次「整屏白」事故：产物里残留 `process.env.`（2026-11-05）

**怎么发现的**：修完 3.8 的底图问题后跑模拟器，4 张 tab 截图**全是纯白一张**。

**真正的根因不是底图，是我自己把 `config/index.ts` 的 `defineConstants` 整块删掉了** ——
改配置时用脚本按行定位替换，脚本只认**独占一行**的 `/**`，
而 copy 那段注释是**单行 JSDoc**（`/** 图片资源：…`）→ 往上找注释块时越过了
`defineConstants` 的注释 → 连着那一整块被替换掉。

**后果链**：

```
defineConstants 没了
  → 产物里留下 process.env.PULSE_API_BASE
  → 小程序运行时没有 process 这个全局量（浏览器有，是打包器 polyfill 的）
  → 启动就抛「ReferenceError: process is not defined」
  → 页面全白
```

**为什么这么难查**（每一条都单独骗了我一次）：

| 现象 | 容易误判成 |
|---|---|
| 构建**不报错** | —— |
| 静态回归**全绿**（查的是文件在不在，不是运行时） | 以为小程序没问题 |
| 模拟器截图**纯白** | 「截图功能坏了」 |
| `page.$$()` **一直挂着**（40s 超时也不回） | 「自动化端口的问题」 |
| `pageStack()` / `currentPage()` / `switchTab` / `screenshot` **全都正常** | 「页面是好的，只是元素查不到」 |

最后是靠 automator 的 **`console` / `exception` 事件**才看到那句
`process is not defined`（栈顶在 `common.js:2:1319`）。

#### 补上的三道防线

1. **静态（第 23 节）**：产物里不许残留**无守卫**的 `process.xxx`
   （`typeof process==="object"&&typeof process.emit==="function"` 这种带 `typeof` 守卫的是安全的，第三方库里就有，不能误报）；
   另加一条：配置里必须有 `defineConstants`。
   —— **写坏验过**：故意删掉 `defineConstants` → 重新构建 → 两条断言都红；恢复 → 全绿。
2. **端到端（白屏判定）**：新增 `scripts/e2e/lib-png.mjs`，**解 PNG** 统计颜色种类与非白像素占比
   （不靠文件体积猜）→ `taro-sim` 与 `privacy-sim` 的每张截图都断言「不是白屏」。
   —— 标定过：白屏 = 1 种颜色 / 0% 非白；正常页 = 117~169 种颜色 / 11%~23% 非白。
3. **运行时可见**：automator 的 `console` / `exception` 事件要挂上（诊断脚本里已用）。

#### 顺带的坑

- **`rearm()` 在 macOS 上一直是空转（2026-11-06 修）**：`lib-devtools.mjs` 原来硬编码
  `C:/Program Files (x86)/.../cli.bat` → `existsSync` 在 macOS 恒为 false → **每次都「跳过重启」**。
  而「小程序 JS bundle 在服务上下文里是缓存的，回归必须先重启」这条纪律**正是靠 `rearm()` 落实的** ——
  所以在 macOS 上它**静默失效**：故意写坏的代码进了产物，回归照样全绿（测的是旧 bundle）。
  现在按平台各给一条路径（macOS `/Applications/wechatwebdevtools.app/Contents/MacOS/cli`），
  Windows 仍走 `cmd.exe /d /c`（`.bat` 不能直接执行）。`MP_SIM_CLI` 仍可覆盖。
- **自动化端口每次用完都会掉**：`mp.disconnect()` 之后开发者工具把 9421 收了 →
  跑模拟器回归前必须先 `cli auto --auto-port 9421` 重新拉起。
- **automator 的元素查询在这套 Taro 产物上不通**：`$$` / `$` / `data()` 给 40 秒超时也是挂死，
  `wx.createSelectorQuery().in(page).exec(cb)` 的**回调永远不触发**，
  而导航与截图正常 → 所以隐私政策页的**文案正确性**交给静态回归（`taro-lint` 第 21 节），
  模拟器只管「能打开、能渲染、不是白屏」。
- **但出图那张 PNG 还是拿得到 —— 走 Taro 的虚拟 DOM**（2026-11-06 实测）：
  `getCurrentPages()[last].data.root` 是一棵 vdom 树，节点的 `cl` 是 className、
  props 存在 `p<n>` 字段里。走一遍树找到 `cl === 'pr-diagram-img'` 的节点，
  再找那个长得像临时文件路径的 prop（`http://tmp/xxx.png` / `wxfile://…`），
  就能用 `wx.getFileSystemManager().readFile` 把 PNG 原样读回来 ——
  **尺寸 1070×876 与「不是白图」两条断言因此保住了**。
  ⚠️ 拿元素查询当唯一手段时，那个 25 轮 × 43 秒的轮询会**空转到 18 分钟**才失败。
- **截图目录要先建**：`mkdirSync(OUT, { recursive: true })`，否则 automator 写文件直接 ENOENT。
- **`switchTab` / `navigateTo` 的路径要带前导斜杠**（`/pages/me/index`），不带会抛
  「Uncaught [object Object]」。
- **`switchTab` / `reLaunch` 偶发抛 `getPageMetaByWebviewId(...)` 为 null**：
  实测**页是切过去了**，只是这次调用报错 → 重试一次，再用 `currentPage()` 复核，不当失败处理。
- **重启后首帧可能还没画完**（只画出原生外壳：标题栏 ＋ tabBar，正文还是白的）：
  这时截图会被「白屏检查」判成**假失败** → 截图段改成**判到空白就重截重试**（最多 4 次）。
- **PowerShell 的 `| Select-Object -Last N` 会全缓冲**：脚本跑到一半看不到任何输出，
  看上去像卡死。诊断脚本改写成**每步带超时 ＋ 进度写日志文件**。

### 3.10 「寸关尺图示」出不来：微信 canvas 2d 的 `roundRect` 只收数组（2026-11-05）

**怎么发现的**：真机点「看寸关尺图示」，弹一个 toast：

```
Failed to execute 'roundRect' on 'CanvasRenderingContext2D': The provided value cannot be converted to a sequence.
```

**根因**：网站端与小程序端**共用** `src/export/diagram.ts` 里的绘制代码，
而**浏览器的 canvas API 比微信宽松**：

| 写法 | 浏览器（Chrome / Safari / Firefox） | 微信小程序 canvas 2d |
|---|---|---|
| `ctx.roundRect(x, y, w, h, 3)`（数字） | ✅ 收 | ❌ **抛错**（第 5 个参数按**序列**收） |
| `ctx.roundRect(x, y, w, h, [3])`（数组） | ✅ 收 | ✅ 收 |

所以网站端一路绿灯，小程序一点就炸。

**为什么这类错难查**：

- `PainterCtx` 是**结构类型**，`roundRect` 压根不在类型里（用 `as unknown` 转的）→ **tsc 无感**；
- 浏览器两种写法都收 → **网站端与网站回归全绿**；
- 构建不报错、静态回归全绿（查的是文件在不在，不是运行时）；
- 只有真的在小程序的 canvas 2d 上画，才会炸 —— 而小程序侧此前**没有任何出图链路的回归**。

#### 改法（两层保险）

1. **半径统一传数组** `[r]` —— 浏览器也认（`[3]` 与 `3` 画出来完全一样），微信这才不抛；
2. **再兜一层手写路径** —— 万一某个基础库版本的 `roundRect` 仍不收数组，
   就自己用 `moveTo / lineTo / quadraticCurveTo / closePath` 拼出圆角，
   **不能让出图整个失败**（宁可少个圆角，也不能让用户点一下只弹一个 toast）。

顺带把 `PainterCtx`（`src/export/canvas.ts`）补上 `quadraticCurveTo` / `closePath`。
**这一份是网站与小程序共用的源码**（`src/export/`），两端一起生效。

#### 补上的两道回归（都「写坏」验过）

1. **静态（`taro-lint` 第 24 节，+10 项）** —— 照微信的规矩造一个**假 ctx**
   （`roundRect` 的半径不是数组就抛 TypeError，与微信一模一样），把**真的那份绘制代码**灌进去跑：
   - 微信式 ctx：一次不抛 ＋ 六个标记块的半径每次都是数组 ＋ 底图确实画进去了；
   - `roundRect` 一直抛 / 压根没有：仍能画出来，且走的是**手写圆角路径**（24 段二次曲线 × 6 块 ＋ 6 次 `closePath`）。
   —— **写坏验过**：半径退回数字 → 「半径每次都是数组」红；删掉手写兜底 → 4 条断言红。
2. **运行时端到端（新增 `scripts/e2e/taro-canvas.mjs`，9 项）** ——
   在**真微信运行时**里跑产物里的真代码：
   ```js
   require('common.js').renderDiagramImage(set)   // 线上真正会跑的那份
   ```
   把产出的 PNG 读回来，判「不是白图」＋「尺寸是 1070×876」。
   —— 实测产出 500 KB、649 种颜色、非白像素 28.5%，图见 `local-data/mp-canvas-diagram.png`。
   —— **写坏验过（真机）**：把半径退回数字后再跑，**端到端仍然 9/9 全绿** ——
     因为兜底路径在真微信里确实能出图；抓「半径写法」这条靠静态那关。**两层各管一段。**

#### 顺带记下的平台事实（都是实测）

| 事实 | 怎么验的 |
|---|---|
| 微信 `roundRect` 的半径**按序列**收，传数字抛 `…cannot be converted to a sequence.` | 真机 `wx.createOffscreenCanvas({type:'2d'})` |
| 微信 canvas 2d **有** `quadraticCurveTo` / `closePath` / `setLineDash` / `font` | 同上 |
| 小程序 app 上下文里 `require` 可用，按**模块名**（`require('common.js')`，**不带** `./`）能拿到产物里的函数 | `require('/common.js')` 与 `require('./common.js')` 都报「module is not defined」 |
| app 上下文里 `getCurrentPages()` 可用（能拿到当前页与 `route`） | 同上 |

#### 遗留

- **「点按钮」这一跳仍然自动化不了**：`miniprogram-automator` 的元素查询在这套 Taro 产物上不返回
  （40s 超时也挂死）。
  → 2026-11-05 更新：**图已经改成直接显示在页面上**（§3.11），所以**不用再点按钮**了；
  模拟器端到端回归直接读页面上那张 `<Image>` 的 `src` 把图取回来判「不是白图」。

### 3.11 寸关尺关系图**直接显示**在页面上，三个导出选项删掉（2026-11-05）

**维护者定的**：病例详情页上那一排「寸关尺图示／存到相册／复制 Markdown／复制 CSV」，
要变成 **「寸关尺关系图」直接摆在页面上**，后三个导出选项**删掉**。

#### 改了什么

| 位置 | 原来 | 现在 |
|---|---|---|
| 病例详情页 | 4 个按钮（点「寸关尺图示」→ 画图 → 弹系统预览窗） | 记录表下面一张「寸关尺关系图」卡片，**图直接显示**（点图可放大） |
| 就诊工作台 | 页内第 4 个 tab「出图」，4 个按钮 | 页内第 4 个 tab 改名「寸关尺图」，**图直接显示**（**2026-11-06 又整个去掉了这一档 —— 见 §3.13**） |
| `platform/canvas.ts` | `renderDiagramImage` ＋ `renderExportImage`（整表 PNG） | 只剩 `renderDiagramImage`（多一个 `sessionId`：画哪一次） |
| `platform/album.ts` `platform/clipboard.ts` | 相册、剪切板两个平台模块 | **整个删掉** |
| 隐私政策页 | 「四、两个会用到系统权限的地方」（相册＋剪切板） | 删掉那节，三改成「我们不碰什么」，后面各节重新编号 |

**图还是真画出来的**，不是贴静态图：离屏 canvas → **共享绘制器**（`src/export/diagram.ts`，
与网站端同一份源码）→ `canvasToTempFilePath` → `<Image>` 显示。
所以图上的符号**跟着当前记录走** —— 改一格就重画一次（400ms 防抖）。

新组件：`taro/src/components/diagram-view/index.tsx`（含它自己的离屏画布）。

#### 连带后果：隐私接口降到 **0 个** ⭐

三个导出选项一删，`saveImageToPhotosAlbum` / `setClipboardData` 就不调了 →

- **微信后台《用户隐私保护指引》一项都不用勾**（原来要勾两项）→ 上线路上少一个卡点；
- 隐私政策页也跟着改（不能「声明了没用」）；
- `taro-lint` 第 21 节改成**按上线包口径**：上线包用到的类型必须写明、**没用到的类型不许写**。

⚠️ **原生回退工程 `miniprogram/` 仍带**这两个接口 —— 它是本地兜底、不上传；
若哪天改用它上线，才要重新勾这两项。

#### 补的回归（都「写坏」验过）

1. **静态（`taro-lint` 第 21b 节，+6 项）**：两个页面里不再出现「存到相册／复制 Markdown／复制 CSV」
   的文案；上线包隐私接口数＝0；`platform/album.ts`、`platform/clipboard.ts` 已删；
   两个页面都用了 `diagram-view`。
2. **运行时（`npm run test:e2e:mp:canvas`，8 项）**：打开病例详情页 → **等页面自己把图画出来**
   → 取 `<Image>` 的 `src` → 读回 PNG → 判「1070×876 ＋ 不是白图」。
   —— 这是**跑页面自己的链路**（组件 → 平台层 → 共享绘制器），不是另写一份模拟。

#### 顺带记下的两个平台坑

| 坑 | 现象 | 处置 |
|---|---|---|
| **bundle 在服务上下文里是缓存的** | 改完代码重新构建，模拟器里跑的**还是旧产物**（`reLaunch` 只换页面，不重新 require） | 三个模拟器回归现在都**先重启小程序**（`scripts/e2e/lib-devtools.mjs` 的 `rearm()`）。写坏验证时正是靠这一步才看到红色。⚠️ **2026-11-06 才修**：`rearm()` 原来只认 Windows 的 CLI 路径，macOS 上**恒为空转** → 这条纪律在 macOS 上是**静默失效**的 |
| **开发者工具 IDE 服务端口会变** | 实测 45820 → 23211，`cli auto --port 45820` 报「must be restarted on port 45820 first」 | `rearm()` 调 CLI 时**不带 `--port`**，让它自己找当前端口 |
| `<Image>` 的 `src` 取不到 | `fields({properties:['src']})` 返回空 | 要写成 `fields({properties:['src'], attributes:true})` —— 但**在 automator 上下文里这条路整体不通**（`exec` 回调不触发）；改走 **Taro 虚拟 DOM**（见上面的「顺带的坑」） |

### 3.12 微信「代码质量」两条未通过修掉 —— 外加一个把断言全骗过的坑（2026-11-05 晚）

**维护者贴的**：微信开发者工具「代码质量」面板里两条 **未通过**：

| 面板条目 | 判据 | 根因 | 改法 |
|---|---|---|---|
| **代码压缩 → JS文件：对JS文件进行压缩** | 开发者工具「上传代码时自动压缩脚本文件」没开 | `taro/project.config.json` 的 `setting.minified: false` | 改 `true`，并显式补 `minifyWXSS` / `minifyWXML` |
| **代码包 → 图片和音频资源大小不应超过 200 K** | **单个**图片/音频 > 200 KB | 底图 `hands-pulse.png` **298 KB** | 换成**同尺寸** JPEG **116.3 KB** |

官方规则原文（微信开放文档「性能扫描 / 代码质量」）：

> 图片和音频资源大小超过 200 K【建议】……建议图片、音频等静态资源体积大小超过 200K 时，将它们上传到 CDN，用 URL 引入会是个更好的选择。
> 未开启JS压缩【必须】在工具「详情」-「本地设置」中开启「上传代码时自动压缩脚本文件」的设置

#### 底图为什么改成 JPEG（且尺寸一点没动）

底图是**真人手部照片 ＋ 印刷标注**（1070 × 876，RGB）。试过的路：

| 方案 | 体积 | 结论 |
|---|---|---|
| PNG 无损重编码（自适应滤波 ＋ zlib level 9） | 300–363 KB | ❌ PNG 对照片本来就不擅长，压不动 |
| PNG 缩到 850 × 696 | 220.2 KB | ❌ 还是超 200 K，且印刷字明显发糊 |
| JPEG q70 | 52.8 KB | ✅ |
| JPEG q85 | 69.9 KB | ✅ |
| **JPEG q95（1070 × 876 不变）** | **116.3 KB** | ✅ **选定**：肉眼无损，余 83.7 KB |
| JPEG q98 | 159.3 KB | ✅ 更好，但只剩 45 KB 余量 |
| JPEG q100 | 250.4 KB | ❌ 超线 |

**尺寸必须保持 1070 × 876**：覆盖层的标记坐标（`src/domain/diagram.ts` 的 `MARKS` / `RIGHT_DOT_X`）
是按原图像素量得的，底图一旦缩放，标记就会跑位。

**PNG 真源保留**（`src/assets/hands-pulse.png`，298 KB）：网站端与桌面端的 **PNG 导出**
（`src/export/png.ts`）要无损底图 —— 导出物是 PNG，底图有损会二次压缩。
两份图并存是刻意的，不是冗余。

**`triad-p47.png`（91.6 KB）从小程序包里删掉**：小程序端**零引用**（三部曲是
`components/visit-triad` 用样式**画**出来的），这张图只被网站端 `TriadImage.tsx` 用。
删完构建日志变成 `Copied 1 items`。

#### ⚠️ 最大的坑：`jpeg-js` 的编码器按 **RGBA（4 字节/像素）** 读 stride

`jpeg-js@0.3.7` 的 `lib/encoder.js` 把步长**写死**了：

```js
var quadWidth = width * 4;                                  // ← 固定 4 字节/像素
r = imageData[p++]; g = imageData[p++]; b = imageData[p++];   // 第 4 字节（alpha）被跳过
```

也就是说**它只接受 RGBA**。我最初在脚本里把 pngjs 的 RGBA 转成了 RGB（3 字节/像素）再 encode，
编码器仍按 4 字节取色 —— **每行错位 1/3 像素**，1070 宽累积下来整幅图**斜切并环绕重复**，
底部还会读到越界的 `undefined`（脏色块）。

**症状极具欺骗性**：

| 检查项 | 结果 |
|---|---|
| 文件能不能打开 | ✅ 能 |
| 体积 | ✅ 185 KB < 200 KB |
| SOF0 头里的尺寸 | ✅ 1070 × 876 |
| 当时已有的三条断言 | ✅ **全绿** |
| 真机出图 | ❌ 底图是斜切环绕的废图 |

**更糟的是**：当时那张「q70 = 180.7 KB、q78 = 223 KB 超线」的选型表 **整个是错的** ——
那些体积数字**全是从废图上量的**（废图高熵，压不动）。正确喂 RGBA 之后，q70 只要 **52.8 KB**，
q95 也才 116.3 KB —— 余量比原以为的大得多，**画质反而可以更好**（所以最后选了 q95 而不是 q70）。

> 教训：**「体积合规 ＋ 尺寸合规 ＋ 断言全绿」不能证明内容是对的。**
> 凡是「把 A 转成 B 再落盘」的加工步骤，都必须**把产物读回来跟源比一遍**。

#### 处置：两道内容校验（都「写坏」验过）

1. **生成时就拦** —— `scripts/compress-assets.mjs` 落盘前**自己解码回读**，
   跟 PNG 真源逐像素比（MAE / PSNR），不过就 `exit 1`、**不落盘**；
2. **回归里守着** —— `scripts/e2e/taro-lint.mjs` 第 25 节加一条**内容一致性**断言：
   不管底图是怎么来的，只要 JPEG 与 PNG 真源对不上就红。

阈值 **MAE ≤ 12、PSNR ≥ 15 dB**。实际值：正常 q95 是 **MAE 0.30 / PSNR 51.60 dB**；
斜切废图是 **MAE 65.67 / PSNR 7.52 dB** —— 中间隔着十万八千里，鉴别力绰绰有余。

**写坏验过**：把废图塞回 `src/assets/hands-pulse.jpg` → 「内容一致」红（MAE 65.67 / PSNR 7.52 dB）；
复原后 138/138 全绿。

#### 改动清单

| 文件 | 改了什么 |
|---|---|
| `scripts/compress-assets.mjs` | **新增**：PNG → 同尺寸 JPEG（q95）＋ 回读比对（MAE/PSNR） |
| `src/assets/hands-pulse.jpg` | **新增**：116.3 KB / 1070 × 876 |
| `taro/config/index.ts` | `SHARED_IMAGES` = `['hands-pulse.jpg']`（去掉 `triad-p47.png`） |
| `taro/src/platform/canvas.ts` | 底图路径 → `/assets/hands-pulse.jpg` |
| `scripts/build-core.mjs` | `IMAGES` = `['hands-pulse.jpg']`（桌面端跟着换） |
| `miniprogram/pages/case-detail/case-detail.js` | 两处 `img.src` → `.jpg`（原生回退工程） |
| `taro/project.config.json` | `minified: true` ＋ `minifyWXSS: true` ＋ `minifyWXML: true` |
| `miniprogram/project.config.json` | 同上（原生回退工程） |
| `scripts/e2e/taro-lint.mjs` | 第 25 节 **+9 项**（含内容一致性） |
| `scripts/e2e/taro-sim.mjs` | 底图断言改 `.jpg`、triad 不在包、≥200KB 媒体断言 |

**网站端与桌面端的 PNG 导出仍用 PNG 真源** —— `src/export/png.ts` 与 `src/components/PulseDiagram.tsx` 未动。

#### 回归（全部实跑）

| 命令 | 结果 |
|---|---|
| `npm run test:e2e:mp`（taro-lint） | **138/138**（基线 129 → +9） |
| `npm test`（全量） | **384/384**（core 26 ＋ taro-lint 157 ＋ taro-api 45 ＋ migration 53 ＋ auth 52 ＋ app 18 ＋ desktop 33） |
| `npm run mp:taro:build` | ✅ `built in 4.82s`，`Copied 1 items` |
| `npm run test:e2e:mp:sim` | **55/55**（含「运行时能读到包内底图」「底图像素是 1070×876」「对照组：不存在路径必须读不到」） |
| `npm run test:e2e:mp:canvas` | **8/8** —— 出图见 `local-data/mp-canvas-diagram.png`，**底图完整、标记块位置正确** |

**产物核对**：`dist/assets/hands-pulse.jpg` **116.3 KB** ＋ 8 个 tabbar 图标（≤ 0.4 KB），
**图片/音频总量 119.0 KB**，最大单文件 116.3 KB —— **全部 < 200 KB**。

#### 顺带记下的平台事实

| 事实 | 怎么验的 |
|---|---|
| `jpeg-js@0.3.7` 的 `encode()` **只认 RGBA**（`lib/encoder.js` 里 `quadWidth = width*4` 写死） | 读源码 ＋ 两种喂法各出一张图对比 |
| 微信「图片和音频 > 200 K」判据是**单个文件**，不是总量 | 官方文档 |
| 底图 JPEG 与 PNG 真源的真实差距：q95 MAE 0.30 / PSNR 51.60 dB | `scripts/compress-assets.mjs` 的回读比对 |

#### 未解决：预览插件的 H5 近似跑不动 Taro runtime

用 `wechat-miniprogram-preview` 插件打开 `pulse-record/taro/dist`（含 `app.json` ＋ `project.config.json`）
→ **build = ok**，7 个页面、4 个 tabBar 都被正确识别，但**运行时报**：

```
app.js 执行失败：ReferenceError: global is not defined
    at new hr (wx:///taro.js:3:43285)
    at Object.eval (wx:///taro.js:3:44167)
```

**根因**：Taro runtime 里那段是 **jsdom 的 Window 垫片**，代码写成
`Object.getOwnPropertyNames(global||{})` —— 在浏览器/H5 里 **`global` 根本没声明**，
`||` 救不了**未声明标识符**（直接抛 ReferenceError）；
而**微信小程序运行时是有 `global` 的**，所以真机/开发者工具里一路正常
（`taro-sim` 55/55、`taro-canvas` 8/8 都实跑过）。

→ 这是**预览器 H5 近似的环境限制**，不是应用缺陷（插件自己也注明 `H5 approximation only`）。
→ **下一步待定**：要么给预览环境补 `global` 垫片（但**不能为迁就预览去改应用代码**），
要么这条验收改走**微信开发者工具真运行时**（已自动化覆盖）＋ **真机手验**。

### 3.13 关系图退出就诊工作台 —— 回到原生版的规矩（2026-11-06）

**维护者指出的**：就诊工作台的页内 tab 里不该有「寸关尺图」这一档。

**查了上一个版本（原生回退工程 `miniprogram/`）是怎么做的**：

| | 原生版（上个版本） | Taro 版（改之前） |
|---|---|---|
| **录入页** `pages/record/record` | **一个图示入口都没有**（grep `图示\|preview` 零命中）；底部**只有「保存」**一个按钮 | 页内第 4 档 tab「寸关尺图」 ＋ 底部「出图」按钮 |
| **病例详情页** `pages/case-detail/case-detail` | 记录表 ＋ 一排文字链接：`寸关尺图示`（→ 画图 → `wx.previewImage` 弹系统预览窗）／存到相册／转发／复制 Markdown／复制 CSV | 记录表 ＋ **寸关尺关系图直接显示**（导出选项与两个隐私接口已删） |

→ 原生版的规矩很清楚：**关系图属于「看」的页面，不进「录」的页面**。
Taro 版把它塞进就诊工作台，既破了这条规矩，又和**病例详情页重复**（两处摆着同一张图）。

**改了什么**：

| 位置 | 改前 | 改后 |
|---|---|---|
| 就诊工作台页内 tab | 脉象／判读／用药／**寸关尺图** | 脉象／判读／用药（**3 档**） |
| 就诊工作台底部 | 保存／病例／**出图** | 保存／病例 |
| 就诊工作台代码 | 引 `diagram-view` 组件 ＋ `buildSet()` | 整个去掉 |
| 病例详情页 | 关系图直接显示 | **不变**（2026-11-05 维护者拍过板：「图直接显示在页面上」） |
| `.pr-off-canvas` 样式 | 组件一份 ＋ 页面两份（visit／case-detail），定义还互相打架 | 只留组件那份（`components/diagram-view/index.scss`） |

**回归**：新增／改写 4 条断言（taro-lint 138 → 140）：

- 「就诊工作台有 3 个页内 tab（脉象/判读/用药）」—— **按 `TABS` 数组解析**，不全文搜词
  （否则注释里写一句「这里没有寸关尺图」就被当成「有这一档」）；
- 「就诊工作台**没有**「寸关尺图」这一档（录入页不放关系图）」；
- 「就诊工作台底部没有「出图」按钮」—— **查 `ActionBar` 块**，不查全文；
- 「pages/visit/index.tsx **不用** diagram-view」（原来那条是反的，要求 visit 页必须有）。

**故意写坏三连验**（全部按预期抓到，复原后 140/140 全绿）：

| 写坏 | 抓到 |
|---|---|
| 加回 `{ key: 'export', label: '寸关尺图' }` | 2 条变红（tab 数 ＋ 没有这一档） |
| 加回底部「出图」按钮 | 1 条变红 |
| 加回 `import DiagramView` | 2 条变红（没有这一档 ＋ 不用 diagram-view） |

**实测**：模拟器截图确认就诊页是 **3 档 tab（脉象／判读／用药）** ＋ 底部 **保存／病例**；
全量回归 **367/367 全绿**（core 26 ＋ taro-lint 140 ＋ taro-api 45 ＋ migration 53 ＋ auth 52 ＋ app 18 ＋ desktop 33）。

> **教训**：IA 重排时**新加的东西要拿老版本对一遍** —— 老版本不是「旧」，它是**已经踩过坑的规矩**
> （原生版当初不给录入页放图示，正是因为它是「看」的页面的东西）。
> 这次的错不是「设计不好」，是**忘了问一句「上个版本怎么做的」**。

> **后续**：§3.14 又把这三档改成了**四档**（摸脉／体质／疗法／方药）。

### 3.14 就诊工作台的页内 tab 拆成四档 —— 摸脉／体质／疗法／方药（2026-11-06）

**维护者在画布上批注的**：「这里变成，摸脉 体质 疗法 方药 四个」。

#### 为什么要拆

原来三档是「脉象／判读／用药」。其中「**判读**」这一档**名不副实** ——
里面做的全是「使用者自己判断、自己点选」（①判体质 ②定疗法 ③照 p47 图列方），
工具只负责记下来，**根本不「判读」**（工具不代判、不下诊断、不自动开方）。

**拆分的依据不是拍脑袋，是网站端** —— `src/components/TriadFrame.tsx` 第 22 行明写：

> ①判体质 → 摸脉录入　　②定疗法 → 判读提示　　**③开方药 → 开方药清单 ＋ 用药记录**

**用药记录本来就属于 ③**。小程序原来把「用药」单列一档，等于把 ③ 劈成两半。

| 档 | 装什么 | 出处 |
|---|---|---|
| **摸脉** | 录这一次的左右手脉象（宽表／一次一屏） | 原「脉象」档（`components/visit-pulse`） |
| **体质** | ①判体质 ＋ 图上两条问句的**参考判据** | 原「判读」档的 ① |
| **疗法** | ②定疗法 | 原「判读」档的 ② |
| **方药** | ③开方药清单 ＋ **用药记录** | 原「判读」档的 ③ ＋ 原「用药」档 |

#### 改了什么

| 位置 | 改前 | 改后 |
|---|---|---|
| 页内 tab | 脉象／判读／用药（3 档） | **摸脉／体质／疗法／方药（4 档）** |
| 组件 | `components/visit-judge/`（三步挤在一个组件里） | **`components/visit-triad/`**，按 `section` 分档（`constitution`／`therapy`／`rx`） |
| 用药记录 | 单独一档（`MedicationPanel`） | 并进「方药」档（`MedicationPanel` 挂在 rx 分支**之内**） |
| 「随体质带出 X」 | 组件内 `useState`（选体质时写进去） | **由体质推出来**（`therapyOf(constitution)`）—— 拆档后组件会随切档卸载，那份状态会丢 |
| 三步导航头 | 一直显示，不分档 | 三档都显示，**当前那一步高亮**（`.pr-triad-step.is-on`） |
| 用药面板的「录入编辑脉象」 | 没接 `onGoRecord`，只显示一句提示 | **接上了** —— 点一下直接切到「摸脉」档 |

#### 顺手修掉两个真问题（截图里看出来的）

1. **免责声明重复了两份** —— 页面那一层已经有一句「本工具只做记录，不构成诊断」（对四档都成立），
   组件里又来一句一模一样的。现在组件里**只留 ③ 特有**的那一句。
2. **几行说明连成一行读不出层次** —— 小程序里 `<Text>` 是**行内**元素，
   「参考：有变脉？已命中 1 处」和「按图会落到：肾虚体质」挤成一片。
   → 三部曲卡里的 `.pr-note` 改成**块级**（剂量行里的「科中／服法」不带这个类名，仍然保持行内）。

#### 回归

taro-lint 140 → **157**（新增／改写 17 条）。**故意写坏五连验**（全部抓到，复原后 157/157 全绿）：

| 写坏 | 抓到 |
|---|---|
| `TABS` 改回三档旧制 | 3 条红（tab 数／没有「判读」／没有「用药」） |
| 把 `MedicationPanel` 挪成独立分支 | 1 条红（**这条第一版断言被骗过了**，见下） |
| 疗法档的 `section` 写成 `constitution` | 1 条红 |
| 档名「方药」写成「药方」 | 1 条红 |
| 把组件里的**出处标注**全抹掉 | 2 条红（**这条第一版也被骗过了**，见下） |

> **断言写法的教训（两条，都是被「故意写坏」逼出来的）**：
>
> 1. 「用药记录在方药档里」第一版是**比下标**（`MedicationPanel` 的位置在 `tab === 'rx'` 之后、
>    在 `<ActionBar>` 之前）。这么写**被骗过了** —— 把 `MedicationPanel` 挪成独立分支，
>    它照样在 rx 之后、ActionBar 之前，断言照样绿。
>    改成**按分支正文切**（从 `tab === 'x'` 到本分支结尾的 `) : null}`）才抓得住。
>    顺带一条：`MedicationPanel` 这个名字**先撞上的是文件头的 import 行**，必须匹配 `<MedicationPanel`。
> 2. 「组件里有出处标注」第一版是**全文搜「讲义｜讲稿｜同和堂版」**。也**被骗过了** ——
>    这两个文件的**注释里**到处写着「讲义／讲稿／同和堂版」，把标签全删了照样搜得到。
>    改成查**代码里的字面量**（`'同和堂版（克）'` / `'讲稿 2010（比例制）'` / `〔{…source}〕`）才抓得住。
>
> 另外：原第 20 节那条「知识页有出处标注」里写着 `|visit-judge`，但它只扫 `src/pages` 下的文件，
> 而 `visit-judge` 是**组件** —— 那个分支**从来就是空转的**，组件里的出处标注**根本没人查**。
> 现在把 `visit-triad` 与 `medication-panel` 补进扫描范围。

#### 新增一条模拟器回归 `scripts/e2e/taro-tabs.mjs`（20 项）

逐档点过去、逐档截图、逐档断言内容（摸脉有记录表格子／体质疗法方药有选项／方药有用药面板／
摸脉**没有**三部曲导航头），最后核对三档标题各归各位。

> **顺手更正一条旧结论**：以前记的「小程序端元素查询一律不通」**不对** ——
> 不通的是 `page.data()` 与 `wx.createSelectorQuery().exec(cb)`；
> **`page.$$('.pr-subtab')` 是通的**，`el.text()` 读得到文字、`el.tap()` 点得动。
> （这条结论让「逐档点过去截图」本来差点做不成。）

**实测**：模拟器逐档截图确认四档内容正确
（摸脉＝记录表／体质＝参考判据＋①／疗法＝②＋随体质带出提示／方药＝③开方药＋用药记录）；
全量回归 **384/384 全绿**（core 26 ＋ taro-lint 157 ＋ taro-api 45 ＋ migration 53 ＋ auth 52 ＋ app 18 ＋ desktop 33）；
模拟器四套全绿（sim 55 ＋ privacy 6 ＋ canvas 8 ＋ **tabs 20** ＝ 89）。

### 3.15 鸿蒙 app：出包了（2026-11-06）

**用户**：DevEco Studio 装好了，先做一个鸿蒙 app，方便测试。

#### 路线

鸿蒙走 **`harmony_cpp`**（ArkTS 那条 `plugin-platform-harmony-ets` 是 webpack＋ArkUI-X，编译器路线不兼容）。
**C++ 库不用编** —— `library-4.3.2.har` 里已带预编译 `libs/arm64-v8a/libTaroHarmonyLibrary.so`，
插件默认 `useChoreLibrary='local'` 时不会 clone cpp 源码库（cpp 源码路线要 FetchContent 拉
folly＋boost＋quickjs＋jsi＋yoga 交叉编译 arm64，代价 1~2 小时，已确认可绕过）。

#### 落地的文件

- **`pulse-record/harmony/`（27 个文件）—— DevEco 工程的唯一真源**，配置与资源入库
- **`pulse-record/scripts/harmony-build.mjs`** —— 一条命令出 HAP
- **`pulse-record/scripts/lib/harmony-arkts-patch.mjs`** —— ArkTS 补丁（纯函数，可测）
- **`pulse-record/scripts/e2e/harmony-lint.mjs`** —— 鸿蒙工程回归（57 项）

#### 查实的三件事

1. **Taro 产物接管 EntryAbility**：Taro 生成的 `app.ets` **本身就是** `export default class EntryAbility extends UIAbility`，
   `taro_tabbar.ets` 才是首页。所以 DevEco 模板自带的 `EntryAbility.ets`／`Index.ets` **不能作 srcEntry**，
   `srcEntry` 要指向 `./ets/app.ets`，`main_pages.json` 列 `"taro_tabbar"` ＋ 非 tab 页路由。
2. **路径不能有中文**：hvigor 拒绝含中文的工程路径（`00306003`），符号链接也绕不过
   （node 的 `process.cwd()` 解析成真实路径）→ **仓库里的 `harmony/` 是真源，编译时镜像到纯 ASCII 路径**
   （默认 `~/AiCoding/harmony-pulse-record`）。
3. **tabBar 图标要在 rawfile**：Taro 把它发射到 `ets/assets/tabbar/`，但 ArkUI 的 `Image('相对路径')` 取 rawfile
   → 构建脚本里有一步「ets/assets → resources/rawfile/assets」对齐。少了这步，**编译照过、四个 tab 就是没图标**。

#### 踩掉的新坑

| 坑 | 现象 |
|---|---|
| SDK 版本太低 | `00306004`：`compatibleSdkVersion: 12 cannot be lower than the minimum 14 required by @taro-oh/library` → 提到 `"6.0.0(20)"` |
| ArkTS 严格模式 | `10605999`：`Variable 'levelRes' is used before being assigned`（上游模板的 `switch` 没有 `default` 分支）→ 补初值 `0`，语义不变 |
| 打包要 Java | `00308018`：`Unable to locate a Java Runtime` → `JAVA_HOME` 指向 DevEco 自带的 JBR 25 |
| 权限字段名 | schema 校验失败 → **模块级**用 `requestPermissions`（不是 `reqPermissions`） |
| 没声明网络权限 | 编译照过、装得上，但**一个请求都发不出去** → 补 `ohos.permission.INTERNET` |

#### 产物

`~/AiCoding/harmony-pulse-record/entry/build/default/outputs/default/default-default-unsigned.hap`
（9.1 MB / 36 个文件，含 `libTaroHarmonyLibrary.so` 5 MB ＋ `ets/modules.abc` 2.5 MB）。

**实测**：全流程构建（`node scripts/harmony-build.mjs`，含 Taro 构建）出包成功；
全量回归 **441/441 全绿**（原 384 ＋ 新增鸿蒙 57）。

#### 2026-11-06 追加：装了 DevEco 官方 CLI，整条路能走脚本了

用户装了 `npm i -g @deveco/deveco-code` 与 `@deveco/deveco-cli@stable`。
`devecocli`（1.3.0-stable）能做的事比预想多得多：

| 命令 | 用途 |
|---|---|
| `emulator image list/download` | 模拟器系统镜像（**不需要登录**） |
| `emulator create/start/list/stop` | 模拟器实例 |
| `signature generate` | 生成签名并写进工程配置 |
| `build` / `run` | 构建 / 构建并装机 |
| `ui screenshot/layout/click/text/swipe` | **设备上的 UI 自动化**（可做回归） |
| `log` | 设备日志 |
| `check lint` / `compat` | ArkTS 代码检查 / 兼容性检查 |
| `skills` | **53 个鸿蒙开发技能**（可装给 AI agent） |
| `docs` | **本地 HarmonyOS 文档**（开发指南／API参考／最佳实践／FAQ／版本说明） |

**三个实质变化**：

1. **构建脚本改走 `devecocli build`** —— 不用再手工拼 hvigor 软链 ＋ `DEVECO_SDK_HOME` ＋ `JAVA_HOME`
   （三样缺一样就是一次编译失败；devecocli 三样都自己解析，**实测把软链移走也能构建成功**）。
2. **新增 `scripts/harmony-run.mjs`** —— 部署一条命令（`doctor` / `emulator` / `deploy`）。
3. **模拟器镜像已下好** —— `HarmonyOS 7.0.0(26.0.0)` phone → `~/Library/Huawei/Sdk/system-image/`；
   实例 `pulse_phone` 也建好了。

#### ⏸ 暂停在这里（2026-11-06）：**只差登录**

装好 CLI 后卡在一个点上：**签名材料**和**模拟器设备身份（SN）**都要向华为服务器申请，
必须 `devecocli auth login`（会提示「Press Enter to open browser」——**不按回车就不动**）。

- 未登录时 `devecocli signature generate` 直接报
  `Failed to automatically generate signatures.Run devecocli auth login to sign in.`
- 未登录时模拟器**静默起不来** —— 实例日志里只有
  `can not read sn` / `can not read uuid file`，**没有任何报错提示**。

> ⚠️ **DevEco Studio 的登录态和 `devecocli` 的不通用**（CLI 存 `~/.deveco/` 的加密 token，
> IDE 存自己的）。已经在 IDE 里登录了，**还是要单独跑一次 CLI 的登录**。

登录后一条命令就能装机 + 截图：

```bash
node scripts/harmony-run.mjs deploy
```

#### 模拟器实例的三个坑（都踩过）

1. 实例名**不能有连字符** → `pulse-phone` 被拒（`only contain letters, spaces, numbers, and underscores`），用 `pulse_phone`
2. `Emulator -instancePath` 要传**父目录**（传实例目录会报 `Please create the device(folder): …/pulse_phone/pulse_phone`）
3. `-bootMode cold` **不被接受**（`Command bootmode invalid! Use default.`）

#### 还没做的

- **模拟器实测**（等登录）
- **签名**：`signingConfigs` 为空 → 出的是 unsigned 包；`devecocli signature generate` 会自动生成（要登录）
- **关系图（寸关尺）在鸿蒙上的渲染**还没验证

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

## 6. 当前仓库状态（2026-11-06 实测）

| 项 | 值 |
|---|---|
| 当前分支 | `feat/wechat-miniprogram`（基点 `c1814f3`） |
| 远端分支 | `main` = `a0f5c10`；`chore/multi-user` = `b9e3b19`；`feat/wechat-miniprogram` = 小程序 Taro 迁移实施中 |
| PR | #6 `chore/multi-user → main`，**OPEN**；#7 `chore/desktop-electron → chore/multi-user`，**OPEN**（避免依赖倒置）；`feat/wechat-miniprogram` **暂不开 PR**（上线时统一收口） |
| 全量回归 | **441/441 全绿**（core 26 ＋ taro-lint 157 ＋ taro-api 45 ＋ migration 53 ＋ auth 52 ＋ app 18 ＋ 桌面端 33 ＋ 鸿蒙 57） |
| 小程序工程 | `pulse-record/taro/`（Taro 4.3.2 ＋ React 18）；**原生 `miniprogram/` 原样保留作回退** |
| 小程序包体 | 媒体资源 **119.0 KB**（底图 JPEG 116.3 KB ＋ 8 个 tabbar 图标 ≤0.4 KB）；**微信「图片和音频 > 200 K」已通过**（详见 §3.12） |
| 模拟器回归 | `npm run test:e2e:mp:sim`（**55 项**：4 个 tab 逐页截图 ＋ **白屏判定** ＋ **包内底图运行时可读**）、`npm run test:e2e:mp:privacy`（**6 项**：隐私政策页）、`npm run test:e2e:mp:canvas`（**8 项**：**真微信 canvas 2d 出图端到端**）；三个都会**自己先重启小程序**（bundle 是缓存的，不重启跑的是旧产物）。**2026-11-06 在 macOS 上实测三套全绿：55/55 ＋ 6/6 ＋ 8/8 ＝ 69 项** |
| 上线前清单 | `pulse-record/docs/miniprogram-release-checklist.md`（隐私指引勾选项＋可复制文案、服务器域名、类目截图、审核退路对照表） |
| 本机库 | `pulse-record/local-data/history.sqlite`（已迁移到多用户结构：15 患者／57 就诊／1 自定义符号，归属归到 `local`；迁移前快照 `history.sqlite.bak-20261104102030`） |
| 桌面版产物 | `pulse-record/release/`（安装包 ＋ 免安装版，已 gitignore） |
| 桌面版数据 | 安装版 `%APPDATA%\臧氏脉学\`；**免安装版 exe 旁边的 `data\`** |
| 鸿蒙工程 | `pulse-record/harmony/`（DevEco 工程真源，27 个文件）；镜像目录 `~/AiCoding/harmony-pulse-record`（纯 ASCII，不入库）；HAP `entry/build/default/outputs/default/default-default-unsigned.hap`（9.1 MB） |

> ✅ 本机库**已完成迁移**（幂等，迁移前自动留 `.bak-<ts>` 备份）：补上 `owner_id`、
> 回填归属到 `local`、建立 `local` 账号 —— 15 患者／57 就诊／1 自定义符号一个没丢。
> 桌面版「导入数据文件」也支持老结构（缺的列自动跳过），**两条路都能把老数据带进桌面版**。

---

## 7. 待用户办的事（按关键路径排序）

| 优先级 | 事项 | 为什么急 |
|---|---|---|
| 🔴 1 | **域名注册 → 个人实名 → 提交 ICP 备案** | 7~20 工作日，是整条时间线最长的一段；不今天提交，后面小程序、CloudBase 全在等 |
| 🔴 2 | ~~**后台声明《用户隐私保护指引》两项隐私类型**~~ | ✅ **2026-11-05 已不需要** —— 小程序不提供导出，隐私接口降到 **0 个**，后台**一项都不用勾**（详见 §3.11）。剩下要填的只有「用户信息收集」那一栏（用户输入内容／账号信息，见上线清单 §1.3） |
| 🔴 2c | **填运营者主体与联系邮箱** | 隐私政策**第八**节现在是占位文字（`运营者：（待填写）`），审核会看 |
| 🟡 2b | 注册微信小程序（个人主体）→ 填真实 AppID | ✅ 已完成（`wx3a21eb903a16cbc4`）；开发者工具需登录对应管理员微信号才能预览／上传 |
| 🟡 3 | **买境内轻量服务器（2 核 4G）** | 备案通过后要立刻部署 |
| 🟡 3b | **真机跑一遍新界面**（备案前先用局域网 IP） | 寸关尺关系图「直接显示在页面上、点图可放大」—— 模拟器已验，**真机还没验**（详见 §3.11） |
| 🟡 3c | **上传前在开发者工具里重扫一次「代码质量」** | 两条已修（`minified` 已开 ＋ 底图 298 KB → 116.3 KB），但**以工具实际扫描结果为准** —— 扫完确认这两条变成「通过」再传（详见 §3.12） |
| 🟡 4 | **桌面版装到自己的电脑上试一遍** | 已出包（`release/*.exe`），试过再决定要不要换签名证书 |
| 🟡 4b | **鸿蒙：DevEco 里下模拟器镜像 → 打开镜像目录 Run** | HAP 已出（9.1 MB unsigned），但**没跑起来过** —— 本机没有模拟器镜像、也没有 hdc。镜像下好后工程路径已是纯 ASCII，直接 Run 就能验四个 tab（详见 §3.15） |
| ⚪ 5 | AGENTS.md「下游用途」空位 | 由维护者自行填写一行 |
| ⚪ 6 | 代码签名证书（可选） | 只影响安装时的 SmartScreen 提示，不影响功能 |

---

## 8. 维护约定

- **什么时候更新本文**：① 某条工作线状态变化（完成／被阻塞／方案变更）② 关键决策拍板 ③ 阻塞项清单变动 → 改完连同相关代码/文档一起提交。
- **提交前缀**：沿用 `AGENTS.md`「Git 约定」—— `docs:` 资料整理／笔记 ｜ `data:` 新增或更新原始资料 ｜ `chore:` 工具与配置 ｜ `ocr:` 识别文本落盘；**代码与文档分开提交**。
- **分支纪律**：**小程序上线之前，所有开发集中在 `feat/wechat-miniprogram` 一条分支上做**（2026-11-04 起）—— 该分支已包含账号与数据隔离、小程序端、Windows 桌面应用的全部内容；上线后再恢复按工作线切分支。仍然**不直推 `main`**。详见 `AGENTS.md`「Git 约定」。
- **PR 状态**：#6（`chore/multi-user → main`）、#7（`chore/desktop-electron → chore/multi-user`）**保持原样，既不合也不关**；`feat/wechat-miniprogram` **暂不开 PR**。小程序上线时再统一收口（届时只需决定：先合 #6/#7，还是关掉改开一个到 `main` 的单 PR）。
- **表格优先**：状态一律用表格写，行尾标注实测日期，别写「大概」「应该」。
