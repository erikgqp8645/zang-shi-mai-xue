#!/usr/bin/env node
/**
 * 记录表「列界对齐」的 **WebKit 几何探针** —— iOS 同引擎
 *
 * ## 为什么要有这个
 *
 * 2026-11-07 的「宽表日期行逐列错开」在 **Chromium 里量不出来**：
 * Chromium 的 `border-box` 本来就把边框算在盒内，于是「168rpx 的整格」
 * 在 Chromium 里正好是 168rpx —— **一切正常**；可同一份 CSS 在 iOS 小程序
 * （WKWebView）里，每格宽出来的 ~2.4rpx 会**逐格累积**，越往右偏得越多。
 *
 * ⇒ 只有**在 WebKit 里量**，才抓得住这一类「引擎差异」。
 * 这个脚本拿**与 Chromium 探针完全同一份页面**（`PULSE_SHEET_HTML_OUT` 落盘那份）
 * 和**同一份测量脚本**（`sheet-probe-script.js`），
 * 在 WKWebView 里量一遍，再断言结构不变量。
 *
 * ## 它断言什么
 *
 *   ① 表头「左/右」行的列界 == 正文每一行数据格的列界
 *   ② 表头日期的**半格**与手格逐格对齐（同一个宽度声明）
 *   ③ 所有 84rpx 半格的外宽**彼此相等**（宽度算术没被引擎插手）
 *   ④ 表头姓名段宽度 == 正文「部位 + 取法」两段宽度
 *   ⑤ 日期标签横跨两个半格
 *
 * ## 环境
 *
 * **macOS 专用**（要 `swiftc`；CommandLineTools 就够，不必装完整 Xcode）。
 * 缺 `swiftc` 就**跳过并退出 0** —— 它不在默认 `npm test` 链里。
 *
 * 用法：node scripts/e2e/sheet-layout-webkit-probe.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const E2E = join(ROOT, 'scripts', 'e2e')
const SWIFT_SRC = join(E2E, 'webkit-probe.swift')

/** 与 Chromium 探针保持一致：375 宽视口 → 1rpx = 0.5px */
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
/* ① 有没有 swiftc                                                       */
/* ------------------------------------------------------------------ */
function hasSwiftc() {
  try {
    execFileSync('swiftc', ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] })
    return true
  } catch {
    return false
  }
}
if (!hasSwiftc()) {
  console.log('⚠️  没有 swiftc（要 macOS + Xcode CommandLineTools）—— 跳过 WebKit 探针。')
  console.log('    （这个探针不在默认 npm test 链里；装上 CommandLineTools 后可单独跑）')
  process.exit(0)
}

/* ------------------------------------------------------------------ */
/* ② 编译 Swift 跑手（源码更新了就重编）                                */
/* ------------------------------------------------------------------ */
const BIN_DIR = join(tmpdir(), 'pulse-webkit-probe')
function buildRunner() {
  const bin = join(BIN_DIR, 'webkit-probe')
  if (existsSync(bin) && statSync(bin).mtimeMs >= statSync(SWIFT_SRC).mtimeMs) return bin
  execFileSync('mkdir', ['-p', BIN_DIR])
  execFileSync('swiftc', ['-O', SWIFT_SRC, '-o', bin], { stdio: ['ignore', 'pipe', 'pipe'] })
  return bin
}
let runner
try {
  runner = buildRunner()
} catch (err) {
  console.log(`⚠️  编译 WebKit 跑手失败 —— 跳过。\n${err.stderr || err.message}`)
  process.exit(0)
}

/* ------------------------------------------------------------------ */
/* ③ 让 Chromium 探针把页面落盘（同一份页面、同一份测量脚本）           */
/* ------------------------------------------------------------------ */
const tmp = mkdtempSync(join(tmpdir(), 'sheet-webkit-'))
const pageFile = join(tmp, 'page.html')
let chromiumFailed = false
try {
  execFileSync(
    process.execPath,
    [join(E2E, 'sheet-layout-probe.mjs')],
    { env: { ...process.env, PULSE_SHEET_HTML_OUT: pageFile }, stdio: ['ignore', 'pipe', 'pipe'] },
  )
} catch (err) {
  // Chromium 那边自己没过 —— **但页面通常已经落盘了**，WebKit 照样要量一遍
  // （两边的失败是两条独立的证据，不能因为一边红了就不跑另一边）。
  chromiumFailed = true
  console.log('ℹ️  Chromium 探针没全绿 —— 继续在 WebKit 里量（两边各报各的）')
}
if (!existsSync(pageFile)) {
  console.log('⚠️  Chromium 探针没落盘页面 —— 跳过 WebKit 探针。')
  rmSync(tmp, { recursive: true, force: true })
  process.exit(0)
}

