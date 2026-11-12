#!/usr/bin/env node
/**
 * break-test：证明「用方知识库 · 网站端运行时编辑」那几条断言**不是恒绿**
 *
 * ## 背景
 *
 * 2026-11-12：管理员可以在网站端 ③「用方知识库」里直接改一条／删一条，
 * 改动落服务端覆盖层（`library_items` 表），**即时生效**。
 *
 * 这条链上有几处「坏法」是**静默**的 —— 写错了不报错，只是知识库悄悄不对了：
 *   · admin 闸门摘掉 ⇒ 普通账号也能改公共资料（而且照样 200）；
 *   · 字段级改写成整条覆盖 ⇒ 改一个字段，别的字段被抹掉；
 *   · 墓碑不写快照 ⇒ 撤销删除放不回来；
 *   · 前端不读生效集 ⇒ 管理员改了，界面还是旧的（看起来一切正常）；
 *   · chip 删不掉 ⇒ 用户以为删了一个标签，实际一个都没删；
 *   · 级联不做 ⇒ 删了讲稿方剂，p44 里留下悬空引用；
 *   · 陌生 id 也照样合并 ⇒ 前端没有它的判定函数 ⇒ 载入即崩。
 *   · 确认框换回 `window.confirm` ⇒ Electron 桌面端点了按钮就冻住整页。
 *
 * ## 这个脚本干什么
 *
 * 逐个把源码**故意写坏**，跑一遍 `library-runtime-edit.mjs`，验证：
 *   · 该红的真的红了（写坏必被抓）；
 *   · 不该红的仍然绿（否则就是恒红／恒绿的摆设）。
 *
 * 跑法：node scripts/e2e/library-runtime-edit-break-test.mjs
 *
 * ⚠️ 无论怎么退出，源码都要还原（逐字节核对）。
 * ⚠️ **别用会提前掐断管道的命令跑它**（例如 `… | head -N`）——
 *    进程被掐掉时 `finally` 来不及执行，源码会**留在写坏的状态**。
 *    要看输出就重定向到文件再看。
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const E2E = join(ROOT, 'scripts', 'e2e', 'library-runtime-edit.mjs')

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

/** 服务端路由（admin 闸门在这里） */
const INDEX = 'server/index.mjs'
/** 服务端服务层（字段级改、墓碑快照在这里） */
const SVC = 'server/library-service.mjs'
/** 浏览器侧的生效集合并 */
const MERGE = 'src/domain/library-merge.mjs'
/** 浏览器侧的方名标签增删改 */
const CHIPS = 'src/domain/library-chips.mjs'
/** 合并与级联的共享纯逻辑 */
const CORE = 'src/domain/library-core.mjs'
/** 知识库条目的编辑弹层（「恢复默认」在这） */
const EDITOR = 'src/components/LibraryEditor.tsx'

