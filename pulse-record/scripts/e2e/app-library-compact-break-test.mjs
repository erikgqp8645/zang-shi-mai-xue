#!/usr/bin/env node
/**
 * break-test：证明「用方知识库紧凑态」那几条断言**不是恒绿**
 *
 * ## 背景
 *
 * 2026-11-12：「用方知识库」改成**紧凑一行一条** —— 去掉 kind 徽章（主线／挡路／加味／禁忌），
 * 折叠时只留「标题 ｜ 疗法 ｜ 方名」，点开才出脉象图／原文／方剂卡。
 * 对应的断言在 `app-regression.mjs` 的【⑧-补】段 ＋【⑧】段两条「落点自动展开」。
 *
 * ## 这个脚本干什么
 *
 * 逐个把源码**故意写坏**，跑一遍网站端浏览器回归，验证：
 *   · 该红的真的红了（写坏必被抓）；
 *   · 不该红的仍然绿（否则就是恒红/恒绿的摆设）。
 *
 * 三个 mutation：
 *   C —— 紧凑行里**加回 kind 徽章**
 *        期望：「知识库里不再出现 kind 徽章」变红，
 *             而「② 命中区仍带 kind 徽章」**仍然绿**
 *             （关键 —— 它证明「知识库无徽章」那条真的在测知识库，
 *               不是靠 C 顺手把命中区一起改了顺带变红的假阳性）
 *   D —— 去掉 FormulaLibrary 里的两个 `autoOpen`（**落点不再自动展开**）
 *        期望：两条「落点自动展开」都变红
 *   E —— 只去掉 `useEffect` 里跟随 autoOpen 展开的那段（**保留 useState 初值**）
 *        期望：「讲稿方剂落点那一条也自动展开」变红，
 *             而「落点那一条自动展开」**仍然绿**
 *             （E 是关键 —— 它复现 2026-11-12 真的踩过的坑：
 *               知识库整块渲染，30 个方剂条目挂上去时 autoOpen 还是 false，
 *               后来焦点才移到那一条，`useState` 初值不会再读一遍 ⇒ 落点是折着的。
 *               规则条目那条之所以不受影响，是因为它是**第一次跳转时新挂载**的，
 *               初值恰好读到了 true。
 *               E 不红，就说明「讲稿方剂落点自动展开」那条是摆设。）
 *
 * 跑法：node scripts/e2e/app-library-compact-break-test.mjs
 *
 * 需要本机装了 Google Chrome（用 CHROME_PATH 指定可执行文件）。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const REGRESSION = join(ROOT, 'scripts', 'e2e', 'app-regression.mjs')

/** 会被改写的源文件 */
const FILES = {
  findings: join(ROOT, 'src', 'components', 'Findings.tsx'),
  library: join(ROOT, 'src', 'components', 'FormulaLibrary.tsx'),
}

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

/** 紧凑行的标题 —— 只有 FormulaItem 的紧凑态用它（定位唯一） */
const RE_ROW_TITLE =
  /<strong className="pr-formula-row-title">\{hit\.condition\}<\/strong>/

/** 跟随 autoOpen 展开的那段 useEffect（FormulaItem 与 DrugCard 各一处） */
const RE_AUTOOPEN_EFFECT =
  /useEffect\(\(\) => \{\s*if \(autoOpen\) setOpen\(true\)\s*\}, \[autoOpen\]\)\n/g

/**
 * 写坏版：**留一个空壳**，不展开。
 * ⚠️ 不能整段删掉 —— 删了 `useEffect` 的 import 就没人用了，
 * TS 会报 TS6133，**编译直接失败**，回归根本跑不到断言那条 ⇒ 测的不是东西。
 */
const BROKEN_AUTOOPEN_EFFECT =
  'useEffect(() => {\n    /* 故意写坏：不跟随 autoOpen 展开 */\n  }, [autoOpen])\n'

/** FormulaLibrary 里两个 autoOpen 属性 */
const RE_AUTOOPEN_RULE = /\s*\n\s*autoOpen=\{focusId === formulaAnchor\('rule', r\.id\)\}/
const RE_AUTOOPEN_DRUG = /\s*\n\s*autoOpen=\{focusId === formulaAnchor\('drug', d\.id\)\}/

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

/**
 * 每个 mutation：
 *   apply(src) → 改写后的源码（src 是该文件当前内容）
 *   file       → 改哪个文件
 *   expectRed / expectGreen → 期望变红 / 仍然绿的断言名
 */
