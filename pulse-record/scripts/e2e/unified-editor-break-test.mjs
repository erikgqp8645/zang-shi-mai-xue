#!/usr/bin/env node
/**
 * break-test：证明「统一编辑弹层」那几条断言（UE1~UE11）**不是恒绿**
 *
 * ## 背景
 *
 * 2026-11-12：用户看了两处编辑（③ 的「编辑条目」弹层、方剂卡的「编辑脉象图」弹层）
 * 提了两件事：
 *   ① **归一化** —— 可不可以合并成一个界面，两处都能改；
 *   ② **查重** —— 这两处有没有重复的地方，有就处理。
 *
 * 做完之后最怕的是：断言写成「查文件在不在」「查有没有某个字」这种**恒绿**检查，
 * 看着 31 项全绿，其实改坏了也抓不到。
 *
 * ## 这个脚本干什么
 *
 * 逐个把仓库**故意写坏**，跑一遍 `unified-editor.mjs`，验证：
 *   · 该红的真的红了，而且**红的原因正是那条断言在测的那件事**；
 *   · 不该红的仍然绿（否则就是恒红／恒绿的摆设）。
 *
 * 跑法：node scripts/e2e/unified-editor-break-test.mjs
 *
 * ⚠️ 无论怎么退出，被改的文件都要还原（**逐字节核对**）。
 * ⚠️ **别用会提前掐断管道的命令跑它**（例如 `… | Select-Object -First N`）——
 *    进程被掐掉时 `finally` 来不及执行，文件会**留在写坏的状态**。
 *    要看输出就重定向到文件再看。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const E2E = join(ROOT, 'scripts', 'e2e', 'unified-editor.mjs')

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

/** 某条断言在输出里是红（✗）还是绿（✓） */
function isRed(out, name) {
  return out.includes(`✗ ${name}`)
}
function isGreen(out, name) {
  return out.includes(`✓ ${name}`)
}

/* ------------------------------ mutation ------------------------------ */

/** 统一弹层 */
const EDITOR = 'src/components/RuleEditor.tsx'
/** 脉象图面板（去重都在这一层） */
const PANEL = 'src/components/PatternPanel.tsx'
/** 方剂卡的「脉象图」那一栏（第二个入口） */
const STRIP = 'src/components/PatternStrip.tsx'
/** ③ 知识库（第一个入口） */
const LIB = 'src/components/FormulaLibrary.tsx'
/** 统一弹层的纯逻辑（diff／归一化） */
const PURE = 'src/domain/unified-editor.mjs'

