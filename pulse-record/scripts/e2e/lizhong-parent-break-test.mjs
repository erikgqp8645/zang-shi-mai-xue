#!/usr/bin/env node
/**
 * break-test：证明「理中母方」那几条断言（LZ1~LZ26）**不是恒绿**
 *
 * ## 背景
 *
 * 2026-11-12：用户问「这里没有理中，请处理」。查下来是三条资料线各自的
 * 客观状态：讲义 p42 原表 28 行里没有名为「理中」的行；讲稿 2010 把理中汤
 * 并进了「加味理中」（母方关系）；同和堂版 p1 有「理中汤」成方但挂不上 p42 行。
 *
 * 这次的改法：把**讲稿原文明写的母方关系**登记进内容层
 * （`formula-reference.json` 第 10 行加 `parentDoseId: "th-lizhong"`），
 * 沿内容层 → 服务端投影 → domain → 界面一路打通。
 *
 * 做完之后最怕的是：断言写成「查文件在不在」「查有没有某个字」这种**恒绿**检查，
 * 看着 26 项全绿，其实改坏了也抓不到。
 *
 * ## 这个脚本干什么
 *
 * 逐个把仓库**故意写坏**，跑一遍 `lizhong-parent.mjs`，验证：
 *   · 该红的真的红了，而且**红的原因正是那条断言在测的那件事**；
 *   · 不该红的仍然绿（否则就是恒红／恒绿的摆设）。
 *
 * ## ⚠️ 改 domain / 改内容 JSON 的那几条要重编译 core
 *
 * `src/domain/*.ts` **会被编译进 `miniprogram/utils/core/`**，
 * 而 `src/domain/medication.ts` / `formula-table.ts` 又 **import 了内容 JSON**
 * （`../content/formula-reference.json`、`../content/doses.json`）
 * ⇒ **内容 JSON 也是编译期嵌进产物的**。
 * 产物又不在版本库里 —— 改坏了不重编译，后面每一轮都在测旧代码且**不报错**。
 * 所以凡是动了 domain 或内容 JSON 的 mutation：改坏后编译一次、还原后再编译一次。
 *
 * 跑法：node scripts/e2e/lizhong-parent-break-test.mjs
 *
 * ⚠️ 无论怎么退出，被改的文件都要还原（**逐字节核对**）。
 * ⚠️ **别用会提前掐断管道的命令跑它**（例如 `… | Select-Object -First N`）——
 *    进程被掐掉时 `finally` 来不及执行，文件会**留在写坏的状态**。
 *    要看输出就重定向到文件再看。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const E2E = join(ROOT, 'scripts', 'e2e', 'lizhong-parent.mjs')

/* ------------------------------ 断言 ------------------------------ */

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
  return cond
}

/* --------------------------- 改文件的小工具 --------------------------- */

/**
 * 在一个文件里替换若干段文字。
 *
 * 先把 CRLF 归一成 LF 再替换 —— 这样无论工作区是 CRLF 还是 LF，
 * 替换片段都能对上；写回时再把原来的行尾还原。
 *
 * @returns {string|null} 替换后的内容；有一段没找到 → null
 */
function applyReplacements(original, replacements) {
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  let lf = original.replace(/\r\n/g, '\n')
  for (const r of replacements) {
    if (!lf.includes(r.from)) return null
    lf = lf.replace(r.from, r.to)
  }
  return lf.split('\n').join(eol)
}

/* ------------------------------ 跑 e2e ------------------------------ */

