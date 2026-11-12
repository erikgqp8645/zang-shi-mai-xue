/**
 * 本地后台（Directus）配置的断言。
 *
 * ⭐ **按结构解析**：看 HTTP 状态码、看 `meta` 里的具体字段值，
 *    不在响应文本里搜关键词 —— 搜词会被无关内容骗过。
 *
 * 每条断言的 id 与 `scripts/e2e/content-admin-break.mjs` 的注入点一一对应，
 * 那边的「故意写坏」就是靠这些 id 验证「坏配置会被抓到」。
 *
 * ## ⭐ 编号以实施计划 §10.2 的 A1~A19 为准（唯一来源）
 *
 * · 计划里有的 ⇒ 用计划编号，语义不许偏
 * · 计划里没有的 ⇒ 从 **A20** 起往后续，**不占用计划编号**
 *
 * ⚠️ 早先这几条用的是 A6／A7／A8／A9 —— 跟计划 §10.2 的
 *    「A6 发布事务失败／A7 发布幂等／A8 快照==库／A9 往返」**完全错位**，
 *    同一个编号在两处讲两件事。已全部改成计划外的 A21~A27。
 *    完整对照表见 `docs/content-assertions.md`。
 */

/**
 * A21（可读性）—— 每张内容表的列表接口都必须 200。
 *
 * ⚠️ 这条是**实打实的拦路虎**：Directus 12 的 `getRelation()` 双向匹配，
 *    关系的 `meta.one_field` 一旦填了被引用表的主键名，
 *    读「被引用方」集合时那个主键列会被误判成反向 o2m，
 *    `merge-with-parent-items.js` 的 o2m 分支把字符串当数组 push → 整个接口 500。
 *    后台里表现为「某张表点开就报错，连列表都出不来」。
 */
export async function checkAdminReadable(api, plan) {
  const problems = []
  for (const table of plan.tables) {
    const plain = await api(`/items/${table}?limit=1`)
    if (!plain.ok) {
      problems.push({
        id: 'A21',
        msg: `${table} 列表接口 ${plain.status}：${errorText(plain)}`,
      })
      continue
    }
    const star = await api(`/items/${table}?limit=1&fields=*`)
    if (!star.ok) {
      problems.push({
        id: 'A21',
        msg: `${table} 带 fields=* 的列表接口 ${star.status}：${errorText(star)}`,
      })
    }
    // ⭐ 再显式点名**每一列**请求一次 ——
    //   o2m 误判是按「列名 == 某条关系的 one_field」触发的，
    //   显式列名是最容易踩中的形态（`fields=*` 走的是另一条解析路径）。
    const cols = plan.columns?.[table]
    if (cols?.length) {
      const explicit = await api(`/items/${table}?limit=1&fields=${cols.join(',')}`)
      if (!explicit.ok) {
        problems.push({
          id: 'A21',
          msg:
            `${table} 显式点名全部列（${cols.length} 列）的列表接口 ${explicit.status}：` +
            errorText(explicit),
        })
      }
    }
  }
  return problems
}

/**
 * A22（关系元数据）—— **所有** content 关系的 `meta.one_field` 必须是 null。
 *
 * 填了就会触发 A21 那个 500（见上面的说明）。
 *
 * ⚠️ 查的是**全量**关系清单（`GET /relations` 里 collection 以 `content_` 开头的），
 *    不只查计划内那几条 —— 计划外的残留关系（以前配过、现在不配了）
 *    同样会中招。实测 Directus 的 `DELETE /relations/{集合}/{字段}`
 *    对内省出来的关系**删不掉 meta**（删完 GET 还在），所以只能靠 PATCH 置 null。
 */
