#!/usr/bin/env node
/**
 * 模拟器回归 · **三部曲 ③ 的方名 → 「用方」知识库定位**
 *
 * ## 覆盖什么
 *
 * ③ 的方名（讲义 p47 图上的「清挡路方」「引火归元」「上焦方」…）**可点**：
 * 点一下跳到「用方」tab，落在那一条上，并把对照依据摆出来。
 *
 * 这一条链路有五段，任何一段断了都很难一眼看出是哪段：
 *   ① ③ 的方名可点（`.pr-link`）
 *   ② 跳转意图记进内存态 → `switchTab` 到「用方」
 *   ③ 用方页 `useDidShow` 取走意图 → 清关键词、切「讲稿原序」
 *   ④ 滚到目标条目并高亮（`.pr-focus`）
 *   ⑤ 锚点 id **唯一**（同一个方嵌在规则卡里、又在「方剂备查」里独立出现，
 *      两处都挂同一个 id 的话选择器会撞 —— 实测「中焦方」重复 6 次）
 *
 * ## 跑法
 *
 *   MP_SIM_WS=ws://127.0.0.1:9421 node scripts/e2e/taro-formula-link.mjs
 *
 * ## 踩过的坑（写在这儿，别再踩）
 *
 *   · `switchTab` 在这套 Taro 产物上**偶发**抛 automator 的
 *     `getPageMetaByWebviewId(...)` 为 null（webview 还没注册）——
 *     实测**切是切过去了**，只是这次调用报错。所以失败不致命，
 *     下面用 `currentPage()` 复核。
 *   · 切完 tab 要等一帧再截图／再查元素，否则拍到的是上一屏。
 *   · `page.$$('#id')` 在小程序里查的是**真实 DOM id** —— Taro 的 mini 运行时
 *     虽然在 hydrate 时排除了 `id` 属性，但 `uid` 通路会把它写进 WXML（实测有效）。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

import { connect, rearm, withTimeout } from './lib-devtools.mjs'

const require = createRequire(import.meta.url)
const automator = require('miniprogram-automator')
const WS = process.env.MP_SIM_WS || 'ws://127.0.0.1:9421'
const OUT = process.env.MP_SHOT_DIR || join(process.env.TMPDIR || '/tmp', 'mp-taro-formula-link')

let pass = 0
let fail = 0
function ok(label, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}${detail ? ' —— ' + detail : ''}`)
  }
}

/** 切 tab（tabBar 页只能用 switchTab） */
async function switchTab(mp, path) {
  try {
    await mp.switchTab(path)
  } catch (e) {
    console.log(`  · switchTab(${path}) 报错（${String(e).slice(0, 50)}）—— 用 currentPage 复核`)
  }
  await new Promise((r) => setTimeout(r, 2200))
  return mp.currentPage()
}

/** 取一批元素的文字 */
async function textsOf(page, sel, max = 30) {
  const els = await withTimeout(page.$$(sel), 8000, `$$${sel}`)
  const out = []
  for (const el of (els || []).slice(0, max)) {
    try {
      out.push((await withTimeout(el.text(), 5000, 'text')).trim().replace(/\s+/g, ' '))
    } catch {
      /* 跳过 */
    }
  }
  return out
}

/** 找到文字等于 target 的那个元素并点它 */
async function tapByText(page, sel, target) {
  const els = await withTimeout(page.$$(sel), 8000, `$$${sel}`)
  for (const el of els || []) {
    let t = ''
    try {
      t = (await withTimeout(el.text(), 5000, 'text')).trim()
    } catch {
      continue
    }
    if (t === target) {
      await withTimeout(el.tap(), 8000, 'tap')
      return true
    }
  }
  return false
}

/** 在「方药」档里点一个方名，返回点没点到 */
async function jumpFromTriad(mp, formulaName, expectLabel) {
  const visit = await switchTab(mp, '/pages/visit/index')
  if (!visit) {
    ok(`点「${formulaName}」跳到用方页`, false, '进不去就诊页')
    return null
  }
  /* ② 定疗法：三焦疗法 / 五脏疗法 / 一体疗法 —— ③ 的方名随疗法变 */
  const tabs = await withTimeout(visit.$$('.pr-subtab'), 8000, '$$tabs')
  if (!tabs || tabs.length < 4) {
    ok('就诊页有 4 个页内 tab', false, `拿到 ${tabs ? tabs.length : 0} 个`)
    return null
  }
  await withTimeout(tabs[2].tap(), 8000, 'tap')
  await new Promise((r) => setTimeout(r, 1200))
  const therapy = expectLabel === '清挡路' ? '三焦疗法' : '五脏疗法'
  const picked = await tapByText(visit, '.pr-triad-opt-name', therapy)
  if (!picked) {
    ok(`选「${therapy}」`, false, '点不到疗法选项')
    return null
  }
  await new Promise((r) => setTimeout(r, 1500))

  /* ③ 方药档 */
  const tabs2 = await withTimeout(visit.$$('.pr-subtab'), 8000, '$$tabs2')
  await withTimeout(tabs2[3].tap(), 8000, 'tap')
  await new Promise((r) => setTimeout(r, 1500))

  const linkTexts = await textsOf(visit, '.pr-triad-rx-name .pr-link')
  ok(
    `③ 的方名「${formulaName}」是可点的（.pr-link）`,
    linkTexts.indexOf(formulaName) >= 0,
    linkTexts.join('、'),
  )
  const hit = await tapByText(visit, '.pr-triad-rx-name .pr-link', formulaName)
  if (!hit) {
    ok(`点「${formulaName}」`, false, '点不到那个链接')
    return null
  }
  await new Promise((r) => setTimeout(r, 2200))

  const formulas = await mp.currentPage()
  ok(
    `点「${formulaName}」跳到「用方」页`,
    !!formulas && formulas.path === 'pages/formulas/index',
    formulas ? formulas.path : '拿不到当前页',
  )
  return formulas
}

