#!/usr/bin/env node
/**
 * 端到端测试：用方知识库 · **网站端运行时编辑**（RE1~RE14）
 *
 * ## 这条链的用户价值
 *
 * 管理员在网站端 ③「用方知识库」里改一条／删一条 ⇒
 *   ① 改动**立刻生效**（③ 显示的、② 命中的、导出的，都跟着变）；
 *   ② **别人也看得见**（知识库是公共资料，所有账号共享一份）；
 *   ③ **改错了能退**（恢复默认／撤销删除）；
 *   ④ **不误伤仓库**（`src/content/*.json` 一个字节都不动）。
 *
 * 所以测的重点不是「接口没报错」，而是：
 *   ① 权限：未登录 401、非管理员 403（**四条写接口都要试**）；
 *   ② 改：字段级改（**只改的那几个字段变了，其余一字不丢**）；
 *   ③ 坏数据：未知字段／枚举非法／必填缺失／改 id ⇒ 逐条 400 ＋ 人话原因；
 *   ④ 删：③ 不再显示、**② 也不再命中**；
 *   ⑤ 墓碑自带**原内容快照** ⇒ 撤销删除后内容一字不差；
 *   ⑥ 级联：删了讲稿方剂 ⇒ p44 的 drugs[] 里不能留悬空引用；
 *   ⑦ **浏览器侧与命令行侧算出的生效集必须一致**（同一个 fixture）；
 *   ⑧ 仓库里的基线文件**逐字节未变**（不自动固化）。
 *
 * 跑法：node scripts/e2e/library-runtime-edit.mjs
 *
 * ⚠️ 全程只在**临时库**上操作，绝不碰仓库里的 src/content/*.json。
 *
 * ⭐ **本文件的编号带 `RE` 前缀**（RE = RuntimeEdit）——
 *    内容层用 `A*`、命令行覆盖层用 `LA*`、前端界面线各有各的脚本表。
 *    完整对照表见 `docs/content-assertions.md`。
 */

import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeChecker, startApi, stripComments, ROOT, runNpm } from './lib.mjs'

/* 浏览器侧的生效集合并（与网站端跑的是同一份代码） */
import { mergeLibrary } from '../../src/domain/library-merge.mjs'
/* 方名标签（chip）的改／删（界面上那两个按钮用的就是它） */
import { removeChip, setChip } from '../../src/domain/library-chips.mjs'
/* 键顺序无关的稳定序列化（比较两个条目用） */
import { stableStringify } from '../../src/domain/library-core.mjs'
/* 命令行侧（`library apply` 用的那套合并） */
import { mergeAll, readBaseline } from '../../server/library-schema.mjs'

const require = createRequire(import.meta.url)

const checker = makeChecker()

async function check(name, fn) {
  const [ok, detail = ''] = await fn()
  checker.check(name, ok, detail)
}

/* ------------------------------------------------------------------ */
/* 共享包（判读规则 ＋ 脉象图）                                          */
/* ------------------------------------------------------------------ */

/**
 * 判读规则与脉象图在 `src/domain/*.ts` 里，是 TypeScript ⇒ 用 `npm run build:core`
 * 编出来的 CommonJS 产物来加载（**不重写一份 JS**）。
 */
const CORE_DIR = join(ROOT, 'miniprogram', 'utils', 'core')
if (!existsSync(join(CORE_DIR, 'domain', 'formulas.js'))) {
  console.log('[RE] 共享包还没编，先跑 build:core …')
  const r = runNpm('build:core')
  if (r.status !== 0) {
    console.error('[RE] build:core 失败：\n' + (r.stdout ?? '') + (r.stderr ?? ''))
    process.exit(1)
  }
}

const coreFormulas = require(join(CORE_DIR, 'domain', 'formulas.js'))
const corePattern = require(join(CORE_DIR, 'domain', 'pulse-pattern.js'))
const corePatterns = require(join(CORE_DIR, 'domain', 'pulse-patterns.js'))
const { evaluateFormulas, loadRulesFrom, FORMULA_RULES } = coreFormulas
const { syntheticContext } = corePattern
const { PATTERNS } = corePatterns

