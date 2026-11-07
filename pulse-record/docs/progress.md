# 项目进度 —— 臧氏脉学 · 脉象记录表生成器

> **更新于** 2026-11-07 ｜ **仓库** `erikgqp8645/zang-shi-mai-xue` ｜ **当前分支** `feat/wechat-miniprogram`（小程序／鸿蒙／桌面端／CloudBase 线）｜ 网站端线见 `feat/web-site`
>
> 本文是**进度台账**：记每条工作线做到哪了、卡在哪、下一手做什么。
> 桌面应用的**实施方案**另见 [`desktop-plan.md`](./desktop-plan.md)；上线手册见 [`deploy.md`](./deploy.md)；迁 CloudBase 见 [`cloudbase-migration.md`](./cloudbase-migration.md)；小程序 Taro 迁移约定见 [`taro-migration.md`](./taro-migration.md)。

---

## 0. 一张表看全局

| 工作线 | 状态 | 关键结论 | 下一步 |
|---|---|---|---|
| **P0 多用户与数据隔离** | ✅ 已完成 | `users`＋`identities`＋`sessions` 三表；四张业务表下沉 `owner_id`；跨用户一律 404 | 随 `feat/wechat-miniprogram` 走，**不单独合进 `main`** |
| **P1 网站上线** | ⏸ **卡在用户侧手续** | 脚本与文档已就绪，**域名／ICP 备案／服务器三样都没有** | 备案 7~20 工作日是整条时间线最长的一段 → **今天就去提交备案** |
| **P2 微信小程序** | 🟡 **已迁 Taro ＋ 界面重排完成**；模拟器逐页截图已验，未真机验证 | 8 个平级页面 → **4 个 tab（病例／就诊／用方／我的）**，「就诊」是工作台页（吸顶上下文条 ＋ **4 个页内 tab（摸脉／体质／疗法／方药）** ＋ 底部操作条）；Taro 4.3.2 ＋ React 18，与网站**共用同一份 domain 源码**；鸿蒙 C-API 编译已通；**寸关尺关系图直接显示在页面上**（不提供导出 → 隐私接口 0 个）；微信「代码质量」两条已修（JS 压缩已开、图片 298 KB → 116.3 KB）；回归 **516 项全绿**（含网站端浏览器回归 28 项） | 真机跑一遍（备案前先用局域网 IP） |
| **P3 后期迁 CloudBase** | 🟡 **云端已建成**（开发／试用环境） | 环境 `pulse-1-d0g880ydl8ddc57f6`（ap-shanghai 体验版）：PG 7 表 ＋ **35 个 `pulse_*` 函数**、云函数 `pulse-api`（**Event 类型**）、网关 `/pulse-api`、静态托管已上线；网站与小程序**同一套路由**（`handleApi`）；数据已从本机 SQLite 搬过去（29 患者／113 就诊／1 用药），**三条 owner 不变量全 0** | ① ✅ **云通道已实测跑通**（§3.19：真实微信运行时里 `callFunction` → 200，`db: CloudBase PostgreSQL`）② 换自定义域名（默认域名只许开发测试，有「风险提醒中间页」）③ 备案 —— **备案是小程序的前置吗？不是**：云通道走微信内部通道，不受 request 白名单约束；备案是**网站端**的前置 |
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

### 3.16 三部曲 ③ 的方名 ↔「用方」知识库：点得进去、落得到位（2026-11-06）

**用户**：打通三部曲 ③ 与「用方」知识库。

#### 原来断在哪

③ 里看得见方名（「清挡路方」「引火归元」「上焦方」…，讲义 p47 图上照抄），
但**点不进去** —— 「用方」tab 是一整套知识库（讲义 p44 依脉用方 ＋ 讲稿第二讲方剂 ＋ 同和堂版组成），
两边是**同一个方在不同资料里的不同写法**，此前没有任何对照。

#### 落地的文件

| 文件 | 作用 |
|---|---|
| `src/domain/formula-links.ts`（新） | ③ 方名 → 知识库锚点的**纯函数**解析器（共享 domain 层，网站端也能用） |
| `taro/src/store/focus.ts`（新） | 跳转意图的**内存态**（`switchTab` 不能带 query 参数） |
| `taro/src/components/visit-triad/index.tsx` | ③ 的方名可点；点不动就明说「用方页未载」 |
| `taro/src/pages/formulas/index.tsx` | 取意图 → 清关键词 → 切「讲稿原序」→ 滚过去 → 高亮 → 横幅写明依据 |
| `taro/src/pages/formulas/index.scss` | 定位横幅与高亮样式 |
| `scripts/e2e/taro-formula-link.mjs`（新） | 模拟器回归（17 项） |

#### 对照规则（先精确后宽松，命中即止）

1. `RULE_LINKS` —— 明确声明的规则对照（**只有「清挡路方」**）
2. 讲稿方剂**完全同名**
3. 讲稿方剂**方名后括号不算方名**（「引火归元」→「引火归元（肾脏疗法）」）
4. 讲义用名走 `FORMULA_ALIAS`（「冷热水」→「一体疗法（冷热水疗法）」）
5. 讲义 p44 规则条目的 `formulas` 里**完全相等**
6. 查不到 → 返回 `null`，界面明说「用方页未载」，**不硬凑**

**优先跳「讲稿方剂」而不是「规则条目」** —— 用户点方名的意图是「这方怎么吃」，
讲稿第二讲的条目有组成／服法／科学中药／加减／禁忌，规则条目只有适用条件与原文引用。

#### ③ 的六个方名，实测解析结果

| ③ 的方名（讲义 p47） | 落到 | 锚点 | 类型 |
|---|---|---|---|
| 上焦方 | 上焦方（讲义 p44「挡路三（左寸）· 变脉无力」） | `rule-fx-dl3-bianmai-wuli` | rule |
| 中焦方 | 中焦方（加味理中） | `drug-zhongjiao` | drug |
| 清挡路方 | 清挡路 | `rule-fx-ssx-qingdanglu` | rule |
| 下焦方 | 下焦方（天乙丹） | `drug-xiajiao` | drug |
| 引火归元 | 引火归元（肾脏疗法） | `drug-yinhui-guiyuan` | drug |
| 冷热水 | 一体疗法（冷热水疗法） | `drug-yiti-leng-re-shui` | drug |

> 「清挡路方」与 p44 的「清挡路」**差一个「方」字**。方名照录是硬规矩，
> 所以不能悄悄改写去匹配 —— 只能在 `RULE_LINKS` 里**明确声明这是同一个东西**，
> 并把三处出处（讲义 p47 图／p44 上盛下虚框／讲稿第四讲「清挡路一~四」）写进 `basis`，
> 界面上摆给读者看。

#### 跳转为什么走内存态

微信小程序的 `switchTab` **不支持 query 参数**（`Taro.switchTab` 同理）。
所以跳转意图落在 `store/focus.ts` 的模块级变量里：

- 一次性（取走即清空，不会「第二次进用方页又滚一遍」）
- 不写 `pulse.*` 那些持久化键（不与用户数据混，也不留到下次启动）
- 切 tab 不卸载页面、不重载模块 → 模块级变量在切过去之后还在

#### 三个设计取舍

1. **跳转时切到「讲稿原序」并清空关键词** —— 该维度不受分组筛选影响，目标条目必然可见；
   读者正搜着别的词的话，不清关键词会把目标筛掉。
2. **对照依据写在横幅上** —— 凭什么把「清挡路方」认成「清挡路」，让读者自己判断，不让工具替自己说话。
3. **锚点 id 只挂在「独立条目」上** —— 同一个方既嵌在规则卡里、又在「方剂备查」里独立出现，
   两处都挂同一个 id，选择器就撞了（**实测「中焦方」重复 6 次、「引火归元」重复 8 次**）。
   所以嵌在规则卡里的方剂卡**不挂 id**，只有独立条目挂。

#### 查实的一件事：Taro 小程序里 `id` 到底进不进 WXML

Taro 的 mini 运行时在 hydrate 时**显式排除** `id` 属性（`c === ft` → `ft = 'id'`），
WXML 模板里写死的是 `id="{{i.uid||i.sid}}"` —— 看起来用户的 `id` 会被丢掉。

**实测没丢**：React 宿主配置走 `updateProps` → `setAttribute('id', v)` →
runtime 把 `uid` 改成用户值 → hydrate 时 `node.uid !== node.sid` → `data.uid = node.uid`
→ WXML 的 `id="{{i.uid||i.sid}}"` 渲染出用户的 id。
模拟器里 `page.$$('#rule-fx-ssx-qingdanglu')` 查得到（1 个）。

> 这条是**查出来的，不是猜出来的** —— 只读 runtime 源码会得出「id 被丢了、选择器必然查不到」的结论。

#### 回归

- **lint 新增第 26 节（+45 项，157 → 202）**：断言按结构切（先 `stripComments` 只留可执行代码，
  再按**大括号配平**／**顶层声明**切出具体那一段），不全文搜词、不比下标。
