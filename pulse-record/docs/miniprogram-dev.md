# 小程序本机联调手册

> ⚠️ **2026-11-05 起，小程序主线已迁到 Taro**（工程在 `pulse-record/taro/`，React 18，4 个 tab：病例／就诊／用方／我的）。
> **本页描述的是原生回退工程**（`pulse-record/miniprogram/`，8 个页面）—— 原样保留作回退，等功能对齐后退役。
> **现在要跑小程序，请看 [`taro-migration.md`](./taro-migration.md)**（Taro 约定、构建、回归、鸿蒙）。
> 本页的「三条路线／凭据放哪／卡点表／上线手续」仍然通用 —— 那部分与框架无关。

> 小程序端代码在 `pulse-record/miniprogram/`（原生小程序，8 个页面，与网站共用同一个后端与同一份知识库）。
> 本页只解决一件事：**在自己的电脑上把它跑起来，并且知道每一步卡在哪该看什么。**
>
> 上线（域名、备案、AppID、审核）见 [`deploy.md`](./deploy.md) 的「小程序发布清单」；
> 迁 CloudBase 见 [`cloudbase-migration.md`](./cloudbase-migration.md)。

---

## 0. 三条路线，先选一条

| 路线 | 用在哪 | 需要什么 | 服务器地址填 |
|---|---|---|---|
| **A 开发者工具（模拟器）** | 改代码、看页面、快速验证 | 装微信开发者工具 | `http://127.0.0.1:5178` |
| **B 真机预览（手机）** | 看真机手感、试相册导出、试触屏录入 | 手机与电脑同一 Wi-Fi | `http://<电脑局域网IP>:5178` |
| **C 上线给患者/同行用** | 正式使用 | 已备案域名 ＋ 真实 AppID ＋ 境内服务器 | `https://<已备案域名>` |

A、B 都用「测试号」AppID，**不需要**域名备案 —— 只要在开发者工具里勾掉域名校验。
C 是唯一需要备案的路线，卡点全在手续上（见 `deploy.md`）。

---

## 1. 一条命令起来（推荐）

```bash
cd pulse-record
npm run mp:dev          # 单机模式：小程序不用登录，进「病例」就能录
npm run mp:dev:multi    # 多用户模式：要注册/登录，验证账号隔离时用
npm run mp:dev -- --port 6000
```

它会：

1. **共享包没编译就自动编译**（`build:core`，把 `src/domain/**` 与绘制代码编成小程序能 require 的 CommonJS，产物在 `miniprogram/utils/core/`，不入版本库）；
   > Taro 主线**不需要这一步** —— 共享包用 alias `@domain/*` 直接引源码（`npm run mp:taro:build` 即可）。
2. **起后端**（默认单机模式：所有请求都算内置单机账号，不要求登录）；
3. **把该填的东西打出来**：后端地址、数据库位置、开发者工具要导入的目录、局域网 IP、真机的注意事项。

按 `Ctrl+C` 停后端。它**不起网站前端** —— 要同时看网页版，另开一个终端 `npm run dev`。

> 单机 vs 多用户：单机就是「这台电脑上的数据，不用账号」；多用户按账号隔离数据，
> 适合以后再上线。小程序端两种都能连，页面会按 `/api/health` 返回的 `mode` 显示对应提示。

---

## 2. 手工清单（不用脚本时照这个走）

```
① npm run build:core
② npm run dev:api          # 只起后端（或 npm run mp:dev 一步到位）
③ 微信开发者工具 → 导入项目 → 目录选 pulse-record/miniprogram
④ AppID：选「测试号」（或填自己的正式 AppID）
⑤ 详情 → 本地设置 → 勾「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」
⑥ 小程序「我的」页 → 服务器 → 填地址 → 保存 → 「测试连接」
```

第 ⑥ 步应显示 **「连接正常（单机模式，不用登录）」**。看到这句，后端就通了。

