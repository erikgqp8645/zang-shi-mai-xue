#!/usr/bin/env node
/**
 * PostgreSQL 存储层的端到端回归
 *
 * ## 为什么要有这个
 *
 * PG 版的实现（server/db-pg.mjs / server/auth-pg.mjs）与 SQLite 版**语义必须一致** ——
 * 换后端不能改变使用者看到的行为（数据形状、跨用户一律 404、整份覆盖的原子性）。
 *
 * 这份脚本对着**真实 PG** 跑一遍关键路径，逐条断言与 SQLite 版同样的行为。
 *
 * ## 跑法
 *
 *     export PULSE_CB_ENV=ambitious-parrot-d7ehh7x0fd9d680
 *     export PULSE_CB_SECRET_ID=...        # 或用平台注入的 TENCENTCLOUD_SECRETID
 *     export PULSE_CB_SECRET_KEY=...
 *     export PULSE_CB_SESSION_TOKEN=...
 *
 *     PULSE_STORE=pg node scripts/e2e/pg-store.mjs
 *
 * **没有凭证就跳过**（退出码 0）—— 不让没配 PG 的机器跑挂整条测试链。
 */

import { randomBytes } from 'node:crypto'

const hasCreds = Boolean(
  (process.env.PULSE_CB_SECRET_ID || process.env.TENCENTCLOUD_SECRETID) &&
    (process.env.PULSE_CB_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY) &&
    (process.env.PULSE_CB_ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE),
)

if (!hasCreds) {
  // 显式点名要跑 PG 证据（PULSE_STORE=pg 或 PULSE_E2E_REQUIRE=1）时，缺凭证必须**失败**。
  // 以前这里一律 exit(0)，结果 2026-11-06 那次 `pulse_write_medication` 里
  // `jsonb_set(jsonb, text, jsonb)` 的错误一路漏到线上才被发现 —— 回归「全绿」其实一条都没跑。
  const required = process.env.PULSE_STORE === 'pg' || process.env.PULSE_E2E_REQUIRE === '1'
  if (required) {
    console.error('PG 存储回归未执行：缺少 PULSE_CB_* 凭证。')
    console.error('  你显式要求跑 PG（PULSE_STORE=pg / PULSE_E2E_REQUIRE=1），缺凭证不能算通过。')
    console.error('  用法见脚本头部注释；或 unset PULSE_STORE 以跳过。')
    process.exit(1)
  }
  console.log('跳过 PG 存储回归：没有配置 PULSE_CB_* 凭证（见脚本头部用法）')
  process.exit(0)
}

process.env.PULSE_STORE = 'pg'

const store = await import('../../server/store.mjs')

let passed = 0
const failures = []

function check(name, cond, extra) {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(name)
    console.log(`  ✗ ${name}${extra === undefined ? '' : '  —— ' + JSON.stringify(extra)}`)
  }
}

function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected })
}

const suffix = randomBytes(4).toString('hex')
const loginA = `pga${suffix}`
const loginB = `pgb${suffix}`
const PASSWORD = 'pg-test-123456'

console.log('PG 存储回归（环境：' + (process.env.PULSE_CB_ENV || process.env.TCB_ENV) + '）')

/* ------------------------------ 账号 ------------------------------ */

const regA = await store.createUser(null, {
  loginName: loginA,
  displayName: 'PG 甲',
  password: PASSWORD,
})
check('注册甲账号', !regA.error && !!regA.user?.id, regA)

const regB = await store.createUser(null, {
  loginName: loginB,
  displayName: 'PG 乙',
  password: PASSWORD,
})
check('注册乙账号', !regB.error && !!regB.user?.id, regB)

const dup = await store.createUser(null, { loginName: loginA, password: PASSWORD })
eq('重复登录名被拒', dup.error, 'login_name_taken')

const bad = await store.authenticate(null, loginA, 'wrong-password')
eq('密码错 → bad_credentials', bad.error, 'bad_credentials')

const ok = await store.authenticate(null, loginA, PASSWORD)
check('密码对 → 登录成功', !ok.error && ok.user?.loginName === loginA, ok)

