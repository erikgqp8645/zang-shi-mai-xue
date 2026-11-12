#!/usr/bin/env node
/**
 * break-test：证明「知识库显示模式 ＋ 每条是否显示」那几条断言**不是恒绿**
 *
 * ## 背景
 *
 * 2026-11-12 用户在画布上给网站端 ③「用方知识库」标了两处：
 *   · 标注1（分组标题行）：「增加一个选项，不显示这些文字，直接显示内容」
 *   · 标注2（下面每一条）：「这里每一条都可以单独编辑文字和是否显示」
 *
 * 两处都落在**共享层**（用户拍板：改的是所有人看到的原文，不是本机偏好）：
 *   · 分组标题显不显示 → 内容层 `content_library_settings.hide_group_titles`
 *   · 每条显不显示     → 内容层 `content_formula_rules.visible` / `content_drugs.visible`
 *
 * 对应的断言在 `app-regression.mjs` 的【⑪】段。
 *
 * ## 这个脚本干什么
 *
 * 逐个把**数据或源码**故意写坏，跑一遍网站端浏览器回归，验证：
 *   · 该红的真的红了（写坏必被抓）；
 *   · 不该红的仍然绿（否则就是恒红/恒绿的摆设）。
 *
 * 三个 mutation：
 *   K —— **可见性过滤被写坏**（代码里不看 `visible` 了）
 *        ＋数据里把一条标成 `visible=false`
 *        期望：两条关于「visible 的条目不列」的断言变红，
 *             而关于**讲稿方剂**的那条**仍然绿**（它没被动）
 *   M —— **隐藏分组标题被写坏**（代码里恒为 false）
 *        ＋数据里把「知识库显示」设成「隐藏」
 *        期望：「分组标题：共享值是「隐藏」就一个都不渲染」变红，
 *             而「按五行维度下分组标题仍然保留」**仍然绿**
 *   L —— **只改数据、代码一行不动**
 *        （一条 `visible=false` ＋「隐藏分组标题」）
 *        期望：这几条断言**全部仍然绿**
 *        ⭐ 这是最关键的一条：它证明代码**真的在读**内容层的数据 ——
 *           数据说隐藏，界面上就少一条；数据说隐藏标题，标题就消失。
 *           （K／M 证明断言有牙齿，L 证明断言不是摆设。）
 *
 * ## 为什么要「数据 ＋ 代码」一起改
 *
 * 期望值是**从内容 JSON 算出来的**（不写死数字）。
 * 于是：
 *   · 只改代码、数据不动 ⇒ 数字对得上，断言看不出问题（恒绿）；
 *   · 只改数据、代码不动 ⇒ 数字仍对得上，断言仍绿（但代码可能压根没读数据）；
 *   · **两个一起改** ⇒ 数字对不上，断言变红 ⇒ 这才证明断言有鉴别力。
 *
 * 跑法：node scripts/e2e/app-library-display-break-test.mjs
 *
 * 需要本机装了 Google Chrome（用 CHROME_PATH 指定可执行文件）。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const REGRESSION = join(ROOT, 'scripts', 'e2e', 'app-regression.mjs')

/** 会被改写的文件（数据 ＋ 源码） */
const FILES = {
  rules: join(ROOT, 'src', 'content', 'formula-rules.json'),
  settings: join(ROOT, 'src', 'content', 'library-settings.json'),
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

/** FormulaLibrary.tsx：知识库要显示的规则集（带 visible 过滤） */
const RE_VISIBLE_RULES =
  /FORMULA_RULES\.filter\(\(r\) => isVisible\(r\) && \(showStanding \|\| !r\.always\)\)/

/** FormulaLibrary.tsx：分组标题显不显示 */
const RE_HIDE_TITLES = /const hideGroupTitles = LIBRARY_SETTINGS\.hideGroupTitles && dim === 'route'/

/* ------------------------------ 跑回归 ------------------------------ */

function runRegression() {
  const r = spawnSync(process.execPath, [REGRESSION], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return { code: r.status, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}` }
}

/**
 * 清掉上一次跑剩下来的无头 Chrome。
 *
 * ⭐ 为什么必须清：残留的 Chrome 占着 CDP 端口，
 *   下一轮的无头 Chrome 起不来、却能问出**旧页面** ⇒ 回归连上去就卡死
 *   （harness 里也加了「换空闲端口」兜底，但先清干净更省事）。
 */
function cleanupStaleChrome() {
  const p = spawnSync('pgrep', ['-f', 'pulse-chrome-'], { encoding: 'utf8' })
  const pids = (p.stdout ?? '').trim().split('\n').filter(Boolean)
  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGKILL')
    } catch {
      /* 已经退了 */
    }
  }
  return pids.length
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
 *   apply(srcs) → 改写后的文件内容（`{ 键: 内容 }`）
 *   expectRed / expectGreen → 期望变红 / 仍然绿的断言名
 */
const MUTATIONS = [
  {
    id: 'K',
    title: '可见性过滤被写坏（代码不看 visible 了）＋ 数据标了一条隐藏',
    apply(srcs) {
      // 数据：第一条规则标成「不显示」
      const ruleDoc = JSON.parse(srcs.rules)
      ruleDoc.rules[0].visible = false
      // 代码：把 isVisible(r) 那一段去掉 ⇒ 过滤失效。
      //
      // ⚠️ import 必须**一起删** —— 否则 `isVisible` 变成没人用的 import，
      //    TS 报 TS6133、编译失败、回归根本跑不到断言那条（测的就不是东西了）。
      const library = srcs.library
        .replace(RE_VISIBLE_RULES, 'FORMULA_RULES.filter((r) => (showStanding || !r.always))')
        .replace("import { isVisible } from '../domain/visibility'\n", '')
      return { ...srcs, rules: `${JSON.stringify(ruleDoc, null, 2)}\n`, library }
    },
    expectRed: [
      '知识库里渲染的依脉用方条目数 ＝ 内容层里「该显示」的条数（visible=false 的不列）',
      '内容层标了 visible=false 的条目，知识库里一条都不出现',
    ],
    // 关键：讲稿方剂那条没被动 ⇒ 必须仍然绿
    expectGreen: ['知识库里渲染的讲稿方剂数 ＝ 内容层里「该显示」的方数'],
  },
  {
    id: 'M',
    title: '隐藏分组标题被写坏（代码恒为 false）＋ 数据说「隐藏」',
    apply(srcs) {
      const settings = JSON.parse(srcs.settings)
      settings.library.hideGroupTitles = true
      const library = srcs.library.replace(RE_HIDE_TITLES, 'const hideGroupTitles = false')
      return { ...srcs, settings: `${JSON.stringify(settings, null, 2)}\n`, library }
    },
    expectRed: ['分组标题：共享值是「隐藏」就一个都不渲染，是「显示」就照旧渲染'],
    // 关键：按五行那条与「隐藏标题」无关 ⇒ 必须仍然绿
    expectGreen: ['按五行维度下分组标题仍然保留（那是唯一的分组标识，去了就是一堵墙）'],
  },
  {
    id: 'L',
    title: '只改数据、代码一行不动（代码真的在读内容层）',
    apply(srcs) {
      const ruleDoc = JSON.parse(srcs.rules)
      ruleDoc.rules[0].visible = false
      const settings = JSON.parse(srcs.settings)
      settings.library.hideGroupTitles = true
      return {
        ...srcs,
        rules: `${JSON.stringify(ruleDoc, null, 2)}\n`,
        settings: `${JSON.stringify(settings, null, 2)}\n`,
      }
    },
    // ⭐ 全部仍然绿 —— 代码真在读数据（这一条**不该**把回归跑红）
    expectExit: 'pass',
    expectGreen: [
      '知识库里渲染的依脉用方条目数 ＝ 内容层里「该显示」的条数（visible=false 的不列）',
      '内容层标了 visible=false 的条目，知识库里一条都不出现',
      '分组标题：共享值是「隐藏」就一个都不渲染，是「显示」就照旧渲染',
      '显示模式有回显（共享值：已隐藏／显示中）',
    ],
  },
]

/* ------------------------------ 主流程 ------------------------------ */

const originals = {}
for (const [key, path] of Object.entries(FILES)) {
  originals[key] = readFileSync(path, 'utf8')
}

console.log('\n网站端「知识库显示模式 ＋ 每条是否显示」break-test\n')

try {
  const stale = cleanupStaleChrome()
  if (stale) console.log(`（清掉 ${stale} 个上次剩下的无头 Chrome）\n`)

  for (const m of MUTATIONS) {
    console.log(`【mutation ${m.id}】${m.title}`)
    const mutated = m.apply(originals)
    const changed = Object.keys(FILES).filter((k) => mutated[k] !== originals[k])
    if (!changed.length) {
      ok(`mutation ${m.id} 真的改动了东西`, false, 'apply() 之后文件内容一模一样 —— 规则失效')
      continue
    }
    ok(`mutation ${m.id} 真的改动了东西（${changed.join('、')}）`, true)

    for (const [key, path] of Object.entries(FILES)) {
      writeFileSync(path, mutated[key], 'utf8')
    }
    const { code, out } = runRegression()
    // L 是「只改数据」—— 期望回归**仍然全绿**（代码真在读数据）；
    // K／M 是「数据 ＋ 代码都写坏」—— 期望回归红。
    const wantFail = m.expectExit !== 'pass'
    ok(
      `mutation ${m.id} 跑回归${wantFail ? '失败（说明写坏了）' : '仍然全绿（数据改了，代码没坏）'}`,
      wantFail ? code !== 0 : code === 0,
      `退出码 ${code}`,
    )

    for (const name of m.expectRed || []) {
      ok(`mutation ${m.id}｜「${name}」变红`, isRed(out, name), out.slice(-600))
    }
    for (const name of m.expectGreen) {
      ok(`mutation ${m.id}｜「${name}」仍然绿`, isGreen(out, name), out.slice(-600))
    }

    // 还原 —— 必须在下一个 mutation 之前还原，且逐字节核对
    for (const [key, path] of Object.entries(FILES)) {
      writeFileSync(path, originals[key], 'utf8')
    }
    const restored = Object.keys(FILES).every(
      (key) => readFileSync(FILES[key], 'utf8') === originals[key],
    )
    ok(`mutation ${m.id} 之后文件已还原（逐字节一致）`, restored)
    console.log('')
  }

  // 全部还原之后，基线必须仍然全绿
  console.log('【基线】还原之后再跑一遍，必须全绿')
  const { code, out } = runRegression()
  ok('还原后网站端浏览器回归全绿', code === 0, out.slice(-800))
} finally {
  // 无论怎么退出，文件都要还原
  for (const [key, path] of Object.entries(FILES)) {
    writeFileSync(path, originals[key], 'utf8')
    const back = readFileSync(path, 'utf8')
    ok('退出时文件已还原（逐字节一致）', back === originals[key])
  }
}

console.log(`\n=== 通过 ${pass} ｜ 失败 ${fail} ===`)
if (failures.length) {
  console.log('失败项：')
  for (const f of failures) console.log('  · ' + f)
}
process.exit(fail === 0 ? 0 : 1)
