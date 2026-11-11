#!/usr/bin/env node
/**
 * 内容层 · 远端断言（A5／A6／A7）
 *
 * ## 跑什么
 *
 * | 断言 | 抓什么 |
 * |---|---|
 * | **A5** | 远端 PG 的行 → content 包 → 再算回行，**逐字段无损**；且 API 拿到的包 == 远端算出的包 |
 * | **A6** | 发布事务失败时，远端**保持原状**（绝不半套） |
 * | **A7** | 发布**幂等**：同一份内容连发两次，远端结果一致 |
 *
 * ## 为什么不在 `npm test` 里
 *
 * 它要**真连远端 PG** ⇒ 必须有凭证 ⇒ 跑不了就是跑不了，不能假装通过。
 *
 * ⚠️ **「跳过」必须与「通过」区分开**（本仓库吃过这个亏：
 *   `pg-store.mjs` 以前缺凭证就静默 `exit(0)`，测试显示「通过」但一条断言都没跑）。
 *   所以：缺凭证 ⇒ 明确打印「跳过」并 `exit 0`；
 *   显式点名要跑（`PULSE_E2E_REQUIRE=1`）时缺凭证 ⇒ **exit 1**。
 *
 * ## 用法
 *
 *     node scripts/cb-credentials.mjs -- node scripts/e2e/content-pg.mjs
 *
 *     # 或者手动设环境变量：
 *     export PULSE_CB_SECRET_ID=... PULSE_CB_SECRET_KEY=... PULSE_CB_SESSION_TOKEN=...
 *     export PULSE_CB_ENV=pulse-1-d0g880ydl8ddc57f6
 *     node scripts/e2e/content-pg.mjs
 *
 * ## ⭐ 它会写远端
 *
 * A7 要连发两次（内容不变，只是版本号 +2、账本多两行）。
 * A6 发的是**必然失败**的载荷 ⇒ 事务回滚 ⇒ 不改任何数据。
 */

import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildContentFromRows,
  buildRows,
  canonicalJson,
  tableDefs,
} from '../../server/content-schema.mjs'
import { readContent } from '../../server/content-pg.mjs'
import { rpc } from '../../server/pg-client.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')

/* ------------------------------ 结果收集 ------------------------------ */

const results = []

function pass(id, msg) {
  results.push({ ok: true, id, msg })
  console.log(`  ✓ [${id}] ${msg}`)
}

function fail(id, msg) {
  results.push({ ok: false, id, msg })
  console.log(`  ✗ [${id}] ${msg}`)
}

function skip(msg) {
  console.log(`  — 跳过：${msg}`)
}

/* ------------------------------ 工具 ------------------------------ */

