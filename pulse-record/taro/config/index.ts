import path from 'node:path'
import { defineConfig } from '@tarojs/cli'
import devConfig from './dev'
import prodConfig from './prod'


/**
 * Taro 工程配置 —— 臧氏脉学 · 脉象记录表生成器
 *
 * ## 为什么要换 Taro（2026-11-05）
 *
 * 原生小程序（`../miniprogram/`）的界面零散、手机用户要多次返回才能完成一次就诊。
 * 重排信息架构解决的是「小程序好不好用」，但用户近期还要上鸿蒙 —— 那就得换跨端框架。
 *
 * 候选只有 Taro：Kuikly 是 Kotlin/KMP 重写（domain 是 TS、website 是 React，代价不成比例），
 * FinClip 是商业容器（解决不了信息架构还多授权费）。
 *
 * ## 三条硬约束（2026-11-05 实测 npm 得出）
 *
 * 1. **React 版本要分家**：Taro 4.3.2 的 `@tarojs/plugin-framework-react` peer 是 `react: ^18`。
 *    网站端保持 React 19.3.1 不动 —— 本工程 `taro/` 自带 `node_modules`，两套互不干扰。
 *    共享的 domain 是纯 TS 无 React，不受影响。
 *
 * 2. **鸿蒙锁 C-API 路线**：`@tarojs/plugin-platform-harmony` 在 npm 上 latest 是 3.6.0（无 4.x），
 *    与 CLI 4.3.2 不兼容；只有 `@tarojs/plugin-platform-harmony-cpp` = 4.3.2 与 CLI 严格同版本。
 *    所以鸿蒙目标是 `taro build --type harmony_cpp`，**且 C-API 只支持 Vite** ——
 *    这就是下面 `compiler: 'vite'` 不能改的原因。
 *
 * 3. **vite 是 peer 不是内置**：`@tarojs/vite-runner` 把 `vite` 列为 peer（`^4`），
 *    所以本工程装 vite 4 —— 与网站端 Vite 8 天然隔离，互不影响。
 *
 * ## alias 纪律（共享只到 domain 与绘制器，view 层不共享）
 *
 * - `@domain/*` → `../src/domain/*`：纯 TS，零 DOM/Node 依赖（已实测）。
 * - `@export/*` → `../src/export/*`：**只 import `table-painter` / `diagram` / `canvas` / `text`**。
 *   `png.ts` 是浏览器专用（含 DOM 依赖），小程序侧另写 `src/platform/canvas.ts`，绝不在这里 import。
 * - `src/domain` 内部全是相对 import，alias 后仍能解析，源码零改动。
 */

const ROOT = path.resolve(__dirname, '..')
const SHARED = path.resolve(ROOT, '..', 'src')

/**
 * 与网站端共用的图 —— **真源仍是 `pulse-record/src/assets`**，小程序包里的那份是拷贝。
 *
 * ## 为什么不用 `import` 拿图
 *
 * `import img from '../assets/x.png'` 在 Taro 4 的 vite 目标下会报
 * 「fileName 必须是既非绝对路径也非相对路径的字符串」——
 * 那是 Taro `vite-plugin-assets` 的已知毛病，这两张图因此**不能走 import**。
 *
 * ## 两条硬规矩（2026-11-05 实测踩坑后定，改这块之前先读完）
 *
 * 1. **`from` 必须用正斜杠。**
 *    copy 插件底层是 fast-glob，而 fast-glob 里反斜杠是转义符 ——
 *    Windows 上 `path.resolve()` 给的反斜杠路径**一律匹配 0 个，而且不报错**（静默跳过）
 *    → 图没进包 → 真机点「看寸关尺图示」提示「底图没载入」。
 *    所以这里统一把反斜杠换成正斜杠。
 *
 * 2. **`to` 必须带扩展名。**
 *    Taro 的 `convertCopyOptions`：`to` 带扩展名 → `to` 取目录部分、`rename` 取文件名；
 *    `to` 不带扩展名（写成 `assets/`）→ `rename` 被塞成 `'/'`，
 *    而复制器把字符串型 `rename` **直接当目标文件名** → 所有图撞到同一路径 → 只剩最后一张。
 *    所以：**一条 pattern 对应一张图**，`to` 写成 `assets/<文件名>`。
 *
 * ## 图从哪来
 *
 * 直接指向 `pulse-record/src/assets/`（在 `taro/` 工程目录**之外**）——
 * copy 插件不限制工程外的路径（实测过），不需要先同步进工程内。
 *
 * ## 为什么是 JPEG 而不是 PNG（2026-11-05）
 *
 * 微信开发者工具「代码质量 → 代码包 → 图片和音频资源大小不应超过 200 K」
 * 这条**未通过**，根因是底图 298 KB。
 *
 * 底图是**真人手部照片 ＋ 印刷标注**，PNG 无损重编码压不动（300 KB 地板），
 * 缩到 850×696 还是 220 KB 且印刷字发糊。
 * 所以改用**同尺寸 JPEG**（`scripts/compress-assets.mjs` 生成，1070 × 876 不变）：
 * 180.7 KB，2 倍放大下「心／肝／肾—寸／关／尺」完全清晰。
 *
 * **尺寸必须不变** —— 覆盖层标记坐标（`src/domain/diagram.ts`）是按原图像素量的，
 * 底图一缩放标记就跑位。
 *
 * **网站端仍用 PNG**（`src/export/png.ts` 导出 PNG，底图有损会二次压缩）；
 * 两份图并存是刻意的，不是重复。
 *
 * ## 为什么只有这一张（`triad-p47.png` 不进包）
 *
 * `triad-p47.png`（91.6 KB，讲义 p47 三部曲原图）在小程序端**没有任何地方引用**
 * —— 小程序的三部曲是 `components/visit-triad` 用 `pr-triad-*` 样式**画**出来的，
 * 不是贴图。它只被网站端的 `src/components/TriadImage.tsx` 用。
 * 所以小程序包**不带它**（省 91.6 KB）；网站端那份照旧。
 */
