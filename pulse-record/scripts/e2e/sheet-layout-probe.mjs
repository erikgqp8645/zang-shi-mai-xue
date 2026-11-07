#!/usr/bin/env node
/**
 * 记录表「列界对齐」的几何探针 —— **在真实浏览器里量坐标**
 *
 * ## 为什么要有这个
 *
 * 「宽表竖线错开」这个毛病，肉眼看得出，但要**证伪**它得能比坐标。
 * 光看源码不够（宽度写对了，渲染出来仍可能偏），
 * 光看截图也不够（截图缩放、压缩都会挪 1~2 px）。
 *
 * 这个探针做的事：
 *   ① 用 `react-dom/server` 把 **`components/record-sheet` 这个组件本身**
 *      渲成静态 HTML（讲义 p34 的少娟实例，6 次记录）；
 *   ② 套上**编译产物里那份 WXSS**（`taro/dist/common.wxss`，rpx 按 375 宽折成 px）；
 *   ③ 在真实浏览器（Chrome 无头）里量每个格子的 `getBoundingClientRect()`；
 *   ④ 比对：**表头「左/右」行的列界** 与 **正文数据格的列界** 必须是同一组坐标。
 *
 * 浏览器内核与小程序的 webview 是同一套（Chromium），
 * 同一份 CSS ＋ 同一份 DOM → 同一套 flex 布局结果 —— 所以这里量出来的就是小程序里的布局。
 *
 * 用法：node scripts/e2e/sheet-layout-probe.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const TARO = join(ROOT, 'taro')

// esbuild 只装在 Taro 工作区里（`taro/package.json` 的依赖），从那儿取
const requireTaro = createRequire(join(TARO, 'package.json'))
const { build } = requireTaro('esbuild')

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find((p) => existsSync(p))

/** 小程序 750 设计稿；浏览器视口按 375 宽 → 1rpx = 0.5px */
const VIEWPORT_W = 375
const RPX = VIEWPORT_W / 750

let pass = 0
let fail = 0
const failures = []
function ok(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ' —— ' + detail : ''}`)
    console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

/* ------------------------------------------------------------------ */
/* ① 渲染记录表组件 → 静态 HTML                                        */
/* ------------------------------------------------------------------ */

const SHIM = `
const h = (tag) => (props) => {
  const { children, ...rest } = props || {}
  const cls = props && props.className ? { className: props.className } : {}
  return { $$typeof: Symbol.for('react.element'), type: tag, key: null, ref: null, props: { ...cls, children }, _owner: null }
}
export const View = h('view')
export const Text = h('text')
export const ScrollView = h('scroll-view')
export const Input = h('input')
export const Picker = h('picker')
export const Button = h('button')
export const Image = h('image')
export const Textarea = h('textarea')
export const Switch = h('switch')
export const Form = h('form')
export const Label = h('label')
export const Checkbox = h('checkbox')
export const Radio = h('radio')
export const Slider = h('slider')
export const Video = h('video')
export const Camera = h('camera')
export const Canvas = h('canvas')
export const RichText = h('rich-text')
export const WebView = h('web-view')
export const MovableArea = h('movable-area')
export const MovableView = h('movable-view')
export const Swiper = h('swiper')
export const SwiperItem = h('swiper-item')
export const PickerView = h('picker-view')
export const PickerViewColumn = h('picker-view-column')
export const Slot = h('slot')
export const Block = h('block')
export const CustomWrapper = h('custom-wrapper')
export default {}
`

async function renderSheet() {
  const tmp = mkdtempSync(join(tmpdir(), 'sheet-probe-'))
  const shimPath = join(tmp, 'taro-components-shim.js')
  writeFileSync(shimPath, SHIM, 'utf8')

  const entry = join(tmp, 'entry.jsx')
  writeFileSync(
    entry,
    `
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import RecordSheet from ${JSON.stringify(join(TARO, 'src/components/record-sheet/index.tsx'))}
import { sampleShaoJuan } from ${JSON.stringify(join(ROOT, 'src/domain/sample.ts'))}

const s = sampleShaoJuan()
const sessions = s.sessions.map((x) => ({
  id: x.id,
  label: x.label,
  values: x.values,
  constitution: null,
  therapy: null,
}))

