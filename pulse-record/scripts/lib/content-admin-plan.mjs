/**
 * 要在本地后台里配什么 —— 从 schema 推导，**唯一一份**。
 *
 * ⭐ 规则全部写在 schema 里（`x-tables[].derivedId` / `x-tables[].displayField`
 *    / 列的 `fk`），这里只做推导，不另写一份清单
 *    （铁律：能合成一个来源的，绝不留在两处）。
 *
 * 被 `scripts/content-admin-init.mjs`（写）与
 * `scripts/lib/content-admin-checks.mjs`（断言）共用。
 */

import { displayFieldOf } from './content-schema.mjs'

/** 某张表的主键列名。 */
export function primaryKeyOf(defs, table) {
  const def = defs.find((d) => d.table === table)
  if (!def) return null
  return def.columns.find((c) => c.pk)?.name || null
}

/**
 * 要配的关系清单。
 *
 * 每条 = { manyCollection, manyField, oneCollection, oneField }。
 * ⚠️ 被引用方的主键必须是**单列**（Directus 的硬限制）：
 *    复合主键的表在 Directus 里会被整表忽略 —— 所以 schema 里那些表
 *    都带了派生的单列代理键 `id`（见 `x-tables.derivedId`）。
 *
 * 返回 { relations, plainText }：
 * · `relations`   —— 要建成 Directus 关系的（外键 → 被引用表主键）
 * · `plainText`   —— 外键指向非主键列的，字段按普通文本处理（附说明）
 */
export function plannedRelations(defs) {
  const relations = []
  const plainText = []
  for (const def of defs) {
    for (const col of def.columns) {
      if (!col.fk) continue
      const oneField = col.fk.column
      const targetPk = primaryKeyOf(defs, col.fk.table)
      if (!targetPk) continue
      if (targetPk !== oneField) {
        plainText.push({
          manyCollection: def.table,
          manyField: col.name,
          oneCollection: col.fk.table,
          oneField,
          targetPk,
        })
        continue
      }
      relations.push({
        manyCollection: def.table,
        manyField: col.name,
        oneCollection: col.fk.table,
        oneField,
      })
    }
  }
  return { relations, plainText }
}

/**
 * 要配的「显示字段」—— 每张被引用的表，下拉里显示人看得懂的那一列。
 *
 * 声明在 schema 的 `x-tables[].displayField`（唯一来源），
 * 没声明就回落到主键（主键本身就是人话时不需要额外指定）。
 */
export function plannedDisplayFields(defs, relations) {
  const out = []
  const seen = new Set()
  for (const rel of relations) {
    if (seen.has(rel.oneCollection)) continue
    seen.add(rel.oneCollection)
    const field = displayFieldOf(defs, rel.oneCollection)
    if (!field) continue
    out.push({ collection: rel.oneCollection, field })
  }
  return out
}

/** Directus 的集合级显示模板：`{{name}}` 这样的写法。 */
export function displayTemplate(field) {
  return `{{${field}}}`
}

/**
 * 要配成**枚举下拉**的列 —— schema 里声明了 `enum` 的那些。
 *
 * 返回 [{ collection, field, choices, allowOther }]。
 *
 * ⭐ `allowOther` 恒为 **false**：
 *    这一列的取值集合就是 schema 里那一份（尺／关／寸、浮／中／沉、L／R），
 *    允许手输别的值就等于让「同一概念留在两处」——
 *    打错一个「寸」（比如带空格、写成「手」）后台不拦，发布前也拦不住。
 *    真要加取值，改 schema 那一份（唯一来源），后台跟着变。
 */
export function plannedEnums(defs) {
  const out = []
  for (const def of defs) {
    for (const col of def.columns) {
      if (!col.enum || !col.enum.length) continue
      out.push({
        collection: def.table,
        field: col.name,
        choices: col.enum.map((v) => ({ text: String(v), value: String(v) })),
        allowOther: false,
      })
    }
  }
  return out
}

/**
 * 要标**必填**的列 —— schema 里 `notNull: true` 的那些。
 *
 * 返回 [{ collection, field }]。
 *
 * ⭐ 为什么后台要再标一遍（DB 已经有 NOT NULL）：
 *    `NOT NULL` 只挡 `NULL`，挡不住**空字符串**。
 *    后台里一个没填的文本框提交上去是 `''`，DB 照收不误 ⇒
 *    「出处」「组成」这类必填列会悄悄变成空字符串。
 *    `meta.required` 让后台**当场**标红并拦住提交（R-Edit 的硬要求）。
 *
 * ⚠️ **派生的代理键不在此列** —— 它们是算出来的，不是内容，
 *    该由 A27（只读）管，不该让人手填。
 */
export function plannedRequired(defs) {
  const out = []
  for (const def of defs) {
    const derived = !!def.derivedId
    for (const col of def.columns) {
      if (!col.notNull) continue
      if (derived && col.name === 'id') continue
      out.push({ collection: def.table, field: col.name })
    }
  }
  return out
}

/**
 * 要标成**只读**的列 —— 派生代理键 `id`。
 *
 * 返回 [{ collection, field }]。
 *
 * ⭐ 为什么：`content_pulse_cells.id` ＝「pattern_id|seq」，是**算出来的**。
 *    A20 会在发布前抓到「id 与派生规则对不上」，
 *    但等到发布才拦＝用户白改一场。
 *    后台里直接把它设成只读 ⇒ 改不了，也就没有这个坑。
 */
export function plannedReadonly(defs) {
  const out = []
  for (const def of defs) {
    if (!def.derivedId) continue
    out.push({ collection: def.table, field: 'id' })
  }
  return out
}
