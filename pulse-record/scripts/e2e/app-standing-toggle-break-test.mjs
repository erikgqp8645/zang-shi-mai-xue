#!/usr/bin/env node
/**
 * break-test：证明「常驻条目开关 ＋ 筛选分组计数口径」那几条断言**不是恒绿**
 *
 * ## 背景
 *
 * 2026-11-12：② 面板「筛选分组」上的两个数字（X条 · Y方）量的是**两套东西** ——
 * 「条」是依脉用方条目数，「方」是讲稿方剂 30 方里的归属数，
 * 放在一起看着永远对不上（「土·脾 10 方」vs 屏上「2 条」）。
 * 于是：chip 改成写明口径（「N 条用方（含常驻 M）」），
 * 并加一个**常驻条目（用药禁忌）开关** —— ② 命中区与③ 用方知识库共用同一个开关。
 *
 * 同日又删掉了 chip 上的「· K 方备查」：那个「方」数的 30 方
 * 当时在② 面板底部**整份又渲染了一遍**（与③ 知识库重复）⇒ 两处一起删。
 * 对应的断言在 `app-regression.mjs` 的【⑩】段与【⑩-补】段。
 *
 * ## 这个脚本干什么
 *
 * 逐个把源码**故意写坏**，跑一遍网站端浏览器回归，验证：
 *   · 该红的真的红了（写坏必被抓）；
 *   · 不该红的仍然绿（否则就是恒红/恒绿的摆设）。
 *
 * 三个 mutation：
 *   F —— ③ 知识库**忽略开关**（常驻条目照列不误）
 *        期望：两条关于③ 的断言变红
 *             （「关掉后③ 知识库的常驻条目也没了」＋「依脉象的禁忌条目不被这个开关藏掉」——
 *               后者在 F 下也红，因为它数的就是③ 里剩下的禁忌条目数），
 *             而「关掉后② 命中区不再列常驻条目」**仍然绿**
 *   G —— ② 命中区**忽略开关**（常驻条目照列不误）
 *        期望：「关掉后② 命中区不再列常驻条目」变红，
 *             而两条关于③ 的断言**仍然绿**
 *   H —— chip 的数字**退回旧口径**（「X条 · Y方」，不写明数的是什么）
 *        期望：两条关于 chip 口径的断言变红，
 *             而「默认显示：② 命中区列着 2 条常驻条目」**仍然绿**
 *             （关键 —— 它证明 chip 那两条不是在靠改数据变红的假阳性）
 *   I —— 口径说明里的强调写成 Markdown 的 `**`（JSX 不解析 ⇒ 页面直接露出两个星号）
 *        期望：「口径说明里没有没渲染的 Markdown」变红，
 *             而开关与计数的几条断言**仍然绿**（只是排版写坏，不是功能坏了）
 *   J —— 把删掉的「讲稿方剂全量」那一节**加回来**（②③ 又重复渲染一遍）
 *        期望：「② 面板里没有『讲稿方剂全量』那一节了」与
 *             「② 里只出现『这次用到』的讲稿方剂」变红，
 *             而「③ 知识库里 30 条讲稿方剂一条不少」「② 的同和堂版成方保留」**仍然绿**
 *
 * ## 为什么要留「依脉象的禁忌条目」这一条断言
 *
 * kind=禁忌 一共 **3** 条，其中只有 **2** 条是常驻（`always`）：
 *   · 三不用（麻黄、黄连、大黄）          —— 常驻，讲稿第一讲
 *   · 上盛用白虎汤／下虚用肾气丸（讲者批评）—— 常驻，讲稿第一讲
 *   · 「寸关浮大，或有顶手的脉 → 下焦方进不去」—— **不常驻**，是依脉象的挡路规则
 * 第三条要是也被这个开关藏掉，「下焦方进不去」这类挡路条件就看不见了 ⇒ 不能藏。
 * 所以断言要能分辨「藏掉的是哪两条」。
 *
 * 跑法：node scripts/e2e/app-standing-toggle-break-test.mjs
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

/** Findings.tsx：② 命中区分组时把常驻条目并进来 */
const RE_PANEL_ALL = /const all = showStanding \? \[\.\.\.formulaHits, \.\.\.standingHits\(\)\] : \[\.\.\.formulaHits\]/

