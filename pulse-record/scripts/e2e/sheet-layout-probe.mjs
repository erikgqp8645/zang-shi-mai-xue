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
 * ⚠️ **别当它等于小程序里的布局**：Android 小程序的 webview 是 Chromium，
 *    但 **iOS 小程序跑的是 WKWebView**，而且小程序自己的样式引擎对
 *    「盒模型 / 最小尺寸 / rpx 换算」还有另一套处理 ——
 *    2026-11-07 的「日期行逐列错开」就**在 Chromium 和 WKWebView 里都量不出来**，
 *    只在小程序真机上出现。
 *    ⇒ 这个探针守住的是**结构**（列界算术），**数值必须回真机量**。
 *    想在 iOS 同引擎里对照，跑 `npm run test:e2e:sheet:webkit`。
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

export function render(view, nameOverride) {
  return renderToStaticMarkup(
    React.createElement(RecordSheet, {
      sessions,
      layout: 'nine',
      name: nameOverride === undefined ? s.name : nameOverride,
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
  // 长姓名版 —— 「演示·郭丽君」这种 6 字姓名（2026-11-07 实机就是这个）
  const wideLong = mod.render('wide', '演示·郭丽君')
  rmSync(tmp, { recursive: true, force: true })
  return { wide, single, wideLong }
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

const PROBE = `<script>
${readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'sheet-probe-script.js'), 'utf8')}
</script>`

function measure(html, shotPath) {
  const tmp = mkdtempSync(join(tmpdir(), 'sheet-probe-'))
  const file = join(tmp, 'page.html')
  writeFileSync(file, html, 'utf8')
  const profile = join(tmp, 'profile')
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--user-data-dir=' + profile,
    `--window-size=${VIEWPORT_W},1400`,
    '--virtual-time-budget=4000',
  ]
  // ① 量坐标（要 DOM）
  const dom = execFileSync(CHROME, [...args, '--dump-dom', 'file://' + file], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  // ② 顺便拍一张（给人看的）
  if (shotPath) {
    execFileSync(CHROME, [...args, `--screenshot=${shotPath}`, 'file://' + file], {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'],
    })
  }
  rmSync(tmp, { recursive: true, force: true })
  const m = dom.match(/<pre id="probe-result">([\s\S]*?)<\/pre>/)
  if (!m) throw new Error('页面里没找到探针结果（脚本没跑起来？）')
  return JSON.parse(
    m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
  )
}

/* ------------------------------------------------------------------ */

const { wide, single, wideLong } = await renderSheet()
const css = compiledWxss()

const page = (body) => `<!doctype html>
<html><head><meta charset="utf-8"><style>${css}
view, text, input, textarea, button, scroll-view { display: block; }
text { display: inline; }
.pr-table-scroll { width: 100%; }
</style></head>
<body><div id="app">${body}</div>${PROBE}</body></html>`

console.log('=== 宽表（讲义 p34 少娟实例，6 次记录）===')
const SHOT_DIR = process.env.PULSE_SHOT_DIR || ''
// ⭐ 把渲染出来的页面落盘 —— WebKit 探针（scripts/e2e/sheet-layout-webkit-probe.mjs）
//    要拿**同一份页面**去 iOS 同引擎（WKWebView）里再量一遍，
//    才能比出「Chromium 与 WKWebView 的布局差异」。
const HTML_OUT = process.env.PULSE_SHEET_HTML_OUT || ''
if (HTML_OUT) {
  writeFileSync(HTML_OUT, page(wide), 'utf8')
  console.log(`  （页面已落盘：${HTML_OUT}）`)
}
const w = measure(page(wide), SHOT_DIR ? `${SHOT_DIR}/sheet-wide.png` : '')

console.log('=== 宽表（长姓名「演示·郭丽君」）===')
const wl = measure(page(wideLong), SHOT_DIR ? `${SHOT_DIR}/sheet-wide-long.png` : '')

console.log('=== 一次一屏 ===')
const s = measure(page(single), SHOT_DIR ? `${SHOT_DIR}/sheet-single.png` : '')

/* ---- 断言 ---- */

console.log('')
ok('宽表：表头「左/右」行有 12 个格（6 次 × 左右）', w.headHand.length === 12, `实际 ${w.headHand.length}`)
// ⭐ 2026-11-07：日期改成「两个 84rpx 半格」，所以日期半格数 == 手格数
ok('宽表：表头日期 12 个半格（6 次 × 2 个半格）', w.headDate.length === 12, `实际 ${w.headDate.length}`)
ok('宽表：表下 24 个半格（2 行 × 6 次 × 2 个半格）', w.footCell.length === 24, `实际 ${w.footCell.length}`)
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

// 日期行：**每个日期拆成两个 84rpx 半格**（2026-11-07）
// ⇒ 日期行与「左/右」行是**逐格一一对应**的：第 i 个日期半格的右边界
//    必须等于第 i 个手格的右边界（不再有「一个日期格跨两列」的第二套算法）。
const dateRights = w.headDate.map((b) => b.r)
const handRights = w.headHand.map((b) => b.r)
ok(
  '日期行的半格与表头「左/右」格**逐格对齐**（同一个 84rpx 宽度声明）',
  w.headDate.length === w.headHand.length &&
    w.headDate.length > 0 &&
    dateRights.every((v, i) => Math.abs(v - handRights[i]) < 0.5),
  `日期半格 ${dateRights.join(',')} / 左/右格 ${handRights.join(',')}`,
)

// 日期标签：文字**横跨两个半格**居中（绝对定位，不是溢出）
// ⇒ 标签盒宽 == 2 × 84rpx，左边界 == 该次左半格的左边界
const dateTextW = w.dateText.length ? w.dateText[0].r - w.dateText[0].l : 0
const wantTextW = Math.round(168 * RPX * 100) / 100
const textPairsOk =
  w.dateText.length === w.headDate.length / 2 &&
  w.dateText.every((t, i) => {
    const l = w.headDate[i * 2].l
    const r = w.headDate[i * 2 + 1].r
    return Math.abs(t.l - l) < 0.5 && Math.abs(t.r - r) < 0.5
  })
ok(
  '日期标签横跨「左＋右」两个半格（居中在这一次的正上方）',
  textPairsOk && Math.abs(dateTextW - wantTextW) < 0.5,
  `标签宽 ${dateTextW.toFixed(2)}px（期望 ${wantTextW}px）/ 标签数 ${w.dateText.length}`,
)

// 表下：每格右边界 == 表头日期半格右边界
// （表下是两行：第 1 行体质值、第 2 行疗法值 —— 每行 12 个半格，所以是 i%12）
ok(
  '表下的列界与表头日期半格对齐',
  w.footCell.length > 0 &&
    w.footCell.length % dateRights.length === 0 &&
    w.footCell.every((b, i) => Math.abs(b.r - dateRights[i % dateRights.length]) < 0.5),
  `表下右沿 ${w.footCell.map((b) => b.r).join(',')} / 日期右沿 ${dateRights.join(',')}`,
)

// 表下的值文字同样横跨两个半格
// （表下是两行：每行 6 次就诊 × 2 个半格；值文字挂在每个 is-l 半格里 ⇒ 每行 6 个）
const footTextPerRow = w.footText.length / 2
const footCellPerRow = w.footCell.length / 2
const footTextOk =
  w.footText.length > 0 &&
  w.footCell.length > 0 &&
  w.footText.every((t, i) => {
    const row = Math.floor(i / footTextPerRow)
    const j = i % footTextPerRow
    const l = w.footCell[row * footCellPerRow + j * 2].l
    const r = w.footCell[row * footCellPerRow + j * 2 + 1].r
    return Math.abs(t.l - l) < 0.5 && Math.abs(t.r - r) < 0.5
  })
ok(
  '表下的值文字横跨两个半格（居中在这一次的正下方）',
  footTextOk,
  `值文字 ${w.footText.length} 个 / 表下格 ${w.footCell.length} 个`,
)

// 左缘：表头 lead 的右边界 == 正文「部位+取法」两列的右边界 == 第一个数据格的左边界
const firstCellLeft = w.bodyCell[0].l
ok(
  '正文第一个数据格的左边界 == 表头「左/右」第一个格的左边界',
  Math.abs(firstCellLeft - w.headHand[0].l) < 0.5,
  `${firstCellLeft} vs ${w.headHand[0].l}`,
)

/* ---- 2026-11-07 实机错开后的补测（微信小程序 webview） ----
 *
 * 实机截图量出来的偏差：
 *   · 正文「部位+取法」两段合计只有 125.8rpx（应为 128rpx）→ 短 2rpx
 *   · 日期格 / 表下格有 169.8rpx（应为 168rpx）→ 长 2rpx
 *   · 84rpx 的数据格 / 「左/右」格是准的
 * ⇒ **带 border-right 的格子，边框被算进了盒模型**（各引擎对
 *    「width 含不含 border」的处理不一致）。
 *
 * 修法：竖线一律改用 `box-shadow: inset` 画在**盒子内侧**，完全不参与盒模型。
 * 于是**每个格子的外宽严格等于它声明的 width**，列界只由宽度算术决定。
 *
 * ⚠️ Chromium 里 border-box 本来就正常，**这些断言在本地是「白测」** ——
 *    它们的真正作用是：万一哪天有人把 inset box-shadow 改回 border，
 *    探针要能立刻发现「外宽 ≠ 声明宽度」。 */

const PX = (rpx) => Math.round(rpx * RPX * 100) / 100

/** 每个格子的外宽是否严格等于声明宽度 */
function widthOk(boxes, rpx, label) {
  if (!boxes.length) return { ok: false, why: `${label}：没量到格子` }
  const want = PX(rpx)
  const bad = boxes.filter((b) => Math.abs(b.r - b.l - want) > 0.5)
  return {
    ok: bad.length === 0,
    why: `${label}：期望 ${want}px，实测 ${boxes[0].r - boxes[0].l}px` +
      (bad.length ? `，${bad.length} 个不符` : ''),
  }
}

for (const [label, boxes, rpx] of [
  ['正文数据格 84rpx', w.bodyCell, 84],
  ['表头「左/右」格 84rpx', w.headHand, 84],
  // ⭐ 2026-11-07：日期/表下从「一个 168rpx 的整格」改成「两个 84rpx 半格」——
  //    全表只剩 84rpx 一种数据列宽，列界只由「84rpx × N」决定。
  ['表头日期半格 84rpx', w.headDate, 84],
  ['表下格半格 84rpx', w.footCell, 84],
  ['部位列 64rpx', w.organ, 64],
  ['取法列 64rpx', w.depth, 64],
  ['表头姓名段 128rpx', w.headLead, 128],
]) {
  const r = widthOk(boxes, rpx, label)
  ok(`${label}：外宽严格等于声明宽度（边框不进盒模型）`, r.ok, r.why)
}

// 表头的姓名段（128rpx）必须等于正文的「部位+取法」两段（64+64）——
// 实机就是这里差了 2rpx，把整行表头往右推了 3px。
const bodyLead = w.organ[0].r - w.organ[0].l + (w.depth[0].r - w.depth[0].l)
const headLead = w.headLead[0].r - w.headLead[0].l
ok(
  '表头姓名段的宽度 == 正文「部位+取法」两段的宽度（128rpx == 64+64）',
  Math.abs(bodyLead - headLead) < 0.5,
  `正文 ${bodyLead.toFixed(2)}px vs 表头 ${headLead.toFixed(2)}px`,
)

// 长姓名（6 字）**不能改变任何列位** —— 名字只在自己的格子里
const sameGeom =
  wl.headHand.length === w.headHand.length &&
  wl.bodyCell.length === w.bodyCell.length &&
  wl.headHand.every((b, i) => Math.abs(b.l - w.headHand[i].l) < 0.5 && Math.abs(b.r - w.headHand[i].r) < 0.5) &&
  wl.bodyCell.every((b, i) => Math.abs(b.l - w.bodyCell[i].l) < 0.5 && Math.abs(b.r - w.bodyCell[i].r) < 0.5) &&
  wl.headDate.every((b, i) => Math.abs(b.l - w.headDate[i].l) < 0.5 && Math.abs(b.r - w.headDate[i].r) < 0.5)
ok('长姓名（演示·郭丽君）不改变任何列位', sameGeom)

// 姓名段本身的宽度也不许被名字撑开
// （几何上在 Chromium 里钉死为 128rpx，是「白测」；真正能抓的是下面那条计算样式断言）
const longLead = wl.headLead[0].r - wl.headLead[0].l
ok(
  '长姓名不会把表头姓名段撑宽',
  Math.abs(longLead - headLead) < 0.5,
  `短名 ${headLead.toFixed(2)}px vs 长名 ${longLead.toFixed(2)}px`,
)

// 姓名段本身：必须「装不下就截、但绝不撑破布局」
//   · overflow: hidden + min-width: 0 → 名字再长也推不动别的格子
//   · 文字用 text-overflow: ellipsis → 宁可显示省略号，也不硬切半个字
const nameStyle = wl.style.name
const nameTextStyle = wl.style.nameText
ok(
  '姓名格 overflow:hidden（名字再长也撑不破布局）',
  nameStyle && nameStyle.overflow === 'hidden',
  `overflow=${nameStyle && nameStyle.overflow}`,
)
ok(
  '姓名文字用 text-overflow:ellipsis（宁可省略号也不硬切半个字）',
  nameTextStyle && nameTextStyle.overflow === 'hidden' && nameTextStyle.textOverflow === 'ellipsis',
  `overflow=${nameTextStyle && nameTextStyle.overflow} / text-overflow=${nameTextStyle && nameTextStyle.textOverflow}`,
)

// 姓名的**真实内容宽**（scrollWidth）必须塞得进姓名格 ——
// 这一条才抓得住「字号没降」：元素盒宽被 overflow 钉住，量 box 是量不出来的。
const nameTextReal = nameTextStyle ? nameTextStyle.scrollWidth : 0
const nameCellReal = wl.nameCell[0] ? wl.nameCell[0].r - wl.nameCell[0].l : 0
ok(
  '长姓名的**真实字宽**塞得进姓名格（不靠硬切截半个字）',
  nameTextReal > 0 && nameTextReal <= nameCellReal + 1,
  `字宽 ${nameTextReal}px vs 格子 ${nameCellReal}px`,
)

/* ---- ⭐ 竖线必须用 inset box-shadow，不能用 border ---- *
 *
 * 2026-11-07 实机（微信小程序 webview）量出来的：
 *   · 正文「部位+取法」两段合计 125.8rpx（应 128rpx）
 *   · 日期格 / 表下格 169.8rpx（应 168rpx）
 *   · 84rpx 的数据格是准的
 * ⇒ 带 border-right 的格子，**边框被算进了盒模型**。
 * 修法：竖线一律 `box-shadow: inset` 画在盒子内侧，不参与盒模型。
 *
 * ⚠️ 光量外宽抓不到回归 —— Chromium 的 border-box 本来就对。
 *    这里查**计算样式**：border-right-width 必须是 0，box-shadow 必须带 inset。
 *    这一条在真机上也成立（同一份 CSS、同一套计算样式）。 */
for (const [label, st] of Object.entries(w.style)) {
  if (!label.endsWith('Text') && !st) {
    ok(`竖线样式可测：${label}`, false, '没量到元素')
    continue
  }
  if (label.endsWith('Text')) continue
  const noBorder = st.borderRightWidth === '0px' && st.borderLeftWidth === '0px'
  const inset = /inset/.test(st.boxShadow || '')
  ok(
    `${label}：竖线用 inset box-shadow 画（border-right-width 为 0）`,
    noBorder && inset,
    `border-right=${st.borderRightWidth} / border-left=${st.borderLeftWidth} / box-shadow=${st.boxShadow}`,
  )
}

// 姓名字号：长名字必须自动降档，否则会被硬切截半个字
const shortFs = parseFloat(w.style.nameText.fontSize)
const longFs = parseFloat(wl.style.nameText.fontSize)
ok(
  '长姓名自动降字号（比短姓名小）',
  longFs < shortFs,
  `短名 ${shortFs}px / 长名 ${longFs}px`,
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
