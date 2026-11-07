#!/usr/bin/env node
/**
 * 在**真实微信小程序运行时**里实测「云通道通不通」。
 *
 * ## 为什么需要它
 *
 * 2026-11-07 之前，仓库里记着一条结论：「PostgreSQL 环境接不进小程序云开发」。
 * 那条结论是**错的** —— 它建立在一个**已销毁**的环境 id 的 `-501000` 观测上，
 * 而真正在用的环境 `pulse-1-d0g880ydl8ddc57f6` **从没被测过**。
 *
 * 这份脚本就是那个「真正的测试」：它**不靠推断**，直接进真实运行时里调一次云函数。
 * 2026-11-07 实测结果：`callFunction` → 200（`db: CloudBase PostgreSQL`）。
 *
 * ## 跑法
 *
 * ```bash
 * # ① 开开发者工具的自动化端口（会复用已开着的 IDE）
 * /Applications/wechatwebdevtools.app/Contents/MacOS/cli auto \
 *   --project "<仓库>/pulse-record/taro/dist" --auto-port 9420 --trust-project
 *
 * # ② 装一次 automator（**故意不进 package.json** —— 只在需要时临时装）
 * mkdir -p /tmp/automator && cd /tmp/automator && npm init -y && npm i miniprogram-automator
 *
 * # ③ 跑（NODE_PATH 指到上面那个临时目录）
 * NODE_PATH=/tmp/automator/node_modules node scripts/e2e/mp-cloud-probe.cjs
 * ```
 *
 * ## 两个踩过的坑（别再踩）
 *
 * 1. **在运行时里等回调必须用 `async/await`** —— 小程序运行时是**单线程**的，
 *    忙等（`while (!done) {}`）会把事件循环堵死，云调用的回调永远排不上队，
 *    `evaluate` 会直接 `timeout waiting for automator response`。
 * 2. **`wx.cloud.init()` 不报错** —— 环境不可用时它照样初始化成功，
 *    错误要到**第一次 `callFunction`** 才抛。所以**不能只看 init 的返回值**。
 *
 * ## 环境变量
 *
 * | 变量 | 默认 | 说明 |
 * |---|---|---|
 * | `PULSE_MP_WS` | `ws://127.0.0.1:9420` | 自动化端口 |
 * | `PULSE_CLOUD_ENV` | `pulse-1-d0g880ydl8ddc57f6` | 要测的环境 id |
 * | `PULSE_CLOUD_FN` | `pulse-api` | 要调的云函数名 |
 */

'use strict'

const automator = require('miniprogram-automator')

const WS = process.env.PULSE_MP_WS || 'ws://127.0.0.1:9420'
const ENV = process.env.PULSE_CLOUD_ENV || 'pulse-1-d0g880ydl8ddc57f6'
const FN = process.env.PULSE_CLOUD_FN || 'pulse-api'

/**
 * 在小程序运行时（app service 上下文）里跑的这段代码。
 *
 * ⚠️ 必须 async/await 等回调 —— 见文件头「坑 1」。
 * ⚠️ **这段函数会被序列化到运行时里执行**，拿不到外层闭包变量 ——
 *    所以环境 id／函数名要**当参数传进来**，并留一份**字面量兜底**
 *    （万一 automator 不支持传参，兜底值保证脚本仍能跑出结果）。
 */
async function probeInRuntime(env, fnName) {
  const out = { steps: [], hasWxCloud: false }
  const ENV = env || 'pulse-1-d0g880ydl8ddc57f6'
  const FN = fnName || 'pulse-api'

  if (typeof wx === 'undefined' || !wx || !wx.cloud) {
    out.steps.push('这个运行时没有 wx.cloud —— 测不了')
    return out
  }
  out.hasWxCloud = true
  out.steps.push('wx.cloud 存在 ✅')

  try {
    wx.cloud.init({ env: ENV, traceUser: false })
    out.steps.push('wx.cloud.init 没抛错（注意：这不代表环境可用，见文件头「坑 2」）')
  } catch (e) {
    out.steps.push('wx.cloud.init 抛错: ' + (e && e.message))
    return out
  }

  try {
    const r = await wx.cloud.callFunction({
      name: FN,
      data: { path: '/api/health', method: 'GET', body: null, token: '' },
    })
    out.steps.push('callFunction 成功 ✅')
    out.payload = { ok: true, result: r && r.result }
  } catch (err) {
    out.steps.push('callFunction 失败 ❌')
    out.payload = {
      ok: false,
      errMsg: err && err.errMsg,
      errCode: err && err.errCode,
    }
  }
  return out
}

/** 再走一遍 app 自己的代码路径，读「我的」页上那几行 */
async function readUi(mp) {
  const out = { rows: [] }
  try {
    const page = await mp.reLaunch('/pages/me/index')
    // useDidShow 里会自动发真实请求（refresh / health），等它们跑完
    await new Promise((r) => setTimeout(r, 6000))
    const cur = (await mp.currentPage()) || page
    out.path = cur && cur.path
    const rows = await cur.$$('.pr-me-row')
    for (const row of rows) {
      out.rows.push(String(await row.text()).replace(/\s+/g, ' ').trim())
    }
  } catch (e) {
    out.error = '读界面失败: ' + (e && e.message)
  }
  return out
}

async function main() {
  let mp
  try {
    mp = await automator.connect({ wsEndpoint: WS })
  } catch (e) {
    console.error('连不上自动化端口 ' + WS + '：' + (e && e.message))
    console.error('先跑 cli auto --auto-port 9420 --trust-project')
    process.exit(1)
  }

  try {
    const res = await mp.evaluate(probeInRuntime, ENV, FN)
    console.log('=== ① 直接在运行时里调云函数 ===')
    console.log(JSON.stringify(res, null, 2))
  } catch (e) {
    console.error('evaluate 失败: ' + (e && e.message))
  }

  try {
    const ui = await readUi(mp)
    console.log('=== ② 走 app 自己的代码路径，读「我的」页 ===')
    console.log(JSON.stringify(ui, null, 2))
  } catch (e) {
    console.error('读界面失败: ' + (e && e.message))
  }

  await mp.disconnect().catch(() => {})
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .then(() => process.exit(0))
