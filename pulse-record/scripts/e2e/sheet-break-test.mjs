#!/usr/bin/env node
/**
 * 「故意写坏」验证 —— **断言本身是不是活的**
 *
 * ## 为什么要有这个
 *
 * 2026-11-07 那次「日期正中间多一条竖线」，上一轮为了修「竖线逐列错开」
 * 把日期/表下拆成了两个 84rpx 半格，**顺手给左半格也画了右线** ——
 * 结果真机上每个日期正中间多出一条竖线。
 *
 * 这类毛病有个要命的特性：**改完立刻「看着对了」**，
 * 而本地探针当时是全绿的（它只量坐标，量不出「多画了一条线」）。
 *
 * ⇒ 光「加断言」不够，还得证明**断言真的能抓到那个坏写法**。
 *    这个脚本就是把源码**故意改坏**，然后要求：
 *      · 对应的 lint 断言**必须红**；
 *      · 对应的几何探针断言**必须红**。
 *
 * ## 它怎么改坏
 *
 * 走**完整链路**：改**源码 SCSS** → 真跑 `taro build --type weapp` →
 * 跑 `taro-lint.mjs`（读源码）＋ `sheet-layout-probe.mjs`（读编译产物）。
 * 不直接改编译产物 —— 否则验的就不是「源码写坏了会不会被抓」，
 * 而是「编译产物被手改会不会被抓」，那是另一回事。
 *
 * ⚠️ **每个 case 都必须真的改动了文件**：mutation 没生效时脚本直接判失败。
 *    否则「什么也没改 → 断言当然不红 → 误判为通过」——
 *    这就是「跳过」被当成「通过」的经典坑。
 *
 * ## 用法
 *
 *   node scripts/e2e/sheet-break-test.mjs
 *
 * 结束时**必定**把源码还原并重新构建（finally 里做，中途出错也还原）。
 * 退出码：0 = 全部 case 都被抓到；1 = 有 case 没被抓到。
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SCSS = join(ROOT, 'taro/src/components/record-sheet/index.scss')
// 备份放临时目录 —— **不放源码目录**：脚本万一被强杀，也不留一个「被打坏」的工程
const BACKUP = join(tmpdir(), 'sheet-break-test-index.scss.bak')

/* ------------------------------------------------------------------ */
/* 改坏的方式：在某个规则块里删/改一条声明                            */
/* ------------------------------------------------------------------ */

/** 从规则块里删掉某条声明（`prop: value;`），留下注释痕迹 */
function dropDecl(src, selector, prop) {
  const re = new RegExp(`(${selector.replace(/\./g, '\\.')}\\s*\\{[^}]*?)\\s*${prop}\\s*:\\s*[^;]+;`)
  if (!re.test(src)) throw new Error(`规则块里找不到 ${prop}：${selector}`)
  return src.replace(re, '$1 /* 故意删掉 */')
}

/** 改规则块里某条声明的值 */
function setDecl(src, selector, prop, value) {
  const re = new RegExp(`(${selector.replace(/\./g, '\\.')}\\s*\\{[^}]*?)\\s*${prop}\\s*:\\s*[^;]+;`)
  if (!re.test(src)) throw new Error(`规则块里找不到 ${prop}：${selector}`)
  return src.replace(re, `$1 ${prop}: ${value};`)
}

/** 在规则块里**加**一条声明 */
function addDecl(src, selector, decl) {
  const re = new RegExp(`(${selector.replace(/\./g, '\\.')}\\s*\\{)`)
  if (!re.test(src)) throw new Error(`找不到规则块：${selector}`)
  return src.replace(re, `$1 ${decl}`)
}

/* ------------------------------------------------------------------ */
/* case 表                                                             */
/* ------------------------------------------------------------------ */

/**
 * expectLint / expectProbe 里放的是**断言名里的一段特征子串** ——
 * 断言名会随文案微调，用特征串比全文匹配稳。
 */
const CASES = [
  {
    id: 'B1',
    title: '日期的左半格又画上了竖线（上一轮那个真凶）',
    mutate: (s) => dropDecl(s, '.pr-thead-date.is-l', 'box-shadow'),
    expectLint: ['左半格不画竖线'],
    expectProbe: ['日期行的**左半格不画竖线**'],
  },
  {
    id: 'B2',
    title: '表下的左半格又画上了竖线',
    mutate: (s) => dropDecl(s, '.pr-tfoot-cell.is-l', 'box-shadow'),
    expectLint: ['左半格不画竖线'],
    expectProbe: ['表下的**左半格不画竖线**'],
  },
  {
    id: 'B3',
    title: '日期的右半格不画组界线了（竖线改回 border）',
    mutate: (s) => setDecl(s, '.pr-thead-date.is-r', 'box-shadow', 'none'),
    expectLint: ['右半格画组界线'],
    expectProbe: ['date：竖线用 inset box-shadow 画'],
  },
  {
    id: 'B4',
    title: '表下的右半格不画组界线了',
    mutate: (s) => setDecl(s, '.pr-tfoot-cell.is-r', 'box-shadow', 'none'),
    expectLint: ['右半格画组界线'],
    expectProbe: ['foot：竖线用 inset box-shadow 画'],
  },
  {
    id: 'B5',
    title: '日期的左半格裁掉了跨格文字（overflow: hidden）',
    mutate: (s) => setDecl(s, '.pr-thead-date.is-l', 'overflow', 'hidden'),
    expectLint: ['不裁**跨格文字'],
    expectProbe: ['左半格**不裁**跨格文字'],
  },
  {
    id: 'B6',
    title: '表下的左半格裁掉了跨格文字（「（未判）」被切成「（未」）',
    mutate: (s) => setDecl(s, '.pr-tfoot-cell.is-l', 'overflow', 'hidden'),
    expectLint: ['不裁**跨格文字'],
    expectProbe: ['左半格**不裁**跨格文字'],
  },
  {
    id: 'B7',
    title: '跨格文字塞不进两格了（字号被调大）',
    mutate: (s) => addDecl(s, '.pr-tfoot-cell-text', 'font-size: 60rpx;'),
    expectLint: [],
    expectProbe: ['跨格文字的**真实字宽**塞得进两格'],
  },
]

