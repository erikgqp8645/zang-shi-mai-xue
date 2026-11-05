#!/usr/bin/env node
/**
 * 小程序**模拟器**冒烟 —— 真跑一遍开发者工具里的模拟器，逐页截图取证。
 *
 * 静态检查（mp-lint.mjs）看不出「画不出图」这类静默失败，只有真跑一遍才知道。
 * 2026-11-04 就是靠这个脚本抓到出图链路把底图传成尺寸占位对象的 bug：
 * 页面看着像「图还没生成」，不翻 console 根本发现不了。
 *
 * 前置（三条命令，另开终端或本脚本之前跑）：
 *   1) 后端在跑：                npm run mp:dev          （打印局域网 IP 与端口）
 *   2) 开发者工具开了自动化端口： cli auto --project <小程序目录> --auto-port 9420 --trust-project
 *   3) 有一个带演示数据的账号：   npm run admin -- create mptest01 mpTest2026 测试
 *                                PULSE_LOGIN=mptest01 PULSE_PASSWORD=mpTest2026 npm run seed:demo
 *
 * 用法：
 *   node scripts/e2e/mp-sim.mjs
 *   MP_WS=ws://127.0.0.1:9420 MP_LOGIN=mptest01 MP_PASSWORD=mpTest2026 node scripts/e2e/mp-sim.mjs
 *
 * 退出码：0 全过；1 有失败项；2 环境没就绪（开发者工具没开自动化端口等）。
 */
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import automator from 'miniprogram-automator'

const WS = process.env.MP_WS ?? 'ws://127.0.0.1:9420'
const LOGIN = process.env.MP_LOGIN ?? 'mptest01'
const PASSWORD = process.env.MP_PASSWORD ?? 'mpTest2026'
const OUT = process.env.MP_OUT ?? join(tmpdir(), 'mp-sim')

let pass = 0
let fail = 0
const failures = []
const problems = []

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function fmtErr(e) {
  if (!e) return '（空）'
  if (typeof e === 'string') return e
  try {
    return JSON.stringify(e, Object.getOwnPropertyNames(e))
  } catch {
    return String(e)
  }
}

console.log('\n小程序模拟器冒烟\n')

let mp
try {
  mp = await automator.connect({ wsEndpoint: WS })
} catch (e) {
  console.error(`\n连不上自动化端口 ${WS} —— 环境没就绪，不是测试失败。`)
  console.error('先跑：')
  console.error('  cli auto --project <小程序目录> --auto-port 9420 --trust-project')
  console.error(`原始错误：${fmtErr(e)}\n`)
  process.exit(2)
}

