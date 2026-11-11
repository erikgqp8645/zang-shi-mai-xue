#!/usr/bin/env node
/**
 * break-test：证明「用方知识库管理员覆盖层」那几条断言**不是恒绿**
 *
 * ## 背景
 *
 * 2026-11-11：新增「用方知识库 · 管理员覆盖层」—— 管理员在命令行
 * （`npm run admin -- library …`）改知识库，改动落在本机 SQLite，
 * `library apply` 再把它合并回 `src/content/*.json`（**数据层**，前端代码零改动）。
 *
 * 覆盖层有几处「坏法」是**静默**的 —— 写错了不报错，只是知识库悄悄不对了：
 *   · 覆盖层不生效 → 管理员改了，前端还是旧的（而且看起来一切正常）；
 *   · 墓碑被当成「没改过」→ 刚删的条目又冒出来；
 *   · 悬空引用检查被关掉 → 写出半坏数据，前端读的时候才炸；
 *   · p44 边界被关掉 → 数据多一条而判定函数没有 → **前端启动就崩**；
 *   · 每次写盘都带时间戳 → apply 不幂等，改一次抖一下。
 *
 * ## 这个脚本干什么
 *
 * 逐个把源码**故意写坏**，跑一遍 `library-admin.mjs`，验证：
 *   · 该红的真的红了（写坏必被抓）；
 *   · 不该红的仍然绿（否则就是恒红／恒绿的摆设）。
 *
 * 跑法：node scripts/e2e/library-admin-break-test.mjs
 *
 * ⚠️ 无论怎么退出，源码都要还原（逐字节核对）。
 * ⚠️ **别用会提前掐断管道的命令跑它**（例如 `… | Select-Object -First N`）——
 *    进程被掐掉时 `finally` 来不及执行，源码会**留在写坏的状态**。
 *    要看输出就重定向到文件再看。
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const E2E = join(ROOT, 'scripts', 'e2e', 'library-admin.mjs')

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

/* --------------------------- 改源码的小工具 --------------------------- */

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

/** 某条断言在输出里是红（✗）还是绿（✓） */
function isRed(out, name) {
  return out.includes(`✗ ${name}`)
}
function isGreen(out, name) {
  return out.includes(`✓ ${name}`)
}

/* ------------------------------ mutation ------------------------------ */

const LIB = 'server/library-schema.mjs'
const CLI = 'scripts/lib/library-cli.mjs'

