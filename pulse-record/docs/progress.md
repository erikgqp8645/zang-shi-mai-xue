# 项目进度 —— 臧氏脉学 · 脉象记录表生成器

> **更新于** 2026-11-11 ｜ **仓库** `erikgqp8645/zang-shi-mai-xue` ｜ **当前分支** `feat/web-site`（网站端线；基点 `6ebc881`，与小程序线同源）｜ 小程序线见 `feat/wechat-miniprogram`
>
> 本文是**进度台账**：记每条工作线做到哪了、卡在哪、下一手做什么。
> 桌面应用的**实施方案**另见 [`desktop-plan.md`](./desktop-plan.md)；上线手册见 [`deploy.md`](./deploy.md)；迁 CloudBase 见 [`cloudbase-migration.md`](./cloudbase-migration.md)；小程序 Taro 迁移约定见 [`taro-migration.md`](./taro-migration.md)。

---

## 0. 一张表看全局

| 工作线 | 状态 | 关键结论 | 下一步 |
|---|---|---|---|
| **P0 多用户与数据隔离** | ✅ 已完成 | `users`＋`identities`＋`sessions` 三表；四张业务表下沉 `owner_id`；跨用户一律 404 | 随 `feat/wechat-miniprogram` 走，**不单独合进 `main`** |
| **P1 网站上线** | ⏸ **卡在用户侧手续** | 脚本与文档已就绪，**域名／ICP 备案／服务器三样都没有** | 备案 7~20 工作日是整条时间线最长的一段 → **今天就去提交备案** |
| **P2 微信小程序** | 🟡 **已迁 Taro ＋ 界面重排完成**；模拟器逐页截图已验，未真机验证 | 8 个平级页面 → **4 个 tab（病例／就诊／用方／我的）**，「就诊」是工作台页（吸顶上下文条 ＋ **4 个页内 tab（摸脉／体质／疗法／方药）** ＋ 底部操作条）；Taro 4.3.2 ＋ React 18，与网站**共用同一份 domain 源码**；鸿蒙 C-API 编译已通；**寸关尺关系图直接显示在页面上**（不提供导出 → 隐私接口 0 个）；微信「代码质量」两条已修（JS 压缩已开、图片 298 KB → 116.3 KB）；回归 **515 项全绿**（含网站端浏览器回归 28 项）；**前端界面与网站各写一套**（2026-11-11 定，见 `taro-migration.md` §0.1，只共用 `domain`／`export` 逻辑层） | 真机跑一遍（备案前先用局域网 IP） |
| **P3 后期迁 CloudBase** | 🟡 **云端已建成**（开发／试用环境） | 环境 `pulse-1-d0g880ydl8ddc57f6`（ap-shanghai 体验版，到期 2027-05-06）：PG 8 表 ＋ **38 个 `pulse_*` 函数**、云函数 `pulse-api`（**Event 类型**）、网关 `/pulse-api`、静态托管已开通；网站与小程序**同一套路由**（`handleApi`）；数据已从本机 SQLite 搬过去（29 患者／113 就诊／1 用药），**三条 owner 不变量全 0** | ① **微信后台把环境关联到小程序 appid**（`WxAppId` 还是空）② 换自定义域名（默认域名只许开发测试，有「风险提醒中间页」）③ 备案 |
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

### 3.18 数据搬进可编辑层 —— JSON 为真源，Excel 为人工编辑层（2026-11-07）

**用户的要求**：「json 非常好，但是不利于我编辑，你需要想一个中间格式，比如 excel 格式。
第一轮你先编辑，然后我审核修改，最后成型」＋「后续你可以用这个 excel 随便转换为你需要的任何格式」。

#### 为什么中间格式是 Excel 而不是别的

先做了一轮**三链实测**（Vite 8 / `tsc`→CJS 共享包 / Node `require`），结论是**纯 JSON** 是唯一三链通吃的格式：

| 方案 | Vite 8 | `tsc` → CJS | Node `require('*.json')` | 结论 |
|---|---|---|---|---|
| **纯 JSON** | ✅ | ✅ 自动拷进产物 | ✅ | **通吃** |
| JSONC（带注释） | ❌ 内部是裸 `JSON.parse` | ⚠️ 编译过 | ❌ `Expected property name` | 出局 |
| YAML / TOML | ❌ 要自己加 loader | ❌ | ❌ | 出局 |

所以分工是：**JSON 当真源**（机器消费），**Excel 当人工编辑层**（人改），脚本单向/双向转换。

#### 搬走了什么

TS 源码里的数据字面量 **1936 行** → `src/content/*.json` **7 个文件**：

| 文件 | 内容 | 条数 |
|---|---|---|
| `drugs.json` | 讲稿 2010 方剂 | 30 |
| `doses.json` | 同和堂版成方（克）＋ 科中 ＋ 成方↔科中对照 | 49 ＋ 17 ＋ 15 |
| `formula-reference.json` | 讲义 p42 表 ＋ 别名 ＋ 草稿方 | 28 ＋ 15 ＋ 1 |
| `formula-rules.json` | 用方条目（条件文字／治法／方剂／出处） | 61 |
| `pulse-terms.json` | 原文用字 → 符号集 | 18 |
| `pulse-groups.json` | 脉位组合 | 7 |
| `pulse-patterns.json` | 脉象图 | 50 |

`src/domain/*.ts` 现在**只留逻辑**：`evaluate`（判定）、查表、视图组装。

#### Excel 的摊平规则（`scripts/excel_schema.py` 是唯一真源）

① **数组用单元格内换行分隔** —— 讲稿方名自带顿号（「柴鳖骨（柴胡、鳖甲、地骨皮）」），
   用顿号分隔必然切错；
② **嵌套拆成带外键的多张表**，靠「父 id ＋ 序号」关联；「且／或」由「组号」表达
   （组号留空＝合成一组；1/2/3＝第几个且组，组内且、组间或）；
③ **原文 JSON 是稀疏的**（讲稿没写的字段根本没有键）→ 列上标 `omit_empty`，
   空值不产出该键，往返后键集完全一致；
④ **符号集用逗号分隔** —— 符号集里没有逗号。

工作簿 `content/臧氏脉学-用方知识库.xlsx` 共 **13 张表**，
第一张是「说明」表（每张表的列说明与编辑约定）。

#### 两个测试把住这条链路

- `scripts/e2e/excel_roundtrip.py`（**14 项**）：断言「JSON → Excel → JSON」**逐字段一致**；
- `scripts/e2e/excel_roundtrip_break.py`（**14 项**）：注入 6 类坏数据
  （主键为空／主键重复／父 id 悬空／用字未定义／组号非正整数／同一关系前后用语不一致），
  断言还原脚本**必须报错** —— 证明它不是无脑接受一切。

两者都挂在 `npm test` 里。**往返还不是一次过的**：第一版就抓出 5 类真问题
（`notes`／`draftNote` 两列漏了、键序被打乱、稀疏字段被补成空串、
pattern 多了个 `id` 键、**关系的多 probe 静默丢了 3 个**）。
最后一个最险：摊平成「只有第一行填探针、其余留空」后，
读回无法区分「第 2 个探针」与「续行」—— 改成**每行一个 probe**才无歧义。

#### 顺带修掉的坑

- `Object.fromEntries` 是 **ES2019**，本项目编译目标是 ES2017 —— 老机型会白屏。
  `core-smoke.mjs` 的**既有断言**抓到了（它专门盯这条），改成 ES2017 写法。
- 微信小程序的 `require` **不吃 `.json`** → `build-core.mjs` 增加一步：
  把 `content/*.json` 转成同名 `.js` 的 CJS 模块，并把 require 的 `.json` 后缀改指 `.js`。
- `PULSE_GROUPS`、`FORMULA_ALIAS` 等也是照抄原文的数据，一并搬进 JSON，
  免得「数据分两处住」。

#### 待办

⏳ **首轮工作簿已产出，等用户审核修改**（用户原话：「第一轮你先编辑，然后我审核修改，最后成型」）。
用户改完跑 `npm run content:json` 转回 JSON。

⏳ **脉象图渲染器还没做** —— `pattern` 数据已就位（50 条），
但 `PulsePatternTable` 组件、`.pr-ptable*` 样式、接入 `Findings.tsx` 的 `FormulaItem`
与 `FormulaLibrary.tsx` 的 `libraryRule()` 都没写。**这部分是本轮的后续**。

### 3.19 脉象图改矩阵体例 ＋ Excel 写清「怎么填」（2026-11-10）

**用户对已交付工作簿的两条反馈**：

> ① 「这一页是什么意思，excel 应该有说明如何填写」
> ② 「excel 脉可以分为左右两列其中有九行，分别代表寸关尺，这样比较直观，也和之前图片对得上」

两条都指向同一个问题：**上一版的工作簿是「给机器看的表」，不是「给人填的表」**。

#### ① 符号含义：从「只有代码」到「看得懂」

原来的「脉象用字」表只有符号代码（`0` `-` `+` `±` `++` …），审核者看不出 `++` 是「有力」。

- 新增 **`src/content/symbols.json`**（14 个固定符号，讲义 p34），落成工作簿里的**「符号表」**sheet；
- 「脉象用字」表加一列 **「符号含义」**（`0＝无；-＝弱；++＝有力`）——
  由符号表自动算出来，**不用手填**，改符号集时会跟着重算；
- ⭐ **顺带消除一处真源重复**：`src/domain/symbols.ts` 原来**硬编码**了同一份 14 个符号，
  改成 `import SYMBOL_DATA from '../content/symbols.json'`；
  `COMMON_GROUPS` 的代码列表也改成从 `SYMBOLS` 里挑，不再另列一份字面量。

#### ② 脉象图：长表 → 矩阵（讲义 p34 体例）

**体例照讲义 2026-10 p34 的记录表**：左列部位／取法，右边左手、右手两列，
9 行（寸浮／寸中／寸沉／关浮／关中／关沉／尺浮／尺中／尺沉）。

