#!/usr/bin/env node
/**
 * 共享包冒烟 —— 验证 `npm run build:core` 的产物能被小程序端正常加载与使用
 *
 * 检查项：
 *   1. CommonJS 产物能被 require（微信运行时用的是同一套 module.exports 语义）
 *   2. 知识库条数与网站端一致（讲稿 30 方 / 同和堂版 49 成方 / 17 科中 / 14 符号）
 *   3. **产物里没有 `Object.fromEntries`** —— 那是 ES2019 内建，老机型 JSCore 没有会白屏
 *   4. 判读规则能产出预期命中（与网站同一份 rules）
 *   5. 记录表版式计算与网站一致（9 行 × 1 次记录 → 列宽/表高）
 *   6. Markdown 导出含关键段落
 *
 * 用法：先 `npm run build:core`，再 `node scripts/e2e/core-smoke.mjs`
 */
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const coreDir = join(root, 'miniprogram/utils/core')
const require = createRequire(import.meta.url)

let pass = 0
let fail = 0
function ok(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

console.log('\n共享包冒烟（miniprogram/utils/core）\n')

/* ---- 1. 产物存在且能被 require ---- */
let core
try {
  core = {
    rules: require(join(coreDir, 'domain/rules.js')),
    symbols: require(join(coreDir, 'domain/symbols.js')),
    drugs: require(join(coreDir, 'domain/drugs.js')),
    formulaTable: require(join(coreDir, 'domain/formula-table.js')),
    layout: require(join(coreDir, 'domain/layout.js')),
    types: require(join(coreDir, 'domain/types.js')),
    painter: require(join(coreDir, 'export/table-painter.js')),
    text: require(join(coreDir, 'export/text.js')),
    toRecord: require(join(coreDir, 'domain/to-record.js')),
  }
  ok('CommonJS 产物可被 require', true)
} catch (e) {
  ok('CommonJS 产物可被 require', false, e.message)
  console.log('\n产物缺失或不可加载 —— 先跑 `npm run build:core`。\n')
  process.exit(1)
}

/* ---- 2. 知识库条数 ---- */
ok('讲稿方剂 30 条', core.drugs.DRUGS.length === 30, `实际 ${core.drugs.DRUGS.length}`)
ok('方剂索引与方剂表等长', Object.keys(core.drugs.DRUG_BY_ID).length === 30)
ok('同和堂版成方 49 条', core.formulaTable.FORMULA_DOSES.length === 49, `实际 ${core.formulaTable.FORMULA_DOSES.length}`)
ok('科中 17 条', core.formulaTable.FORMULA_SCIENCES.length === 17, `实际 ${core.formulaTable.FORMULA_SCIENCES.length}`)
ok('讲义固定符号 14 个', core.symbols.SYMBOLS.length === 14, `实际 ${core.symbols.SYMBOLS.length}`)
ok('符号索引 14 条', Object.keys(core.symbols.SYMBOL_BY_CODE).length === 14)

/* ---- 2b. 自定义符号的校验：硬性规定「符号不能为空」----
 *
 * 这条规矩有三层（前端校验 / 路由 400 / 存储层返回 null），这里盯第一层。
 * 为什么要逐条列不可见字符：它们**肉眼与正常符号完全一样**，
 * 只判 `trim() === ''` 会放过一个「格子里什么都没显示、却录进了一个符号」的怪状态。
 */
const vs = core.symbols.validateCustomSymbol
ok('符号不能为空（空串被拦）', !!vs('', '涩'))
ok('只填空格被拦', !!vs('   ', '涩'))
ok('零宽空格被拦', !!vs('\u200b', '涩'))
ok('软连字符被拦（能造出与 S 一模一样的影子符号）', !!vs('\u00ad', '涩'))
ok('盲文空白被拦（有字形，但字形是空白）', !!vs('\u2800', '涩'))
ok('名称不能为空', !!vs('S', ''))
ok('名称里只有零宽字符被拦', !!vs('S', '\u200b'))
ok('不能占用讲义固定代码', !!vs('++', '有力'))
ok('重复代码被拦', !!vs('S', '涩', [{ code: 'S', name: '涩' }]))
ok('「.」与「..」不能当代码（URL 归一化后永远删不掉）', !!vs('.', '点') && !!vs('..', '双减'))
ok('代码超过 3 字符被拦', !!vs('ABCD', '太长'))
ok('代码里的空格被拦', !!vs('S S', '空格'))
ok('正常符号放行', vs('S', '涩') === null && vs('涩', '涩') === null)
ok('名称里的全角空格放行（中文输入法打出来就是它，不该按「看不见」拒）', vs('S', '涩　脉') === null)
ok('规则 21 条', core.rules.RULES.length === 21, `实际 ${core.rules.RULES.length}`)

/* ---- 3. 产物里不得出现 ES2019 内建 ---- */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.js')) out.push(p)
  }
  return out
}
const files = walk(coreDir)
// 只查**调用**（带左括号）—— 注释里提到这个名字不算
const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('Object.fromEntries('))
ok('产物中无 Object.fromEntries 调用（ES2019，老机型会白屏）', offenders.length === 0, offenders.join(', '))
ok('toRecord 已导出', typeof core.toRecord.toRecord === 'function')
ok(
  'toRecord 行为正确',
  JSON.stringify(core.toRecord.toRecord([['a', 1], ['b', 2]])) === '{"a":1,"b":2}',
)