/* ------------------------------------------------------------------ */
/* 现场：临时库 ＋ 基线                                                 */
/* ------------------------------------------------------------------ */

const dir = mkdtempSync(join(tmpdir(), 'pulse-re-'))
const dbFile = join(dir, 're.sqlite')
const multiDb = join(dir, 'multi.sqlite')

/** 仓库里真正的内容文件 —— 测试前后必须逐字节一致（RE12） */
const repoContentDir = join(ROOT, 'src', 'content')
const CONTENT_FILES = readdirSync(repoContentDir).filter((f) => f.endsWith('.json'))
const repoBefore = new Map(CONTENT_FILES.map((f) => [f, readFileSync(join(repoContentDir, f))]))

/** 基线（命令行的 `readBaseline()` 读的也是这一份） */
const baselineFiles = readBaseline()
const baselineRules = baselineFiles['formula-rules.json'].rules
const baselineDrugs = baselineFiles['drugs.json'].drugs

/**
 * 基线的「指纹」—— 用来盯「合并不许就地改掉基线」。
 *
 * ⚠️ 级联（`cascadeCleanup`）是**就地**改 `rule.drugs` 的：
 *   合并结果里没被改动的那批条目**就是基线原对象** ⇒ 不拷贝的话，
 *   「删一个讲稿方剂」会把基线也改脏 ⇒ 刷新前后的知识库不一样。
 */
const baselineStamp = stableStringify([baselineRules, baselineDrugs])

/** 基线里按 id 取一条 */
function baseRule(id) {
  return baselineRules.find((r) => String(r.id) === String(id)) ?? null
}

/* ------------------------------------------------------------------ */
/* HTTP 小工具                                                         */
/* ------------------------------------------------------------------ */

async function http(base, method, path, { token, body } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    /* 不是 JSON */
  }
  return { status: res.status, body: parsed, text }
}

/* ------------------------------------------------------------------ */
/* 起服务                                                              */
/* ------------------------------------------------------------------ */

/** 单机模式：内置本机账号就是管理员（role=admin），写接口直接可用 */
const admin = await startApi({ single: true, db: dbFile })
/** 多用户模式：注册出来的账号是普通用户，用来做 401／403 的断言 */
const multi = await startApi({ single: false, db: multiDb })

/** 注册一个账号，返回 token */
async function register(loginName) {
  const res = await http(multi.base, 'POST', '/api/auth/register', {
    body: { loginName, password: 'pass1234' },
  })
  if (res.status !== 200 || !res.body?.token) {
    throw new Error(`注册「${loginName}」失败：${res.status} ${res.text}`)
  }
  return res.body.token
}

const bossToken = await register('boss_re')
const readerToken = await register('reader_re')

/** 把其中一个账号提成管理员（`users.role` 只有 user／admin 两个值） */
{
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(multiDb)
  db.prepare("UPDATE users SET role = 'admin' WHERE login_name = ?").run('boss_re')
  db.close()
}

/* ------------------------------------------------------------------ */
/* 生效集（浏览器侧那一套）                                            */
/* ------------------------------------------------------------------ */

const kindsRes = await http(admin.base, 'GET', '/api/library/kinds')
const kinds = kindsRes.body?.kinds ?? {}

/** 读覆盖层（服务端返回的原始行） */
async function readOverrides(base, token) {
  const res = await http(base, 'GET', '/api/library/overrides', { token })
  if (res.status !== 200) throw new Error(`读覆盖层失败：${res.status} ${res.text}`)
  return res.body.overrides
}

/** 浏览器侧的生效集：基线 ⊕ 覆盖层 */
function effective(overrides) {
  return mergeLibrary(kinds, overrides, baselineRules, baselineDrugs)
}

/** 生效集里按 id 取一条规则 */
function effRule(eff, id) {
  return eff.ruleData.find((r) => String(r.id) === String(id)) ?? null
}

/* ------------------------------------------------------------------ */
/* RE1 · 未登录                                                       */
/* ------------------------------------------------------------------ */

await check('RE1 未登录：读接口一律 401', async () => {
  for (const p of ['/api/library/overrides', '/api/library/kinds']) {
    const res = await http(multi.base, 'GET', p)
    if (res.status !== 401) return [false, `${p} status=${res.status}`]
  }
  return [true, '']
})