function runE2E() {
  const r = spawnSync(process.execPath, [E2E], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return { code: r.status, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}` }
}

/** 重新编译 core —— 改了 src/domain/*.ts 或 src/content/*.json 就必须做，否则测的是旧产物 */
function rebuildCore() {
  const r = spawnSync(process.env.ComSpec, ['/d', '/c', 'npm', 'run', 'build:core'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return r.status === 0
}

/** 某条断言在输出里是红（✗）还是绿（✓） */
function isRed(out, name) {
  return out.includes(`✗ ${name}`)
}
function isGreen(out, name) {
  return out.includes(`✓ ${name}`)
}

/** 只留失败行做详情 —— 整段输出里混着 summary，容易看串 */
function failureLines(out) {
  return (
    out
      .split('\n')
      .filter((l) => l.includes('✗'))
      .join(' ｜ ')
      .slice(-600)
  )
}

/* ------------------------------ mutation ------------------------------ */

/** 内容层：讲义 p42 的 28 行 */
const REF = 'src/content/formula-reference.json'
/** 内容层：同和堂版成方 */
const DOSES = 'src/content/doses.json'
/** 内容层：对照表的 schema（字段 ＋ x-tables 列） */
const SCHEMA = 'src/content/schema/formula-reference.schema.json'
/** 服务端的正反投影 */
const SERVER = 'server/content-schema.mjs'
/** domain 的查表逻辑（会被编译进 core） */
const DOMAIN = 'src/domain/dose-lookup.ts'
/** domain 的方剂视图（会被编译进 core） */
const MEDICATION = 'src/domain/medication.ts'
/** 界面：同和堂版方剂的成方块 */
const LINES = 'src/components/DoseLines.tsx'
/** 界面：知识库方剂卡 */
const PANEL = 'src/components/MedicationPanel.tsx'
/** 断言脚本本身（用来验证「断言自己被写坏时能不能红」） */
const SCRIPT = 'scripts/e2e/lizhong-parent.mjs'

const MUTATIONS = [
  {
    id: 'LZM1',
    title: '内容层不登记母方（第 10 行的 parentDoseId 被删掉）',
    rebuildCore: true,
    files: [
      {
        path: REF,
        replacements: [
          {
            from:
              '      "draftName": "右关虚脏 · 软而无力（加味理中）",\n      "parentDoseId": "th-lizhong"',
            to: '      "draftName": "右关虚脏 · 软而无力（加味理中）"',
          },
        ],
      },
    ],
    // 没登记母方 ⇒ 查表只剩主方一条、落库不带走母方、界面也拿不到母方。
    expectRed: [
      'LZ3 只登记有据的那一条：parentDoseId 非空的行数 === 1',
      'LZ4 第 10 行是「加味理中」，母方登记为 th-lizhong',
      'LZ10 查「加味理中」：同和堂版命中 2 条（主方 ＋ 母方）',
      'LZ11 母方恰好 1 条，名字照录「理中汤」，组成照录不改',
      'LZ12 母方的对照依据以「母方 · 讲义 p42 第 10 行」开头',
      'LZ16 formulaDoseView（第 10 行）：parentDose ＝「理中汤」（p1）',
      'LZ18 正投影：落库行第 10 行带 parent_dose_id ＝ th-lizhong',
      'LZ19 正投影：整张表里带 parent_dose_id 的行数 === 1',
      'LZ20 反投影：回灌后 parentDoseId 还在（落库 → 回灌不丢）',
    ],
    // 母方没了，但**原表照录**和**查其他方**都不受影响 —— 它们必须仍然绿。
    expectGreen: [
      'LZ1 照录原表：讲义 p42 的 28 行里名为「理中」的行数 === 0（不自创方条）',
      'LZ2 照录原表：p42 行数 === 28，no 是 1..28 连续',
      'LZ13 查「理中」：仍是 contains 3 条（理中汤／加味理中汤／理中术姜芪）',
      'LZ15 查「中焦方（加味理中）」：仍是 none 0 条（不为了让结果好看而放宽）',
      'LZ21 母方标记在 DoseLines 里只渲染一处（计数比对）',
    ],
  },
  {
    id: 'LZM2',
    title: '服务端反投影漏了回填（落库有母方，回灌丢了）',
    files: [
      {
        path: SERVER,
        replacements: [
          {
            from: '    if (parentDoseId) out.parentDoseId = parentDoseId\n',
            to: '',
          },
        ],
      },
    ],
    // 正投影还在 ⇒ 落库那一步没坏；坏的只是回灌。
    expectRed: ['LZ20 反投影：回灌后 parentDoseId 还在（落库 → 回灌不丢）'],
    expectGreen: [
      'LZ18 正投影：落库行第 10 行带 parent_dose_id ＝ th-lizhong',
      'LZ19 正投影：整张表里带 parent_dose_id 的行数 === 1',
      'LZ4 第 10 行是「加味理中」，母方登记为 th-lizhong',
      'LZ10 查「加味理中」：同和堂版命中 2 条（主方 ＋ 母方）',
    ],
  },
  {
    id: 'LZM3',
    title: '服务端正投影漏了 parent_dose_id（落库就没带母方）',
    files: [
      {
        path: SERVER,
        replacements: [
          {
            from: '    parent_dose_id: opt(r.parentDoseId),\n',
            to: '',
          },
        ],
      },
    ],
    // 正投影坏 ⇒ 落库那一步就没母方 ⇒ 回灌自然也没有。
    expectRed: [
      'LZ18 正投影：落库行第 10 行带 parent_dose_id ＝ th-lizhong',
      'LZ19 正投影：整张表里带 parent_dose_id 的行数 === 1',
      'LZ20 反投影：回灌后 parentDoseId 还在（落库 → 回灌不丢）',
    ],
    // 内容层与 domain 都没动 —— 它们必须仍然绿。
    expectGreen: [
      'LZ4 第 10 行是「加味理中」，母方登记为 th-lizhong',
      'LZ10 查「加味理中」：同和堂版命中 2 条（主方 ＋ 母方）',
      'LZ13 查「理中」：仍是 contains 3 条（理中汤／加味理中汤／理中术姜芪）',
    ],
  },
  {
    id: 'LZM4',
    title: 'domain：母方不打 role 标记（界面上认不出哪条是母方）',
    rebuildCore: true,
    files: [
      {
        path: DOMAIN,
        replacements: [
          {
            from: "  return [{ ...toEntry(p), role: 'parent', basis: `母方 · ${basis}` }]",
            to: '  return [{ ...toEntry(p), basis: `母方 · ${basis}` }]',
          },
        ],
      },
    ],
    // 条目还在、依据还在，只是身份标记没了 ⇒ 只有「母方恰好 1 条」那条红。
    expectRed: ['LZ11 母方恰好 1 条，名字照录「理中汤」，组成照录不改'],
    expectGreen: [
      'LZ10 查「加味理中」：同和堂版命中 2 条（主方 ＋ 母方）',
      'LZ12 母方的对照依据以「母方 · 讲义 p42 第 10 行」开头',
      'LZ13 查「理中」：仍是 contains 3 条（理中汤／加味理中汤／理中术姜芪）',
      'LZ15 查「中焦方（加味理中）」：仍是 none 0 条（不为了让结果好看而放宽）',
    ],
  },
  {
    id: 'LZM5',
    title: 'domain：母方查到了但没并进结果（界面上还是看不到）',
    rebuildCore: true,
    files: [
      {
        path: DOMAIN,
        replacements: [
          {
            from:
              "  if (l.exact) return { entries: [l.exact, ...related], matched: l.via ?? 'exact', unit }",
            to:
              "  if (l.exact) return { entries: [l.exact, ...related.filter(() => false)], matched: l.via ?? 'exact', unit }",
          },
        ],
      },
    ],
    expectRed: [
      'LZ10 查「加味理中」：同和堂版命中 2 条（主方 ＋ 母方）',
      'LZ11 母方恰好 1 条，名字照录「理中汤」，组成照录不改',
      'LZ12 母方的对照依据以「母方 · 讲义 p42 第 10 行」开头',
    ],
    // 查「理中」走的是 candidates 那条路，不受这条影响 ⇒ 必须仍然绿。
    expectGreen: [
      'LZ13 查「理中」：仍是 contains 3 条（理中汤／加味理中汤／理中术姜芪）',
      'LZ14 查「理中」时没有混进母方标记（母方只随有据行出来）',
      'LZ15 查「中焦方（加味理中）」：仍是 none 0 条（不为了让结果好看而放宽）',
      'LZ16 formulaDoseView（第 10 行）：parentDose ＝「理中汤」（p1）',
    ],
  },
  {
    id: 'LZM6',
    title: 'domain：凭名字相近乱认母方（拿主方自己当母方）',
    rebuildCore: true,
    files: [
      {
        path: DOMAIN,
        replacements: [
          {
            from: '  const p = FORMULA_DOSE_BY_ID[row.parentDoseId]',
            // `row.doseId` 是可选字段 ⇒ 要写 `!` 才编得过（否则 TS2537）
            to: '  const p = FORMULA_DOSE_BY_ID[row.doseId!]',
          },
        ],
      },
    ],
    // 母方变成「加味理中汤」自己 ⇒ 名字与成方都不对。
    expectRed: ['LZ11 母方恰好 1 条，名字照录「理中汤」，组成照录不改'],
    // formulaDoseView 在 medication.ts 里，没被动过 ⇒ LZ16 必须仍然绿。
    expectGreen: [
      'LZ10 查「加味理中」：同和堂版命中 2 条（主方 ＋ 母方）',
      'LZ12 母方的对照依据以「母方 · 讲义 p42 第 10 行」开头',
      'LZ13 查「理中」：仍是 contains 3 条（理中汤／加味理中汤／理中术姜芪）',
      'LZ16 formulaDoseView（第 10 行）：parentDose ＝「理中汤」（p1）',
    ],
  },
  {
    id: 'LZM7',
    title: '界面：母方标记不渲染了（界面上看不出哪条是母方）',
    files: [
      {
        path: LINES,
        replacements: [
          {
            from: '            {e.role === \'parent\' && <span className="pr-dose-role">母方</span>}\n',
            to: '',
          },
        ],
      },
    ],
    expectRed: [
      'LZ21 母方标记在 DoseLines 里只渲染一处（计数比对）',
      "LZ23 母方条目一定要露出自己的方名（role==='parent' 判据出现在「露名」和「打标记」两处）",
    ],
    // 候选过滤与知识库卡都没动 ⇒ 必须仍然绿。
    expectGreen: [
      "LZ22 母方不算「同名不同号」候选 —— 过滤只做一次（计数比对）",
      'LZ24 MedicationPanel 里母方块只有一处（计数比对）',
      'LZ10 查「加味理中」：同和堂版命中 2 条（主方 ＋ 母方）',
    ],
  },
  {
    id: 'LZM8',
    title: '界面：母方被算进「同名不同号」候选（那是另一个方，不是候选）',
    files: [
      {
        path: LINES,
        replacements: [
          {
            from: "  const cands = view.entries.filter((e) => e.role !== 'parent')",
            to: '  const cands = view.entries',
          },
        ],
      },
    ],
    expectRed: ["LZ22 母方不算「同名不同号」候选 —— 过滤只做一次（计数比对）"],
    expectGreen: [
      'LZ21 母方标记在 DoseLines 里只渲染一处（计数比对）',
      "LZ23 母方条目一定要露出自己的方名（role==='parent' 判据出现在「露名」和「打标记」两处）",
      'LZ24 MedicationPanel 里母方块只有一处（计数比对）',
    ],
  },
  {
    id: 'LZM9',
    title: '界面：知识库方剂卡里没有母方块了',
    files: [
      {
        path: PANEL,
        replacements: [
          {
            from:
              '      {showTh && v.parentDose && (\n' +
              '        <div className="pr-dose-block is-parent">\n' +
              '          <div className="pr-dose-tag">母方 · 同和堂版 · 克</div>\n' +
              '          <div className="pr-dose-text">{v.parentDose.composition}</div>\n' +
              '          {v.parentDose.notes?.map((n, i) => (\n' +
              '            <div key={i} className="pr-dose-note">\n' +
              '              注：{n}\n' +
              '            </div>\n' +
              '          ))}\n' +
              '          <div className="pr-dose-src">\n' +
              '            〔{v.parentDose.name}｜同和堂版 p{v.parentDose.page}〕\n' +
              '          </div>\n' +
              '        </div>\n' +
              '      )}\n',
            to: '',
          },
        ],
      },
    ],
    expectRed: ['LZ24 MedicationPanel 里母方块只有一处（计数比对）'],
    expectGreen: [
      'LZ21 母方标记在 DoseLines 里只渲染一处（计数比对）',
      "LZ22 母方不算「同名不同号」候选 —— 过滤只做一次（计数比对）",
      'LZ16 formulaDoseView（第 10 行）：parentDose ＝「理中汤」（p1）',
    ],
  },
  {
    id: 'LZM10',
    title: '内容层自创了一条名为「理中」的行（违反「照录原表，不自创」）',
    rebuildCore: true,
    files: [
      {
        path: REF,
        replacements: [
          {
            from: '    {\n      "no": 11,',
            to:
              '    {\n' +
              '      "no": 29,\n' +
              '      "name": "理中",\n' +
              '      "indication": "自创行（break-test 用）",\n' +
              '      "doseBasis": "自创行（break-test 用）"\n' +
              '    },\n' +
              '    {\n      "no": 11,',
          },
        ],
      },
    ],
    // 自创行 ⇒ 原表被污染 ⇒ 「照录原表」那条与「28 行」那条一起红。
    expectRed: [
      'LZ1 照录原表：讲义 p42 的 28 行里名为「理中」的行数 === 0（不自创方条）',
      'LZ2 照录原表：p42 行数 === 28，no 是 1..28 连续',
    ],
    // 自创的那行没有 doseId ⇒ 查表行为一个字节都不变 ⇒ 这些必须仍然绿。
    expectGreen: [
      'LZ3 只登记有据的那一条：parentDoseId 非空的行数 === 1',
      'LZ4 第 10 行是「加味理中」，母方登记为 th-lizhong',
      'LZ10 查「加味理中」：同和堂版命中 2 条（主方 ＋ 母方）',
      'LZ13 查「理中」：仍是 contains 3 条（理中汤／加味理中汤／理中术姜芪）',
      'LZ15 查「中焦方（加味理中）」：仍是 none 0 条（不为了让结果好看而放宽）',
    ],
  },
  {
    id: 'LZM11',
    title: '断言自己被写坏（LZ3 的判据反了）',
    files: [
      {
        path: SCRIPT,
        replacements: [
          {
            from: '  withParent.length === 1,',
            to: '  withParent.length > 1,',
          },
        ],
      },
    ],
    // 这条验证的是「断言本身有效」：判据反了，它就该红。
    expectRed: ['LZ3 只登记有据的那一条：parentDoseId 非空的行数 === 1'],
    expectGreen: ['LZ4 第 10 行是「加味理中」，母方登记为 th-lizhong'],
  },
  {
    id: 'LZM12',
    title: 'domain：formulaDoseView 拿主方自己当母方（乱认）',
    rebuildCore: true,
    files: [
      {
        path: MEDICATION,
        replacements: [
          {
            from:
              '  const parentDose = r.parentDoseId ? FORMULA_DOSE_BY_ID[r.parentDoseId] : undefined',
            to: '  const parentDose = r.doseId ? FORMULA_DOSE_BY_ID[r.doseId] : undefined',
          },
        ],
      },
    ],
    // 母方变成主方自己 ⇒ 第 10 行、第 11 行都拿错。
    expectRed: [
      'LZ16 formulaDoseView（第 10 行）：parentDose ＝「理中汤」（p1）',
      'LZ17 formulaDoseView（第 11 行「理中术姜芪」）：没有登记母方 ⇒ parentDose 是 undefined',
    ],
    // 查表那条路（dose-lookup.ts）没被动过 ⇒ 必须仍然绿。
    expectGreen: [
      'LZ10 查「加味理中」：同和堂版命中 2 条（主方 ＋ 母方）',
      'LZ11 母方恰好 1 条，名字照录「理中汤」，组成照录不改',
      'LZ12 母方的对照依据以「母方 · 讲义 p42 第 10 行」开头',
    ],
  },
  {
    id: 'LZM13',
    title: '内容层：第 10 行的对照依据里把母方说明删了',
    rebuildCore: true,
    files: [
      {
        path: REF,
        replacements: [
          {
            from: '母方＝理中汤',
            to: '母方未载',
          },
        ],
      },
    ],
    // 依据还在，但不再写明母方是谁 ⇒ 「依据里写明母方」那条红。
    expectRed: ['LZ5 第 10 行的对照依据里写明了母方＝理中汤'],
    // 登记本身没动 ⇒ 查表与落库都不受影响。
    expectGreen: [
      'LZ4 第 10 行是「加味理中」，母方登记为 th-lizhong',
      'LZ10 查「加味理中」：同和堂版命中 2 条（主方 ＋ 母方）',
      'LZ12 母方的对照依据以「母方 · 讲义 p42 第 10 行」开头',
      'LZ18 正投影：落库行第 10 行带 parent_dose_id ＝ th-lizhong',
    ],
  },
  {
    id: 'LZM14',
    title: '内容层：同和堂版「理中汤」的组成被改（没照录）',
    rebuildCore: true,
    files: [
      {
        path: DOSES,
        replacements: [
          {
            from: '"composition": "党参9 白术18 干姜9 甘草4 黄芪8"',
            to: '"composition": "党参9 白术18 干姜9 甘草4"',
          },
        ],
      },
    ],
    // 组成没照录 ⇒ 内容层那条红；domain 那边重新编译后也跟着红。
    expectRed: [
      'LZ6 同和堂版有「理中汤」成方（党参9 白术18 干姜9 甘草4 黄芪8，p1）',
      'LZ11 母方恰好 1 条，名字照录「理中汤」，组成照录不改',
    ],
    // 名字、页码、notes 都没动 ⇒ 这些必须仍然绿。
    expectGreen: [
      'LZ7 「理中汤」的 notes 记着讲稿原话，并写明 p42 里没有单独的「理中」行',
      'LZ10 查「加味理中」：同和堂版命中 2 条（主方 ＋ 母方）',
      'LZ16 formulaDoseView（第 10 行）：parentDose ＝「理中汤」（p1）',
    ],
  },
  {
    id: 'LZM15',
    title: '内容层：「理中汤」的 notes 把「p42 里没有单独的理中行」写反了',
    rebuildCore: true,
    files: [
      {
        path: DOSES,
        replacements: [
          {
            from: '没有单独的「理中」行',
            to: '有单独的「理中」行',
          },
        ],
      },
    ],
    expectRed: ['LZ7 「理中汤」的 notes 记着讲稿原话，并写明 p42 里没有单独的「理中」行'],
    // 只改了 notes ⇒ 组成、查表、落库都不受影响。
    expectGreen: [
      'LZ6 同和堂版有「理中汤」成方（党参9 白术18 干姜9 甘草4 黄芪8，p1）',
      'LZ10 查「加味理中」：同和堂版命中 2 条（主方 ＋ 母方）',
      'LZ13 查「理中」：仍是 contains 3 条（理中汤／加味理中汤／理中术姜芪）',
    ],
  },
  {
    id: 'LZM16',
    title: '内容层：schema 里没登记母方字段（字段 ＋ x-tables 列都没了）',
    files: [
      {
        path: SCHEMA,
        replacements: [
          {
            from:
              '        "parentDoseId": {\n' +
              '          "type": "string",\n' +
              '          "description": "母方成方的 id（讲稿原文明写母方关系时才填，如「加味理中」←「理中汤」）"\n' +
              '        },\n',
            to: '',
          },
          {
            from:
              '        {\n' +
              '          "name": "parent_dose_id",\n' +
              '          "type": "text",\n' +
              '          "fk": { "table": "content_doses", "column": "id" },\n' +
              '          "json": "rows.items.parentDoseId"\n' +
              '        },\n',
            to: '',
          },
        ],
      },
    ],
    expectRed: [
      'LZ8 schema：$defs.row.properties.parentDoseId 存在',
      'LZ9 schema：x-tables 里 content_formula_reference 有 parent_dose_id 列（外键 → content_doses.id）',
    ],
    // schema 只是「描述」⇒ 内容层与查表都不受影响。
    expectGreen: [
      'LZ4 第 10 行是「加味理中」，母方登记为 th-lizhong',
      'LZ10 查「加味理中」：同和堂版命中 2 条（主方 ＋ 母方）',
      'LZ18 正投影：落库行第 10 行带 parent_dose_id ＝ th-lizhong',
    ],
  },
  {
    id: 'LZM17',
    title: 'domain：讲义 p42 的对照改成模糊匹配（凭名字相近就认）',
    rebuildCore: true,
    files: [
      {
        path: DOMAIN,
        replacements: [
          {
            from: '  const row = FORMULA_REFERENCE.find((r) => r.name === name && r.doseId)',
            to: '  const row = FORMULA_REFERENCE.find((r) => r.name.includes(name) && r.doseId)',
          },
        ],
      },
    ],
    // 模糊匹配 ⇒ 查「理中」会撞上第 10 行「加味理中」⇒ 母方被混了进来。
    expectRed: [
      'LZ13 查「理中」：仍是 contains 3 条（理中汤／加味理中汤／理中术姜芪）',
      'LZ14 查「理中」时没有混进母方标记（母方只随有据行出来）',
    ],
    // 查全名「加味理中」的结果不变 ⇒ 必须仍然绿。
    expectGreen: [
      'LZ10 查「加味理中」：同和堂版命中 2 条（主方 ＋ 母方）',
      'LZ11 母方恰好 1 条，名字照录「理中汤」，组成照录不改',
      'LZ15 查「中焦方（加味理中）」：仍是 none 0 条（不为了让结果好看而放宽）',
    ],
  },
  {
    id: 'LZM18',
    title: 'domain：方名括号里的话被当成了方名（查成了讲义方名）',
    rebuildCore: true,
    files: [
      {
        path: DOMAIN,
        replacements: [
          {
            from: '  const m = name.match(/^(.+?)[（(][^）)]*[）)]\\s*$/)',
            to: '  const m = name.match(/^[^（(]*[（(]([^）)]+)[）)]\\s*$/)',
          },
        ],
      },
    ],
    // 「中焦方（加味理中）」的括号里是讲义方名 ⇒ 一旦拿它去查，就查出了不该查的。
    expectRed: ['LZ15 查「中焦方（加味理中）」：仍是 none 0 条（不为了让结果好看而放宽）'],
    // 不带括号的查询不受影响 ⇒ 必须仍然绿。
    expectGreen: [
      'LZ10 查「加味理中」：同和堂版命中 2 条（主方 ＋ 母方）',
      'LZ13 查「理中」：仍是 contains 3 条（理中汤／加味理中汤／理中术姜芪）',
      'LZ16 formulaDoseView（第 10 行）：parentDose ＝「理中汤」（p1）',
    ],
  },
]

/* ------------------------------ 跑 ------------------------------ */

console.log('\n理中母方 · break-test（证明 LZ 断言不是恒绿）\n')

/* 先确认：没改任何东西时，断言本身是全绿的 */
{
  const base = runE2E()
  ok('基线：断言全绿', base.code === 0, `exit=${base.code}`)
}

for (const m of MUTATIONS) {
  console.log(`${m.id} ${m.title}`)

  /** 备份：改之前把每个涉及的文件的原始字节存下来 */
  const backup = new Map()
  for (const f of m.files) {
    const p = join(ROOT, f.path)
    backup.set(p, readFileSync(p))
  }

  try {
    // ① 改坏
    let applied = true
    for (const f of m.files) {
      const p = join(ROOT, f.path)
      const next = applyReplacements(backup.get(p).toString('utf8'), f.replacements)
      if (next === null) {
        applied = false
        ok(`${m.id} 替换片段对得上`, false, `${f.path} 里没找到要替换的那段`)
        break
      }
      writeFileSync(p, next, 'utf8')
    }
    if (!applied) continue

    // ② 动了 domain / 内容 JSON 就重编译 core —— 否则测的还是旧产物，且**不报错**
    if (m.rebuildCore) {
      const built = rebuildCore()
      ok(`${m.id} 改坏后重编译 core`, built)
      if (!built) {
        // 编译没成功 ⇒ 产物要么是旧的、要么是半成品，**测出来的红绿都不可信**
        ok(`${m.id} 重编译失败 ⇒ 不看断言结果（产物不可信）`, false)
        continue
      }
    }

    // ③ 跑断言：它必须红
    const r = runE2E()
    ok(`${m.id} 断言测试红了（退出码非 0）`, r.code !== 0, `exit=${r.code}`)

    for (const name of m.expectRed) {
      ok(`${m.id} 该红的真的红了：${name}`, isRed(r.out, name), failureLines(r.out))
    }
    for (const name of m.expectGreen) {
      ok(`${m.id} 不该红的仍然绿：${name}`, isGreen(r.out, name), failureLines(r.out))
    }
  } finally {
    // ④ 还原：文件逐字节还原
    for (const [p, bytes] of backup) {
      writeFileSync(p, bytes)
    }
    // ⑤ 还原自检：逐字节一致
    let same = true
    for (const [p, bytes] of backup) {
      if (!existsSync(p) || !readFileSync(p).equals(bytes)) same = false
    }
    ok(`${m.id} 还原后逐字节一致`, same)

    // ⑥ 动过 domain / 内容 JSON 的，产物也要重新编译 —— 否则下一轮测的是脏代码
    if (m.rebuildCore) {
      ok(`${m.id} 还原后重新编译 core`, rebuildCore())
    }
  }

  // ⑦ 还原后再跑一次：必须全绿
  const again = runE2E()
  ok(`${m.id} 还原后断言测试全绿`, again.code === 0, `exit=${again.code}`)
  console.log('')
}

/* ------------------------------ 收尾 ------------------------------ */

console.log(`=== 通过 ${pass} ｜ 失败 ${fail} ===`)
if (failures.length) {
  console.log('失败项：')
  for (const f of failures) console.log('  · ' + f)
}
process.exit(fail === 0 ? 0 : 1)