/* ---- 4. 判读规则产出预期命中 ---- */
const { cellKey } = core.types
const values = {
  [cellKey('L', '寸', '浮')]: ['↑'],
  [cellKey('L', '关', '浮')]: ['++'],
  [cellKey('L', '尺', '沉')]: ['-'],
}
const ctx = {
  layout: 'nine',
  get: (hand, organ, depth) => values[cellKey(hand, organ, depth)] ?? [],
  depths: (organ) => core.layout.depthsOf('nine', organ),
}
const hits = core.rules.evaluateRules(ctx)
const hitIds = hits.map((h) => h.id)
ok('左寸顶手 → 命中「左寸顶手 → 头痛」', hitIds.includes('zuocun-ding'), hitIds.join(','))
ok('左关浮大 → 命中「左关浮大 → 易怒、易烦」', hitIds.includes('zuoguan-da'), hitIds.join(','))
ok('寸关浮大 + 尺弱 → 命中「上盛下虚」', hitIds.includes('shangshengxiashu'), hitIds.join(','))
const order = { high: 0, warn: 1, info: 2 }
ok(
  '命中按 severity 排序（high → warn → info）',
  hits.every((h, i) => i === 0 || order[hits[i - 1].severity] <= order[h.severity]),
  hits.map((h) => h.severity).join(','),
)

/* ---- 5. 版式计算 ---- */
const layout = core.painter.planTable(
  { name: '测试', layout: 'nine', sessions: [{ id: 's1', label: '261102', values }] },
  [],
)
ok('表宽 = 部位54 + 取法54 + 2×66 = 240', layout.tableW === 240, `实际 ${layout.tableW}`)
ok('表高 = 表头84 + 9×40 = 444', layout.tableH === 444, `实际 ${layout.tableH}`)
ok('正文行数 9', layout.rowCount === 9)
ok('数据列数 2（左＋右）', layout.dataCols === 2)
const withDia = core.painter.withDiagram(layout, { w: 900, h: 1200 })
ok('拼图示后画布变宽', withDia.canvasW === 900 && withDia.tableDx === 330, `canvasW=${withDia.canvasW} dx=${withDia.tableDx}`)
ok('图示留白 DIAGRAM_GAP = 24', core.painter.DIAGRAM_GAP === 24)

/* ---- 6. Markdown 导出 ---- */
const md = core.text.toMarkdown(
  { name: '测试', layout: 'nine', sessions: [{ id: 's1', label: '261102', values }] },
  undefined,
  [],
  's1',
)
ok('Markdown 含标题段', md.includes('### 脉象记录表 · 测试'))
ok('Markdown 含寸关尺图示段', md.includes('#### 寸关尺图示（文字版）'))
ok('Markdown 含讲义 p42 对照表', md.includes('讲义 2026-10·p42'))
ok('Markdown 含方剂备查', md.includes('方剂备查'))
ok('Markdown 含判读提示', md.includes('#### 判读提示'))

console.log(`\n共 ${pass + fail} 项，通过 ${pass}，失败 ${fail}\n`)
process.exit(fail === 0 ? 0 : 1)
