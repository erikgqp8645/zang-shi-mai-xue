#!/usr/bin/env node
/**
 * 本地后台（Directus）元数据初始化 —— 把「内容表的关系与界面」一次性配好
 *
 * ## 干什么
 *
 * Directus 能自动**内省**数据库里的表和外键，但它只把外键当成「数据库层的约束」，
 * 不会替我们决定「这个字段在后台里长什么样」。
 *
 * 这个脚本按 schema 里的声明补齐七件事：
 *
 *  ① **关系元数据**（`directus_relations`）
 *     把外键升级成 Directus 关系 —— 这样 `content_pulse_cells.term_id`
 *     在后台里就是个能点选的 M2O 下拉框。
 *     ⚠️ `meta.one_field` 必须留 **null**，原因见 `main()` 里的长注释
 *     （填了会让「被引用方」集合的接口整个 500）。
 *  ② **普通文本字段**：外键指向的不是主键（存的是名字）时不做下拉，按文本填。
 *  ③ **字段界面**（`directus_fields.interface`）
 *     关系字段 `select-dropdown-m2o`；schema 声明了 `enum` 的列 `select-dropdown`
 *     ＋选项（选项就是 schema 那一份，不另写）；其余按列类型给默认界面。
 *  ④ **显示字段**（`directus_collections.display_template`）
 *     下拉里显示人看得懂的那一列（科中名、方名、图名、用字名），而不是 id。
 *  ⑤ **必填标记**（`meta.required`）—— schema 里 NOT NULL 的列，后台当场标红。
 *  ⑥ **只读标记**（`meta.readonly`）—— 派生代理键是算出来的，不让人手填。
 *  ⑦ **视图预设**（`directus_presets`）—— 脉象图按 `pattern_id` 过滤成一屏 18 行。
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
import { ADMIN_URL, createAdminClient } from './lib/content-admin-client.mjs'
import {
  displayTemplate,
  plannedDisplayFields,
  plannedEnums,
  plannedReadonly,
  plannedRelations,
  plannedRequired,
} from './lib/content-admin-plan.mjs'

const CHECK = process.argv.includes('--check')
const client = createAdminClient()
const api = client.api

/**
 * 写（或只读核对）。
 *
 * ⚠️ `--check` 必须是**纯只读**的。
 *    原实现不管有没有 `--check` 都发 PATCH —— 「核对」却真的改了远端，
 *    跑一次 `--check` 就等于改了一次配置，没法当验收用。
 *    现在：check 模式走 GET，比对远端现状；正常模式才 PATCH。
 */
async function writeOrCheck(path, body, readPath = path) {
  if (CHECK) return api(readPath)
  return api(path, { method: 'PATCH', body })
}

/* ------------------------------------------------------------------ *
 * 从 schema 推导「要配什么」
 * ------------------------------------------------------------------ */

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
const { relations, plainText } = plannedRelations(defs)
const displayFields = plannedDisplayFields(defs, relations)
const enums = plannedEnums(defs)
const required = plannedRequired(defs)
const readonly = plannedReadonly(defs)

let changed = 0
let failed = 0

