#!/usr/bin/env node
/**
 * 小程序 · **微信 canvas 2d 出图**端到端回归（Taro 版）
 *
 * ## 为什么单独有一段
 *
 * 「点一下只弹一个 toast」是这一版最阴的一类 bug：
 *
 *   Failed to execute 'roundRect' on 'CanvasRenderingContext2D':
 *   The provided value cannot be converted to a sequence.
 *
 * 这类错**编译器抓不到、静态回归也抓不到**：
 *   · `PainterCtx` 是结构类型，`roundRect` 压根不在类型里（用 `as unknown` 转的）→ tsc 无感；
 *   · 浏览器（Chrome/Safari/Firefox）数字与数组**都收** → 网站端跑得好好的；
 *   · 只有真的在小程序的 canvas 2d 上画，才会炸。
 *
 * 静态那一条（`taro-lint` 第 24 节）用「假微信 ctx」把这条守住；
 * **本脚本用真的微信 canvas 2d 把最后一跳也守住** ——
 * 打开病例详情页，等页面自己把「寸关尺关系图」画出来，把那张 PNG 读回来判「不是白图」。
 *
 * ## 跑的是哪条链路
 *
 * 页面 → `components/diagram-view` → `platform/canvas.ts` → **共享绘制器**
 * （`src/export/diagram.ts`，与网站端同一份源码）→ canvas → `canvasToTempFilePath` → `<Image>`。
 *
 * 所以这里验的是**线上真正会跑的那条链路**，不是另写一份模拟。
 *
 * ## 需要什么
 *
 * - 微信开发者工具开着，且自动化端口在监听（默认 ws://127.0.0.1:9421）：
 *
 *     cli auto --project pulse-record/taro --auto-port 9421 --trust-project --port 45820
 *
 * - 本机 API 在跑（页面要真数据才能画图）：`npm start`（单机模式 `PULSE_SINGLE_USER=1`）。
 *   **API 没起 → 端到端那段跳过**（不是测试失败）—— 端口同理。
 *
 * 用法：
 *   node scripts/e2e/taro-canvas.mjs
 *   MP_SIM_WS=ws://127.0.0.1:9421 node scripts/e2e/taro-canvas.mjs
 *   MP_SIM_API=http://127.0.0.1:5178 node scripts/e2e/taro-canvas.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { isBlankShot } from './lib-png.mjs'
import { connect, rearm, withTimeout } from './lib-devtools.mjs'

const ROOT = resolve(join(import.meta.dirname, '../..'))
const TARO = join(ROOT, 'taro')
const OUT = process.env.MP_SIM_OUT ?? join(ROOT, 'local-data')

const WS = process.env.MP_SIM_WS ?? 'ws://127.0.0.1:9421'
const API = process.env.MP_SIM_API ?? 'http://127.0.0.1:5178'

/** 微信开发者工具的 CLI（Windows 默认路径） */

/** 原图像素 —— 画布与产出的 PNG 都该是这个尺寸 */
const IMG_W = 1070
const IMG_H = 876

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

/**
 * 每步都带超时 —— automator 的调用在环境不满足时会**一直挂着**，
 * 没有超时的脚本看着像卡死（实测 `navigateTo` 在页面栈太深时会挂）。
 */