export function render(view) {
  return renderToStaticMarkup(
    React.createElement(RecordSheet, {
      sessions,
      layout: 'nine',
      name: s.name,
      editable: false,
      view,
      activeSessionId: sessions[2].id,
    }),
  )
}
`,
    'utf8',
  )

  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'transform',
    target: 'node18',
    outfile: join(tmp, 'out.cjs'),
    absWorkingDir: TARO,
    // 入口文件在临时目录里 —— react / react-dom 要从 Taro 工作区里找
    nodePaths: [join(TARO, 'node_modules')],
    alias: { '@tarojs/components': shimPath },
    loader: { '.scss': 'empty', '.png': 'dataurl', '.jpg': 'dataurl' },
    define: {
      'process.env.PULSE_API_BASE': '""',
      'process.env.PULSE_TRANSPORT': '"request"',
      'process.env.PULSE_CLOUD_ENV': '""',
    },
    logLevel: 'error',
  })

  const mod = createRequire(import.meta.url)(join(tmp, 'out.cjs'))
  const wide = mod.render('wide')
  const single = mod.render('single')
  rmSync(tmp, { recursive: true, force: true })
  return { wide, single }
}

/* ------------------------------------------------------------------ */
/* ② 取编译产物里那份 WXSS，rpx → px                                   */
/* ------------------------------------------------------------------ */

function compiledWxss() {
  const files = [join(TARO, 'dist/app-origin.wxss'), join(TARO, 'dist/common.wxss')]
  for (const p of files) {
    if (!existsSync(p)) {
      throw new Error(`找不到 ${p} —— 先跑 npm --prefix taro run build:weapp`)
    }
  }
  // ⚠️ **两份都要**：app-origin.wxss 里有全局的
  //    `view,text,...{box-sizing:border-box}` —— 少了它，
  //    每个带边框的格子都会宽出边框那一份，表头与正文就差那么几 px。
  const css = files.map((p) => readFileSync(p, 'utf8')).join('\n')
  return css.replace(/(-?[\d.]+)rpx/g, (_, n) => `${Number(n) * RPX}px`)
}

/* ------------------------------------------------------------------ */
/* ③ 在无头 Chrome 里量                                               */
/* ------------------------------------------------------------------ */

const PROBE = `
<script>
(function () {
  const out = {}
  const box = (sel) => Array.from(document.querySelectorAll(sel)).map((e) => {
    const r = e.getBoundingClientRect()
    return { l: Math.round(r.left * 100) / 100, r: Math.round(r.right * 100) / 100 }
  })
  out.headHand = box('.pr-thead-hand')
  out.headDate = box('.pr-thead-date')
  out.bodyCell = box('.pr-cell')
  out.footCell = box('.pr-tfoot-cell')
  out.headTop = box('.pr-thead')
  out.bodyRow = box('.pr-row')
  out.singleHead = (document.querySelector('.pr-single-head') || {}).textContent || ''
  out.singleDate = (document.querySelector('.pr-single-date') || {}).textContent || ''
  out.singleItems = Array.from(document.querySelectorAll('.pr-single-item')).map((e) => e.textContent)
  out.singleChips = Array.from(document.querySelectorAll('.pr-single-chip')).map((e) => e.textContent)
  const pre = document.createElement('pre')
  pre.id = 'probe-result'
  pre.textContent = JSON.stringify(out)
  document.body.appendChild(pre)
})()
</script>
`

function measure(html) {
  const tmp = mkdtempSync(join(tmpdir(), 'sheet-probe-'))
  const file = join(tmp, 'page.html')
  writeFileSync(file, html, 'utf8')
  const profile = join(tmp, 'profile')
  const dom = execFileSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--user-data-dir=' + profile,
      `--window-size=${VIEWPORT_W},1400`,
      '--virtual-time-budget=4000',
      '--dump-dom',
      'file://' + file,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
  )
  rmSync(tmp, { recursive: true, force: true })
  const m = dom.match(/<pre id="probe-result">([\s\S]*?)<\/pre>/)
  if (!m) throw new Error('页面里没找到探针结果（脚本没跑起来？）')
  return JSON.parse(
    m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
  )
}

/* ------------------------------------------------------------------ */

const { wide, single } = await renderSheet()
const css = compiledWxss()

const page = (body) => `<!doctype html>
<html><head><meta charset="utf-8"><style>${css}
view, text, input, textarea, button, scroll-view { display: block; }
text { display: inline; }
.pr-table-scroll { width: 100%; }
</style></head>
<body><div id="app">${body}</div>${PROBE}</body></html>`

console.log('=== 宽表（讲义 p34 少娟实例，6 次记录）===')
const w = measure(page(wide))

console.log('=== 一次一屏 ===')
const s = measure(page(single))

/* ---- 断言 ---- */

console.log('')
ok('宽表：表头「左/右」行有 12 个格（6 次 × 左右）', w.headHand.length === 12, `实际 ${w.headHand.length}`)
ok('宽表：表头日期 6 个', w.headDate.length === 6, `实际 ${w.headDate.length}`)
ok('宽表：表下 12 个格（6 次 × 体质/疗法）', w.footCell.length === 12, `实际 ${w.footCell.length}`)
ok('宽表：正文 9 行 × 12 格 = 108', w.bodyCell.length === 108, `实际 ${w.bodyCell.length}`)

// 正文按行切开：9 行，每行 12 格
const rows = []
for (let i = 0; i < w.bodyCell.length; i += 12) rows.push(w.bodyCell.slice(i, i + 12))

// 核心：表头「左/右」行的列界 == 正文数据格的列界（逐行比）
const headLefts = w.headHand.map((b) => b.l)
const headRights = w.headHand.map((b) => b.r)
const badRows = []
for (const [i, row] of rows.entries()) {
  const sameL = row.length === 12 && row.every((b, k) => Math.abs(b.l - headLefts[k]) < 0.5)
  const sameR = row.length === 12 && row.every((b, k) => Math.abs(b.r - headRights[k]) < 0.5)
  if (!sameL || !sameR) {
    badRows.push(
      `第${i + 1}行 左[${row.map((b) => b.l).join(',')}] 右[${row.map((b) => b.r).join(',')}]`,
    )
  }
}
ok(
  '表头「左/右」行的列界与**每一行**正文数据格完全重合（竖线不错开）',
  badRows.length === 0,
  badRows.length ? badRows[0] : `表头左沿 ${headLefts.join(',')}`,
)
ok(
  '表头「左/右」行的列界偏移是**恒定的**（不再逐列累积）',
  new Set(rows[0].map((b, k) => Math.round((b.l - headLefts[k]) * 100) / 100)).size === 1,
)

// 日期格：右边界 == 该次就诊最后一列的右边界
const dateRights = w.headDate.map((b) => b.r)
// 旧结构（容器内塞两个子格）下 headHand 只有 6 个 —— 这里要防越界，
// **崩掉不算「失败」，得是一条条报出来**。
const lastOfSession = w.headHand.length >= 12 ? [1, 3, 5, 7, 9, 11].map((i) => w.headHand[i].r) : []
ok(
  '日期格的右边界 == 对应那次的最后一列（右边界）',
  lastOfSession.length === 6 && dateRights.every((v, i) => Math.abs(v - lastOfSession[i]) < 0.5),
  `日期 ${dateRights.join(',')} / 左/右行 ${lastOfSession.join(',')}`,
)

// 表下：每格右边界 == 表头日期格右边界
// （表下是两行：第 1 行 6 个体质值、第 2 行 6 个疗法值 —— 所以是 i%6，不是 i/2）
ok(
  '表下的列界与表头日期格对齐',
  w.footCell.length === 12 &&
    w.footCell.every((b, i) => Math.abs(b.r - dateRights[i % 6]) < 0.5),
  `表下右沿 ${w.footCell.map((b) => b.r).join(',')} / 日期右沿 ${dateRights.join(',')}`,
)

// 左缘：表头 lead 的右边界 == 正文「部位+取法」两列的右边界 == 第一个数据格的左边界
const firstCellLeft = w.bodyCell[0].l
ok(
  '正文第一个数据格的左边界 == 表头「左/右」第一个格的左边界',
  Math.abs(firstCellLeft - w.headHand[0].l) < 0.5,
  `${firstCellLeft} vs ${w.headHand[0].l}`,
)

/* ---- 一次一屏 ---- */
console.log('')
ok('一次一屏：有「这一次」的元信息头', !!s.singleHead.trim(), JSON.stringify(s.singleHead.slice(0, 60)))
ok('一次一屏：显示了这一次的日期', !!s.singleDate.trim(), JSON.stringify(s.singleDate))
ok(
  '一次一屏：体质／疗法两项都在',
  s.singleItems.length === 2 &&
    s.singleItems.some((t) => t.includes('体质')) &&
    s.singleItems.some((t) => t.includes('疗法')),
  JSON.stringify(s.singleItems),
)
ok('一次一屏：有 6 个日期 chip（可换次）', s.singleChips.length === 6, `实际 ${s.singleChips.length}`)

console.log('')
console.log(`合计：${pass + fail} 项，通过 ${pass}，失败 ${fail}`)
if (fail) {
  console.log('失败明细：')
  failures.forEach((f) => console.log('  · ' + f))
}
process.exit(fail ? 1 : 0)
