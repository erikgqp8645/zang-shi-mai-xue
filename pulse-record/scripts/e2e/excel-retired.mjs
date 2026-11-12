/**
 * e2e：Excel 管线已彻底退役（M4 · 2026-11-12）
 *
 * ## 这条测试在守什么
 *
 * 用户 2026-11-12 拍板：**「让我们废除掉 excel」**，
 * 数据处理归到后端（本地后台 ＋ 发布管道 ＋ 覆盖层）。
 *
 * Excel 时代的东西**必须真的没了**，不能只是「不推荐用」：
 *   · 双向转换脚本（JSON→Excel / Excel→JSON）
 *   · 人工编辑层本体（两个 .xlsx）
 *   · 练习册与它的验收脚本
 *   · 教人填 Excel 的教程与填写流程图
 *   · package.json 里指向它们的脚本
 *
 * ⚠️ **「还在但不用了」是最坏的状态** —— 下次有人看到 `content:excel`
 * 就会以为那还是条能走的路，重新造一条双管道出来。
 * 所以这里断言的是**文件与脚本真的不存在**。
 *
 * ## 顺带守一件更要紧的事
 *
 * **注册表的字段类型必须与基线数据的真实形状一致。**
 * 2026-11-12 实测发现：`drug.adjustments`（讲稿方剂的「加减」）与
 * `dose.notes`（成方的「附注」）在数据里是**数组**，注册表却登记成
 * `string` ⇒ `library set` 改这些条目时**校验直接失败**，
 * 连改个名字都改不了（12 个方剂 ＋ 10 个成方全中）。
 * 这类「登记类型 ↔ 真实形状」错位，靠人眼是盯不住的 ⇒ 做成断言。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { makeChecker, ROOT } from './lib.mjs'
import { LIBRARY_KINDS } from '../../server/library-schema.mjs'

const { check, summary } = makeChecker()

console.log('\nExcel 退役 · 守卫（2026-11-12 M4）\n')

/* ------------------------------------------------------------------ *
 * 1. 文件层面：Excel 的东西真的没了
 * ------------------------------------------------------------------ */

/** 双向管线 ＋ 练习册 ＋ 教材 ＋ Python 运行器 */
const DELETED_FILES = [
  // 双向转换
  'scripts/excel_from_json.py',
  'scripts/excel_to_json.py',
  'scripts/excel_schema.py',
  // 练习册
  'scripts/make_exercise_workbook.py',
  'scripts/exercise_points.py',
  // 填写流程图（从工作簿渲染出来的）
  'scripts/make_flowchart.py',
  // Python 运行器 —— 删完上面这些就没有 Python 用途了
  'scripts/run-python.mjs',
  // Excel 回归
  'scripts/e2e/excel_roundtrip.py',
  'scripts/e2e/excel_roundtrip_break.py',
  'scripts/e2e/excel_exercise.py',
  'scripts/e2e/excel_exercise_roundtrip.py',
  // 人工编辑层本体
  'content/臧氏脉学-用方知识库.xlsx',
  'content/示例-填写示范.xlsx',
  // 教人填 Excel 的教材
  'docs/教程-如何填写用方知识库.md',
  'docs/填写流程图.html',
]

check(
  'Excel 相关的 15 个文件全部不存在',
  DELETED_FILES.every((f) => !existsSync(join(ROOT, f))),
  DELETED_FILES.filter((f) => existsSync(join(ROOT, f))).join('、'),
)

/** 仓库里不该再有任何 .py / .xlsx（node_modules 不算） */
function scanExtensions(dir, out = []) {
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) scanExtensions(p, out)
    else if (/\.(py|xlsx|xlsm)$/i.test(e.name)) out.push(relative(ROOT, p))
  }
  return out
}

const leftovers = [
  ...scanExtensions(join(ROOT, 'scripts')),
  ...scanExtensions(join(ROOT, 'content')),
  ...scanExtensions(join(ROOT, 'docs')),
  ...scanExtensions(join(ROOT, 'src')),
  ...scanExtensions(join(ROOT, 'server')),
]
check(
  '仓库里再没有 .py / .xlsx（node_modules 除外）',
  leftovers.length === 0,
  leftovers.join('、'),
)

/* ------------------------------------------------------------------ *
 * 2. 脚本层面：package.json 里不能还留着 Excel 的路
 * ------------------------------------------------------------------ */

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const scripts = pkg.scripts ?? {}