- **「故意写坏」变异验证 24 个，全部抓得到**（漏抓 0）。
  其中一个第一版**漏抓了**：`.pr-focus` 的位置断言用了裸子串 `.pr-focus`，
  被横幅的 `.pr-focus-bar` 骗过 → 改成看 `.pr-focus {` 这条规则本身。
- **模拟器回归 17/17**（`npm run test:e2e:mp:link`）：③ 的方名可点 → 跳「用方」→ 横幅写明依据
  → 目标条目高亮 → 锚点 id 唯一 → **页面确实滚过去了**（目标条目 top 贴近视口上沿）。
- 全量回归 **498/498 全绿**（原 441 ＋ 新增 lint 45 ＋ 鸿蒙 lint 57→69 ＋ 12）。

#### 包体代价（实测，不是估的）

「用方」是 tabBar 页 → 知识库**本来就在主包里**（分包这条路不成立），
所以 `visit-triad` 引 `formula-links` 不会让知识库进「不该进的地方」，但仍要量：

| | 主包 `dist` | `common.js` | 就诊页 chunk |
|---|---|---|---|
| 不引 `formula-links` | 924 KB | 176,071 B | 43,171 B |
| 引了 | **928 KB** | 177,772 B | 43,568 B |
| 差 | **+4 KB（0.4%）** | +1.7 KB | +0.4 KB |

另外把 `formula-links` 补进 lint 的知识库白名单机制（并让扫描**剔除纯类型引用**）——
`store/focus.ts` 只要 `FormulaLink` 这个**类型**，编译后一行代码都不留，不该算成「拖知识库进包」。
把那个 `import type` 改成值引用，lint 立刻报红（已实测）。

#### 顺带修掉的两个真 bug

1. **`rx.map` 改块体后括号没收干净** —— 上一轮把 ③ 的方名改成可点时，
   `rx.map((r) => (` 改成 `rx.map((r) => {` 但收尾还是 `))}`，**少一个 `}`**。
   `tsc --noEmit` 直接报 `TS1005` —— 上一轮只验了 domain 层，没编译组件。
2. **`.pr-focus` 与 `.pr-formula` 同特异度** —— 高亮样式必须写在卡片样式**之后**才生效，
   放前面会被卡片自身的 `background` 盖掉（不报错，只是高亮不出来）。

### 3.17 网站端补齐小程序端已有能力：③ 的方名 ↔「用方知识库」（2026-11-06）

**用户**：切回网站端开发，把小程序端已有、网站端缺的能力补上（方向经问卷确认）。

#### 先盘点：网站端到底缺什么

小程序端 §3.16 已经把 ③ 的方名打通到「用方」知识库；而网站端
`src/domain/formula-links.ts`（远端 `6ebc881` 带来的**共享 domain 层**）**在网站端零引用** ——
**解析器在，界面没接**。

盘点网站端 `src/`（Vite + React + TS，单页 `App.tsx`）：

| 面板 | 网站端现状 | 与小程序端的差 |
|---|---|---|
| ① 摸脉 | `ConstitutionPicker` + `BianmaiNote` + `StateHints` + `PulseTable` + `SymbolPalette` / `PulseDiagram` | 对齐 |
| ② 疗法 | `TherapyPicker` + `Findings`（663 行） | 讲稿方剂（`DRUGS` 全量）与同和堂版成方**已经渲染**；但讲义 p44 规则条目**只有命中的才显示** |
| ③ 方药 | `RxList`（纯文字） + `MedicationPanel` | **方名不可点**；**没有「用方」全量视图** |

⇒ 网站端缺的不是「知识库内容」（② 里有），缺的是**③ → 知识库的那条跳转链**，
以及**规则条目的全量视图**（② 只显示命中的，锚点未必定位得到）—— 这两条是本轮要补的。

#### 落地的文件

| 文件 | 作用 |
|---|---|
| `src/components/FormulaLibrary.tsx`（**新**） | ③ 框内**可折叠**的「用方知识库」：讲义 p44 依脉用方**全量 61 条** ＋ 讲稿方剂**全量 30 方**，每条带 DOM 锚点 |
| `src/components/Findings.tsx` | 导出 `DrugCard` / `FormulaItem`；`onFocusFormula` 变可选；新增 `srcNote` |
| `src/components/TriadFrame.tsx` | `RxList` / `TherapyPicker` 新增 `onOpenFormula?`；方名对得上渲染成 `.pr-link` 按钮，对不上明说「用方页未载」 |
| `src/App.tsx` | `formulaFocus` state ＋ `openFormula`；③ 框内插入 `<FormulaLibrary focus={…} />` |
| `src/index.css` | `.pr-flib*` 与 `.pr-triad-rx-unknown` 样式 |
| `scripts/e2e/app-regression.mjs` | 第 ⑧ 节：浏览器端 **+10 项**断言（18 → 28） |

#### 为什么放在 ③ 而不是 ②

② 的「方剂备查」是**判读时的参考**（依脉命中了什么方 → 回头查组成）；
③ 是**正在开方的那一支** —— 读者在这一档问的是「这一支的方，具体怎么吃」。

两者确实有一部分重复（讲稿方剂两边都有），但**用途不同**；小程序端 ③ 档本来就直接显示组成明细，
网站端对齐它更合理。

**没有动 ② 的 `Findings` 结构** —— ② 的「依脉用方 N」是**命中语义**（命中了几条），
改结构会破坏既有回归选择器，也会把「命中」与「全量」两件事搅在一起。

#### 四个实现取舍

1. **锚点挂在卡片外面的 wrapper div 上**（不是卡片自己）——
   卡片同时要挂 `id` 和 `is-focus` 高亮类，两套机制挂在同一元素上容易打架；
   外壳 div 拿 `id` ＋ 高亮类，卡片本身保持原样。
2. **`formulaAnchor(kind, id)` 统一生成 id** —— 渲染与跳转走**同一个函数**，不会走偏。
   锚点 id 全页**唯一**：本区块是页面里唯一给这些卡片发 id 的地方（② 的命中区不给 id）。
3. **`expanded = open || !!focus`** —— 有 focus 时**强制展开**，锚点元素在同一次渲染里就已进 DOM，
   `useEffect` 里可直接 `getElementById` → `scrollIntoView({behavior:'smooth', block:'center'})`；
   CSS 侧 `scroll-margin-top:80px` 兜住吸顶头。
4. **`focusId` 由 `focus` 推出**，不另存 state —— 少一次渲染、行为可预测。
   点同一个方名两次时 `resolveFormulaLink` 每次返回新对象引用 → effect 重跑 → 重新滚动。

#### 维度切换：直接复用 ② 那一套

知识库支持 **讲稿原序 / 按五行 / 按左右手** 三个维度，复用
`groupByWuxing` / `groupByHand` / `FORMULA_ROUTE_ORDER` / `DRUG_GROUPS`（**不另写一套分组**）。

`groupByWuxing` / `groupByHand` 的覆盖率是 **100%**（含「未归类」兜底组），
所以换维度**不丢条目** —— 回归里专门断言了这一点。

#### ③ 的方名，实测解析结果

| ③ 的方名（讲义 p47） | 落到 | 锚点 | 类型 |
|---|---|---|---|
| 上焦方 | 上焦方（讲义 p44「挡路三（左寸）· 变脉无力」） | `rule-fx-dl3-bianmai-wuli` | rule |
| 中焦方 | 中焦方（加味理中） | `drug-zhongjiao` | drug |
| 清挡路方 | 清挡路 | `rule-fx-ssx-qingdanglu` | rule |
| 下焦方 | 下焦方（天乙丹） | `drug-xiajiao` | drug |
| 引火归元 | 引火归元（肾脏疗法） | `drug-yinhui-guiyuan` | drug |
| 冷热水 | 一体疗法（冷热水疗法） | `drug-yiti-leng-re-shui` | drug |

对照表与依据是**共享 domain 层** `src/domain/formula-links.ts` 的 —— 与小程序端**同一份**，
网站端没有另抄一份。查不到的返回 `null`，界面上明说「用方页未载」，**不硬凑、不改名去匹配**。

#### 回归

- **网站端浏览器回归 18 → 28 项**（`npm run test:e2e:app`，**真 Chrome ＋ CDP 驱动**）：
  ③ 的方名可点且 4 个都能对上 → 每个方名**要么可点、要么明说「用方页未载」** →
  点「上焦方」→ 知识库自动展开 ＋ 定位 rule 锚点 ＋ 高亮 ＋ 锚点 id 全页唯一 →
  点「中焦方」→ 定位 drug 锚点 ＋ 高亮 ＋ 唯一 → 换「按五行」维度后锚点仍在 → 控制台无异常。
- **「故意写坏」两轮验证**（`local-data/break-web.mjs`）：
  ① 锚点 id 写错（`id={'x-rule-'+r.id}`）→ **4 条断言红**（定位／高亮／唯一／换维度）；
  ② 高亮 class 不挂 → **1 条断言红**（「定位到的那一条高亮了」，精确命中）。两轮均已复原。
