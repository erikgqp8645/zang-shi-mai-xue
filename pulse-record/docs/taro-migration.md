# Taro 迁移约定

> 2026-11-05 小程序从原生（WXML/WXSS/JS）迁到 **Taro 4.3.2 + React 18**。
> 这份是迁移与后续开发的**统一写法**，两侧（网站 / 小程序）都不许各写一套。

## 0. 一句话规矩

> **业务代码里不许出现 `wx.`** —— 一律走 `src/platform/` 适配层。

原因很直接：近期要上鸿蒙，而鸿蒙没有 `wx`。所有平台差异都收在适配层里，
将来加平台只改那一个目录。

（适配层内部才允许 `wx.`：目前只有 `platform/cloud.ts` 用 `wx.cloud.callFunction`，
且全程 `typeof wx` 守卫，鸿蒙侧自动降级。）

## 1. 目录与文件

```
pulse-record/
├── src/                      ← 网站（React 19，零改动）
│   ├── domain/               ← 纯 TS 知识库（Taro 通过 alias 直接引）
│   └── export/               ← table-painter / diagram / canvas / text（只被引这四个）
├── taro/                     ← 小程序 / 鸿蒙（Taro 4.3.2 + React 18）
│   ├── config/index.ts       ← Taro 配置
│   ├── project.config.json   ← 微信开发者工具打开的是这个（miniprogramRoot=dist/）
│   └── src/
│       ├── app.config.ts     ← 4 个 tab + 页面注册
│       ├── app.tsx / app.scss
│       ├── pages/<名>/index.tsx + index.config.ts + index.scss
│       ├── components/<件>/index.tsx + index.scss
│       ├── store/            ← 全局上下文（context）
│       ├── platform/         ← 平台适配层
│       └── utils/            ← api / auth / storage / config / data
└── miniprogram/              ← 原生版（P1 期间保留作回退，功能对齐后退役）
```

**页面三件套**：`index.tsx`（组件）＋ `index.config.ts`（页面配置）＋ `index.scss`（页面私有样式）。
全局设计令牌在 `src/app.scss`，**不要**在页面里重复定义颜色。

## 2. 依赖与别名

| 用途 | 写法 |
|---|---|
| Taro 运行时 | `import Taro from '@tarojs/taro'` |
| UI 组件 | `import { View, Text, Input, ScrollView } from '@tarojs/components'` |
| 知识库 | `import { groupRows } from '@domain/layout'` |
| 数据契约类型 | `import type { Visit } from '@domain/api'` |
| 共享绘制器 | `import { paintTable } from '@export/table-painter'` |
| 数据接口 | `import { listPatients } from '../../utils/data'` |
| 账号 | `import { login } from '../../utils/auth'` |
| 平台能力 | `import { saveImageToAlbum } from '../../platform/album'` |

### alias 纪律（重要）

- `@domain/*` → `pulse-record/src/domain/*`：纯 TS，零 DOM/Node 依赖。
- `@export/*` → `pulse-record/src/export/*`：
  - ✅ 只 import `table-painter` / `diagram` / `canvas` / `text`
  - ❌ **绝不 import `png.ts` / `download.ts`** —— 那是浏览器专用（依赖 DOM），
    小程序侧另写 `platform/canvas.ts`。

## 3. React 版写法对照（原生 → Taro）

| 原生 | Taro |
|---|---|
| `Page({ data: {...} })` | `useState` |
| `this.setData({x})` | `setX(...)` |
| `onLoad(options)` | `useEffect(() => {...}, [])` ＋ `useRouter()` 取参数 |
| `onShow()` | `useDidShow(() => {...})`（`@tarojs/taro`） |
| `onPullDownRefresh()` | `usePullDownRefresh(() => {...})` ＋ `Taro.stopPullDownRefresh()` |
| `wx.showToast` | `Taro.showToast` |
| `wx.showModal` | `Taro.showModal` |
| `wx.navigateTo` | `Taro.navigateTo` |
| `wx.switchTab` | `Taro.switchTab` |
| `wx.setClipboardData` | `Taro.setClipboardData` |
| `wx.request` | `platform/request.ts` 的 `request()` |
| `wx.getStorageSync` | `platform/storage.ts` 的 `getStorageSync()` |
| `<view bindtap="x">` | `<View onClick={x}>` |
| `<input bindinput="x" />` | `<Input onInput={(e) => x(e.detail.value)} />` |
| `<scroll-view scroll-x>` | `<ScrollView scrollX>` |
| `catchtap` | `onClick={(e) => e.stopPropagation()}` |
| `wx:for` | `.map()`（**记得 `key`**） |
| `wx:if` | `{cond ? ... : null}` |
| `wx:elif` | `{cond ? ... : null}` 链 |