const SHARED_IMAGES = ['hands-pulse.jpg']

function assetCopyPatterns() {
  const srcDir = path.resolve(SHARED, 'assets').replace(/\\/g, '/')
  return SHARED_IMAGES.map((name) => ({
    from: `${srcDir}/${name}`,
    to: `assets/${name}`,
  }))
}

/**
 * 编译目标（`--type` 的值）—— Taro CLI 会先设 `process.env.TARO_ENV`，再读配置。
 *
 * **鸿蒙为什么要在配置里手动挂插件**
 *
 * CLI 4.3.2 的内置平台清单只有 `weapp / alipay / swan / tt / qq / jd / h5 / ascf / harmony-hybrid`，
 * `harmony` 与 `harmony_cpp` **不在里面** —— 传 `--type harmony_cpp` 会直接报
 * 「不存在编译平台 harmony_cpp」。
 *
 * 平台是靠插件的 `ctx.registerPlatform({ name: 'harmony_cpp' })` 注册的，
 * 所以要自己把 `@tarojs/plugin-platform-harmony-cpp` 挂进 `plugins`。
 *
 * 只在编鸿蒙时挂 —— 微信构建不碰它，免得两个平台插件互相干扰。
 */
const TARO_ENV = process.env.TARO_ENV || 'weapp'
const isHarmony = TARO_ENV === 'harmony_cpp' || TARO_ENV === 'harmony'