export async function checkRelationsNoOneField(api, relations) {
  const problems = []
  const list = await api('/relations')
  if (!list.ok) {
    problems.push({ id: 'A22', msg: `关系清单读取失败 ${list.status}` })
    return problems
  }
  const planned = new Set(
    relations.map((r) => `${r.manyCollection}.${r.manyField}`),
  )
  for (const rel of list.json?.data ?? []) {
    const collection = String(rel.collection || '')
    if (!collection.startsWith('content_')) continue
    const key = `${collection}.${rel.field}`
    const oneField = rel.meta?.one_field
    if (oneField !== null && oneField !== undefined) {
      problems.push({
        id: 'A22',
        msg:
          `关系 ${key} 的 meta.one_field = ${JSON.stringify(oneField)}，必须为 null` +
          (planned.has(key) ? '' : '（这条不在计划里 —— 是以前的残留）') +
          `（填了会让「${rel.related_collection}」的列表接口 500）`,
      })
    }
  }
  return problems
}

/**
 * A23（字段界面）—— 关系字段必须是 M2O 下拉；指向非主键的必须是普通文本。
 */
export async function checkFieldInterfaces(api, relations, plainText) {
  const problems = []
  for (const rel of relations) {
    const r = await api(`/fields/${rel.manyCollection}/${rel.manyField}`)
    if (!r.ok) {
      problems.push({
        id: 'A23',
        msg: `字段 ${rel.manyCollection}.${rel.manyField} 读取失败 ${r.status}`,
      })
      continue
    }
    const iface = r.json?.data?.meta?.interface
    if (iface !== 'select-dropdown-m2o') {
      problems.push({
        id: 'A23',
        msg: `字段 ${rel.manyCollection}.${rel.manyField} 的界面 = ${JSON.stringify(iface)}，应为 select-dropdown-m2o`,
      })
    }
  }
  for (const pt of plainText) {
    const r = await api(`/fields/${pt.manyCollection}/${pt.manyField}`)
    if (!r.ok) {
      problems.push({
        id: 'A23',
        msg: `字段 ${pt.manyCollection}.${pt.manyField} 读取失败 ${r.status}`,
      })
      continue
    }
    const iface = r.json?.data?.meta?.interface
    if (iface !== 'input') {
      problems.push({
        id: 'A23',
        msg:
          `字段 ${pt.manyCollection}.${pt.manyField} 的界面 = ${JSON.stringify(iface)}，` +
          `应为 input（它存的是 ${pt.oneCollection}.${pt.oneField}，不是主键 ${pt.targetPk}）`,
      })
    }
  }
  return problems
}

/**
 * A24（显示字段）—— 被引用集合的 `display_template` 必须指向 schema 声明的显示列。
 *
 * 没配的话，下拉里显示的是 id（`kc-liushen`）而不是人话（`六神`）。
 */
export async function checkDisplayTemplates(api, displayFields) {
  const problems = []
  for (const df of displayFields) {
    const r = await api(`/collections/${df.collection}`)
    if (!r.ok) {
      problems.push({
        id: 'A24',
        msg: `集合 ${df.collection} 读取失败 ${r.status}`,
      })
      continue
    }
    const template = r.json?.data?.meta?.display_template
    const want = `{{${df.field}}}`
    if (template !== want) {
      problems.push({
        id: 'A24',
        msg: `集合 ${df.collection} 的 display_template = ${JSON.stringify(template)}，应为 ${JSON.stringify(want)}`,
      })
    }
  }
  return problems
}

/**
 * A25（枚举下拉）—— schema 里声明了 `enum` 的列，后台必须是下拉，
 * 且**选项与 schema 逐个相同**。
 *
 * ⚠️ 两个易错点（都实测过）：
 *  ① Directus 12 的界面选项是**对象** `{ allowOther, choices }`，
 *     不是数组 —— 存成数组时界面读不到 choices，下拉是空的。
 *  ② `allowOther` 必须是 **false**：这一列的取值集合就是 schema 那一份，
 *     允许手输别的值就等于让「同一概念留在两处」——
 *     打错一个「寸」（带空格、写成「手」）后台不拦，发布前也拦不住。
 */