## 4. 组件写法

```tsx
export interface XxxProps { /* ... */ }

export default function Xxx(props: XxxProps) {
  const [state, setState] = useState(initial)
  return <View className='pr-xxx'>…</View>
}
```

- 样式用**全局类名**（`.pr-*`），不写 CSS Module（config 里 `cssModules.enable: false`）。
- 组件事件：父组件传函数 props（如 `onChange`），不搞 `triggerEvent`。
- **父组件传进来的数组**：组件内部用 `useState` 持有副本；
  父组件传来的内容**变了才同步**（比内容而不是比引用），
  否则父组件每次 render 新建数组会把用户正在输入的内容冲掉。

```tsx
useEffect(() => {
  const incoming = clean(props.sessions)
  setLocal((prev) => (sameSessions(prev, incoming) ? prev : incoming))
}, [props.sessions])
```

## 5. 形状规整（跨进程的老坑）

组件属性要经过「逻辑层 → 视图层 → 逻辑层」，**嵌套数组会被压成数字下标的普通对象**：
`["X"]` 回来变成 `{"0":"X"}`。于是 `codes.join` 直接抛「not a function」——**静默失败**。

所以：**凡是读格值、凡是往外抛 sessions，都先按数字下标还原回数组。**

这四个纯函数住在 **`src/components/record-sheet/shapes.ts`**（不在 `index.tsx` 里）：

| 函数 | 作用 |
|---|---|
| `toCodeArray(v)` | 把一个格子的符号还原成数组（`{"0":"X"}` → `["X"]`） |
| `cleanValues(values)` | 把一次就诊的每个格值都规整成数组，空格子丢掉 |
| `cleanSessions(sessions)` | 整份 sessions 逐条规整 |
| `sameSessions(a, b)` | 比**内容**而不是比引用 —— 用来判断父组件传来的是不是「同一份」 |

单独成文件有两个原因：
① `taro-sim.mjs` 可以直接把它打成产物断言（纯函数，不需要开发者工具）；
② **别处要复用同一份实现** —— `medication-panel` 也读 `values`，
两处各写一份，漂移了就重演「一处修了另一处没修」。

服务端 `server/db.mjs` 的 `normalizeValues` 做同一件事 —— 两端都兜住。

## 6. 体例规矩（不可改）

- 记录表的**版式**照抄讲义 2026-10 PDF p34「④ 脉象记录」实例表：
  部位列（橙 `#FFC000`）纵向合并一组三行、组内不画横线；表底 `#CCE8CF`；网格线 `#000000`。
- 体例只有**一个真源**＝库里的 `patients.layout`（`nine` 9 行 / `seven` 7 脉点）。
  任何界面改它都**立刻落库**。
- **改体例只改体例、不动格值**：7↔9 来回切，「尺浮/尺中」两行的数据仍留着。
- 记录表与录入记录**必须是同一个组件**（`components/record-sheet`）——
  版式与交互只有一份，不许再各画各的。
- 录入视图可加「一次一屏」竖排，但那是**同一个组件的第二个渲染分支**，
  与宽表共用同一份 `values`，不新增第二份真源。

## 7. 术语与引用纪律

- **一律使用讲稿/讲义原文用字**：病油子、清挡路、有尺脉、上盛下虚、
  依脉辨证论治、三焦疗法／五脏疗法／一体疗法（三法并列，勿合并为「三法」）。
- 讲义内容标 `（讲义 2026-10·pNN）`，讲稿内容标 `（讲稿 2010·第N讲）`，
  同和堂版标 `（同和堂版 pN）`。
- **转述不得加引号**；只有逐字引自原文才加引号。
- 讲稿 2010 与讲义 2026-10 是**两条资料线**，体质命名体系不同，
  **禁止互换或合并**（2010：肾虚／上盛下虚／有尺脉；2026 讲义：1/2/3 号）。