/* ------------------------------------------------------------------ */
/* RE2 · 非管理员写                                                   */
/* ------------------------------------------------------------------ */

await check('RE2 非管理员：四条写接口全部 403', async () => {
  const id = 'fx-dl1-zengye'
  const calls = [
    ['PATCH', `/api/library/entries/rule/${id}`, { patch: { condition: '偷偷改' } }],
    ['DELETE', `/api/library/entries/rule/${id}`, undefined],
    ['POST', `/api/library/entries/rule/${id}/restore`, undefined],
    ['POST', `/api/library/entries/rule/${id}/revive`, undefined],
  ]
  for (const [method, path, body] of calls) {
    const res = await http(multi.base, method, path, { token: readerToken, body })
    if (res.status !== 403) return [false, `${method} ${path} status=${res.status}`]
  }
  // 被拒之后，库里一个字也没变
  const ov = await readOverrides(multi.base, bossToken)
  if (ov.rule?.[id]) return [false, '403 之后却写进去了']
  return [true, '']
})

/* ------------------------------------------------------------------ */
/* RE3 · 字段级改                                                     */
/* ------------------------------------------------------------------ */

const PATCH_ID = 'fx2-jianban-sanjiao'

await check('RE3 管理员改一条：只改了的字段变了，其余字段一字不丢', async () => {
  const before = baseRule(PATCH_ID)
  const res = await http(admin.base, 'PATCH', `/api/library/entries/rule/${PATCH_ID}`, {
    body: { patch: { condition: '变脉有力（网站端改过）' } },
  })
  if (res.status !== 200) return [false, `status=${res.status} ${res.text}`]

  const changed = res.body?.changed
  if (!Array.isArray(changed) || changed.join(',') !== 'condition') {
    return [false, `changed=${JSON.stringify(changed)}`]
  }

  const ov = await readOverrides(admin.base)
  const row = ov.rule?.[PATCH_ID]
  if (!row || row.deleted) return [false, '覆盖层里没有这一行']

  const payload = row.payload ?? {}
  const diff = Object.keys(before).filter(
    (k) => stableStringify(before[k]) !== stableStringify(payload[k]),
  )
  const extra = Object.keys(payload).filter((k) => !(k in before))
  if (diff.join(',') !== 'condition') return [false, `变的字段是「${diff.join(',')}」`]
  if (extra.length > 0) return [false, `凭空多了字段「${extra.join(',')}」`]
  return [true, `只变了 ${diff.join(',')}`]
})

/* ------------------------------------------------------------------ */
/* RE4 · 坏数据                                                       */
/* ------------------------------------------------------------------ */

await check('RE4 未知字段／枚举非法／必填缺失／改 id：逐条 400 ＋ 人话原因', async () => {
  const cases = [
    { patch: { nosuchfield: '瞎写的' }, must: 'nosuchfield' },
    { patch: { kind: '乱写的类别' }, must: 'kind' },
    { patch: { route: '' }, must: 'route' },
    { patch: { id: '换个 id' }, must: 'id' },
  ]
  for (const c of cases) {
    const res = await http(admin.base, 'PATCH', `/api/library/entries/rule/${PATCH_ID}`, {
      body: { patch: c.patch },
    })
    if (res.status !== 400) return [false, `${JSON.stringify(c.patch)} status=${res.status}`]
    const err = String(res.body?.error ?? '')
    if (!err.includes(c.must)) return [false, `${JSON.stringify(c.patch)} 的原因里没有「${c.must}」：${err}`]
  }
  // 被拒的请求一个字也没写进去
  const ov = await readOverrides(admin.base)
  const row = ov.rule?.[PATCH_ID]
  if (!row || row.deleted) return [false, '覆盖层里没有这一行']
  if (row.payload?.condition !== '变脉有力（网站端改过）') {
    return [false, `被拒的请求把内容改了：${row.payload?.condition}`]
  }
  return [true, '']
})

/* ------------------------------------------------------------------ */
/* RE5 · 数组字段（方名）逐项改                                        */
/* ------------------------------------------------------------------ */

const CHIP_ID = 'fx2-yinhuo-jiazi'

