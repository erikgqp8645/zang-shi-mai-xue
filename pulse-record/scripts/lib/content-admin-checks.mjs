/**
 * 本地后台（Directus）配置的断言。
 *
 * ⭐ **按结构解析**：看 HTTP 状态码、看 `meta` 里的具体字段值，
 *    不在响应文本里搜关键词 —— 搜词会被无关内容骗过。
 *
 * 每条断言的 id 与 `scripts/e2e/content-admin-break.mjs` 的注入点一一对应，
 * 那边的「故意写坏」就是靠这些 id 验证「坏配置会被抓到」。
 */

/**
 * A6（可读性）—— 每张内容表的列表接口都必须 200。
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
        id: 'A6',
        msg: `${table} 列表接口 ${plain.status}：${errorText(plain)}`,
      })
      continue
    }
    const star = await api(`/items/${table}?limit=1&fields=*`)
    if (!star.ok) {
      problems.push({
        id: 'A6',
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
          id: 'A6',
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
 * A7（关系元数据）—— **所有** content 关系的 `meta.one_field` 必须是 null。
 *
 * 填了就会触发 A6 那个 500（见上面的说明）。
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
    problems.push({ id: 'A7', msg: `关系清单读取失败 ${list.status}` })
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
        id: 'A7',
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
 * A8（字段界面）—— 关系字段必须是 M2O 下拉；指向非主键的必须是普通文本。
 */
export async function checkFieldInterfaces(api, relations, plainText) {
  const problems = []
  for (const rel of relations) {
    const r = await api(`/fields/${rel.manyCollection}/${rel.manyField}`)
    if (!r.ok) {
      problems.push({
        id: 'A8',
        msg: `字段 ${rel.manyCollection}.${rel.manyField} 读取失败 ${r.status}`,
      })
      continue
    }
    const iface = r.json?.data?.meta?.interface
    if (iface !== 'select-dropdown-m2o') {
      problems.push({
        id: 'A8',
        msg: `字段 ${rel.manyCollection}.${rel.manyField} 的界面 = ${JSON.stringify(iface)}，应为 select-dropdown-m2o`,
      })
    }
  }
  for (const pt of plainText) {
    const r = await api(`/fields/${pt.manyCollection}/${pt.manyField}`)
    if (!r.ok) {
      problems.push({
        id: 'A8',
        msg: `字段 ${pt.manyCollection}.${pt.manyField} 读取失败 ${r.status}`,
      })
      continue
    }
    const iface = r.json?.data?.meta?.interface
    if (iface !== 'input') {
      problems.push({
        id: 'A8',
        msg:
          `字段 ${pt.manyCollection}.${pt.manyField} 的界面 = ${JSON.stringify(iface)}，` +
          `应为 input（它存的是 ${pt.oneCollection}.${pt.oneField}，不是主键 ${pt.targetPk}）`,
      })
    }
  }
  return problems
}

/**
 * A9（显示字段）—— 被引用集合的 `display_template` 必须指向 schema 声明的显示列。
 *
 * 没配的话，下拉里显示的是 id（`kc-liushen`）而不是人话（`六神`）。
 */
export async function checkDisplayTemplates(api, displayFields) {
  const problems = []
  for (const df of displayFields) {
    const r = await api(`/collections/${df.collection}`)
    if (!r.ok) {
      problems.push({
        id: 'A9',
        msg: `集合 ${df.collection} 读取失败 ${r.status}`,
      })
      continue
    }
    const template = r.json?.data?.meta?.display_template
    const want = `{{${df.field}}}`
    if (template !== want) {
      problems.push({
        id: 'A9',
        msg: `集合 ${df.collection} 的 display_template = ${JSON.stringify(template)}，应为 ${JSON.stringify(want)}`,
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
  ]
  // 每一项断言的「个数」：表 × 3 种请求 ＋ 关系 × 2 ＋ 文本字段 ＋ 显示字段
  const checks =
    plan.tables.length * 3 +
    plan.relations.length * 2 +
    plan.plainText.length +
    plan.displayFields.length
  return { problems, checks }
}

function errorText(res) {
  const msg = res.json?.errors?.[0]?.message
  return msg ? String(msg).slice(0, 160) : String(res.text || '').slice(0, 160)
}