try {
  mp.on('console', (msg) => {
    const text = typeof msg === 'string' ? msg : JSON.stringify(msg)
    if (/"type"\s*:\s*"error"/.test(text) || /MiniProgramError|SystemError/.test(text)) {
      problems.push('[console] ' + text)
    }
  })
  mp.on('exception', (e) => problems.push('[exception] ' + fmtErr(e)))

  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  const current = () => mp.currentPage()
  const shot = async (name) => {
    try {
      await mp.screenshot({ path: join(OUT, `${name}.jpg`) })
      return true
    } catch (e) {
      problems.push(`[screenshot:${name}] ${fmtErr(e)}`)
      return false
    }
  }
  const waitPath = async (target, timeout = 15000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const p = await current()
      if (p && p.path === target) return p
      await sleep(300)
    }
    const p = await current()
    throw new Error(`等不到页面 ${target}，当前在 ${p ? p.path : '（无）'}`)
  }

  /* ---- 1. 登录 ---- */
  const start = await current()
  ok('进入小程序（当前页 ' + (start ? start.path : '无') + '）', !!start)
  await shot('00-entry')

  if (start && start.path === 'pages/login/login') {
    const inputs = await start.$$('input')
    ok('登录页有两个输入框', inputs.length >= 2, `实际 ${inputs.length} 个`)
    await inputs[0].input(LOGIN)
    await inputs[1].input(PASSWORD)
    await sleep(300)
    const btn = await start.$('.pr-btn-primary')
    ok('登录页有登录按钮', !!btn)
    if (btn) {
      await btn.tap()
      try {
        await waitPath('pages/cases/cases')
        ok('账号密码登录成功（跳到病例列表）', true)
      } catch (e) {
        ok('账号密码登录成功（跳到病例列表）', false, fmtErr(e))
      }
    }
  } else {
    console.log('  · 已有登录态，跳过登录')
  }

  /* ---- 2. 病例列表，顺手拿一位患者的 id ---- */
  // 不管从哪个页面进来的，先切到病例列表 —— 否则读到的是别的页的 data
  await mp.switchTab('/pages/cases/cases')
  await sleep(1500)
  await shot('01-cases')
  const casesPage = await current()
  const casesData = (await casesPage.data()) ?? {}
  const patients = casesData.patients ?? []
  ok('病例列表有患者', Array.isArray(patients) && patients.length > 0, `实际 ${patients.length} 位`)
  const first = Array.isArray(patients) ? patients[0] : null
  const patientId = first ? (first.id ?? first.patientId ?? '') : ''
  console.log(`  · 首位患者：${first ? first.name : '（无）'} ${patientId}`)

  /* ---- 3. 四个 tab 页 ---- */
  for (const [name, path] of [
    ['02-findings', '/pages/findings/findings'],
    ['03-triad', '/pages/triad/triad'],
    ['04-me', '/pages/me/me'],
  ]) {
    try {
      await mp.switchTab(path)
      await sleep(1500)
      await shot(name)
      const p = await current()
      ok(`${path} 能打开且有数据`, !!p && p.path === path.replace(/^\//, ''), p ? p.path : '（无页面）')
    } catch (e) {
      ok(`${path} 能打开且有数据`, false, fmtErr(e))
    }
  }

  /* ---- 4. 三个带 patientId 的页 ---- */
  /** 记录表（病例详情页）画了多少行 —— 用来跟录入记录的行数对账 */
  let detailRows = 0
  for (const [name, path] of [
    ['05-case-detail', '/pages/case-detail/case-detail'],
    ['06-record', '/pages/record/record'],
    ['07-medication', '/pages/medication/medication'],
  ]) {
    try {
      await mp.navigateTo(`${path}?patientId=${patientId}`)
      await sleep(1800)
      await shot(name)
      const p = await current()
      ok(`${path} 能打开且有数据`, !!p && p.path === path.replace(/^\//, ''), p ? p.path : '（无页面）')
      if (path.includes('case-detail') && p) {
        const d = await p.data()
        ok('病例详情：出图画布有尺寸', Number(d.canvasW) > 0 && Number(d.canvasH) > 0, `canvasW=${d.canvasW} canvasH=${d.canvasH}`)
        // 页面画布**只画表格**：高度＝表高（42×2 表头 ＋ 行数×40 正文），
        // 不含寸关尺图示 —— 图示默认不显示，要看单独开窗体。
        // 常量与 src/export/table-painter.ts 一致（HEAD_H 42 / ROW_H 40）。
        const rows = d.layout === 'seven' ? 7 : 9
        detailRows = rows
        const expectH = 42 * 2 + rows * 40
        ok(
          '病例详情：页面画布只有表格（默认不显示寸关尺图示）',
          Math.round(d.canvasH) === expectH,
          `canvasH=${d.canvasH}，期望 ${expectH}（纯表高）`,
        )
        ok('病例详情：没有报错', !d.error, String(d.error || ''))

        for (const [name, method] of [
          ['导出图（表格＋图示）', 'renderExportImage'],
          ['寸关尺图示（单独一张）', 'renderDiagramImage'],
        ]) {
          // automator 的 callMethod 在当前开发者工具版本里整体不可用
          // （连一直存在的 buildSet 都报「is not a function」），改用 evaluate 驱动页面实例。
          const r = await mp.evaluate(async (m) => {
            const pg = getCurrentPages().pop()
            try {
              const out = await pg[m]()
              return { ok: true, out: String(out || '') }
            } catch (e) {
              return { ok: false, err: String((e && e.message) || e) }
            }
          }, method)
          ok(`病例详情：${name}出得来`, !!r.ok && r.out.length > 0, r.ok ? r.out : r.err)
        }
      }
      if (path.includes('/record') && p) {
        // 录入记录的行数，必须与记录表（画布）画的一致 ——
        // 体例只有一个真源（库里的 patients.layout），两边永远要一样。
        const d = await p.data()
        const rows = (d.groups || []).reduce((n, g) => n + g.rows.length, 0)
        ok(
          '录入记录与记录表的行数一致（体例只有一个真源）',
          rows > 0 && rows === detailRows,
          `录入记录 ${rows} 行，记录表 ${detailRows} 行`,
        )
        ok('录入记录没有报错', !d.error, String(d.error || ''))
      }
      await mp.navigateBack()
      await sleep(600)
    } catch (e) {
      ok(`${path} 能打开且有数据`, false, fmtErr(e))
      try {
        await mp.switchTab('/pages/cases/cases')
        await sleep(600)
      } catch {
        /* 回不去就接着跑下一页 */
      }
    }
  }

  /* ---- 5. console 干净 ---- */
  ok('模拟器 console 没有报错', problems.length === 0, problems.slice(0, 2).join(' | '))
} finally {
  await mp.disconnect().catch(() => {})
}

console.log(`\n共 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`)
if (failures.length) {
  console.log('失败项：')
  for (const f of failures) console.log('  · ' + f)
}
console.log(`截图目录：${OUT}\n`)
process.exit(fail === 0 ? 0 : 1)