const MUTATIONS = [
  {
    id: 'UEM1',
    title: '有一个入口不再落在「脉象图」页签（从统一弹层里退回去了）',
    files: [
      {
        path: STRIP,
        replacements: [
          {
            from: '            initialTab="pattern"\n            baseline={baseline}',
            to: '            baseline={baseline}',
          },
        ],
      },
    ],
    expectRed: ['UE2 PatternStrip 的两个入口都落在「脉象图」页签（一个都不许漏）'],
    // 关键：第一个入口**不该**受影响 —— 坏的是「第二个入口落在哪个页签」。
    expectGreen: ['UE2 ③ 知识库的「编辑」进统一弹层', 'UE3 弹层里有「条目」「脉象图」两个页签'],
  },
  {
    id: 'UEM2',
    title: '脉象图页又能改出处了（出处变成两处可编 ⇒ 重复回来了）',
    files: [
      {
        path: PANEL,
        replacements: [
          {
            from:
              '  function patchEntry(patch: Partial<PulsePattern>) {\n' +
              '    onChange(value.map((p, i) => (i === active ? { ...p, ...patch } : p)))\n' +
              '  }',
            to:
              '  function patchEntry(patch: Partial<PulsePattern>) {\n' +
              '    onChange(value.map((p, i) => (i === active ? { ...p, ...patch } : p)))\n' +
              '  }\n\n' +
              '  // （故意写坏：脉象图页又能改出处了）\n' +
              "  const _bad = () => patchEntry({ source: '讲义 p44' })",
          },
        ],
      },
    ],
    expectRed: ['UE5 脉象图页**不能**改出处（没有 source 的输入框）'],
    // 关键：只读显示「本图出处」那一条**不该**受影响 —— 它跟「能不能改」是两件事。
    expectGreen: ['UE5 脉象图页只读显示「本图出处」', 'UE5 出处是条目页的注册表字段（label＝「出处」）'],
  },
  {
    id: 'UEM3',
    title: '脉象图页又能编原文了（原文变成两处可编 ⇒ 重复回来了）',
    files: [
      {
        path: PANEL,
        replacements: [
          {
            from:
              '  function patchEntry(patch: Partial<PulsePattern>) {\n' +
              '    onChange(value.map((p, i) => (i === active ? { ...p, ...patch } : p)))\n' +
              '  }',
            to:
              '  function patchEntry(patch: Partial<PulsePattern>) {\n' +
              '    onChange(value.map((p, i) => (i === active ? { ...p, ...patch } : p)))\n' +
              '  }\n\n' +
              '  // （故意写坏：脉象图页又能编原文了）\n' +
              "  const _q = 'quote'",
          },
        ],
      },
    ],
    expectRed: ['UE7 脉象图页没有原文（quote）字段'],
    expectGreen: ['UE7 脉象图页写的是「与原文的出入」，并明说别再抄原文'],
  },
  {
    id: 'UEM4',
    title: '字段级 diff 退化成整条回传（改一个字段，把别的字段也发上去）',
    files: [
      {
        path: PURE,
        replacements: [
          {
            from:
              '  for (const key of Object.keys(draft ?? {})) {\n' +
              '    if (JSON.stringify(draft[key]) !== JSON.stringify((base ?? {})[key])) changed[key] = draft[key]\n' +
              '  }',
            to:
              '  for (const key of Object.keys(draft ?? {})) {\n' +
              '    changed[key] = draft[key]\n' +
              '  }',
          },
        ],
      },
    ],
    expectRed: [
      'UE8 diffEntryFields：只发改了的字段，其余不动',
      'UE8 diffEntryFields：没改就是空对象（不发请求）',
    ],
    // 关键：接口那一层**不该**受影响 —— 坏的是「发出去的是哪几个字段」。
    expectGreen: ['UE8 diffEntryFields：数组字段整体比（多一项就是改了）', 'UE10 一次保存：条目的改动落库了'],
  },
  {
    id: 'UEM5',
    title: '图的归一化不去了空格子（空格子被当成改动 ⇒ 白白发一次请求）',
    files: [
      {
        path: PURE,
        replacements: [
          {
            from:
              '    cells: (p.cells ?? []).filter((c) => (c.codes && c.codes.length > 0) || !!c.term),',
            to: '    cells: (p.cells ?? []),',
          },
        ],
      },
    ],
    expectRed: [
      'UE9 normalizePatterns：去掉空格子（既没符号也没用字）',
      'UE9 patternsChanged：只多了空格子 ⇒ 不算改动',
    ],
    expectGreen: ['UE9 normalizePatterns：没名字的图补默认名', 'UE10 一次保存：脉象图的改动也落库了（两处都存）'],
  },
  {
    id: 'UEM6',
    title: '统一弹层里换回 window.confirm（Electron 桌面端一点按钮就冻住整页）',
    files: [
      {
        path: EDITOR,
        replacements: [
          {
            from: "                  onClick={() => setConfirmRestore('entry')}",
            to:
              "                  onClick={() => {\n" +
              "                    if (!window.confirm('（故意写坏：换回原生 confirm）')) return\n" +
              "                    setConfirmRestore('entry')\n" +
              '                  }}',
          },
        ],
      },
    ],
    expectRed: ['UE11 新组件里没有 window.confirm（原生弹窗会冻住 Electron 整页）'],
    expectGreen: ['UE11 「恢复默认」走站内确认框（ConfirmDialog 只有一处实现）'],
  },
  {
    id: 'UEM7',
    title: '弹层里又多了一个「保存」按钮（两处各存一次 ⇒ 不是「一次提交两处」）',
    files: [
      {
        path: EDITOR,
        replacements: [
          {
            from:
              '            <button type="button" onClick={() => void doSave()} disabled={saving}>\n' +
              "              {saving ? '保存中…' : '保存'}\n" +
              '            </button>',
            to:
              '            <button type="button" onClick={() => void doSave()} disabled={saving}>\n' +
              "              {saving ? '保存中…' : '保存'}\n" +
              '            </button>\n' +
              '            {/* （故意写坏：又多了一个保存按钮） */}\n' +
              '            <button type="button" onClick={() => void doSave()} disabled={saving}>\n' +
              '              保存\n' +
              '            </button>',
          },
        ],
      },
    ],
    expectRed: [
      'UE4 界面上只有一个「保存」按钮',
      'UE4 「保存」标签只有一个（JSX 文字与字符串两种写法都算）',
    ],
    expectGreen: ['UE4 保存时两条接口都发（条目 PATCH ＋ 脉象图 PUT）'],
  },
  {
    id: 'UEM8',
    title: '第一个入口退回旧的独立弹层（又变成两个界面了）',
    files: [
      {
        path: LIB,
        replacements: [
          {
            from: "import { RuleEditor } from './RuleEditor'",
            to: "import { LibraryEditor } from './LibraryEditor'",
          },
        ],
      },
    ],
    expectRed: [
      'UE2 ③ 知识库的「编辑」进统一弹层',
      'UE2 两个入口都不再引旧的独立弹层',
    ],
    // 关键：第二个入口**不该**受影响 —— 坏的是「第一个入口指向哪个弹层」。
    expectGreen: ['UE2 方剂卡的「脉象图 · 编辑」也进同一个弹层（落在脉象图页签）'],
  },
]

/* ------------------------------ 跑 ------------------------------ */

console.log('\n统一编辑弹层 · break-test（证明 UE 断言不是恒绿）\n')

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

    // ② 跑断言：它必须红
    const r = runE2E()
    ok(`${m.id} 断言测试红了（退出码非 0）`, r.code !== 0, `exit=${r.code}`)

    for (const name of m.expectRed) {
      ok(`${m.id} 该红的真的红了：${name}`, isRed(r.out, name), r.out.slice(-1200))
    }
    for (const name of m.expectGreen) {
      ok(`${m.id} 不该红的仍然绿：${name}`, isGreen(r.out, name), r.out.slice(-1200))
    }
  } finally {
    // ③ 还原：文件逐字节还原
    for (const [p, bytes] of backup) {
      writeFileSync(p, bytes)
    }
    // ④ 还原自检：逐字节一致
    let same = true
    for (const [p, bytes] of backup) {
      if (!existsSync(p) || !readFileSync(p).equals(bytes)) same = false
    }
    ok(`${m.id} 还原后逐字节一致`, same)
  }

  // ⑤ 还原后再跑一次：必须全绿
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