- **每条用方条目一张 sheet**（`P01-` … `P50-`），sheet 名里带条目 ID；
- 工作簿从 14 张表变成 **65 个 sheet**（15 通用表 ＋ 50 矩阵）；
- 矩阵里多出几列支撑「且／或」与柔性：**左组号／右组号／左格备注／右格备注／左柔性／右柔性**；
- 已填的格染橙色（`FFE0B2`），一眼看出哪些格有要求；部位列三个部位各合并 3 行
  （与讲义 p34「部位合并、组内不画横线」一致）。

⭐ **矩阵是脉象图的唯一编辑面**；「脉象图·格位」长表由它**派生**，不参与读回。
两边都写就有两处真源 —— 铁律：「能合成一个来源的，绝不留在两处」。

#### 矩阵的三个技术决定

1. **sheet 名的序号是权威的** —— 条目 ID 最长 35 字符，Excel sheet 名上限 31 会截断，
   两个 ID 会被截成同一个前缀。所以读回时**按序号定位条目**，
   表头区的「条目ID」只用来**校验**（与序号对不上就报错，防张冠李戴）。
2. **组与组的顺序按「组号」排**，不按首次出现排 —— 矩阵是逐行扫描的，
   若第 2 组先被扫到，按首次出现排序就会把「组 2」当成「组 1」，组间「或」的语义就串了。
3. **格位顺序规范化** —— 原 JSON 里 `cells` 的顺序**没有规则**（有的手优先、有的按原文列举），
   而矩阵是固定版面、派生不出原文列举顺序。
   顺序无语义（cells 是集合、组内是「且」、组间是「或」），
   所以定一份规范：**左手 9 行读完，再右手 9 行**；3 条源 JSON 据此重排。

#### 「说明」表重写

原来只有 14 行干巴巴的列说明。现在：

- 首行讲清**整体流程**（改 Excel → `npm run content:json` → `npm test`）与四条通用纪律；
- 每张表补**怎么填**（不是「这列是什么」）；
- 矩阵单独一节，写清**格子里填用字不是符号代码**、**组号同号＝且／异号＝或**、
  **柔性 TRUE 的含义**、**关系型要求写哪**、**sheet 序号不要改**；
- 矩阵 sheet 顶部再放一行提示 —— 用户多半是直接翻到某个 `P01-` 的，看不到「说明」表。

#### 这一轮踩的坑（都已修）

| 坑 | 症状 | 修法 |
|---|---|---|
| 写端列序与列头不一致 | 写端按「左手四列块 ＋ 右手四列块」，列头却是「左手｜右手」交错 → 读回时组号被当成用字 | 写端改成左右交错（与 `MATRIX_COLS` 一一对应） |
| 「部位」列头行找不到 | 搜索范围只有 3 行，实际在第 7 行 | 放宽到 `header_row + 12` |
| 合并单元格取不到「部位」 | 部位列是合并单元格，只有首行有值 | 按行**上溯**取当前部位 |
| 组序被首次出现顺序打乱 | 见上「三个技术决定」② | 按组号排序 |
| 断言几乎恒真 | 「矩阵序号连续」放在还原之后，还原先失败就短路 → 断言永远不失败 | **挪到还原之前**；并用「故意写坏」验证过确实能抓到 |

#### 两个测试（都挂在 `npm test` 里）

- `scripts/e2e/excel_roundtrip.py`（**20 项**，原 14 项）：加「矩阵 sheet 50 个、序号 1..50 连续」、
  「磁盘 JSON 的格位顺序＝矩阵派生序」、**「清空派生长表后还原结果不变」**（证明矩阵是唯一编辑面）；
- `scripts/e2e/excel_roundtrip_break.py`（**22 项**，原 14 项）：坏数据从 6 类扩到 **9 类** ——
  新增「矩阵用字未定义」「矩阵组号非正整数」「矩阵表头 ID 与序号不符」「矩阵漏 sheet」「矩阵改名序号重复」，
  注入点**按结构定位**（找列头行、找第一个有值的格），不硬编码行号。

⭐ 新增／修改的断言**都用「故意写坏」验证过能抓到**：
打乱磁盘 JSON 顺序 → ⑥ 抓；把矩阵序号改成跳号 → ② 抓；清空派生长表 → ⑦ 抓。

#### 全量回归

**537 项全绿**（core 26 ＋ **excel 20 ＋ excel-break 22** ＋ taro-lint 202 ＋ taro-api 53 ＋
migration 51 ＋ auth 28 ＋ app 33 ＋ 桌面端 33 ＋ 鸿蒙 69）；
网站端 `npm run build` 通过；`tsc --noEmit` 无错。

#### 补：每列挂 Excel 批注（2026-11-10 追加）

上一轮把「怎么填」写进了「说明」表和矩阵顶部，但**翻表时看不到** ——
审核者在某张表里想改一个格子，还得跳去「说明」表找对应那一行。

Excel 自带批注（comment），**悬停列头即显**，不用离开当前表：

- 通用表的每个列头挂批注 ＝ 该列说明 ＋ 填写格式 ＋ 留空语义；
- 矩阵 sheet 的 10 个列头同样挂；
- 「说明」表自己的列头也挂（指路：各表批注与本表同源）。

⭐ 批注内容与「说明」表的列说明**同一来源**（`ColDef.note`），不另写一份。

**批注暴露并修掉的三处问题**：

| 问题 | 修法 |
|---|---|
| 「符号含义」列带「留空＝原文没写」—— 但它是**算出来的**，不对应原文字段，误导 | `ColDef` 增设 `derived` 字段；派生列改说「【只读】算出来的，转回 JSON 时不参与还原」 |
| 矩阵的部位／取法列没说只读 | 补「三个部位各合并三行，不要改」 |
| 矩阵右侧列批注是空的（「右格备注」「右柔性」） | 右侧列补齐与左侧对称的说明 |

#### 待办

⏳ **工作簿已重新产出，等用户审核修改**（用户原话：「第一轮你先编辑，然后我审核修改，最后成型」）。
用户改完跑 `npm run content:json` 转回 JSON。

⏳ **脉象图渲染器还没做** —— 数据侧已就位（50 条 ＋ 矩阵体例），
但 `PulsePatternTable` 组件、`.pr-ptable*` 样式、接入 `Findings.tsx` 的 `FormulaItem`
与 `FormulaLibrary.tsx` 的 `libraryRule()` 都没写。
⭐ 渲染时**直接照矩阵体例画**（左列部位／取法 ＋ 左右两列 ＋ 9 行），
与讲义 p34 的图对得上；不变量断言脚本 `scripts/e2e/pulse-pattern.mjs` 也要跟着矩阵体例写。

### 3.20 教程 ＋ 练习册 —— 教人怎么填这表（2026-11-10）

**用户的要求**：「写一个教程，和创建一个示例告诉我如何填写这个表格。」

上一轮把工作簿改成了「给人填的表」（矩阵体例 ＋ 符号含义 ＋ 列头批注），
但**没人教过怎么填** —— 用户拿到表还是不知道从哪儿下手。

#### 交付物

| 文件 | 是什么 |
|---|---|
| `docs/教程-如何填写用方知识库.md` | **教程**（约 330 行）：三件先弄清的事 → 五分钟上手 → 认识 65 个 sheet → 符号速查 → **分表填写细则**（11 张表逐列）→ **三个完整例子**（从原文到格子）→ 常见报错对照 → 练手 → 纪律 → 卡住了怎么办 |
| `content/示例-填写示范.xlsx` | **练习册**：主工作簿的副本，**5 格故意留空并标黄**，每格批注写明「填什么 ＋ 依据哪句原文」；另加一张「填写示范」sheet 逐步骤说明 |
| `scripts/make_exercise_workbook.py` | 生成练习册（可复现 —— 不手改二进制） |
| `scripts/exercise_points.py` | **练习点定义** —— 生成脚本与验收脚本共用同一份 |
| `scripts/e2e/excel_exercise.py` | 练习册**验收**：逐格报「期望 X ／ 现在 Y」 |
| `scripts/e2e/excel_exercise_roundtrip.py` | 练习册自身的回归（13 项，挂在 `npm test`） |

#### 为什么示例做成「留空」而不是「填好给你看」

填好的样子只能看，留空的格子才能**练**；而且填完能自动验收，
知道自己到底学会了没有 —— 只看一遍说明表是学不会填格的。

5 个练习点覆盖 5 种典型编辑，每一格都有**可核对的原文依据**：

| # | 位置 | 练什么 | 依据 |
|---|---|---|---|
| E1 | 方剂·讲稿2010 · `zuocun-fuda-tianwang` · 「加减」 | 一格多条，一条一行 | 讲稿 2010·第二讲（六）「加减。尺脉没有力量的，记住要加干姜0.3g；尺脉有力的，黄芪易防风0.3g。」 |
| E2 | 成方·同和堂版 · `th-1` · 「组成（克）」 | 同和堂版用克 | 同和堂版 p1「1号上焦方」 |
| E3 | 矩阵 P04 · 关浮 · 「左手」 | 填**用字**不是符号代码 | 讲义 p44／讲稿第五讲 |
| E4 | 矩阵 P04 · 寸浮 · 「左组号」 | 同号＝且、异号＝或 | 讲义 p44 |
| E5 | 脉象图·关系 · 「探针符号」 | 逗号分隔；每行各填自己的 | 讲义 p44／讲稿第五讲 |

#### 三个设计决定

1. ⭐ **正确答案不写死**，而是从真源 `src/content/*.json` 现取
   （`expected_value()`）—— 练习册不会和真源脱节，
   验收也不会「按错误的答案判对错」。
2. ⭐ **误操作防护**：文件名含「示例／练习／示范」的工作簿，
   `excel_to_json.py` **拒绝写回真源** —— 里面有故意留空的格子，
   写回去等于把内容真丢了。报错直接指路到验收脚本。
3. ⭐ **验收要说清「差在哪儿」**：不止报「填错了」，
   而是给出 `位置：P04-fx-ssx-qingdanglu 第 12 行 ／ 期望：大 ／ 现在：++`。

#### 顺带做的两件事

- **抽出 `excel_to_json.restore()`** —— 原来还原逻辑埋在 `main()` 里，
  验收脚本要用只能 subprocess 调。现在是可 import 的函数，
  还返回 `coords`（格位坐标：pid → cellKey → (sheet, 行, 列)），
  验收脚本靠它把差异指到具体格子。