- 剂量单位：同和堂版＝**克**，讲稿＝**比例制** —— 两套不可换算、不可合并。
- 不替读者加减方、不下诊断；页面要声明「不构成诊断」。

## 8. 包体

- 微信主包上限 **2 MB**；`dist/` 现状 **928 KB**（2026-11-06 实测：
  Taro runtime 212 KB ＋ 公共 chunk 176 KB ＋ 页面 chunk 180 KB ＋ base.wxml 60 KB ＋ wxss 52 KB ＋ 图片 160 KB）。
- **知识库的入口要收得住**，别散落到各处随手引。现在允许引的地方只有三处：
  - `pages/formulas` —— 「用方」tab，知识库的主入口；
  - `components/medication-panel` —— 就诊工作台「方药」档里的用药记录块，
    要选方、要看讲稿比例制与同和堂版克数两套组成（原生 medication 页的核心功能）；
  - `components/visit-triad` —— 体质／疗法／方药三档要查方剂组成（`dose-lookup`），
    以及 ③ 的方名可点进「用方」看完整条目（`formula-links`，见 §3.16）。

  `taro-lint.mjs` 第 6 条盯着这条（白名单按路径**包含**匹配，不是全等）。
- **纯类型引用不算「引用」**：`import type { X } from '@domain/…'` 编译后一行代码都不留
  （`store/focus.ts` 只要 `FormulaLink` 这个类型），扫描时要剔掉，
  否则会把没拖代码进来的文件误判成违规。
- `visit-triad` 引 `formula-links` 的包体代价**实测 +4 KB（主包 924 → 928 KB，0.4%）** ——
  知识库本来就在主包里（「用方」是 tabBar 页），这次只是多拖进 `formulas.ts`。

> 注：这条纪律原本是「省包体」，但**微信 tabBar 页必须在主包**，
> 而「用方」就是 tab 页 —— 知识库本来就一定在主包里，分包这条路已经不成立。
> 剩下的价值只有「入口收得住」这一条。

- tabBar 图标是 `src/assets/tabbar/*.png`，由 `npm run mp:icons` 生成
  （自写 PNG 编码器，只用 Node 内置 `zlib`，不引图像库）。
  图标**画线稿、2px 描边、圆头**，配色取界面的次色 `#7c8974` / 主色 `#2c2925`。

## 9. 鸿蒙（C-API）

鸿蒙走 **`harmony_cpp`**（不是 `harmony`）—— 见 §2 的版本事实。
**只支持 Vite**，所以 `compiler: 'vite'` 不能改。

### 9.1 一条命令出 HAP

```bash
cd pulse-record
node scripts/harmony-build.mjs              # 全流程
node scripts/harmony-build.mjs --skip-taro  # 只重编（.ets 没变时快很多）
```

出包位置：`~/AiCoding/harmony-pulse-record/entry/build/default/outputs/default/default-default-unsigned.hap`（约 9 MB）。

流程（`scripts/harmony-build.mjs`）：

1. rsync 仓库的 `harmony/` → 镜像目录（**不删**镜像里多出来的文件）
2. 写 `local.properties`（`sdk.dir` 指向 DevEco 自带的 SDK）
3. Taro 构建：`TARO_HARMONY_PROJECT=镜像` → `.ets` 产物写进镜像
4. **ArkTS 严格模式补丁**（§9.4）
5. **rawfile 资源对齐**（§9.5）
6. `ohpm install`（工程根 ＋ `entry` 模块 —— 依赖在 entry 的 oh-package 里）
7. `devecocli build`
8. 打印 HAP 路径

环境变量：`PULSE_HARMONY_HOME`（默认 `~/AiCoding/harmony-pulse-record`）、`DEVECOCLI_PATH`（默认 `devecocli`）。

### 9.1.1 为什么最后一步用 `devecocli build`

手工调 `hvigorw` 要自己拼三样东西：

- **hvigor 软链** —— `@ohos/hvigor` **不在 npmjs 上**，只能用 DevEco 自带那份
- **`DEVECO_SDK_HOME`** —— 要指向 SDK **根**目录（`Contents/sdk`），不是版本目录
- **`JAVA_HOME`** —— `PackageHap` 要跑 Java，本机系统里没有 java，只有 DevEco 自带的 JBR