/* ------------------------------------------------------------------ */
/* 跑检查                                                             */
/* ------------------------------------------------------------------ */

/** 跑一个命令，把 stdout+stderr 收回来（失败也要拿到输出） */
function run(cmd, args, opts = {}) {
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    })
    return { code: 0, out: stdout }
  } catch (err) {
    return {
      code: typeof err.status === 'number' ? err.status : 1,
      out: `${err.stdout || ''}${err.stderr || ''}`,
    }
  }
}

function buildTaro() {
  const r = run('npx', ['taro', 'build', '--type', 'weapp'], { cwd: join(ROOT, 'taro') })
  if (r.code !== 0) {
    console.log(r.out)
    throw new Error('taro build 失败 —— break-test 中止')
  }
}

/** 一条断言「有没有红」：输出里出现 `✗ <特征串>` */
function assertWentRed(output, feature) {
  return output.includes('✗') && output.includes(feature)
}

/* ------------------------------------------------------------------ */
/* 主流程                                                             */
/* ------------------------------------------------------------------ */

let pass = 0
let fail = 0
const failures = []

const original = readFileSync(SCSS, 'utf8')
copyFileSync(SCSS, BACKUP)

console.log('=== 「故意写坏」验证 —— 断言是不是活的 ===\n')

try {
  for (const c of CASES) {
    const mutated = c.mutate(original)
    // ⚠️ mutation 必须真的改动了文件 —— 否则「没改坏」会被当成「抓到了」
    if (mutated === original) {
      fail++
      failures.push(`${c.id} ${c.title} —— mutation 没改动文件（这条 case 本身是坏的）`)
      console.log(`  ✗ ${c.id} ${c.title} —— mutation 没改动文件`)
      continue
    }
    writeFileSync(SCSS, mutated, 'utf8')

    buildTaro()

    const lint = run(process.execPath, [join(ROOT, 'scripts/e2e/taro-lint.mjs')])
    const probe = run(process.execPath, [join(ROOT, 'scripts/e2e/sheet-layout-probe.mjs')])

    const lintRed = c.expectLint.every((f) => assertWentRed(lint.out, f))
    const probeRed = c.expectProbe.every((f) => assertWentRed(probe.out, f))
    const okAll = lintRed && probeRed

    if (okAll) {
      pass++
      console.log(`  ✓ ${c.id} ${c.title}`)
      console.log(`      lint 红了：${c.expectLint.join(' / ') || '（本 case 不指望 lint）'}`)
      console.log(`      探针红了：${c.expectProbe.join(' / ')}`)
    } else {
      fail++
      const why = []
      if (!lintRed) why.push(`lint 没抓到（期望：${c.expectLint.join(' / ') || '—'}）`)
      if (!probeRed) why.push(`探针没抓到（期望：${c.expectProbe.join(' / ') || '—'}）`)
      failures.push(`${c.id} ${c.title} —— ${why.join('；')}`)
      console.log(`  ✗ ${c.id} ${c.title} —— ${why.join('；')}`)
      // 打印失败那一条的现场，方便定位是「断言没生效」还是「mutation 没生效」
      const hint = (out) =>
        out
          .split('\n')
          .filter((l) => l.includes('✗'))
          .slice(0, 6)
          .join('\n')
      console.log('      lint 失败行：\n' + (hint(lint.out) || '（无 —— lint 反而全绿了）'))
      console.log('      探针失败行：\n' + (hint(probe.out) || '（无 —— 探针反而全绿了）'))
    }
  }
} finally {
  // ⚠️ 无论成败，**必定还原源码并重建** —— 不留一个「被打坏」的工程给用户
  copyFileSync(BACKUP, SCSS)
  buildTaro()
}

console.log('')
console.log(`合计：${CASES.length} 个 case，通过 ${pass}，失败 ${fail}`)
if (fail) {
  console.log('\n失败明细：')
  failures.forEach((f) => console.log(`  · ${f}`))
  console.log('\n⚠️  有断言抓不住对应的坏写法 —— 这条断言是「白测」，得改。')
  process.exit(1)
}
console.log('每个坏写法都被对应的断言抓到了 ✅')