---

## 3. 服务器地址在「我的」页改，不用改代码

`miniprogram/utils/config.js`（Taro 主线是 `taro/src/utils/config.ts`）里的 `API_BASE` 只是**默认值**；实际地址每次请求都从
`config.resolveApiBase()` 现取 —— 本地存储 `pulse.apiBase` 有值就用它，没有才用默认值。

「我的 → 服务器」卡片提供三件事：

| 按钮 | 做什么 |
|---|---|
| 保存 | 校验（必须 `http://` / `https://` 开头）→ 存本地 → 立刻探一次 `/api/health` 并显示模式 |
| 测试连接 | 对**输入框里的地址**探一次（还没保存也能测），连不上会给出针对性的排查提示 |
| 恢复默认 | 删掉本地覆盖，回到 `config.js`／`config.ts` 的默认地址 |

为什么要这样：真机预览时地址得换成局域网 IP，改代码就得重新编译、重新上传；
改成运行时可改，**换电脑、换 Wi-Fi、换端口都不用动代码**。

---

## 3.5 凭据放哪（AppID / AppSecret / 上传私钥）

三样东西，**只有 AppID 可以进版本库**：

| 东西 | 放哪 | 进版本库？ |
|---|---|---|
| **AppID** `wx3a21eb903a16cbc4` | `taro/project.config.json` 的 `appid`（原生回退工程是 `miniprogram/project.config.json`） | ✅ 可以（AppID 是公开标识，写在包里也无所谓） |
| **AppSecret** | `pulse-record/.secrets/server.env` 的 `WX_APPSECRET` | ❌ **绝不** |
| **代码上传私钥** `private.wx3a21eb903a16cbc4.key` | `pulse-record/.secrets/`（权限 600） | ❌ **绝不** |

- `.secrets/` 已在根 `.gitignore` 里；`git check-ignore pulse-record/.secrets/server.env` 能验证。
- `npm run mp:dev` 会**自动读** `.secrets/server.env` 交给后端（`WX_APPID` / `WX_APPSECRET`），
  启动横幅打「微信　已配置 AppID wx…」。没有这份文件也能跑 —— 小程序退回「账号密码登录」，
  只是微信免登不可用。
- **AppSecret 永远不进小程序包**：小程序包可被反编译。它只该出现在服务端环境变量里
  （上线时写进服务器的 `/etc/pulse-record.env`，见 [`deploy.md`](./deploy.md)）。
- 用真实 AppID 跑，开发者工具要**登录这个小程序的管理员／开发者微信号**；选「测试号」则不用。
- 上传私钥是给 `miniprogram-ci` 之类**命令行上传**用的，不是给小程序运行时用的；
  用之前要在小程序后台把**调用 IP 加进上传白名单**（或临时关掉白名单）。

> 安全提醒：AppSecret 一旦出现在聊天记录、截图、日志里，就等于泄露 ——
> 去小程序后台「开发管理 → 开发设置」**重置一次**最稳妥（重置后旧值立即失效，改 `.secrets/server.env` 即可）。

---

## 4. 不打开开发者工具也能验证

```bash
npm run test:e2e:mp       # 静态检查（31 项）
npm run test:e2e:mp:api   # 数据层端到端（38 项）
npm run test:e2e:mp:sim   # 模拟器冒烟（12 项）—— 需要先开开发者工具的自动化端口，见 4.5
```

`test:e2e:mp` 查的是**页面骨架**：`app.json` 登记的 8 个页面都在、WXML 里没在 `{{ }}` 中调函数
（小程序不支持）、绑定的每个事件都有对应方法、`require` 的相对路径都存在、没用到 ES2019+ 的运行时内建
（老机型 JSCore 会白屏）、出图链路没把底图传成尺寸占位对象、没用已弃用的 `wx.getSystemInfoSync`。