缺一样就是一次编译失败。**`devecocli build` 自己把这三样都解析好了** ——
实测**把软链移走也能构建成功**（release 模式 16.9s）。
所以构建脚本只留这一条路径，不做「两套都支持」。

前置：`npm i -g @deveco/deveco-cli@stable`（外加装了 DevEco Studio）。

### 9.1.2 部署到设备（`scripts/harmony-run.mjs`）

出包不需要账号，**部署需要** —— 签名材料和模拟器的设备身份（SN）都要向华为服务器申请。

```bash
node scripts/harmony-run.mjs doctor     # 体检：登录 / 镜像 / 实例 / 设备
node scripts/harmony-run.mjs emulator   # 确保镜像与实例就位，并启动模拟器
node scripts/harmony-run.mjs deploy     # 签名 → 构建 → 装机 → 截图
node scripts/harmony-run.mjs --download # 全流程（顺便下镜像，几个 G）
```

**登录**：`devecocli auth login` —— 会提示「Press Enter to open browser for login」，
**必须按回车**（不按就不动），然后浏览器里确认授权。

> ⚠️ **DevEco Studio 的登录态和 `devecocli` 的不通用**（两边各存各的凭证，
> CLI 存 `~/.deveco/` 的加密 token）。已经在 IDE 里登录了，**还是要单独跑一次 CLI 的登录**。

`devecocli` 还有 `ui screenshot/layout/click/text/swipe` —— **设备上的 UI 自动化**，
可以照着微信小程序那套 `taro-tabs.mjs` 的思路做鸿蒙端的四档 tab 回归。
另有 `check lint`（ArkTS linter）、`skills`（53 个鸿蒙技能）、`docs`（本地 HarmonyOS 文档）。

**模拟器实例的三个坑**（都踩过）：

1. 实例名**不能有连字符** → `pulse-phone` 被拒，用 `pulse_phone`
2. `Emulator -instancePath` 要传**父目录**（传实例目录会报 `"…" is not found. Please create the device(folder): …/pulse_phone/pulse_phone`）
3. `-bootMode cold` **不被接受**（`Command bootmode invalid! Use default.`）→ 别传

### 9.2 为什么必须镜像到 ASCII 路径

hvigor / DevEco **不接受含中文的工程路径**：

```
ERROR: 00306003 Specification Limit Violation
Error Message: Invalid project path. Current path does not match: …/臧氏脉学/…
```

而本仓库就躺在 `~/AiCoding/臧氏脉学/` 下面 —— **仓库路径本身带中文**。
符号链接也绕不过：`node` 的 `process.cwd()` 会把软链解析成**真实路径**，报错里仍然是带中文的那条（实测）。

→ 所以定成：**仓库里的 `harmony/` 是工程的唯一真源**（配置与资源入库），
**编译时镜像到一条纯 ASCII 路径**再编。

### 9.3 Taro 产物与 DevEco 模板的接管关系

这不是「未确定」，是**已查实**的：

- Taro 生成的 `entry/src/main/ets/app.ets` **本身就是一个完整的 `export default class EntryAbility extends UIAbility`**，
  它 `stage.loadContent('taro_tabbar', ...)`。
- `taro_tabbar.ets` 是 `@Entry @Component struct Index`（＝ 模板里的 `pages/Index.ets`）。
- **所以模板自带的 `entryability/EntryAbility.ets` ＋ `pages/Index.ets` 不能作为 srcEntry**；
  `module.json5` 的 `srcEntry` 要指向 `./ets/app.ets`，
  `main_pages.json` 要列 `"taro_tabbar"` ＋ 非 tab 页路由。
- 插件的 `updateModulePackage()` 在 4.3.2 里**会跑**（合并 `opts.ohPackage.dependencies` 进 `entry/oh-package.json5` 并自己调一次 ohpm install），依赖仍需自己声明。

### 9.4 踩过的坑（全部已定位并修掉）