- 全量回归 **515/515 全绿**（core 26 ＋ taro-lint 202 ＋ taro-api 51 ＋ migration 53 ＋ auth 53 ＋ **app 28** ＋ 桌面端 33 ＋ 鸿蒙 69）。
- `npm run typecheck`（网站端）与 `npm --prefix taro run typecheck` 均 exit=0。

#### 顺带确认的一件事：网站端单页不需要小程序那套「内存态 ＋ switchTab」

小程序端跳转要走 `store/focus.ts` 的模块级变量，因为 `switchTab` **不支持 query 参数**。
网站端是**单页平铺**，一个 `useState` 直接传下去就行 —— 不必把小程序那套机制复制过来。

#### 浏览器实看（已做）

`http://localhost:5180/`（vite dev）→ 单机模式自动登录 → 载入示例（少娟）→ 选「三焦疗法」→
② 疗法卡里的 4 个方名已是带依据的可点按钮（`title` 写着「看「X」的完整条目　依据：…」）→
③ 清单正常 → 折叠的「用方知识库」标题写着「▸ 用方知识库 · 讲义 p44 依脉用方 61 条 · 讲稿方剂 30 方」→
点 ③ 的「上焦方」→ 知识库展开并滚到高亮条目。

### 3.18 更正一条错误结论：「PG 环境接不进小程序云开发」（2026-11-07）

**这条结论是错的 —— 错在「拿一个已销毁的环境 id 当成了 `pulse-1` 的观测」。**

| 之前记的 | 实情（2026-11-07 复核） |
|---|---|
| 「`callFunction` 报 `-501000 Environment not found` ⇒ PG 环境接不进小程序云开发」 | 报错的**观测对象是 `ambitious-parrot-d7ehh7x0fd9d680`**，它 11-06 当天**已被销毁**。环境没了以后 `wx.cloud.init` 照样「成功」（它不报错），错误要拖到第一次 `callFunction` 才抛 —— 那次观测只证明「那个 id 指向的环境没了」，**根本没碰到 `pulse-1`** |
| 「`pulse-1` 的 `UserInfo.WxAppId` 是空的 ⇒ 还没关联」 | `UserInfo.WxAppId = wx3a21eb903a16cbc4`，`UserInfo.UpdateTime` = 2026-11-06T07:07:00Z → **账号级关联早就是了** |
| 「开发者工具『使用已有腾讯云环境』提示『暂不支持选择 PostgreSQL 环境』⇒ PG 不能用」 | 那是**「转换入口」**的限制（把腾讯云侧环境收编成小程序自己的环境）。**跟官方文档的 `rdb()` 直连是两套机制**，不能互相推导 |
| —— | 而 **`pulse-1` 的云通道从来没被测过**：11-06 那份小程序包走的是 **request 直连网关**，**云通道压根没编进包里** |

**为什么会错**：`.workbuddy/memory/2026-11-06.md` 的结论与 `miniprogram-dev.md` 的排障表，
把「转换入口不收 PG」直接写成了「PG 在小程序里用不了」，**中间没有实测这一步**。

#### 官方文档怎么说的

<https://docs.cloudbase.net/database/framework-quickstarts/pg/mp>《在微信小程序中访问云开发 PostgreSQL 数据库表》：

- **标题就写明支持**微信小程序访问 CloudBase PostgreSQL；
- 路径是 `wx.cloud.init({ env })` ＋ `init(wx.cloud).rdb()` **直连**（**不是 `callFunction`**）；
- 前置条件：「**必须使用你的微信小程序关联的腾讯云账号登录云开发平台**」→ **我们满足**；
- 「支持地域」只标了**上海** → 本环境正在 ap-shanghai ✓。

⚠️ **但另一处官方文档跟我们相左**：FAQ《不同客户端能否使用同一个资源环境？》——
「在微信侧创建的环境，可支持开发小程序端和 Web 端；而在**腾讯云侧创建的环境暂时只支持开发 Web 端**」。
本环境 `EnvChannel = qc_console`（腾讯云侧创建）→ 落在后半句。
**两处官方文档打架 → 只能实测，不能靠推断。**

#### 这一轮做了什么

| # | 事项 | 结果 |
|---|---|---|
| 1 | 核实 `-501000` 的观测对象 | 是**已销毁**的 `ambitious-parrot`；`pulse-1` 从未被测过 |
| 2 | 核实 `pulse-1` 的关联状态 | `WxAppId = wx3a21eb903a16cbc4`，**账号级关联已完成** |
| 3 | 修掉 6 处硬编码的已销毁环境 id | 小程序端 2 处 ＋ 4 个脚本默认值 ＋ 1 条回归断言 → 全部指向 `pulse-1` |
| 4 | 加一条守住「默认 env id 必须在用」的回归断言 | 「故意写坏」验证过：改回旧 id 即失败（51/1） |
| 5 | 编一份**云优先 ＋ 网关兜底**的双保险包 | `pulse-record/taro/dist` 现在就是它：云通道通就走云函数，不通自动退回网关直连 |
| 6 | 回归 | **516 项全绿**（原 515 ＋ 新增 1） |

#### ⏭ 下一步（要你按一次，2 分钟）

在微信开发者工具里打开 `pulse-record/taro/dist` → 点「编译」→ 进「我的」页 →「测试连接」→
看「**传输方式**」那一行：

| 结果 | 含义 | 下一步 |
|---|---|---|
| 「**云函数**」＋「连接正常（多用户模式）」 | ✅ 云通道通了 | 现有架构原封不动可用；**小程序不再需要 ICP 备案** |
| 「**直连（云通道不可用：…）**」＋括号里 `-501000` | ❌ 环境在微信侧不可见，`callFunction` 这条路死 | 改试官方 `rdb()` 直连（需重写数据层 ＋ 建 RLS，见上线清单 §2.7） |

> 顺手也修掉一个真 bug：小程序端 `CLOUD_ENV_ID` 的默认值一直写着一个**已销毁**的环境 id，
> 任何没注入 `PULSE_CLOUD_ENV` 的 cloud 构建**必然** `-501000` ——
> 这才是「云通道怎么都不通」的真实原因，而不是什么 PG 环境限制。

### 3.19 实测：PG 在小程序里**完全可行**（2026-11-07，已用真实微信运行时验证）

**§3.18 那条「待实测」的未知数已经落地。** 用**开发者工具的自动化端口**进真实运行时真调，
不靠推断：

```bash
/Applications/wechatwebdevtools.app/Contents/MacOS/cli auto \
  --project "pulse-record/taro/dist" --auto-port 9420 --trust-project
# 再用 miniprogram-automator 连 ws://127.0.0.1:9420，在 app service 上下文里调
```

**① 直接调云函数：**

```json
{ "steps": ["wx.cloud 存在 ✅", "wx.cloud.init 没抛错", "callFunction 成功 ✅"],
  "payload": { "ok": true, "result": { "statusCode": 200,
    "body": "{\"ok\":true,\"db\":\"CloudBase PostgreSQL\",\"mode\":\"multi\",\"sessionTtlDays\":30}" } } }
```

**② 走 app 自己的代码路径读界面（「我的」页，`useDidShow` 自动发真实请求）：**

| 界面行 | 读数 |
|---|---|
| 登录名 | `guoguo` |
| 模式 | **多用户模式（按账号隔离）** |
| 存储位置 | **CloudBase PostgreSQL** |
| **传输方式** | **云函数（callFunction）** |
| 当前连接 | `https://pulse-1-…app.tcloudbase.com/pulse-api`（**只是兜底地址**，云通道通时用不到） |

**③ 旁证 —— 微信侧自己的 CLI 也认这个环境：**

```bash
cli cloud env list      --project pulse-record/taro/dist   # → * pulse-1-d0g880ydl8ddc57f6
cli cloud functions list --project pulse-record/taro/dist --env pulse-1-d0g880ydl8ddc57f6  # → * pulse-api
```

#### 结论与影响

| # | 结论 |
|---|---|
| 1 | ✅ **官方文档 `pg/mp` 是对的**，官方 FAQ 那句「腾讯云侧创建的环境暂时只支持开发 Web 端」在本环境上**不成立** |
| 2 | ✅ **`wx.cloud.callFunction` 这条路就够** —— **不需要** `rdb()` 直连、**不需要**建 RLS、**不需要**重写数据层 |
| 3 | ✅ **ICP 备案不再是小程序的前置** —— 云通道走微信内部通道，不受 request 合法域名约束。备案仍是**网站端**的前置 |
| 4 | ✅ 现有 35 个 `pulse_*` PG 函数 ＋ 云函数 `pulse-api` 的架构**原封不动可用** |
| 5 | ⚠️ **「我的」页的「当前连接」只是兜底地址** —— 云通道通的时候它根本不会被用到；它指向的网关域名仍未备案，所以**不能**拿它当正式版的 request 通路 |

#### 两个实测踩到的坑（记下来，别再踩）