export async function checkEnumDropdowns(api, enums) {
  const problems = []
  for (const e of enums) {
    const r = await api(`/fields/${e.collection}/${e.field}`)
    if (!r.ok) {
      problems.push({
        id: 'A25',
        msg: `字段 ${e.collection}.${e.field} 读取失败 ${r.status}`,
      })
      continue
    }
    const meta = r.json?.data?.meta
    if (meta?.interface !== 'select-dropdown') {
      problems.push({
        id: 'A25',
        msg:
          `字段 ${e.collection}.${e.field} 的界面 = ${JSON.stringify(meta?.interface)}，` +
          `应为 select-dropdown（取值集合：${e.choices.map((c) => c.value).join('、')}）`,
      })
      continue
    }
    const choices = meta?.options?.choices
    if (!Array.isArray(choices)) {
      problems.push({
        id: 'A25',
        msg:
          `字段 ${e.collection}.${e.field} 的 options.choices 不是数组（=${JSON.stringify(meta?.options)}）` +
          `—— Directus 12 的选项形状是对象 { allowOther, choices }`,
      })
      continue
    }
    const got = choices.map((c) => String(c?.value))
    const want = e.choices.map((c) => String(c.value))
    if (got.join('｜') !== want.join('｜')) {
      problems.push({
        id: 'A25',
        msg:
          `字段 ${e.collection}.${e.field} 的选项 = ${got.join('、') || '（空）'}，` +
          `应为 ${want.join('、')}（选项来自 schema 的 enum，唯一来源）`,
      })
    }
    if (meta?.options?.allowOther !== false) {
      problems.push({
        id: 'A25',
        msg:
          `字段 ${e.collection}.${e.field} 的 options.allowOther = ` +
          `${JSON.stringify(meta?.options?.allowOther)}，应为 false` +
          `（取值集合由 schema 那一份说了算）`,
      })
    }
  }
  return problems
}

/**
 * A26（必填校验）—— schema 里 `notNull: true` 的列，后台必须标了必填。
 *
 * `NOT NULL` 只挡 `NULL`，挡不住**空字符串**：
 * 后台里一个没填的文本框提交上去是 `''`，DB 照收不误 ⇒
 * 「出处」「组成」这类必填列会悄悄变成空字符串。
 * `meta.required` 让后台**当场**标红（R-Edit 的硬要求）。
 */
export async function checkRequiredFlags(api, required) {
  const problems = []
  for (const rq of required) {
    const r = await api(`/fields/${rq.collection}/${rq.field}`)
    if (!r.ok) {
      problems.push({
        id: 'A26',
        msg: `字段 ${rq.collection}.${rq.field} 读取失败 ${r.status}`,
      })
      continue
    }
    if (r.json?.data?.meta?.required !== true) {
      problems.push({
        id: 'A26',
        msg:
          `字段 ${rq.collection}.${rq.field} 的 meta.required = ` +
          `${JSON.stringify(r.json?.data?.meta?.required)}，应为 true（schema 里它是 NOT NULL）`,
      })
    }
  }
  return problems
}

/**
 * A30（布尔开关）—— schema 里 `type: 'bool'` 的列，后台必须是**开关**。
 *
 * Directus 的布尔字段默认给的是**数字框**（填 0／1），
 * 用户要的是一眼能点、不会填错的勾选框 ⇒ 必须显式配 `interface: 'boolean'`。
 *
 * ⓘ 这一条只对**声明成布尔**的列生效；
 *   SQLite 里布尔列的声明名必须写 `BOOLEAN`（Directus 靠声明类型判定），
 *   否则它在后台显示成 integer ⇒ 这条断言会红。
 */
export async function checkBooleanSwitches(api, booleans) {
  const problems = []
  for (const b of booleans) {
    const r = await api(`/fields/${b.collection}/${b.field}`)
    if (!r.ok) {
      problems.push({
        id: 'A30',
        msg: `字段 ${b.collection}.${b.field} 读取失败 ${r.status}`,
      })
      continue
    }
    const iface = r.json?.data?.meta?.interface
    if (iface !== 'boolean') {
      problems.push({
        id: 'A30',
        msg:
          `字段 ${b.collection}.${b.field} 的界面 = ${JSON.stringify(iface)}，` +
          `应为 "boolean"（布尔列要给开关，不是数字框）`,
      })
    }
  }
  return problems
}

/**
 * A27（派生键只读）—— 派生代理主键 `id` 在后台必须是只读。
 *
 * `content_pulse_cells.id` ＝「pattern_id|seq」，是**算出来的**。
 * A20 会在发布前抓到「id 与派生规则对不上」，
 * 但等到发布才拦＝用户白改一场。
 * 后台里设成只读 ⇒ 改不了，也就没有这个坑。
 */
