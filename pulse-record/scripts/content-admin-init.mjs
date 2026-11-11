#!/usr/bin/env node
/**
 * 本地后台（Directus）元数据初始化 —— 把「内容表的关系与界面」一次性配好
 *
 * ## 干什么
 *
 * Directus 能自动**内省**数据库里的表和外键，但它只把外键当成「数据库层的约束」，
 * 不会替我们决定「这个字段在后台里长什么样」。
 *
 * 这个脚本按 schema 里的声明补齐两件事：
 *
 *  ① **关系元数据**（`directus_relations`）
 *     把外键升级成 Directus 关系 —— 这样 `content_pulse_cells.term_id`
 *     在后台里就是个能点选的 M2O 下拉框。
 *  ② **字段界面**（`directus_fields.interface`）
 *     关系字段的界面设成 `select-dropdown-m2o`，其余按列类型给默认界面。
 *
 * ⭐ **全部从 `src/content/schema/*.schema.json` 推导** —— 外键声明在 schema 里，
 *    这里不另写一份关系清单（铁律：能合成一个来源的，绝不留在两处）。
 *
 * ## 用法
 *
 *     node scripts/content-admin-init.mjs            # 初始化（幂等，可重复跑）
 *     node scripts/content-admin-init.mjs --check    # 只核对，不写
 *
 * ## 环境变量
 *
 *     PULSE_ADMIN_URL        默认 http://localhost:8055
 *     PULSE_ADMIN_EMAIL      默认 admin@example.com
 *     PULSE_ADMIN_PASSWORD   默认 PulseLocal2026
 *
 * ⚠️ **Directus 必须在跑**（容器：`docker start pulse-directus`）。
 */

import { tableDefs } from './lib/content-schema.mjs'

const ADMIN_URL = (process.env.PULSE_ADMIN_URL || 'http://localhost:8055').replace(/\/$/, '')
const ADMIN_EMAIL = process.env.PULSE_ADMIN_EMAIL || 'admin@example.com'
const ADMIN_PASSWORD = process.env.PULSE_ADMIN_PASSWORD || 'PulseLocal2026'
const CHECK = process.argv.includes('--check')

/* ------------------------------------------------------------------ *
 * HTTP
 * ------------------------------------------------------------------ */

let token = null

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${ADMIN_URL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* 非 JSON 响应，留在 json=null */
  }
  return { ok: res.ok, status: res.status, json, text }
}

