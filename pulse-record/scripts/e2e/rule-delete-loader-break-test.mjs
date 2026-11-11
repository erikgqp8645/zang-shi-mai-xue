#!/usr/bin/env node
/**
 * break-test：证明「删掉一条讲义 p44 条目之后前端照样起得来」那几条断言**不是恒绿**
 *
 * ## 背景
 *
 * 2026-11-11：讲义 p44 的条目数据（`src/content/formula-rules.json`）与命中判定
 * （`src/domain/formulas.ts` 的 `EVALUATORS`）之间，原先是「双向校验、缺一即抛错」。
 * 管理员在命令行删一条条目 → 数据少一条、函数还留着 → **前端启动就崩**。
 *
 * 所以才把规则改成两个方向**刻意不对称**：
 *   · 数据有、判定函数没有 → 抛错（新增这条路仍然堵着）；
 *   · 判定函数有、数据没有 → 跳过（条目被删了，函数是残留代码）。
 *
 * ## 这个脚本干什么
 *
 * 逐个把**源码**故意写坏，重新编译共享内核，跑一遍 `rule-delete-loader.mjs`，验证：
 *   · 该红的真的红了（写坏必被抓）；
 *   · 不该红的仍然绿（否则就是恒红／恒绿的摆设）。
 *
 * 跑法：node scripts/e2e/rule-delete-loader-break-test.mjs
 *
 * ⚠️ 无论怎么退出，源码都要还原（逐字节核对），并且**要重新编译一次**，
 *    否则编译产物里留着写坏的那一版，后面所有测试都被污染。
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
const E2E = join(ROOT, 'scripts', 'e2e', 'rule-delete-loader.mjs')
const FORMULAS_TS = join(ROOT, 'src', 'domain', 'formulas.ts')

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

/* ------------------------------ 跑命令 ------------------------------ */

/** 重新编译共享内核（网站端与小程序端共用的那一份） */
function buildCore() {
  const r = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'npm', 'run', 'build:core'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
  })
  return { code: r.status, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}` }
}

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

const MUTATIONS = [
  {
    id: 'M1',
    title: '载入器不再为「数据有、判定函数没有」抛错（静默降级成永不命中）',
    replacements: [
      {
        from: [
          '    const evaluate = evaluators[r.id]',
          '    if (!evaluate) {',
          '      throw new Error(',
          '        `formulas.ts：规则「${r.id}」没有对应的判定函数。` +',
          '          `请在 EVALUATORS 里补上（数据在 JSON，判定逻辑在本文件）。`,',
          '      )',
          '    }',
        ].join('\n'),
        to: [
          '    const evaluate = evaluators[r.id]',
          '    if (!evaluate) {',
          '      // （故意写坏：静默降级 —— 这条规则变成「永不命中」，界面却看不出来）',
          '      return { ...r, kind: narrowKind(r.id, r.kind), evaluate: () => [] }',
          '    }',
        ].join('\n'),
      },
    ],
    expectRed: ['多一条（没有判定函数）之后：载入报错（新增这条路仍然堵着）'],
    // 关键：只坏了「新增」那一侧，删除那一侧不该受影响 ——
    // 否则说明这条断言是靠删除那条顺带变红的假阳性。
    expectGreen: [
      '少一条（删掉「fx2-yiti-lengreshui」）之后：载入不报错',
      '少一条之后：剩下的每一条都还有判定函数（没有一条被悄悄降级）',
    ],
  },
  {
    id: 'M2',
    title: '载入器回到旧规矩：「判定函数有、数据没有」也抛错（删一条就起不来）',
    replacements: [
      {
        from: '  return data.map((r) => {',
        to: [
          '  const dataIds = new Set(data.map((r) => r.id))',
          '  for (const id of Object.keys(evaluators)) {',
          '    if (!dataIds.has(id)) {',
          '      throw new Error(`formulas.ts：判定函数「${id}」没有对应的规则数据。`)',
          '    }',
          '  }',
          '',
          '  return data.map((r) => {',
        ].join('\n'),
      },
    ],
    expectRed: ['少一条（删掉「fx2-yiti-lengreshui」）之后：载入不报错'],
    // 关键：只坏了「删除」那一侧，新增那一侧不该受影响。
    expectGreen: ['多一条（没有判定函数）之后：载入报错（新增这条路仍然堵着）'],
  },
]

/* ------------------------------ 主流程 ------------------------------ */

const originalSource = readFileSync(FORMULAS_TS, 'utf8')
const backupDir = mkdtempSync(join(tmpdir(), 'pulse-break-loader-'))
writeFileSync(join(backupDir, 'formulas.ts'), originalSource, 'utf8')

function restoreSource() {
  writeFileSync(FORMULAS_TS, originalSource, 'utf8')
}

console.log('\n前端装载器 · 删除一条 p44 条目 break-test\n')

try {
  for (const m of MUTATIONS) {
    console.log(`【mutation ${m.id}】${m.title}`)
    const mutated = applyReplacements(originalSource, m.replacements)
    if (!mutated || mutated === originalSource) {
      ok(`mutation ${m.id} 真的改动了源码`, false, '替换片段没对上 —— 规则失效')
      continue
    }
    writeFileSync(FORMULAS_TS, mutated, 'utf8')
    ok(`mutation ${m.id} 真的改动了源码`, true)

    const b = buildCore()
    ok(`mutation ${m.id} 重新编译共享内核成功`, b.code === 0, b.out.slice(-400))

    const { code, out } = runE2E()
    ok(`mutation ${m.id} 跑 e2e 失败（说明写坏了）`, code !== 0, `退出码 ${code}`)

    for (const name of m.expectRed) {
      ok(`mutation ${m.id}｜「${name}」变红`, isRed(out, name), out.slice(-800))
    }
    for (const name of m.expectGreen) {
      ok(`mutation ${m.id}｜「${name}」仍然绿`, isGreen(out, name), out.slice(-800))
    }

    // 还原 —— 必须在下一个 mutation 之前还原，且逐字节核对
    restoreSource()
    const same = readFileSync(FORMULAS_TS, 'utf8') === originalSource
    ok(`mutation ${m.id} 之后源码已还原（逐字节一致）`, same)
    const b2 = buildCore()
    ok(`mutation ${m.id} 之后共享内核已重新编译（产物没留脏）`, b2.code === 0, b2.out.slice(-400))
    console.log('')
  }

  // 全部还原之后，基线必须仍然全绿
  console.log('【基线】还原之后再跑一遍，必须全绿')
  const { code, out } = runE2E()
  ok('还原后前端装载器 e2e 全绿', code === 0, out.slice(-800))
} finally {
  // 无论怎么退出，源码都要还原，并且要把编译产物重新编回正常版
  restoreSource()
  const same = readFileSync(FORMULAS_TS, 'utf8') === originalSource
  ok('退出时源码已还原（逐字节一致）', same)
  const b = buildCore()
  ok('退出时共享内核已重新编译（产物没留脏）', b.code === 0, b.out.slice(-400))
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
