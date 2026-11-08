/**
 * 端到端探针 —— 在**模拟器里**验证 2026-11-08 那两件事
 *
 * ① 「我的」页底部那行「版本 2026-11-08 xx:xx · sha」**在不在**
 *    → 在 = 模拟器跑的是**带构建标识的新包**（之前那次「依然」就是跑着旧包）；
 *      不在 = 又是旧包，改什么都没用。
 *
 * ② **单机模式也不再自动进** —— 维护者 2026-11-08 拍板「单机模式也要点一下才进去」。
 *    所以：打开登录页 → 必须**停在登录页**、页面上给一个「进入（单机模式）」按钮。
 *    若自己跑进了病例页 ⇒ 自动进入还在发生（老 bug）。
 *
 * 用法：node scripts/e2e/probe-bundle.mjs
 */
import { join, resolve } from 'node:path'

import { connect, rearm } from './lib-devtools.mjs'

const WS = process.env.MP_SIM_WS ?? 'ws://127.0.0.1:9420'
const LOGGED_OUT_KEY = 'pulse.loggedOut'

console.log('== 重启小程序（确保不是旧 bundle）==')
rearm()

const mod = await import('miniprogram-automator')
const automator =
  mod.default && typeof mod.default.connect === 'function'
    ? mod.default
    : typeof mod.connect === 'function'
      ? mod
      : null

const mp = await connect(automator, WS)
if (!mp) {
  console.log('✗ 连不上自动化端口 ' + WS)
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 在 app service 上下文里跑一段代码（带超时，防挂死） */
async function evalIn(fn, arg) {
  return Promise.race([
    mp.evaluate(fn, arg),
    new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate 超时')), 20000)),
  ])
}

/** 当前页面路由 */
async function route() {
  const r = await evalIn(() => getCurrentPages().map((p) => p.route))
  return Array.isArray(r) ? r[r.length - 1] : String(r)
}

/** 当前页面渲染出来的全部文字（Taro 的树在 page.data.root.cn 里） */
async function pageText() {
  const raw = await evalIn(() => {
    const pages = getCurrentPages()
    if (!pages.length) return ''
    try {
      return JSON.stringify(pages[pages.length - 1].data || {})
    } catch {
      return ''
    }
  })
  return String(raw || '')
}

let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass++
    console.log('  ✓ ' + name)
  } else {
    fail++
    console.log('  ✗ ' + name + (detail ? ' —— ' + detail : ''))
  }
}

/* ---------------- ① 模拟器里跑的是新包吗 ---------------- */
console.log('\n① 构建标识（模拟器里跑的是哪一份）\n')

await mp.switchTab('/pages/me/index')
await sleep(3000)
const meText = await pageText()
const verMatch = meText.match(/版本 \d{4}-\d{2}-\d{2} \d{2}:\d{2} · [0-9a-f]+\*?/)
ok('「我的」页显示了构建标识（说明跑的是带标识的新包）', !!verMatch, meText.slice(0, 200))
if (verMatch) console.log('    → ' + verMatch[0])

/* ---------------- ② 单机模式也不再自动进 ---------------- */
console.log('\n② 单机模式会不会自动进\n')

// 复刻「我的」页点退出登录留下的本地标记
await evalIn((k) => wx.setStorageSync(k, '1'), LOGGED_OUT_KEY)
console.log('  · 已写入「刚退出过」标记（' + LOGGED_OUT_KEY + '=1）')

await mp.reLaunch('/pages/login/index')
await sleep(4000)

const afterLogout = await route()
ok(
  '退出登录后停在登录页（没被自动带回病例页）',
  afterLogout === 'pages/login/index',
  '当前路由：' + afterLogout,
)

const loginText = await pageText()
ok(
  '登录页给出「进入（单机模式）」按钮',
  loginText.includes('进入（单机模式）'),
  loginText.slice(0, 200),
)
ok(
  '单机模式下**不**显示「微信一键登录」（单机模式压根没有登录这回事）',
  !loginText.includes('微信一键登录'),
  '单机模式却渲染了登录卡片',
)

/* ---------------- ③ 对照组：没被退出过时，单机模式**也不**自动进 ---------------- */
console.log('\n③ 对照组：没被退出过时，单机模式同样不自动进\n')

await evalIn((k) => wx.removeStorageSync(k), LOGGED_OUT_KEY)
await mp.reLaunch('/pages/login/index')
await sleep(4000)
const afterClear = await route()
ok(
  '清掉标记后**仍然**停在登录页（单机模式也不自动进 —— 一律要点一下）',
  afterClear === 'pages/login/index',
  '当前路由：' + afterClear,
)
ok(
  '仍然给的是「进入（单机模式）」按钮',
  (await pageText()).includes('进入（单机模式）'),
)

try {
  await mp.disconnect()
} catch {
  /* ignore */
}

console.log('\n合计：' + (pass + fail) + ' 项，通过 ' + pass + '，失败 ' + fail)
process.exit(fail ? 1 : 0)