console.log('\n模拟器回归 · ③ 的方名 →「用方」知识库定位\n')

rearm()
const mp = await connect(automator, WS)
if (!mp) {
  console.log(`  · 连不上自动化端口 ${WS} —— 环境没就绪，跳过（不是测试失败）`)
  console.log('    先跑：cli auto --project pulse-record/taro --auto-port 9421 --trust-project')
  process.exit(0)
}

try {
  mkdirSync(OUT, { recursive: true })

  /* ========== 一、规则条目（清挡路方 → 清挡路） ========== */
  const p1 = await jumpFromTriad(mp, '清挡路方', '清挡路')
  if (p1) {
    const bars = await withTimeout(p1.$$('.pr-focus-bar'), 8000, '$$bar')
    ok('用方页出现定位横幅', !!bars && bars.length === 1, `实际 ${bars ? bars.length : 0}`)
    const barText = (await textsOf(p1, '.pr-focus-bar')).join(' ')
    ok('横幅写明定位到哪一条', barText.includes('清挡路'), barText.slice(0, 80))
    ok('横幅写明对照依据', barText.includes('对照依据'), barText.slice(0, 120))

    const focused = await withTimeout(p1.$$('.pr-focus'), 8000, '$$focus')
    ok('目标条目被高亮（.pr-focus）', !!focused && focused.length >= 1, `实际 ${focused ? focused.length : 0}`)

    const anchors = await withTimeout(p1.$$('#rule-fx-ssx-qingdanglu'), 8000, '$$anchor')
    ok(
      '锚点 id 唯一（清挡路只挂一处）',
      !!anchors && anchors.length === 1,
      `实际 ${anchors ? anchors.length : 0} 个`,
    )

    /* 滚过去了没有：目标条目的 top 应该贴近视口上沿 */
    let top = null
    try {
      const off = await withTimeout(focused[0].offset(), 8000, 'offset')
      top = off && off.top
    } catch {
      /* 拿不到就算了 */
    }
    ok('页面滚到了目标条目（top 贴近视口上沿）', top !== null && top < 400, `top=${top}`)

    await mp.screenshot({ path: join(OUT, '用方-定位到清挡路.png') })
  }

  /* ========== 二、方剂条目（引火归元 → 引火归元（肾脏疗法）） ========== */
  const p2 = await jumpFromTriad(mp, '引火归元', '引火归元')
  if (p2) {
    const barText = (await textsOf(p2, '.pr-focus-bar')).join(' ')
    ok('横幅写明定位到「引火归元（肾脏疗法）」', barText.includes('引火归元（肾脏疗法）'), barText.slice(0, 100))

    const focused = await withTimeout(p2.$$('.pr-focus'), 8000, '$$focus')
    ok('目标条目被高亮（.pr-focus）', !!focused && focused.length >= 1, `实际 ${focused ? focused.length : 0}`)

    const anchors = await withTimeout(p2.$$('#drug-yinhui-guiyuan'), 8000, '$$anchor')
    ok(
      '锚点 id 唯一（引火归元只挂一处）',
      !!anchors && anchors.length === 1,
      `实际 ${anchors ? anchors.length : 0} 个`,
    )

    await mp.screenshot({ path: join(OUT, '用方-定位到引火归元.png') })
  }

  /* ========== 三、横幅跨 tab 切换保留，且「清除」能消掉 ==========
     注意：横幅是**页面状态**，不是残留的跳转意图 ——
     微信的 tabBar 页切走不卸载，所以读者回到「用方」页时仍知道自己刚才跳到了哪一条。
     「跳转意图取走即清空」由 lint 断言守着（store 层），这里测的是界面行为。 */
  await switchTab(mp, '/pages/cases/index')
  const p4 = await switchTab(mp, '/pages/formulas/index')
  const bars = p4 ? await withTimeout(p4.$$('.pr-focus-bar'), 8000, '$$bar') : null
  ok('离开再回「用方」页，横幅仍在（读者还知道跳到了哪一条）', !!bars && bars.length === 1, `实际 ${bars ? bars.length : 0}`)

  const cleared = p4 ? await tapByText(p4, '.pr-focus-bar-clear', '清除') : false
  ok('点「清除」能消掉横幅', cleared)
  await new Promise((r) => setTimeout(r, 900))
  const bars2 = p4 ? await withTimeout(p4.$$('.pr-focus-bar'), 8000, '$$bar2') : null
  ok('清除后横幅消失', !bars2 || bars2.length === 0, `实际 ${bars2 ? bars2.length : 0}`)

  ok('截图留档', existsSync(join(OUT, '用方-定位到清挡路.png')))
} catch (e) {
  ok('模拟器回归跑完了', false, String(e && e.message).slice(0, 160))
} finally {
  await mp.disconnect().catch(() => {})
}

console.log(`\n合计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`)
if (fail) process.exit(1)
