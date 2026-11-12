#!/usr/bin/env node
/**
 * 端到端测试：「理中」的**母方关系**（讲义 p42 第 10 行「加味理中」的母方＝理中汤）
 *
 * ## 背景
 *
 * 2026-11-12：用户问「这里没有理中，请处理，先解释为什么没有理中，只有加味理中」。
 * 三条资料线逐层核实后的结论是：
 *
 *   · **讲义 2026-10·p42「依脉用方表」28 行里没有名为「理中」的行**
 *     （第 10 行是「加味理中」、第 11 行是「理中术姜芪」）—— 已把物理页 42
 *     渲染成图逐行核对过，我们那 28 行与原表逐行一致；
 *   · **讲稿 2010 也没把「理中」列成独立方条**，而是并进「加味理中」：
 *     「原先我们是以理中汤为母方，但是理中汤太燥，所以用理中易四君……」
 *   · **同和堂版 p1 确实有「理中汤」成方**，但它在 p42 没有对应行
 *     ⇒ 按 p42 逐行登记的对照表挂不上它 ⇒ 这张成方在依脉用方这条链上查不到。
 *
 * ## 这次改了什么
 *
 * 不自创「理中」方条（讲稿没写 ⇒ 按「未写明留空不臆造」不自创），而是把
 * **讲稿原文明写的母方关系**登记进内容层：
 * `formula-reference.json` 的第 10 行加 `parentDoseId: "th-lizhong"`。
 *
 * ## 这个脚本测什么
 *
 *   ① **照录原表** —— p42 28 行里名为「理中」的行数必须是 0（不许自创）；
 *   ② **只登记有据的那一条** —— 全库 `parentDoseId` 非空的行必须恰好 1 行；
 *   ③ **查表真跑** —— 查「加味理中」出 2 条（主方＋母方），母方带 role='parent'
 *      且名字照录；查「理中」仍是 contains 3 条；查「中焦方（加味理中）」仍是 none；
 *   ④ **服务端正反投影往返** —— `parent_dose_id` 落库再回灌不能丢；
 *   ⑤ **界面计数比对** —— 母方标记、候选过滤、母方块各出现几次。
 *
 * ## 计数比对的纪律
 *
 * 「有没有」改成「**几个**」；同一个词的不同代码写法分别计数。
 *
 * 跑法：node scripts/e2e/lizhong-parent.mjs
 * ⚠️ 依赖 `miniprogram/utils/core` 产物 —— 先跑 `npm run build:core`。
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
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
/* 1. 内容层：照录原表，不自创                                          */
/* ------------------------------------------------------------------ */

const refJson = JSON.parse(readFileSync(join(ROOT, 'src/content/formula-reference.json'), 'utf8'))
const refRows = refJson.rows
const dosesJson = JSON.parse(readFileSync(join(ROOT, 'src/content/doses.json'), 'utf8'))
const refSchema = JSON.parse(
  readFileSync(join(ROOT, 'src/content/schema/formula-reference.schema.json'), 'utf8'),
)

/** ⭐ 钉住「不自创方条」：讲义 p42 原表里名为「理中」的行必须是 0 行 */
const lizhongRows = refRows.filter((r) => r.name === '理中')
checker.check(
  'LZ1 照录原表：讲义 p42 的 28 行里名为「理中」的行数 === 0（不自创方条）',
  lizhongRows.length === 0,
  `实际 ${lizhongRows.length} 行`,
)

checker.check(
  'LZ2 照录原表：p42 行数 === 28，no 是 1..28 连续',
  refRows.length === 28 && refRows.every((r, i) => r.no === i + 1),
  `行数=${refRows.length}`,
)

/** ⭐ 只登记有据的那一条 —— 全库 parentDoseId 非空的行必须恰好 1 行 */
const withParent = refRows.filter((r) => r.parentDoseId)
checker.check(
  'LZ3 只登记有据的那一条：parentDoseId 非空的行数 === 1',
  withParent.length === 1,
  `实际 ${withParent.length} 行：${withParent.map((r) => `${r.no}:${r.name}`).join('、')}`,
)

const p10 = refRows.find((r) => r.no === 10)
checker.check(
  'LZ4 第 10 行是「加味理中」，母方登记为 th-lizhong',
  p10?.name === '加味理中' && p10?.parentDoseId === 'th-lizhong',
  JSON.stringify({ name: p10?.name, parentDoseId: p10?.parentDoseId }),
)

checker.check(
  'LZ5 第 10 行的对照依据里写明了母方＝理中汤',
  typeof p10?.doseBasis === 'string' &&
    p10.doseBasis.includes('母方＝理中汤') &&
    p10.doseBasis.includes('原先我们是以理中汤为母方'),
  String(p10?.doseBasis).slice(0, 80),
)

