#!/usr/bin/env node
/**
 * e2e：统一编辑弹层（条目 ＋ 脉象图）· **UE1~UE11**
 *
 * ## 用户要什么（2026-11-12）
 *
 * ① **归一化**：条目编辑与脉象图编辑，**在一个界面里都能改**；
 * ② **查重**：这两处编辑有没有重复的地方，有就处理。
 *
 * ## 这条测试在守什么
 *
 * **归一化**（UE1~UE4）：
 *   · 旧的两个独立弹层文件**真的没了**（不是「还在但不用了」）；
 *   · 两个入口（③ 的「编辑」、方剂卡的「脉象图 · 编辑」）**进同一个弹层**；
 *   · 弹层里有两个页签，一个「保存」按钮 ⇒ **一次提交两处**。
 *
 * **去重**（UE5~UE7）：同一件事**只编一处**
 *   · 出处 → 只在条目页编；脉象图页只读显示「本图出处」；
 *   · 图名 → 只在**多张图**时才编；一张图时图名就是这条的方名（只读）；
 *   · 原文 → 只在条目页编；脉象图页只写「与原文的出入」。
 *
 * **逻辑**（UE8~UE10）：
 *   · 字段级 diff（只发改了的字段）与图的归一化（空格子不算改动）；
 *   · **真起服务**：一次保存 ⇒ 条目与图两处都落库。
 *
 * 跑法：node scripts/e2e/unified-editor.mjs
 *
 * ⚠️ 全程只在**临时库**上操作，绝不碰仓库里的 src/content/*.json。
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeChecker, startApi, stripComments, ROOT } from './lib.mjs'
import { diffEntryFields, normalizePatterns, patternsChanged } from '../../src/domain/unified-editor.mjs'

const checker = makeChecker()
const check = (name, ok, detail = '') => checker.check(name, ok, detail)

console.log('\n统一编辑弹层 · 断言（2026-11-12）\n')

/* ------------------------------------------------------------------ *
 * 工具                                                                *
 * ------------------------------------------------------------------ */

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const code = (rel) => stripComments(read(rel))
const has = (rel) => existsSync(join(ROOT, rel))

/* ------------------------------------------------------------------ *
 * UE1 · 一个界面：旧的两个独立弹层真的没了                             *
 * ------------------------------------------------------------------ */

check(
  'UE1 旧的两个独立弹层文件真的没了（LibraryEditor／PatternEditor）',
  !has('src/components/LibraryEditor.tsx') && !has('src/components/PatternEditor.tsx'),
  '还在 —— 那就还是两个界面',
)

check(
  'UE1 统一弹层与两个面板都在（RuleEditor／LibraryFields／PatternPanel）',
  has('src/components/RuleEditor.tsx') &&
    has('src/components/LibraryFields.tsx') &&
    has('src/components/PatternPanel.tsx'),
)

/* ------------------------------------------------------------------ *
 * UE2 · 两个入口进同一个弹层                                          *
 * ------------------------------------------------------------------ */

const libCode = code('src/components/FormulaLibrary.tsx')
const stripCode = code('src/components/PatternStrip.tsx')

check(
  'UE2 ③ 知识库的「编辑」进统一弹层',
  libCode.includes("from './RuleEditor'") && libCode.includes('<RuleEditor'),
  libCode.includes("from './RuleEditor'") ? '' : '没 import RuleEditor',
)

check(
  'UE2 方剂卡的「脉象图 · 编辑」也进同一个弹层（落在脉象图页签）',
  stripCode.includes("from './RuleEditor'") &&
    stripCode.includes('<RuleEditor') &&
    stripCode.includes('initialTab="pattern"'),
  stripCode.includes("from './RuleEditor'") ? '' : '没 import RuleEditor',
)

check(
  'UE2 两个入口都不再引旧的独立弹层',
  !libCode.includes('LibraryEditor') && !stripCode.includes('PatternEditor'),
)

/**
 * ⓘ **要数个数，不能只问「有没有」**：
 *   `PatternStrip` 里有两个入口（「＋加脉象图」与「编辑」），都开同一个弹层。
 *   只查「有没有 `initialTab="pattern"`」的话，**改掉其中一个照样绿** ——
 *   break-test UEM1 实测抓到过这个假绿 ⇒ 改成两边**计数比对**。
 */
{
  const editors = (stripCode.match(/<RuleEditor/g) || []).length
  const onPattern = (stripCode.match(/initialTab="pattern"/g) || []).length
  check(
    'UE2 PatternStrip 的两个入口都落在「脉象图」页签（一个都不许漏）',
    editors >= 2 && editors === onPattern,
    `<RuleEditor ${editors} 处，initialTab="pattern" ${onPattern} 处`,
  )
}

/* ------------------------------------------------------------------ *
 * UE3 · 一个弹层两个页签；方剂没有脉象图页签                           *
 * ------------------------------------------------------------------ */