`test:e2e:mp:api` 查的是**页面底下那一层**：垫一个 `wx`（`wx.request` 走 fetch、Storage 走 Map）
上去，加载**真实的** `utils/config.js` / `api.js` / `data.js` / `auth.js`，连**真实的后端**跑：

| 段 | 覆盖 |
|---|---|
| 地址 | 保存后立刻生效、非法地址被拒且不覆盖旧值 |
| 鉴权 | 未登录 401、自动 `reLaunch` 回登录页、令牌被清；注册即登录；`/api/auth/me` |
| 病例 | 建患者（含体质/疗法）→ 读回 → 符号叠加（`X↑`）原样保住 → 列表就诊次数 |
| 搜索 | 姓名 / 日期标签 / 脉象符号三种口径 ＋ 搜不到返回空数组 |
| 就诊 | 单次改日期标签不动其它次；7 脉点体例保住 |
| 用药 | 单次就诊写入 → 读回 → 按患者汇总 → 删一条 → 为空 |
| 符号 | 新增 / 清单 / 与讲义固定符号重名被拒（400）/ 删除 |
| 单机 | 不带令牌能取数据、能建患者；注册被拒（409） |

**不覆盖**：WXML 渲染效果、触摸交互、`wx.saveImageToPhotosAlbum` 的相册授权、真机网络。
那几项只能在开发者工具或真机上人眼看 —— 也就是「真机验证」这一项仍未做（见第 6 节）。

---

## 4.5 让模拟器自己跑一遍（不用人点）

静态检查和数据层都过了，**页面在模拟器里长什么样、点下去会不会炸**，还是得真跑。
这件事可以交给命令行做 —— 开发者工具自带 `cli`，配 `miniprogram-automator` 就能开工程、编译、
切页面、截图、读 console，**全程不需要点授权弹窗**。

### 怎么跑

```bash
# 1) 开发者工具开工程并打开自动化端口（另开一个终端，跑着别关）
#    Taro 主线导入 "$PWD/taro"（先 npm run mp:taro:build）；原生回退工程导入 "$PWD/miniprogram"
cli auto --project "$PWD/taro" --auto-port 9421 --trust-project --port 63190

# 2) 后端 + 一个带演示数据的账号
npm run mp:dev -- --multi
npm run admin -- create mptest01 mpTest2026 测试
PULSE_LOGIN=mptest01 PULSE_PASSWORD=mpTest2026 npm run seed:demo

# 3) 跑冒烟
npm run test:e2e:mp:sim        # Taro 主线（原生回退工程用 npm run test:e2e:mp:legacy:sim）
```

> 自动化端口**不一定是开发者工具窗口里显示的那个** —— `cli auto` 会自己挑端口，看它打印的
> `{"autoPort": 9421, "requestedAutoPort": 9420}`，把 `MP_SIM_WS=ws://127.0.0.1:9421` 传给脚本。

`test:e2e:mp:sim` 走完各个页面，逐页截图（存到 `$TMPDIR/mp-taro-shot/`），断言：
页面能打开、**页面画布只有表格**、**导出图出得来**、**寸关尺图示图出得来**、console 没有报错。

退出码：`0` 全过；`1` 有失败项；`2` 环境没就绪（开发者工具没开自动化端口，不是测试失败）。

> 这套脚本就是 2026-11-04 抓到出图 bug 的地方：
> 小程序侧把底图传成了尺寸占位对象，`drawImage` 抛 TypeError，
> 表格和寸关尺图示一个都画不出来 —— 而页面只在 console 里留一条异常，
> 业务上看着像「图还没生成」，不真跑一遍根本发现不了。

### 寸关尺图示：默认不显示，点开单独看

**页面上只有表格**，没有手部示意图。操作行里多了一个「**寸关尺图示**」入口，
点它单独弹一个系统图片预览窗体（`wx.previewImage`，可双指缩放、全屏，关掉即回页面）。