export async function checkReadonlyDerived(api, readonly) {
  const problems = []
  for (const ro of readonly) {
    const r = await api(`/fields/${ro.collection}/${ro.field}`)
    if (!r.ok) {
      problems.push({
        id: 'A27',
        msg: `字段 ${ro.collection}.${ro.field} 读取失败 ${r.status}`,
      })
      continue
    }
    if (r.json?.data?.meta?.readonly !== true) {
      problems.push({
        id: 'A27',
        msg:
          `字段 ${ro.collection}.${ro.field} 的 meta.readonly = ` +
          `${JSON.stringify(r.json?.data?.meta?.readonly)}，应为 true（它是派生键，不是内容）`,
      })
    }
  }
  return problems
}

/**
 * A28（视图预设）—— 格位编辑面的视图预设必须写在**对的位置**。
 *
 * ⭐ **Directus 12 的两个存储位置（实测，写错就是「界面没生效」）**：
 *   · 过滤条件 → 预设在**顶层 `filter` 列**。
 *     写进 `layout_query.filter` **不生效**（界面照样全量 900 行、前端请求不带 filter）。
 *   · 表格可见列 → **`layout_query.tabular.fields`**。
 *     ⛔ `layout_options.fields` 那个键 Directus 根本不读（界面自己建的书签里它是 null）。
 *
 * 这条守的就是「自动化全绿、界面却没生效」那个坑：
 * 位置写错时，预设记录照样建得出来、API 照样 200，只有界面知道不对。
 */
export async function checkViewPresets(api, plan) {
  const problems = []
  const me = await api('/users/me')
  const userId = me.json?.data?.id
  if (!userId) {
    problems.push({ id: 'A28', msg: '拿不到当前用户 id，视图预设没法核对' })
    return problems
  }

  const r = await api('/presets')
  if (!r.ok) {
    problems.push({ id: 'A28', msg: `预设清单读取失败 ${r.status}` })
    return problems
  }
  const mine = (r.json?.data || []).filter((p) => p.user === userId)

  // ① 格位编辑主视图：1 份，过滤在顶层，可见列在 layout_query.tabular.fields
  const views = mine.filter(
    (p) => p.collection === plan.cellCollection && !p.bookmark,
  )
  if (views.length !== 1) {
    problems.push({
      id: 'A28',
      msg: `${plan.cellCollection} 的默认视图预设应有 1 份，实为 ${views.length} 份`,
    })
  } else {
    const v = views[0]
    const wantFilter = { pattern_id: { _eq: plan.defaultPatternId } }
    if (JSON.stringify(v.filter) !== JSON.stringify(wantFilter)) {
      problems.push({
        id: 'A28',
        msg:
          `默认视图的顶层 filter = ${JSON.stringify(v.filter)}，` +
          `应为 ${JSON.stringify(wantFilter)}` +
          `（过滤条件必须写在顶层；写进 layout_query.filter 不生效）`,
      })
    }
    const gotCols = v.layout_query?.tabular?.fields
    if (JSON.stringify(gotCols) !== JSON.stringify(plan.cellViewColumns)) {
      problems.push({
        id: 'A28',
        msg:
          `默认视图的可见列 layout_query.tabular.fields = ${JSON.stringify(gotCols)}，` +
          `应为 ${JSON.stringify(plan.cellViewColumns)}` +
          `（可见列在这个位置；layout_options.fields 不被读取）`,
      })
    }
  }

  // ② 图清单视图：也要有可见列
  const patternViews = mine.filter(
    (p) => p.collection === plan.patternCollection && !p.bookmark,
  )
  if (patternViews.length !== 1) {
    problems.push({
      id: 'A28',
      msg: `${plan.patternCollection} 的视图预设应有 1 份，实为 ${patternViews.length} 份`,
    })
  } else {
    const cols = patternViews[0].layout_query?.tabular?.fields
    if (!Array.isArray(cols) || !cols.length) {
      problems.push({
        id: 'A28',
        msg: `图清单视图的可见列 layout_query.tabular.fields = ${JSON.stringify(cols)}，不应为空`,
      })
    }
  }

  return problems
}

