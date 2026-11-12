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
 * A22（关系元数据）
 *   ① 给关系填上 `meta.one_field` → 被引用方集合的列表接口 500（被 A21 抓到）
 *   ④ 给「计划外的残留关系」填上 `meta.one_field`
 * A23（字段界面）
 *   ② 把 M2O 字段的界面改成普通输入 → 关系字段不再是下拉
 * A24（显示字段）
 *   ③ 把集合的 `display_template` 改错 → 下拉里显示 id 而不是人话
 * A25（枚举下拉）
 *   ⑤ 把枚举选项改错（多一项）
 *   ⑥ 把枚举选项存成**数组**（Directus 12 的形状是对象）→ 下拉读不到
 *   ⑦ 把 `allowOther` 打开 → 又多了一个「能随便填」的取值来源
 * A26（必填校验）
 *   ⑧ 把 NOT NULL 列的必填标记关掉
 * A27（派生键只读）
 *   ⑨ 把派生代理键的只读关掉 → 用户能手改算出来的键
 *
 * ⑩ 反向：没改坏时必须**一条都不报**（防假绿）。
 * ⑪ 恢复原状后必须重新全绿（防「改坏了就回不来」）。
 *
 * ⚠️ 本测试会**真的改**本地后台的配置，跑完必须恢复原状。
 *    后台没起来时按 `pg-store.mjs` 的老规矩：明确打印「跳过」并 exit 0，
 *    `PULSE_E2E_REQUIRE=1` 时缺后台则 exit 1（跳过 ≠ 通过，必须能区分）。
 */