| | 画什么 | 尺寸 | dpr |
|---|---|---|---|
| 页面上的画布 `#pulse-canvas` | **只有表格**（`planTable` 的 layout） | 636 × 444（9 行体例） | 设备 dpr |
| 离屏画布 `#pulse-off-canvas` → 存相册／转发 | 表格 **＋ 寸关尺图示** | 1272 × 1977 | 固定 2 |
| 离屏画布 → 「寸关尺图示」预览 | **只有图示**，按原图 1:1 | 1070 × 876 | 1 |

**为什么不放页面上**：底图只有 1070×876，塞进表格宽的画布里会被放大
（手机 dpr＝3 时放大 1.8 倍），又宽过手机屏 —— 看着是一张糊掉的大手。
预览窗体按原图 1:1 画（scale＝1），所以清晰。

**导出仍然带图示**，与网站端同一套绘制代码、同一 dpr＝2 → 两端导出的 PNG 尺寸一致。

> 离屏画布用 `position:fixed; left:-3000px` 挪到屏幕外，**不能用 `display:none`** ——
> 那样拿不到 canvas 节点（`fields({node:true})` 会返回空）。

### 体例：记录表与录入记录是同一个

「7 脉点（尺只沉）」与「9 行（尺浮中沉）」是**患者的属性**，只有一个真源：库里的 `patients.layout`。

| 页面 | 按什么画 | 怎么改 |
|---|---|---|
| 病例详情页「记录表」（canvas / 导出图） | 库里的 `patients.layout` | 不直接改 —— 去录入页改 |
| 录入页（表格） | 库里的 `patients.layout` | 工具条「体例」按钮，**切换即落库** |

两条纪律：

1. **切换即落库** —— 改一下马上写回库里，所以两个页面永远画一样的行数。
   （2026-11-05 之前这里只改页面状态，导致记录表 7 行、录入记录 9 行同屏打架。）
2. **只改体例、不动格值** —— 7↔9 来回切，「尺浮/尺中」两行的数据仍原样留着，切回来还在；
   但切到 9 行时那两格没数据就是空行（导出的图也会多两行空行），这不是数据丢了。

想看某位患者的体例与格值对不对得上：

```bash
npm run admin -- layout <登录名> <患者id或姓名> nine|seven   # 改，并顺带自检
```

### 记录表：与录入记录是**同一个组件**

「录入记录」和病例详情页的「记录表」现在都渲染 `miniprogram/components/record-sheet/` ——
**版式与交互只有一份**，两处不可能长得不一样。
（Taro 主线同构：组件在 `taro/src/components/record-sheet/`，录入与详情共用同一份 `values`。）

| 页面 | 表格 | 能改吗 | 改完怎么存 |
|---|---|---|---|
| 录入页 `pages/record/record` | `<record-sheet>` | 能 | 改完先在页面 state 里，点「保存」整份存 |
| 病例详情页 `pages/case-detail/case-detail` | `<record-sheet>` | **能**（点格直接改） | **立即落库**（`PATCH /api/visits/:id`，只写回被改动的那一次） |

病例详情页**没有「保存」按钮** —— 那边的「记录表」标题行右侧有「录入编辑」按钮，跳到录入页做
「加记录／改名／换体例」这类整份编辑。

改组件后要**重跑 `cli auto`**（开发者工具不热重载 `components/`、`utils/` 这些非页面模块）。

**坑：视图层会把嵌套数组压成对象。** 自定义组件的属性（`sessions`）会走一圈
逻辑层 → 视图层 → 逻辑层，视图层的数据协议把嵌套数组压成「数字下标的普通对象」
（`["X"]` 回来变成 `{"0":"X"}`）。表现是 `formatCodes` 里 `codes.join` 报
「codes.join is not a function」，而且**是静默失败** —— 表格那一列画不出来，页面看不出所以然。
组件里所有读格值、往外抛 `sessions` 的地方都先按数字下标还原成数组
（`toCodeArray`／`cleanValues`／`cleanSessions`）；服务端 `server/db.mjs` 的 `normalizeValues`
也兜一道（写库前规整、读出来也规整），所以老脏数据照样读得对。