const EXCEL_SCRIPTS = [
  'content:excel',
  'content:json',
  'content:check',
  'content:exercise',
  'content:exercise:check',
  'content:flowchart',
  'content:flowchart:check',
  'test:e2e:excel',
  'test:e2e:excel:break',
  'test:e2e:exercise',
]

check(
  'package.json 里没有 Excel 相关的脚本',
  EXCEL_SCRIPTS.every((s) => !(s in scripts)),
  EXCEL_SCRIPTS.filter((s) => s in scripts).join('、'),
)

const testChain = String(scripts.test ?? '')

/**
 * 主链里不能有 Excel 时代的回归脚本。
 *
 * ⚠️ **必须按脚本名精确比对，不能拿子串比** ——
 * `test:e2e:excel` 是 `test:e2e:excel-retired`（**本守卫自己**）的子串，
 * 用正则 `/test:e2e:excel/` 会把自己判成红的（2026-11-12 实测踩过：
 * 守卫进了主链之后立刻自己红，13 项里第 4 项假阳）。
 * ⇒ 先按 `&&` 拆成一条条，再逐条**全等**比对。
 */
const CHAIN_EXCEL_SCRIPTS = ['test:e2e:excel', 'test:e2e:excel:break', 'test:e2e:exercise']
const chainSteps = testChain
  .split('&&')
  // ⚠️ 先 trim 再剥 `npm run ` —— 否则除第一段外每段都带前导空格，
  //    `/^npm run /` 匹配不上（实测：第一段剥掉了，后面 14 段全留着前缀）。
  .map((s) => s.trim().replace(/^npm run /, '').trim())
  .filter(Boolean)
const chainHits = chainSteps.filter((s) => CHAIN_EXCEL_SCRIPTS.includes(s))

check('主测试链里不再有 Excel 回归', chainHits.length === 0, chainHits.join('、') || testChain)

/** 反过来守一句：这个守卫自己必须还在主链里（不然「退役了」就没人证明了） */
check(
  'Excel 退役守卫自己还挂在主测试链上',
  chainSteps.includes('test:e2e:excel-retired'),
  chainSteps.join('、'),
)

check(
  '主测试链仍然在跑内容层与知识库的回归',
  /test:e2e:content/.test(testChain) && /test:e2e:library-admin/.test(testChain),
  testChain,
)

/* ------------------------------------------------------------------ *
 * 3. 引用层面：代码里不能还指着已删的脚本
 * ------------------------------------------------------------------ */

const DEAD_REFS = [
  'excel_to_json',
  'excel_from_json',
  'excel_schema',
  'run-python',
  'make_flowchart',
  'exercise_points',
  'make_exercise_workbook',
  'content:excel',
  'content:json',
  'content:flowchart',
  'content:exercise',
  '臧氏脉学-用方知识库.xlsx',
  '示例-填写示范.xlsx',
]

/** 扫源码里对已删脚本/工作簿的引用（只看代码与配置，不看文档） */
function scanDeadRefs(dir, out = []) {
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue
    // ⚠️ 本文件自己就写着那些名字（要断言它们没了）⇒ 扫自己必然命中 ⇒ 跳过自己
    if (e.name === 'excel-retired.mjs' || e.name === 'excel-retired-break-test.mjs') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      scanDeadRefs(p, out)
      continue
    }
    if (!/\.(ts|tsx|mjs|mts|js|json|sql)$/i.test(e.name)) continue
    let text = ''
    try {
      text = readFileSync(p, 'utf8')
    } catch {
      continue
    }
    for (const ref of DEAD_REFS) {
      if (text.includes(ref)) out.push(`${relative(ROOT, p)} → ${ref}`)
    }
  }
  return out
}

const deadRefs = [
  ...scanDeadRefs(join(ROOT, 'src')),
  ...scanDeadRefs(join(ROOT, 'server')),
  ...scanDeadRefs(join(ROOT, 'scripts')),
]
check('代码里没有对已删脚本/工作簿的引用', deadRefs.length === 0, deadRefs.join('；'))

/* ------------------------------------------------------------------ *
 * 4. 注册表类型 ↔ 基线数据形状（这才是真正会咬人的那条）
 * ------------------------------------------------------------------ */

/** 注册表的类型名 → 真实数据的形状 */
function shapeOf(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return 'array'
    const first = value[0]
    if (Array.isArray(first)) return 'string[][]'
    if (first && typeof first === 'object') return 'object[]'
    return 'string[]'
  }
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'string'
}

