#!/usr/bin/env node
/**
 * 本地后台（Directus）配置 —— 只读核对
 *
 * 用法：
 *
 *     node scripts/content-admin-check.mjs
 *
 * 核对四件事（断言本体在 `scripts/lib/content-admin-checks.mjs`）：
 *   A6 每张内容表的列表接口都是 200（不被 Directus 的反向 o2m 误伤）
 *   A7 每条关系的 `meta.one_field` 都是 null
 *   A8 关系字段是 M2O 下拉；指向非主键的字段是普通文本
 *   A9 被引用集合的 `display_template` 指向 schema 声明的显示列
 *
 * ⚠️ **只读** —— 不改任何配置（改配置的是 `content-admin-init.mjs`，
 *    故意写坏的验证是 `scripts/e2e/content-admin-break.mjs`）。
 *
 * 后台没起来时按 `pg-store.mjs` 的老规矩：明确打印「跳过」并 exit 0，
 * `PULSE_E2E_REQUIRE=1` 时缺后台则 exit 1（跳过 ≠ 通过，必须能区分）。
 */

import { tableDefs } from './lib/content-schema.mjs'
import { createAdminClient, pingAdmin } from './lib/content-admin-client.mjs'
import {
  plannedDisplayFields,
  plannedRelations,
} from './lib/content-admin-plan.mjs'
import { runAdminChecks } from './lib/content-admin-checks.mjs'

const defs = tableDefs()
const { relations, plainText } = plannedRelations(defs)
const displayFields = plannedDisplayFields(defs, relations)
const plan = {
  tables: defs.map((d) => d.table),
  columns: Object.fromEntries(defs.map((d) => [d.table, d.columns.map((c) => c.name)])),
  relations,
  plainText,
  displayFields,
}

const client = createAdminClient()

const ping = await pingAdmin(client.url)
if (!ping.ok) {
  console.log(`[content-admin-check] 跳过 —— 本地后台没起来（${client.url}）：${ping.text.slice(0, 120)}`)
  console.log('  起后台：node scripts/content-admin.mjs up')
  if (process.env.PULSE_E2E_REQUIRE === '1') {
    console.log('[content-admin-check] EXIT=1 —— PULSE_E2E_REQUIRE=1，后台必须可用')
    process.exit(1)
  }
  console.log('[content-admin-check] EXIT=0 —— 跳过（不是通过）')
  process.exit(0)
}

const loginRes = await client.login()
if (!loginRes.ok) {
  console.log(`[content-admin-check] 跳过 —— 登录失败 ${loginRes.status}：${String(loginRes.text).slice(0, 160)}`)
  if (process.env.PULSE_E2E_REQUIRE === '1') {
    console.log('[content-admin-check] EXIT=1 —— PULSE_E2E_REQUIRE=1，必须能登录')
    process.exit(1)
  }
  console.log('[content-admin-check] EXIT=0 —— 跳过（不是通过）')
  process.exit(0)
}

const { problems, checks } = await runAdminChecks(client.api, plan)

console.log(
  `[content-admin-check] ${plan.tables.length} 张表 / ${plan.relations.length} 条关系 / ` +
    `${plan.plainText.length} 个文本字段 / ${plan.displayFields.length} 个显示字段`,
)
if (problems.length === 0) {
  console.log(`=== 通过 ${checks} ｜ 失败 0 ===`)
  console.log('[content-admin-check] EXIT=0 —— 全部就位')
  process.exit(0)
}
for (const p of problems) console.log(`  ✗ [${p.id}] ${p.msg}`)
console.log(`=== 通过 ${checks - problems.length} ｜ 失败 ${problems.length} ===`)
console.log(`[content-admin-check] EXIT=1 —— ${problems.length} 处不对`)
process.exit(1)