import { tableDefs } from '../lib/content-schema.mjs'
import { createAdminClient, pingAdmin } from '../lib/content-admin-client.mjs'
import {
  CELL_COLLECTION,
  DEFAULT_PATTERN_ID,
  PATTERN_COLLECTION,
  plannedCellViewColumns,
  plannedDisplayFields,
  plannedEnums,
  plannedBooleans,
  plannedReadonly,
  plannedRelations,
  plannedRequired,
} from '../lib/content-admin-plan.mjs'
import {
  checkAdminReadable,
  checkBookmarks,
  checkDisplayTemplates,
  checkEnumDropdowns,
  checkFieldInterfaces,
  checkBooleanSwitches,
  checkReadonlyDerived,
  checkRelationsNoOneField,
  checkRequiredFlags,
  checkViewPresets,
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
const enums = plannedEnums(defs)
const required = plannedRequired(defs)
const readonly = plannedReadonly(defs)
const booleans = plannedBooleans(defs)
const tables = defs.map((d) => d.table)
const plan = {
  tables,
  columns: Object.fromEntries(defs.map((d) => [d.table, d.columns.map((c) => c.name)])),
  relations,
  plainText,
  displayFields,
  enums,
  required,
  readonly,
  cellCollection: CELL_COLLECTION,
  patternCollection: PATTERN_COLLECTION,
  defaultPatternId: DEFAULT_PATTERN_ID,
  cellViewColumns: plannedCellViewColumns(defs),
  patterns: [],
}

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

// 图清单（A29 的期望值）
const patRes = await api(`/items/${PATTERN_COLLECTION}?fields=id,title&limit=500`)
plan.patterns = patRes.ok ? patRes.json?.data || [] : []

/** 跑一遍全部断言（反向检查与「恢复后」都用它） */
async function runAll() {
  return [
    ...(await checkAdminReadable(api, plan)),
    ...(await checkRelationsNoOneField(api, relations)),
    ...(await checkFieldInterfaces(api, relations, plainText)),
    ...(await checkDisplayTemplates(api, displayFields)),
    ...(await checkEnumDropdowns(api, enums)),
    ...(await checkRequiredFlags(api, required)),
    ...(await checkReadonlyDerived(api, readonly)),
    ...(await checkBooleanSwitches(api, booleans)),
    ...(await checkViewPresets(api, plan)),
    ...(await checkBookmarks(api, plan)),
  ]
}

/* ------------------------------------------------------------------ *
 * 快照：坏之前先记住原样，好还原
 * ------------------------------------------------------------------ */

const snapshots = []
const seen = new Set()
async function snapshot(kind, path) {
  if (seen.has(path)) return
  seen.add(path)
  const r = await api(path)
  snapshots.push({ kind, path, meta: r.json?.data?.meta ?? null })
}

for (const rel of relations) {
  await snapshot('relation', `/relations/${rel.manyCollection}/${rel.manyField}`)
  await snapshot('field', `/fields/${rel.manyCollection}/${rel.manyField}`)
}
for (const df of displayFields) {
  await snapshot('collection', `/collections/${df.collection}`)
}
for (const pt of plainText) {
  // 计划外的残留关系也要能恢复（它的 one_field 也必须被抹平）
  await snapshot('relation', `/relations/${pt.manyCollection}/${pt.manyField}`)
  await snapshot('field', `/fields/${pt.manyCollection}/${pt.manyField}`)
}
for (const e of enums) await snapshot('field', `/fields/${e.collection}/${e.field}`)
for (const rq of required) await snapshot('field', `/fields/${rq.collection}/${rq.field}`)
for (const ro of readonly) await snapshot('field', `/fields/${ro.collection}/${ro.field}`)

/* 视图预设与书签也要能恢复 */
const meRes = await api('/users/me')
const userId = meRes.json?.data?.id
const presetSnaps = []
{
  const r = await api('/presets')
  const mine = (r.json?.data || []).filter(
    (p) =>
      p.user === userId &&
      (p.collection === CELL_COLLECTION || p.collection === PATTERN_COLLECTION),
  )
  for (const p of mine) {
    presetSnaps.push({
      id: p.id,
      bookmark: p.bookmark,
      filter: p.filter,
      layout: p.layout,
      layout_query: p.layout_query,
      layout_options: p.layout_options,
      icon: p.icon,
      color: p.color,
    })
  }
}

async function restore() {
  for (const s of snapshots) {
    if (!s.meta) continue
    await api(s.path, { method: 'PATCH', body: { meta: s.meta } })
  }
  for (const s of presetSnaps) {
    const body = {
      bookmark: s.bookmark,
      filter: s.filter,
      layout: s.layout,
      layout_query: s.layout_query,
      layout_options: s.layout_options,
      icon: s.icon,
      color: s.color,
    }
    const cur = await api(`/presets/${s.id}`)
    if (cur.ok) {
      await api(`/presets/${s.id}`, { method: 'PATCH', body })
    } else {
      await api('/presets', { method: 'POST', body: { ...body, user: userId } })
    }
  }
}

/* ------------------------------------------------------------------ *
 * 跑
 * ------------------------------------------------------------------ */

console.log(
  `[content-admin-break] 后台 ${client.url}｜${relations.length} 条关系 / ${plainText.length} 个文本字段 / ` +
    `${displayFields.length} 个显示字段 / ${enums.length} 个枚举列 / ` +
    `${required.length} 个必填列 / ${readonly.length} 个只读列 / ${tables.length} 张表\n`,
)

try {
  console.log('⓪ 反向：好配置必须一条都不报（防假绿）')
  {
    const all = await runAll()
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
      const readable = await checkAdminReadable(api, plan)
      const hit = readable.filter((p) => p.id === 'A21')
      ok(hit.length > 0, `→ 必须被 [A21] 抓到（实际抓到 ${hit.length} 条）`)
      for (const p of hit) console.log(`      · ${p.msg}`)

      const relHit = (await checkRelationsNoOneField(api, relations)).filter((p) => p.id === 'A22')
      ok(relHit.length > 0, `→ 同时必须被 [A22] 抓到（实际抓到 ${relHit.length} 条）`)
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
    const hit = (await checkFieldInterfaces(api, relations, plainText)).filter((p) => p.id === 'A23')
    ok(hit.length > 0, `→ 必须被 [A23] 抓到（实际抓到 ${hit.length} 条）`)
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
    const hit = (await checkDisplayTemplates(api, displayFields)).filter((p) => p.id === 'A24')
    ok(hit.length > 0, `→ 必须被 [A24] 抓到（实际抓到 ${hit.length} 条）`)
    for (const p of hit) console.log(`      · ${p.msg}`)
  }

  console.log('')
  console.log('④ 故意写坏：给「计划外的残留关系」填上 meta.one_field')
  {
    // content_alias.target → content_drugs.name：外键指向唯一列，不是主键 ⇒ 不该建关系
    const pt = plainText[0]
    ok(!!pt, `找到可注入的残留关系（${pt ? pt.manyCollection + '.' + pt.manyField : '无'}）`)
    if (pt) {
      await api(`/relations/${pt.manyCollection}/${pt.manyField}`, {
        method: 'PATCH',
        body: { meta: { one_field: pt.oneField } },
      })
      const hit = (await checkRelationsNoOneField(api, relations)).filter((p) => p.id === 'A22')
      ok(hit.length > 0, `→ 必须被 [A22] 抓到（实际抓到 ${hit.length} 条）`)
      for (const p of hit) console.log(`      · ${p.msg}`)
    }
  }

  console.log('')
  console.log('⑤ 故意写坏：枚举下拉的选项多一项')
  {
    const e = enums[0]
    await api(`/fields/${e.collection}/${e.field}`, {
      method: 'PATCH',
      body: {
        meta: {
          interface: 'select-dropdown',
          options: {
            allowOther: false,
            choices: [...e.choices, { text: '多出来的', value: '多出来的' }],
          },
        },
      },
    })
    const hit = (await checkEnumDropdowns(api, enums)).filter((p) => p.id === 'A25')
    ok(hit.length > 0, `→ 必须被 [A25] 抓到（实际抓到 ${hit.length} 条）`)
    for (const p of hit) console.log(`      · ${p.msg}`)
  }

  console.log('')
  console.log('⑥ 故意写坏：枚举选项存成数组（Directus 12 的形状是对象）')
  {
    const e = enums[0]
    await api(`/fields/${e.collection}/${e.field}`, {
      method: 'PATCH',
      body: { meta: { interface: 'select-dropdown', options: e.choices } },
    })
    const hit = (await checkEnumDropdowns(api, enums)).filter((p) => p.id === 'A25')
    ok(hit.length > 0, `→ 必须被 [A25] 抓到（实际抓到 ${hit.length} 条）`)
    for (const p of hit) console.log(`      · ${p.msg}`)
  }

  console.log('')
  console.log('⑦ 故意写坏：把 allowOther 打开（多了一个能随便填的取值来源）')
  {
    const e = enums[0]
    await api(`/fields/${e.collection}/${e.field}`, {
      method: 'PATCH',
      body: {
        meta: {
          interface: 'select-dropdown',
          options: { allowOther: true, choices: e.choices },
        },
      },
    })
    const hit = (await checkEnumDropdowns(api, enums)).filter((p) => p.id === 'A25')
    ok(hit.length > 0, `→ 必须被 [A25] 抓到（实际抓到 ${hit.length} 条）`)
    for (const p of hit) console.log(`      · ${p.msg}`)
  }

  console.log('')
  console.log('⑧ 故意写坏：把 NOT NULL 列的必填标记关掉')
  {
    const rq = required[0]
    await api(`/fields/${rq.collection}/${rq.field}`, {
      method: 'PATCH',
      body: { meta: { required: false } },
    })
    const hit = (await checkRequiredFlags(api, required)).filter((p) => p.id === 'A26')
    ok(hit.length > 0, `→ 必须被 [A26] 抓到（实际抓到 ${hit.length} 条）`)
    for (const p of hit) console.log(`      · ${p.msg}`)
  }

  console.log('')
  console.log('⑨ 故意写坏：把派生代理键的只读关掉')
  {
    const ro = readonly[0]
    await api(`/fields/${ro.collection}/${ro.field}`, {
      method: 'PATCH',
      body: { meta: { readonly: false } },
    })
    const hit = (await checkReadonlyDerived(api, readonly)).filter((p) => p.id === 'A27')
    ok(hit.length > 0, `→ 必须被 [A27] 抓到（实际抓到 ${hit.length} 条）`)
    for (const p of hit) console.log(`      · ${p.msg}`)
  }

  console.log('')
  console.log('⑫-新 故意写坏：把布尔列的「开关」改成数字框')
  console.log('    （开关变回 0／1 输入框 —— 用户会填错；这是 A30 管的）')
  {
    const b = booleans[0]
    await api(`/fields/${b.collection}/${b.field}`, {
      method: 'PATCH',
      body: { meta: { interface: 'input' } },
    })
    const hit = (await checkBooleanSwitches(api, booleans)).filter((p) => p.id === 'A30')
    ok(hit.length > 0, `→ 必须被 [A30] 抓到（实际抓到 ${hit.length} 条）`)
    for (const p of hit) console.log(`      · ${p.msg}`)
  }

  console.log('')
  console.log('⑩ 故意写坏：把默认视图的过滤条件从顶层挪进 layout_query.filter')
  console.log('    （这正是本轮实测踩到的坑 —— 位置写错，预设建得出来，界面却不生效）')
  {
    const r = await api('/presets')
    const view = (r.json?.data || []).find(
      (p) => p.collection === CELL_COLLECTION && !p.bookmark && p.user === userId,
    )
    ok(!!view, `找到格位集合的默认视图预设（${view ? 'id=' + view.id : '无'}）`)
    if (view) {
      await api(`/presets/${view.id}`, {
        method: 'PATCH',
        body: {
          filter: null,
          layout_query: {
            ...view.layout_query,
            filter: { pattern_id: { _eq: DEFAULT_PATTERN_ID } },
          },
        },
      })
      const hit = (await checkViewPresets(api, plan)).filter((p) => p.id === 'A28')
      ok(hit.length > 0, `→ 必须被 [A28] 抓到（实际抓到 ${hit.length} 条）`)
      for (const p of hit) console.log(`      · ${p.msg}`)
    }
  }

  console.log('')
  console.log('⑪ 故意写坏：把一个书签改名（那张图就切不到）＋把另一个的过滤改错（会切错图）')
  {
    const r = await api('/presets')
    const bookmarks = (r.json?.data || []).filter(
      (p) => p.collection === CELL_COLLECTION && p.bookmark && p.user === userId,
    )
    ok(bookmarks.length >= 2, `找到可注入的书签（${bookmarks.length} 个）`)
    if (bookmarks.length >= 2) {
      await api(`/presets/${bookmarks[0].id}`, {
        method: 'PATCH',
        body: { bookmark: 'ZZ改坏的书签名' },
      })
      await api(`/presets/${bookmarks[1].id}`, {
        method: 'PATCH',
        body: { filter: { pattern_id: { _eq: 'fx-__wrong__' } } },
      })
      const hit = (await checkBookmarks(api, plan)).filter((p) => p.id === 'A29')
      ok(hit.length > 0, `→ 必须被 [A29] 抓到（实际抓到 ${hit.length} 条）`)
      for (const p of hit) console.log(`      · ${p.msg}`)
    }
  }

  console.log('')
  console.log('⑫ 恢复原状后必须重新全绿')
  {
    await restore()
    const all = await runAll()
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