| 坑 | 现象 | 处理 |
|---|---|---|
| **平台没注册** | `Error: 不存在编译平台 harmony_cpp` | CLI 4.3.2 的内置平台清单里**没有** `harmony_cpp`，得在 `config/index.ts` 的 `plugins` 里自己挂 `@tarojs/plugin-platform-harmony-cpp` |
| **插件漏声明依赖** | `Cannot find module '@babel/preset-typescript'` | `@tarojs/plugin-platform-harmony-cpp` 自己 require 了它却没写进 dependencies —— 本工程显式装上 |
| **babel 解析不了 TSX** | `SyntaxError: src/app.tsx: Unexpected token, expected "from"` | 上游 `@tarojs/vite-runner` 那个 `enforce: 'pre'` 的 babel 插件**没给 preset**，却跑在 vite 的 esbuild 之前 → 拿到原始 TSX。绕行见 `config/harmony-workaround.ts` |
| **工程路径含中文** | `00306003 Specification Limit Violation` | 镜像到纯 ASCII 路径（§9.2） |
| **`@ohos/hvigor` 装不上** | `npm install` 404 | `@ohos/hvigor` **不在 npmjs 上**，只能用 DevEco 自带那份。**现在不用管了** —— 走 `devecocli build`（§9.1.1），它自己解析 |
| **插件自己调 ohpm 失败** | 退回 `~/Library/Huawei/ohpm/bin/ohpm` 报错 | 把 `Contents/tools/ohpm/bin` 放进 `PATH` |
| **模拟器实例缺设备身份** | 实例日志里 `can not read sn` / `can not read uuid file` → 模拟器**静默起不来**，没有任何报错提示 | SN 要向华为服务器签发 → **必须 `devecocli auth login`**（IDE 的登录态与 CLI 不通用，§9.1.2） |
| **SDK 版本太低** | `00306004 Specification Limit Violation`：`compatibleSdkVersion: 12 cannot be lower than the minimum compatible version 14 required by the dependencies: @taro-oh/library` | taro 的 har 声明了 `compatibleSdkVersion: 14` → 提到 `"6.0.0(20)"` |
| **ArkTS 严格模式** | `1 ERROR: 10605999 ArkTS Compiler Error`：`Variable 'levelRes' is used before being assigned`（`app.ets:77`） | 上游模板的 `switch` 没有 `default` 分支 → 补初值 `0`（语义不变）。见 §9.4.1 |
| **打包要 Java** | `00308018 Unknown Error` / `Unable to locate a Java Runtime` | 本机系统里没有 java，只有 DevEco 自带的 JBR。**现在不用管了** —— `devecocli build` 自己指 JBR（§9.1.1） |
| **权限字段名** | schema 校验失败 | **模块级** `module.json5` 用 `requestPermissions`（写 `reqPermissions` 会被 schema 拦下） |

#### 9.4.1 ArkTS 严格模式补丁

上游 `@tarojs/vite-runner@4.3.2` 的鸿蒙 app 模板（`dist/harmony/template/app.js`，硬编码字符串）：

```ts
onMemoryLevel(level: AbilityConstant.MemoryLevel) {
  let levelRes: number          // ← 没有初值
  switch (level) {
    case MEMORY_LEVEL_MODERATE: levelRes = 5;  break
    // …没有 default 分支
  }
  if (levelRes) { … }           // ← 编译器无法证明 switch 一定命中某个分支
}
```

ArkTS（ArkTS 1.2 严格模式）要求「使用前必须赋值」→ 编译直接失败。
**最小修正：给个初值 `0`。语义完全不变** —— 原来没命中分支时是 `undefined`（falsy），
修正后是 `0`（同样 falsy），`if (levelRes)` 的判断结果一模一样。

为什么不改 Taro 侧：那份模板是 `node_modules` 里的硬编码字符串，改不了也不该改（升级即丢）。
所以放构建脚本里做后处理，**补丁本体是纯函数**：`scripts/lib/harmony-arkts-patch.mjs`。
它**幂等**（打过就原样返回），**模板变了就抛错**（不静默放过），
并由 `scripts/e2e/harmony-lint.mjs` 直接测。

### 9.5 tabBar 图标要在 rawfile，不在 ets/assets

Taro 的鸿蒙编译链把 tabBar 图标发射到 **vite 产物根**（`entry/src/main/ets/assets/tabbar/*.png`）：

- `dist/harmony/entry.js:51` —— rawfile 目录＝`resolve(outputRoot, '..')/resources/rawfile`
- `dist/harmony/entry.js:91-113` —— tabbar 图标 `emitFile({type:'asset'})`

