#!/usr/bin/env node
/**
 * 模拟器回归 · **就诊工作台的四个页内 tab**
 *
 * ## 覆盖什么
 *
 * 2026-11-06 起，就诊工作台的页内 tab 从「脉象／判读／用药」三档
 * 改成 **「摸脉／体质／疗法／方药」** 四档：
 *
 *   摸脉 → 录这一次的左右手脉象（宽表 ／ 一次一屏）
 *   体质 → 开方三部曲的 ①（自己判断后点选，工具不代判）
 *   疗法 → 开方三部曲的 ②
 *   方药 → 开方三部曲的 ③（开方药清单 ＋ 用药记录）
 *
 * 这条脚本**逐档点过去、逐档截图、逐档断言内容**，而不是只截一张首屏。
 *
 * ## 踩过的坑（写在这儿，别再踩）
 *
 *   · `page.$$('.pr-subtab')` **是通的**（实测能拿到 4 个元素并读出文字）。
 *     以前记的「元素查询一律不通」不对 —— 不通的是 `page.data()` /
 *     `wx.createSelectorQuery().exec(cb)`，元素查询与 `el.text()` / `el.tap()` 可用。
 *   · `mp.evaluate()` 里**不能直接写 `typeof taro`** —— 那边的编译上下文
 *     没有 `taro` 这个全局变量，会抛「taro is not defined」。
 *   · 点完 tab 要等一帧再截图，否则拍到的是上一档的画面。
 *
 * ## 跑法
 *
 *   node scripts/e2e/taro-tabs.mjs                # 需要 9421 端口的自动化实例
 *   MP_SIM_WS=ws://127.0.0.1:9421 node scripts/e2e/taro-tabs.mjs
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

import { connect, rearm, withTimeout } from './lib-devtools.mjs'

const require = createRequire(import.meta.url)
const automator = require('miniprogram-automator')
const WS = process.env.MP_SIM_WS || 'ws://127.0.0.1:9421'
const OUT = process.env.MP_SHOT_DIR || join(process.env.TMPDIR || '/tmp', 'mp-taro-tabs')

let pass = 0
let fail = 0
function ok(label, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  · ${label}${detail ? ` —— ${detail}` : ''}`)
  }
}

/** 四档各自的判据：页面里必须出现的东西 */
const EXPECT = [
  {
    key: '摸脉',
    file: '摸脉.png',
    /** 脉象录入在：记录表的格子 ＋ 宽表／一次一屏切换 */
    need: [{ sel: '.pr-cell', min: 1 }, { sel: '.pr-chip', min: 2 }],
    /** 摸脉这一档**没有**三部曲导航头（那是体质档才有的） */
    absent: ['.pr-triad-head'],
  },
  {
    key: '体质',
    file: '体质.png',
    need: [{ sel: '.pr-triad-head', min: 1 }, { sel: '.pr-triad-opt', min: 3 }],
    absent: [],
  },
  {
    key: '疗法',
    file: '疗法.png',
    need: [{ sel: '.pr-triad-head', min: 1 }, { sel: '.pr-triad-opt', min: 3 }],
    absent: [],
  },
  {
    key: '方药',
    file: '方药.png',
    need: [
      { sel: '.pr-triad-head', min: 1 },
      { sel: '.pr-med-panel', min: 1 },
    ],
    absent: [],
  },
]

async function count(page, sel) {
  try {
    const els = await withTimeout(page.$$(sel), 8000, `$$${sel}`)
    return Array.isArray(els) ? els.length : 0
  } catch {
    return -1
  }
}

/** 页面里某个类名的元素合起来有多少字（用来认「① 判体质」这种标题） */
async function textOf(page, sel) {
  try {
    const els = await withTimeout(page.$$(sel), 8000, `$$${sel}`)
    if (!Array.isArray(els)) return ''
    const parts = []
    for (const el of els) {
      try {
        parts.push(await withTimeout(el.text(), 5000, 'text'))
      } catch {
        /* 单个读不到就跳过 */
      }
    }
    return parts.join(' ')
  } catch {
    return ''
  }
}