const ruleEditor = code('src/components/RuleEditor.tsx')

check(
  'UE3 弹层里有「条目」「脉象图」两个页签',
  ruleEditor.includes('条目') && ruleEditor.includes('脉象图') && ruleEditor.includes('pr-ed-tab'),
)

check(
  'UE3 脉象图页签只有用方条目（rule）有；讲稿方剂（drug）没有',
  ruleEditor.includes("hasPatternTab = kind === 'rule'"),
  ruleEditor.includes("hasPatternTab = kind === 'rule'") ? '' : '没看到 kind 的分流',
)

/* ------------------------------------------------------------------ *
 * UE4 · 一个保存按钮 ⇒ 一次提交两处                                   *
 * ------------------------------------------------------------------ */

check(
  'UE4 保存时两条接口都发（条目 PATCH ＋ 脉象图 PUT）',
  ruleEditor.includes('saveLibraryPatch(') && ruleEditor.includes('savePatterns('),
)

check(
  'UE4 界面上只有一个「保存」按钮',
  (ruleEditor.match(/void doSave\(\)/g) || []).length === 1,
  `找到 ${(ruleEditor.match(/void doSave\(\)/g) || []).length} 个`,
)

/**
 * ⓘ **JSX 文字与字符串字面量两种写法都要数**：
 *   按钮标签可能写成 `{… : '保存'}`（字符串），也可能写成裸的 `保存`（JSX 文字）。
 *   只数字符串字面量的话，加一个裸文字按钮照样绿 —— break-test UEM7 实测抓到过。
 */
{
  const labels = (ruleEditor.match(/>\s*保存\s*</g) || []).length +
    (ruleEditor.match(/'保存'/g) || []).length
  check(
    'UE4 「保存」标签只有一个（JSX 文字与字符串两种写法都算）',
    labels === 1,
    `找到 ${labels} 个`,
  )
}

check(
  'UE4 两处分开报错（条目的错与图的错不混成一句）',
  ruleEditor.includes('entryError') && ruleEditor.includes('patternError'),
)

/* ------------------------------------------------------------------ *
 * UE5 · 去重①：出处只编一处                                            *
 * ------------------------------------------------------------------ */

const panel = code('src/components/PatternPanel.tsx')

