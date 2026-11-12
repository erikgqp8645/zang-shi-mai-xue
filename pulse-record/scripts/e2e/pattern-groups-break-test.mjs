#!/usr/bin/env node
/**
 * break-test：证明「组说明」那几条断言（PG1~PG15）**不是恒绿**
 *
 * ## 背景
 *
 * 2026-11-12：用户在「五味异功1」那张图上标了两处 —— 左关浮空格中央飘着
 * 一个小组号「1」、右关浮的 `0` 右上角多了一个上角标「2」。
 * 修法：格内角标去掉、组信息改成图下方一行文字；左关浮的数据残缺补齐。
 *
 * 做完之后最怕的是：断言写成「查文件在不在」「查有没有某个字」这种**恒绿**检查，
 * 看着 15 项全绿，其实改坏了也抓不到。
 *
 * ## 这个脚本干什么
 *
 * 逐个把仓库**故意写坏**，跑一遍 `pattern-groups.mjs`，验证：
 *   · 该红的真的红了，而且**红的原因正是那条断言在测的那件事**；
 *   · 不该红的仍然绿（否则就是恒红／恒绿的摆设）。
 *
 * ## ⚠️ 改 domain 的那几条要重编译 core
 *
 * `src/domain/pulse-pattern.ts` **会被编译进 `miniprogram/utils/core/`**
 * （`tsconfig.core.json` 收的是 `src/domain/` 下所有 `.ts` 文件），
 * 而那个产物**不在版本库里** —— 改坏了不重编译，后面每一轮都在测旧代码且**不报错**。
 * 所以凡是动了 domain 的 mutation：改坏后编译一次、还原后再编译一次。
 *
 * 跑法：node scripts/e2e/pattern-groups-break-test.mjs
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
const E2E = join(ROOT, 'scripts', 'e2e', 'pattern-groups.mjs')

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

/** 重新编译 core —— 改了 src/domain/*.ts 就必须做，否则测的是旧产物 */
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

/** 矩阵（格内角标原来在这里） */
const SHEET = 'src/components/PatternSheet.tsx'
/** 方剂卡的「脉象图」那一栏（组说明在缩略图 ＋ 弹层大图两处） */
const STRIP = 'src/components/PatternStrip.tsx'
/** 组说明的纯逻辑（会被编译进 core） */
const PURE = 'src/domain/pulse-pattern.ts'
/** 断言脚本本身（用来验证「断言自己被写坏时能不能红」） */
const SCRIPT = 'scripts/e2e/pattern-groups.mjs'

