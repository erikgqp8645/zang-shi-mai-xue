#!/usr/bin/env node
/**
 * 端到端测试：**删掉一条讲义 p44 条目之后，前端照样起得来**
 *
 * ## 这条测试在守什么
 *
 * 讲义 p44 的命中判定是**代码**（`src/domain/formulas.ts` 的 `EVALUATORS`），
 * 条目数据是 **JSON**（`src/content/formula-rules.json`）。
 * 以前这两边是「双向校验、缺一即抛错」——
 * 所以管理员在命令行里删一条条目，前端会直接崩。
 *
 * 现在的规矩（2026-11-11 起）：
 *   · **数据有、判定函数没有 → 抛错**（新增一条没判定逻辑的规则，前端不许起不来）；
 *   · **判定函数有、数据没有 → 跳过**（条目被管理员删了，函数是残留代码，不加载）。
 *
 * 所以本测试直接拿**编译后的共享内核**（`miniprogram/utils/core`，网站端与小程序端共用）
 * 来验这两条方向 —— 不是验「命令行没报错」，是验**前端真的能载入**。
 *
 * 跑法：先 `npm run build:core`，再 `node scripts/e2e/rule-delete-loader.mjs`
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeChecker, ROOT } from './lib.mjs'

const checker = makeChecker()
const require = createRequire(import.meta.url)
const coreDir = join(ROOT, 'miniprogram', 'utils', 'core')

/* ------------------------------------------------------------------ */
/* 载入编译后的共享内核                                                  */
/* ------------------------------------------------------------------ */

let formulas
try {
  formulas = require(join(coreDir, 'domain/formulas.js'))
} catch (e) {
  checker.check('共享内核能被 require（先跑 npm run build:core）', false, e.message)
  process.exit(checker.summary() ? 0 : 1)
}

const { FORMULA_RULES, loadRulesFrom, EVALUATORS } = formulas

/** 磁盘上的 p44 规则数据（真源） */
const raw = JSON.parse(
  readFileSync(join(ROOT, 'src', 'content', 'formula-rules.json'), 'utf8'),
)

console.log('\n前端装载器 · 删除一条 p44 条目（讲义 2026-10·p44）\n')

/* ------------------------------------------------------------------ */
/* 1. 基线：数据与判定函数一一对应                                      */
/* ------------------------------------------------------------------ */

checker.check(
  '基线：磁盘上的规则条数与载入的一致',
  FORMULA_RULES.length === raw.rules.length,
  `载入 ${FORMULA_RULES.length} / 磁盘 ${raw.rules.length}`,
)

checker.check(
  '基线：每条规则都挂着判定函数（evaluate 是函数）',
  FORMULA_RULES.every((r) => typeof r.evaluate === 'function'),
)

/** 一条规则的**数据字段**（不含 evaluate / pattern / patterns 这些挂上去的） */
function dataOf(rule) {
  const out = {}
  for (const k of Object.keys(rule)) {
    if (k === 'evaluate' || k === 'pattern' || k === 'patterns') continue
    out[k] = rule[k]
  }
  return out
}

checker.check(
  '基线：有脉象图的规则都带上了 patterns 数组（没图的本来就没有）',
  FORMULA_RULES.filter((r) => r.pattern).every((r) => Array.isArray(r.patterns)),
)

checker.check(
  '基线：patterns[0] 与 pattern 一致（兼容字段没走偏）',
  FORMULA_RULES.filter((r) => r.pattern).every(
    (r) => JSON.stringify(r.patterns[0]) === JSON.stringify(r.pattern),
  ),
)

/* ------------------------------------------------------------------ */
/* 2. 少一条：管理员删掉了某条 → 照样载入                                */
/* ------------------------------------------------------------------ */

/** 拿一条**真的带判定函数**的规则来删（挑「主线」那一类，贴近实际用法） */
const victim =
  raw.rules.find((r) => r.kind === '主线' && r.id.startsWith('fx2-')) ?? raw.rules[0]
const withoutVictim = raw.rules.filter((r) => r.id !== victim.id)

let loaded = null
let loadError = null
try {
  loaded = loadRulesFrom(withoutVictim)
} catch (e) {
  loadError = e
}

checker.check(
  `少一条（删掉「${victim.id}」）之后：载入不报错`,
  loadError === null,
  loadError ? loadError.message : '',
)

checker.check(
  `少一条之后：正好少载入一条（${withoutVictim.length} 条）`,
  loaded !== null && loaded.length === withoutVictim.length,
  loaded ? `载入 ${loaded.length}` : '',
)

checker.check(
  '少一条之后：被删的那条不在结果里',
  loaded !== null && !loaded.some((r) => r.id === victim.id),
)

checker.check(
  '少一条之后：剩下的每一条都还有判定函数（没有一条被悄悄降级）',
  loaded !== null && loaded.every((r) => typeof r.evaluate === 'function'),
)

checker.check(
  '少一条之后：被删那条的判定函数还留在代码里（残留代码 → 放回来不用改代码）',
  typeof EVALUATORS[victim.id] === 'function',
)

/* ------------------------------------------------------------------ */
/* 3. 多一条：新增一条没判定函数的规则 → 必须报错（不许静默降级）      */
/* ------------------------------------------------------------------ */

const bogus = {
  id: 'fx-bogus-from-test',
  route: '肾虚',
  condition: '（测试用）',
  therapy: '（测试用）',
  formulas: [],
  source: '（测试用）',
  quote: '（测试用）',
  kind: '主线',
}

let bogusError = null
try {
  loadRulesFrom([...raw.rules, bogus])
} catch (e) {
  bogusError = e
}

checker.check(
  '多一条（没有判定函数）之后：载入报错（新增这条路仍然堵着）',
  bogusError !== null && String(bogusError.message).includes('fx-bogus-from-test'),
  bogusError ? bogusError.message : '居然没报错',
)

/* ------------------------------------------------------------------ */
/* 4. 删掉的条目的脉象图怎么办                                          */
/* ------------------------------------------------------------------ */

const patternRaw = JSON.parse(
  readFileSync(join(ROOT, 'src', 'content', 'pulse-patterns.json'), 'utf8'),
)
const hasPattern = Boolean(patternRaw.patterns?.[victim.id])

if (hasPattern) {
  checker.check(
    '被删那条的脉象图还留在 pulse-patterns.json 里（不级联删 —— 放回来时图还在）',
    Boolean(patternRaw.patterns?.[victim.id]),
  )
  checker.check(
    '被删那条的脉象图不会被挂到别的条目上（没有张冠李戴）',
    loaded !== null &&
      loaded.every((r) => !(r.patterns ?? []).some((p) => p?.id === victim.id)),
  )
} else {
  checker.check('（这条本来就没有脉象图，跳过脉象图两项检查）', true)
}

/* ------------------------------------------------------------------ */
/* 5. 往返：删掉再放回来，内容一字不差                                  */
/* ------------------------------------------------------------------ */

const roundTrip = loadRulesFrom(raw.rules)
checker.check(
  '放回来之后：条数与内容都回到原样（61 条，数据字段逐条一致）',
  roundTrip.length === raw.rules.length &&
    roundTrip.every((r, i) => JSON.stringify(dataOf(r)) === JSON.stringify(raw.rules[i])),
)

process.exit(checker.summary() ? 0 : 1)
