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
  /** 记录表的结构（组数／行数／列数／部位与取法序列）—— 两页对账用 */
  let detailShape = null

  /**
   * 读页面里 `record-sheet` 组件的结构。
   *
   * 表格从 2026-11-05 起住在组件里，**页面自己的 data 里没有 groups 了** ——
   * 所以行数要从组件实例读（`page.selectComponent('#sheet')`）。
   */
  const sheetShape = async () => {
    const r = await mp.evaluate(async () => {
      const pg = getCurrentPages().pop()
      const comp = pg && pg.selectComponent ? pg.selectComponent('#sheet') : null
      if (!comp) return { ok: false, err: '页面里找不到 record-sheet 组件' }
      const groups = comp.data.groups || []
      return {
        ok: true,
        groups: groups.length,
        rows: groups.reduce((n, g) => n + (g.rows || []).length, 0),
        cols: (comp.data.headSessions || []).length,
        organs: groups.map((g) => g.organ).join(''),
        depths: groups.map((g) => (g.rows || []).map((x) => x.depth).join('')).join('/'),
        tfoot: (comp.data.headSessions || []).length,
      }
    })
    return r
  }

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

        // 记录表用的是 record-sheet 组件 —— 结构要与体例一致
        const shape = await sheetShape()
        ok('病例详情：记录表用的是 record-sheet 组件', !!shape.ok, shape.err || '')
        if (shape.ok) {
          detailShape = shape
          ok(
            '病例详情：记录表的行数与体例一致',
            shape.rows === rows,
            `记录表 ${shape.rows} 行，体例 ${rows} 行`,
          )
          ok('病例详情：记录表有表下体质／疗法两行', shape.tfoot === shape.cols && shape.cols > 0)
        }

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

        /* ---- 就地编辑：点格 → 改符号 → 立刻落库 ----
         * 记录表这一页没有「保存」按钮，改完必须已经存进库里（PATCH /api/visits/:id）。
         * 验证方式：改一格 → 重新从服务端拉一次 → 拉回来的是新值＝落库成功 → 再复原。 */
        const edit = await mp.evaluate(async () => {
          const pg = getCurrentPages().pop()
          const comp = pg.selectComponent('#sheet')
          const s0 = (comp.data.sessions || [])[0]
          if (!s0) return { ok: false, err: '这条记录还没有记录列' }
          const key = 'L|寸|浮'
          const before = ((s0.values || {})[key] || []).slice()
          const tap = () =>
            comp.onCellTap({
              currentTarget: { dataset: { sessionId: s0.id, hand: 'L', organ: '寸', depth: '浮' } },
            })
          tap()
          await new Promise((r) => setTimeout(r, 200))
          comp.applyCodes(['X'])
          await new Promise((r) => setTimeout(r, 1500))
          await pg.load()
          const after = ((pg.data.sessions || []).find((s) => s.id === s0.id) || {}).values || {}
          const got = after[key] || []
          const persisted = got.length === 1 && got[0] === 'X'
          // 复原（冒烟不该留下改过的演示数据）
          tap()
          await new Promise((r) => setTimeout(r, 200))
          comp.applyCodes(before)
          await new Promise((r) => setTimeout(r, 1200))
          await pg.load()
          const back = ((pg.data.sessions || []).find((s) => s.id === s0.id) || {}).values || {}
          return { ok: true, persisted, got, back: back[key] || [], before }
        })
        ok('病例详情：记录表可就地编辑', !!edit.ok, edit.err || '')
        ok(
          '病例详情：改完立刻落库（重新拉取能读到新值）',
          !!edit.ok && edit.persisted,
          edit.ok ? `拉到 ${JSON.stringify(edit.got)}` : edit.err,
        )
        ok(
          '病例详情：冒烟改的格子已复原',
          !!edit.ok && JSON.stringify(edit.back) === JSON.stringify(edit.before),
          edit.ok ? `复原后 ${JSON.stringify(edit.back)}，原来 ${JSON.stringify(edit.before)}` : edit.err,
        )

        /* ---- 连续改两格：第二格不能把第一格写坏 ----
         * 小程序自定义组件的属性会走一圈 逻辑层→视图层→逻辑层，
         * 视图层把嵌套数组压成「数字下标的普通对象」（["X"] → {"0":"X"}）。
         * 不规整的话，**第二次**编辑就会把上一格已经成型的形状一起写坏。 */
        const two = await mp.evaluate(async () => {
          const pg = getCurrentPages().pop()
          const comp = pg.selectComponent('#sheet')
          const s0 = (comp.data.sessions || [])[0]
          if (!s0) return { ok: false, err: '没有记录列' }
          const A = 'L|寸|浮'
          const B = 'R|寸|浮'
          const origA = ((s0.values || {})[A] || []).slice()
          const origB = ((s0.values || {})[B] || []).slice()
          const tap = (hand) =>
            comp.onCellTap({
              currentTarget: { dataset: { sessionId: s0.id, hand, organ: '寸', depth: '浮' } },
            })
          const set = async (hand, codes) => {
            tap(hand)
            await new Promise((r) => setTimeout(r, 200))
            comp.applyCodes(codes)
            await new Promise((r) => setTimeout(r, 1200))
          }
          await set('L', ['X'])
          await set('R', ['X'])
          await pg.load()
          const v = (((pg.data.sessions || []).find((s) => s.id === s0.id) || {}).values) || {}
          const a = v[A]
          const b = v[B]
          const shapesOk = Array.isArray(a) && Array.isArray(b)
          // 复原
          await set('L', origA)
          await set('R', origB)
          await pg.load()
          const back = ((((pg.data.sessions || []).find((s) => s.id === s0.id) || {}).values) || {})
          return {
            ok: true,
            shapesOk,
            a,
            b,
            restored:
              JSON.stringify(back[A] || []) === JSON.stringify(origA) &&
              JSON.stringify(back[B] || []) === JSON.stringify(origB),
          }
        })
        ok(
          '连续改两格：两格都还是数组（没被视图层压成 {"0":"X"}）',
          !!two.ok && two.shapesOk,
          two.ok ? `A=${JSON.stringify(two.a)} B=${JSON.stringify(two.b)}` : two.err,
        )
        ok(
          '连续改两格：冒烟改的两格已复原',
          !!two.ok && two.restored,
          two.ok ? `复原后 A=${JSON.stringify(two.a)} B=${JSON.stringify(two.b)}` : two.err,
        )
      }
      if (path.includes('/record') && p) {
        // 录入记录的行数，必须与记录表（组件）画的一致 ——
        // 体例只有一个真源（库里的 patients.layout），两边永远要一样。
        const d = await p.data()
        const shape = await sheetShape()
        ok('录入记录：用的是 record-sheet 组件', !!shape.ok, shape.err || '')
        if (shape.ok) {
          ok(
            '录入记录与记录表的行数一致（体例只有一个真源）',
            shape.rows > 0 && shape.rows === detailRows,
            `录入记录 ${shape.rows} 行，记录表 ${detailRows} 行`,
          )
          ok(
            '录入记录与记录表的版式完全一致（同一个组件）',
            !!detailShape &&
              shape.organs === detailShape.organs &&
              shape.depths === detailShape.depths &&
              shape.cols === detailShape.cols,
            `录入 ${shape.organs}|${shape.depths}|${shape.cols}列，记录表 ${detailShape ? detailShape.organs + '|' + detailShape.depths + '|' + detailShape.cols + '列' : '（无）'}`,
          )
        }
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