### 开发者工具常用命令

| 事 | 命令 |
|---|---|
| 看登录态 | `cli islogin --port 63190` |
| 开工程 | `cli open --project <小程序目录> --port 63190` |
| 开自动化端口 | `cli auto --project <小程序目录> --auto-port 9420 --trust-project --port 63190` |
| 出预览二维码 | `cli preview --project <小程序目录> -f image -o <输出.png> --port 63190` |
| 上传体验版 | `cli upload --project <小程序目录> -v 1.0.0 -d "说明" --port 63190` |
| 构建 npm | `cli build-npm --project <小程序目录> --port 63190` |

> `--port 63190` 是开发者工具的 HTTP 服务端口，缺了它 `cli` 会报「IDE service port disabled」。

### 和官方 wechatide skill 的关系

开发者工具还自带官方 skill（`wechatide`），能力更多（云开发全套、预览直接推到开发者微信、
`simulator_screenshot` 等）。但它**需要在开发者工具里点一次授权弹窗**才能用；
点不了的时候走上面这条 `cli` + `miniprogram-automator` 的路，功能上覆盖了
编译、导航、截图、日志、预览二维码、上传，**且完全不需要点击**。

---

## 5. 卡住了看这张表

| 现象 | 原因 | 怎么办 |
|---|---|---|
| 页面白屏 / 控制台 `module ... is not defined` | 共享包没编译 | `npm run build:core`（或重跑 `npm run mp:dev`） |
| 「我的」页提示 `url not in domain list` | 域名校验没关 | 详情 → 本地设置 → 勾「不校验合法域名…」 |
| 提示 `request:fail` / timeout（真机） | 手机连的不是同一个网 / 防火墙拦了端口 | 换同一 Wi-Fi；电脑放行 5178；用 `mp:dev` 打出的 IP |
| 「测试连接」连不上但浏览器能开 | 地址填成了网站前端端口 5180 | 后端是 **5178**，前端 5180 不提供 `/api` |
| 一直跳登录页 | 令牌失效或多用户模式下没登录 | 重新登录；单机模式不该出现，检查后端是否为 `PULSE_SINGLE_USER=1` |
| 导出 PNG 存不进相册 | ①后台没声明「相册（仅写入）」②用户拒绝过授权 | ①去后台《用户隐私保护指引》补声明（见 `deploy.md` 6.3）②去设置里重开 |
| `npm run mp:dev` 报端口占用 | 5178 被上一个进程占着 | 关掉旧进程，或 `npm run mp:dev -- --port 6000`（记得同步改「我的」页地址） |

---

## 6. 还没做的事

| 事项 | 状态 | 说明 |
|---|---|---|
| 模拟器冒烟 | ✅ 已做 | 8 个页面逐页跑通、逐页截图、console 干净；抓到并修掉了「出图画不出来」的 bug（见 4.5） |
| 真机验证 | ⬜ 未做 | 代码与数据层都已自动验证，但**从未在手机上跑过**；真机才会暴露相册授权、软键盘/触屏录入手感、字体渲染 |
| 真实 AppID | ✅ 已填 `wx3a21eb903a16cbc4` | 开发者工具需登录对应管理员微信号才能预览／上传 |
| AppSecret | ✅ 在 `.secrets/server.env` | 微信免登要服务端 `code2Session`；已由 `mp:dev` 自动加载 |
| 代码上传私钥 | ✅ 在 `.secrets/` | 给命令行上传用；用前要在后台加 IP 白名单 |
| 合法域名 | ⬜ 没有 | 依赖域名与 ICP 备案（`deploy.md`） |
| 小程序发布清单 | ⬜ | 备案下来后按 `deploy.md` 走 |
