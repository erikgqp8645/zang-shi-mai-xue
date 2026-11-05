/**
 * 模拟器验证：隐私政策页能打开、能渲染（不是白屏）。
 *
 * 依赖微信开发者工具的自动化端口：
 *   cli auto --project pulse-record/taro --auto-port 9421 --trust-project --port 45820
 * 用法：
 *   MP_SIM_WS=ws://127.0.0.1:9421 node scripts/e2e/privacy-sim.mjs
 *
 * ## 三个坑（都踩过）
 *
 * 1. **自动化端口每次用完都会掉** —— `mp.disconnect()` 之后开发者工具把 9421 收了，
 *    跑之前必须先 `cli auto` 重新拉起。
 * 2. **每一步都要带超时** —— automator 的调用在环境不满足时会一直挂着，
 *    没有超时的脚本看上去像「卡死」。
 * 3. **`switchTab` / `navigateTo` 的路径要带前导斜杠**（`/pages/me/index`），
 *    不带会直接抛「Uncaught [object Object]」。
 *
 * ## 为什么不用 `page.$$()` 查元素
 *
 * 在这套 Taro 产物上，automator 的**元素查询（`$$` / `$` / `data()`）一律不返回**——
 * 给 40 秒超时也是挂死（导航、截图却正常）。
 * 所以这里改成**截图 + 白屏判定**：
 *
 *   · 「我的」页与隐私政策页各截一张 → 解 PNG 看**有没有内容**；
 *   · **整屏白 = 小程序启动就崩了**（最典型是产物里残留 `process.env.xxx`），
 *     这类错构建不报错、静态回归全绿，只有这条能抓到；
 *   · 页面**文案**的正确性由静态回归兜（`taro-lint` 第 21 节：隐私政策页写明每种隐私类型、
 *     「我的」页有隐私政策入口），截图存到 `local-data/` 供人工核对。
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { isBlankShot } from './lib-png.mjs'

const WS = process.env.MP_SIM_WS ?? 'ws://127.0.0.1:9421'
const OUT_DIR = process.env.MP_SIM_OUT ?? join(process.cwd(), 'local-data')

let pass = 0
let fail = 0
const failures = []
function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ' —— ' + detail : ''}`)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** 每步都带超时，避免 automator 挂住时整个脚本像卡死 */
function withTimeout(promise, ms, tag) {
  let timer
  const guard = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${tag} 超时 ${ms}ms`)), ms)
  })
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer))
}

const mod = await import('miniprogram-automator')
const automator =
  mod.default && typeof mod.default.connect === 'function'
    ? mod.default
    : typeof mod.connect === 'function'
      ? mod
      : null

if (!automator) {
  console.log('没装 miniprogram-automator，跳过')
  process.exit(0)
}

mkdirSync(OUT_DIR, { recursive: true })
const mp = await withTimeout(automator.connect({ wsEndpoint: WS }), 20000, 'connect')
console.log('已连上开发者工具自动化端口', WS, '\n')

try {
  /* --- 1. 「我的」页能打开、能渲染 --- */
  await withTimeout(mp.switchTab('/pages/me/index'), 20000, 'switchTab')
  await new Promise((r) => setTimeout(r, 1800))

  const mePage = await withTimeout(mp.currentPage(), 10000, 'currentPage')
  check('能切到「我的」页', String(mePage?.path ?? '').includes('me'), String(mePage?.path))

  const meShot = join(OUT_DIR, 'mp-me-entry.png')
  await withTimeout(mp.screenshot({ path: meShot }), 20000, 'screenshot')
  console.log('  shot ->', meShot)
  const me = isBlankShot(meShot)
  check(
    `「我的」页不是白屏（${me.distinctColors} 种颜色 / 非白像素 ${(me.nonWhiteRatio * 100).toFixed(1)}%）`,
    !me.blank,
    JSON.stringify(me),
  )

  /* --- 2. 隐私政策页能打开、能渲染 --- */
  await withTimeout(mp.navigateTo('/pages/privacy/index'), 20000, 'navigateTo')
  await new Promise((r) => setTimeout(r, 1800))

  const privacyPage = await withTimeout(mp.currentPage(), 10000, 'currentPage')
  const route = String(privacyPage?.path ?? '')
  check('当前页是隐私政策页', route.includes('privacy'), route)

  const stack = await withTimeout(mp.pageStack(), 10000, 'pageStack')
  check('隐私政策页是压在小程序页栈上的（navigateTo 生效）', stack.length >= 2, stack.map((p) => p.path).join(' | '))

  const pvShot = join(OUT_DIR, 'mp-privacy.png')
  await withTimeout(mp.screenshot({ path: pvShot }), 20000, 'screenshot')
  console.log('  shot ->', pvShot)
  const pv = isBlankShot(pvShot)
  check(
    `隐私政策页不是白屏（${pv.distinctColors} 种颜色 / 非白像素 ${(pv.nonWhiteRatio * 100).toFixed(1)}%）`,
    !pv.blank,
    JSON.stringify(pv),
  )
  check('隐私政策页内容量足够（颜色种类 ≥ 20，说明是成段文字不是空壳）', pv.distinctColors >= 20, `${pv.distinctColors} 种`)
} catch (e) {
  const msg = (e && (e.message || e.errMsg)) || JSON.stringify(e)
  check('隐私政策页验证流程跑通', false, msg)
  console.error(msg)
} finally {
  try {
    await mp.disconnect()
  } catch {
    /* ignore */
  }
}

console.log(`\n共 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`)
if (failures.length) {
  console.log('失败项：')
  for (const f of failures) console.log('  · ' + f)
}
process.exit(fail === 0 ? 0 : 1)
