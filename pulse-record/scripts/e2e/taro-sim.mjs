#!/usr/bin/env node
/**
 * 小程序模拟器冒烟（Taro 版）—— 替代 `mp-sim.mjs`
 *
 * ## 为什么拆成三段
 *
 * 迁到 Taro 之后，`miniprogram-automator` 的 `page.callMethod()` **彻底用不了**了 ——
 * 页面是 React 组件，拿不到实例方法（原生版靠 `mp.evaluate` 驱动页面实例那一套也一并失效）。
 * 所以把可测的面拆开：
 *
 *   ① **纯函数断言** —— 上下文推导（`store/logic.ts`）与形状规整
 *      （`components/record-sheet/shapes.ts`）都是纯 TS，用 esbuild 打出来直接断言。
 *      **不需要开发者工具。**
 *   ② **编译产物断言** —— `dist/` 里关键文件在不在、tabBar 是不是 4 项、
 *      分包声明对不对、记录表组件有没有被打进去。**不需要开发者工具。**
 *   ③ **模拟器截图** —— 逐页打开、截图、查关键元素。**需要开发者工具开着自动化端口。**
 *
 * 用法：
 *   node scripts/e2e/taro-sim.mjs            # ①② 必跑，③ 环境没就绪就跳过
 *   MP_SIM_WS=ws://127.0.0.1:9420 node ...   # 指定自动化端口
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { build } from '../../taro/node_modules/esbuild/lib/main.js'

import { isBlankShot } from './lib-png.mjs'

const ROOT = resolve(join(import.meta.dirname, '../..'))
const TARO = join(ROOT, 'taro')
const SRC = join(TARO, 'src')
const DIST = join(TARO, 'dist')

const WS = process.env.MP_SIM_WS ?? 'ws://127.0.0.1:9420'
const OUT = process.env.MP_SIM_OUT ?? join(tmpdir(), 'mp-taro-sim')

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

function fmtErr(e) {
  return e && e.message ? e.message : String(e)
}

/* ========================================================================
 * ① 纯函数断言
 * ======================================================================== */
console.log('\n小程序模拟器冒烟（Taro · 纯函数）\n')

const outDir = mkdtempSync(join(tmpdir(), 'pulse-taro-sim-'))
const pureFile = join(outDir, 'pure.mjs')

await build({
  entryPoints: [
    join(SRC, 'store', 'logic.ts'),
    join(SRC, 'components', 'record-sheet', 'shapes.ts'),
  ],
  outdir: outDir,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  logLevel: 'silent',
  outbase: SRC,
})

const logic = await import(pathToFileURL(join(outDir, 'store/logic.js')).href)
const shapes = await import(pathToFileURL(join(outDir, 'components/record-sheet/shapes.js')).href)

/* ---- 形状规整：视图层把嵌套数组压成对象的那一头 ---- */
ok('数组原样返回', JSON.stringify(shapes.toCodeArray(['X'])) === JSON.stringify(['X']))
ok(
  '{"0":"X"} 被还原成 ["X"]',
  JSON.stringify(shapes.toCodeArray({ 0: 'X' })) === JSON.stringify(['X']),
)
ok(
  '{"0":"++","1":"↑"} 顺序不乱',
  JSON.stringify(shapes.toCodeArray({ 0: '++', 1: '↑' })) === JSON.stringify(['++', '↑']),
)
ok('非数字键被忽略', JSON.stringify(shapes.toCodeArray({ a: 'X', 0: 'Y' })) === JSON.stringify(['Y']))
ok('空值返回空数组', JSON.stringify(shapes.toCodeArray(undefined)) === JSON.stringify([]))

const cleaned = shapes.cleanValues({ 'L|寸|浮': { 0: 'X' }, 'R|关|中': [] })
ok('cleanValues 把每个格值还原成数组', Array.isArray(cleaned['L|寸|浮']))
ok('cleanValues 丢掉空格子', !('R|关|中' in cleaned))

const cs = shapes.cleanSessions([
  { id: 'a', values: { 'L|寸|浮': { 0: 'X' } } },
  { id: 'b', values: { 'L|尺|沉': { 0: '+', 1: '↑' } } },
])
ok('cleanSessions 逐条规整', Array.isArray(cs[0].values['L|寸|浮']) && Array.isArray(cs[1].values['L|尺|沉']))
ok('cleanSessions 不改 id', cs[0].id === 'a' && cs[1].id === 'b')

