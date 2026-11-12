#!/usr/bin/env node
/**
 * 本地后台（Directus）配置 —— 只读核对
 *
 * 用法：
 *
 *     node scripts/content-admin-check.mjs
 *
 * 核对七件事（断言本体在 `scripts/lib/content-admin-checks.mjs`）：
 *   A21 每张内容表的列表接口都是 200（不被 Directus 的反向 o2m 误伤）
 *   A22 每条关系的 `meta.one_field` 都是 null
 *   A23 关系字段是 M2O 下拉；指向非主键的字段是普通文本
 *   A24 被引用集合的 `display_template` 指向 schema 声明的显示列
 *   A25 schema 声明了 enum 的列是下拉，且选项与 schema 一致
 *   A26 schema 里 NOT NULL 的列在后台标了必填
 *   A27 派生代理键在后台是只读
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
  CELL_COLLECTION,
  DEFAULT_PATTERN_ID,
  PATTERN_COLLECTION,
  plannedCellViewColumns,
  plannedDisplayFields,
  plannedEnums,
  plannedReadonly,
  plannedRelations,
  plannedRequired,
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
  enums: plannedEnums(defs),
  required: plannedRequired(defs),
  readonly: plannedReadonly(defs),
  // 视图预设与书签（A28／A29）
  cellCollection: CELL_COLLECTION,
  patternCollection: PATTERN_COLLECTION,
  defaultPatternId: DEFAULT_PATTERN_ID,
  cellViewColumns: plannedCellViewColumns(defs),
  patterns: [], // 下面从库里取
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

// 图清单（A29 的期望值）—— 从库里取，不硬编码
const patRes = await client.api(
  `/items/${PATTERN_COLLECTION}?fields=id,title&limit=500`,
)
if (!patRes.ok) {
  console.log(
    `[content-admin-check] 图清单读取失败 ${patRes.status}：${String(patRes.text).slice(0, 160)}`,
  )
  console.log('[content-admin-check] EXIT=1 —— 拿不到图清单，A29 没法核对')
  process.exit(1)
}
plan.patterns = patRes.json?.data || []

const { problems, checks } = await runAdminChecks(client.api, plan)
console.log(
  `[content-admin-check] ${plan.tables.length} 张表 / ${plan.relations.length} 条关系 / ` +
    `${plan.plainText.length} 个文本字段 / ${plan.displayFields.length} 个显示字段 / ` +
    `${plan.enums.length} 个枚举列 / ${plan.required.length} 个必填列 / ${plan.readonly.length} 个只读列 / ` +
    `${plan.patterns.length} 张图的书签`,
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