- **把 `exercise_points.py` 做成单一真源** —— 生成脚本与验收脚本共用，
  不然「练习册里的答案」和「验收时的答案」会变成两处。

#### 这一轮踩的坑

| 坑 | 症状 | 修法 |
|---|---|---|
| 重构切错位置 | 把 `main()` 的后半截截断了，`restore()` 插到了 main 中间 | 从 git 恢复重做：函数定义放文件末尾 |
| 缩进多一级 | 函数体 8 格（函数体应 4 格） | 批量去 4 格 |
| `main()` 结尾块误留在别的函数里 | EXIT 打印了 3 次、退出码是 0 | 结尾块搬回 `main()` |
| `drugs.json` 顶层是 **list** | 按 dict 取值炸了 | `_dig()` 遇 list 按 `id` 找 |
| 列头名对不上 | 同和堂版的列头是「组成（**克**）」不是「组成」 | 练习点用真实列头 |

#### 验证

- 全量 **550 项全绿**（core 26 ＋ excel 20 ＋ excel-break 22 ＋ **exercise 13**
  ＋ taro-lint 202 ＋ taro-api 53 ＋ migration 51 ＋ auth 28 ＋ app 33 ＋ 桌面端 33 ＋ 鸿蒙 69）
- ⭐ 验收脚本**双向有效性**已验证：填对 → 14 项全过（EXIT=0）；
  填错（E3 填成符号代码 `++`）→ 精确抓到并 EXIT=1
- 误操作防护已验证：对练习册跑 `content:json` 被拒，且**真源 JSON 一个字节没变**
- `npm run content:check` 通过（工作簿与 JSON 完全一致）

#### 待办

⏳ **练习册与教程已产出，等用户使用** —— 填完用
`npm run content:exercise:check` 验收。

⏳ **脉象图渲染器还没做** —— 数据侧已就位（50 条 ＋ 矩阵体例），
但 `PulsePatternTable` 组件、`.pr-ptable*` 样式、接入 `Findings.tsx` 与
`FormulaLibrary.tsx` 都没写。渲染时**直接照矩阵体例画**（左列部位／取法 ＋ 左右两列 ＋ 9 行），
与讲义 p34 的图对得上。

## 4. P3 · 迁 CloudBase（🟡 云端已建成，开发／试用环境）

**目标**：网站跑静态托管、API 跑云函数、数据存 **PostgreSQL**、小程序走 `wx.cloud.callFunction`（不走合法域名校验）。

**2026-11-06 实测：已经搬完了**（原先记的是「规划完成，待触发」）。
细节全文见 [`cloudbase-migration.md`](./cloudbase-migration.md)（已改成「已建成」版）。

### 4.1 实际架构

| 件 | 落点 |
|---|---|
| 网站 | CloudBase **静态托管** `https://ambitious-parrot-d7ehh7x0fd9d680-1257312696.tcloudbaseapp.com` |
| API | CloudBase **云函数 `pulse-api`**（**Event 类型**，Nodejs20.19，`index.main`）→ 网关 `…ap-shanghai.app.tcloudbase.com/pulse-api` |
| 数据 | CloudBase **PostgreSQL** `postgres-l00fh7pm`（17.11）—— 7 张表 ＋ **35 个 `pulse_*` 函数** |

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

## 6. 当前仓库状态（2026-11-12 实测）

