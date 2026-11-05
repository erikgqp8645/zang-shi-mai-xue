#!/usr/bin/env node
/**
 * 共享包构建的第二步（第一步是 `tsc -p tsconfig.core.json`）
 *
 * 做两件事：
 *   1. 给编译产物里的相对 require 补上 `.js` 后缀
 *      —— tsc 保留源码里的写法（`require("./types")`），小程序运行时虽能容错，
 *         但补上后不依赖运行时的容错行为，行为确定。
 *   2. 把网站的两张图复制进小程序工程
 *      —— 小程序打包只认 miniprogramRoot 内的资源，网站那边是 Vite 的 import。
 *
 * 产物不进版本库（.gitignore 已排除 miniprogram/utils/core/ 与 miniprogram/assets/）。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CORE = join(ROOT, 'miniprogram/utils/core')
const ASSETS = join(ROOT, 'miniprogram/assets')

/* ---- 1. 相对 require 补 .js ---- */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.js')) out.push(p)
  }
  return out
}

let patched = 0
for (const file of walk(CORE)) {
  const src = readFileSync(file, 'utf8')
  const out = src.replace(
    /require\((["'])(\.\.?\/[^"']+)\1\)/g,
    (m, q, spec) => (/\.[a-z0-9]+$/i.test(spec) ? m : `require(${q}${spec}.js${q})`),
  )
  if (out !== src) {
    writeFileSync(file, out, 'utf8')
    patched++
  }
}
console.log(`[build:core] 相对 require 补后缀：${patched} 个文件`)

/* ---- 2. 复制图片资源 ---- */
/**
 * 底图用 **JPEG**（2026-11-05）。
 *
 * 微信开发者工具「代码质量 → 图片和音频资源大小不应超过 200 K」未通过：
 * PNG 底图 298 KB 压不动（照片类 PNG 的无损下限就在 300 KB 上下），
 * 缩到 850×696 还是 220 KB 且印刷字发糊。
 *
 * 改用同尺寸 JPEG（1070 × 876，180.7 KB，**尺寸不变所以覆盖层坐标不跑位**），
 * 由 `scripts/compress-assets.mjs` 生成。生成脚本见该文件的说明。
 *
 * `triad-p47.png` **不复制**：它在原生小程序端没有任何地方引用
 * （三部曲是 `pages/triad/triad.wxml` 用样式画出来的，不是贴图），
 * 只被网站端的 `src/components/TriadImage.tsx` 用。
 */
const IMAGES = ['hands-pulse.jpg']
mkdirSync(ASSETS, { recursive: true })
for (const name of IMAGES) {
  const from = join(ROOT, 'src/assets', name)
  if (!existsSync(from)) {
    console.warn(`[build:core] 缺少图片：${from}`)
    continue
  }
  copyFileSync(from, join(ASSETS, name))
  console.log(`[build:core] 复制资源：${name}`)
}