/** 同和堂版的「理中汤」成方本身：存在、页面是 p1、notes 里带着讲稿原话 */
const lizhongDose = dosesJson.doses.find((d) => d.id === 'th-lizhong')
checker.check(
  'LZ6 同和堂版有「理中汤」成方（党参9 白术18 干姜9 甘草4 黄芪8，p1）',
  lizhongDose?.name === '理中汤' &&
    lizhongDose?.composition === '党参9 白术18 干姜9 甘草4 黄芪8' &&
    lizhongDose?.page === 1,
  JSON.stringify(lizhongDose && { name: lizhongDose.name, page: lizhongDose.page }),
)

checker.check(
  'LZ7 「理中汤」的 notes 记着讲稿原话，并写明 p42 里没有单独的「理中」行',
  Array.isArray(lizhongDose?.notes) &&
    lizhongDose.notes.some((n) => n.includes('原先我们是以理中汤为母方')) &&
    lizhongDose.notes.some((n) => n.includes('没有单独的「理中」行')),
  JSON.stringify(lizhongDose?.notes ?? []).slice(0, 120),
)

/** schema：字段 + 列（含外键指向） */
const refCols = (refSchema['x-tables'] ?? []).find((t) => t.name === 'content_formula_reference')
const parentCol = (refCols?.columns ?? []).find((c) => c.name === 'parent_dose_id')
checker.check(
  'LZ8 schema：$defs.row.properties.parentDoseId 存在',
  typeof refSchema.$defs?.row?.properties?.parentDoseId === 'object',
  JSON.stringify(refSchema.$defs?.row?.properties?.parentDoseId ?? null),
)

checker.check(
  'LZ9 schema：x-tables 里 content_formula_reference 有 parent_dose_id 列（外键 → content_doses.id）',
  parentCol?.type === 'text' &&
    parentCol?.fk?.table === 'content_doses' &&
    parentCol?.fk?.column === 'id' &&
    parentCol?.json === 'rows.items.parentDoseId',
  JSON.stringify(parentCol ?? null),
)

/* ------------------------------------------------------------------ */
/* 2. domain 查表：真跑 core 产物                                      */
/* ------------------------------------------------------------------ */

let dl
let med
try {
  dl = require(join(ROOT, 'miniprogram/utils/core/domain/dose-lookup.js'))
  med = require(join(ROOT, 'miniprogram/utils/core/domain/medication.js'))
} catch (e) {
  console.error('读不到 core 产物 —— 先跑 `npm run build:core`')
  console.error(e.message)
  process.exit(1)
}

/** 查「加味理中」（讲义 p42 的方名）→ 应出主方 ＋ 母方两条 */
const hitJiawei = dl.thDoseView('加味理中')
checker.check(
  'LZ10 查「加味理中」：同和堂版命中 2 条（主方 ＋ 母方）',
  hitJiawei.matched === 'alias' && hitJiawei.entries.length === 2,
  `matched=${hitJiawei.matched} 条数=${hitJiawei.entries.length}`,
)

const parents = hitJiawei.entries.filter((e) => e.role === 'parent')
checker.check(
  'LZ11 母方恰好 1 条，名字照录「理中汤」，组成照录不改',
  parents.length === 1 &&
    parents[0].name === '理中汤' &&
    parents[0].composition === '党参9 白术18 干姜9 甘草4 黄芪8',
  JSON.stringify(parents.map((e) => ({ name: e.name, role: e.role }))),
)

/** 这条**不依赖 role 标记** —— 标记没了，依据本身还在（两件事分开测） */
const parentBasis = hitJiawei.entries.filter(
  (e) => typeof e.basis === 'string' && e.basis.startsWith('母方 · 讲义 p42 第 10 行'),
)
checker.check(
  'LZ12 母方的对照依据以「母方 · 讲义 p42 第 10 行」开头',
  parentBasis.length === 1,
  `实际 ${parentBasis.length} 条`,
)

/** ⭐ 母方只在「讲义 p42 方名」这条有据通路上出来 —— 泛化反查不许做 */
const hitLizhong = dl.thDoseView('理中')
checker.check(
  'LZ13 查「理中」：仍是 contains 3 条（理中汤／加味理中汤／理中术姜芪）',
  hitLizhong.matched === 'contains' && hitLizhong.entries.length === 3,
  `matched=${hitLizhong.matched} 条数=${hitLizhong.entries.length}`,
)

checker.check(
  'LZ14 查「理中」时没有混进母方标记（母方只随有据行出来）',
  hitLizhong.entries.filter((e) => e.role === 'parent').length === 0,
  JSON.stringify(hitLizhong.entries.map((e) => ({ name: e.name, role: e.role }))),
)