| 坑 | 现象 | 正解 |
|---|---|---|
| 在运行时里忙等回调 | `evaluate` 直接 `timeout waiting for automator response` | 小程序运行时**单线程**，忙等把事件循环堵死 → 必须 `async/await` 等回调 |
| H5 预览插件启动即挂 | `app.js 执行失败：global is not defined` | Taro runtime 的浏览器垫片里有 `Object.getOwnPropertyNames(global\|\|{})` —— `\|\|` 挡不住**未声明**标识符，浏览器里 `global` 未声明就抛 ReferenceError。**微信运行时有 `global`，真机不受影响**（用户自己的开发者工具截图已证）。⚠️ 且该插件**不提供云能力**，测不了 `wx.cloud` |

#### 顺带查出一个真缺口（网站端，与小程序无关）

云函数环境变量里**没有 `PULSE_CORS_ORIGINS`**（`server/index.mjs:162` 读它）→
网关**不回 `Access-Control-Allow-Origin`**（curl 实测：`OPTIONS` 预检 204 但无该头）。
→ **网站端一旦部署到静态托管（`*.tcloudbaseapp.com`）再跨域调网关（`*.app.tcloudbase.com`），会被浏览器拦。**
网站端还没上线（静态托管是空的），所以**不紧急，但别忘了**。

### 3.20 宽表竖线错开 —— 查清根因并修掉；「当前那一次」统一成一套（2026-11-07）

**用户报的问题**（贴了截图）：① 宽表的竖线错开；② 一次一屏编辑时看不到日期、体质，不方便改。

#### ① 根因：表头「左/右」行与正文用了**两套列宽算法**

先把讲义 p34 的实例表**重新量了一遍**（`pypdfium2` 渲染 → 逐行数竖线 x 坐标），
拿到体例的真相：

| 行 | 讲义 p34 实例表实测的竖线 x 坐标 |
|---|---|
| 表头·日期行 | 654, 813, 953, 1122, 1262, 1378, 1494, 1610, 1649 —— **组内不画竖线**（日期横跨左＋右） |
| **表头·左/右行** | 654, 699, 813, 884, 953, 1039, 1122, 1194, 1262, 1322, 1378, 1438, 1494, 1554, 1610, 1649 |
| **正文各行** | **与左/右行完全相同**（逐个坐标一致） |

→ 讲义要求：**表头「左/右」行的列界与正文完全重合**。

再量用户截图里的小程序实现：

| 行 | 实测竖线 x | 相对正文偏了多少 |
|---|---|---|
| 表头·左/右行 | 26, 168, 264, 357, 453, 547, 642, 736, 825 | **+2 → +4 → +7 → +9 px**（逐列累积） |
| 正文各行 | 26, 96, 166, 260, 353, 446, 540, 633, 727, 820, 825 | — |
| 表下 | 26, 168, 357, 547, 736, 825 | — |

**根因**（算出来的，不是猜的）：表头「左/右」行原来是「**168rpx 容器内塞 84+84 两个子格**」。
容器自带 `border-right: 2rpx`，`box-sizing: border-box` 下**内容盒只剩 166rpx** ——
两个 84rpx 的子格**放不下 → 每组溢出 2rpx**，把后面每一组整体推右 2rpx。
**列数越多偏得越远**（4 次就诊就偏到 9px）。正文的列界本身是对的（平铺 84rpx 格）。

**修法**：表头「左/右」行改成**与正文同构** —— 平铺的 84rpx 格，列界由同一套算法算出，必然对齐。
表下两行的「体质／疗法」标签原来跟值**错行**（lead 第 2 行是「体质」，值却在第 1 行），
一并改成标签跟值同行。

#### ② 「当前那一次」原来有**两套**，各说各话

| | 原来 | 现在 |
|---|---|---|
| 宽表点日期 | 只改本地 `activeSessionId` | 同时 `selectVisit()` 切全局上下文 |
| 体质／疗法／方药档 | 读 `ctx.visitId` | 读**同一处**推导的「当前那一次」 |
| 关系图 | 读 `activeSessionId` | 同上 |

⇒ 以前**宽表高亮的那次 ≠ 体质/疗法档显示的那次**。现在统一：
`activeSession` 先认表格里选中的那次 → 再退到上下文那次 → 最后退到最后一次。

顺带修掉一个真 bug：本地新建、还没落库的那次就诊，点体质会 `PATCH` 一个不存在的 id（404）。
现在这几次**只改本地**，等「保存」整份写进去。

#### ③ 一次一屏：把选中的那次**放大显示**出来

顶上加一块「这一次」：**日期大字** ＋ **体质** ＋ **疗法**（点一下就地改，复用宽表那两个弹层）
＋ 一排**日期 chip**（随时换次，选中的高亮）。宽表里点日期 → 那一列**整列高亮**
（表头日期、左右格、数据格同色 `#ffe9a8`）。

#### ④ 验证：三层，缺一不可

| 层 | 手段 | 结果 |
|---|---|---|
| **原始资料** | 讲义 p34 实例表逐行量坐标 | 表头「左/右」行与正文**完全重合**（体例要求，已记入本节） |
| **结构** | `taro-lint` 新增 22 条断言，按 **AST** 解析 TSX（不是全文搜词） | 224 项全绿 |
| **几何** | 新脚本 `scripts/e2e/sheet-layout-probe.mjs`：用 `react-dom/server` 渲**组件本身** ＋ 套**编译产物里那份 WXSS** → 无头 Chrome 里量 `getBoundingClientRect()` | 13 项全绿 |

几何探针的实测（讲义 p34 少娟实例，6 次记录 ＝ 12 列）：

```
表头「左/右」行的列界 与 每一行正文数据格完全重合 ✅
列界偏移恒定（不再逐列累积）✅
日期格右边界 == 对应那次的最后一列 ✅
表下列界 == 表头日期格 ✅
```

**探针本身也验过**：把两个文件 `git checkout` 回**带 bug 的原始版本**重跑 → **8 条失败**；
换回修好的版本 → **13/13 通过**。探针不是摆设。

#### ⑤ 断言怎么写的（为什么不用全文搜词）

第一版三条断言**被「故意写坏」骗过了** —— 把 `className='pr-single-head'` 改成
`'pr-single-head-off'`、把 `selectVisit(...)` 改成 `void s`，搜词照样搜得到。
改成用 **TypeScript 编译器 API**（Taro 工作区里的 TS 5.9，经典 AST API）按结构判：

- 找 **JSX 元素**的 `className` 属性 → 拆成类名 token（不是子串）
- 找**调用点**（`selectVisit(...)` 真被调用，而不是「import 里出现过这个名字」）
- 比 `||` 链里**运算数的先后**（不是比下标）

**9 类「故意写坏」全部被抓到**（格宽改回 168rpx / 结构塞回容器 / 标签错行 / 推导顺序倒过来 /
改类名 / 去掉调用 / 拆掉高亮绑定 / 去掉就地改 / 去掉 chip）。

> 踩坑记一笔：`ts.forEachChild` 的回调**返回真值会中断遍历** ——
> 写成 `(c) => walk(c, out)`（返回数组）只会走到第一个子节点。静默少数据，差点误判成「断言全挂」。

#### ⑥ 只改了 Taro 版 —— 原生回退工程**一个字没动**

维护者明确「原生版后面不打算做了」。本轮改动范围：

| 动了 | 没动 |
|---|---|
| `taro/src/components/record-sheet/index.tsx` ＋ `index.scss` | `miniprogram/`（原生回退工程）**一字未动** |
| `taro/src/pages/visit/index.tsx` | `scripts/e2e/mp-lint.mjs` / `mp-api.mjs` / `mp-sim.mjs`（原生版回归） |
| `scripts/e2e/taro-lint.mjs`（新增 22 条断言） | `scripts/e2e/mp-*.mjs` 守着的老规矩 |
| `scripts/e2e/sheet-layout-probe.mjs`（新增几何探针） | |

**原生回退工程里那两条已知缺陷仍在**（它的表格 CSS 与 Taro 版曾经逐字相同）：
① 表头竖线逐列错开；② 表下「体质」标签错行。
另外它**没有「一次一屏」**、没有四档工作台 —— 功能本就落后 Taro 版很多。

⇒ **风险不在「改不改原生版」，而在「它还算不算一个可靠的回退」**：
它现在既带着这两个显示缺陷，功能又落后。详见 §7 待办里新增的那条。

### 3.21 实机仍然错开 —— 真凶是「边框进了盒模型」，不是姓名（2026-11-07 晚）

§3.20 修完，维护者在**微信小程序真机**上发来截图：**列还是错开**。
（§3.20 用的是 Chromium 几何探针，13/13 全绿 —— **探针没抓到这个坑**。）

#### ① 先量实机截图，再看代码

拿维护者的截图（1224×2776）逐行找竖线，做**亚像素质心**定位
（`PIL` + numpy：按行带取「每列最黑的一行」做剖面，峰值质心定位线心）：

| 量到的 | 应为 | 差 |
|---|---|---|
| 正文数据格 | 84.0 rpx | 0 ✅ |
| 表头「左/右」格 | 84.0 rpx | 0 ✅ |
| 表头姓名段 | 127.7 rpx | ≈0 ✅ |
| **正文「部位+取法」两段** | 128 rpx | **125.8 ❌ 短 2rpx** |
| **日期格 / 表下格** | 168 rpx | **169.8 ❌ 长 2rpx** |