if (!automator) {
  console.log('  · 没装 miniprogram-automator，跳过')
  process.exit(0)
}

console.log('模拟器回归 · 就诊工作台的四档页内 tab')
mkdirSync(OUT, { recursive: true })

// 先重启小程序 —— 否则跑的是旧 bundle（bundle 在服务上下文里是缓存的）
rearm()
const mp = await connect(automator, WS)
if (!mp) {
  console.log(`  · 连不上自动化端口 ${WS} —— 环境没就绪，跳过（不是测试失败）`)
  process.exit(0)
}

try {
  await mp.switchTab('/pages/visit/index')
  await new Promise((r) => setTimeout(r, 2500))

  const page = await mp.currentPage()
  if (!page) {
    ok('能进到就诊页', false, 'currentPage() 拿不到')
  } else {
    ok('能进到就诊页', true)

    /* ---- 一、四档在不在、名字对不对 ---- */
    const tabs = await withTimeout(page.$$('.pr-subtab'), 8000, '$$tabs')
    const labels = []
    for (const el of tabs || []) {
      try {
        labels.push((await withTimeout(el.text(), 5000, 'text')).trim())
      } catch {
        labels.push('?')
      }
    }
    ok(
      '就诊工作台有 4 个页内 tab（摸脉/体质/疗法/方药）',
      labels.length === 4 && labels.join('/') === '摸脉/体质/疗法/方药',
      labels.join('/'),
    )

    /* ---- 二、逐档点过去、逐档断言 ---- */
    for (let i = 0; i < EXPECT.length; i++) {
      const spec = EXPECT[i]
      const el = (tabs || [])[i]
      if (!el) {
        ok(`「${spec.key}」这一档点得到`, false, '拿不到第 ' + (i + 1) + ' 个 tab 元素')
        continue
      }
      try {
        await withTimeout(el.tap(), 8000, 'tap')
      } catch (e) {
        ok(`「${spec.key}」这一档点得到`, false, String(e).slice(0, 60))
        continue
      }
      // 等一帧，让这一档画出来
      await new Promise((r) => setTimeout(r, 1200))
      ok(`「${spec.key}」这一档点得到`, true)

      for (const need of spec.need) {
        const n = await count(page, need.sel)
        ok(
          `「${spec.key}」档里有 ${need.sel}（≥${need.min}）`,
          n >= need.min,
          `实际 ${n}`,
        )
      }
      for (const sel of spec.absent) {
        const n = await count(page, sel)
        ok(`「${spec.key}」档里**没有** ${sel}`, n === 0, `实际 ${n}`)
      }

      /* ---- 截图（供人眼核对） ---- */
      const file = join(OUT, spec.file)
      await mp.screenshot({ path: file })
      ok(`「${spec.key}」档截到图`, existsSync(file), file)
    }

    /* ---- 三、三档标题要各归各位 ---- */
    // 回到体质档，认「① 判体质」
    const tabs2 = (await withTimeout(page.$$('.pr-subtab'), 8000, '$$tabs')) || []
    const titles = []
    for (const spec of EXPECT) {
      try {
        await withTimeout(tabs2[EXPECT.indexOf(spec)].tap(), 8000, 'tap')
        await new Promise((r) => setTimeout(r, 900))
        const t = await textOf(page, '.pr-card-title')
        titles.push(`${spec.key}→${t.trim()}`)
      } catch {
        titles.push(`${spec.key}→?`)
      }
    }
    ok(
      '三档标题各归各位（体质＝①判体质 / 疗法＝②定疗法 / 方药＝③开方药）',
      titles[1].includes('① 判体质') &&
        titles[2].includes('② 定疗法') &&
        titles[3].includes('③ 开方药'),
      titles.join(' | '),
    )
  }
} catch (e) {
  ok('模拟器回归跑完没炸', false, String(e).slice(0, 160))
}

console.log(`\n合计：${pass + fail} 项，通过 ${pass}，失败 ${fail}`)
console.log(`截图目录：${OUT}`)
if (fail) process.exit(1)
process.exit(0)