await check('RE5 方名标签逐项改／删：生效集里那几项真的变了', async () => {
  const before = baseRule(CHIP_ID)

  // ① 改：界面上「✎」改的是方名数组 → 服务端 PATCH 同一个字段
  const next = before.formulas.slice(0, 2) // 只留「知柏」「羌活」
  const res = await http(admin.base, 'PATCH', `/api/library/entries/rule/${CHIP_ID}`, {
    body: { patch: { formulas: next } },
  })
  if (res.status !== 200) return [false, `status=${res.status} ${res.text}`]

  const ov = await readOverrides(admin.base)
  const eff = effective(ov)
  const hit = effRule(eff, CHIP_ID)
  if (!hit) return [false, '生效集里没有这一条']
  if (stableStringify(hit.formulas) !== stableStringify(next)) {
    return [false, `formulas=${JSON.stringify(hit.formulas)}`]
  }
  // 「添加药」是另一个字段，不该被动到
  if (stableStringify(hit.adds) !== stableStringify(before.adds)) {
    return [false, `adds 也被改了：${JSON.stringify(hit.adds)}`]
  }

  // ② 删：界面上「✕」删掉一项 ⇒ 只少那一项，其余原样
  const afterDel = removeChip(before.formulas, 1)
  if (afterDel.length !== before.formulas.length - 1) {
    return [false, `removeChip 少删/多删了：${JSON.stringify(afterDel)}`]
  }
  if (afterDel[0] !== before.formulas[0] || afterDel.includes(before.formulas[1])) {
    return [false, `removeChip 动到了别的项：${JSON.stringify(afterDel)}`]
  }
  const res2 = await http(admin.base, 'PATCH', `/api/library/entries/rule/${CHIP_ID}`, {
    body: { patch: { formulas: afterDel } },
  })
  if (res2.status !== 200) return [false, `删那项：status=${res2.status} ${res2.text}`]
  const ov2 = await readOverrides(admin.base)
  const hit2 = effRule(effective(ov2), CHIP_ID)
  if (!hit2) return [false, '生效集里没有这一条']
  if (stableStringify(hit2.formulas) !== stableStringify(afterDel)) {
    return [false, `生效集里是 ${JSON.stringify(hit2.formulas)}`]
  }

  // ③ 「✎」改一项：只改那一项，其余原样
  const edited = setChip(before.formulas, 1, '改过的方名')
  if (edited.length !== before.formulas.length) return [false, 'setChip 改动了项数']
  if (edited[1] !== '改过的方名') return [false, `setChip 没改到那一项：${JSON.stringify(edited)}`]
  if (edited[0] !== before.formulas[0] || edited[2] !== before.formulas[2]) {
    return [false, `setChip 动到了别的项：${JSON.stringify(edited)}`]
  }

  return [true, `改：${JSON.stringify(next)}；删：${JSON.stringify(afterDel)}`]
})

/* ------------------------------------------------------------------ */
/* RE6 · 删条目 ⇒ ③ 不显示、② 不命中                                   */
/* ------------------------------------------------------------------ */

const DELETE_ID = 'fx-ssx-yinhuo'

await check('RE6 删条目：③ 不再显示、② 也不再命中', async () => {
  // 先证明「这张图」确实能命中这条 —— 否则用例本身不成立
  const pattern = PATTERNS[DELETE_ID]
  if (!pattern) return [false, '这一条没有脉象图']
  const ctx = syntheticContext(pattern)
  const baselineHit = evaluateFormulas(ctx, FORMULA_RULES).some((h) => h.id === DELETE_ID)
  if (!baselineHit) return [false, '基线里按这张图录脉命不中它 —— 用例不成立']

  const res = await http(admin.base, 'DELETE', `/api/library/entries/rule/${DELETE_ID}`)
  if (res.status !== 200) return [false, `status=${res.status} ${res.text}`]

  const ov = await readOverrides(admin.base)
  const eff = effective(ov)
  if (effRule(eff, DELETE_ID)) return [false, '生效集里还有它']

  // 生效集要装得起来（判定函数有、数据没有 → 跳过，不抛错）
  let rules
  try {
    rules = loadRulesFrom(eff.ruleData)
  } catch (e) {
    return [false, `生效集载入失败：${e.message}`]
  }
  const hits = evaluateFormulas(ctx, rules).map((h) => h.id)
  if (hits.includes(DELETE_ID)) return [false, `它还在命中：${hits.join(',')}`]
  return [true, `命中里有 ${hits.length} 条，都不含它`]
})