/** 有没有凭证 */
function hasCredentials() {
  return Boolean(
    (process.env.PULSE_CB_SECRET_ID && process.env.PULSE_CB_SECRET_KEY) ||
      (process.env.TENCENTCLOUD_SECRETID && process.env.TENCENTCLOUD_SECRETKEY),
  )
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/** 读远端的行 ＋ 版本状态 */
async function readRemote() {
  const order = tableDefs().map((d) => d.table)
  const res = await rpc('content_read', { p_owner: '', p_args: { order } })
  const state = await rpc('content_state_get', { p_owner: '', p_args: {} })
  return { rows: res?.tables ?? {}, state }
}

/** 两份行集合是否逐字段一致（按列类型归一化后比） */
function rowsEqual(defs, a, b) {
  for (const def of defs) {
    const ra = a[def.table] || []
    const rb = b[def.table] || []
    if (ra.length !== rb.length) return `${def.table} 行数不同（${ra.length} vs ${rb.length}）`
    for (let i = 0; i < ra.length; i += 1) {
      for (const c of def.columns) {
        const va = ra[i][c.name] ?? null
        const vb = rb[i][c.name] ?? null
        if (va === vb) continue
        const same =
          (c.type === 'json' &&
            JSON.stringify(canonicalJson(parseMaybe(va))) ===
              JSON.stringify(canonicalJson(parseMaybe(vb)))) ||
          (c.type === 'bool' && Boolean(va) === Boolean(vb))
        if (same) continue
        return `${def.table}.${c.name} 第 ${i + 1} 行不同（${JSON.stringify(va)} vs ${JSON.stringify(vb)}）`
      }
    }
  }
  return null
}

function parseMaybe(v) {
  if (typeof v !== 'string') return v
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}

/* ------------------------------ 断言 ------------------------------ */

async function assertStructure() {
  console.log('\n[结构] 内容层的表与函数在位')
  const defs = tableDefs()
  const order = defs.map((d) => d.table)
  try {
    // content_read 内部会核对「order == content schema 的全部表」⇒
    // 它能跑通就说明 17 张表都在、账本表不在里面。
    const res = await rpc('content_read', { p_owner: '', p_args: { order } })
    pass('S1', `content schema ${order.length} 张表在位（读回 ${res?.total ?? 0} 行）`)
  } catch (err) {
    fail('S1', `content schema 的表对不上：${String(err?.message ?? err)}`)
  }

  try {
    const st = await rpc('content_state_get', { p_owner: '', p_args: {} })
    pass('S2', `账本在位（当前第 ${st?.version ?? 0} 版）`)
  } catch (err) {
    fail('S2', `读不到发布状态：${String(err?.message ?? err)}`)
  }
}

async function assertA5() {
  console.log('\n[A5] 远端 PG → content 包 → 再算回行（无损）')
  const defs = tableDefs()
  const remote = await readRemote()

  // 远端行 → content 包
  const pack = buildContentFromRows(remote.rows)
  // content 包 → 行
  const back = buildRows(pack)
  const diff = rowsEqual(defs, remote.rows, back)
  if (diff) fail('A5', `往返有损：${diff}`)
  else pass('A5', `远端 ${remote.total} 行 → content 包 → 行，逐字段一致`)

  // API 拿到的包 == 远端算出的包
  const api = await readContent()
  let same = true
  for (const name of Object.keys(pack)) {
    const x = JSON.stringify(canonicalJson(pack[name]))
    const y = JSON.stringify(canonicalJson(api.content[name]))
    if (x !== y) {
      fail('A5', `API 的 ${name} 与远端算出的不一致`)
      same = false
      break
    }
  }
  if (same) pass('A5', 'API 的 content 包 == 远端 PG 算出的包')
}

async function assertA6() {
  console.log('\n[A6] 发布事务失败 → 远端保持原状')
  const before = await readRemote()
  const order = tableDefs().map((d) => d.table)

  // 造一个**必然失败**的载荷：一条方剂指向不存在的科中 id（外键违规）
  const broken = { order, tables: {} }
  for (const t of order) broken.tables[t] = []
  broken.tables.content_sciences = [{ id: 'sci-broken', name: '故意坏', ratio: '1:1', page: 1 }]
  broken.tables.content_doses = [
    { id: 'dose-broken', name: '故意坏', composition: 'x', page: 1, science_id: 'sci-not-exist' },
  ]

  let threw = false
  let msg = ''
  try {
    await rpc('content_publish', { p_owner: 'e2e-a6', p_args: broken })
  } catch (err) {
    threw = true
    msg = String(err?.message ?? err)
  }
  if (!threw) {
    fail('A6', '坏载荷居然发布成功了 —— 外键约束没起作用？')
    return
  }
  pass('A6', `坏载荷被拒（${msg.slice(0, 90)}…）`)

  const after = await readRemote()
  const diff = rowsEqual(tableDefs(), before.rows, after.rows)
  if (diff) fail('A6', `远端内容变了：${diff}`)
  else pass('A6', '远端内容逐字段未变（没有半套数据）')

  if (Number(after.state?.version) !== Number(before.state?.version)) {
    fail('A6', `版本号被推进了（${before.state?.version} → ${after.state?.version}）`)
  } else {
    pass('A6', `版本号未变（第 ${after.state?.version} 版）`)
  }
}

async function assertA7() {
  console.log('\n[A7] 发布幂等（同一份内容连发两次）')
  const defs = tableDefs()
  const order = defs.map((d) => d.table)
  const remote = await readRemote()

  // 用**远端自己的内容**当载荷（不碰本地稿）⇒ 内容一定不变，
  // 变的只有版本号 —— 这正是幂等要验的。
  const payload = { order, tables: remote.rows }

  const r1 = await rpc('content_publish', { p_owner: 'e2e-a7', p_args: payload })
  const r2 = await rpc('content_publish', { p_owner: 'e2e-a7', p_args: payload })

  if (Number(r2?.version) !== Number(r1?.version) + 1) {
    fail('A7', `版本号没按预期递增（${r1?.version} → ${r2?.version}）`)
  } else {
    pass('A7', `版本号递增正常（${r1?.version} → ${r2?.version}）`)
  }

  const after = await readRemote()
  const diff = rowsEqual(defs, remote.rows, after.rows)
  if (diff) fail('A7', `连发两次内容不一致：${diff}`)
  else pass('A7', '连发两次，远端内容逐字段一致')

  const pack1 = buildContentFromRows(remote.rows)
  const pack2 = buildContentFromRows(after.rows)
  for (const name of Object.keys(pack1)) {
    const x = JSON.stringify(canonicalJson(pack1[name]))
    const y = JSON.stringify(canonicalJson(pack2[name]))
    if (x !== y) {
      fail('A7', `content 包 ${name} 在连发两次后不一致`)
      return
    }
  }
  pass('A7', 'content 包也一致')
}

/* ------------------------------ 主流程 ------------------------------ */

async function main() {
  const required = process.env.PULSE_E2E_REQUIRE === '1'

  console.log('内容层 · 远端断言（A5／A6／A7）')
  console.log(`环境：${process.env.PULSE_CB_ENV || '(未设 PULSE_CB_ENV)'}`)

  if (!hasCredentials()) {
    console.log('\n  — 跳过：没有凭证（PULSE_CB_SECRET_ID / PULSE_CB_SECRET_KEY）。')
    console.log('    一条断言都没跑 —— 这**不是**「通过」。')
    console.log('    用法：node scripts/cb-credentials.mjs -- node scripts/e2e/content-pg.mjs')
    if (required) {
      console.error('\n✗ 你显式要求跑远端断言（E2E_REQUIRE=1），缺凭证不能算通过。')
      process.exit(1)
    }
    process.exit(0)
  }

  try {
    await assertStructure()
    await assertA5()
    await assertA6()
    await assertA7()
  } catch (err) {
    fail('E2E', String(err?.message ?? err))
  }

  const bad = results.filter((r) => !r.ok)
  console.log(`\n[content-pg] ${results.length - bad.length}/${results.length} 通过`)
  if (bad.length) {
    console.error(`\n✗ ${bad.length} 项没过。`)
    process.exit(1)
  }
  console.log('✓ 远端断言全过。')
}

main().catch((e) => {
  console.error(String(e?.message ?? e))
  process.exit(1)
})