/**
 * FormulaLibrary.tsx：知识库要显示的规则集
 *
 * ⚠️ 2026-11-12 改过一次：过滤条件里多了内容层的「是否显示」
 *    （`isVisible(r)`），常驻条目那一条从 `!r.always` 改成 `!r.always` 的等价写法。
 *    mutation F 只破坏**常驻条目**那半边（`showStanding || !r.always` → 恒真），
 *    可见性那半边留着不动 —— F 测的是「开关」，不是「可见性」。
 */
const RE_VISIBLE_RULES =
  /FORMULA_RULES\.filter\(\(r\) => isVisible\(r\) && \(showStanding \|\| !r\.always\)\)/

/**
 * Findings.tsx：chip 上的数字文案
 *
 * ⚠️ 2026-11-12 改过一次：原来的「N 条用方（含常驻 M）· K 方备查」里那个「K 方」
 * 讲的是**讲稿方剂 30 方**的归属数，而那 30 方当时在② 面板底部又整份渲染了一遍
 * （与③ 知识库重复）⇒ 两处一起删，现在 chip 上只剩一个数字。
 */
const RE_CHIP_NUM = /\{c\.rules\} 条用方\{c\.standing > 0 \? `（含常驻 \$\{c\.standing\}）` : ''\}/

/** Findings.tsx：口径说明里强调「不依脉象的常驻条目」的那句 */
const RE_NOTE_STRONG = /开关只管<strong>不依脉象的常驻条目<\/strong>（三不用／白虎汤·肾气丸）/

/**
 * Findings.tsx：② 面板里「讲稿方剂全量」那一节的锚点（已删）。
 *
 * 用来做 mutation J —— 把这一节**加回来**，验证断言真能抓到重复渲染。
 */