/* ------------------------------------------------------------------ */
/* RE7 · 墓碑带原内容快照 ⇒ 撤销删除后一字不差                           */
/* ------------------------------------------------------------------ */

const REVIVE_ID = 'fx-dl1-zengye'

await check('RE7 墓碑自带原内容快照：撤销删除后内容与原条目逐字节相同', async () => {
  const before = baseRule(REVIVE_ID)
  const res = await http(admin.base, 'DELETE', `/api/library/entries/rule/${REVIVE_ID}`)
  if (res.status !== 200) return [false, `status=${res.status} ${res.text}`]

  const ov = await readOverrides(admin.base)
  const tomb = ov.rule?.[REVIVE_ID]
  if (!tomb || tomb.deleted !== true) return [false, '墓碑没写上']
  if (!tomb.payload) return [false, '墓碑里没有原内容快照']
  if (stableStringify(tomb.payload) !== stableStringify(before)) {
    return [false, '墓碑里的快照与原条目不一样'
    ]
  }

  const back = await http(admin.base, 'POST', `/api/library/entries/rule/${REVIVE_ID}/revive`)
  if (back.status !== 200) return [false, `revive status=${back.status} ${back.text}`]

  const ov2 = await readOverrides(admin.base)
  const row = ov2.rule?.[REVIVE_ID]
  if (!row || row.deleted !== false) return [false, '撤销后还是墓碑']
  if (stableStringify(row.payload) !== stableStringify(before)) {
    return [false, '撤销删除后内容与原条目不一致'
    ]
  }
  return [true, '']
})

/* ------------------------------------------------------------------ */
/* RE8 · 恢复默认 ⇒ 回到基线                                            */
/* ------------------------------------------------------------------ */

await check('RE8 恢复默认：撤掉覆盖层这一行，回到基线（逐字节）', async () => {
  const before = baseRule(PATCH_ID)
  const ov0 = await readOverrides(admin.base)
  if (!ov0.rule?.[PATCH_ID]) return [false, '前置条件不成立：这一条没有被改过']

  const res = await http(admin.base, 'POST', `/api/library/entries/rule/${PATCH_ID}/restore`)
  if (res.status !== 200) return [false, `status=${res.status} ${res.text}`]

  const ov = await readOverrides(admin.base)
  if (ov.rule?.[PATCH_ID]) return [false, '覆盖层这一行还在']

  const eff = effective(ov)
  const hit = effRule(eff, PATCH_ID)
  if (!hit) return [false, '生效集里没有这一条']
  if (stableStringify(hit) !== stableStringify(before)) return [false, '没回到基线']
  return [true, '']
})

/* ------------------------------------------------------------------ */
/* RE9 · 删讲稿方剂 ⇒ 级联                                             */
/* ------------------------------------------------------------------ */

await check('RE9 删讲稿方剂：p44 的 drugs[] 级联去掉它，不留悬空引用', async () => {
  const drugId = 'shangjiao-1'
  const beforeRefs = baselineRules.filter((r) => (r.drugs ?? []).includes(drugId)).length
  if (beforeRefs === 0) return [false, '基线里没有条目引用它 —— 用例不成立']

  const res = await http(admin.base, 'DELETE', `/api/library/entries/drug/${drugId}`)
  if (res.status !== 200) return [false, `status=${res.status} ${res.text}`]

  const ov = await readOverrides(admin.base)
  const eff = effective(ov)
  if (eff.drugData.some((d) => String(d.id) === drugId)) return [false, '生效集里还有这个方剂']

  const stillRefs = eff.ruleData.filter((r) => (r.drugs ?? []).includes(drugId))
  if (stillRefs.length > 0) {
    return [false, `还有 ${stillRefs.length} 条引用它：${stillRefs.map((r) => r.id).join(',')}`]
  }
  const dangling = eff.ruleData.filter((r) =>
    (r.drugs ?? []).some((d) => !eff.drugData.some((x) => String(x.id) === String(d))),
  )
  if (dangling.length > 0) {
    return [false, `有悬空引用：${dangling.map((r) => r.id).join(',')}`]
  }
  return [true, `原本有 ${beforeRefs} 条引用它，现在都没了`]
})