⇒ 表头比正文右移 **3px**，日期行比表头再右移 **3px** —— **逐段累加**，
越往右偏得越多，和截图上看到的完全一致。

#### ② 真凶：**带 `border-right` 的格子，边框被算进了盒模型**

短的是「部位+取法」，长的是「日期格 / 表下格」——
**这两组恰好就是带 `border-right` 的格子**；而 84rpx 的数据格和「左/右」格
**全都准**。也就是说：**真机引擎把竖线边框算进了格子的外宽**
（Chromium 的 `border-box` 本来就把它算在**内**，所以本地探针永远抓不到）。

**修法（结构上，不是调数值）**：竖线一律改用
`box-shadow: inset -Xrpx 0 0 #000` 画在**盒子内侧** —— **边框完全不参与盒模型**，
每个格子的外宽**严格等于它声明的 `width`**，
列界只由「84rpx × N」「168rpx = 2 × 84rpx」的算术决定，**任何引擎都插不上手**。

改动：`taro/src/components/record-sheet/index.scss` —— 9 条规则的竖线全部换掉
（`.pr-thead-name` / `.pr-thead-date` / `.pr-thead-hand` / `.pr-thead-hand.is-r` /
`.pr-organ` / `.pr-depth` / `.pr-cell` / `.pr-tfoot-label` / `.pr-tfoot-cell`，
外加一次一屏的 `.pr-single-label` / `.pr-single-slot`）。
**横向**的 `border-top` / `border-bottom` 保留 —— 它们只影响行高，不影响列位。

#### ③ 「演示·郭丽君」那几个字：**不是元凶，但另有毛病**

维护者问「这几个字过大，是否会影响」—— 逐条查证：

- **不影响列位**：姓名段实测 127.7rpx ≈ 128rpx，**名字再长也推不动别的格子**
  （`.pr-thead-lead` 是 `width: 128rpx; flex: none`）。
- **但它自己被硬切了**：姓名的文字宽 243px，格子只有 206px，
  `overflow: hidden` 一刀切下去 —— **「演」「君」两个字缺笔画**（截图里可见）。

**修法**：姓名改用 `<Text>` 承载，按**字宽估算**分四档字号
（≤4 字 28rpx／5 字 23rpx／5.5 字 21rpx／更长 17rpx），
再叠 `text-overflow: ellipsis` 兜底；并补 `min-width: 0` + `overflow: hidden`
当双保险 —— **宁可显示省略号，也不硬切半个字**。
（「演示·郭丽君」估算 5.5 个字宽 → 21rpx，实测完整显示、不缺笔画。）

#### ④ 两条防线都补上了

| 防线 | 位置 | 断言数 |
|---|---|---|
| **默认回归**（`npm test` 里的 `taro-lint`） | 解析 SCSS **规则块**（不是全文搜词）→ 逐条查 `border-right` / `box-shadow: inset` | 4 条 |
| **几何探针**（`test:e2e:sheet`，不在默认链） | 查**计算样式**（`border-right-width` 必须是 0、`box-shadow` 必须带 inset）＋ 各格**外宽 == 声明宽度** ＋ 长姓名用例 | 11 条 |

**探针从 13 项扩到 34 项**：新增「长姓名（演示·郭丽君）不改变任何列位」
「各格外宽严格等于声明宽度」「表头姓名段宽度 == 正文两段宽度」
「姓名的**真实字宽**（`scrollWidth`，不是元素盒宽）塞得进格子」等。

#### ⑤ ⚠️ 两条「白测」教训

1. **光量「外宽」抓不到这次的回归** —— Chromium 的 `border-box` 本来就对，
   改回 `border-right` 后外宽仍然是 84rpx。**必须查计算样式**：
   `getComputedStyle(el).borderRightWidth === '0px'` 且 `boxShadow` 带 `inset`。
2. **光量「元素盒宽」也抓不到「字被硬切」** —— `overflow: hidden` 把元素盒宽钉住了，
   量 `getBoundingClientRect()` 只会量到盒子。**要量 `scrollWidth`**（真实内容宽）。

**4 类「故意写坏」全部被抓到**：
`.pr-cell` 改回 `border-right` ／ 去掉字号自适应 ／ 去掉姓名格 `overflow:hidden` ／
去掉 `text-overflow:ellipsis`（探针与 taro-lint 各自报错，不是崩）。

#### ⑥ 仍然要用户侧做的一件事

**微信开发者工具的 CLI 登录态过期**，本轮**没能进真实微信运行时**做最终目视复测
（`cli auto` 报「需要重新登录」）。
本次修复的量级（±2rpx ≈ 3px）**只有在真机上才量得出来**，
Chromium 探针只能保证「结构上不再依赖边框参与盒模型」。
⇒ **请维护者重新登录开发者工具后，用已建好的 `taro/dist` 复测一次**。

### 3.22 日期行仍错开 —— 真凶是「168rpx 的整格」；改成两个 84rpx 半格（2026-11-07 深夜）

§3.21 修完（竖线改 inset box-shadow）后，维护者又发来一张**标注过的**截图
（iOS 模拟器，726×1538），圈了两处「线是错开的」。本轮把它彻底定位并改掉。

#### ① 先把新截图量准：**数据列已经全对齐了，只剩日期行**

新截图的横线：554（表顶）→ 607（日期行底）→ 659（左/右行底）→ 718…1193（9 行正文）。
用「整行覆盖率」筛掉文字笔画后，逐行量到的竖线（px）：

| 行 | 竖线位置 | 结论 |
|---|---|---|
| 表头「左/右」行 | 51 / 168 / 245 / 321 / 398 / 474 / 550.5 / 628 / 704 | — |
| 正文首行 | 80 / **168 / 245 / 321 / 398 / 474 / 550.5 / 628 / 704** | ✅ **与表头逐根相同** |
| **日期行** | 51 / **323 / 478 / 633**（+ 704 是表格右边框） | ❌ 组界偏 **+2 / +4 / +6 px** |

⇒ **表头「左/右」行与正文数据格完全一致**（§3.21 的平铺修法生效了），
**只有日期行**还在逐格累积偏移 —— 正是维护者标的 ①（5月10日 右／6月 左 交界）
与 ②（2月14日 右／3月28日 左 交界，纵贯全表）。

#### ② 真凶锁定：**全表出错的格子，恰好只有「显式 width > 84rpx 且带 padding」的那两个**

把全表的格子按「声明宽度」与「带不带 padding」分成两类，对上真机表现：

| 格子 | 声明宽度 | padding | 真机表现 |
|---|---|---|---|
| `.pr-cell` 正文数据格 | 84rpx | 无 | ✅ 一列不差 |
| `.pr-thead-hand` 表头左/右格 | 84rpx | 无 | ✅ 一列不差 |
| `.pr-thead-date` **日期格** | **168rpx** | **有** | ❌ 每格宽 ~2.4rpx，逐格累积 |
| `.pr-tfoot-cell` **表下格** | **168rpx** | **有** | ⚠️ 同病（截图没拍到那一段） |

⇒ 与「border 进盒模型」那次的规律**一模一样**：**凡是不靠 84rpx 算出来的宽度，真机就偏。**

#### ③ 修法：不是调数值，是**换写法** —— 日期/表下也拆成两个 84rpx 半格

`「一次就诊占两列」` 这个关系，改成**由格子的数量**表达，而不是由**「声明一个 168rpx 的宽」**表达：

- `.pr-thead-date` / `.pr-tfoot-cell`：`width: 84rpx`、**去掉 padding**，每格一条竖线；
- 一个日期 = **两个半格**（`is-l` / `is-r`），`is-r` 的竖线加粗成 2rpx（组界）；
- 日期标签 / 表下值：**绝对定位**在左半格上（`position:relative` 的 `is-l` 当基准），
  `left:0; width:168rpx` 横跨两格居中 —— 不靠 flex 溢出、不靠 padding；
- 于是**全表只剩 84rpx 一种数据列宽**（部位/取法 64rpx、姓名段 128rpx 靠 stretch **不声明 width**），
  列界只由「84rpx × N」这一套算术决定。

#### ④ 本地复现：搭了一个 **WKWebView**（iOS 同引擎）探针

为了不再靠「截图量像素」猜，本轮写了个 **`swiftc` + WKWebView** 的本地跑手
（`scripts/e2e/webkit-probe.swift`），拿**同一份页面、同一份测量脚本**在 iOS 同引擎里量。

**结论很扎心**：Chromium 与 WKWebView **都量不出这个偏差** —— 同样的 CSS，
两个引擎里日期格都正好 168rpx、列界都重合。⇒ **这个偏差不是「WebKit vs Chromium」的差异，
而是「微信小程序渲染层 vs 浏览器」的差异**（小程序的样式引擎与盒模型处理另有自己的一套）。