ok(
  'sameSessions：内容相同视为同一份',
  shapes.sameSessions([{ id: 'a', values: { x: ['1'] } }], [{ id: 'a', values: { x: ['1'] } }]),
)
ok(
  'sameSessions：格值不同不算同一份',
  !shapes.sameSessions([{ id: 'a', values: { x: ['1'] } }], [{ id: 'a', values: { x: ['2'] } }]),
)
ok(
  'sameSessions：体质不同不算同一份',
  !shapes.sameSessions(
    [{ id: 'a', values: {}, constitution: '肾虚' }],
    [{ id: 'a', values: {}, constitution: '上盛下虚' }],
  ),
)

/* ---- 上下文推导：切患者／切就诊 ---- */
const visits = [
  { id: 'v1', label: '3月5日', at: 100 },
  { id: 'v2', label: '3月1日', at: 200 },
]
ok('pickLatestVisit 取最近的一次', logic.pickLatestVisit(visits).id === 'v2')
ok('pickLatestVisit 没有记录返回 null', logic.pickLatestVisit([]) === null)

const prev = { patientId: 'p1', visitId: 'v1', visitDate: '3月5日' }
const switched = logic.contextAfterPatientChange('p2', visits, prev)
ok('换患者 → 就诊落到该患者最近一次', switched.patientId === 'p2' && switched.visitId === 'v2')
ok('换患者 → 日期标签跟着走', switched.visitDate === '3月1日')

const same = logic.contextAfterPatientChange('p1', visits, prev)
ok('没换患者 → 原就诊仍留着', same.visitId === 'v1' && same.visitDate === '3月5日')

const noVisits = logic.contextAfterPatientChange('p3', [], prev)
ok('新患者没有记录 → 就诊为空（新建状态）', noVisits.visitId === null)

const visitChanged = logic.contextAfterVisitChange('p1', { id: 'v2', label: '3月1日' })
ok('切就诊 → 患者不变', visitChanged.patientId === 'p1')
ok('切就诊 → 就诊与日期都换', visitChanged.visitId === 'v2' && visitChanged.visitDate === '3月1日')

const norm = logic.normalizeContext({ patientId: '', visitId: null, visitDate: '' })
ok('normalizeContext 把空值规整掉', norm.patientId === null && typeof norm.visitDate === 'string')
ok(
  'normalizeContext 保留合法的患者',
  logic.normalizeContext({ patientId: 'p1', visitId: 'v1', visitDate: '3月5日' }).patientId === 'p1',
)

ok('contextLabel 拼出「谁 · 哪一次」', logic.contextLabel({ patientId: 'p', visitId: 'v', visitDate: '3月5日' }, '郭丽君') === '郭丽君 · 3月5日')
ok('contextLabel 没患者时给出提示', logic.contextLabel({ patientId: null, visitId: null, visitDate: '3月5日' }, null).includes('未选患者'))

rmSync(outDir, { recursive: true, force: true })

/* ========================================================================
 * ② 编译产物断言
 * ======================================================================== */
console.log('\n编译产物\n')

ok('dist/ 存在（先跑 npm run build:weapp）', existsSync(DIST))

if (existsSync(DIST)) {
  const appJsonPath = join(DIST, 'app.json')
  ok('dist/app.json 存在', existsSync(appJsonPath))

  if (existsSync(appJsonPath)) {
    const appJson = JSON.parse(readFileSync(appJsonPath, 'utf8'))
    // 核心页面集合 —— **加页面不用改这里**，只要不动核心页
    const REQUIRED_PAGES = [
      'pages/cases/index',
      'pages/visit/index',
      'pages/formulas/index',
      'pages/me/index',
      'pages/case-detail/index',
      'pages/login/index',
      'pages/privacy/index',
    ]
    const missingPages = REQUIRED_PAGES.filter((p) => !appJson.pages.includes(p))
    ok(
      `app.json 登记了全部 ${REQUIRED_PAGES.length} 个核心页面`,
      missingPages.length === 0,
      missingPages.join(' '),
    )
    ok(
      'app.json 有 4 个 tab',
      appJson.tabBar && appJson.tabBar.list.length === 4,
      appJson.tabBar ? String(appJson.tabBar.list.length) : '无',
    )
    if (appJson.tabBar) {
      ok(
        'tabBar 是「病例 / 就诊 / 用方 / 我的」',
        appJson.tabBar.list.map((t) => t.text).join('/') === '病例/就诊/用方/我的',
        appJson.tabBar.list.map((t) => t.text).join('/'),
      )
      ok(
        'tabBar 每项都有图标',
        appJson.tabBar.list.every((t) => t.iconPath && t.selectedIconPath),
      )
    }
    for (const p of REQUIRED_PAGES) {
      ok(`${p} 在 dist 里有产物`, existsSync(join(DIST, `${p}.js`)) && existsSync(join(DIST, `${p}.wxml`)))
    }
    ok('dist/assets 有图示底图（/assets/hands-pulse.png）', existsSync(join(DIST, 'assets', 'hands-pulse.png')))
    ok('dist/assets 有三部曲图（/assets/triad-p47.png）', existsSync(join(DIST, 'assets', 'triad-p47.png')))
    ok('dist/assets 有 tabBar 图标目录', existsSync(join(DIST, 'assets', 'tabbar')))
  }

  // 记录表组件的样式（讲义 p34 取色）进了产物
  const cssFiles = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.wxss')) cssFiles.push(p)
    }
  }
  if (existsSync(DIST)) walk(DIST)
  const cssAll = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
  ok('产物里有部位列橙色 #ffc000', /#ffc000/i.test(cssAll))
  ok('产物里有表底 #cce8cf', /#cce8cf/i.test(cssAll))

  // 包体
  const size = (dir) => {
    let total = 0
    const walkSize = (d) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name)
        if (statSync(p).isDirectory()) walkSize(p)
        else total += statSync(p).size
      }
    }
    walkSize(dir)
    return total
  }
  const bytes = size(DIST)
  ok(`主包 ${(bytes / 1024 / 1024).toFixed(2)} MB < 微信上限 2 MB`, bytes < 2 * 1024 * 1024, `${bytes} 字节`)
}