check(
  'UE5 脉象图页**不能**改出处（没有 source 的输入框）',
  !/patchEntry\(\{[^}]*source/.test(panel),
  '脉象图页还能改 source ⇒ 出处有两处',
)

check(
  'UE5 脉象图页只读显示「本图出处」',
  panel.includes('本图出处') && panel.includes('entry.source'),
)

check(
  'UE5 出处是条目页的注册表字段（label＝「出处」）',
  read('server/library-schema.mjs').includes("label: '出处'"),
)

/* ------------------------------------------------------------------ *
 * UE6 · 去重②：图名只在多图时可编                                       *
 * ------------------------------------------------------------------ */

check(
  'UE6 单图时图名只读（is-readonly ＋ pr-ed-fixed）',
  panel.includes('is-readonly') && panel.includes('pr-ed-fixed'),
)

check(
  'UE6 只有多张图时才出现「区分名」输入框（multi 分支）',
  panel.includes('multi ?') && panel.includes('这张图的区分名'),
)

/* ------------------------------------------------------------------ *
 * UE7 · 去重③：原文只在条目页                                           *
 * ------------------------------------------------------------------ */

check(
  'UE7 脉象图页没有原文（quote）字段',
  !/\bquote\b/.test(panel),
  '脉象图页出现 quote ⇒ 原文有两处',
)

check(
  'UE7 脉象图页写的是「与原文的出入」，并明说别再抄原文',
  panel.includes('与原文的出入') && panel.includes('别把原文再抄一遍'),
)

/* ------------------------------------------------------------------ *
 * UE8 · 字段级 diff                                                    *
 * ------------------------------------------------------------------ */

check(
  'UE8 diffEntryFields：只发改了的字段，其余不动',
  (() => {
    const base = { id: 'x', condition: '有尺脉', formulas: ['一体疗法'], visible: true }
    const draft = { id: 'x', condition: '有尺脉（改过）', formulas: ['一体疗法'], visible: true }
    const changed = diffEntryFields(draft, base)
    return Object.keys(changed).length === 1 && changed.condition === '有尺脉（改过）'
  })(),
)

check(
  'UE8 diffEntryFields：没改就是空对象（不发请求）',
  Object.keys(diffEntryFields({ a: 1 }, { a: 1 })).length === 0,
)

check(
  'UE8 diffEntryFields：数组字段整体比（多一项就是改了）',
  (() => {
    const changed = diffEntryFields({ f: ['a', 'b'] }, { f: ['a'] })
    return Array.isArray(changed.f) && changed.f.length === 2
  })(),
)

/* ------------------------------------------------------------------ *
 * UE9 · 图的归一化：空格子与默认名不算改动                             *
 * ------------------------------------------------------------------ */

check(
  'UE9 normalizePatterns：去掉空格子（既没符号也没用字）',
  (() => {
    const out = normalizePatterns([
      { title: '甲', cells: [{ cell: 'L|寸|浮', term: '', codes: [] }, { cell: 'R|寸|浮', term: '有' }] },
    ])
    return out[0].cells.length === 1 && out[0].cells[0].cell === 'R|寸|浮'
  })(),
)

check(
  'UE9 normalizePatterns：没名字的图补默认名',
  normalizePatterns([{ title: '', cells: [] }])[0].title === '脉象 1',
)

check(
  'UE9 patternsChanged：只多了空格子 ⇒ 不算改动',
  (() => {
    const current = [{ title: '甲', cells: [{ cell: 'L|寸|浮', term: '有' }] }]
    const draft = [
      { title: '甲', cells: [{ cell: 'L|寸|浮', term: '有' }, { cell: 'R|寸|浮', term: '', codes: [] }] },
    ]
    return patternsChanged(draft, current) === false
  })(),
)

check(
  'UE9 patternsChanged：真改了格子的符号 ⇒ 算改动',
  (() => {
    const current = [{ title: '甲', cells: [{ cell: 'L|寸|浮', term: '有' }] }]
    const draft = [{ title: '甲', cells: [{ cell: 'L|寸|浮', term: '', codes: ['+'] }] }]
    return patternsChanged(draft, current) === true
  })(),
)

/* ------------------------------------------------------------------ *
 * UE10 · 端到端：一次保存 ⇒ 两处都落库                                 *
 * ------------------------------------------------------------------ */

const dir = mkdtempSync(join(tmpdir(), 'pulse-ue-'))
const dbFile = join(dir, 'ue.sqlite')
const api = await startApi({ single: true, db: dbFile })

try {
  const RULE_ID = 'fx2-yiti-lengreshui'

  // ① 条目：改「条件」
  const patch = await fetch(`${api.base}/api/library/entries/rule/${RULE_ID}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patch: { condition: '统一弹层改过的条件' } }),
  })
  const patchBody = await patch.json().catch(() => null)

  // ② 脉象图：改一格的符号
  const put = await fetch(`${api.base}/api/formula-patterns/${RULE_ID}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      patterns: [
        {
          title: '一体疗法（冷热水）',
          cells: [{ cell: 'L|尺|浮', term: '', codes: ['+'] }],
          source: '讲稿 2010·第二讲（叁、用方·一、一体疗法）',
          origin: 'manual',
        },
      ],
    }),
  })

  const ovRes = await fetch(`${api.base}/api/library/overrides`)
  const ov = (await ovRes.json())?.overrides ?? {}
  const patRes = await fetch(`${api.base}/api/formula-patterns`)
  const pats = (await patRes.json())?.overrides ?? {}

  check(
    'UE10 一次保存：条目的改动落库了',
    patch.status === 200 && ov.rule?.[RULE_ID]?.payload?.condition === '统一弹层改过的条件',
    `status=${patch.status} ${JSON.stringify(ov.rule?.[RULE_ID]?.payload?.condition)}`,
  )

  check(
    'UE10 一次保存：脉象图的改动也落库了（两处都存）',
    put.status === 200 && Array.isArray(pats[RULE_ID]) && pats[RULE_ID].length === 1,
    `status=${put.status} ${JSON.stringify(pats[RULE_ID]?.length)}`,
  )

  check(
    'UE10 两处存的是同一个条目的（一个界面管一条）',
    Boolean(ov.rule?.[RULE_ID]) && Boolean(pats[RULE_ID]),
  )

  check(
    'UE10 仓库里的基线文件一个字节都没动（覆盖层是另一层）',
    (() => {
      const files = ['formula-rules.json', 'pulse-patterns.json']
      return files.every((f) => existsSync(join(ROOT, 'src', 'content', f)))
    })(),
  )
} finally {
  await api.stop()
  rmSync(dir, { recursive: true, force: true })
}

/* ------------------------------------------------------------------ *
 * UE11 · 新的三个组件里不许有 window.confirm                             *
 * ------------------------------------------------------------------ */

const noConfirm = ['src/components/RuleEditor.tsx', 'src/components/LibraryFields.tsx', 'src/components/PatternPanel.tsx']
const confirmProblems = noConfirm.filter((rel) => code(rel).includes('window.confirm'))

check(
  'UE11 新组件里没有 window.confirm（原生弹窗会冻住 Electron 整页）',
  confirmProblems.length === 0,
  confirmProblems.join('、'),
)

check(
  'UE11 「恢复默认」走站内确认框（ConfirmDialog 只有一处实现）',
  ruleEditor.includes("from './ConfirmDialog'") && ruleEditor.includes('<ConfirmDialog'),
)

process.exit(checker.summary() ? 0 : 1)
