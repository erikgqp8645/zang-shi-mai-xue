#!/usr/bin/env node
/**
 * break-test：证明「② 定疗法里的方名链接」那几条断言**不是恒绿**
 *
 * ## 背景
 *
 * 2026-11-11：`src/components/TriadFrame.tsx` 的 `TherapyPicker` 里，
 * 整张疗法卡是 `<button>`（点它＝选疗法），卡内的方名又是 `<button>`（点它＝看方剂条目）。
 * button 套 button 是无效 HTML，更要紧的是**点击会冒泡到外层** ——
 * 想查一条方的组成，却顺手把疗法也定了。
 *
 * 修法：内层改成 `<span role="button">` ＋ `e.stopPropagation()`。
 * 对应的断言在 `app-regression.mjs` 的【⑨】段。
 *
 * ## 这个脚本干什么
 *
 * 逐个把源码**故意写坏**，跑一遍网站端浏览器回归，验证：
 *   · 该红的真的红了（写坏必被抓）；
 *   · 不该红的仍然绿（否则就是恒红/恒绿的摆设）。
 *
 * 两个 mutation：
 *   A —— 把内层改回 `<button>` 并去掉 stopPropagation（**完整复现原始 bug**）
 *        期望：嵌套 button 那条红 ＋ 连带选疗法那条红
 *   B —— 保留 `<span>`，只去掉 onClick 里的 stopPropagation（**只剩冒泡这一种坏法**）
 *        期望：连带选疗法那条红，而「没有 button 套 button」**仍然绿**
 *        （B 是关键 —— 它证明「连带选疗法」那条真的在测事件冒泡，
 *          不是靠 A 的嵌套结构顺带变红的）
 *
 * 跑法：node scripts/e2e/app-nested-button-break-test.mjs
 *
 * 需要本机装了 Google Chrome（用 CHROME_PATH 指定可执行文件）。
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TARGET = join(ROOT, 'src', 'components', 'TriadFrame.tsx')
const REGRESSION = join(ROOT, 'scripts', 'e2e', 'app-regression.mjs')

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

/* --------------------------- 源码改动片段 --------------------------- */

/**
 * 内层方名链接那一块（当前修好的版本：span ＋ stopPropagation）。
 * 用正则匹配，行尾差异（CRLF / LF）不影响。
 */
const RE_SPAN_BLOCK =
  /<span\s+role="button"\s+tabIndex=\{0\}\s+className="pr-link pr-link-inline"[\s\S]*?<\/span>/

/** onClick 里的 stopPropagation（第一处；onKeyDown 里那处不在这个模式里） */
const RE_STOP =
  /onClick=\{\(e\) => \{\s*e\.stopPropagation\(\)\s*onOpenFormula\?\.\(link\)\s*\}\}/

/** 改回原始的 button 版（就是修复前的样子） */
const BTN_BLOCK = [
  '<button',
  '                        type="button"',
  '                        className="pr-link"',
  '                        onClick={() => onOpenFormula?.(link)}',
  '                        title={`看「${link.label}」的完整条目　依据：${link.basis}`}',
  '                      >',
  '                        {p.name}',
  '                      </button>',
].join('\n')

/** 去掉 stopPropagation 的 onClick */
const NO_STOP = ['onClick={() => {', '                          onOpenFormula?.(link)', '                        }}'].join(
  '\n',
)

/* ------------------------------ 跑回归 ------------------------------ */

function runRegression() {
  const r = spawnSync(process.execPath, [REGRESSION], {
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
    id: 'A',
    title: '内层改回 <button> 并去掉 stopPropagation（完整复现原始 bug）',
    apply(src) {
      const a = src.replace(RE_SPAN_BLOCK, BTN_BLOCK)
      return a.replace(RE_STOP, NO_STOP)
    },
    expectRed: ['页面上没有 button 套 button', '点方名链接不会连带把疗法选了'],
    expectGreen: [],
  },
  {
    id: 'B',
    title: '保留 <span>，只去掉 onClick 里的 stopPropagation（只剩冒泡这一种坏法）',
    apply(src) {
      return src.replace(RE_STOP, NO_STOP)
    },
    expectRed: ['点方名链接不会连带把疗法选了'],
    // 关键：结构没坏，所以「没有 button 套 button」必须仍然绿 ——
    // 否则说明「连带选疗法」那条是靠着嵌套结构顺带变红的假阳性。
    expectGreen: ['页面上没有 button 套 button'],
  },
]

/* ------------------------------ 主流程 ------------------------------ */

const original = readFileSync(TARGET, 'utf8')
const backupDir = mkdtempSync(join(tmpdir(), 'pulse-break-'))
const backup = join(backupDir, 'TriadFrame.tsx')
writeFileSync(backup, original, 'utf8')

console.log('\n网站端「嵌套 button」break-test\n')

try {
  for (const m of MUTATIONS) {
    console.log(`【mutation ${m.id}】${m.title}`)
    const mutated = m.apply(original)
    if (mutated === original) {
      ok(`mutation ${m.id} 真的改动了源码`, false, 'apply() 之后文件内容一模一样 —— 规则失效')
      continue
    }
    ok(`mutation ${m.id} 真的改动了源码`, true)

    writeFileSync(TARGET, mutated, 'utf8')
    const { code, out } = runRegression()
    const failed = code !== 0
    ok(`mutation ${m.id} 跑回归失败（说明写坏了）`, failed, `退出码 ${code}`)

    for (const name of m.expectRed) {
      ok(`mutation ${m.id}｜「${name}」变红`, isRed(out, name), out.slice(-600))
    }
    for (const name of m.expectGreen) {
      ok(`mutation ${m.id}｜「${name}」仍然绿`, isGreen(out, name), out.slice(-600))
    }

    // 还原 —— 必须在下一个 mutation 之前还原，且逐字节核对
    writeFileSync(TARGET, original, 'utf8')
    const back = readFileSync(TARGET, 'utf8')
    ok(`mutation ${m.id} 之后源码已还原（逐字节一致）`, back === original)
    console.log('')
  }

  // 全部还原之后，基线必须仍然全绿
  console.log('【基线】还原之后再跑一遍，必须全绿')
  const { code, out } = runRegression()
  ok('还原后网站端浏览器回归全绿', code === 0, out.slice(-800))
} finally {
  // 无论怎么退出，源码都要还原
  writeFileSync(TARGET, original, 'utf8')
  const back = readFileSync(TARGET, 'utf8')
  ok('退出时源码已还原（逐字节一致）', back === original)
  rmSync(backupDir, { recursive: true, force: true })
}

console.log(`\n=== 通过 ${pass} ｜ 失败 ${fail} ===`)
if (failures.length) {
  console.log('失败项：')
  for (const f of failures) console.log('  · ' + f)
}
process.exit(fail === 0 ? 0 : 1)