const MUTATIONS = [
  {
    id: 'C',
    title: '紧凑行里加回 kind 徽章',
    file: 'findings',
    apply(src) {
      return src.replace(
        RE_ROW_TITLE,
        '<span className="pr-formula-kind">{hit.kind}</span>\n          <strong className="pr-formula-row-title">{hit.condition}</strong>',
      )
    },
    expectRed: ['知识库里不再出现 kind 徽章（主线／挡路／加味／禁忌）'],
    // 关键：命中区没被动，所以「命中区仍带徽章」必须仍然绿 ——
    // 否则说明「知识库无徽章」那条是靠 C 顺手改了别处才变红的假阳性。
    expectGreen: ['② 命中区仍带 kind 徽章（只改知识库，没把命中区一起改掉）'],
  },
  {
    id: 'D',
    title: '去掉两个 autoOpen（落点不再自动展开）',
    file: 'library',
    apply(src) {
      return src.replace(RE_AUTOOPEN_RULE, '').replace(RE_AUTOOPEN_DRUG, '')
    },
    expectRed: [
      '落点那一条自动展开（不用再点一下才看得到脉象图）',
      '讲稿方剂落点那一条也自动展开',
    ],
    expectGreen: [],
  },
  {
    id: 'E',
    title: '只去掉跟随 autoOpen 展开的 useEffect（保留 useState 初值）',
    file: 'findings',
    apply(src) {
      return src.replace(RE_AUTOOPEN_EFFECT, BROKEN_AUTOOPEN_EFFECT)
    },
    expectRed: ['讲稿方剂落点那一条也自动展开'],
    // 规则条目那条是**第一次跳转时新挂载**的，初值恰好读到了 true ⇒ 仍然绿。
    // 这正是 2026-11-12 真的踩过的那个坑：E 不红，说明方剂那条断言是摆设。
    expectGreen: ['落点那一条自动展开（不用再点一下才看得到脉象图）'],
  },
]

/* ------------------------------ 主流程 ------------------------------ */

const originals = {}
for (const [key, path] of Object.entries(FILES)) {
  originals[key] = readFileSync(path, 'utf8')
}

console.log('\n网站端「用方知识库紧凑态」break-test\n')

try {
  for (const m of MUTATIONS) {
    console.log(`【mutation ${m.id}】${m.title}`)
    const mutated = m.apply(originals[m.file])
    if (mutated === originals[m.file]) {
      ok(`mutation ${m.id} 真的改动了源码`, false, 'apply() 之后文件内容一模一样 —— 规则失效')
      continue
    }
    ok(`mutation ${m.id} 真的改动了源码`, true)

    writeFileSync(FILES[m.file], mutated, 'utf8')
    const { code, out } = runRegression()
    ok(`mutation ${m.id} 跑回归失败（说明写坏了）`, code !== 0, `退出码 ${code}`)

    for (const name of m.expectRed) {
      ok(`mutation ${m.id}｜「${name}」变红`, isRed(out, name), out.slice(-600))
    }
    for (const name of m.expectGreen) {
      ok(`mutation ${m.id}｜「${name}」仍然绿`, isGreen(out, name), out.slice(-600))
    }

    // 还原 —— 必须在下一个 mutation 之前还原，且逐字节核对
    writeFileSync(FILES[m.file], originals[m.file], 'utf8')
    const back = readFileSync(FILES[m.file], 'utf8')
    ok(`mutation ${m.id} 之后源码已还原（逐字节一致）`, back === originals[m.file])
    console.log('')
  }

  // 全部还原之后，基线必须仍然全绿
  console.log('【基线】还原之后再跑一遍，必须全绿')
  const { code, out } = runRegression()
  ok('还原后网站端浏览器回归全绿', code === 0, out.slice(-800))
} finally {
  // 无论怎么退出，源码都要还原
  for (const [key, path] of Object.entries(FILES)) {
    writeFileSync(path, originals[key], 'utf8')
    const back = readFileSync(path, 'utf8')
    ok(`退出时源码已还原（逐字节一致）`, back === originals[key])
  }
}

console.log(`\n=== 通过 ${pass} ｜ 失败 ${fail} ===`)
if (failures.length) {
  console.log('失败项：')
  for (const f of failures) console.log('  · ' + f)
}
process.exit(fail === 0 ? 0 : 1)
