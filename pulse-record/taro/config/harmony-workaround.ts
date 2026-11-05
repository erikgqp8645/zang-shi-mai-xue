import type { Plugin } from 'vite'

/**
 * 鸿蒙编译的绕行补丁 —— **只针对 Taro 4.3.2 的一个上游顺序问题**
 *
 * ## 上游出了什么事
 *
 * `@tarojs/vite-runner@4.3.2` 的鸿蒙编译链里有一个 `enforce: 'pre'` 的 babel 插件
 * （`dist/harmony/babel.js`，插件名是空串 `''`），它只干一件事：
 * 把 `@tarojs/components` 的具名导入改写成 `@tarojs/components/tag`。
 *
 * 问题是它调用 `transformSync(code, { filename, sourceMaps, plugins })` 时
 * **没有给任何 preset** —— 于是 babel 用纯 JS 语法去解析 `.tsx`，
 * 碰到 `import type { ... }` 直接抛：
 *
 * ```
 * SyntaxError: src/app.tsx: Unexpected token, expected "from" (1:12)
 * ```
 *
 * 而 Vite 里 `enforce: 'pre'` 的插件**跑在 vite 自带的 esbuild 转换之前**，
 * 所以它拿到的就是原始 TSX。
 *
 * 顺带一提：同一条链里的 `@rollup/plugin-babel` 也没配 preset
 * （`getBabelOption()` 只给了 extensions / babelHelpers / filter），
 * 所以鸿蒙路径**不能靠 babel preset 来解 TS/JSX**。
 *
 * ## 为什么可以放心跳过
 *
 * 这个插件的职责是**小程序端**的组件 tag 改写。
 * 鸿蒙端的 `@tarojs/components` 由鸿蒙编译器（`harmony/ets.js`）自己处理，
 * 不走这条改写。跳过它对鸿蒙没有影响；
 * 对微信端也没有影响 —— 微信端走的是 mini 编译链，根本不加载这个插件。
 *
 * ## 怎么绕过
 *
 * 本文件是一个 **Taro 插件**（不是 vite 插件）。
 * 注册方式跟 Taro 自己的鸿蒙插件一模一样：
 *
 * ```ts
 * ctx.modifyViteConfig?.((opt) => { opt.viteConfig.plugins.push(...) })
 * ```
 *
 * 也就是**在 `modifyViteConfig` 这个钩子上挂一个回调**，
 * 回调拿到最终拼好的 vite 配置（含插件数组），
 * 在里面找到那个插件，给它的 `transform` 套一层：**遇到 `.ts` / `.tsx` 就原样放行**。
 *
 * > 踩过的坑：
 * >
 * > ① 把 `modifyViteConfig` 写成**插件对象的方法** —— 不会触发。
 * >    Taro 的钩子不是这么注册的，得用上面那种「挂回调」写法。
 * >
 * > ② 把 `modifyViteConfig` 写在 `config/index.ts` 的配置字段里 —— 也不管用，
 * >    CLI 的 build 命令会用它自己的实现覆盖那个字段。
 * >
 * > ③ Taro 插件的默认导出必须是**工厂函数** `(ctx, opts) => ({...})`，
 * >    直接导出对象会在 `Kernel.initPlugin` 报 `apply(...) is not a function`。
 * >
 * > ④ `config.plugins` 只收**字符串**（包名或绝对路径），
 * >    插件对象要写成独立文件、用路径引进来。
 *
 * ## 什么时候可以删掉这段
 *
 * 上游把 `dist/harmony/babel.js` 的 `transformSync` 补上 preset-typescript
 * （或把该插件的 `enforce` 从 `'pre'` 改成正常顺序）之后。
 * 升级 `@tarojs/vite-runner` 后如果鸿蒙编译不再报这个错，就删掉本文件。
 */

/** 递归摊平 vite 的插件数组（插件可以是数组套数组） */
function flattenPlugins(plugins: unknown, out: Plugin[] = []): Plugin[] {
  if (!Array.isArray(plugins)) return out
  for (const p of plugins) {
    if (Array.isArray(p)) flattenPlugins(p, out)
    else if (p && typeof p === 'object') out.push(p as Plugin)
  }
  return out
}

/** 那个插件的特征：名字是空串、`enforce: 'pre'`、带 transform */
function isHarmonyPreBabel(p: Plugin): boolean {
  return (
    p.name === '' &&
    (p as { enforce?: string }).enforce === 'pre' &&
    typeof p.transform === 'function'
  )
}

/** 是不是 TS/TSX 源文件（去掉 vite 的 query 之后看扩展名） */
function isTypeScriptFile(id: string): boolean {
  const file = id.split('?')[0]
  return /\.(ts|tsx|mts|cts)$/.test(file)
}

/** vite 的 transform 钩子签名（我们只用到前三个参数） */
type TransformHook = (
  this: unknown,
  code: string,
  id: string,
  options?: { ssr?: boolean },
) => unknown

/** Taro 插件工厂 */
export default function harmonyWorkaround(ctx: {
  modifyViteConfig?: (cb: (opt: { viteConfig: { plugins?: unknown[] } }) => void) => void
}) {
  ctx.modifyViteConfig?.((opt) => {
    const viteConfig = opt.viteConfig
    for (const p of flattenPlugins(viteConfig.plugins)) {
      if (!isHarmonyPreBabel(p)) continue
      const orig = p.transform as unknown as TransformHook
      p.transform = function patched(this: unknown, code: string, id: string) {
        // TS/TSX 让它原样通过 —— 交给后面的编译链处理
        if (isTypeScriptFile(id)) return null
        return orig.call(this, code, id)
      } as unknown as Plugin['transform']
    }
  })

  return {
    name: 'taro-harmony:skip-ts-in-pre-babel',
  }
}
