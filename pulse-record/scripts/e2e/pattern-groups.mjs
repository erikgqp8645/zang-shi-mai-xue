#!/usr/bin/env node
/**
 * 端到端测试：脉象图的「组说明」（格内角标去掉后，组信息改用文字）
 *
 * ## 背景
 *
 * 2026-11-12：用户在「五味异功1」那张图上标了两处 ——
 *   ① 左关浮那格**空着，却飘着一个小小的组号「1」**；
 *   ② 右关浮的 `0` 右上角**多了一个上角标「2」**。
 *
 * 查下来是两件事：
 *   · **角标本身**是程序自己加的（资料原图上没有），还跟脉象符号挤在一格里，
 *     `0²` 看着像「另一种脉象」⇒ 去掉格内角标，组信息改成图下方一行文字；
 *   · **左关浮那个空格**是数据残缺 —— `groups` 里引用了 `L|关|浮`，
 *     `cells` 里却没有它的要求 ⇒ 组 1 永远不可能成立，角标也没有依附对象。
 *
 * ## 这个脚本测什么
 *
 *   ① **纯函数真跑** —— `cellLabel()` / `groupLegend()` 的实际输出；
 *   ② **基线不变量** —— 每条图的 `groups` 引用的格**必须**都在 `cells` 里
 *      （就是这次的残缺形状，基线不许再犯）；
 *   ③ **界面层** —— 角标彻底没了（连 CSS 一起）、组说明在**两个渲染点**都在
 *      （缩略图 ＋ 弹层大图）、旧措辞「格角上标」不再出现。
 *
 * ## 计数比对的纪律
 *
 * 「有没有」改成「**几个**」：断言里搜一个词，要写清期望次数；
 * 同一个词的**不同写法**（JSX 文字 ＋ 字符串字面量）分别计数后求和。
 *
 * 跑法：node scripts/e2e/pattern-groups.mjs
 * ⚠️ 依赖 `miniprogram/utils/core` 产物 —— 先跑 `npm run build:core`。
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeChecker, stripComments, ROOT } from './lib.mjs'

const require = createRequire(import.meta.url)
const checker = makeChecker()

/** 数一个词在文本里出现几次（不是「在不在」，是「几个」） */
function count(src, needle) {
  if (!needle) return 0
  let n = 0
  let i = src.indexOf(needle)
  while (i !== -1) {
    n++
    i = src.indexOf(needle, i + needle.length)
  }
  return n
}

/* ------------------------------------------------------------------ */
/* 1. 纯函数：真跑 core 产物                                          */
/* ------------------------------------------------------------------ */

let pp
try {
  pp = require(join(ROOT, 'miniprogram/utils/core/domain/pulse-pattern.js'))
} catch (e) {
  console.error('读不到 core 产物 —— 先跑 `npm run build:core`')
  console.error(e.message)
  process.exit(1)
}

checker.check('PG1 cellLabel：左关浮 / 右关沉', pp.cellLabel('L|关|浮') === '左关浮' && pp.cellLabel('R|关|沉') === '右关沉', `${pp.cellLabel('L|关|浮')} / ${pp.cellLabel('R|关|沉')}`)

checker.check(
  'PG2 cellLabel：格键写不出来时原样返回（不替读者编部位）',
  pp.cellLabel('X|??|??') === 'X|??|??',
  pp.cellLabel('X|??|??'),
)

const base = JSON.parse(readFileSync(join(ROOT, 'src/content/pulse-patterns.json'), 'utf8')).patterns

checker.check(
  'PG3 groupLegend：多组图列出每组含哪几格',
  pp.groupLegend(base['fx-dl1-jiawei-sijun']) === '组 1：左关浮；组 2：右关浮',
  JSON.stringify(pp.groupLegend(base['fx-dl1-jiawei-sijun'])),
)

checker.check(
  'PG4 groupLegend：单组 / 没有 groups 时不出一道说明（默认语义就是全部同时成立）',
  pp.groupLegend({ cells: [{ cell: 'L|关|浮', term: '无或弱' }], groups: [['L|关|浮']] }) === null &&
    pp.groupLegend({ cells: [{ cell: 'L|关|浮', term: '无或弱' }] }) === null,
  `${JSON.stringify(pp.groupLegend({ cells: [{ cell: 'L|关|浮', term: '无或弱' }], groups: [['L|关|浮']] }))} / ${JSON.stringify(pp.groupLegend({ cells: [{ cell: 'L|关|浮', term: '无或弱' }] }))}`,
)

