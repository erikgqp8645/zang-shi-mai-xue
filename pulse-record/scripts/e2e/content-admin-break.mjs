#!/usr/bin/env node
/**
 * 本地后台（Directus）配置 —— 「故意写坏」验证
 *
 * 用法：
 *
 *     node scripts/e2e/content-admin-break.mjs
 *
 * ## 为什么要有这个
 *
 * `content-admin-init.mjs` 跑完只会说「全部就位」——
 * 它**不能**证明「配错了会被拦住」。后台配错的代价特别大：
 * Directus 12 的 `meta.one_field` 一填错，**被引用方整张表在后台里点不开**
 * （接口 500），而配错的现场长得很像「Directus 坏了」，很难往自己身上找。
 *
 * 所以这里**真的把配置改坏**，断言对应编号的检查**必须报错**，
 * 然后**原样恢复**（finally 里做，恢复不了就直接退出码 1，不留坏配置）。
 *
 * ## 注入的坏配置
 *
 * A7（关系元数据）
 *   ① 给关系填上 `meta.one_field` → 被引用方集合的列表接口 500（被 A6 抓到）
 * A8（字段界面）
 *   ② 把 M2O 字段的界面改成普通输入 → 关系字段不再是下拉
 * A9（显示字段）
 *   ③ 把集合的 `display_template` 改错 → 下拉里显示 id 而不是人话
 *
 * ④ 反向：没改坏时必须**一条都不报**（防假绿）。
 *
 * ⚠️ 本测试会**真的改**本地后台的配置，跑完必须恢复原状。
 *    后台没起来时按 `pg-store.mjs` 的老规矩：明确打印「跳过」并 exit 0，
 *    `PULSE_E2E_REQUIRE=1` 时缺后台则 exit 1（跳过 ≠ 通过，必须能区分）。
 */

import { tableDefs } from '../lib/content-schema.mjs'
import { createAdminClient, pingAdmin } from '../lib/content-admin-client.mjs'
import {
  displayTemplate,
  plannedDisplayFields,
  plannedRelations,
} from '../lib/content-admin-plan.mjs'
import {
  checkAdminReadable,
  checkDisplayTemplates,
  checkFieldInterfaces,
  checkRelationsNoOneField,
} from '../lib/content-admin-checks.mjs'

let failures = 0
let checks = 0

function ok(cond, msg) {
  checks++
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures++
    console.log(`  ✗ ${msg}`)
  }
}

const defs = tableDefs()
const { relations, plainText } = plannedRelations(defs)
const displayFields = plannedDisplayFields(defs, relations)
const tables = defs.map((d) => d.table)
const plan = { tables, relations, plainText, displayFields }

const client = createAdminClient()

/* ------------------------------------------------------------------ *
 * 前置：后台在不在
 * ------------------------------------------------------------------ */

const ping = await pingAdmin(client.url)
if (!ping.ok) {
  console.log(`[content-admin-break] 跳过 —— 本地后台没起来（${client.url}）：${ping.text.slice(0, 120)}`)
  console.log('  起后台：node scripts/content-admin.mjs up')
  if (process.env.PULSE_E2E_REQUIRE === '1') {
    console.log('[content-admin-break] EXIT=1 —— PULSE_E2E_REQUIRE=1，后台必须可用')
    process.exit(1)
  }
  console.log('[content-admin-break] EXIT=0 —— 跳过（不是通过）')
  process.exit(0)
}

const loginRes = await client.login()
if (!loginRes.ok) {
  console.log(`[content-admin-break] 跳过 —— 登录失败 ${loginRes.status}：${String(loginRes.text).slice(0, 160)}`)
  if (process.env.PULSE_E2E_REQUIRE === '1') {
    console.log('[content-admin-break] EXIT=1 —— PULSE_E2E_REQUIRE=1，必须能登录')
    process.exit(1)
  }
  console.log('[content-admin-break] EXIT=0 —— 跳过（不是通过）')
  process.exit(0)
}

const api = client.api

/* ------------------------------------------------------------------ *
 * 快照：坏之前先记住原样，好还原
 * ------------------------------------------------------------------ */

const snapshots = []
for (const rel of relations) {
  const r = await api(`/relations/${rel.manyCollection}/${rel.manyField}`)
  snapshots.push({
    kind: 'relation',
    path: `/relations/${rel.manyCollection}/${rel.manyField}`,
    meta: r.json?.data?.meta ?? null,
  })
}
for (const df of displayFields) {
  const r = await api(`/collections/${df.collection}`)
  snapshots.push({
    kind: 'collection',
    path: `/collections/${df.collection}`,
    meta: r.json?.data?.meta ?? null,
  })
}
for (const rel of relations) {
  const r = await api(`/fields/${rel.manyCollection}/${rel.manyField}`)
  snapshots.push({
    kind: 'field',
    path: `/fields/${rel.manyCollection}/${rel.manyField}`,
    meta: r.json?.data?.meta ?? null,
  })
}