/** ⭐ 纪律：中焦方（加味理中）不是同一张方，仍必须是「未载」 */
const hitZhongjiao = dl.thDoseView('中焦方（加味理中）')
checker.check(
  'LZ15 查「中焦方（加味理中）」：仍是 none 0 条（不为了让结果好看而放宽）',
  hitZhongjiao.matched === 'none' && hitZhongjiao.entries.length === 0,
  `matched=${hitZhongjiao.matched} 条数=${hitZhongjiao.entries.length}`,
)

/** formulaDoseView：第 10 行带出母方，第 11 行（没登记）不带 */
const view10 = med.formulaDoseView(p10)
checker.check(
  'LZ16 formulaDoseView（第 10 行）：parentDose ＝「理中汤」（p1）',
  view10.parentDose?.name === '理中汤' && view10.parentDose?.page === 1,
  JSON.stringify(view10.parentDose && { name: view10.parentDose.name, page: view10.parentDose.page }),
)

const p11 = refRows.find((r) => r.no === 11)
const view11 = med.formulaDoseView(p11)
checker.check(
  'LZ17 formulaDoseView（第 11 行「理中术姜芪」）：没有登记母方 ⇒ parentDose 是 undefined',
  view11.parentDose === undefined && view11.dose?.name === '理中术姜芪',
  JSON.stringify({ parentDose: view11.parentDose ?? null, dose: view11.dose?.name ?? null }),
)

/* ------------------------------------------------------------------ */
/* 3. 服务端正反投影：真跑（落库 → 回灌不能丢）                          */
/* ------------------------------------------------------------------ */

const cs = await import(pathToFileURL(join(ROOT, 'server/content-schema.mjs')).href)
const content = cs.loadContent()
const rows = cs.buildRows(content)

const refTable = rows.content_formula_reference ?? []
const row10 = refTable.find((r) => r.no === 10)
checker.check(
  'LZ18 正投影：落库行第 10 行带 parent_dose_id ＝ th-lizhong',
  row10?.parent_dose_id === 'th-lizhong',
  JSON.stringify({ no: row10?.no, parent_dose_id: row10?.parent_dose_id }),
)

const parentRows = refTable.filter((r) => r.parent_dose_id)
checker.check(
  'LZ19 正投影：整张表里带 parent_dose_id 的行数 === 1',
  parentRows.length === 1,
  `实际 ${parentRows.length} 行`,
)

const back = cs.buildContentFromRows(rows)
const back10 = back['formula-reference'].rows.find((r) => r.no === 10)
checker.check(
  'LZ20 反投影：回灌后 parentDoseId 还在（落库 → 回灌不丢）',
  back10?.parentDoseId === 'th-lizhong',
  JSON.stringify({ no: back10?.no, parentDoseId: back10?.parentDoseId }),
)

/* ------------------------------------------------------------------ */
/* 4. 界面层：计数比对                                                  */
/* ------------------------------------------------------------------ */

const doseLinesSrc = stripComments(readFileSync(join(ROOT, 'src/components/DoseLines.tsx'), 'utf8'))
const medPanelSrc = stripComments(readFileSync(join(ROOT, 'src/components/MedicationPanel.tsx'), 'utf8'))
const cssSrc = readFileSync(join(ROOT, 'src/index.css'), 'utf8')

checker.check(
  'LZ21 母方标记在 DoseLines 里只渲染一处（计数比对）',
  count(doseLinesSrc, 'pr-dose-role') === 1,
  `实际 ${count(doseLinesSrc, 'pr-dose-role')} 处`,
)

checker.check(
  'LZ22 母方不算「同名不同号」候选 —— 过滤只做一次（计数比对）',
  count(doseLinesSrc, "e.role !== 'parent'") === 1,
  `实际 ${count(doseLinesSrc, "e.role !== 'parent'")} 处`,
)

checker.check(
  'LZ23 母方条目一定要露出自己的方名（role===\'parent\' 判据出现在「露名」和「打标记」两处）',
  count(doseLinesSrc, "e.role === 'parent'") === 2,
  `实际 ${count(doseLinesSrc, "e.role === 'parent'")} 处`,
)

checker.check(
  'LZ24 MedicationPanel 里母方块只有一处（计数比对）',
  count(medPanelSrc, '母方 · 同和堂版 · 克') === 1,
  `实际 ${count(medPanelSrc, '母方 · 同和堂版 · 克')} 处`,
)

checker.check(
  'LZ25 index.css 里母方标记样式只有一处（计数比对）',
  count(cssSrc, '.pr-dose-role') === 1,
  `实际 ${count(cssSrc, '.pr-dose-role')} 处`,
)

checker.check(
  'LZ26 index.css 里母方块样式只有一处（计数比对）',
  count(cssSrc, '.pr-dose-block.is-parent') === 1,
  `实际 ${count(cssSrc, '.pr-dose-block.is-parent')} 处`,
)

/* ------------------------------------------------------------------ */

process.exit(checker.summary() ? 0 : 1)