/** 这次的残缺形状：groups 引用了 cells 里没有的格 */
const broken = {
  title: '残缺样本',
  cells: [{ cell: 'R|关|浮', term: '无或弱' }],
  groups: [['L|关|浮'], ['R|关|浮']],
}
const brokenLegend = pp.groupLegend(broken)
checker.check(
  'PG5 groupLegend：过滤掉「在 groups 里但 cells 里没有」的格（空组不列）',
  brokenLegend === '组 2：右关浮',
  JSON.stringify(brokenLegend),
)

const multi = Object.entries(base).filter(([, p]) => Array.isArray(p.groups) && p.groups.length > 1)
checker.check('PG6 基线：多组图是 20 条（计数比对）', multi.length === 20, `实际 ${multi.length}`)

const legendBad = multi
  .map(([id, p]) => [id, pp.groupLegend(p)])
  .filter(([, l]) => !l || l.includes('：') && /组 \d+：；|：\s*；/.test(l))
checker.check('PG7 基线：每张多组图都出得了组说明，且没有空组', legendBad.length === 0, JSON.stringify(legendBad))

/** 这次的 bug 形状：groups 引用的格不在 cells 里 */
const orphan = []
for (const [id, p] of Object.entries(base)) {
  if (!Array.isArray(p.groups)) continue
  const has = new Set(p.cells.map((c) => c.cell))
  for (const g of p.groups) {
    for (const key of g) {
      if (!has.has(key)) orphan.push(`${id}:${key}`)
    }
  }
}
checker.check('PG8 基线不变量：groups 引用的格必须都在 cells 里（不许再有空组）', orphan.length === 0, JSON.stringify(orphan))

/* ------------------------------------------------------------------ */
/* 2. 界面层：角标没了，组说明在两个渲染点都在                          */
/* ------------------------------------------------------------------ */

const sheetSrc = stripComments(readFileSync(join(ROOT, 'src/components/PatternSheet.tsx'), 'utf8'))
const stripSrc = stripComments(readFileSync(join(ROOT, 'src/components/PatternStrip.tsx'), 'utf8'))
const cssSrc = readFileSync(join(ROOT, 'src/index.css'), 'utf8')

checker.check('PG9 PatternSheet 里不再有 <sup>（格内角标彻底没了）', count(sheetSrc, '<sup') === 0, `实际 ${count(sheetSrc, '<sup')} 处`)

/** 整个 src 里都不能再有那个角标类名（连 CSS 一起清掉） */
const allSrc = []
;(function walk(dir) {
  const { readdirSync, statSync } = require('node:fs')
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(tsx?|css|mjs|cjs|html)$/.test(name)) allSrc.push(stripComments(readFileSync(p, 'utf8')))
  }
})(join(ROOT, 'src'))
const gnoHits = allSrc.filter((s) => s.includes('pr-ps-gno'))
checker.check('PG10 整个 src 里不再有 pr-ps-gno（连 CSS 一起）', gnoHits.length === 0, `${gnoHits.length} 个文件还留着`)

checker.check(
  'PG11 PatternStrip 的两个渲染点都带组说明（缩略图 ＋ 弹层大图）',
  count(stripSrc, 'groupLegend(') === 2,
  `实际 ${count(stripSrc, 'groupLegend(')} 处`,
)

/* 旧措辞只在**注释**里出现是对的（那里解释「为什么去掉角标」）——
   所以比的是剥掉注释后的可见文案，不是源码原文。 */
const oldHit = allSrc.filter((s) => s.includes('格角上标'))
checker.check('PG12 界面可见文案里不再有「格角上标」这类旧措辞', oldHit.length === 0, `${oldHit.length} 个文件还留着`)

checker.check('PG13 index.css 有缩略图组说明的样式', count(cssSrc, '.pr-ps-thumb-groups') === 1, `实际 ${count(cssSrc, '.pr-ps-thumb-groups')} 处`)

checker.check(
  'PG14 PatternSheet 仍然渲染脉象符号（去掉角标不能连符号一起删了）',
  count(sheetSrc, 'requirementText(req)') === 1,
  `实际 ${count(sheetSrc, 'requirementText(req)')} 处`,
)

checker.check(
  'PG15 组说明那句语义说明只有一处（计数比对）',
  count(stripSrc, '每组内部要同时成立') === 1,
  `实际 ${count(stripSrc, '每组内部要同时成立')} 处`,
)

/* ------------------------------------------------------------------ */

process.exit(checker.summary() ? 0 : 1)