async function restore() {
  for (const s of snapshots) {
    if (!s.meta) continue
    await api(s.path, { method: 'PATCH', body: { meta: s.meta } })
  }
}

/* ------------------------------------------------------------------ *
 * 跑
 * ------------------------------------------------------------------ */

console.log(`[content-admin-break] 后台 ${client.url}｜${relations.length} 条关系 / ${plainText.length} 个文本字段 / ${displayFields.length} 个显示字段 / ${tables.length} 张表\n`)

try {
  console.log('⓪ 反向：好配置必须一条都不报（防假绿）')
  {
    const p1 = await checkAdminReadable(api, tables)
    const p2 = await checkRelationsNoOneField(api, relations)
    const p3 = await checkFieldInterfaces(api, relations, plainText)
    const p4 = await checkDisplayTemplates(api, displayFields)
    const all = [...p1, ...p2, ...p3, ...p4]
    ok(all.length === 0, `好配置无告警（实际 ${all.length} 条）`)
    for (const p of all) console.log(`      · [${p.id}] ${p.msg}`)
  }

  console.log('')
  console.log('① 故意写坏：给关系填上 meta.one_field（被引用方的列表接口会 500）')
  {
    // 拿一条「被引用方是 content_sciences」的关系 —— 它的 one_field = 'id'
    const rel = relations.find((r) => r.oneCollection === 'content_sciences')
    ok(!!rel, `找到可注入的关系（${rel ? rel.manyCollection + '.' + rel.manyField : '无'}）`)
    if (rel) {
      await api(`/relations/${rel.manyCollection}/${rel.manyField}`, {
        method: 'PATCH',
        body: { meta: { one_field: rel.oneField } },
      })
      const readable = await checkAdminReadable(api, tables)
      const hit = readable.filter((p) => p.id === 'A6')
      ok(hit.length > 0, `→ 必须被 [A6] 抓到（实际抓到 ${hit.length} 条）`)
      for (const p of hit) console.log(`      · ${p.msg}`)

      const relHit = (await checkRelationsNoOneField(api, relations)).filter((p) => p.id === 'A7')
      ok(relHit.length > 0, `→ 同时必须被 [A7] 抓到（实际抓到 ${relHit.length} 条）`)
    }
  }

  console.log('')
  console.log('② 故意写坏：把 M2O 字段的界面改成普通输入')
  {
    const rel = relations[0]
    await api(`/fields/${rel.manyCollection}/${rel.manyField}`, {
      method: 'PATCH',
      body: { meta: { interface: 'input', special: null } },
    })
    const hit = (await checkFieldInterfaces(api, relations, plainText)).filter((p) => p.id === 'A8')
    ok(hit.length > 0, `→ 必须被 [A8] 抓到（实际抓到 ${hit.length} 条）`)
    for (const p of hit) console.log(`      · ${p.msg}`)
  }

  console.log('')
  console.log('③ 故意写坏：把集合的 display_template 改错')
  {
    const df = displayFields[0]
    await api(`/collections/${df.collection}`, {
      method: 'PATCH',
      body: { meta: { display_template: '{{__wrong__}}' } },
    })
    const hit = (await checkDisplayTemplates(api, displayFields)).filter((p) => p.id === 'A9')
    ok(hit.length > 0, `→ 必须被 [A9] 抓到（实际抓到 ${hit.length} 条）`)
    for (const p of hit) console.log(`      · ${p.msg}`)
  }

  console.log('')
  console.log('④ 恢复原状后必须重新全绿')
  {
    await restore()
    const p1 = await checkAdminReadable(api, tables)
    const p2 = await checkRelationsNoOneField(api, relations)
    const p3 = await checkFieldInterfaces(api, relations, plainText)
    const p4 = await checkDisplayTemplates(api, displayFields)
    const all = [...p1, ...p2, ...p3, ...p4]
    ok(all.length === 0, `恢复后无告警（实际 ${all.length} 条）`)
    for (const p of all) console.log(`      · [${p.id}] ${p.msg}`)
  }
} finally {
  await restore()
}

console.log('')
if (failures) {
  console.log(`[content-admin-break] EXIT=1 —— ${failures}/${checks} 项失败`)
  process.exit(1)
}
console.log(`[content-admin-break] EXIT=0 —— ${checks} 项全过`)