但 ArkUI 的 `Image('相对路径')` 找的是 **rawfile**，不是 ets 目录：

```ts
Image(this.tabBarCurrentIndex === index && item.selectedIconPath || item.iconPath)
```

`iconPath` 就是 `app.config.ts` 里写的 `assets/tabbar/cases.png` → 按 rawfile 解析。

所以构建脚本里有一步 **rawfile 资源对齐**：把 `ets/assets/` 整份拷到 `resources/rawfile/assets/`，
路径结构原样保留。少了这步，**编译照过、四个 tab 就是没图标**。

### 9.6 权限与明文 HTTP

- **网络权限**：鸿蒙应用默认**没有**网络能力，必须在 `entry/src/main/module.json5` 里声明
  `requestPermissions: [{ name: 'ohos.permission.INTERNET', reason: '…', usedScene: {…} }]`。
  不声明的话编译照过、装得上，但**一个请求都发不出去**。
- **明文 HTTP**：后端是局域网 `http://`，所以在 module 级开
  `metadata: [{ name: 'ohos.net.http.cleartextTraffic', value: 'true' }]`。
  （工程级的 `deviceConfig.default.network.cleartextTraffic` 在本工程**不生效** ——
  实测编译后的 `module.json` 里 `deviceConfig` 为 `null`。）
- 鸿蒙 runtime 的请求走 **`rcp`（RemoteCommunicationKit）**，不是 `@ohos.net.http`，
  两者是不同实现；rcp 不继承 `@ohos.net.http` 的明文限制。

### 9.7 还没做的

- **模拟器实测**：镜像已下好（`HarmonyOS 7.0.0(26.0.0)` phone → `~/Library/Huawei/Sdk/system-image/`），
  实例也建好了（`pulse_phone`）。**只差 `devecocli auth login`** —— 登录后
  `node scripts/harmony-run.mjs deploy` 就能装机 + 截图。
- **签名**：`build-profile.json5` 里 `signingConfigs` 为空 → 出的是 **unsigned** 包。
  `devecocli signature generate` 会自动生成并写进配置（要登录）。
- **关系图（寸关尺）在鸿蒙上的渲染**还没验证 —— 小程序侧是自绘 canvas，鸿蒙侧走 C-API 的 canvas，还没确认。

### 9.8 回归

`npm run test:e2e:harmony`（`scripts/e2e/harmony-lint.mjs`，57 项）——
静态守住「能出 HAP」这件事：工程骨架、SDK 版本下限、权限、明文开关、
入口与路由、har 依赖、tabBar 图标与 rawfile、ArkTS 补丁（纯函数直接测）、
产物不入库、ASCII 路径约束。

## 10. 回归

| 脚本 | 查什么 |
|---|---|
| `npm run test:e2e:mp` | `taro-lint.mjs` —— 扫 TSX 源码（禁止 `wx.` 直调、禁止 `.wxml/.wxss` 残留、组件同源…） |
| `npm run test:e2e:mp:api` | `taro-api.mjs` —— mock `Taro.request`，查数据层契约 |
| `npm run test:e2e:mp:sim` | `taro-sim.mjs` —— 纯函数断言 ＋ 编译产物断言 ＋ 模拟器截图冒烟 |
| `npm run test:e2e:mp:tabs` | `taro-tabs.mjs` —— 就诊工作台四档页内 tab 的模拟器回归 |
| `npm run test:e2e:mp:link` | `taro-formula-link.mjs` —— ③ 的方名点进「用方」页：定位 ＋ 高亮 ＋ 锚点唯一 ＋ 真的滚过去了（§3.16） |
| `npm run test:e2e:sheet` | `sheet-layout-probe.mjs` —— **记录表的列界在真实浏览器里量坐标**（§10.1） |
| `npm run test:e2e:harmony` | `harmony-lint.mjs` —— 鸿蒙工程配置静态检查（§9.8） |
| `npm test` | 全部（网站端 core / migration / auth / app / desktop ＋ 小程序静态四套 ＋ 鸿蒙） |

**新增断言必须先用「故意写坏」验证能抓到**，否则不算数。

### 10.1 记录表的列界怎么验（`test:e2e:sheet`）