/** 注册表类型 → 允许的真实形状（enum／positiveInt／page 都是 string／number 的特例） */
const ALLOWED = {
  string: ['string'],
  enum: ['string'],
  number: ['number'],
  positiveInt: ['number'],
  page: ['number'],
  boolean: ['boolean'],
  'string[]': ['string[]', 'array'],
  'object[]': ['object[]', 'array'],
  'string[][]': ['string[][]', 'array'],
}

const contentDir = join(ROOT, 'src', 'content')
const contentFiles = {}
for (const spec of Object.values(LIBRARY_KINDS)) {
  if (contentFiles[spec.file]) continue
  contentFiles[spec.file] = JSON.parse(readFileSync(join(contentDir, spec.file), 'utf8'))
}

const typeMismatches = []
for (const [kind, spec] of Object.entries(LIBRARY_KINDS)) {
  const container = contentFiles[spec.file]?.[spec.key]
  const entries =
    spec.container === 'object'
      ? Object.entries(container ?? {}).map(([k, v]) => ({ [spec.idField]: k, ...(v && typeof v === 'object' ? v : { [spec.idField]: v }) }))
      : (container ?? [])
  for (const entry of entries) {
    for (const f of spec.fields) {
      const v = entry?.[f.key]
      if (v === undefined || v === null) continue
      const actual = shapeOf(v)
      const allowed = ALLOWED[f.type] ?? []
      if (!allowed.includes(actual)) {
        typeMismatches.push(`${kind} ${entry[spec.idField]}·${f.key} 登记=${f.type} 实际=${actual}`)
      }
    }
  }
}
check(
  '注册表登记的字段类型与基线数据的真实形状一致',
  typeMismatches.length === 0,
  typeMismatches.slice(0, 6).join('；'),
)

/* ------------------------------------------------------------------ *
 * 5. 回归：带数组字段的条目，在命令行里改得动
 * ------------------------------------------------------------------ */

const dir = mkdtempSync(join(tmpdir(), 'pulse-retired-'))
const dbFile = join(dir, 'test.sqlite')

function cli(args) {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'admin.mjs'), 'library', ...args], {
    env: { ...process.env, PULSE_DB: dbFile },
    encoding: 'utf8',
    cwd: ROOT,
  })
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

try {
  // 讲稿方剂「中焦方」的加减是**数组** —— 改它时数组不许被当成文字
  const drug = cli(['set', 'drug', 'zhongjiao', '--set', 'name=中焦方'])
  check(
    '带数组字段（adjustments）的讲稿方剂改得动',
    drug.code === 0,
    drug.out.split('\n').slice(0, 2).join(' | '),
  )

  // 同和堂版成方「六神散」的附注也是**数组**
  const dose = cli(['set', 'dose', 'th-liushen', '--set', 'name=六神'])
  check(
    '带数组字段（notes）的成方改得动',
    dose.code === 0,
    dose.out.split('\n').slice(0, 2).join(' | '),
  )

  // 改完之后数组**不能被压成字符串** —— 那是静默的数据损坏
  const show = cli(['show', 'drug', 'zhongjiao'])
  check(
    '改完之后 adjustments 仍然是数组（没被压成字符串）',
    /"adjustments"\s*:\s*\[/.test(show.out),
    show.out.slice(0, 240),
  )
} finally {
  rmSync(dir, { recursive: true, force: true })
}

/* ------------------------------------------------------------------ *
 * 6. 新内容层还在（Excel 走了，编辑面没跟着没）
 * ------------------------------------------------------------------ */

check(
  '新内容层的命令还在（后台／发布／快照／回滚）',
  ['content:admin', 'content:publish', 'content:snapshot', 'content:rollback', 'content:status'].every(
    (s) => s in scripts,
  ),
  Object.keys(scripts).join('、'),
)

check(
  '内容层的 JSON Schema 都在（每份内容一份）',
  [
    'formula-rules.schema.json',
    'drugs.schema.json',
    'doses.schema.json',
    'formula-reference.schema.json',
    'pulse-patterns.schema.json',
    'pulse-terms.schema.json',
    'pulse-groups.schema.json',
    'symbols.schema.json',
  ].every((f) => existsSync(join(ROOT, 'src', 'content', 'schema', f))),
)

check(
  '仓库快照一份都没少（9 份内容文件）',
  [
    'formula-rules.json',
    'drugs.json',
    'doses.json',
    'formula-reference.json',
    'pulse-patterns.json',
    'pulse-terms.json',
    'pulse-groups.json',
    'symbols.json',
    'library-settings.json',
  ].every((f) => existsSync(join(ROOT, 'src', 'content', f))),
)

process.exit(summary() ? 0 : 1)