async function login() {
  const r = await api('/auth/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })
  if (!r.ok || !r.json?.data?.access_token) {
    throw new Error(`登录失败（${r.status}）：${r.text.slice(0, 300)}`)
  }
  token = r.json.data.access_token
}

/* ------------------------------------------------------------------ *
 * 从 schema 推导「要配什么」
 * ------------------------------------------------------------------ */

/**
 * 某张表的唯一列（主键，或显式 `unique` 的列）。
 *
 * ⚠️ 外键**不一定指向主键** —— `content_alias.target` 指向 `content_drugs.name`
 *    （方名，唯一列）。关系必须绑到**外键实际指向的那一列**，
 *    绑到主键上会让下拉框显示 id、数据里存的却是名字 ⇒ 整个对不上。
 */
function uniqueColumnsOf(defs, table) {
  const def = defs.find((d) => d.table === table)
  if (!def) return []
  return def.columns.filter((c) => c.pk || c.unique).map((c) => c.name)
}

/**
 * 要配的关系清单。
 *
 * 每条 = { manyCollection, manyField, oneCollection, oneField }。
 * ⚠️ 被引用方的主键必须是**单列**（Directus 的硬限制）：
 *    复合主键的表在 Directus 里会被整表忽略 —— 所以 schema 里那些表
 *    都带了派生的单列代理键 `id`（见 `x-tables.derivedId`）。
 */
export function plannedRelations(defs) {
  const out = []
  for (const def of defs) {
    for (const col of def.columns) {
      if (!col.fk) continue
      const oneField = col.fk.column
      if (!uniqueColumnsOf(defs, col.fk.table).includes(oneField)) continue
      out.push({
        manyCollection: def.table,
        manyField: col.name,
        oneCollection: col.fk.table,
        oneField,
      })
    }
  }
  return out
}

/**
 * 要预置的**视图预设**。
 *
 * Directus 12 把「筛选器 / 布局 / 收藏」统一收在 `directus_presets` 里
 * （没有独立的 `/filters` `/layouts` 端点了）。
 *
 * · `content_pulse_cells` —— 编辑面的主视图：**按 pattern_id 过滤到一张图，
 *   一屏正好 18 行（9 部位×取法 × 左右）**，列序按「部位 → 取法 → 左右」。
 * · `content_pulse_patterns` —— 50 张图的清单。
 *
 * 预设挂在**当前用户**下（`user` 字段）⇒ 换个人登录要重建。
 */
export const VIEW_PRESETS = [
  {
    collection: 'content_pulse_cells',
    layout: 'tabular',
    layout_query: {
      fields: [
        'id',
        'pattern_id',
        'seq',
        'side',
        'organ',
        'depth',
        'term_id',
        'codes',
        'group_no',
        'note',
        'flex',
      ],
      // ⭐ 参考图＝清挡路（讲义 p34 的 18 格实例）。换图改这个值即可。
      filter: { pattern_id: { _eq: 'fx-ssx-qingdanglu' } },
      sort: [
        { field: 'pattern_id', direction: 'asc' },
        { field: 'seq', direction: 'asc' },
      ],
    },
    layout_options: {
      layout: 'tabular',
      fields: ['seq', 'side', 'organ', 'depth', 'term_id', 'group_no', 'note', 'flex'],
    },
  },
  {
    collection: 'content_pulse_patterns',
    layout: 'tabular',
    layout_query: {
      fields: ['id', 'title', 'source', 'note'],
      sort: [{ field: 'id', direction: 'asc' }],
    },
    layout_options: {
      layout: 'tabular',
      fields: ['title', 'source', 'note'],
    },
  },
]

/* ------------------------------------------------------------------ *
 * 跑
 * ------------------------------------------------------------------ */

const defs = tableDefs()
const relations = plannedRelations(defs)

let changed = 0
let failed = 0

async function main() {
  await login()
  console.log(`已登录 ${ADMIN_URL}`)
  console.log(`schema 里声明了 ${relations.length} 条关系\n`)

  for (const rel of relations) {
    const label = `${rel.manyCollection}.${rel.manyField} → ${rel.oneCollection}.${rel.oneField}`

    // ① 关系元数据
    const relRes = await api(`/relations/${rel.manyCollection}/${rel.manyField}`, {
      method: 'PATCH',
      body: { meta: { one_field: rel.oneField, one_deselect_action: 'nullify' } },
    })

    // ② 字段界面（M2O 下拉）
    const fieldRes = await api(`/fields/${rel.manyCollection}/${rel.manyField}`, {
      method: 'PATCH',
      body: {
        meta: {
          interface: 'select-dropdown-m2o',
          special: ['m2o'],
          note: `关联「${rel.oneCollection}」`,
        },
      },
    })

    const relOk = relRes.ok && relRes.json?.data?.meta?.one_field === rel.oneField
    const fieldOk =
      fieldRes.ok && fieldRes.json?.data?.meta?.interface === 'select-dropdown-m2o'

    if (relOk && fieldOk) {
      console.log(`  ✅ ${label}`)
    } else {
      failed++
      console.log(`  ❌ ${label}`)
      if (!relOk) console.log(`     关系：${relRes.status} ${relRes.text.slice(0, 200)}`)
      if (!fieldOk) console.log(`     界面：${fieldRes.status} ${fieldRes.text.slice(0, 200)}`)
    }
    if (!CHECK) changed++
  }

  console.log('')
  if (failed) {
    console.error(`❌ ${failed}/${relations.length} 条没配上`)
    process.exitCode = 1
    return
  }
  console.log(
    CHECK
      ? `✅ ${relations.length} 条关系全部就位`
      : `✅ ${relations.length} 条关系全部就位（处理 ${changed} 条）`,
  )

  await syncViewPresets()
}

/**
 * 预置视图预设（幂等：同集合的旧预设先删掉再建，避免重复堆叠）。
 */
async function syncViewPresets() {
  const me = await api('/users/me')
  const userId = me.json?.data?.id
  if (!userId) {
    console.error('❌ 拿不到当前用户 id，预设没建')
    process.exitCode = 1
    return
  }

  const existing = await api('/presets')
  const mine = (existing.json?.data || []).filter(
    (p) => p.user === userId && VIEW_PRESETS.some((v) => v.collection === p.collection),
  )

  for (const p of mine) {
    if (CHECK) {
      console.log(`  ℹ️  ${p.collection} 已有一份视图预设（--check 不删）`)
      continue
    }
    await api(`/presets/${p.id}`, { method: 'DELETE' })
  }

  for (const v of VIEW_PRESETS) {
    if (CHECK) {
      console.log(`  ℹ️  ${v.collection} 视图预设${mine.some((p) => p.collection === v.collection) ? '已存在' : '未建'}`)
      continue
    }
    const r = await api('/presets', {
      method: 'POST',
      body: { user: userId, ...v },
    })
    if (r.ok) {
      console.log(`  ✅ ${v.collection} 视图预设已就位`)
    } else {
      failed++
      console.error(`  ❌ ${v.collection} 视图预设：${r.status} ${r.text.slice(0, 200)}`)
    }
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`)
  console.error('   提示：Directus 容器要先起来 —— docker start pulse-directus')
  process.exitCode = 1
})