const MUTATIONS = [
  {
    id: 'M1',
    title: '合并逻辑改成「覆盖层不生效」（改了但前端看不到，而且不报错）',
    files: [
      {
        path: LIB,
        replacements: [
          {
            from: 'const merged = mergeKind(spec, file[spec.key], overrides?.[kind] ?? {})',
            to: 'const merged = mergeKind(spec, file[spec.key], {})',
          },
        ],
      },
    ],
    expectRed: ['B4 apply 之后临时内容里这条真的变了', 'C2 apply 之后这条真的多出来了'],
    expectGreen: [],
  },
  {
    id: 'M2',
    title: '墓碑当成「没改过」（删掉的条目又冒出来）',
    files: [
      {
        path: LIB,
        replacements: [
          {
            from: [
              '    if (ov.deleted) {',
              '      map.delete(itemId)',
              '      removed.push(itemId)',
              '      continue',
              '    }',
              '    if (!ov.payload || typeof ov.payload !== \'object\' || Array.isArray(ov.payload)) {',
            ].join('\n'),
            to: [
              '    if (ov.deleted) {',
              '      removed.push(itemId)',
              '      continue',
              '    }',
              '    if (!ov.payload || typeof ov.payload !== \'object\' || Array.isArray(ov.payload)) {',
            ].join('\n'),
          },
        ],
      },
    ],
    expectRed: ['D4 删掉一条基线里本来就有的条目 → apply 之后它真的不见了'],
    // 关键：只坏了「数组类」的墓碑，成方的级联清理不该受影响 ——
    // 否则说明 D4 那条是靠级联顺带变红的假阳性。
    expectGreen: ['F1 删成方后 apply：p42 的 doseId 置空、doseBasis 写「未载」'],
  },
  {
    id: 'M3',
    title: '悬空引用检查关掉（写出半坏数据，炸在后面）',
    files: [
      {
        path: LIB,
        replacements: [
          {
            from: 'if (doseId && !doseIds.has(doseId)) {',
            to: 'if (doseId && false) {',
          },
        ],
      },
    ],
    expectRed: [
      'G1 把 p42 指向不存在的成方 → apply 拒绝写盘',
      'G2 verify 能报出这条悬空引用',
    ],
    expectGreen: [],
  },
  {
    id: 'M4',
    title: 'p44 边界检查关掉（数据多一条而判定函数没有 → 前端启动就崩）',
    files: [
      {
        path: LIB,
        replacements: [
          {
            from: [
              '    if (!baseIds.has(itemId)) {',
              '      errors.push(',
              '        `覆盖层新增了讲义 p44 条目「${itemId}」—— ` +',
              '          `判定函数表里没有它，前端会起不来`,',
              '      )',
              '    }',
            ].join('\n'),
            to: [
              '    if (false) {',
              '      errors.push(',
              '        `覆盖层新增了讲义 p44 条目「${itemId}」—— ` +',
              '          `判定函数表里没有它，前端会起不来`,',
              '      )',
              '    }',
            ].join('\n'),
          },
        ],
      },
    ],
    expectRed: [
      'H5 覆盖层里混进 p44 新增 → apply 必须拒绝（否则前端起不来）',
      'H6 塞进去的那条被 verify 抓到',
    ],
    expectGreen: [],
  },
  {
    id: 'M5',
    title: '每次写盘都带当前时间戳（apply 不幂等，改一次抖一下）',
    files: [
      {
        path: LIB,
        replacements: [
          {
            from: "const text = JSON.stringify(obj, null, 2).split('\\n').join(eol) + eol",
            to: "const text = JSON.stringify({ ...obj, $writtenAt: Date.now() }, null, 2).split('\\n').join(eol) + eol",
          },
        ],
      },
      {
        path: CLI,
        replacements: [
          // 顺带让 apply 每次都写盘 —— 否则「内容没变就不写」这条捷径
          // 会把时间戳的抖动挡在外面，B5 那条断言就抓不到。
          { from: '  if (totalChanged === 0) {', to: '  if (false) {' },
        ],
      },
    ],
    expectRed: [
      'A4 apply 之后内容文件里没有多出后端自己加的顶层键',
      'B5 apply 幂等：跑两次，第二次一个字节都不变',
    ],
    expectGreen: [],
  },
  {
    id: 'M6',
    title: '删成方的级联清理去掉（引用它的地方会指向一个不存在的方）',
    files: [
      {
        path: LIB,
        replacements: [
          {
            from: [
              '      row.doseId = \'\'',
              '      const mark = `未载（原 doseId=${doseId} 已删除）`',
              '      row.doseBasis = row.doseBasis ? `${mark}；${row.doseBasis}` : mark',
            ].join('\n'),
            to: '      // （故意写坏：不动 doseId，也不标「未载」）',
          },
        ],
      },
    ],
    expectRed: ['F1 删成方后 apply：p42 的 doseId 置空、doseBasis 写「未载」'],
    // 关键：只坏了「引用行」那一半，科中映射的清理不该受影响 ——
    // 否则说明 F1 那条是靠映射清理顺带变红的假阳性。
    expectGreen: ['F2 删成方后，对应的科中映射也一并清掉'],
  },
  {
    id: 'M7',
    title: '删讲稿方剂的级联清理去掉（p44 的 drugs[] 里会留下一个不存在的方）',
    files: [
      {
        path: LIB,
        replacements: [
          {
            from: '      rule.drugs = rule.drugs.filter((d) => String(d) !== String(drugId))',
            to: '      rule.drugs = rule.drugs',
          },
        ],
      },
    ],
    expectRed: ['D5 删掉一条被 p44 引用的方剂 → p44 的 drugs[] 里那个 id 也被去掉'],
    // 关键：只坏了「讲稿方剂」那一半，成方的级联不该受影响。
    expectGreen: ['F1 删成方后 apply：p42 的 doseId 置空、doseBasis 写「未载」'],
  },
]