const token = await store.createSession(null, regA.user.id, 'pg-regression')
check('签发会话令牌', typeof token === 'string' && token.length > 20)

const who = await store.getSessionUser(null, token)
check('用令牌取回用户', who?.id === regA.user.id, who)

const ownerA = regA.user.id
const ownerB = regB.user.id

/* ------------------------------ 患者 ------------------------------ */

const values = { 'L|寸|浮': ['+'], 'R|寸|沉': ['↑'], 'L|关|中': ['X'] }
const saved = await store.putPatient(null, ownerA, {
  name: 'PG 测试患者',
  layout: 'nine',
  visits: [
    { label: '第一次', at: 1700000000000, values, constitution: '肾虚', therapy: '三焦疗法' },
    { label: '第二次', at: 1700000100000, values: { 'L|寸|浮': ['++'] } },
  ],
  medications: [
    { name: '清挡路', pulse: '', symbols: { 'L|寸|浮': ['+'] }, adjust: '', usage: '一日两次', note: '' },
  ],
})
check('存患者成功', !!saved?.id, saved)
eq('患者姓名', saved.name, 'PG 测试患者')
eq('体例', saved.layout, 'nine')
eq('就诊次数', saved.visits.length, 2)
eq('脉象格值形状（每格一个数组）', saved.visits[0].values['L|寸|浮'], ['+'])
eq('脉象格值形状（↑）', saved.visits[0].values['R|寸|沉'], ['↑'])
eq('体质', saved.visits[0].constitution, '肾虚')
eq('疗法', saved.visits[0].therapy, '三焦疗法')
eq('第二次不继承体质（未填就是 null）', saved.visits[1].constitution, null)

const fetched = await store.getPatient(null, saved.id, ownerA)
check('按 id 取回患者', fetched?.id === saved.id, fetched)
eq('取回后格值一致', fetched.visits[0].values['L|寸|浮'], ['+'])

/* --------------------------- 整份覆盖语义 --------------------------- */

const visitId = saved.visits[0].id
const secondVisitId = saved.visits[1].id
const updated = await store.putPatient(null, ownerA, {
  id: saved.id,
  name: 'PG 测试患者',
  layout: 'nine',
  visits: [{ id: visitId, label: '第一次（改过）', at: 1700000000000, values }],
  medications: [],
})
eq('整份覆盖：删掉了没传的第二次就诊', updated.visits.length, 1)
eq('整份覆盖：保留下来的那次改了标签', updated.visits[0].label, '第一次（改过）')

const medsAfter = await store.listMedication(null, saved.id, ownerA)
eq('整份覆盖：用药也被清空', medsAfter.length, 0)

/* --------------------------- 体例只改体例 --------------------------- */

const layoutChanged = await store.updatePatientLayout(null, saved.id, ownerA, 'seven')
eq('改体例生效', layoutChanged.layout, 'seven')
eq('改体例不动格值', layoutChanged.visits[0].values['L|寸|浮'], ['+'])
const layoutBack = await store.updatePatientLayout(null, saved.id, ownerA, 'nine')
eq('体例改回去', layoutBack.layout, 'nine')

/* ------------------------------ 搜索 ------------------------------ */

const list = await store.listPatients(null, ownerA)
check('患者列表含本人患者', list.some((p) => p.id === saved.id), list)
eq('列表元素形状', Object.keys(list[0] ?? {}).sort(), ['at', 'id', 'layout', 'name', 'visitCount'])

const byName = await store.searchPatients(null, 'PG 测试', ownerA)
check('按姓名搜到', byName.some((p) => p.id === saved.id), byName)
eq('搜索命中类型', byName.find((p) => p.id === saved.id)?.matchType, 'name')

const bySymbol = await store.searchPatients(null, '↑', ownerA)
check('按脉象符号搜到', bySymbol.some((p) => p.id === saved.id), bySymbol)
eq('符号命中类型', bySymbol.find((p) => p.id === saved.id)?.matchType, 'visit')

const noHit = await store.searchPatients(null, '不存在的关键字zzz', ownerA)
eq('搜不到就是空', noHit.length, 0)