| 项 | 值 |
|---|---|
| 当前分支 | `feat/web-site`（**网站端线**，基点 `6ebc881`） |
| 远端分支 | `main` = `a0f5c10`；`chore/multi-user` = `b9e3b19`；`chore/desktop-electron` = `8bc151f`；`feat/wechat-miniprogram` = `623aca8`（小程序／鸿蒙／桌面端／CloudBase 线，**历史原样保留**）；**`feat/web-site` = `845b339`（网站端线，2026-11-06 从 `6ebc881` 切出）** |
| 分支纪律 | **两条长期开发线**（2026-11-06 起）：网站端新改动走 `feat/web-site`，小程序／鸿蒙／桌面端走 `feat/wechat-miniprogram`；同源于 `6ebc881`，都**不开 PR**、都不**改写已推送的历史**。详见 `AGENTS.md`「Git 约定」 |
| PR | #6 `chore/multi-user → main`，**OPEN**；#7 `chore/desktop-electron → chore/multi-user`，**OPEN**；`feat/wechat-miniprogram` **永不开 PR**（2026-11-06 拍板：**永不合并进 `main`**） |
| 全量回归 | **840 项全绿**（core 40 ＋ excel 27 ＋ excel-break 28 ＋ exercise 13 ＋ taro-lint 202 ＋ taro-api 58 ＋ migration 53 ＋ auth 57 ＋ app 32 ＋ 桌面端 33 ＋ content 17 ＋ **后台核对 146（新增）** ＋ library-admin 52 ＋ rule-delete-loader 13 ＋ 鸿蒙 69）。后台那 146 项需要本地 Directus 容器在跑，**没起时明确打印「跳过」并 exit 0**（`PULSE_E2E_REQUIRE=1` 时缺容器才 exit 1 —— 跳过必须能区分于通过） |
| 教程与练习册 | **`docs/教程-如何填写用方知识库.md`**（面向审核者：分表细则 ＋ 三个完整例子 ＋ 报错对照）；**`content/示例-填写示范.xlsx`**（练习册：5 格故意留空 ＋ 标黄 ＋ 批注）＋ `npm run content:exercise:check` 逐格验收。练习册的正确答案**从真源现取**，不写死；文件名含「示例／练习／示范」的工作簿**拒绝写回真源**（详见 §3.20） |
| 数据层 | **JSON 为唯一真源**（`src/content/*.json` **8 个文件**，新增 `symbols.json`）；**Excel 为人工编辑层**（`content/臧氏脉学-用方知识库.xlsx`，**65 个 sheet** ＝ 15 通用表 ＋ **50 张脉象图矩阵**）；TS 只留逻辑。**矩阵是脉象图的唯一编辑面**，长表由它派生。往返 20 项 ＋ 故意写坏 22 项都挂在 `npm test`。用法见 [`content-layer.md`](./content-layer.md)（详见 §3.18／§3.19） |
| 内容层（新版 · 进行中） | **本地 `local-data/content.sqlite` ＝ 编辑真源**（17 张表 1472 行，Directus 后台可编辑）→ 发布命令 → 远端 PG `content` schema ＋ 仓库 `src/content/*.json` 快照。**M0～M3 已完成**（选型／落库／远端通路／发布命令），**M4（Excel 退役）起未做**。⭐ 2026-11-12 补完后台人眼确认：**抓出并修掉一个让「被引用方整张表点不开」的 500**（Directus 的 `meta.one_field` 反向 o2m 误判）。⭐ 同日**统一了断言编号**（计划 §10.2 的 A1~A19 为准，计划外续 A20+）＋ **后台补三项配置**（枚举下拉／必填／只读）＋ 补上「一个格位只能属于一个组」这条真实缺口。编号对照表见 [`content-assertions.md`](./content-assertions.md)，详见 §3.26／§3.27 与 [`content-admin-选型.md`](./content-admin-选型.md) |
| 小程序工程 | `pulse-record/taro/`（Taro 4.3.2 ＋ React 18）；**原生 `miniprogram/` 原样保留作回退** |
| 网站端 | `pulse-record/src/`（Vite ＋ React ＋ TS，单页 `App.tsx`）；③ 框内有**可折叠「用方知识库」**（p44 依脉用方全量 61 条 ＋ 讲稿方剂全量 30 方），③ 的方名**可点进去定位 ＋ 高亮**（详见 §3.17）；后端**仍跑本机 SQLite**（`local-data/history.sqlite`），**未接 CloudBase PG** |
| 小程序包体 | 媒体资源 **119.0 KB**（底图 JPEG 116.3 KB ＋ 8 个 tabbar 图标 ≤0.4 KB）；**微信「图片和音频 > 200 K」已通过**（详见 §3.12） |
| 模拟器回归 | `npm run test:e2e:mp:sim`（**55 项**：4 个 tab 逐页截图 ＋ **白屏判定** ＋ **包内底图运行时可读**）、`npm run test:e2e:mp:privacy`（**6 项**：隐私政策页）、`npm run test:e2e:mp:canvas`（**8 项**：**真微信 canvas 2d 出图端到端**）、`npm run test:e2e:mp:link`（**17 项**：③ 的方名 →「用方」页定位 ＋ 高亮 ＋ 锚点唯一 ＋ 真的滚过去了，详见 §3.16）；四个都会**自己先重启小程序**（bundle 是缓存的，不重启跑的是旧产物）。**2026-11-06 在 macOS 上实测四套全绿：55/55 ＋ 6/6 ＋ 8/8 ＋ 17/17 ＝ 86 项** |
| 上线前清单 | `pulse-record/docs/miniprogram-release-checklist.md`（隐私指引勾选项＋可复制文案、服务器域名、类目截图、审核退路对照表） |
| 本机库 | `pulse-record/local-data/history.sqlite`（已迁移到多用户结构：15 患者／57 就诊／1 自定义符号，归属归到 `local`；迁移前快照 `history.sqlite.bak-20261104102030`） |
| 桌面版产物 | `pulse-record/release/`（安装包 ＋ 免安装版，已 gitignore） |
| 桌面版数据 | 安装版 `%APPDATA%\臧氏脉学\`；**免安装版 exe 旁边的 `data\`** |
| CloudBase 环境 | `pulse-1-d0g880ydl8ddc57f6`（ap-shanghai，**体验版 `baas_trial`，到期 2027-05-06**）；PG `postgres-gi7xmyo4`（17.11）8 表 ＋ **38 个 `pulse_*` 函数**；云函数 `pulse-api`（Event）；静态托管已开通（仅平台默认文件）。**另有内容层**：`content` schema 17 张数据表 ＋ `content_meta` schema 3 张账本表 ＋ 6 个 `content_*` 函数（详见 §3.25） |
| CloudBase 上的数据 | **3 账号**（`local` / `guoguo` / `mptest01`）＋ **29 患者／113 就诊／1 用药／0 自定义符号**（从本机 SQLite 搬的）；**三条 owner 不变量全 0** |
| 云端环境变量 | `PULSE_STORE=pg`、`PULSE_SINGLE_USER=0`、`PULSE_API_PREFIX=/pulse-api`、`PULSE_CORS_ORIGINS=…`、`PULSE_WX_APPID=wx3a21eb903a16cbc4`、`PULSE_WX_APPSECRET=…`（**必须用 `PULSE_WX_*`，`WX_` 前缀会被平台盖掉**）；写变量用 `scripts/cf-admin.mjs`，**别用 `tcb config update`**（它会把键名大小写改坏） |
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
| 🔴 1b | **微信侧把 CloudBase 环境关联到小程序 appid** | 环境 `ambitious-parrot-d7ehh7x0fd9d680` 的 `WxAppId` **还是空** → 小程序的 `wx.cloud.callFunction` 走不通（代码已兜底退回 `wx.request`，不会白屏，但等于没迁）。**公开 API 做不到**（已逐个查过 `tcb` 服务的环境类接口，没有关联 appid 的 Action）→ 只能在**微信开发者工具「云开发」面板**或 **CloudBase 控制台「环境配置 → 安全配置 → 小程序关联」**里填 `wx3a21eb903a16cbc4`。详见 `docs/cloudbase-migration.md` §5.2 |
| 🔴 1c | **两条「知识库怎么改」的路子并存，取哪条要拍板** | ① **本地后台 ＋ 发布管道**（§3.25：本地 SQLite ＋ Directus 后台 → 发布命令 → 远端 PG ＋ JSON 快照，**Excel 退役**）② **服务端管理员覆盖层**（§3.23：命令行 `library` ＋ 服务端表，**Excel 保留**）。两条都已在 `feat/web-site` 上（合并提交 `79cb2db`），功能都能用，但**长期只留一条**才是答案 —— 拍板方向定下来之前，M4（Excel 退役）不动 |
| 🔴 1d | **`tcb login` 一次**（扫码，十几秒） | 发布命令要连远端 PG，凭证只从环境变量读。`scripts/cb-credentials.mjs` 会调 `tcb secrets get` 取临时密钥注入子进程 —— 但 **CLI 登录态会过期**，过期时命令报「无有效身份信息」。**不登录就验证不了端到端发布**（M3 的远端断言 A5／A6／A7 需要真连） |
| 🔴 2 | ~~**后台声明《用户隐私保护指引》两项隐私类型**~~ | ✅ **2026-11-05 已不需要** —— 小程序不提供导出，隐私接口降到 **0 个**，后台**一项都不用勾**（详见 §3.11）。剩下要填的只有「用户信息收集」那一栏（用户输入内容／账号信息，见上线清单 §1.3） |
| 🔴 2c | **填运营者主体与联系邮箱** | 隐私政策**第八**节现在是占位文字（`运营者：（待填写）`），审核会看 |
| 🟡 2b | 注册微信小程序（个人主体）→ 填真实 AppID | ✅ 已完成（`wx3a21eb903a16cbc4`）；开发者工具需登录对应管理员微信号才能预览／上传 |
| 🟡 3 | **买境内轻量服务器（2 核 4G）** | 备案通过后要立刻部署。**注意：迁 CloudBase 后网站已经能跑在静态托管上，服务器是否还要买，取决于「用自己的域名」还是「用 CloudBase 默认域名」** |
| 🟡 3b | **真机跑一遍新界面**（备案前先用局域网 IP） | 寸关尺关系图「直接显示在页面上、点图可放大」—— 模拟器已验，**真机还没验**（详见 §3.11）。用户已说本轮不做真机验证 |
| 🟡 3c | **上传前在开发者工具里重扫一次「代码质量」** | 两条已修（`minified` 已开 ＋ 底图 298 KB → 116.3 KB），但**以工具实际扫描结果为准** —— 扫完确认这两条变成「通过」再传（详见 §3.12） |
| 🟡 4 | **桌面版装到自己的电脑上试一遍** | 已出包（`release/*.exe`），试过再决定要不要换签名证书 |
| 🟡 4b | **鸿蒙：DevEco 里下模拟器镜像 → 打开镜像目录 Run** | HAP 已出（9.1 MB unsigned），但**没跑起来过** —— 本机没有模拟器镜像、也没有 hdc。镜像下好后工程路径已是纯 ASCII，直接 Run 就能验四个 tab（详见 §3.15） |
| ⚪ 5 | AGENTS.md「下游用途」空位 | 由维护者自行填写一行 |
| ⚪ 6 | 代码签名证书（可选） | 只影响安装时的 SmartScreen 提示，不影响功能 |
| ⚪ 7 | **CloudBase 套餐升级**（体验版 → 个人版） | 体验版**不能配安全域名**、到期 2027-05-04；升级后才能加安全域名白名单（当前靠服务端 CORS 头，已实测可用） |

---

## 8. 维护约定

- **什么时候更新本文**：① 某条工作线状态变化（完成／被阻塞／方案变更）② 关键决策拍板 ③ 阻塞项清单变动 → 改完连同相关代码/文档一起提交。
- **提交前缀**：沿用 `AGENTS.md`「Git 约定」—— `docs:` 资料整理／笔记 ｜ `data:` 新增或更新原始资料 ｜ `chore:` 工具与配置 ｜ `ocr:` 识别文本落盘；**代码与文档分开提交**。
- **分支纪律**：**两条长期开发线**（2026-11-06 起）—— `feat/wechat-miniprogram`（小程序／鸿蒙／Windows 桌面端、多用户与 CloudBase 迁移）与 **`feat/web-site`（网站端 `pulse-record/src/`）**，两者同源于 `6ebc881`。**网站端的新改动一律走 `feat/web-site`**；小程序分支上已有的内容**原样保留，不改写它的历史**。仍然**不直推 `main`**、都**不开 PR**。详见 `AGENTS.md`「Git 约定」。
- ⭐ **小程序线永不合并进 `main`（2026-11-06 维护者拍板）**：微信端、鸿蒙端、Windows 桌面端、多用户与 CloudBase 迁移**全部永久留在 `feat/wechat-miniprogram`**。**不向 `main` 合并、不向 `main` 开 PR** —— 这条比「上线之前集中开发」更强，不是「上线前不合」而是**不合**。`main` 保持为原始资料库 ＋ 已合入的稳定工具。
- **PR 状态**：#6（`chore/multi-user → main`）、#7（`chore/desktop-electron → chore/multi-user`）**保持 OPEN、既不合也不关**；它们都已是 `feat/wechat-miniprogram` 的祖先，合进去就等于把小程序线合进 `main`。**「以后要不要并回 `main`」这个问题已关闭**，不必再问、也不必准备合并方案。日常推远端就在 `feat/wechat-miniprogram` 上提交并 `git push` 到同名远端分支，**不需要开 PR**。
- **表格优先**：状态一律用表格写，行尾标注实测日期，别写「大概」「应该」。
- ⭐ **数据住在 JSON，不住在 TS 源码里（2026-11-07）**：照抄原文的数据一律进
  `src/content/*.json`；`src/domain/*.ts` 只留**逻辑**（判定、查表、视图组装）。
  想改内容走 **Excel**（`content/臧氏脉学-用方知识库.xlsx`）→
  `npm run content:json` 转回 JSON → `npm test`。
  摊平规则（数组用换行、嵌套用外键、稀疏字段用 `omit_empty`）的**唯一真源**是
  `scripts/excel_schema.py` —— 改列必须回来改它，否则往返测试会红。
  详见 [`content-layer.md`](./content-layer.md)。
- ⭐ **脉象图的唯一编辑面是矩阵 sheet**（`P04-清挡路` … `P50-肝心同治·挡路六`，
  讲义 p34 体例：左列部位／取法 ＋ 左右两列 ＋ 9 行）。「脉象图·格位」长表**由矩阵派生**，
  在长表里改脉象会被覆盖 —— 两条都写就有两处真源。
  矩阵 sheet 名里的**序号是权威的**（条目 ID 超 31 字符会被 Excel 截断），
  表头区的「条目ID」只用来校验，别改。
- ⭐ **矩阵 sheet 按方剂名命名（2026-11-10）**：sheet 名＝`P序号-图名`
  （`P04-清挡路`、`P05-引火归元·上盛下虚`）—— 翻 tab 栏一眼就知道那张表是哪个方子的，
  不用背 `fx-ssx-qingdanglu` 这类内部 ID。
  **图名的单一真源是 `src/content/pulse-patterns.json` 的 `title` 字段**，
  显示面有两个：矩阵 sheet 的 tab 名 ＋「脉象图·条目」表的「图名」列（可编辑，审核者能自己改）。
  ⚠️ **序号仍是权威** —— 读回照旧靠 `P{NN}` 定位条目，后缀纯导航。
  ⚠️ **防死锁**：sheet 名与图名不一致**不能在 `content:json`（转移）时报错**
  （改了名→报错→新名进不了 JSON→没法重生成→卡死），改为**只在 `content:check` 里报**，
  提示重跑 `npm run content:excel`。破坏性用例 ⑪ 守着这条。
- ⭐ **数据进了 JSON 就不许在 TS 里再抄一份**（2026-11-10）。
  `src/domain/*.ts` 只能 `import` `src/content/*.json`，
  再写一份字面量就是两处真源，改了一处另一处悄悄对不上。
  （`symbols.ts` 的 14 个符号就是这么从硬编码改成读 `symbols.json` 的。）
- ⭐ **流程图里的矩阵示意是从工作簿生成的**（2026-11-10）。
  [`填写流程图.html`](./填写流程图.html) 第 03 节那张「一个矩阵 sheet 长什么样」，
  由 `scripts/make_flowchart.py` 直接读 `content/臧氏脉学-用方知识库.xlsx`
  的 P04 sheet（清挡路）渲染，**不是手画的** —— 手绘那版已经漂移过一次
  （画成 7 列、2 行表头区，还多一条竖线，表头与数值对不上同一套列定义）。
  改了工作簿后跑 `npm run content:flowchart` 同步；
  `npm run content:flowchart:check` 校验页面与工作簿是否一致。
  生成器自带**结构自检**（行数、每行摊平后的列数），不合格就拒绝写进页面。

### 3.21 方剂脉象图：网页上直接改，保存即同步（2026-11-11）

**需求**：方剂要附脉象图；一个方剂可对应几种脉象；在方剂后面加编辑按钮，手动填写。

**先查清的一件事**：`src/content/pulse-patterns.json` 里 50 条脉象图**早就写好了**
（编译时已挂到 `FormulaRule.pattern`），但**全仓没有任何组件读过 `hit.pattern`** ——
界面上从来没画出来过。所以这不是从零做，而是「把已有数据渲染出来 + 加一个能改的口」。

**四个决定**（与维护者确认）：

| 决策点 | 结论 |
|---|---|
| 挂在谁身上 | 用方条目（`FormulaRule.id`，61 条）。条件是脉象，天然对应 |
| 存哪 | 服务端（`formula_patterns` 表）。不用浏览器 localStorage —— 目的就是换机器也看得见 |
| 格里填什么 | 直接填符号；术语降级成「一键预设」 |
| 多张 | `PulsePattern[]`，每张有图名、顺序、备注 |

**分层：内置基线只读，手改写覆盖层**

`pulse-patterns.json` 是 Excel 管线的产物（`scripts/excel_to_json.py` 从 `P0N-图名`
矩阵 sheet 还原）。界面若直接写回它，下次 `npm run content:json` 会无声盖掉手改。
所以：**JSON 只读基线 ＋ 服务端覆盖层**，合并规则只有一条 ——

```
有覆盖 → 整条接管（基线不再显示）
无覆盖 → 用基线
```

「恢复默认」＝ `DELETE` 覆盖行，回落到基线。

**⭐ 一个真 bug：保存「0 张」会静默回落到基线**

覆盖层是「有行就用」，那么「把这个方剂的图全删了」＝没有行 ＝ 读起来像「没改过」，
于是刚删掉的图又冒出来。已加**接管标记行**（`seq = -1`，payload `{"__takeover__":true}`）：
读列表时它只负责让这个键「出现过」，返回**空数组**（不是缺失）。
SQLite 与 PG 两套实现同时改了，e2e 里有一条专门守它。

**落地清单**

- 服务端：`schema.sql` / `schema-pg.sql` 加表；`db.mjs` / `db-pg.mjs` 各 3 个函数；
  `pg-functions.sql` 加 3 个 RPC；`index.mjs` 加 3 条路由（GET/PUT/DELETE）。
- 前端：`src/api/patterns.ts`、`src/state/patterns.tsx`（Context 合并层）、
  `src/components/PatternSheet.tsx`（只读矩阵）、`PatternStrip.tsx`（缩略图／注记卡／入口）、
  `PatternEditor.tsx`（编辑器）。
- 编辑器：左列管这个方剂的几张（新增／复制／上下移／删），右侧矩阵每格是输入框
  （点进去直接打字，或点符号条追加）；`parseCodes` 归一，`++` 不会被拆成两个 `+`。
  ⚠️ 归一放在 blur／保存两处 —— 边打边解析会把 `TTT` 吃掉（打到 `T` 时还不确定）。
- 测试：`npm run test:e2e:patterns`（11 项：保存回读、**重启进程后仍在**、上限与形状校验、
  被拒后原数据不坏、空列表留痕、恢复默认、畸形编码、跨账号隔离、未登录 401）。
- 回归：core 40 / auth 57 / app 28 全过；`tsc --noEmit` 无错。

**云端已部署（2026-11-11 同日完成）**

CloudBase CLI 连上 `pulse-1-d0g880ydl8ddc57f6` 之后全部补齐：

| 事项 | 结果 |
|---|---|
| `formula_patterns` 表 ＋ 索引 | ✅ 云端 PG 5 列就位 |
| 3 个 `pulse_*_formula_patterns` 函数 | ✅ 云端函数 35 → **38** |
| SQL 层冒烟（写两张／清空留痕／撤销） | ✅ 接管标记行在 PG 上同样生效 |
| 云函数 `pulse-api` 重部署 | ✅ Event / Nodejs20.19；5 个环境变量部署前后一致 |
| 网关闭环 `scripts/e2e/cloud-smoke.mjs` | ✅ 10/10（健康、令牌、401、写入、读回、顺序、格值、撤销） |

**两个踩过的坑**（详见 `formula-pattern.md` §8.3 / §8.5）：

1. `tcb env list` 一直报旧环境不存在 —— 根因不在 `.cloudbase/project.json`，
   而在 `~/.config/.cloudbase/auth.json` 的 `credential.envId` 也存了一份；
   改掉这一行即通。加 `-e`、`-r` 都不解决。
2. `tcb fn deploy --install-dependency false` **不上传**本地 `node_modules`，
   函数起来直接 `ERR_MODULE_NOT_FOUND: @cloudbase/node-sdk`；
   改成 `--install-dependency true` 由云端装依赖才正常。
   另外 `tcb fn deploy --force` 实测**不会**冲掉环境变量。

**怎么用起来（本机开发，但数据存云端）**

```bash
cd pulse-record
VITE_API_BASE="https://pulse-1-d0g880ydl8ddc57f6-1257312696.ap-shanghai.app.tcloudbase.com/pulse-api" npm run dev
```

不给 `VITE_API_BASE` 时走同源 `/api`，即本机 `server/` + SQLite（`src/api/http.ts`）。
连云端的账号要登录（`PULSE_SINGLE_USER=0`），换机器用同一个账号登录就是同一份数据。
跨域已放行（`PULSE_CORS_ORIGINS` 含 `localhost:5180`／`127.0.0.1:5180`，
Vite 实际端口取自 `scripts/dev.mjs` 的 `WEB_PORT`）。小程序侧的 `PULSE_CLOUD_ENV`
默认值也已从旧环境改为 `pulse-1-d0g880ydl8ddc57f6`（`taro/config/index.ts`）。

### 3.22 ② 定疗法里的方名链接：点一下会顺手把疗法也定了（2026-11-11）

**怎么发现的**：本地起网站端（`npm run dev`，前端 5180／后端 5178，单机模式），
点「载入示例（少娟）」后逐块试。点 ② 定疗法里的「上焦方」想看那条方的完整条目 ——
点完之后**「三焦疗法」那张卡自己被选中了**（橙色高亮），右上角冒出「清除」，
③ 开方药也跟着自动填满。我只想查一条方，却把疗法给定了。

**根因**：`src/components/TriadFrame.tsx` 的 `TherapyPicker` 里，
整张疗法卡是 `<button>`（点它＝选疗法），卡内的方名又是 `<button>`（点它＝看方剂条目）。
**button 套 button** 有两个后果：

1. HTML 无效 —— button 的内容模型不含 interactive content，
   React 开发期直接警告 `<button> cannot be a descendant of <button>`；
2. **更要紧的是点击冒泡** —— 内层 button 的 onClick 打完，
   外层 button 的 onClick 跟着触发，于是「查一条方的组成」顺手改了「选哪个疗法」。

**改法**：内层换成 `<span role="button" tabIndex={0}>`，onClick 里 `e.stopPropagation()`；
onKeyDown 里同样处理 Enter／Space（键盘也要能开、也不能顺带选疗法）。
外层 `<button>` 不动（它的语义与键盘行为本来就是对的）。
另补 `.pr-link-inline`（`cursor: pointer` ＋ `display: inline-block`）——
span 默认没有手型光标、也不是 inline-block，padding 与点选手感都要补齐。

⚠️ **只把 button 换成 span 是不够的**：不 `stopPropagation` 的话照样会连带选疗法。
（break-test 的 mutation B 专门验这一条。）

**实测**

| 项 | 结果 |
|---|---|
| 浏览器手动复验 | 点「上焦方」→ 知识库定位到那一条；三张疗法卡 `class` 都**没有** `is-on`，也没有「清除」按钮 |
| 网站端浏览器回归【⑨】段（新增 4 项） | button 套 button 计数 **0**；方名链接标签全是 `SPAN`；点方名链接前后被选中的疗法卡 **0 → 0**；点链接仍定位得到知识库那条（没把功能改坏） |
| break-test `scripts/e2e/app-nested-button-break-test.mjs`（新增，12 项） | A（改回 button ＋ 去掉 stopPropagation）→ 两条断言都红；B（**只**去掉 stopPropagation）→「连带选疗法」红而「没有 button 套 button」**仍绿** |
| 全量回归 | 见 §6 |

break-test 的 mutation B 是关键：结构没坏，只去了 `stopPropagation` ——
「连带选疗法」那条照样红，说明它真的在测**事件冒泡**，
不是靠 A 的嵌套结构顺带变红的假阳性；反过来「没有 button 套 button」在 B 里仍绿，
说明两条断言各测各的，没有互相顶。

**纪律**

- 外层卡片已经是 `<button>` 时，**内层可点元素不得再是 `<button>`** → 用 `span role="button"` ＋ `tabIndex`。
- 内层可点元素**必须 `stopPropagation()`** —— 「点一个只读的东西」绝不能顺带改动状态。
- 断言要能验**行为**（「点完有没有顺带选中」），不能只验结构；
  并且要用 break-test 证明它不是恒绿（也不能恒红）。

### 3.23 用方知识库 · 管理员覆盖层：整个知识库可编辑（2026-11-11）

**需求**：整个用方知识库都可以编辑（可改 ＋ 可增 ＋ 可删）。
**用户收窄的范围**（本轮硬边界）：

- **只改后端**，管理员来改，**前端一行都不改**；
- 内容落在**本地 SQLite**；
- 前端若要消费这些改动，**等用户通知后**再做同步。

**根因（决定了方案形态的三条事实）**

1. 前端内容是**编译期内联**的（`src/domain/*.ts` 的 `import x from '../content/x.json'` → Vite 打进
   `dist/assets/index-*.js`），前端**没有任何运行时内容拉取** →
   前端要看到改动，只有「内容导出 → 重新 build」这条路。
2. 讲义 p44 依脉用方 61 条的**命中判定是 TS 函数**
   （`src/domain/formulas.ts` 的 `EVALUATORS`，`loadRules` 做 JSON↔函数**双向校验、缺一即抛错**）→
   p44 条目**改字段可以纯数据做**，**新增／删除必须同时改代码**。
3. 讲稿方剂、p42 对照表、同和堂版成方、科中**全是纯数据**
   （`src/domain/drugs.ts:41`、`src/domain/medication.ts:286`，无 per-id 函数、不抛错）→
   这 4 类**改／增／删都能纯数据完成**。

**改法**

| 层 | 做什么 |
|---|---|
| 存储 | 新增 `library_items` 表（SQLite ＋ PG）：`kind \| item_id \| payload \| deleted \| updated_at \| updated_by \| note`，按 `(kind, item_id)` **整条接管**；`deleted=1` 是**墓碑**（否则删除会静默回落到基线） |
| 真源 | 新增 `server/library-schema.mjs`：kind 注册表（能改哪些字段、能不能增删）、三层校验（字段／主键／悬空引用）、合并算法、级联清理 |
| 写入面 | `npm run admin -- library …`（`scripts/admin.mjs` ＋ `scripts/lib/library-cli.mjs`）—— 直接读写本机 SQLite，不过 HTTP，服务器上也能用 |
| 读接口 | `GET /api/library/overrides` —— 为将来的前端同步预留底座（本轮前端不接） |
| 出口 | `library apply` 把覆盖层合并回 `src/content/*.json`（**数据层**）→ `content:excel` → `npm run build` → 前端**代码零改动**就生效 |

**p44 的架构边界**：命令行对 p44 的**新增／删除直接拒绝**并说明原因
（判定逻辑在代码里，数据与函数必须一一对应，缺一个前端就起不来），
并给出可执行的替代（先加成 `kind=drug`，那是纯数据）；
**改字段照常允许**。覆盖层里要是绕过命令行混进了 p44 的增删
（手改数据库／导入外部文件），`apply` 也会**拒绝写盘**，`verify` 会点名报出来。

**级联（按 AGENTS.md「宁可留空并写『未载』，不臆造」）**：删讲稿方剂 → p44 的 `drugs[]` 去掉该 id；
删成方 → p42 的 `doseId` 置空、`doseBasis` 标「未载（原 doseId=xxx 已删除）」、科中映射里那一项删掉；
删科中 → 科中映射里的值写成「未载」。

**一个有意例外**：`library_items` **没有 `owner_id`**，是 store.mjs「ownerId 必填」硬规则的例外 ——
用方知识库是**公共资料**不是个人数据，管理员改一次所有账号共享一份（用户 2026-11-11 拍板）。
例外只此一处，理由写在 `server/store.mjs` 的契约表里；其余四张业务表仍严格按 owner 隔离。

**实测**

| 项 | 结果 |
|---|---|
| 新增 e2e `scripts/e2e/library-admin.mjs` | **47 项全绿**（A 空状态／B 改一条／C 新增／D 删除／E 撤销／F 级联／G 悬空引用／H p44 边界／I 字段校验／J 命令行契约／K 导出导入／L 读接口／M 仓库真文件未被碰） |
| 新增 break-test `scripts/e2e/library-admin-break-test.mjs` | **7 条 mutation 全部被抓**（覆盖层不生效／墓碑当没改过／悬空引用检查关掉／p44 边界关掉／每次写盘带时间戳／删成方级联去掉／删讲稿方剂级联去掉），还原后逐字节一致 |
| 全量回归 | 见 §6 |

break-test 里两条**假阳性**是被它抓出来的，值得记一笔：

- **H6「verify 抓到那条」**：一开始注入的 payload **缺 `quote`**，被字段校验先拦下 ——
  「p44 边界被关掉」时它照样绿，说明它测的是「缺必填字段」而不是「p44 越界」。
  改成注入一条**完全合法**的 payload 之后，它才真的在测 p44 边界。
- **B5「apply 幂等」**：一开始只把 `writeBaseline` 改成带时间戳，结果**抓不到** ——
  因为 `apply` 在「内容没变」时根本不写盘，时间戳的抖动被挡在外面。
  补了 A4「apply 之后内容文件里没有多出后端自己加的顶层键」，并让 M5 顺带去掉
  「没变就不写」那条捷径，两条断言才都咬得住。

**纪律**

- **覆盖层是「有行就用覆盖层」** —— 删除必须写**墓碑**，不能靠「没有行」表达
  （没有行＝没改过＝静默回落到基线，刚删的条目又冒出来）。
- **改一条要按字段改**，不要整条覆盖 —— 否则改一个字段会连带丢掉别的字段。
- **后端不许往内容文件里塞自己的东西**（写入时间戳、内部标记）—— 那会让「apply 幂等」变成空话。
- **apply 是叠加，不是替换** —— 人工在 Excel 里的改动要先 `content:json` 拉进 JSON 推进基线，
  顺序反了会被盖掉。
- **引用断了宁可什么都不写** —— `apply` 拒绝写盘，绝不写出半坏数据。
- **断言要能区分「抓对了原因」** —— 一条断言被别的检查顺带弄红，等于没测（M3/M4 那两条就是这么现原形）。

**这一轮明确不做**

前端任何改动（编辑 UI、合并层、读接口接入）、小程序端任何改动、
HTTP 写接口与 role 闸门、放宽 `loadRules` 支持 p44 增删。

---

### 3.24 开放删除：讲义 p44 的条目可以删了（2026-11-11）

**为什么做**：用户 2026-11-11 画布批注「主线里面的也要求可以单独编辑。做好可以做成区块，
我可以任意拼接组合」，并口头拍板「**开放删除功能**」。
上一轮（§3.23）把 p44 的增删一起挡住了 —— 现在打开**删除**这一半。

**卡点在哪**：p44 的条目数据在 `src/content/formula-rules.json`，
命中判定在 `src/domain/formulas.ts` 的 `EVALUATORS`。
原先 `loadRules` 对这两边做**双向校验、缺一即抛错** ——
删掉一条条目 → 数据少一条、函数还留着 → **前端启动就崩**。
所以「删除」不是后端放开一个开关就完了，它卡在前端装载器上。

**改法：两个方向刻意不对称**

| 方向 | 改前 | 改后 | 为什么 |
|---|---|---|---|
| 数据有、判定函数没有 | 抛错 | **仍然抛错** | 那条规则永远不命中，界面却看不出来 —— 最坏的一种坏法，宁可载入失败 |
| 判定函数有、数据没有 | 抛错 | **跳过**（不加载） | 这是条目被管理员删掉之后的正常状态：函数是**残留代码** |

因为判定函数还留着，`library revive` 把条目放回来时**一行代码都不用改**。

**改动清单**

| 层 | 文件 | 改了什么 |
|---|---|---|
| 前端 | `src/domain/formulas.ts` | `loadRules` 改成上面那两个方向；导出 `loadRulesFrom`／`EVALUATORS` 供测试注入数据 |
| 前端 | `src/domain/formula-links.ts` | `RULE_LINKS` 命中后校验那条规则**还在不在** —— 不在就落到「用方页未载」，而不是点过去没反应 |
| 后端 | `server/library-schema.mjs` | `rule` 的 `deletable` 放开；`checkRuleBoundary` 改成 `checkRuleAddBoundary`（**只管新增**）；新增 `readEvaluatorIds()`（从 `formulas.ts` 里读出**有判定函数的 id 集合**当白名单） |
| 命令行 | `scripts/lib/library-cli.mjs` | `del` 存**原内容快照**；新增 `revive`（把删掉的放回来）；`restore` 保持原义（撤「覆盖层这一行」）并加了提示 |

**为什么白名单要从代码里读、而不另设一张登记表**：
「哪些 id 能被命中」的真源就是那份 `EVALUATORS`。另设一张表，两边必然漂移，
而漂移的后果是「前端载入即报错」—— 所以 `readEvaluatorIds()` 直接读真源。
读不到（文件不在／格式变了）就退回「只认基线里的 id」，宁可少放行。

**`restore` 与 `revive` 的分工**（这是本轮想清楚的一件事）

| 命令 | 撤的是 | 结果 |
|---|---|---|
| `restore` | 覆盖层里**这一行** | 回到内置基线的样子 |
| `revive` | **那一次删除** | 把删掉的条目原样放回来（靠墓碑里的原内容快照） |

两者只在「**删除已经 apply 过去**」时才分得出差别 ——
`apply` 是写进基线的，墓碑一旦 apply 过去，基线里就没有这一条了，
光撤墓碑撤不回来，得用 `revive` 把内容放回去。命令行遇到这种情况会提示用 `revive`。

> 踩过的坑：一开始把 `restore` 直接改成「墓碑翻活」，结果 `library-admin` 的
> E1／E2／F3 三条**立刻变红** —— 因为「restore ＝ 撤销我对这一条的全部改动」
> 是既有语义（新增一条再 restore ＝ 这条不该在结果里）。
> 于是拆成两个命令：`restore` 保持原义，`revive` 专管「放回来」。

**实测**

| 项 | 结果 |
|---|---|
| `scripts/e2e/library-admin.mjs` | **52 项全绿**（H 段重写：p44 可改／可删／不可新增，删除→apply→消失，revive→放回来内容一字不差，restore 撤不回落已写掉的基线并提示用 revive） |
| `scripts/e2e/library-admin-break-test.mjs` | **9 条 mutation 全部被抓**（新增两条：revive 放不回来／墓碑不存快照），还原后逐字节一致 |
| 新增 `scripts/e2e/rule-delete-loader.mjs` | **13 项全绿** —— 拿**编译后的共享内核**（网站端与小程序端共用）验「删掉一条 p44 条目之后前端照样起得来」，不是验「命令行没报错」 |
| 新增 `scripts/e2e/rule-delete-loader-break-test.mjs` | **2 条 mutation 全部被抓**：① 装载器不再为「数据有、判定函数没有」抛错 → 静默降级；② 装载器回到旧规矩（两个方向都抛错）→ 删一条就起不来。还原后源码逐字节一致、**共享内核重新编译**（产物不留脏） |
| 全量回归 | 见 §6 |

**纪律**

- **「数据有、判定函数没有」必须抛错** —— 不许静默降级（那条规则永远不命中，
  界面却看不出来，是最坏的一种坏法）。
- **「判定函数有、数据没有」必须跳过** —— 那是删除之后的正常状态，不是错误。
- **删掉的条目要放得回来** —— 墓碑行里存原内容快照；没有快照的墓碑，
  `revive` 要明确说「放不回来，只能手工 add」，不能假装成功。
- **白名单从真源读，不另设登记表** —— 避免两处漂移。
- **改共享内核的源码后，break-test 必须重新编译并重新编回** ——
  否则编译产物里留着写坏的那一版，后面所有测试都被污染。

**这一轮明确不做**

前端编辑 UI、合并层、读接口接入；小程序端任何改动；
**p44 的新增**（那要一份判定函数，是代码，命令行补不出来）；
「区块拼接组合」的数据模型（条目拆成可复用的块再组装成新条目）——
那要另立一套结构，等用户明确要了再做。

### 3.25 内容层重构 M0～M3：本地后台 ＋ 发布管道（2026-11-11）

> 目标：把「知识库怎么改」从「改 Excel」换成「后台页面上改，改完发一条命令」。
> 本轮完成 M0（选型）→ M1（落库）→ M2（远端通路）→ M3（发布命令）；
> **M4（Excel 退役）起未做**。

**为什么做**

原来的链路是「改 Excel → `content:json` 转回 JSON → 编译」。
Excel 是给人看的工作簿，**不是数据库**：多一层摊平规则、sheet 名与图名要手工对齐、
「脉象图·格位」长表由矩阵派生（两处真源风险）。
计划 v8 把这条路整个换掉。

**M0 · 本地后台选型（实测，不是查文档）**

| 项 | 实测结果 |
|---|---|
| 方案 | **SQLite（本地编辑库）＋ Directus 12.6.1（容器）**，不是本地 PG |
| 冷启动 | **11.6 s** 到可服务 |
| 稳态内存 | **287 MiB**（本机 7.75 GiB 的 3.7%） |
| 镜像 | 1.11 GB（Docker Desktop 4.91.0 / 引擎 29.8.0 已装） |
| 接管 | **17/17 张表**，每张都有字段与主键 |
| 关系 | **11 条外键**全部升级为 Directus 关系 |
| 过滤 | 按 `pattern_id` 过滤返回**正好 18 行**（左 9 ＋ 右 9） |
| 中文 | ✅ 登录页已是中文，项目 `default_language` 与用户 `language` 均 `zh-CN` |

实测推翻了两个乐观假设：

- **Directus 只认单列主键**（源码 `packages/schema/src/dialects/sqlite.ts`：
  `primaryKeys.length !== 1 ? void 0 : ...`）⇒ 6 张复合主键的表被**整表忽略**
  （含核心的 `content_pulse_cells`）⇒ 改用派生单列代理键 `id`（＝「父键｜序号」），
  规则写在 `x-tables.derivedId` 里（唯一来源）。
- **WAL 不能跨进程共享**：宿主机脚本与容器是两个 SQLite 实例，宿主机连接关闭会
  checkpoint ＋ unlink `-wal`/`-shm`，容器仍握着已删 inode 的 fd ⇒ **容器写入全部凭空消失**
  （API 返回成功、文件纹丝不动）⇒ 内容库改 `journal_mode = DELETE`
  （**业务库 `server/db.mjs` 仍用 WAL**，那是另一份库，不动）。

选型全文见 [`content-admin-选型.md`](./content-admin-选型.md)。

**M1 · 内容层落库**

- 8 份 `src/content/schema/*.schema.json`：合法 JSON Schema（draft 2020-12）
  ＋ `x-tables` 扩展段（表定义／每列的 json 来源指针／fk／pk／唯一约束）。
  顺带补上 8 个内容 JSON 一直指向不存在文件的 `$schema` 缺口（实测 8/8 现在都能解析）。
- 同一份 schema 生成 **SQLite 与 PG 两方言**的 DDL；落库与导出**互为逆运算**。
- 灌库结果：**17 表 1472 行**。
- 断言 **A1**（schema↔库结构：表／列／类型／可空／主键／唯一约束）、
  **A2**（每图 18 行、seq 连续）、**A3**（组号一个编号空间）、
  **A4**（有用字必有组号）、**A5**（派生代理主键与规则一致）、
  **RT**（库↔JSON 逐字段）、**RTL**（库→JSON→库 无损）。
  `scripts/e2e/content-schema-break.mjs` **故意写坏 16 例**（含反向「好库零告警」防假绿），全过。

**M2 · 远端 PG 通路**

- 远端 `content` schema：17 张数据表；`content_meta` schema：3 张账本表
  （`content_state`／`content_revisions`／`content_audit`）。
- 6 个函数：`content_check_order`／`content_publish`／`content_read`／
  `content_state_get`／`content_revisions_list`／`content_rollback`。
- 签名 `(p_owner text, p_args jsonb)`（沿用仓库既有约定，不另立形状）。
- 灌入用 `jsonb_populate_recordset(NULL::content.<表>, $1)`：
  列清单取自 PG 目录 ⇒ **schema 是唯一真源**，函数不用跟着改。

**账本表为什么单独一个 schema**：发布要 TRUNCATE 数据表（整份覆盖）。
若账本表同 schema，「哪些是数据表」就得靠一张写死的排除名单区分 ——
将来加第 4 张账本表而忘了改名单，它就会被当成数据表清空。
分开之后发布函数**只碰 `content`**，结构上就碰不到账本。

**「整份覆盖」的结构闸门**：载荷的 `order` 必须与 `content` schema 的实际表清单
**完全一致**。少一张表 ⇒ 那张表会留着旧数据 ⇒ 线上是「新版 ＋ 旧版」的混合体，
而发布**看起来成功了**。现在直接报错并点名是哪几张（实测拦下过一回）。

**M3 · 发布命令**

`npm run content:publish` 五步：① 自检 → ② 对拍 → ③ 原子发布 → ④ 生成快照 → ⑤ 三方对拍。
另有 `content:snapshot`／`content:status`／`content:rollback`。
详见 [`content-publish.md`](./content-publish.md)。

**这一轮实测踩出来的坑**

| 坑 | 根因 | 修法 |
|---|---|---|
| `content schema 里没有表` | 平台默认只给 **public** schema 授权，新建的 content schema 一张授权都没有 ⇒ `information_schema` 里看不见 | 授权文件（`server/content-pg-grants.sql`）：schema 的 USAGE ＋ 表权限 ＋ **序列**（`bigserial` 要 `GRANT USAGE ON SEQUENCES`）＋ `ALTER DEFAULT PRIVILEGES` |
| `permission denied for schema content` | 同上，schema 的 USAGE 没给 | 同上 |
| RPC 读不到数据 | 实测探针确认：**SDK 的 rpc 跑在 `service_role` 下**（`session_user` 是 `cloudbase_authenticator`） | 授权按 `service_role` 给 |
| `TRUNCATE` 跑去了 public | `quote_ident(表名)` **不带 schema 前缀** | 自己拼 `'content' \|\| '.' \|\| quote_ident(表名)` |
| 灌表顺序错、外键失败 | PG 的 `jsonb` 会**重排键** ⇒ 载荷的键顺序不可依赖 | 载荷显式带 `order` 数组（拓扑序来自 schema，函数内不另算一份） |
| 库结构被手抄坏 | 手抄生成器输出的 DDL 会破坏拓扑序 | 迁移 SQL 只能用生成器原文 |

**这一轮明确不做**

- **M4（Excel 退役）与 M5（前端改从 `GET /api/content` 取数）起未做**。
- **远端端到端发布未验证**：本机 CloudBase CLI 登录态过期，`tcb secrets get` 报
  `AUTH_FAILED`；发布命令已跑到「一次 RPC ＝ 一个事务」并因缺序列授权**干净回滚**
  （远端无脏数据），修完授权后**还没再真跑一遍**。
  ⇒ 远端断言 **A5／A6／A7 已写好**（`npm run test:e2e:content:pg`），**等登录后跑**。

---

### 3.26 后台人眼确认：抓出一个让「被引用方整张表点不开」的 500（2026-11-12）

补 M0 验收项 ③⑤ 的最后一环 —— 登录 `http://localhost:8055/admin` 真机走一遍。

**先说 license 页**：Directus 那个「Have a license key?」页选 **「I'm using Core plan」**
（免费、不需要 key）即可。实测库里 `project_usage='community'`、`license_key=null` ⇒ **免费档本已生效**，
那一页只是首次进入的提示，选不选都不影响功能；唯一要避开的是「创建第一个账号」流程
（库里已有唯一管理员 `admin@example.com`，再走一遍会多建一个）。

**人眼确认的结果：界面是坏的。**

打开 `content_pulse_cells` 的一格，直接弹：

```
[INTERNAL_SERVER_ERROR]
parentItem$1[parentRelationField].push is not a function
```

而且不止这一格 —— **凡是「被引用方」集合的列表接口都 500**
（`content_sciences`／`content_doses`／`content_drugs`／`content_pulse_patterns` …）。
自动化断言当时全绿 —— **这个坑是人眼抓出来的**。

**根因**（读了容器里的 Directus 12.6.1 源码）：

`@directus/utils` 的 `getRelation()` 是**双向匹配**的：

```js
relation.collection === collection && relation.field === field                    // 正向 m2o
|| relation.related_collection === collection && relation.meta?.one_field === field // 反向 o2m
```

读「被引用方」集合时，请求的**列名恰好等于某条关系的 `meta.one_field`**
（`one_field` 就是主键名 ⇒ **必然命中**）⇒ Directus 把这个**标量列**当成**反向 o2m 关系**，
于是在 `merge-with-parent-items.js` 的 o2m 分支里把父行的那一列（字符串）当数组 `.push`
⇒ TypeError ⇒ 整个接口 500。

**修法**（三处，全部落地并复测）：

| 改法 | 内容 |
|---|---|
| **① `meta.one_field` 一律置 `null`** | 正向 m2o 靠 `collection + field` 匹配就够，**不需要** `one_field`；反向 o2m 展开我们用不到 |
| **② 外键指向非主键的字段不建关系** | `content_alias.target → content_drugs.name` 存的是方名，Directus 的 M2O 存主键值 ⇒ 建了也对不上，改成普通文本字段（附说明） |
| **③ 集合级 `display_template`** | 下拉里显示人话而不是 id。声明在 schema 的 `x-tables[].displayField`（唯一来源）：科中名／方名／图名／用字名 |

关系数从 11 条变成 **10 条关系 ＋ 1 个普通文本字段 ＋ 7 个显示字段**。

**验证**

- 17 张内容表的列表接口（`?limit=1` 与 `?fields=*`）**全部 200**（修复前 4 张 500）。
- 人眼：下拉展开**正好 18 条用字**，当前值显示**「大或顶」**；`Pattern ID` 显示**「增液（安卫）」**（图名）。
  截图见 [`content-admin-选型.md` §5.1](./content-admin-选型.md)。
- 新增断言 **A6**（各表可读：三种请求形态各测一次，含**显式点名每一列**）／
  **A7**（**全量**关系的 `one_field` 必须 null）／**A8**（字段界面）／**A9**（显示模板），
  按**结构解析**（看状态码与 `meta` 字段值，不搜关键词）。
- **「故意写坏」验证 9/9 通过**（`npm run test:e2e:content:admin`）：把 `one_field` 填回去 ⇒ 被 A6／A7 抓到；
  改界面 ⇒ A8；改 `display_template` ⇒ A9；给**计划外的残留关系**填 `one_field` ⇒ A7；
  恢复后必须重新全绿（防假绿）。
- **顺手清掉一颗地雷**：`content_alias.target` 那条关系以前配了 `one_field='name'`。
  Directus 只为「外键指向主键」的关系建 `schema.relations` 条目，所以它当时**没炸** ——
  但那是靠 Directus 的内部行为才安全。而且 `DELETE /relations/{集合}/{字段}`
  对**内省出来的**关系**删不掉 meta**（删完 GET 还在）⇒ 只能用 `PATCH` 置 null。
  断言 **A7** 因此改成**全量**检查（`GET /relations` 里所有 `content_` 开头的）。
- 顺手修掉一个隐患：`content-admin-init.mjs --check` 原来**无论有没有 `--check` 都发 PATCH**
  （「核对」却真改了远端）⇒ 现在 `--check` 走 GET，纯只读。

**这一轮新增/改动的文件**

| 文件 | 作用 |
|---|---|
| `scripts/lib/content-admin-client.mjs` | 后台 HTTP 客户端（**唯一一份**，init 与断言共用） |
| `scripts/lib/content-admin-plan.mjs` | 「要配什么」的推导（关系／文本字段／显示字段），从 schema 单一来源推导 |
| `scripts/lib/content-admin-checks.mjs` | 断言 A6~A9 |
| `scripts/content-admin-check.mjs` | 只读核对（`npm run content:admin:check`） |
| `scripts/e2e/content-admin-break.mjs` | 「故意写坏」验证（`npm run test:e2e:content:admin`，会改配置并在 finally 恢复） |
| `src/content/schema/*.schema.json` | 7 张「一端」集合加 `displayField` 声明 |
| `server/content-schema.mjs` | `tableDefs()` 带出 `displayField`；新增 `displayFieldOf()` |
| `scripts/content-admin-init.mjs` | 改用共用的 client/plan；`one_field` 置 null；配显示模板；`--check` 只读 |
| `docs/images/directus-*.png` | 三张截图（列表页／下拉／500 现场） |

> 📌 **本节的断言编号已作废** —— 这里写的 A6／A7／A8／A9 与实施计划 §10.2 的
> 「A6 发布事务失败／A7 发布幂等／A8 快照==库／A9 往返」**完全错位**，
> 同一个编号在两处讲两件事。2026-11-12 已统一改成 **A21~A27**，
> 见 §3.27 与 [`content-assertions.md`](./content-assertions.md)。


### 3.27 断言编号统一 ＋ 后台补三项配置（2026-11-12）

这一轮不依赖任何待决事项，做的是两件「早就该做」的事。

#### ① 断言编号撞车 —— 同一个编号在两处讲两件事

实施计划 §10.2 的 **A1~A19 是唯一的编号来源**，但实现里早已各占各的：

| 撞号 | 曾经的两种含义 | 现在 |
|---|---|---|
| `A5` | 内容层「派生代理主键」 ＋ 远端「API 包 == 远端 PG」 | 前者 → **A20**；后者仍是 **A5** |
| `A6` | 远端「发布事务失败」 ＋ 后台「列表接口可读」 | 后台 → **A21** |
| `A7` | 远端「发布幂等」 ＋ 后台「`one_field` 为 null」 | 后台 → **A22** |
| `A8` | 计划「JSON 快照 == 本地库」 ＋ 后台「字段界面」 | 后台 → **A23** |
| `A9` | 计划「库→JSON→读回」 ＋ 后台「显示模板」 | 后台 → **A24** |
| `RT`／`RTL` | 内容层的两条往返检查（跟计划对不上号） | → **A8**／**A9** |
| `A1`~`A4` | 内容层 ＋ 覆盖层线（`library-admin.mjs`） | 覆盖层线 → **LA1**~**LA4** |

⇒ **规则**：计划里有的用计划编号（语义不许偏）；计划里没有的**从 A20 起往后排**，
不占用计划编号；别的子系统用别的前缀（覆盖层线一律 `LA*`）。
完整对照表落在 [`content-assertions.md`](./content-assertions.md)（**编号的唯一来源**）。

顺带发现：**计划自己的 A8 与「落库无损」是同一件事** ——
`content-seed.mjs --check` 读的「源 JSON」就是仓库里的 `src/content/*.json`，
那**就是**内容层的快照文件 ⇒ 合并成一条 A8，不再两处各留一份。

#### ② A3 补上一条真实缺口：「一个格位只能属于一个组」

计划 A3 与 A19 讲的是同一件事（都在抓「左右被当成独立编号空间」），合并成 A3。

而 A19 的实质内容 —— **同一张图里 (部位,取法,左右) 唯一** —— **原来没有断言**：

落库时 `groupOf.set(格位, 组号)` 是**后写覆盖先写**，
源 JSON 里同一个格位出现在两个组里会被**静默取最后一个**，
组号连续性照样通过 ⇒ 行数 18、seq 连续、组号连续三条全过，坏数据就这么流到远端。
现在 A3 多查这一条，并配了「故意写坏」的注入用例（把一个 `R` 侧格改成 `L`）。

#### ③ 后台补三项配置（全部从 schema 声明推导，唯一来源）

| 配置 | 声明在 schema 的 | 断言 | 为什么要 |
|---|---|---|---|
| **枚举下拉** | 列的 `enum`（尺／关／寸、浮／中／沉、L／R） | A25 | 手打容易打错；`allowOther=false` 保证取值集合只有一份 |
| **必填标记** | 列的 `notNull` | A26 | `NOT NULL` 只挡 `NULL`，**挡不住空字符串** —— 后台里没填的文本框提交上去是 `''` |
| **只读标记** | 表的 `derivedId` | A27 | 派生代理键是**算出来的**，让人手填＝迟早对不上（A20 抓到时已经白改一场） |

**踩到的坑**：Directus 12 的界面选项是**对象** `{ allowOther, choices }`，**不是数组**。
存成数组时 Directus 不报错，但界面读不到 `choices` ⇒ **下拉是空的**，
看起来像「后台不支持下拉」。⇒ A25 专门盯这个形状。

**有依据地偏离计划一处**：计划 §6.4 设想 `source`（出处）做「枚举下拉 ＋ 允许自定义」，
但实测真实取值是**组合式长句**（`讲稿 2010·第四讲／讲义 2026-10·p44（肾虚框 1）`），
四张表各有 46／28／56／7 种取值 ⇒ 下拉只会限制自由文本。处置：**出处保持自由文本 ＋ 必填校验**。

#### ④ 顺带修掉：机器重启后起不来本地后台

`content-admin.mjs up` 原来**无条件** `docker pull`。机器重启后镜像其实还在本地（1.11 GB），
但 pull 要去 `auth.docker.io` 换 token，网络一断就整条命令失败 ⇒ **容器根本起不来**。
现在：**本地已有镜像就跳过 pull**（`docker image inspect` 先问一句）。

#### 验证

- **全量回归 840 项全绿**（原 772：后台核对 79 → 146，内容层破坏用例 16 → 17），退出码 0。
- `npm run content:admin:check` → **146 项全绿**
  （17 张表 × 3 种请求 ＋ 10 条关系 × 2 ＋ 1 个文本字段 ＋ 7 个显示字段
  ＋ 5 个枚举列 ＋ 56 个必填列 ＋ 6 个只读列）。
- `node scripts/e2e/content-admin-break.mjs` → **14/14**
  （新增：枚举选项多一项／存成数组／打开 `allowOther` → A25；关必填 → A26；关只读 → A27）。
- `node scripts/e2e/content-schema-break.mjs` → **17/17**（新增 A3 的格位三元组用例）。
- `node scripts/content-snapshot.mjs --check` → 8 个快照都没变（本次只动配置与断言，不动内容）。

#### 这一轮新增/改动的文件

| 文件 | 作用 |
|---|---|
| `docs/content-assertions.md` | **断言编号对照表（唯一来源）** —— 新建 |
| `scripts/lib/content-admin-plan.mjs` | 加 `plannedEnums`／`plannedRequired`／`plannedReadonly` |
| `scripts/lib/content-admin-checks.mjs` | 编号改 A21~A27；新增 A25／A26／A27 |
| `scripts/lib/content-checks.mjs` | 编号改 A8／A9／A20；A3 补「格位三元组唯一」 |
| `scripts/content-admin-init.mjs` | 合成每列的 meta 一次 PATCH；配枚举下拉／必填／只读 |
| `scripts/content-admin-check.mjs` | 带上新配置，核对项 79 → 146 |
| `scripts/e2e/content-admin-break.mjs` | 编号跟着改；新增 3 类破坏用例（9 → 14 项） |
| `scripts/e2e/content-schema-break.mjs` | 编号跟着改；新增 A3 用例（16 → 17 项） |
| `scripts/e2e/library-admin.mjs` | A 段编号改 `LA*`（与内容层撞号） |
| `scripts/e2e/library-admin-break-test.mjs` | 跟着改 |
| `scripts/content-admin.mjs` | 本地已有镜像就跳过 pull（重启后能起来） |