/** evaluate 重试 —— 小程序刚起来时第一次调用可能超时 */
async function evaluateRetry(mp, fn, args = [], tries = 3) {
  let last = null
  for (let i = 0; i < tries; i++) {
    try {
      return await withTimeout(mp.evaluate(fn, ...args), 20000, 'evaluate')
    } catch (e) {
      last = e
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
  throw last ?? new Error('evaluate 失败')
}

/** 找一个**有记录**的患者（没记录就画不出图） */
async function findPatientWithVisits() {
  const listRes = await fetch(`${API}/api/patients`).catch(() => null)
  if (!listRes || !listRes.ok) return null
  const list = (await listRes.json())?.patients || []
  for (const p of list.slice(0, 8)) {
    const one = await fetch(`${API}/api/patients/${encodeURIComponent(p.id)}`).catch(() => null)
    if (!one || !one.ok) continue
    const detail = await one.json().catch(() => null)
    if (detail?.patient?.visits?.length) return p.id
  }
  return null
}

console.log('\n小程序 · 微信 canvas 2d 出图回归\n')

/* ---- 先把小程序重启一遍（否则跑的是旧 bundle） ---- */
rearm()

/* ---- 连自动化端口 ---- */
let automator = null
try {
  const mod = await import('miniprogram-automator')
  automator =
    mod.default && typeof mod.default.connect === 'function'
      ? mod.default
      : typeof mod.connect === 'function'
        ? mod
        : null
} catch {
  automator = null
}

if (!automator) {
  console.log('  · 没装 miniprogram-automator，跳过（不是测试失败）')
} else {
  let mp = null
  // 重启之后端口要等一会儿才起来 —— 轮询着连
  mp = await connect(automator, WS)
  if (!mp) {
    console.log(`  · 连不上自动化端口 ${WS} —— 跳过（不是测试失败）`)
    console.log('    先跑：cli auto --project pulse-record/taro --auto-port 9421 --trust-project')
  }

  if (mp) {
    try {
      mkdirSync(OUT, { recursive: true })

      /* ------------------------------------------------------------------
       * ① 平台契约：微信的 roundRect 收**数组**
       * ---------------------------------------------------------------- */
      const contract = await evaluateRetry(mp, () => {
        const out = {}
        try {
          const oc = wx.createOffscreenCanvas({ type: '2d', width: 200, height: 100 })
          const ctx = oc.getContext('2d')
          try {
            ctx.beginPath()
            ctx.roundRect(10, 10, 60, 30, [3])
            out.arrayRadius = 'accepted'
          } catch (e) {
            out.arrayRadius = String((e && (e.message || e.errMsg)) || e)
          }
          out.hasQuad = typeof ctx.quadraticCurveTo === 'function'
          out.hasClose = typeof ctx.closePath === 'function'
        } catch (e) {
          out.err = String((e && (e.message || e.errMsg)) || e)
        }
        return out
      }).catch((e) => ({ err: String(e && e.message ? e.message : e) }))

      ok('微信 canvas 2d 存在', !contract.err, contract.err || '')
      ok('roundRect 的半径传数组被接受（微信按序列收，传数字必抛）', contract.arrayRadius === 'accepted', contract.arrayRadius || '')
      ok('canvas 2d 有 quadraticCurveTo（手写圆角路径的兜底要用）', contract.hasQuad === true)
      ok('canvas 2d 有 closePath', contract.hasClose === true)

      /* ------------------------------------------------------------------
       * ② 端到端：打开页面，等它自己把图画出来，把 PNG 读回来
       * ---------------------------------------------------------------- */
      const patientId = await findPatientWithVisits()
      if (!patientId) {
        console.log(`  · API（${API}）没起或没有带记录的患者 —— 端到端那段跳过（不是测试失败）`)
        console.log('    先跑：PULSE_SINGLE_USER=1 npm start')
      } else {
        // `reLaunch` 在这套 Taro 产物上**偶发**抛 automator 的
        // `getPageMetaByWebviewId(...)` 为 null（webview 还没注册）。
        // 实测**页是切过去了**，只是这次调用报错 —— 所以重试一次，
        // 再不行就用 `currentPage()` 复核。
        let opened = false
        for (let attempt = 1; attempt <= 2 && !opened; attempt++) {
          try {
            await withTimeout(mp.reLaunch(`/pages/case-detail/index?patientId=${patientId}`), 30000, 'reLaunch')
            opened = true
          } catch {
            await new Promise((r) => setTimeout(r, 1500))
          }
        }
        if (!opened) {
          try {
            const cur = await mp.currentPage()
            console.log(`  · reLaunch 报错但当前页 = ${cur && cur.path}（继续）`)
          } catch {
            /* 拿不到就算了 */
          }
        }

        // 图是页面**自己**画的（组件里 400ms 防抖后开画）—— 等它出现
        //
        // ⚠️ 这里**不能**用 `wx.createSelectorQuery()`：在这套 Taro 产物上，
        // automator 上下文里它的 `exec` 回调**永远不触发**（实测），
        // 页面 `data()`／`$$()` 也一样超时 —— 40 秒也等不到。
        // → 改成直接读 **Taro 的虚拟 DOM**：`getCurrentPages()[last].data.root`
        //   是一棵 vdom 树，节点的 `cl` 是 className、props 存在 `p<n>` 字段里。
        //   找到 `cl === 'pr-diagram-img'` 的节点，取那个长得像临时文件路径的 prop。
        let picked = null
        for (let i = 0; i < 30 && !picked; i++) {
          await new Promise((r) => setTimeout(r, 1000))
          picked = await evaluateRetry(
            mp,
            () => {
              const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
              const page = pages[pages.length - 1]
              if (!page) return null
              let target = null
              const walk = (n) => {
                if (!n || typeof n !== 'object') return
                if (Array.isArray(n)) {
                  n.forEach(walk)
                  return
                }
                if (n.cl === 'pr-diagram-img') target = n
                if (n.cn) walk(n.cn)
              }
              walk(page.data && page.data.root)
              if (!target) return null
              for (const k of Object.keys(target)) {
                const val = target[k]
                // 临时文件路径长这样：http://tmp/xxx.png 或 wxfile://xxx
                if (typeof val === 'string' && /^(http:\/\/tmp\/|wxfile:\/\/)/.test(val)) {
                  return { src: val }
                }
              }
              return null
            },
            [],
            2,
          ).catch(() => null)
        }

        ok('页面上直接显示出了寸关尺关系图（不是按钮弹窗）', !!picked, picked ? '' : '等 30 秒也没等到 .pr-diagram-img')

        if (picked) {
          const png = await evaluateRetry(mp, (src) => {
            return new Promise((resolve) => {
              wx.getFileSystemManager().readFile({
                filePath: src,
                encoding: 'base64',
                success: (r) => resolve({ base64: r.data }),
                fail: (e) => resolve({ err: String(e.errMsg || e) }),
              })
            })
          }, [picked.src]).catch((e) => ({ err: String(e && e.message ? e.message : e) }))

          ok('图能读回来（临时文件没被回收）', !png.err && !!png.base64, png.err || '')

          if (png.base64) {
            const file = join(OUT, 'mp-canvas-diagram.png')
            writeFileSync(file, Buffer.from(png.base64, 'base64'))
            const stats = isBlankShot(file)
            ok(`出图尺寸是 ${IMG_W}×${IMG_H}（原图像素，不放大不缩小）`, stats.width === IMG_W && stats.height === IMG_H, `${stats.width}×${stats.height}`)
            ok('出的图不是白图（底图与标记块都画上了）', stats.blank === false, JSON.stringify(stats))
            console.log(`  · 产物：${file}`)
          }
        }
      }
    } finally {
      try {
        await mp.disconnect()
      } catch {
        /* 端口被回收是常态 */
      }
    }
  }
}

console.log(`\n合计：${pass + fail} 项，通过 ${pass}，失败 ${fail}`)
if (fail) {
  console.log('\n失败明细：')
  failures.forEach((f) => console.log(`  · ${f}`))
  process.exit(1)
}
console.log('微信 canvas 2d 出图回归全绿。\n')