⇒ 所以本地**只能保证结构**（全表只一种宽度声明），**数值必须回真机量**。
这条已经写进 `AGENTS.md`「④ 实例表的版式结构」。

> 探针本身留在仓库里了：`npm run test:e2e:sheet:webkit`
> （**macOS 专用**，要 CommandLineTools；不在默认 `npm test` 链里，缺 `swiftc` 就跳过）。

#### ⑤ 顺手查清的一件事：「2月14日 的寸·浮 显示成空和 X」**不是 bug**

§3.20 记过一个疑点：真机截图里 2月14日 的「寸·浮」是「空」和「X」，
而云端 API 里那格是 `['+']`／`['+']`。本轮查清了：

- 用云端**真实数据**在本地渲染同一个组件 → 输出 `+,+` ✅ **组件逻辑没问题**；
- 真机那两格是**录入页里还没保存的本地编辑**（用户把左格清空、右格选了细脉「X」，
  还没点「保存」）；云端已存的仍是 `+,+`。
⇒ **不是显示层 bug，是未保存的编辑状态**，已从待办里划掉。

#### ⑥ 防线（这一轮的断言）

| 防线 | 位置 | 断言数 |
|---|---|---|
| **默认回归**（`npm test` 里的 `taro-lint`） | 解析 SCSS **规则块**：全表数据列宽必须都是 84rpx；不得再出现 168rpx 的整格；日期/表下格**不许带 padding**；标签必须绝对定位跨两格；组件必须渲染成 `is-l`/`is-r` 两个半格 | +6 条（228 → **234**） |
| **几何探针**（Chromium，`test:e2e:sheet`） | 日期半格与手格**逐格对齐**；标签横跨两格；表下值横跨两格；半格外宽 == 84rpx | 34 → **36** 项 |
| **WebKit 探针**（新增，`test:e2e:sheet:webkit`） | 同一份页面在 **iOS 同引擎**里再量一遍同样的结构不变量 | **6** 项 |

**7 类「故意写坏」全部被抓到**（`taro-lint` 报错，不是崩）：
日期格改回 168rpx 整格 ／ 给日期格加 padding ／ 去掉 `is-l` 的 `position:relative` ／
标签文字不用绝对定位 ／ 组件不拆半格 ／ 表下格改回 168rpx ／ 半格竖线改回 `border-right`。
WebKit 探针也独立抓到了「标签不再跨两格」。

#### ⑦ 仍要用户侧做的一件事（同 §3.21 ⑥）

**微信开发者工具的 CLI 登录态过期**，本轮依然**没能进真实微信运行时**做最终目视复测。
本轮的改动是**结构性的**（把「显式 width > 84rpx」的格子全部消灭），
按 §3.21 量出来的规律（84rpx 且无 padding 的格子在真机上一列不差）应当能解决漂移，
但**数值仍需真机确认** ⇒ **请维护者重新登录开发者工具，用已建好的 `taro/dist` 复测一次**
（重点看**日期行的组界**是否与「左/右」行的组界重合）。

### 3.23 复测后又多出两条竖线 —— 「拆格子」不等于「画两条线」（2026-11-07 16:07）

§3.22 的改动推到远端后，维护者**在开发者工具里重新编译并复测**，发来一张标注截图，
圈了两处「**这里多了一个竖线**」。

#### ① 量出来：日期行与表下，各多了一条**在每个格子的正中间**

新截图（680×1120）逐行量竖线（px）：

| 行 | 竖线位置 | 判定 |
|---|---|---|
| 表头「左/右」行 | 3 / 120 / **196.5** / 273 / 350 / 426 / 503 / 580 / 656 | 基准 |
| **日期行** | 3 / **197** / 273 / 350.8 / 426 / 503.2 / 580 / 655.3 | ❌ **196.5 处多一条** |
| **体质行** | 2.5 / 119.5 / **195.3** / 273 / 348.5 / 426.5 / 501.5 / 579.5 / 654.5 | ❌ **195.3 处多一条** |

⇒ 多出来的那条线，正好在**每个日期（每个表下值格）的正中间** ——
就是 §3.22 拆半格时**顺手给左半格也画了右线**。

#### ② 违反的是讲义 p34 的体例

`AGENTS.md`「④ 实例表的版式结构」里本来就写着：

> 表头：两行。**第一行只放日期**，每组横跨「左 + 右」两列，**中间不画竖线**；第二行才放「左 / 右」

⇒ **拆格子是为了统一列宽算法（84rpx），不是为了画两条线。**
左半格（`is-l`）本来就**不该画竖线** —— 竖线只画在**组界**（一次就诊的右边，即 `is-r` 的右边）。

**修法**：`.pr-thead-date.is-l` / `.pr-tfoot-cell.is-l` 加 `box-shadow: none`（不画线）；
`is-r` 保持 2rpx 的 inset 竖线（组界）。

#### ③ 顺带发现并修掉一个**隐藏 bug**：表下的值被截成「（未」

真机截图里表下的值显示成「（未」「（未」「肾」—— 而完整值应该是「（未判）」「（未判）」「肾虚」。

**根因**：`.pr-tfoot-cell` 基础规则带 `overflow: hidden`（本来是为了截超长的值），
而值文字是**绝对定位跨两格**的 —— **父格子把它裁掉了**，只露出前半截。

**修法**：左半格改 `overflow: visible`（不许裁跨格文字）；
超长文字由 `.pr-tfoot-cell-text` 自己的 `overflow:hidden + text-overflow:ellipsis` 兜底。

#### ④ 防线（又加 5 条）

| 防线 | 新增断言 |
|---|---|
| `taro-lint`（源码级，解析 SCSS 规则块） | 左半格**不许画竖线**（必须 `box-shadow:none`）／右半格必须画组界线（inset）／左半格**不许裁**跨格文字（必须 `overflow:visible`） |
| 几何探针（Chromium） | 逐个半格查**计算样式**：左半格 `box-shadow` 必须是 `none`、右半格必须带 `inset` ／ 左半格 `overflow` 必须是 `visible` ／ 跨格文字的**真实字宽**（`scrollWidth`）塞得进两格 |
| WebKit 探针 | 同上三组（iOS 同引擎） |

⚠️ **「左半格不许画竖线」是量坐标量不出来的** —— 格子边界还在，只是没画线；
必须查**计算样式**（`getComputedStyle(el).boxShadow`）。这与「竖线不许用 border」是同一类断言。

探针从 36 项扩到 **40 项**，WebKit 探针从 8 项扩到 **10 项**。

半格身份按 **class**（`is-l` / `is-r`）判定，**不按下标奇偶** ——
奇偶只在「每行格子数是偶数」时恰好成立，一旦 DOM 顺序调整就会误判。

#### ④b 「故意写坏」验证 —— 证明这些断言是**活的**（`scripts/e2e/sheet-break-test.mjs`）

**为什么必须做**：这次的病根正是「**改完立刻看着对了，而本地探针当时全绿**」。
光「加断言」不等于「防线成立」—— 得证明断言**真的能抓到**那个坏写法。

做法：把**源码 SCSS 故意改坏** → 真跑 `taro build --type weapp` → 跑 lint ＋ 几何探针
→ 要求**对应的断言必须红**。走完整链路（不直接改编译产物），
验的是「源码写坏了会不会被抓」，而不是「产物被手改会不会被抓」。

7 个 case（**7/7 全被抓**）：

| # | 故意写坏 | 被谁抓到 |
|---|---|---|
| B1 | 日期左半格又画上竖线（**上一轮那个真凶**） | lint ＋ Chromium 探针 |
| B2 | 表下左半格又画上竖线 | lint ＋ Chromium 探针 |
| B3 | 日期右半格不画组界线（竖线改回 none） | lint ＋ Chromium 探针 |
| B4 | 表下右半格不画组界线 | lint ＋ Chromium 探针 |
| B5 | 日期左半格裁掉跨格文字（`overflow:hidden`） | lint ＋ Chromium 探针 |
| B6 | 表下左半格裁掉跨格文字（「（未判）」→ 「（未」） | lint ＋ Chromium 探针 |
| B7 | 跨格文字塞不进两格（字号调大到 60rpx） | Chromium 探针（lint 管不到字号） |

两条纪律：

1. ⚠️ **mutation 没改动文件时直接判失败** —— 否则「什么也没改 → 断言当然不红 → 误判为通过」，
   这就是「跳过」被当成「通过」的经典坑。
2. 结束时**必定还原源码并重建**（`finally` 里做，中途出错也还原），不留一个被打坏的工程。

跑法：`npm run test:e2e:sheet:break`（约 2 分钟，**不在默认 `npm test` 链里** —— 它要跑 7 次真构建）。

#### ⑤ 效果已本地目视确认

探针出图（`PULSE_SHOT_DIR=/tmp/shots3`）核对：
**日期行每个日期跨「左｜右」两格、中间没有竖线**，竖线只在组界，
且**组界与「左/右」行的组界落在同一个 x**；表下的值格同样如此，且「（未判）」**完整显示**。

## 4. P3 · 迁 CloudBase（🟡 云端已建成，开发／试用环境）