const RE_DRUG_SECTION_ANCHOR =
  /\{\/\*\n            ⭐ 这里原来还有一节「方剂备查（讲稿 2010·第二讲 叁、用方）」/

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
    id: 'F',
    title: '③ 知识库忽略开关（常驻条目照列不误）',
    file: 'library',
    apply(src) {
      // showStanding 为真时本来就是全量；为假时也返回全量 ⇒ 开关在③ 里失效
      // （只破坏常驻条目那半边；可见性那半边留着 —— 那是另一条断言在管的事）
      return src.replace(RE_VISIBLE_RULES, 'FORMULA_RULES.filter((r) => isVisible(r))')
    },
    expectRed: [
      '关掉后③ 知识库的常驻条目也没了（同一个开关）',
      '依脉象的禁忌条目不被这个开关藏掉（挡路条件要留着）',
    ],
    // 关键：② 面板没被动，所以「② 不再列常驻条目」必须仍然绿 ——
    // 否则说明 F 顺手把别处也改了，那两条断言就分不出是谁在起作用。
    expectGreen: ['关掉后② 命中区不再列常驻条目'],
  },
  {
    id: 'G',
    title: '② 命中区忽略开关（常驻条目照列不误）',
    file: 'findings',
    apply(src) {
      return src.replace(RE_PANEL_ALL, 'const all = [...formulaHits, ...standingHits()]')
    },
    expectRed: ['关掉后② 命中区不再列常驻条目'],
    // ③ 没被动 ⇒ 关于③ 的两条必须仍然绿
    expectGreen: [
      '关掉后③ 知识库的常驻条目也没了（同一个开关）',
      '依脉象的禁忌条目不被这个开关藏掉（挡路条件要留着）',
    ],
  },
  {
    id: 'H',
    title: "chip 的数字退回旧口径（不写明数的是什么）",
    file: 'findings',
    apply(src) {
      // 旧口径是「X条 · Y方」；Y（方数）已经随② 那节一起删了，
      // 所以这里只把「条用方（含常驻 M）」打回「X条」。
      return src.replace(RE_CHIP_NUM, '{c.rules}条')
    },
    expectRed: [
      'chip 写明口径（「条用方」），常驻条数单独标出来',
      'chip 上只剩「条用方（含常驻 M）」，没有「· K 方备查」那个数',
      '关掉后 chip 的「条」数正好少掉常驻那几条',
    ],
    // 关键：chip 文案跟数据无关 ⇒ 这三条不该被 H 顺手带红
    expectGreen: ['默认显示：② 命中区列着 2 条常驻条目'],
  },
  {
    id: 'I',
    title: '口径说明里把 <strong> 写回 Markdown 的 **（页面上会露出两个星号）',
    file: 'findings',
    apply(src) {
      // 真实坑：JSX 里的 ** 不是粗体，是字面两个星号 —— 页面上会直接显示出来。
      return src.replace(RE_NOTE_STRONG, '开关只管**不依脉象的常驻条目**（三不用／白虎汤·肾气丸）')
    },
    expectRed: ['口径说明里没有没渲染的 Markdown（** 直接露在页面上）'],
    // 关键：只是排版写坏 ⇒ 开关与计数的断言必须仍然绿
    expectGreen: [
      '默认显示：② 命中区列着 2 条常驻条目',
      '关掉后② 命中区不再列常驻条目',
      '关掉后③ 知识库的常驻条目也没了（同一个开关）',
    ],
  },
  {
    id: 'J',
    title: '把删掉的「讲稿方剂全量」那一节加回来（②③ 又重复了）',
    file: 'findings',
    apply(src) {
      // 2026-11-12 用户问「判读提示和方药知识库是不是重复显示了？」——
      // 重复的就是这一节：② 面板底部整份列讲稿方剂 30 方，③ 知识库里也是这 30 方。
      //
      // ⚠️ 这段代码用了 DRUGS，而 DRUGS 的 import 也被一并删了 ⇒ mutation 必须把 import 一起加回来，
      //    否则 TS 编译失败、回归根本跑不到断言那条（测的就不是东西了）。
      const withImport = src.replace(
        "import { DRUG_BY_ID, type Drug } from '../domain/drugs'",
        "import { DRUG_BY_ID, DRUGS, type Drug } from '../domain/drugs'",
      )
      return withImport.replace(
        RE_DRUG_SECTION_ANCHOR,
        `{/* mutation J：把删掉的那一节加回来 */}
          <section className="pr-formula-group">
            <h3 className="pr-formula-route">方剂备查（讲稿 2010·第二讲 叁、用方）</h3>
            {DRUGS.map((d) => (
              <DrugCard key={d.id} drug={d} />
            ))}
          </section>

          {/*`,
      )
    },
    expectRed: [
      '② 面板里没有「讲稿方剂全量」那一节了',
      '② 里只出现「这次用到」的讲稿方剂，不是全部 30 方（全部那 30 方在③ 里）',
    ],
    // 关键：③ 知识库那一份**本来就在**，不受这次 mutation 影响 ⇒ 必须仍然绿
    expectGreen: [
      '③ 知识库里 30 条讲稿方剂一条不少（没把内容删了，只是换了地方放）',
      '② 的同和堂版成方保留（③ 知识库里没有这一份，不重复）',
      '默认显示：② 命中区列着 2 条常驻条目',
    ],
  },
]

/* ------------------------------ 主流程 ------------------------------ */

const originals = {}
for (const [key, path] of Object.entries(FILES)) {
  originals[key] = readFileSync(path, 'utf8')
}

console.log('\n网站端「常驻条目开关 ＋ 计数口径」break-test\n')

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
    ok('退出时源码已还原（逐字节一致）', back === originals[key])
  }
}

console.log(`\n=== 通过 ${pass} ｜ 失败 ${fail} ===`)
if (failures.length) {
  console.log('失败项：')
  for (const f of failures) console.log('  · ' + f)
}
process.exit(fail === 0 ? 0 : 1)