const MUTATIONS = [
  {
    id: 'X1',
    title: 'admin 闸门摘掉（普通账号也能改公共资料，而且照样 200）',
    files: [
      {
        path: INDEX,
        replacements: [
          {
            from: '      if (!isAdmin(user)) {',
            to: '      if (false) { // （故意写坏：闸门摘掉）',
          },
        ],
      },
    ],
    expectRed: ['RE2 非管理员：四条写接口全部 403'],
    // 关键：读接口**不受影响** —— 知识库是公共资料，读不设闸门。
    expectGreen: ['RE1 未登录：读接口一律 401', 'RE13 非管理员读得到生效集（读不设闸门）'],
  },
  {
    id: 'X2',
    title: '字段级改写成整条覆盖（改一个字段，别的字段被抹掉）',
    files: [
      {
        path: SVC,
        replacements: [
          {
            from: '  const next = { ...before, ...patch }',
            to: '  const next = { ...patch } // （故意写坏：整条覆盖）',
          },
        ],
      },
    ],
    expectRed: ['RE3 管理员改一条：只改了的字段变了，其余字段一字不丢'],
    // 关键：鉴权与「不自动固化」那两侧**不该**受影响 ——
    // 坏的是「以什么为底」，不是「谁能改」「会不会写进仓库」。
    // （RE4 也会跟着红：整条覆盖之后，缺的是一堆必填字段，
    //   报出来的原因就不是「那个字段不对」了 —— 那是这条坏法连带的，不是独立断言。）
    expectGreen: [
      'RE1 未登录：读接口一律 401',
      'RE12 仓库里的 src/content/*.json 逐字节未变（不自动固化）',
    ],
  },
  {
    id: 'X3',
    title: '墓碑不写原内容快照（撤销删除放不回来）',
    files: [
      {
        path: SVC,
        replacements: [
          {
            from: '  const snapshot = baselineEntryOf(baseline, spec, itemId) ?? ov?.payload ?? eff.entry ?? {}',
            to: '  const snapshot = {} // （故意写坏：墓碑不写快照）',
          },
        ],
      },
    ],
    expectRed: ['RE7 墓碑自带原内容快照：撤销删除后内容与原条目逐字节相同'],
    // 关键：删除本身**不该**受影响 —— 坏的是「能不能放回来」。
    expectGreen: ['RE6 删条目：③ 不再显示、② 也不再命中'],
  },
  {
    id: 'X4',
    title: '前端不读生效集（管理员改了，界面还是内置基线）',
    files: [
      {
        path: MERGE,
        replacements: [
          {
            from: '  const mergedRules = mergeKind(ruleSpec, rules, ruleOv.kept)',
            to: '  const mergedRules = mergeKind(ruleSpec, rules, {}) // （故意写坏：覆盖层不生效）',
          },
          {
            from: '  const mergedDrugs = mergeKind(drugSpec, drugs, drugOv.kept)',
            to: '  const mergedDrugs = mergeKind(drugSpec, drugs, {}) // （故意写坏：覆盖层不生效）',
          },
        ],
      },
    ],
    expectRed: [
      'RE5 方名标签逐项改／删：生效集里那几项真的变了',
      'RE6 删条目：③ 不再显示、② 也不再命中',
      'RE9 删讲稿方剂：p44 的 drugs[] 级联去掉它，不留悬空引用',
      'RE10 生效集 ＝ 前端基线 ⊕ 覆盖层：浏览器侧与命令行侧同一组 fixture 结果一致',
    ],
    // 关键：服务端那一侧**完全没坏** —— 改还是改进去了、删还是删掉了。
    expectGreen: [
      'RE3 管理员改一条：只改了的字段变了，其余字段一字不丢',
      'RE7 墓碑自带原内容快照：撤销删除后内容与原条目逐字节相同',
      'RE12 仓库里的 src/content/*.json 逐字节未变（不自动固化）',
    ],
  },
  {
    id: 'X5',
    title: '方名标签删不掉（用户以为删了一个标签，实际一个都没删）',
    files: [
      {
        path: CHIPS,
        replacements: [
          {
            from: '  return arr.filter((_, j) => j !== i)',
            to: '  return arr.slice() // （故意写坏：删不掉）',
          },
        ],
      },
    ],
    expectRed: ['RE5 方名标签逐项改／删：生效集里那几项真的变了'],
    // 关键：改标签（✎）那一侧**不该**受影响 —— 坏的是「删」。
    expectGreen: ['RE9 删讲稿方剂：p44 的 drugs[] 级联去掉它，不留悬空引用'],
  },
  {
    id: 'X6',
    title: '级联不做（删了讲稿方剂，p44 的 drugs[] 里留下悬空引用）',
    files: [
      {
        path: CORE,
        replacements: [
          {
            from: '      rule.drugs = rule.drugs.filter((d) => String(d) !== String(drugId))',
            to: '      rule.drugs = rule.drugs // （故意写坏：级联不做）',
          },
        ],
      },
    ],
    expectRed: ['RE9 删讲稿方剂：p44 的 drugs[] 级联去掉它，不留悬空引用'],
    // 关键：浏览器侧与命令行侧**共用**这一段级联 ⇒ 两边一起坏 ⇒
    // 「两边一致」那条仍然绿 —— 否则说明 RE10 是靠级联顺带变红的假阳性。
    expectGreen: ['RE10 生效集 ＝ 前端基线 ⊕ 覆盖层：浏览器侧与命令行侧同一组 fixture 结果一致'],
  },
  {
    id: 'X7',
    title: '陌生 id 也照样合并（前端没有它的判定函数 ⇒ 载入即崩）',
    files: [
      {
        path: MERGE,
        replacements: [
          {
            from: '    if (baselineIds.has(id)) kept[id] = row\n    else stray.push(id)',
            to: '    kept[id] = row // （故意写坏：陌生 id 也合并）',
          },
        ],
      },
    ],
    expectRed: ['RE10 陌生 id（基线里没有的覆盖行）：浏览器侧跳过并报出来，命令行侧报错'],
    // 关键：正常条目**不该**受影响 —— 坏的是「陌生 id 怎么处理」。
    expectGreen: ['RE5 方名标签逐项改／删：生效集里那几项真的变了'],
  },
  {
    id: 'X8',
    title: '确认框换回 window.confirm（Electron 桌面端一点按钮就冻住整页）',
    files: [
      {
        path: EDITOR,
        replacements: [
          {
            from: '  async function doRestore() {\n    setConfirmRestore(true)\n  }',
            to: "  async function doRestore() {\n    if (!window.confirm('（故意写坏：换回原生 confirm）')) return\n    setConfirmRestore(true)\n  }",
          },
        ],
      },
    ],
    expectRed: ['RE14 删除／恢复默认的确认走站内确认框：不用 window.confirm（不冻住整页）'],
    // 关键：接口层与基线层**不该**受影响 —— 坏的是「确认这一步怎么问」。
    expectGreen: [
      'RE1 未登录：读接口一律 401',
      'RE12 仓库里的 src/content/*.json 逐字节未变（不自动固化）',
    ],
  },
]

/* ------------------------------ 备份与还原 ------------------------------ */

const originals = new Map()
for (const m of MUTATIONS) {
  for (const f of m.files) {
    const abs = join(ROOT, f.path)
    if (!originals.has(abs)) originals.set(abs, readFileSync(abs, 'utf8'))
  }
}
const backupDir = mkdtempSync(join(tmpdir(), 'pulse-break-re-'))
for (const [abs, content] of originals) {
  writeFileSync(join(backupDir, abs.replace(/[\\/]/g, '_')), content, 'utf8')
}

function restoreAll() {
  for (const [abs, content] of originals) writeFileSync(abs, content, 'utf8')
}

console.log('\n用方知识库 · 网站端运行时编辑 break-test\n')

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
      ok(`mutation ${m.id}｜「${name}」变红`, isRed(out, name), out.slice(-1200))
    }
    for (const name of m.expectGreen) {
      ok(`mutation ${m.id}｜「${name}」仍然绿`, isGreen(out, name), out.slice(-1200))
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
  ok('还原后用方知识库运行时编辑 e2e 全绿', code === 0, out.slice(-1200))
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
