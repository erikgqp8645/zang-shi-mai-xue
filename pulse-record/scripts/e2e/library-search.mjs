/**
 * 端到端测试：用方知识库的检索规则
 *
 * 用户的原话是「可以搜索方剂名称、脉象，比如搜索五味异功散、或右寸」——
 * 所以测的是**输入这两个词真能搜到东西**，而不是「函数返回了数组」。
 *
 *   ① 格键要变成中文（`R|寸|浮` → 「右寸浮」），否则搜「右寸」永远是 0；
 *   ② 「五味异功散」在讲义 p42 表里（本区块之外），必须能搜到并给出原表行；
 *   ③ 多词是 AND、不是 OR；
 *   ④ 空查询返回全集（界面靠这一点让「不搜」和「搜」走同一套过滤）；
 *   ⑤ 关系型图（cells 空、relations 有）也要能被搜到；
 *   ⑥ 大小写不敏感（方名 id 里有拉丁字母）。
 *
 * 跑法：先 `npm run build:core`，再 `node scripts/e2e/library-search.mjs`
 */

import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const core = join(root, 'miniprogram/utils/core')
const require = createRequire(import.meta.url)

const { FORMULA_RULES } = require(join(core, 'domain/formulas.js'))
const { DRUGS } = require(join(core, 'domain/drugs.js'))
const { FORMULA_REFERENCE } = require(join(core, 'domain/medication.js'))
const S = require(join(core, 'domain/library-search.js'))

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

/** 基线的脉象图（这里不测覆盖层，覆盖层的合并已由 formula-patterns.mjs 管） */
const patternsOf = (rule) =>
  rule.patterns && rule.patterns.length > 0 ? rule.patterns : rule.pattern ? [rule.pattern] : []

const ruleIndex = S.buildRuleIndex(FORMULA_RULES, patternsOf)
const drugIndex = S.buildDrugIndex(DRUGS)
const refIndex = S.buildRefIndex(FORMULA_REFERENCE)

const ids = (entries) => entries.map((e) => e.item.id ?? e.item.no)
const search = (query) => ({
  rules: S.searchEntries(ruleIndex, query).map((e) => e.item),
  drugs: S.searchEntries(drugIndex, query).map((e) => e.item),
  refs: S.searchEntries(refIndex, query).map((e) => e.item),
})

console.log('\n用方知识库 · 检索\n')

/* ---- 1. 格键 → 中文 ---- */
ok('格键 R|寸|浮 → 右寸浮', S.cellLabel('R|寸|浮') === '右寸浮', S.cellLabel('R|寸|浮'))
ok('格键 L|关|沉 → 左关沉', S.cellLabel('L|关|沉') === '左关沉', S.cellLabel('L|关|沉'))
ok('不是格键就原样返回', S.cellLabel('随便写的') === '随便写的', S.cellLabel('随便写的'))
ok('手别不认识时不硬拼', S.cellLabel('X|寸|浮') === 'X|寸|浮', S.cellLabel('X|寸|浮'))

/* ---- 2. 拆词 ---- */
ok('空串 → 无词', S.splitQuery('   ').length === 0)
ok('全角空格也当分隔符', JSON.stringify(S.splitQuery('右寸\u3000浮大')) === '["右寸","浮大"]', JSON.stringify(S.splitQuery('右寸\u3000浮大')))
ok('连续空格不产生空词', S.splitQuery('右寸   浮大').length === 2)
ok('转小写', S.splitQuery('FX-DL2')[0] === 'fx-dl2')

/* ---- 3. 用户原话的两个例子 ---- */
const wuwei = search('五味异功散')
ok('搜「五味异功散」→ 讲义 p42 表 1 条', wuwei.refs.length === 1, `实际 ${wuwei.refs.length} 条`)
ok(
  '  ↳ 命中的确实是五味异功散，且带原表脉象',
  wuwei.refs[0]?.name === '五味异功散' && /关/.test(wuwei.refs[0]?.indication ?? ''),
  JSON.stringify(wuwei.refs[0] ?? null),
)

const youcun = search('右寸')
ok('搜「右寸」→ 有命中', youcun.rules.length + youcun.drugs.length > 0, `规则 ${youcun.rules.length} / 方剂 ${youcun.drugs.length}`)
ok(
  '  ↳ 命中的规则里，检索文本确实含「右寸」',
  youcun.rules.every((r) =>
    S.ruleSearchText(r, patternsOf(r)).includes('右寸'),
  ),
)
ok(
  '  ↳ 没命中「只有左寸」的条目',
  !youcun.rules.some(
    (r) => S.ruleSearchText(r, patternsOf(r)).includes('左寸') && !S.ruleSearchText(r, patternsOf(r)).includes('右寸'),
  ),
)

/* ---- 4. 多词是 AND ---- */
const both = search('右寸 浮大')
const bothIds = new Set([...ids(S.searchEntries(ruleIndex, '右寸 浮大')), ...ids(S.searchEntries(drugIndex, '右寸 浮大'))])
const youcunIds = new Set([...ids(S.searchEntries(ruleIndex, '右寸')), ...ids(S.searchEntries(drugIndex, '右寸'))])
ok('「右寸 浮大」是「右寸」的子集（AND 不是 OR）', [...bothIds].every((id) => youcunIds.has(id)), `多词 ${bothIds.size} / 单词 ${youcunIds.size}`)
ok('多词确实收窄了结果', bothIds.size < youcunIds.size, `${bothIds.size} vs ${youcunIds.size}`)
ok('多词结果的每一条都同时含两个词', [...both.rules, ...both.drugs].every((item) => {
  const text = item.formulas ? S.ruleSearchText(item, patternsOf(item)) : S.drugSearchText(item)
  return text.includes('右寸') && text.includes('浮大')
}))

/* ---- 5. 空查询 = 全集 ---- */
ok('空查询返回全部规则', S.searchEntries(ruleIndex, '').length === FORMULA_RULES.length)
ok('空查询返回全部方剂', S.searchEntries(drugIndex, '').length === DRUGS.length)
ok('空查询返回全部 p42 行', S.searchEntries(refIndex, '').length === FORMULA_REFERENCE.length)

/* ---- 6. 关系型图也能搜到 ---- */
const rel = search('尺脉不平衡')
ok('搜「尺脉不平衡」→ 有命中（关系型要求也算）', rel.rules.length > 0, `规则 ${rel.rules.length}`)

/* ---- 7. 搜不到就是搜不到 ---- */
const none = search('不存在的方名xyz')
ok('搜不存在的词 → 三类全 0', none.rules.length === 0 && none.drugs.length === 0 && none.refs.length === 0)

/* ---- 8. 大小写不敏感 ---- */
ok('matchQuery 大小写不敏感', S.matchQuery('fx-dl2-zuoguan', S.splitQuery('FX-DL2')) === true)

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
process.exit(fail === 0 ? 0 : 1)
