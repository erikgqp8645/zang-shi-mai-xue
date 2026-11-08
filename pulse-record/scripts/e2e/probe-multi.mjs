/**
 * 端到端探针（多用户模式）—— **「微信一键登录不会自动登录」的铁证**
 *
 * 2026-11-08 维护者反馈：「点退出登录后这里微信一键登录会自动登录」。
 * 这次不再看界面，而是看**服务端到底收到了什么请求**：
 *
 *   起一个**多用户模式**的后端 → 让小程序连上它 → 打开登录页 → 等 8 秒 →
 *   翻服务端日志：
 *     · 有 `POST /api/auth/wechat/login` ⇒ 自动登录还在发生（老 bug 活着）；
 *     · 没有 ⇒ 登录**只能由用户点按钮发起**（新规矩生效）。
 *
 * 再补一刀（能点就点）：点一下「微信一键登录」→ 日志里**应该**出现那条请求。
 * 证明按钮还是好的 —— 「不自动发」不等于「发不了」。
 *
 * 用法：node scripts/e2e/probe-multi.mjs
 */
import { connect, rearm } from './lib-devtools.mjs'
import { startApi } from './lib.mjs'

const WS = process.env.MP_SIM_WS ?? 'ws://127.0.0.1:9420'
const API_BASE_KEY = 'pulse.apiBase'
const LOGGED_OUT_KEY = 'pulse.loggedOut'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const api = await startApi({ single: false })
console.log('多用户后端：', api.base)

console.log('== 重启小程序 ==')
rearm()

const mod = await import('miniprogram-automator')
const automator =
  mod.default && typeof mod.default.connect === 'function' ? mod.default : mod
const mp = await connect(automator, WS)
if (!mp) {
  console.log('✗ 连不上自动化端口 ' + WS)
  api.stop?.()
  process.exit(1)
}

/**
 * 在 app service 上下文里跑一段代码（带超时，防挂死）
 *
 * ⚠️ **必须转发全部参数** —— `mp.evaluate(fn, ...args)` 是可变的；
 *    只转发第一个的话，`(k, v) => …` 里的 v 就是 undefined，
 *    地址没设成功、小程序还连着老后端 —— 探针会「测了个假的」。
 */
const ev = async (fn, ...args) =>
  Promise.race([
    mp.evaluate(fn, ...args),
    new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate 超时')), 20000)),
  ])

const route = async () => {
  const r = await ev(() => getCurrentPages().map((p) => p.route))
  return Array.isArray(r) ? r[r.length - 1] : String(r)
}

const texts = async () => {
  const raw = String(
    (await ev(() => {
      const pages = getCurrentPages()
      if (!pages.length) return ''
      return JSON.stringify(pages[pages.length - 1].data || {})
    })) || '',
  )
  const out = []
  const re = /"v":"((?:[^"\\]|\\.)*)"/g
  let m
  while ((m = re.exec(raw))) {
    try { out.push(JSON.parse('"' + m[1] + '"')) } catch { out.push(m[1]) }
  }
  return out
}

let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' —— ' + detail : '')) }
}

// 指到多用户后端，清掉「刚退出过」
// ⚠️ evaluate 里的函数会被**序列化到小程序里**执行 —— 闭包变量（api.base）在那边不存在，
//    只能靠参数传进去。
await ev((k) => wx.setStorageSync(k, ''), API_BASE_KEY)
await ev((k, v) => wx.setStorageSync(k, v), API_BASE_KEY, api.base)
await ev((k) => wx.removeStorageSync(k), LOGGED_OUT_KEY)
console.log('  · 已把小程序指向多用户后端：' + api.base)
console.log(
  '  · 小程序里的 apiBase 现在是：' +
    JSON.stringify(await ev(() => wx.getStorageSync('pulse.apiBase'))),
)

await mp.reLaunch('/pages/login/index')
await sleep(8000)

const pageTexts = await texts()
const r = await route()
const logs = api.logs ?? api.child?.logs ?? ''

console.log('\n服务端收到的请求：')
for (const line of String(logs).split(/\r?\n/)) {
  if (line.includes('[api]')) console.log('    ' + line.trim())
}

ok('登录页停在登录页（没被自动带进去）', r === 'pages/login/index', '当前路由：' + r)
ok('多用户模式显示「微信一键登录」按钮', pageTexts.join(' ').includes('微信一键登录'))
ok(
  '服务端**没有**收到自动发起的微信登录请求',
  !/POST \/api\/auth\/wechat\/login/.test(String(logs)),
  '日志里出现了 wechat/login',
)

/* —— 点一下按钮：证明「不自动发」不等于「发不了」 —— */
console.log('\n点一下「微信一键登录」按钮：')
let clicked = false
try {
  const page = await Promise.race([
    mp.currentPage(),
    new Promise((_, rej) => setTimeout(() => rej(new Error('currentPage 超时')), 10000)),
  ])
  const btn = await Promise.race([
    page.$('.pr-btn-primary'),
    new Promise((_, rej) => setTimeout(() => rej(new Error('元素查询超时')), 10000)),
  ])
  await btn.tap()
  clicked = true
} catch (e) {
  console.log('  · 元素查询/点击不可用（' + String(e).slice(0, 50) + '）—— 这一项跳过')
}
if (clicked) {
  await sleep(6000)
  const logs2 = api.logs ?? api.child?.logs ?? ''
  ok(
    '点了按钮之后，服务端**才**收到微信登录请求',
    /POST \/api\/auth\/wechat\/login/.test(String(logs2)),
    '没看到 wechat/login',
  )
}

// 收尾：把地址恢复默认，别把开发者工具留在指向临时后端的状态
await ev((k) => wx.setStorageSync(k, ''), API_BASE_KEY)
try { await mp.disconnect() } catch {}
api.stop?.()

console.log('\n合计：' + (pass + fail) + ' 项，通过 ' + pass + '，失败 ' + fail)
process.exit(fail ? 1 : 0)
