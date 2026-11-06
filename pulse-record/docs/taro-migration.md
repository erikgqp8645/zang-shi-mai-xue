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

- 微信主包上限 **2 MB**；`dist/` 现状 **0.99 MB**（Taro runtime 214 KB ＋ 知识库 237 KB ＋ 页面 96 KB ＋ 图片 398 KB）。
- **知识库的入口要收得住**，别散落到各处随手引。现在允许引的地方只有三处：
  - `pages/formulas` —— 「用方」tab，知识库的主入口；
  - `components/medication-panel` —— 就诊工作台「方药」档里的用药记录块，
    要选方、要看讲稿比例制与同和堂版克数两套组成（原生 medication 页的核心功能）；
  - `components/visit-triad` —— 体质／疗法／方药三档要查方剂组成。

  `taro-lint.mjs` 第 6 条盯着这条（白名单按路径**包含**匹配，不是全等）。

> 注：这条纪律原本是「省包体」，但**微信 tabBar 页必须在主包**，
> 而「用方」就是 tab 页 —— 知识库本来就一定在主包里，分包这条路已经不成立。
> 剩下的价值只有「入口收得住」这一条。

- tabBar 图标是 `src/assets/tabbar/*.png`，由 `npm run mp:icons` 生成
  （自写 PNG 编码器，只用 Node 内置 `zlib`，不引图像库）。
  图标**画线稿、2px 描边、圆头**，配色取界面的次色 `#7c8974` / 主色 `#2c2925`。

## 9. 鸿蒙（C-API）

鸿蒙走 **`harmony_cpp`**（不是 `harmony`）—— 见 §2 的版本事实。
**只支持 Vite**，所以 `compiler: 'vite'` 不能改。

```bash
cd pulse-record/taro
TARO_HARMONY_PROJECT=/path/to/DevEcoProject npm run build:harmony
```

产物落在 `<TARO_HARMONY_PROJECT>/<hapName>/src/main/ets/`：
`app.ets`、`render.ets`、`taro_tabbar.ets`、`pages/*/index.ets`、`pages/*/index_style.json`。

**出 HAP 还需要 DevEco Studio 与 ohpm**（本机没有），
编译阶段会提示 `ohpm install` 失败 —— 那一步在 DevEco 里点 Sync Now 即可。

### 三个必须踩过才知道的坑

| 坑 | 现象 | 处理 |
|---|---|---|
| **平台没注册** | `Error: 不存在编译平台 harmony_cpp` | CLI 4.3.2 的内置平台清单里**没有** `harmony_cpp`，得在 `config/index.ts` 的 `plugins` 里自己挂 `@tarojs/plugin-platform-harmony-cpp` |
| **插件漏声明依赖** | `Cannot find module '@babel/preset-typescript'` | `@tarojs/plugin-platform-harmony-cpp` 自己 require 了它却没写进 dependencies —— 本工程显式装上 |
| **babel 解析不了 TSX** | `SyntaxError: src/app.tsx: Unexpected token, expected "from"` | 上游 `@tarojs/vite-runner` 那个 `enforce: 'pre'` 的 babel 插件**没给 preset**，却跑在 vite 的 esbuild 之前 → 拿到原始 TSX。绕行见 `config/harmony-workaround.ts` |

绕行补丁的四个坑（都写在 `config/harmony-workaround.ts` 的注释里）：
① 钩子不能写成插件对象的方法；② 不能写在 `config/index.ts` 的配置字段里；
③ 默认导出必须是工厂函数；④ `config.plugins` 只收字符串。

**微信端完全不受影响** —— 补丁只在 `TARO_ENV=harmony_cpp` 时注册。

## 10. 回归

| 脚本 | 查什么 |
|---|---|
| `npm run test:e2e:mp` | `taro-lint.mjs` —— 扫 TSX 源码（禁止 `wx.` 直调、禁止 `.wxml/.wxss` 残留、组件同源…） |
| `npm run test:e2e:mp:api` | `taro-api.mjs` —— mock `Taro.request`，查数据层契约 |
| `npm run test:e2e:mp:sim` | `taro-sim.mjs` —— 纯函数断言 ＋ 编译产物断言 ＋ 模拟器截图冒烟 |
| `npm test` | 全部（网站端 core / migration / auth / app / desktop ＋ 小程序三套） |

**新增断言必须先用「故意写坏」验证能抓到**，否则不算数。

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