**目标**：网站跑静态托管、API 跑云函数、数据存 **PostgreSQL**、小程序走 `wx.cloud.callFunction`（不走合法域名校验）。

**2026-11-06 实测：已经搬完了**（原先记的是「规划完成，待触发」）。
细节全文见 [`cloudbase-migration.md`](./cloudbase-migration.md)（已改成「已建成」版）。

### 4.1 实际架构

| 件 | 落点 |
|---|---|
| 网站 | CloudBase **静态托管** `https://pulse-1-d0g880ydl8ddc57f6-1257312696.tcloudbaseapp.com` |
| API | CloudBase **云函数 `pulse-api`**（**Event 类型**，Nodejs20.19，`index.main`）→ 网关 `…ap-shanghai.app.tcloudbase.com/pulse-api` |
| 数据 | CloudBase **PostgreSQL** `postgres-gi7xmyo4`（17.11）—— 7 张表 ＋ **35 个 `pulse_*` 函数** |

### 4.2 关键决策

| # | 决策 | 为什么 |
|---|---|---|
| 1 | **PG 访问走 `app.rdb().rpc()`，不 TCP 直连** | 本环境 PG 是 `SHARED` 托管实例，**没暴露连接地址**；体验版的 VPC／公网直连开关都不可用 |
| 2 | **所有读写下沉为 PG 函数（RPC）** | 一次 RPC ＝ 一个事务 →「整份覆盖」原子；JS 侧不写 SQL → 不会方言漂移 |
| 3 | **PG 函数返回值统一 jsonb 对象包裹** | postgREST 对标量返回／SQL NULL **不给 body**（会变成 `{}`）—— 迁移时一撞就撞了 28 处 |
| 4 | **云函数用 Event 类型（不是 HTTP）** | Event 能同时喂小程序 `callFunction` 与网关 HTTP Access → **一个函数喂饱两端**；函数类型创建后不可改 |
| 5 | **网关 `upstreamResourceType=SCF`** | 写 `WEB_SCF`（HTTP 函数）返回 400 空 body |
| 6 | **API 挂 HTTPSERVICE 默认域名** | 静态托管域名是系统内部域名，**不能手动建路由** |
| 7 | **规整逻辑与鉴权纯逻辑各抽一份共用** | `server/values.mjs` ＋ `server/auth-core.mjs` —— SQLite 与 PG **共用**，不会改一处忘另一处 |
| 8 | **鉴权层也纳入 `store.mjs` 分发** | 迁移时才发现 `server/auth.mjs` 直接用了 SQLite 专有的 `db.prepare()` |

### 4.3 搬数据结果

| 表 | 源库（SQLite） | 迁后（PG） |
|---|---|---|
| users / identities / sessions | 3 / 3 / 12 | 3 / 3 / 12 |
| patients / visits / medication | 29 / 113 / 1 | 29 / 113 / 1 |
| custom_symbols | 0 | 0 |

- `local` 账号在 PG 里**已存在**（单机模式的兜底账号）→ 复用它的 id，SQLite 那边那个不重复建，
  它的数据（「测试 1」）**重映射**到 PG 那个账号下（不重映射外键会指向不存在的 user）。
- **三条 owner 不变量自检全为 0**（迁移函数自报 ＋ 独立复核，两遍）。
- 用迁移过去的账号 `mptest01` 走**真实网关**登录 → 取患者列表 → 取患者详情，全通。
- 迁移函数 `pulse_migrate_import` 是**一次性的**（能绕过 owner 校验批量写表）→ 搬完已 `--drop-fn` 撤掉。

### 4.4 验收状态

| 项 | 结果 |
|---|---|
| 全量回归（SQLite 路径没破） | **498/498 全绿** |
| PG 存储层回归（对真库） | **49/49 全绿**（含「跨用户一律 404 不是 403」） |
| 网站静态托管 | 首页 200、JS/CSS 200 |
| 跨域 | CORS 预检 204 ＋ 正确 `allow-origin`；**真实浏览器**里跨域 `fetch /api/health` 200 |

### 4.5 踩过的坑（别重踩）

1. **MCP 的 PG 模块在本机不可用** —— `queryPgDatabase` / `managePgDatabase` 把**首次**的 PG 就绪探测结果
   缓存成**模块级 Promise**，首次失败后被**永久缓存**，之后所有调用直接抛同一个错、不会重新探测。
   绕法：`scripts/pg-admin.mjs`（临时凭证签名调 `tcb/ExecutePGSql` CAPI，SQL 从文件读）。
2. **`CREATE OR REPLACE FUNCTION` 不能改返回类型** → 建前先 DROP 同签名旧函数（已固化进 `pg-admin.mjs`）。
3. **postgREST 对标量返回／SQL NULL 不给 body** → 返回值统一 jsonb 对象包裹。
4. **云函数类型创建后不可改** → 先建了 HTTP 类型，删掉重建为 Event。
5. **静态托管域名不能手动建网关路由** → 改挂 HTTPSERVICE 默认域名。
6. **`ExecutePGSql` 不回传 `RETURNING` 的行** → 只看影响行数。
7. **PL/pgSQL 里 `record ->> 'k'` 不合法** → 循环变量声明成 `jsonb`。
8. **默认域名有「访问提示中间页」** —— 平台按合规要求对**浏览器直接访问**（`Sec-Fetch-Mode: navigate`）展示
   「风险提醒」页，点「确定访问」后写 cookie。**唯一合规的去除办法是配自定义域名（须 ICP 备案）**。
   API 的 fetch 请求不受影响。平台明说默认域名**只许开发测试**，流量异常可能触发风控关停。
9. **体验版套餐不能加安全域名**（「当前套餐无法执行此操作」）→ 靠服务端 CORS 头（已实测可用）。
10. **对着真库跑回归会攒测试账号** → `scripts/e2e/pg-store.mjs` 现在自清理（已清掉历史遗留的 12 个）。

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
| 当前分支 | `feat/wechat-miniprogram`（**小程序／鸿蒙／Windows 桌面端／CloudBase 线**） |
| 远端分支 | `main` = `a0f5c10`；`chore/multi-user` = `b9e3b19`；`chore/desktop-electron` = `8bc151f`；`feat/wechat-miniprogram` = `623aca8`（本线）；**`feat/web-site` = `e59b500`（网站端线，2026-11-06 从 `6ebc881` 切出）** |
| 分支纪律 | **两条长期开发线**（2026-11-06 起）：网站端新改动走 `feat/web-site`，小程序／鸿蒙／桌面端走 `feat/wechat-miniprogram`；同源于 `6ebc881`，都**不开 PR**、都**不改写已推送的历史**。详见 `AGENTS.md`「Git 约定」 |
| PR | #6 `chore/multi-user → main`，**OPEN**；#7 `chore/desktop-electron → chore/multi-user`，**OPEN**；`feat/wechat-miniprogram` **永不开 PR**（2026-11-06 拍板：**永不合并进 `main`**） |
| 全量回归 | **515/515 全绿**（core 26 ＋ taro-lint 202 ＋ taro-api 51 ＋ migration 53 ＋ auth 53 ＋ **app 28** ＋ 桌面端 33 ＋ 鸿蒙 69） |
| 小程序工程 | `pulse-record/taro/`（Taro 4.3.2 ＋ React 18）；**原生 `miniprogram/` 原样保留作回退** |
| 网站端 | `pulse-record/src/`（Vite ＋ React ＋ TS，单页 `App.tsx`）；③ 框内有**可折叠「用方知识库」**（p44 依脉用方全量 61 条 ＋ 讲稿方剂全量 30 方），③ 的方名**可点进去定位 ＋ 高亮**（详见 §3.17）；后端**仍跑本机 SQLite**（`local-data/history.sqlite`），**未接 CloudBase PG** |
| 小程序包体 | 媒体资源 **119.0 KB**（底图 JPEG 116.3 KB ＋ 8 个 tabbar 图标 ≤0.4 KB）；**微信「图片和音频 > 200 K」已通过**（详见 §3.12） |
| 模拟器回归 | `npm run test:e2e:mp:sim`（**55 项**：4 个 tab 逐页截图 ＋ **白屏判定** ＋ **包内底图运行时可读**）、`npm run test:e2e:mp:privacy`（**6 项**：隐私政策页）、`npm run test:e2e:mp:canvas`（**8 项**：**真微信 canvas 2d 出图端到端**）、`npm run test:e2e:mp:link`（**17 项**：③ 的方名 →「用方」页定位 ＋ 高亮 ＋ 锚点唯一 ＋ 真的滚过去了，详见 §3.16）；四个都会**自己先重启小程序**（bundle 是缓存的，不重启跑的是旧产物）。**2026-11-06 在 macOS 上实测四套全绿：55/55 ＋ 6/6 ＋ 8/8 ＋ 17/17 ＝ 86 项** |
| 上线前清单 | `pulse-record/docs/miniprogram-release-checklist.md`（隐私指引勾选项＋可复制文案、服务器域名、类目截图、审核退路对照表） |
| 本机库 | `pulse-record/local-data/history.sqlite`（已迁移到多用户结构：15 患者／57 就诊／1 自定义符号，归属归到 `local`；迁移前快照 `history.sqlite.bak-20261104102030`） |
| 桌面版产物 | `pulse-record/release/`（安装包 ＋ 免安装版，已 gitignore） |
| 桌面版数据 | 安装版 `%APPDATA%\臧氏脉学\`；**免安装版 exe 旁边的 `data\`** |
| CloudBase 环境 | `pulse-1-d0g880ydl8ddc57f6`（ap-shanghai，**体验版 `baas_trial`，到期 2027-05-06**）；PG `postgres-gi7xmyo4`（17.11）7 表 ＋ **35 个 `pulse_*` 函数**；云函数 `pulse-api`（Event）；静态托管已上线 |
| CloudBase 上的数据 | **3 账号**（`local` / `guoguo` / `mptest01`）＋ **29 患者／113 就诊／1 用药／0 自定义符号**（从本机 SQLite 搬的）；**三条 owner 不变量全 0** |
| 云端环境变量 | `PULSE_STORE=pg`、`PULSE_CB_ENV=…`、`PULSE_API_PREFIX=/pulse-api`、`PULSE_CORS_ORIGINS=https://…-1257312696.tcloudbaseapp.com`、`PULSE_WX_APPID=wx3a21eb903a16cbc4`、`PULSE_WX_APPSECRET=…`（**必须用 `PULSE_WX_*`，`WX_` 前缀会被平台盖掉**） |
| 本地 PG/云端工具 | `scripts/pg-admin.mjs`（`tcb/ExecutePGSql` CAPI，绕开 MCP 的 PG 缓存缺陷）、`scripts/cf-admin.mjs`（云函数环境变量，**密钥不进对话**）、`scripts/lib/tcb-capi.mjs`（TC3 签名，两者共用）、`scripts/migrate-sqlite-to-pg.mjs`（搬数据）、`scripts/build-cloudfunction.mjs`（打包云函数）、`scripts/e2e/pg-store.mjs`（对真库回归 49 项） |
| 鸿蒙工程 | `pulse-record/harmony/`（DevEco 工程真源，27 个文件）；镜像目录 `~/AiCoding/harmony-pulse-record`（纯 ASCII，不入库）；HAP `entry/build/default/outputs/default/default-default-unsigned.hap`（9.1 MB） |