/* ========================================================================
 * ③ 模拟器截图
 * ======================================================================== */
console.log('\n模拟器截图\n')

let automator = null
try {
  const mod = await import('miniprogram-automator')
  // 包的 `module.exports = new Automator()`：走 ESM 互操作时它在 `mod.default`，
  // 但要认准「有 connect 的那个」，不能只看 default 在不在。
  automator =
    mod.default && typeof mod.default.connect === 'function'
      ? mod.default
      : typeof mod.connect === 'function'
        ? mod
        : null
} catch {
  console.log('  · 没装 miniprogram-automator，跳过截图段')
}

if (automator) {
  let mp = null
  try {
    mp = await automator.connect({ wsEndpoint: WS })
  } catch (e) {
    console.log(`  · 连不上自动化端口 ${WS} —— 环境没就绪，跳过截图段（不是测试失败）`)
    console.log('    先跑：cli auto --project pulse-record/taro --auto-port 9420 --trust-project')
  }

  if (mp) {
    const shots = []
    try {
      // API 要点（实测 `node_modules/miniprogram-automator/out/*.d.ts`）：
      //   · `connect()` 返回的**就是 MiniProgram**，它自己没有 `launch`（launch 在 Automator 上）
      //   · 截图是 **MiniProgram.screenshot({path})**，Page 上没有 screenshot 方法
      //   · tabBar 页用 `switchTab` 切，不是 `navigateTo`
      // 截图目录要先建 —— 少了这一步，automator 写文件直接 ENOENT（实测踩过）
      mkdirSync(OUT, { recursive: true })
      const pages = [
        { path: '/pages/cases/index', name: '病例' },
        { path: '/pages/visit/index', name: '就诊' },
        { path: '/pages/formulas/index', name: '用方' },
        { path: '/pages/me/index', name: '我的' },
      ]
      for (const p of pages) {
        await mp.switchTab(p.path)
        // 多等一会儿：Taro 首屏渲染比原生慢，截太早会拍到还没画完的帧
        await new Promise((r) => setTimeout(r, 1500))
        const file = join(OUT, `${p.name}.png`)
        await mp.screenshot({ path: file })
        shots.push({ name: p.name, file })
        ok(`${p.name} 页能打开并截图`, existsSync(file), file)

        // **白屏检查** —— 小程序启动崩溃时截图是纯白一张。
        // 这类错构建不报错、静态回归全绿（查的是文件在不在，不是运行时），
        // 只有这条能抓到（真出过：产物里残留 process.env.xxx → 运行时没有 process → 整屏白）。
        const shot = isBlankShot(file)
        ok(
          `${p.name} 页不是白屏（${shot.distinctColors} 种颜色 / 非白像素 ${(shot.nonWhiteRatio * 100).toFixed(1)}%）`,
          !shot.blank,
          JSON.stringify(shot),
        )
      }
      console.log(`\n截图目录：${OUT}`)
      shots.forEach((s) => console.log(`  · ${s.name} → ${s.file}`))
    } catch (e) {
      ok('模拟器逐页截图', false, fmtErr(e))
    } finally {
      try {
        await mp.disconnect()
      } catch {
        /* ignore */
      }
    }
  }
}

/* ========================================================================
 * 汇总
 * ======================================================================== */
console.log(`\n合计：${pass + fail} 项，通过 ${pass}，失败 ${fail}`)
if (fail) {
  console.log('\n失败明细：')
  failures.forEach((f) => console.log(`  · ${f}`))
  process.exit(1)
}
console.log('小程序模拟器冒烟全绿。\n')