/**
 * A29（书签）—— 每张脉象图都要有一个书签，点开就是那张图的 18 行。
 *
 * ⭐ 书签是 Directus 12 唯一的「切图」机制：
 *   过滤器的 Pattern ID 是**纯文本框**（关系下拉只按主键搜，填图名搜不到），
 *   而书签是 `?bookmark=<预设 id>` 直达 —— 书签里有**过滤条件**，所以能切图。
 *
 * 断言内容：
 *   · 书签数 == 图数（多一个＝用户自己加的散书签，少一个＝有图切不到）
 *   · 每个书签的名字 == 图名（书签名就是给人看的）
 *   · 每个书签的过滤条件 == 那张图的 pattern_id
 */
export async function checkBookmarks(api, plan) {
  const problems = []
  const me = await api('/users/me')
  const userId = me.json?.data?.id
  if (!userId) {
    problems.push({ id: 'A29', msg: '拿不到当前用户 id，书签没法核对' })
    return problems
  }

  const r = await api('/presets')
  if (!r.ok) {
    problems.push({ id: 'A29', msg: `预设清单读取失败 ${r.status}` })
    return problems
  }
  const mine = (r.json?.data || []).filter((p) => p.user === userId)
  const bookmarks = mine.filter(
    (p) => p.collection === plan.cellCollection && p.bookmark,
  )

  if (bookmarks.length !== plan.patterns.length) {
    problems.push({
      id: 'A29',
      msg:
        `${plan.cellCollection} 的书签数 = ${bookmarks.length}，` +
        `图数 = ${plan.patterns.length}（每个图要有一个书签）`,
    })
  }

  for (const pat of plan.patterns) {
    const hit = bookmarks.find((b) => b.bookmark === pat.title)
    if (!hit) {
      problems.push({
        id: 'A29',
        msg: `图「${pat.title}」（${pat.id}）没有书签`,
      })
      continue
    }
    const want = { pattern_id: { _eq: pat.id } }
    if (JSON.stringify(hit.filter) !== JSON.stringify(want)) {
      problems.push({
        id: 'A29',
        msg:
          `书签「${pat.title}」的 filter = ${JSON.stringify(hit.filter)}，` +
          `应为 ${JSON.stringify(want)}`,
      })
    }
  }

  return problems
}

/**
 * 汇总跑一遍，返回 `{ problems, checks }`。
 *
 * `checks` ＝ 实际核对的项数（便于回归统计；`problems` 为空即全过）。
 */
export async function runAdminChecks(api, plan) {
  const problems = [
    ...(await checkAdminReadable(api, plan)),
    ...(await checkRelationsNoOneField(api, plan.relations)),
    ...(await checkFieldInterfaces(api, plan.relations, plan.plainText)),
    ...(await checkDisplayTemplates(api, plan.displayFields)),
    ...(await checkEnumDropdowns(api, plan.enums)),
    ...(await checkRequiredFlags(api, plan.required)),
    ...(await checkReadonlyDerived(api, plan.readonly)),
    ...(await checkBooleanSwitches(api, plan.booleans)),
    ...(await checkViewPresets(api, plan)),
    ...(await checkBookmarks(api, plan)),
  ]
  // 每一项断言的「个数」：表 × 3 种请求 ＋ 关系 × 2 ＋ 文本字段 ＋ 显示字段
  //                            ＋ 枚举列 ＋ 必填列 ＋ 只读列
  //                            ＋ 视图预设 2 ＋ 书签（图数）
  const checks =
    plan.tables.length * 3 +
    plan.relations.length * 2 +
    plan.plainText.length +
    plan.displayFields.length +
    plan.enums.length +
    plan.required.length +
    plan.readonly.length +
    plan.booleans.length +
    2 +
    plan.patterns.length
  return { problems, checks }
}

function errorText(res) {
  const msg = res.json?.errors?.[0]?.message
  return msg ? String(msg).slice(0, 160) : String(res.text || '').slice(0, 160)
}