/* ------------------------------ 主流程 ------------------------------ */

const originals = new Map()
for (const m of MUTATIONS) {
  for (const f of m.files) {
    const abs = join(ROOT, f.path)
    if (!originals.has(abs)) originals.set(abs, readFileSync(abs, 'utf8'))
  }
}
const backupDir = mkdtempSync(join(tmpdir(), 'pulse-break-lib-'))
for (const [abs, content] of originals) {
  writeFileSync(join(backupDir, abs.replace(/[\\/]/g, '_')), content, 'utf8')
}

function restoreAll() {
  for (const [abs, content] of originals) writeFileSync(abs, content, 'utf8')
}

console.log('\n用方知识库 · 管理员覆盖层 break-test\n')

try {
  for (const m of MUTATIONS) {
    console.log(`【mutation ${m.id}】${m.title}`)
    let changed = false
    for (const f of m.files) {
      const abs = join(ROOT, f.path)
      const mutated = applyReplacements(originals.get(abs), f.replacements)
      if (!mutated || mutated === originals.get(abs)) {
        ok(`mutation ${m.id} 真的改动了源码（${f.path}）`, false, '替换片段没对上 —— 规则失效')
        continue
      }
      writeFileSync(abs, mutated, 'utf8')
      changed = true
    }
    if (!changed) {
      ok(`mutation ${m.id} 真的改动了源码`, false, '一个文件都没改成 —— 规则失效')
      continue
    }
    ok(`mutation ${m.id} 真的改动了源码`, true)

    const { code, out } = runE2E()
    ok(`mutation ${m.id} 跑 e2e 失败（说明写坏了）`, code !== 0, `退出码 ${code}`)

    for (const name of m.expectRed) {
      ok(`mutation ${m.id}｜「${name}」变红`, isRed(out, name), out.slice(-800))
    }
    for (const name of m.expectGreen) {
      ok(`mutation ${m.id}｜「${name}」仍然绿`, isGreen(out, name), out.slice(-800))
    }

    // 还原 —— 必须在下一个 mutation 之前还原，且逐字节核对
    restoreAll()
    let same = true
    for (const [abs, content] of originals) {
      if (readFileSync(abs, 'utf8') !== content) same = false
    }
    ok(`mutation ${m.id} 之后源码已还原（逐字节一致）`, same)
    console.log('')
  }

  // 全部还原之后，基线必须仍然全绿
  console.log('【基线】还原之后再跑一遍，必须全绿')
  const { code, out } = runE2E()
  ok('还原后用方知识库 e2e 全绿', code === 0, out.slice(-800))
} finally {
  // 无论怎么退出，源码都要还原
  restoreAll()
  let same = true
  for (const [abs, content] of originals) {
    if (readFileSync(abs, 'utf8') !== content) same = false
  }
  ok('退出时源码已还原（逐字节一致）', same)
  try {
    rmSync(backupDir, { recursive: true, force: true, maxRetries: 3 })
  } catch {
    /* 临时目录留着也无所谓 */
  }
}

console.log(`\n=== 通过 ${pass} ｜ 失败 ${fail} ===`)
if (failures.length) {
  console.log('失败项：')
  for (const f of failures) console.log('  · ' + f)
}
process.exit(fail === 0 ? 0 : 1)