> ✅ 本机库**已完成迁移**（幂等，迁移前自动留 `.bak-<ts>` 备份）：补上 `owner_id`、
> 回填归属到 `local`、建立 `local` 账号 —— 15 患者／57 就诊／1 自定义符号一个没丢。
> 桌面版「导入数据文件」也支持老结构（缺的列自动跳过），**两条路都能把老数据带进桌面版**。

---

## 7. 待用户办的事（按关键路径排序）

| 优先级 | 事项 | 为什么急 |
|---|---|---|
| 🔴 1 | **域名注册 → 个人实名 → 提交 ICP 备案** | 7~20 工作日，是整条时间线最长的一段；不今天提交，后面小程序、CloudBase 全在等。**且自定义域名是 CloudBase 默认域名的唯一出路**（默认域名只许开发测试，有「风险提醒中间页」，流量异常还可能被风控关停） |
| ✅ 1b | ~~**微信侧把 CloudBase 环境关联到小程序 appid**~~ | ✅ **已完成并实测跑通** —— 账号级关联 11-06 就做完了（`UserInfo.WxAppId = wx3a21eb903a16cbc4`）；2026-11-07 在**真实微信运行时**里 `wx.cloud.callFunction` → **200**（`db: CloudBase PostgreSQL`），「我的」页「传输方式」＝**云函数（callFunction）**。详见 §3.19 |
| 🔴 2 | ~~**后台声明《用户隐私保护指引》两项隐私类型**~~ | ✅ **2026-11-05 已不需要** —— 小程序不提供导出，隐私接口降到 **0 个**，后台**一项都不用勾**（详见 §3.11）。剩下要填的只有「用户信息收集」那一栏（用户输入内容／账号信息，见上线清单 §1.3） |
| 🔴 2c | **填运营者主体与联系邮箱** | 隐私政策**第八**节现在是占位文字（`运营者：（待填写）`），审核会看 |
| 🟡 2d | **原生回退工程（`miniprogram/`）怎么处置 —— 冻结还是退役** | 维护者已说「后面不打算做了」。本轮**一字未动**它（改动全在 Taro 版），所以它仍带着两个显示缺陷（表头竖线逐列错开、表下「体质」标签错行），而且功能落后 Taro 版很多（没有「一次一屏」、没有四档工作台）。**它现在其实算不上一个可靠的回退** —— 冻结＝接受这个状态并在文档里写明；退役＝删 `miniprogram/` ＋ `scripts/e2e/mp-*.mjs` ＋ `package.json` 里三个 `test:e2e:mp:legacy*` script。详见 §3.20 ⑥ |
| 🟡 2b | 注册微信小程序（个人主体）→ 填真实 AppID | ✅ 已完成（`wx3a21eb903a16cbc4`）；开发者工具需登录对应管理员微信号才能预览／上传 |
| 🟡 3 | **买境内轻量服务器（2 核 4G）** | 备案通过后要立刻部署。**注意：迁 CloudBase 后网站已经能跑在静态托管上，服务器是否还要买，取决于「用自己的域名」还是「用 CloudBase 默认域名」** |
| 🟡 3b | **真机跑一遍新界面**（备案前先用局域网 IP） | 寸关尺关系图「直接显示在页面上、点图可放大」—— 模拟器已验，**真机还没验**（详见 §3.11）。用户已说本轮不做真机验证 |
| 🟡 3c | **上传前在开发者工具里重扫一次「代码质量」** | 两条已修（`minified` 已开 ＋ 底图 298 KB → 116.3 KB），但**以工具实际扫描结果为准** —— 扫完确认这两条变成「通过」再传（详见 §3.12） |
| 🟡 4 | **桌面版装到自己的电脑上试一遍** | 已出包（`release/*.exe`），试过再决定要不要换签名证书 |
| 🟡 4b | **鸿蒙：DevEco 里下模拟器镜像 → 打开镜像目录 Run** | HAP 已出（9.1 MB unsigned），但**没跑起来过** —— 本机没有模拟器镜像、也没有 hdc。镜像下好后工程路径已是纯 ASCII，直接 Run 就能验四个 tab（详见 §3.15） |
| ⚪ 5 | AGENTS.md「下游用途」空位 | 由维护者自行填写一行 |
| ⚪ 6 | 代码签名证书（可选） | 只影响安装时的 SmartScreen 提示，不影响功能 |
| ⚪ 7 | **CloudBase 套餐升级**（体验版 → 个人版） | 体验版**不能配安全域名**、到期 2027-05-06；升级后才能加安全域名白名单（当前靠服务端 CORS 头，已实测可用） |

---

## 8. 维护约定

- **什么时候更新本文**：① 某条工作线状态变化（完成／被阻塞／方案变更）② 关键决策拍板 ③ 阻塞项清单变动 → 改完连同相关代码/文档一起提交。
- **提交前缀**：沿用 `AGENTS.md`「Git 约定」—— `docs:` 资料整理／笔记 ｜ `data:` 新增或更新原始资料 ｜ `chore:` 工具与配置 ｜ `ocr:` 识别文本落盘；**代码与文档分开提交**。
- **分支纪律**：**两条长期开发线**（2026-11-06 起）—— `feat/wechat-miniprogram`（小程序／鸿蒙／Windows 桌面端、多用户与 CloudBase 迁移）与 **`feat/web-site`（网站端 `pulse-record/src/`）**，两者同源于 `6ebc881`。**网站端的新改动一律走 `feat/web-site`**；小程序分支上已有的内容**原样保留，不改写它的历史**。仍然**不直推 `main`**、都**不开 PR**。详见 `AGENTS.md`「Git 约定」。
- ⭐ **小程序线永不合并进 `main`（2026-11-06 维护者拍板）**：微信端、鸿蒙端、Windows 桌面端、多用户与 CloudBase 迁移**全部永久留在 `feat/wechat-miniprogram`**。**不向 `main` 合并、不向 `main` 开 PR** —— 这条比「上线之前集中开发」更强，不是「上线前不合」而是**不合**。`main` 保持为原始资料库 ＋ 已合入的稳定工具。
- **PR 状态**：#6（`chore/multi-user → main`）、#7（`chore/desktop-electron → chore/multi-user`）**保持 OPEN、既不合也不关**；它们都已是 `feat/wechat-miniprogram` 的祖先，合进去就等于把小程序线合进 `main`。**「以后要不要并回 `main`」这个问题已关闭**，不必再问、也不必准备合并方案。日常推远端就在 `feat/wechat-miniprogram` 上提交并 `git push` 到同名远端分支，**不需要开 PR**。
- **表格优先**：状态一律用表格写，行尾标注实测日期，别写「大概」「应该」。
