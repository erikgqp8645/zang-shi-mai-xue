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