/* ------------------------------------------------------------------ */
/* RE10 · 浏览器侧 ＝ 命令行侧                                          */
/* ------------------------------------------------------------------ */

await check('RE10 生效集 ＝ 前端基线 ⊕ 覆盖层：浏览器侧与命令行侧同一组 fixture 结果一致', async () => {
  const changed = baseRule('fx-dl1-zengye')
  const fixture = {
    rule: {
      'fx-dl1-zengye': { payload: { ...changed, condition: '改过的条件' }, deleted: false },
      'fx-dl1-liushen': { payload: null, deleted: true },
    },
    drug: {
      'shangjiao-2': { payload: null, deleted: true },
    },
  }

  const browser = mergeLibrary(kinds, fixture, baselineRules, baselineDrugs)
  const cli = mergeAll(readBaseline(), fixture)

  const rulesSame =
    stableStringify(browser.ruleData) === stableStringify(cli.files['formula-rules.json'].rules)
  const drugsSame =
    stableStringify(browser.drugData) === stableStringify(cli.files['drugs.json'].drugs)
  if (!rulesSame || !drugsSame) {
    return [false, `rules一致=${rulesSame} drugs一致=${drugsSame}`]
  }

  // 合并**不许就地改掉基线** —— 级联是就地改 `rule.drugs` 的，
  // 不拷贝的话浏览器的基线 JSON 会被改脏（刷新前后知识库不一样）。
  const baselineAfter = stableStringify([baselineRules, baselineDrugs])
  if (baselineAfter !== baselineStamp) {
    return [false, '合并把基线就地改掉了']
  }
  return [true, '']
})

await check('RE10 陌生 id（基线里没有的覆盖行）：浏览器侧跳过并报出来，命令行侧报错', async () => {
  const stray = 'zz-not-in-baseline'
  const fixture = {
    rule: {
      [stray]: { payload: { id: stray, route: '瞎写的', condition: '瞎写的' }, deleted: false },
    },
  }

  const browser = mergeLibrary(kinds, fixture, baselineRules, baselineDrugs)
  if (browser.ruleData.some((r) => String(r.id) === stray)) {
    return [false, '浏览器侧把它合进生效集了（前端没有它的判定函数 ⇒ 载入即崩）']
  }
  if (!browser.problems.some((p) => p.includes(stray))) {
    return [false, `浏览器侧没报出来：${JSON.stringify(browser.problems)}`]
  }

  const cli = mergeAll(readBaseline(), fixture)
  if (!cli.errors.some((e) => e.includes(stray))) {
    return [false, `命令行侧没报错：${JSON.stringify(cli.errors)}`]
  }
  return [true, '']
})

/* ------------------------------------------------------------------ */
/* RE11 · 所有账号共享同一份                                           */
/* ------------------------------------------------------------------ */

await check('RE11 所有账号共享同一份：管理员改的，普通账号读到的一样', async () => {
  const id = 'fx-dl2-youcun-da'
  const res = await http(multi.base, 'PATCH', `/api/library/entries/rule/${id}`, {
    token: bossToken,
    body: { patch: { condition: '管理员改过的条件' } },
  })
  if (res.status !== 200) return [false, `管理员改不了：status=${res.status} ${res.text}`]

  const bossOv = await readOverrides(multi.base, bossToken)
  const readerOv = await readOverrides(multi.base, readerToken)
  if (stableStringify(bossOv) !== stableStringify(readerOv)) {
    return [false, '两个账号读到的覆盖层不一样']
  }
  if (readerOv.rule?.[id]?.payload?.condition !== '管理员改过的条件') {
    return [false, '普通账号没读到管理员的改动']
  }
  return [true, '']
})

/* ------------------------------------------------------------------ */
/* RE13 · 非管理员读得到                                               */
/* ------------------------------------------------------------------ */