async function main() {
  await client.login()
  console.log(`已登录 ${ADMIN_URL}`)
  console.log(`schema 里声明了 ${relations.length} 条关系（另有 ${plainText.length} 个外键按普通文本处理）\n`)

  // ① 关系元数据
  //
  // ⚠️⚠️ **`one_field` 必须是 null，不能填被引用表的主键名。**
  //
  // Directus 12 的 `getRelation()` 是**双向匹配**的
  // （`@directus/utils` 的 `getRelation` / `getRelationType`）：
  //   关系.collection === 本集合 && 关系.field === 字段名      → m2o（正向）
  //   关系.related_collection === 本集合 && meta.one_field === 字段名 → o2m（反向）
  // 读「被引用方」集合时，如果请求的**列名恰好等于某条关系的 one_field**
  // （one_field 就是主键名，所以必然命中），Directus 会把这个标量列
  // **误判成反向 o2m 关系**，然后在 `merge-with-parent-items.js` 的 o2m 分支里
  // 把父行的该列当成「子项数组」→ `parentItem[id].push(...)` 挂在字符串上
  // → **整个接口 500**（`parentItem$1[parentRelationField].push is not a function`）。
  //
  // 后果实测：`GET /items/content_sciences?fields=id,name` 500，
  // 而 `?fields=name,ratio`（去掉 id）200 —— 后台里连「科中」这张表都打不开。
  //
  // 正向 m2o **不需要** one_field（靠 collection+field 匹配），
  // 下拉框照常工作；反向 o2m 展开我们用不到 ⇒ 一律置 null。
  for (const rel of relations) {
    const label = `${rel.manyCollection}.${rel.manyField} → ${rel.oneCollection}.${rel.oneField}`
    const relRes = await writeOrCheck(
      `/relations/${rel.manyCollection}/${rel.manyField}`,
      { meta: { one_field: null, one_deselect_action: 'nullify' } },
      `/relations/${rel.manyCollection}/${rel.manyField}`,
    )
    const relOk = relRes.ok && relRes.json?.data?.meta?.one_field === null
    if (relOk) {
      console.log(`  ✅ ${label}（关系）`)
    } else {
      failed++
      console.log(`  ❌ ${label}（关系）`)
      console.log(`     关系：${relRes.status} ${relRes.text.slice(0, 200)}`)
    }
    if (!CHECK) changed++
  }

  // ② 外键指向非主键列的字段：按普通文本处理（存的是名字，不是主键值）
  //
  // ⚠️ 这条关系以前配过（one_field ＝ 目标列）⇒ 现在**必须把 meta 抹平**。
  //    Directus 的 `DELETE /relations/{集合}/{字段}` 对**内省出来的**关系删不掉
  //    meta（删完 GET 还在），所以只能用 PATCH 置 null。
  //    留着不抹平的后果：哪天 Directus 改了行为让这条也进 `schema.relations`，
  //    读 `content_drugs` 的 `name` 列就会撞上那个 500。
  for (const pt of plainText) {
    const label = `${pt.manyCollection}.${pt.manyField} → ${pt.oneCollection}.${pt.oneField}`
    const relRes = await writeOrCheck(
      `/relations/${pt.manyCollection}/${pt.manyField}`,
      { meta: { one_field: null, one_deselect_action: 'nullify' } },
      `/relations/${pt.manyCollection}/${pt.manyField}`,
    )
    const relOk = relRes.ok && relRes.json?.data?.meta?.one_field === null
    if (relOk) {
      console.log(`  ✅ ${label}（关系已抹平）`)
    } else {
      failed++
      console.log(`  ❌ ${label}（关系）`)
      console.log(`     关系：${relRes.status} ${relRes.text.slice(0, 200)}`)
    }
    if (!CHECK) changed++
  }

  // ③ 字段界面：**每一列要配的东西合成一份 meta，一次 PATCH 写完**
  //
  // ⭐ 为什么合成一份而不是分几次 PATCH：
  //    Directus 的字段 meta 是**合并**语义，但依赖它的具体行为不牢靠 ——
  //    分开 PATCH 时，后一次会不会把前一次的 `options`/`required` 冲掉，
  //    得靠实测每次都验一遍；合成一份就没有这个不确定性。
  //
  // 合成的内容：
  //  · 关系字段     → `select-dropdown-m2o`（点选式，外键指向主键）
  //  · 指向非主键的 → `input`（存的是名字，没法点选）
  //  · schema 有 enum 的 → `select-dropdown` ＋ 选项（取值集合的唯一来源）
  //  · NOT NULL 的  → `required: true`（后台当场标红）
  //  · 派生代理键   → `readonly: true`（算出来的，不是内容）
  const fieldPlans = new Map()
  const addField = (collection, field, meta) => {
    const key = `${collection}.${field}`
    const cur = fieldPlans.get(key) || { collection, field, meta: {} }
    cur.meta = { ...cur.meta, ...meta }
    fieldPlans.set(key, cur)
  }

  for (const rel of relations) {
    addField(rel.manyCollection, rel.manyField, {
      interface: 'select-dropdown-m2o',
      special: ['m2o'],
      note: `关联「${rel.oneCollection}」`,
    })
  }
  for (const pt of plainText) {
    addField(pt.manyCollection, pt.manyField, {
      interface: 'input',
      special: null,
      note: `存的是「${pt.oneCollection}」的 ${pt.oneField}（原文用字），不是它的主键 ${pt.targetPk} ⇒ 没法做成下拉，按文本填`,
    })
  }
  for (const e of enums) {
    addField(e.collection, e.field, {
      interface: 'select-dropdown',
      // ⚠️ Directus 12 的界面选项是**对象** `{ allowOther, choices }`，不是数组。
      //    存成数组时界面读不到 choices —— 下拉是空的（实测）。
      options: { allowOther: e.allowOther, choices: e.choices },
      note: `取值固定这几项：${e.choices.map((c) => c.value).join('、')}（schema 的 enum，唯一来源）`,
    })
  }
  for (const rq of required) {
    addField(rq.collection, rq.field, { required: true })
  }
  for (const ro of readonly) {
    addField(ro.collection, ro.field, { readonly: true })
  }

  console.log('')
  for (const fp of fieldPlans.values()) {
    const res = await writeOrCheck(
      `/fields/${fp.collection}/${fp.field}`,
      { meta: fp.meta },
      `/fields/${fp.collection}/${fp.field}`,
    )
    const got = res.json?.data?.meta
    const bad = []
    for (const [k, v] of Object.entries(fp.meta)) {
      if (v === null) {
        if (got?.[k] !== null && got?.[k] !== undefined) bad.push(`${k}=${JSON.stringify(got?.[k])}`)
      } else if (JSON.stringify(got?.[k]) !== JSON.stringify(v)) {
        bad.push(`${k}=${JSON.stringify(got?.[k])}`)
      }
    }
    if (res.ok && !bad.length) {
      console.log(`  ✅ ${fp.collection}.${fp.field}（${Object.keys(fp.meta).join('、')}）`)
    } else {
      failed++
      console.log(`  ❌ ${fp.collection}.${fp.field}`)
      if (!res.ok) console.log(`     读取：${res.status} ${res.text.slice(0, 200)}`)
      if (bad.length) console.log(`     不符：${bad.join('　')}`)
    }
    if (!CHECK) changed++
  }

  // ④ 显示字段：下拉里显示人看得懂的那一列，而不是 id
  //
  // Directus 的集合级 `display_template`（`directus_collections.display_template`）
  // 决定关系字段下拉里的标签，例如 `{{name}}` ⇒ 显示科中名「六神」而不是 `kc-liushen`。
  // 取值来自 schema 的 `x-tables[].displayField`（唯一来源）。
  console.log('')
  for (const df of displayFields) {
    const template = displayTemplate(df.field)
    const collRes = await writeOrCheck(
      `/collections/${df.collection}`,
      { meta: { display_template: template } },
      `/collections/${df.collection}`,
    )
    const ok =
      collRes.ok && collRes.json?.data?.meta?.display_template === template
    if (ok) {
      console.log(`  ✅ ${df.collection} 的显示字段 = ${df.field}`)
    } else {
      failed++
      console.log(`  ❌ ${df.collection} 的显示字段 = ${df.field}`)
      console.log(`     集合：${collRes.status} ${collRes.text.slice(0, 200)}`)
    }
    if (!CHECK) changed++
  }

  console.log('')
  if (failed) {
    console.error(`❌ ${failed} 处没配上`)
    process.exitCode = 1
    return
  }
  console.log(
    CHECK
      ? `✅ ${relations.length} 条关系 ＋ ${plainText.length} 个文本字段 ＋ ${fieldPlans.size} 个字段界面` +
          ` ＋ ${displayFields.length} 个显示字段 全部就位`
      : `✅ 全部就位（处理 ${changed} 处）`,
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