export default defineConfig(async (merge) => {
  const baseConfig = {
    projectName: 'pulse-record',
    date: '2026-11-5',
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      828: 1.81 / 2,
    },
    sourceRoot: 'src',
    outputRoot: 'dist',
    /**
     * 鸿蒙编译要绕开 Taro 4.3.2 的一个上游顺序问题
     * （`@tarojs/vite-runner` 里那个没有 preset 的 `pre` babel 插件解析不了 `.tsx`），
     * 细节与「什么时候可以删」见 `config/harmony-workaround.ts`。
     *
     * Taro 的 `config.plugins` 只收**字符串**（包名或绝对路径），
     * 插件对象要写成独立文件、用路径引进来。
     *
     * 微信端不受影响 —— 补丁只在鸿蒙目标下注册。
     */
    plugins: isHarmony
      ? [
          '@tarojs/plugin-platform-harmony-cpp',
          path.resolve(__dirname, 'harmony-workaround.ts'),
        ]
      : [],
    /**
     * 编译期注入「默认 API 地址」。
     *
     * 上线包必须指向**正式 https 域名** ——
     * 微信的 request 合法域名不接受 IP、不接受端口、必须是已 ICP 备案的 https。
     * 用环境变量注入，不用改源码：
     *
     * ```bash
     * PULSE_API_BASE=https://mai.example.com npm run mp:taro:build
     * ```
     *
     * 不传就是空串 → 运行时就用 `src/utils/config.ts` 里的本机默认值。
     * 「我的」页里也能改（存在本地存储），所以联调包与正式包可以并存。
     *
     * ⚠️ **这一段被误删过一次，整屏白过一次**（2026-11-05）：
     * define 失效 → 产物里留下 `process.env.PULSE_API_BASE` →
     * 小程序运行时**没有 `process` 这个全局量** → 启动即抛
     * 「process is not defined」→ 页面全白、元素查不到。
     * 回归里有一条断言专门盯这个（见 `scripts/e2e/taro-lint.mjs` 第 23 节：
     * 产物里不许残留 `process.xxx`）。
     */
    defineConstants: {
      'process.env.PULSE_API_BASE': JSON.stringify(process.env.PULSE_API_BASE || ''),
      /**
       * 传输方式：'cloud'（走 wx.cloud.callFunction，不受 request 合法域名约束）
       * 或 'request'。默认微信端 'cloud'、鸿蒙端 'request'（鸿蒙没有 wx.cloud）。
       */
      'process.env.PULSE_TRANSPORT': JSON.stringify(
        process.env.PULSE_TRANSPORT || (isHarmony ? 'request' : 'cloud'),
      ),
      /**
       * CloudBase 环境 id（wx.cloud.init 用）
       *
       * ⚠️ 默认值必须与 `src/utils/config.ts` 里的 `CLOUD_ENV_ID` 保持一致，
       * 且必须指向**当前在用的**环境 —— 指着一个已销毁的环境 id，
       * 报错会延迟到第一次 `callFunction` 才出现，表现为「云通道怎么都不通」。
       */
      'process.env.PULSE_CLOUD_ENV': JSON.stringify(
        process.env.PULSE_CLOUD_ENV || 'pulse-1-d0g880ydl8ddc57f6',
      ),
      /**
       * **预览正式版界面**（2026-11-08 维护者要求「服务器」界面与「存储位置」正式版不显示）
       *
       * 正式发布版要等备案＋审核才能看到那个界面 —— 那太久了，
       * 得有个办法**在本地就能看见正式版长什么样**。
       *
       * ```bash
       * PULSE_FORCE_RELEASE=1 npm run mp:taro:build   # 产物按正式版渲染
       * ```
       *
       * ⚠️ **`.trim()` 不是多余的** —— cmd 里 `set VAR=1 && 别的命令` 会把值设成
       *    `"1 "`（**带一个尾随空格**！），不 trim 就永远判不成立。
       *    （2026-11-08 实测踩过：构建成功、开关却不生效。）
       *
       * ⚠️ **只是编译期替换**（`JSON.stringify` 成字面量），
       *    产物里不会残留 `process.env.` —— 小程序运行时没有 `process` 这个全局量，
       *    残留就是启动即抛「process is not defined」→ 整屏白（2026-11-05 真出过）。
       *    回归第 23 节专门盯这个。
       */
      'process.env.PULSE_FORCE_RELEASE': JSON.stringify(
        String(process.env.PULSE_FORCE_RELEASE || '').trim() === '1' ? '1' : '',
      ),
    },

    /**
     * 图片资源：拷进小程序包，运行时路径是 `/assets/xxx.png`
     *  （与原生版 `miniprogram/pages/case-detail/case-detail.js` 里
     *    `img.src = '/assets/hands-pulse.png'` 完全一致）
     *
     * tabBar 图标（`src/assets/tabbar/*.png`）**不归这里管** ——
     * 那是 Taro 自己按 `app.config.ts` 的 `iconPath` 拷的，已经落在 `dist/assets/tabbar/`。
     * 这里只补网站端共用的大图（寸关尺底图、开方三部曲图）。
     *
     * 写法上的两条硬规矩（正斜杠 / `to` 带扩展名）见 `assetCopyPatterns()` 上面的注释。
     */
    copy: {
      patterns: assetCopyPatterns(),
      options: {},
    },

    framework: 'react',

    /** ★ 鸿蒙 C-API 只支持 Vite —— 不可改成 webpack */
    compiler: 'vite',

    cache: {
      enable: false,
    },

    mini: {
      postcss: {
        pxtransform: {
          enable: true,
          config: {},
        },
        cssModules: {
          enable: false,
        },
      },
      compile: {
        /** 知识库 domain 只给「用方」tab 用；主包若用不到就不打进主包。
         *  （分包是否生效待实测包体后定，见 docs/progress.md） */
        exclude: [],
      },
      output: {
        appConfig: {
          navigateToMaxDepth: 10,
        },
      },
    },

    alias: {
      '@domain': path.resolve(SHARED, 'domain'),
      '@export': path.resolve(SHARED, 'export'),
    },

    /**
     * 鸿蒙（C-API）专用配置。
     *
     * `projectPath` 是 **DevEco Studio 工程根目录**（含 `entry/` 那个模块）。
     *
     * ## 仓库里那份 `pulse-record/harmony/` 是工程的**唯一真源**
     *
     * 但 **hvigor 不接受含中文的工程路径**（错误码 00306003），
     * 而本仓库就躺在 `~/AiCoding/臧氏脉学/` 下面 —— 仓库路径本身带中文。
     * → 正式构建走 `scripts/harmony-build.mjs`：它把仓库那份镜像到一条
     * **纯 ASCII 路径**再编译，并用 `TARO_HARMONY_PROJECT` 指过去。
     *
     * 这里保底给的默认值（仓库内那份）只为了让
     * `npm run mp:taro:harmony` 单独跑时也有个落点、好检查产物 ——
     * **但那个路径过不了 hvigor 的路径校验**，只适合看 `.ets` 产物。
     *
     * ```bash
     * node scripts/harmony-build.mjs   # ← 正式出 HAP 走这条
     * ```
     *
     * 产出的 `.ets` 会落在 `<projectPath>/<hapName>/src/main/ets/`。
     * **只编微信时这段配置完全不生效。**
     */
    ...(isHarmony
      ? {
          harmony: {
            projectPath: process.env.TARO_HARMONY_PROJECT || path.resolve(ROOT, '..', 'harmony'),
            hapName: 'entry',
          },
        }
      : {}),
  }

  if (process.env.NODE_ENV === 'development') {
    return merge({}, baseConfig, devConfig)
  }
  return merge({}, baseConfig, prodConfig)
})