await check('RE13 非管理员读得到生效集（读不设闸门）', async () => {
  const ovRes = await http(multi.base, 'GET', '/api/library/overrides', { token: readerToken })
  const kindsRes2 = await http(multi.base, 'GET', '/api/library/kinds', { token: readerToken })
  if (ovRes.status !== 200) return [false, `overrides status=${ovRes.status}`]
  if (kindsRes2.status !== 200) return [false, `kinds status=${kindsRes2.status}`]
  const rules = ovRes.body?.overrides?.rule ?? {}
  if (Object.keys(rules).length === 0) return [false, '普通账号读到的是空的']
  return [true, '']
})

/* ------------------------------------------------------------------ */
/* RE12 · 仓库里的基线逐字节未变                                        */
/* ------------------------------------------------------------------ */

await check('RE12 仓库里的 src/content/*.json 逐字节未变（不自动固化）', async () => {
  const changed = CONTENT_FILES.filter(
    (f) => !repoBefore.get(f).equals(readFileSync(join(repoContentDir, f))),
  )
  return [changed.length === 0, changed.join(',')]
})

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* RE14 · 删除／恢复默认的确认走站内确认框（不用 window.confirm）      */
/*                                                                     */
/* ⓘ 为什么这条要单列：                                                 */
/*    `window.confirm` 在 Electron 桌面端会把**整个渲染进程冻住** ——       */
/*    点了「删除」或「恢复默认」，页面就再也不响应，连刷新都救不回来。      */
/*    浏览器里只是弹个框，但同一个代码要跑两种端 ⇒ 一律用站内确认框。      */
/*                                                                     */
/* ⓘ 断言按**结构**解析：先把注释与字符串剥掉再看剩下的代码               */
/*    （不然源码里写着「不用 window.confirm」的注释会把自己判成红的）。     */
/* ------------------------------------------------------------------ */


/** 三个「要问一下再动手」的入口 —— 都要走站内确认框 */
const CONFIRM_SITES = [
  'src/components/FormulaLibrary.tsx',
  'src/components/RuleEditor.tsx',
]

/** 被动面板（不自己弹确认框）—— 但也不许用 window.confirm */
const NO_CONFIRM_SITES = [
  'src/components/LibraryFields.tsx',
  'src/components/PatternPanel.tsx',
  'src/components/PatternStrip.tsx',
]

await check('RE14 删除／恢复默认的确认走站内确认框：不用 window.confirm（不冻住整页）', async () => {
  const problems = []

  for (const rel of CONFIRM_SITES) {
    const abs = join(ROOT, rel)
    if (!existsSync(abs)) {
      problems.push(`${rel} 不存在`)
      continue
    }
    const code = stripComments(readFileSync(abs, 'utf8'))
    if (code.includes('window.confirm')) problems.push(`${rel} 里还有 window.confirm(`)
    if (!code.includes("from './ConfirmDialog'")) problems.push(`${rel} 没有 import ConfirmDialog`)
    if (!code.includes('<ConfirmDialog')) problems.push(`${rel} 没有渲染 <ConfirmDialog>`)
  }

  for (const rel of NO_CONFIRM_SITES) {
    const abs = join(ROOT, rel)
    if (!existsSync(abs)) {
      problems.push(`${rel} 不存在`)
      continue
    }
    if (stripComments(readFileSync(abs, 'utf8')).includes('window.confirm')) {
      problems.push(`${rel} 里还有 window.confirm(`)
    }
  }

  // 确认框本身只有一处（不另发明一套）
  const dlgPath = join(ROOT, 'src/components/ConfirmDialog.tsx')
  if (!existsSync(dlgPath)) {
    problems.push('src/components/ConfirmDialog.tsx 不存在')
  } else {
    const dlg = stripComments(readFileSync(dlgPath, 'utf8'))
    if (!dlg.includes('export function ConfirmDialog')) problems.push('ConfirmDialog.tsx 里没有导出 ConfirmDialog')
    if (!dlg.includes('pr-ps-modal is-confirm')) problems.push('ConfirmDialog.tsx 里没有用确认框自己的样式类')
  }

  return [problems.length === 0, problems.join('；')]
})

await admin.stop()
await multi.stop()
rmSync(dir, { recursive: true, force: true })
process.exit(checker.summary() ? 0 : 1)