/* ------------------------------------------------------------------ */
/* ④ 在 WKWebView 里量                                                  */
/* ------------------------------------------------------------------ */
const raw = execFileSync(runner, [pageFile, String(VIEWPORT_W)], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})
const wk = JSON.parse(raw)

/* ------------------------------------------------------------------ */
/* ⑤ 断言（结构不变量）                                                  */
/* ------------------------------------------------------------------ */
console.log('')
console.log('=== WebKit（iOS 同引擎）里的列界不变量 ===')

const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol
const PX = (rpx) => Math.round(rpx * RPX * 100) / 100

// ① 表头「左/右」行 == 正文数据格
const headRights = wk.headHand.map((b) => b.r)
const headLefts = wk.headHand.map((b) => b.l)
// 正文按行切：9 行 × 12 格
const perRow = headRights.length
const bodyRows = []
for (let i = 0; i + perRow <= wk.bodyCell.length; i += perRow) {
  bodyRows.push(wk.bodyCell.slice(i, i + perRow))
}
const badRows = bodyRows.filter(
  (row) => !row.every((b, k) => near(b.l, headLefts[k]) && near(b.r, headRights[k])),
)
ok(
  '表头「左/右」行的列界与**每一行**正文数据格完全重合',
  bodyRows.length === 9 && badRows.length === 0,
  badRows.length
    ? `第${bodyRows.indexOf(badRows[0]) + 1}行：${badRows[0].map((b) => b.r).join(',')}`
    : `正文 ${bodyRows.length} 行`,
)

// ② 日期半格逐格 == 手格
ok(
  '表头日期的**半格**与手格逐格对齐（同一个宽度声明）',
  wk.headDate.length === wk.headHand.length &&
    wk.headDate.length > 0 &&
    wk.headDate.every((b, i) => near(b.r, headRights[i]) && near(b.l, headLefts[i])),
  `日期半格 ${wk.headDate.map((b) => b.r).join(',')} / 手格 ${headRights.join(',')}`,
)

// ③ 所有 84rpx 半格外宽彼此相等
const all84 = [
  ...wk.headHand.map((b) => b.r - b.l),
  ...wk.headDate.map((b) => b.r - b.l),
  ...wk.bodyCell.map((b) => b.r - b.l),
  ...wk.footCell.map((b) => b.r - b.l),
]
const want84 = PX(84)
const bad84 = all84.filter((w) => !near(w, want84, 0.6))
ok(
  '所有 84rpx 半格的外宽**彼此相等**（宽度算术没被引擎插手）',
  all84.length > 0 && bad84.length === 0,
  `期望 ${want84}px，实测 ${all84.length} 个格，其中 ${bad84.length} 个不符` +
    (bad84.length ? `（首个 ${bad84[0]}px）` : ''),
)

// ④ 表头姓名段 == 部位 + 取法
const bodyLead = wk.organ[0].r - wk.organ[0].l + (wk.depth[0].r - wk.depth[0].l)
const headLead = wk.headLead[0].r - wk.headLead[0].l
ok(
  '表头姓名段的宽度 == 正文「部位 + 取法」两段的宽度',
  near(bodyLead, headLead, 0.5),
  `正文 ${bodyLead.toFixed(2)}px vs 表头 ${headLead.toFixed(2)}px`,
)

// ⑤ 日期标签横跨两个半格
const dateTextOk =
  wk.dateText.length === wk.headDate.length / 2 &&
  wk.dateText.every((t, i) => near(t.l, wk.headDate[i * 2].l) && near(t.r, wk.headDate[i * 2 + 1].r))
ok('日期标签横跨「左 + 右」两个半格', dateTextOk, `标签 ${wk.dateText.length} 个`)

// ⑥ 竖线样式：仍然是 inset box-shadow（不是 border）
const styles = wk.style || {}
const badStyle = Object.entries(styles).filter(
  ([k, st]) =>
    k !== 'nameText' &&
    st &&
    (st.borderRightWidth !== '0px' || !/inset/.test(st.boxShadow || '')),
)
ok('竖线一律用 inset box-shadow（border-right-width 为 0）', badStyle.length === 0, badStyle.map(([k]) => k).join(','))

console.log('')
console.log(`合计：${pass + fail} 项，通过 ${pass}，失败 ${fail}`)
if (fail) {
  console.log('失败明细：')
  failures.forEach((f) => console.log('  · ' + f))
}
rmSync(tmp, { recursive: true, force: true })
process.exit(fail || chromiumFailed ? 1 : 0)
