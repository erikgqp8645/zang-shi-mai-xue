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
    defineConstants: {},

    /** 图片资源：拷进小程序包，运行时路径仍是 `/assets/xxx.png`
     *  （与原生版 `case-detail.js` 里 `img.src = '/assets/hands-pulse.png'` 完全一致）
     *
     *  两个来源：
     *   · `../src/assets` —— 网站端的图（寸关尺底图、三部曲图），**两端共用同一份文件**
     *   · `src/assets`     —— 小程序自己的资源（tabBar 图标）
     */
    copy: {
      patterns: [
        { from: path.resolve(SHARED, 'assets') + '/', to: 'assets/' },
        { from: path.resolve(ROOT, 'src', 'assets') + '/', to: 'assets/' },
      ],
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
     * 本机没装 DevEco，所以走环境变量传进来：
     *
     * ```bash
     * TARO_HARMONY_PROJECT=/path/to/DevEcoProject npm run build:harmony
     * ```
     *
     * 产出的 `.ets` 会落在 `<projectPath>/<hapName>/src/main/ets/`，
     * 再用 DevEco Studio 出 HAP。**只编微信时这段配置完全不生效。**
     */
    ...(isHarmony
      ? {
          harmony: {
            projectPath: process.env.TARO_HARMONY_PROJECT || path.resolve(ROOT, 'harmony'),
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
