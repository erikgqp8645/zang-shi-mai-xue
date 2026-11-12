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

/* ------------------------------------------------------------------ *
 * 视图预设（脉象图的编辑面）
 * ------------------------------------------------------------------ */

/** 脉象格位表（一张图的 18 个格位） */
export const CELL_COLLECTION = 'content_pulse_cells'
/** 脉象图清单表（50 张图） */
export const PATTERN_COLLECTION = 'content_pulse_patterns'

/**
 * 默认视图落在哪张图上。
 *
 * 讲义 2026-10·p34 的实例表就是「清挡路」这张图（18 格），
 * 拿它当参考图 ⇒ 默认打开后台就看到一张**有内容**的图，不是空表。
 */
export const DEFAULT_PATTERN_ID = 'fx-ssx-qingdanglu'

/**
 * 编辑一屏时**不**显示的列。
 *
 * · `id`        —— 派生代理键（算出来的，只读）
 * · `pattern_id` —— 当前图（过滤条件已经把它锁死，显示一遍没意义）
 * · `seq`      —— 行序（排序已经按它定，位置就是顺序）
 *
 * 剩下的（部位／取法／左右／用字／符号／组号／备注／弹性）才是改图时要看、要改的。
 */
const CELL_HIDDEN_COLUMNS = ['id', 'pattern_id', 'seq']

/** 格位表要拉取的全部列（要能改，就都得拉回来）。 */
export function plannedCellFields(defs) {
  const def = defs.find((d) => d.table === CELL_COLLECTION)
  if (!def) return []
  return def.columns.map((c) => c.name)
}

/** 格位表在表格里显示的列（可见列）。 */
export function plannedCellViewColumns(defs) {
  return plannedCellFields(defs).filter((n) => !CELL_HIDDEN_COLUMNS.includes(n))
}

/**
 * 要预置的**视图预设**清单 —— 从库里推导。
 *
 * `patterns` ＝ 库里的脉象图（[{ id, title }]），由调用方从后台 API 取。
 *
 * 产出三类：
 * ① **格位编辑主视图** —— 落在参考图上，一屏 18 行
 * ② **图清单视图** —— 50 张图的标题／出处／备注
 * ③ **每张图一个书签** —— 点书签图标直达那张图的 18 行
 *
 * ⭐ **Directus 12 的两个存储位置（实测，别再写错）**：
 *   · 过滤条件 → 预设在**顶层 `filter` 列**。
 *     写进 `layout_query.filter` **不生效**（界面照样全量 900 行、前端请求不带 filter）。
 *     Directus 自己保存状态时会**同时**写两处，我们跟着写两处。
 *   · 表格可见列 → `layout_query.tabular.fields`。
 *     ⛔ 不是 `layout_options.fields`（那个键 Directus 根本不读，写了也没反应）。
 *   · `layout_query.fields` ＝ 要拉取哪些列（拉全，改哪列都改得动）。
 */
export function plannedViewPresets(defs, patterns) {
  const cells = defs.find((d) => d.table === CELL_COLLECTION)
  const patternDefs = defs.find((d) => d.table === PATTERN_COLLECTION)
  if (!cells || !patternDefs) return []

  const allCellFields = plannedCellFields(defs)
  const cellViewColumns = plannedCellViewColumns(defs)
  const cellSort = [
    { field: 'pattern_id', direction: 'asc' },
    { field: 'seq', direction: 'asc' },
  ]

  const cellLayout = (patternId) => {
    const filter = { pattern_id: { _eq: patternId } }
    return {
      filter,
      layout_query: {
        fields: allCellFields,
        filter,
        sort: cellSort,
        tabular: { fields: cellViewColumns },
      },
    }
  }

  const presets = [
    {
      collection: CELL_COLLECTION,
      layout: 'tabular',
      ...cellLayout(DEFAULT_PATTERN_ID),
    },
    {
      collection: PATTERN_COLLECTION,
      layout: 'tabular',
      layout_query: {
        fields: patternDefs.columns.map((c) => c.name),
        sort: [{ field: 'id', direction: 'asc' }],
        tabular: {
          // ⭐ `id` 也显示出来 —— 切图要填的就是它（过滤器的 Pattern ID 是纯文本框，
          //    Directus 12 的关系下拉只按主键搜，填图名搜不到）。
          //    没有这一列，用户就得靠记忆把「清挡路」对到 fx-ssx-qingdanglu。
          fields: patternDefs.columns.map((c) => c.name),
        },
      },
    },
  ]

  for (const p of patterns) {
    if (!p || !p.id || !p.title) continue
    presets.push({
      collection: CELL_COLLECTION,
      bookmark: p.title,
      layout: 'tabular',
      ...cellLayout(p.id),
    })
  }

  return presets
}