「宽表竖线错开」那类毛病（2026-11-07 修的那条）**光看源码不够** ——
宽度写对了，渲染出来仍可能偏；光看截图也不够（缩放、压缩都会挪 1~2 px）。

`sheet-layout-probe.mjs` 的做法：

| 步 | 做什么 |
|---|---|
| ① | 用 `react-dom/server` 把 **`components/record-sheet` 这个组件本身** 渲成静态 HTML（讲义 p34 少娟实例，6 次记录 ＝ 12 列） |
| ② | 套上**编译产物里那两份 WXSS**（`dist/app-origin.wxss` ＋ `dist/common.wxss`，rpx 按 375 宽折成 px） |
| ③ | 在无头 Chrome 里量每个格子的 `getBoundingClientRect()` |
| ④ | 比对：**表头「左/右」行的列界** 与 **正文每一行数据格的列界** 必须是同一组坐标 |

⚠️ **两份 WXSS 都要**：少 `app-origin.wxss` 就没有全局的
`view,text{box-sizing:border-box}` —— 每个带边框的格子都会宽出边框那一份，
表头与正文就差那么几 px（量出来是 2px）。**这个坑踩过一次。**

**探针本身也要验**：把两个文件 `git checkout` 回带 bug 的版本重跑 → 应当报出多条失败；
换回修好的版本 → 全绿。**探针不是摆设。**

**顺便出图**（给人看的，不参与断言）：设 `PULSE_SHOT_DIR` 会在量坐标的同一次渲染里
多截一张图 —— `sheet-wide.png`（宽表）、`sheet-single.png`（一次一屏）。

```bash
cd pulse-record
PULSE_SHOT_DIR=/tmp/shots node scripts/e2e/sheet-layout-probe.mjs
```

环境变量名与 `scripts/harmony-run.mjs` 一致，**别另起一个**。

> 为什么用浏览器而不是小程序模拟器：开发者工具的登录态会过期
> （本轮实测 `cli auto` 直接报「需要重新登录」），没法进真实运行时。
> 而布局是纯 CSS —— 同一份 DOM ＋ 同一份样式，在 Chromium 里量出来的就是小程序里的布局
> （小程序的 webview 就是 Chromium）。

## 11. 开发者工具

```bash
CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli"
cd pulse-record
$CLI open    --project "$PWD/taro" --port 63190
$CLI auto    --project "$PWD/taro" --auto-port 9420 --trust-project --port 63190
$CLI preview --project "$PWD/taro" -f image -o ~/Downloads/mp-preview.png --port 63190
```

- 打开的是 **`taro/`**（不是 `miniprogram/`），`miniprogramRoot` 指向 `dist/`。
- 改 `taro/src/**` 后重跑 `taro build --type weapp`（或用 watch 模式）。
- `cli preview` 的 `-o` 路径**不能用 `/tmp`**（软链解析导致「二维码输出路径无效」），用 `~/Downloads/…`。
- `cli open` / `cli auto` 是**长驻命令**，前台跑必然超时 —— 放后台跑。

### 自动化端口可能不是你要的那个

`cli auto --auto-port 9420` 会打印实际用的端口：

```json
{ "autoPort": 9421, "requestedAutoPort": 9420 }
```

**9420 被原生工程占着时它会退到 9421。** 跑回归前先确认端口：

```bash
lsof -nP -iTCP:9421 -sTCP:LISTEN
MP_SIM_WS=ws://127.0.0.1:9421 node scripts/e2e/taro-sim.mjs
```

### `miniprogram-automator` 的 API（别照着旧代码想当然）

- `connect()` 返回的**就是 MiniProgram**，它**自己没有 `launch`**（`launch` 在 Automator 实例上）。
- **截图是 `MiniProgram.screenshot({path})`**，`Page` 上**没有** `screenshot` 方法。
- tabBar 页用 `switchTab` 切；`reLaunch` 也行。
- `switchTab` 在 Taro 下**可能超时**（`timeout waiting for automator response`），
  但**其实已经切过去了** —— 用 `currentPage()` 复核，别把这个超时当失败。
- 页面实例方法（`page.callMethod()`）在 Taro 下**彻底用不了**（页面是 React 组件），
  所以断言拆成「纯函数 ＋ 产物 ＋ 截图」三段。