/* ---------------------------- 跨用户隔离 ---------------------------- */

const cross = await store.getPatient(null, saved.id, ownerB)
eq('跨用户取患者 → null（当作不存在，不是 403）', cross, null)
const crossVisit = await store.getVisit(null, visitId, ownerB)
eq('跨用户取就诊 → null', crossVisit, null)
const crossList = await store.listPatients(null, ownerB)
eq('跨用户看不到别人的患者', crossList.some((p) => p.id === saved.id), false)
const crossDelete = await store.deletePatient(null, saved.id, ownerB)
eq('跨用户删不掉别人的患者', crossDelete, false)

/* --------------------------- 单次编辑 --------------------------- */

const patched = await store.putVisit(null, visitId, ownerA, {
  label: '单次改过',
  values: { 'L|寸|浮': ['±'] },
  constitution: '上盛下虚',
})
check('单次编辑成功', !!patched, patched)
eq('单次编辑改了标签', patched.label, '单次改过')
eq('单次编辑改了格值', patched.values['L|寸|浮'], ['±'])
eq('单次编辑改了体质', patched.constitution, '上盛下虚')

const cleared = await store.putVisit(null, visitId, ownerA, { constitution: null })
eq('体质可清空（传 null）', cleared.constitution, null)
eq('没传的键保持原值', cleared.therapy, null)

/* ---------------------------- 自定义符号 ---------------------------- */

const sym = await store.putCustomSymbol(null, ownerA, { code: 'S', name: '涩' })
eq('新增自定义符号', sym, { code: 'S', name: '涩' })
const syms = await store.listCustomSymbols(null, ownerA)
check('符号清单含 S', syms.some((s) => s.code === 'S'), syms)
const renamed = await store.putCustomSymbol(null, ownerA, { code: 'S', name: '涩脉' })
eq('改名', renamed.name, '涩脉')
eq('固定符号不能占用', await store.putCustomSymbol(null, ownerA, { code: '+', name: '重复' }), null)
const otherSyms = await store.listCustomSymbols(null, ownerB)
eq('符号按人隔离', otherSyms.some((s) => s.code === 'S'), false)
eq('删除自定义符号', await store.deleteCustomSymbol(null, 'S', ownerA), true)

/* ------------------------------ 清理 ------------------------------ */

eq('删患者', await store.deletePatient(null, saved.id, ownerA), true)
eq('删完取不到', await store.getPatient(null, saved.id, ownerA), null)

/**
 * 把两个测试账号删掉 —— **对着真库跑回归不能留垃圾**。
 *
 * 之前每次跑都留下两个账号（pga×××× / pgb××××），几个回合下来云端 PG 里
 * 攒了一堆「PG 甲」「PG 乙」。这里用管理员通道直接删（外键 ON DELETE CASCADE
 * 会把它们的患者、就诊、用药、会话一起带走）。
 *
 * 删不掉不算失败 —— 回归本身已经跑完了；但要**说清楚**，不能默默留着。
 */
try {
  const { execSql } = await import('../pg-admin.mjs')
  const res = await execSql(
    `DELETE FROM users WHERE login_name IN ('${loginA}', '${loginB}')`,
  )
  // 注意：ExecutePGSql **不回传 RETURNING 的行**，只看影响行数
  const n = Number(res.affected ?? 0)
  console.log(`  ✓ 测试账号已清理：删掉 ${n} 个（${loginA} / ${loginB}）`)
  if (n < 2) console.log('    ⚠ 删掉的比预期少 —— 可能之前就没删干净，顺手查一下')
} catch (e) {
  console.log(
    `  ⚠ 测试账号没清掉（${loginA} / ${loginB}）：${e?.message ?? e}\n` +
      '    管理员通道需要 TCLOUD_SECRET_ID / TCLOUD_SECRET_KEY（或 PULSE_CB_*）—— 手工删一下：',
  )
  console.log(`    DELETE FROM users WHERE login_name IN ('${loginA}', '${loginB}')`)
}

/* ------------------------------ 结论 ------------------------------ */

console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`)
if (failures.length) {
  console.error('失败项：\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