const MUTATIONS = [
  {
    id: 'PGM1',
    title: '格内角标又加回来了（`0²` 的上角标回来了）',
    files: [
      {
        path: SHEET,
        replacements: [
          {
            from: "                    {req ? requirementText(req) : ''}\n                  </td>",
            to:
              "                    {req ? requirementText(req) : ''}\n" +
              '                    <sup className="pr-ps-gno">1</sup>\n' +
              '                  </td>',
          },
        ],
      },
    ],
    expectRed: [
      'PG9 PatternSheet 里不再有 <sup>（格内角标彻底没了）',
      'PG10 整个 src 里不再有 pr-ps-gno（连 CSS 一起）',
    ],
    // 关键：脉象符号本身不能受影响 —— 坏的是「角标」，不是「符号」。
    expectGreen: ['PG14 PatternSheet 仍然渲染脉象符号（去掉角标不能连符号一起删了）'],
  },
  {
    id: 'PGM2',
    title: '缩略图那一处不带组说明了（只剩弹层大图有）',
    files: [
      {
        path: STRIP,
        replacements: [
          {
            from: '          const legend = hasCells(p) ? groupLegend(p) : null',
            to: '          const legend = hasCells(p) ? null : null',
          },
        ],
      },
    ],
    expectRed: ['PG11 PatternStrip 的两个渲染点都带组说明（缩略图 ＋ 弹层大图）'],
    expectGreen: ['PG3 groupLegend：多组图列出每组含哪几格'],
  },
  {
    id: 'PGM3',
    title: '又用回「格角上标」那种旧措辞（角标没了却还在讲角标）',
    files: [
      {
        path: STRIP,
        replacements: [
          {
            from: '                  <b>每组内部要同时成立；组与组之间有一组成立即算符合。</b>',
            to:
              '                  <b>每组内部要同时成立；组与组之间有一组成立即算符合。</b>\n' +
              '                  格角上标的是它属于哪一组。',
          },
        ],
      },
    ],
    expectRed: ['PG12 界面可见文案里不再有「格角上标」这类旧措辞'],
    expectGreen: ['PG15 组说明那句语义说明只有一处（计数比对）'],
  },
  {
    id: 'PGM4',
    title: 'groupLegend 的过滤条件写反了（列出来的正好是没有要求的格）',
    rebuildCore: true,
    files: [
      {
        path: PURE,
        replacements: [
          {
            from: '    const labels = cells.filter((k) => has.has(k)).map(cellLabel)',
            to: '    const labels = cells.filter((k) => !has.has(k)).map(cellLabel)',
          },
        ],
      },
    ],
    // 过滤条件写反 ⇒ 多组图的组说明整个反了 ⇒ PG3 一并红。
    expectRed: [
      'PG5 groupLegend：过滤掉「在 groups 里但 cells 里没有」的格（空组不列）',
      'PG3 groupLegend：多组图列出每组含哪几格',
      'PG7 基线：每张多组图都出得了组说明，且没有空组',
    ],
    // 基线条数与过滤无关 —— 它必须仍然绿。
    expectGreen: ['PG6 基线：多组图是 20 条（计数比对）'],
  },
  {
    id: 'PGM5',
    title: 'cellLabel 的左右手反了（左手说成右手）',
    rebuildCore: true,
    files: [
      {
        path: PURE,
        replacements: [
          {
            from: "const HAND_TEXT: Record<Hand, string> = { L: '左', R: '右' }",
            to: "const HAND_TEXT: Record<Hand, string> = { L: '右', R: '左' }",
          },
        ],
      },
    ],
    // 左右手反了 ⇒ 组说明里的格名也反了 ⇒ PG3 一并红。
    expectRed: [
      'PG1 cellLabel：左关浮 / 右关沉',
      'PG3 groupLegend：多组图列出每组含哪几格',
    ],
    // 基线条数与左右手无关 —— 它必须仍然绿。
    expectGreen: ['PG6 基线：多组图是 20 条（计数比对）'],
  },
  {
    id: 'PGM6',
    title: '单组也出一道组说明（多组才需要说明）',
    rebuildCore: true,
    files: [
      {
        path: PURE,
        replacements: [
          {
            from: '  if (!groups || groups.length <= 1) return null',
            to: '  if (!groups || groups.length < 1) return null',
          },
        ],
      },
    ],
    expectRed: ['PG4 groupLegend：单组 / 没有 groups 时不出一道说明（默认语义就是全部同时成立）'],
    expectGreen: ['PG3 groupLegend：多组图列出每组含哪几格'],
  },
  {
    id: 'PGM7',
    title: '断言自己被写坏（PG8 的不变量判据反了）',
    files: [
      {
        path: SCRIPT,
        replacements: [
          {
            from:
              "checker.check('PG8 基线不变量：groups 引用的格必须都在 cells 里（不许再有空组）', orphan.length === 0, JSON.stringify(orphan))",
            to:
              "checker.check('PG8 基线不变量：groups 引用的格必须都在 cells 里（不许再有空组）', orphan.length > 0, JSON.stringify(orphan))",
          },
        ],
      },
    ],
    // 这条验证的是「断言本身有效」：判据反了，它就该红。
    expectRed: ['PG8 基线不变量：groups 引用的格必须都在 cells 里（不许再有空组）'],
    expectGreen: ['PG7 基线：每张多组图都出得了组说明，且没有空组'],
  },
]

/* ------------------------------ 跑 ------------------------------ */

console.log('\n脉象图组说明 · break-test（证明 PG 断言不是恒绿）\n')

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

    // ② 改了 domain 就重编译 core —— 否则测的还是旧产物，且**不报错**
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

    // ⑥ 动过 domain 的，产物也要重新编译 —— 否则下一轮测的是脏代码
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
