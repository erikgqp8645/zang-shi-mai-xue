/**
 * 内容层 schema —— **机器可读的真源**
 *
 * ## 干什么
 *
 * 把 `src/content/*.json`（8 个内容文件）映射成**关系表**，
 * 并由同一份描述生成**两套方言**的建表 DDL：
 *
 *   · SQLite（本地编辑库 `local-data/content.sqlite`）
 *   · PostgreSQL（远端 CloudBase PG 的 `content_*` 表）
 *
 * 本地表与远端表**同名同列同语义** ⇒ 发布脚本是「同构 → 同构」的直接搬运，
 * 不需要任何转换规则，两边也不会漂移。
 *
 * ## ⭐ 为什么这个模块住在 `server/`
 *
 * 两个消费者：
 *
 *   · `scripts/` 侧 —— 灌库（content-seed）、断言（content-checks）、发布命令
 *   · `server/` 侧  —— `GET /api/content` 的读取层（云函数里也跑）
 *
 * 云函数包**只拷 `server/` 顶层的 `.mjs`／`.sql`**（见 scripts/build-cloudfunction.mjs），
 * 所以模块放在 `scripts/lib/` 的话，云端根本 import 不到 ⇒ 放在 `server/`。
 *
 * 路径上不用做任何分支：`ROOT = join(HERE, '..', '..')`
 *   · 仓库里      → `pulse-record/`      ⇒ `pulse-record/src/content/schema`
 *   · 云函数包里  → `.cloudfn/pulse-api/` ⇒ `.cloudfn/pulse-api/src/content/schema`
 *
 * 构建脚本把 `src/content/schema/` 原样拷到包里的同一相对位置 ⇒ **同一份代码在两处都找得到 schema**。
 * `scripts/lib/content-schema.mjs` 只是转发壳（不动既有调用方）。
 *
 * ## 为什么表定义写在 schema 文件里
 *
 * 8 个 `src/content/schema/*.schema.json` 既是内容的 JSON Schema（`$schema` 指向它们），
 * 又带一个 `x-tables` 扩展段描述**关系形状**。这样：
 *
 *   · 内容文件自己声明的 `$schema` 真的存在了（以前指向不存在的文件）
 *   · 表结构只有一份描述 ⇒ DDL、落库、导出、断言都用它
 *   · `x-tables` 的每一列都带一个 `json` 指针（指向内容 JSON 里的来源路径），
 *     断言脚本据此核对「schema ↔ 落库函数 ↔ 库结构」三者一致
 *
 * ## ⭐ 两条不能省的纪律
 *
 * 1. **组成／比例不拆列**。`composition`、`ratio`、`science` 都是**原文照录的一整串**
 *    （实测 475 个 token 里 13 个带量程、括注、单位、组合方引用、整段散文），
 *    拆成「药味＋克数」会丢原文 ⇒ 一律存文本。
 * 2. **`formulas[]` 不是外键**。它是**原文方名写法**（98 个取值里只有 12 个对得上方剂名），
 *    界面靠按名解析、查不到就明说「未载」⇒ 存文本 `formula_text`，不建 dose 外键。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// ⚠️ 只往上走**一层**：`server/` 正好在仓库根下面。
//   仓库里     → `pulse-record/`      ⇒ `pulse-record/src/content/schema`
//   云函数包里 → `.cloudfn/pulse-api/` ⇒ `.cloudfn/pulse-api/src/content/schema`
// 两处 `server/` 的深度一致 ⇒ 同一行代码在两处都成立，不需要分支。
export const ROOT = join(HERE, '..')
export const CONTENT_DIR = join(ROOT, 'src', 'content')
export const SCHEMA_DIR = join(CONTENT_DIR, 'schema')

/** 列类型 → 两套方言 */
const TYPE_MAP = {
  text: { sqlite: 'TEXT', pg: 'TEXT' },
  integer: { sqlite: 'INTEGER', pg: 'INTEGER' },
  bool: { sqlite: 'INTEGER', pg: 'BOOLEAN' },
  json: { sqlite: 'TEXT', pg: 'JSONB' },
}

/** 讲义 p34 的 9 行版体例（与 `src/domain/layout.ts` 的 LAYOUTS.nine 一致） */
export const LAYOUT_NINE = [
  ['寸', '浮'],
  ['寸', '中'],
  ['寸', '沉'],
  ['关', '浮'],
  ['关', '中'],
  ['关', '沉'],
  ['尺', '浮'],
  ['尺', '中'],
  ['尺', '沉'],
]

/** 每张脉象图的格位数 ＝ 9 行 × 左右 = 18 */
export const CELLS_PER_PATTERN = LAYOUT_NINE.length * 2

/* ------------------------------------------------------------------ *
 * 读 schema
 * ------------------------------------------------------------------ */

/** 读全部 schema 文件 */
export function loadSchemaFiles(dir = SCHEMA_DIR) {
  const out = []
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.schema.json')) continue
    const file = join(dir, name)
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    out.push({ file, name: name.replace(/\.schema\.json$/, ''), raw })
  }
  return out
}

/**
 * 展平所有 schema 里的表定义，按**依赖顺序**排好（被引用的表在前）。
 *
 * 依赖顺序很重要：本地 SQLite 开 `foreign_keys=ON` 时，
 * 插入顺序必须满足外键；远端 PG 也要先建被引用的表。
 */
export function tableDefs(dir = SCHEMA_DIR) {
  const files = loadSchemaFiles(dir)
  const defs = []
  for (const f of files) {
    for (const t of f.raw['x-tables'] || []) {
      defs.push({
        table: t.name,
        comment: t.comment || '',
        columns: t.columns.map((c) => ({
          name: c.name,
          type: c.type,
          notNull: !!c.notNull,
          pk: !!c.pk,
          unique: !!c.unique,
          enum: c.enum || null,
          fk: c.fk || null,
          json: c.json || null,
          comment: c.comment || '',
        })),
        // ⭐ 派生代理主键规则（复合键 → 单列 id）。
        //   规则写在 schema 里（唯一来源），落库/导出/断言都从这里读。
        derivedId: t.derivedId || null,
        // ⭐ 下拉框里显示哪一列（Directus 的「显示字段」）。
        //   本表被别的表当外键指向时，后台下拉要显示人看得懂的那一列
        //   （科中名、方名、图名、用字名），而不是 id。
        displayField: t.displayField || null,
        source: f.name,
      })
    }
  }
  return orderByDependency(defs)
}

/**
 * 某张表的「显示字段」—— 后台下拉框里给人看的那一列。
 *
 * 声明在 schema 的 `x-tables[].displayField`（唯一来源）。
 * 没声明就回落到主键 —— 主键本身就是人话时（如 `content_pulse_terms.key`
 * 存的就是「大或顶」「虚脏」），不需要额外指定。
 */
export function displayFieldOf(defs, table) {
  const def = defs.find((d) => d.table === table)
  if (!def) return null
  if (def.displayField) return def.displayField
  return def.columns.find((c) => c.pk)?.name || null
}

/** 拓扑排序：被外键引用的表排在前面 */
function orderByDependency(defs) {
  const byName = new Map(defs.map((d) => [d.table, d]))
  const deps = new Map(
    defs.map((d) => [
      d.table,
      new Set(d.columns.map((c) => c.fk?.table).filter((t) => t && t !== d.table)),
    ]),
  )
  const out = []
  const done = new Set()
  const visiting = new Set()
  function visit(name) {
    if (done.has(name)) return
    if (visiting.has(name)) throw new Error(`schema 外键成环：${name}`)
    visiting.add(name)
    for (const dep of deps.get(name) || []) if (byName.has(dep)) visit(dep)
    visiting.delete(name)
    done.add(name)
    out.push(byName.get(name))
  }
  for (const d of defs) visit(d.table)
  return out
}

/* ------------------------------------------------------------------ *
 * DDL
 * ------------------------------------------------------------------ */

/**
 * 给标识符加双引号。
 *
 * 必须加：内容里就有叫 `group` 的列（`content_symbols.group`，讲义 p34 的符号分组），
 * 而 `GROUP` 是 SQL 保留字 —— 不加引号直接建表就报语法错。
 * 两套方言都吃双引号；我们的标识符全小写，加引号不会带来大小写问题。
 */
export function qi(name) {
  return `"${String(name).replace(/"/g, '""')}"`
}

/** 一列的 SQL 片段 */
function columnSql(col, dialect) {
  const t = TYPE_MAP[col.type]?.[dialect]
  if (!t) throw new Error(`未知列类型 ${col.type}（表 ${col.table}）`)
  let s = `${qi(col.name)} ${t}`
  if (col.notNull) s += ' NOT NULL'
  if (col.unique && !col.pk) s += ' UNIQUE'
  return s
}

/**
 * 一张表的 CREATE TABLE 语句
 *
 * @param def     表定义
 * @param dialect 'sqlite' | 'pg'
 * @param schema  表所在 schema（null ＝ 不限定，SQLite 没有 schema 概念）
 */
export function createTableSql(def, dialect, schema = null) {
  const cols = def.columns.map((c) => columnSql(c, dialect))
  const pks = def.columns.filter((c) => c.pk).map((c) => qi(c.name))
  if (pks.length) cols.push(`PRIMARY KEY (${pks.join(', ')})`)
  for (const c of def.columns) {
    if (!c.fk) continue
    // 外键目标也要限定到同一个 schema（PG 下 `content` schema 里的表引用同 schema 的表）
    const target = schema ? `${qi(schema)}.${qi(c.fk.table)}` : qi(c.fk.table)
    cols.push(`FOREIGN KEY (${qi(c.name)}) REFERENCES ${target}(${qi(c.fk.column)})`)
  }
  const name = schema ? `${qi(schema)}.${qi(def.table)}` : qi(def.table)
  return `CREATE TABLE IF NOT EXISTS ${name} (\n  ${cols.join(',\n  ')}\n);`
}

/**
 * 全部建表语句
 *
 * @param dialect 'sqlite' | 'pg'
 * @param opts    { dir, schema } —— schema 只对 PG 有意义
 */
export function createAllSql(dialect, opts = {}) {
  const { dir = SCHEMA_DIR, schema = null } = opts
  const defs = tableDefs(dir)
  const out = []
  for (const d of defs) {
    out.push(
      `-- ${schema ? `${schema}.` : ''}${d.table}${d.comment ? ` · ${d.comment}` : ''}（来自 ${d.source}.schema.json）`,
    )
    out.push(createTableSql(d, dialect, schema))
  }
  return out.join('\n\n')
}

/**
 * 删掉全部内容表（重建用；**不碰** directus_* 等外来表）
 *
 * @param dialect 'sqlite' | 'pg'
 * @param opts    { dir, schema }
 */
export function dropAllSql(dialect, opts = {}) {
  const { dir = SCHEMA_DIR, schema = null } = opts
  const defs = tableDefs(dir)
  const out = []
  for (const d of [...defs].reverse()) {
    const name = schema ? `${qi(schema)}.${qi(d.table)}` : qi(d.table)
    out.push(`DROP TABLE IF EXISTS ${name}${dialect === 'pg' ? ' CASCADE' : ''};`)
  }
  return out.join('\n')
}

/* ------------------------------------------------------------------ *
 * 内容 JSON → 行
 * ------------------------------------------------------------------ */

/** 读 8 个内容文件 */
export function loadContent(dir = CONTENT_DIR) {
  const names = [
    'doses',
    'drugs',
    'formula-reference',
    'formula-rules',
    'pulse-groups',
    'pulse-patterns',
    'pulse-terms',
    'symbols',
  ]
  const out = {}
  for (const n of names) out[n] = JSON.parse(readFileSync(join(dir, `${n}.json`), 'utf8'))
  return out
}

/** 原样字符串 / 可空 */
function opt(v) {
  return v === undefined || v === null ? null : v
}

/**
 * 去掉值为 null 的键。
 *
 * ⭐ 「原文没写」在 JSON 里表现为**键不存在**，不是 `null`。
 * 空值与缺省语义要保真（AGENTS.md）⇒ 导出时一律把 null 键删掉。
 */
function stripNulls(obj) {
  const out = {}
  for (const k of Object.keys(obj)) if (obj[k] !== null && obj[k] !== undefined) out[k] = obj[k]
  return out
}

/**
 * 解析一个 **JSON 列**的值。
 *
 * ⭐ 两边方言的 JSON 列形状**不一样**：
 *
 *   · SQLite —— `json` 型落成 TEXT，存的是**字符串** `'["甲","乙"]'`
 *   · PG     —— `jsonb` 列，读回来**已经是** JSON 值（数组／对象）
 *
 * 两边共用同一个 codec（`buildContentFromRows`）⇒ 这里两种都收。
 * 这就是「跨进程形状在边界上规整」：方言差异在边界抹平，里面只认一种形状。
 *
 * @param {*} v 列的原始值
 * @returns {*} 解析后的 JSON 值（null / 数组 / 对象）
 */
export function parseJsonColumn(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return JSON.parse(v)
  return v
}

/**
 * 每张表里 **JSON 型**的列名（方言差异只发生在这几列上）。
 *
 * 依据是 schema 的列类型（`type: 'json'`）⇒ 唯一真源。
 */
export function jsonColumnMap(dir = SCHEMA_DIR) {
  const map = {}
  for (const def of tableDefs(dir)) {
    const cols = def.columns.filter((c) => c.type === 'json').map((c) => c.name)
    if (cols.length) map[def.table] = cols
  }
  return map
}

/**
 * SQLite 行 → **发布载荷**行：把 JSON 列从「JSON 字符串」还原成「JSON 值」。
 *
 * ## 为什么发布前要还原
 *
 * 本地库（SQLite）的 JSON 列存的是 TEXT；PG 那边的列是 `jsonb`。
 * 如果直接把 TEXT 当字符串发过去，PG 存进去的就是一个 **JSON 字符串**
 * （`"[\"甲\",\"乙\"]"`），不是数组 —— 线上读到的东西形状就变了。
 *
 * 还原成真 JSON 之后再发，PG 存进去的才是正经的 jsonb 数组。
 *
 * @param {Record<string, object[]>} rows 库里的行（`{ 表名: [行] }`）
 * @returns {Record<string, object[]>} 载荷行
 */
export function rowsToPayload(rows) {
  const jcols = jsonColumnMap()
  const out = {}
  for (const [table, list] of Object.entries(rows)) {
    const cols = jcols[table] || []
    out[table] = (list || []).map((row) => {
      const r = { ...row }
      for (const c of cols) {
        if (typeof r[c] !== 'string') continue
        try {
          r[c] = JSON.parse(r[c])
        } catch {
          // 不是合法 JSON（不该发生，断言 A1 会盯住）⇒ 原样带过去，别让发布整个挂掉
        }
      }
      return r
    })
  }
  return out
}

/**
 * 深比较用：数组保序、**对象键排序**。
 *
 * ## 为什么键要排序
 *
 * PG 的 `jsonb` 会**重排对象键**（按长度＋字节序）⇒ 同一个对象，
 * 在 SQLite（JSON 字符串，键序＝写入序）和 PG（jsonb，键序＝PG 排的）
 * 里的**字符串不一样**，但内容一样 ⇒ 直接比字符串会误判成「有差异」。
 *
 * ⭐ 这一个函数是**内容层唯一的 JSON 归一化实现** ——
 *   断言（content-checks）、对拍（content-diff）、三方对拍（publish）都用它。
 *   能合成一个来源的，绝不留在两处。
 *
 * @param {*} v 任意 JSON 值
 * @returns {*} 归一化后的值（对象键已排序）
 */
export function canonicalJson(v) {
  if (Array.isArray(v)) return v.map(canonicalJson)
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = canonicalJson(v[k])
    return out
  }
  return v
}

/**
 * 内容 JSON → 各表的行。
 *
 * 返回 `{ 表名: 行数组 }`，顺序与 `tableDefs()` 一致。
 */
export function buildRows(content) {
  const rows = {}
  const doses = content.doses
  const rules = content['formula-rules'].rules
  const patterns = content['pulse-patterns'].patterns
  const terms = content['pulse-terms'].terms

  // 科学中药名 → id（scienceByDoseId 按**名字**引用，名字唯一）
  const scienceByName = new Map(doses.sciences.map((s) => [s.name, s.id]))

  rows.content_sciences = doses.sciences.map((s) => ({
    id: s.id,
    name: s.name,
    ratio: s.ratio,
    page: opt(s.page),
  }))

  rows.content_doses = doses.doses.map((d) => ({
    id: d.id,
    name: d.name,
    composition: d.composition,
    page: opt(d.page),
    notes: d.notes ? JSON.stringify(d.notes) : null,
    science_id: opt(scienceByName.get(doses.scienceByDoseId?.[d.id])),
  }))

  rows.content_drugs = content.drugs.drugs.map((d) => ({
    id: d.id,
    name: d.name,
    therapy: d.therapy,
    usage: opt(d.usage),
    indication: opt(d.indication),
    composition: opt(d.composition),
    science: opt(d.science),
    adjustments: d.adjustments ? JSON.stringify(d.adjustments) : null,
    contraindication: opt(d.contraindication),
    source: d.source,
    quote: d.quote,
  }))

  rows.content_formula_rules = rules.map((r) => ({
    id: r.id,
    route: r.route,
    condition: r.condition,
    therapy: r.therapy,
    kind: r.kind,
    source: r.source,
    quote: r.quote,
    always: r.always === undefined ? null : r.always ? 1 : 0,
    adds: r.adds ? JSON.stringify(r.adds) : null,
  }))

  // 方名是**原文写法**，不是外键 ⇒ 存文本
  rows.content_rule_formulas = []
  rows.content_rule_drugs = []
  for (const r of rules) {
    r.formulas.forEach((f, i) => {
      rows.content_rule_formulas.push({ rule_id: r.id, seq: i, formula_text: f })
    })
    ;(r.drugs || []).forEach((d, i) => {
      rows.content_rule_drugs.push({ rule_id: r.id, seq: i, drug_id: d })
    })
  }

  const ref = content['formula-reference']
  rows.content_formula_reference = ref.rows.map((r) => ({
    no: r.no,
    name: r.name,
    indication: r.indication,
    dose_id: opt(r.doseId),
    dose_basis: opt(r.doseBasis),
    draft_name: opt(r.draftName),
    draft_note: opt(r.draftNote),
  }))
  rows.content_alias = Object.entries(ref.alias).map(([alias, target]) => ({ alias, target }))
  rows.content_draft_extra = Object.entries(ref.draftExtra).map(([id, d]) => ({
    id,
    name: opt(d.name),
    composition: opt(d.composition),
    source: opt(d.source),
    note: opt(d.note),
  }))

  rows.content_pulse_groups = content['pulse-groups'].groups.map((g) => ({
    id: g.id,
    name: g.name,
    ref: opt(g.ref),
    source: g.source,
  }))
  rows.content_group_positions = []
  content['pulse-groups'].groups.forEach((g) => {
    g.positions.forEach((pos, i) => {
      const [hand, organ] = pos.split('|')
      rows.content_group_positions.push({ group_id: g.id, seq: i, hand, organ })
    })
  })

  rows.content_pulse_terms = Object.entries(terms).map(([key, t]) => ({
    key,
    display: t.display,
    note: opt(t.note),
  }))
  rows.content_term_codes = []
  rows.content_term_also = []
  for (const [key, t] of Object.entries(terms)) {
    ;(t.codes || []).forEach((code, i) => {
      rows.content_term_codes.push({ term_key: key, seq: i, code })
    })
    ;(t.also || []).forEach((code, i) => {
      rows.content_term_also.push({ term_key: key, seq: i, code })
    })
  }

  rows.content_symbols = content.symbols.symbols.map((s) => ({
    code: s.code,
    label: s.label,
    group: s.group,
    hint: opt(s.hint),
  }))

  rows.content_pulse_patterns = Object.entries(patterns).map(([id, p]) => ({
    id,
    title: p.title,
    source: p.source,
    note: opt(p.note),
    relations: p.relations ? JSON.stringify(p.relations) : null,
  }))

  // 格位：每图固定 18 行（9 部位×取法 × 左右），缺的补空行
  rows.content_pulse_cells = []
  for (const [id, p] of Object.entries(patterns)) {
    const cellMap = new Map()
    for (const c of p.cells || []) cellMap.set(c.cell, c)
    const groupOf = new Map()
    ;(p.groups || []).forEach((grp, gi) => {
      grp.forEach((k) => groupOf.set(k, gi + 1))
    })
    let seq = 0
    for (const side of ['L', 'R']) {
      for (const [organ, depth] of LAYOUT_NINE) {
        const c = cellMap.get(`${side}|${organ}|${depth}`)
        rows.content_pulse_cells.push({
          pattern_id: id,
          seq: seq++,
          organ,
          depth,
          side,
          term_id: c && c.term ? c.term : null,
          codes: c && c.codes ? JSON.stringify(c.codes) : null,
          group_no: groupOf.has(`${side}|${organ}|${depth}`)
            ? groupOf.get(`${side}|${organ}|${depth}`)
            : null,
          note: opt(c && c.note),
          flex: c && c.flex !== undefined ? (c.flex ? 1 : 0) : null,
        })
      }
    }
  }

  // ⭐ 派生代理主键：id = 「列1|列2」。
  //   复合键的表（连接表、格位表）在 Directus 里会被**整表忽略**
  //   （Directus 只认单列主键），所以统一加一个代理键。
  //   规则来自 schema 的 `x-tables.derivedId` —— 唯一来源，代码里不再另写一份。
  for (const def of tableDefs()) {
    if (!def.derivedId) continue
    const { columns, separator } = def.derivedId
    for (const row of rows[def.table] || []) {
      row.id = columns.map((c) => String(row[c] ?? '')).join(separator)
    }
  }

  return rows
}

/* ------------------------------------------------------------------ *
 * 库 → 内容 JSON（导出用；与 buildRows 互为逆运算）
 * ------------------------------------------------------------------ */

/** 读表 → 行数组（对象） */
export function readTable(db, table) {
  return db.prepare(`SELECT * FROM ${table}`).all()
}

/**
 * 从库里读回内容 JSON。
 *
 * 与 `buildRows` 严格互逆 —— 这是「本地库 → JSON 快照」那一步，
 * 也是断言 A9（逐字段一致）的依据。
 */
export function buildContentFromRows(inputRows) {
  // ⭐ 缺表按空表处理（表没了是 A1 的事）⇒ 补空数组，别让导出函数崩。
  //   崩了等于「没查到问题」，坏数据反而被放过。
  const rows = { ...inputRows }
  for (const def of tableDefs()) if (!rows[def.table]) rows[def.table] = []

  const doses = { doses: [], sciences: [], scienceByDoseId: {} }
  const scienceNameById = new Map(rows.content_sciences.map((s) => [s.id, s.name]))
  for (const d of rows.content_doses) {
    const { science_id: scienceId, notes, ...rest } = d
    const dose = { ...rest }
    if (notes) dose.notes = parseJsonColumn(notes)
    doses.doses.push(stripNulls(dose))
    if (scienceId && scienceNameById.has(scienceId)) {
      doses.scienceByDoseId[d.id] = scienceNameById.get(scienceId)
    }
  }
  doses.sciences = rows.content_sciences.map((s) => stripNulls({ ...s }))

  const drugs = rows.content_drugs.map((d) => {
    const { adjustments, ...rest } = d
    const out = { ...rest }
    if (adjustments) out.adjustments = parseJsonColumn(adjustments)
    return stripNulls(out)
  })

  const rules = rows.content_formula_rules.map((r) => {
    const { always, adds, ...rest } = r
    const out = { ...rest }
    if (always !== null && always !== undefined) out.always = !!always
    if (adds) out.adds = parseJsonColumn(adds)
    const formulas = rows.content_rule_formulas
      .filter((f) => f.rule_id === r.id)
      .sort((a, b) => a.seq - b.seq)
      .map((f) => f.formula_text)
    const drugIds = rows.content_rule_drugs
      .filter((d) => d.rule_id === r.id)
      .sort((a, b) => a.seq - b.seq)
      .map((d) => d.drug_id)
    out.formulas = formulas
    if (drugIds.length) out.drugs = drugIds
    return stripNulls(out)
  })

  const refRows = rows.content_formula_reference.map((r) => {
    const {
      dose_id: doseId,
      dose_basis: doseBasis,
      draft_name: draftName,
      draft_note: draftNote,
      ...rest
    } = r
    const out = { ...rest }
    if (doseId) out.doseId = doseId
    if (doseBasis) out.doseBasis = doseBasis
    if (draftName) out.draftName = draftName
    if (draftNote) out.draftNote = draftNote
    return stripNulls(out)
  })
  const alias = {}
  for (const a of rows.content_alias) alias[a.alias] = a.target
  const draftExtra = {}
  for (const d of rows.content_draft_extra) {
    const { id, ...rest } = d
    draftExtra[id] = stripNulls({ ...rest })
  }

  const groups = rows.content_pulse_groups.map((g) => {
    const positions = rows.content_group_positions
      .filter((p) => p.group_id === g.id)
      .sort((a, b) => a.seq - b.seq)
      .map((p) => `${p.hand}|${p.organ}`)
    const out = { id: g.id, name: g.name, positions }
    if (g.ref) out.ref = g.ref
    out.source = g.source
    return stripNulls(out)
  })

  const patterns = {}
  for (const p of rows.content_pulse_patterns) {
    const cells = rows.content_pulse_cells
      .filter((c) => c.pattern_id === p.id && (c.term_id || c.codes))
      .sort((a, b) => a.seq - b.seq)
      .map((c) => {
        const cell = { cell: `${c.side}|${c.organ}|${c.depth}`, term: c.term_id || '' }
        if (c.codes) cell.codes = parseJsonColumn(c.codes)
        if (c.note) cell.note = c.note
        if (c.flex !== null && c.flex !== undefined) cell.flex = !!c.flex
        return cell
      })
    const groupMap = new Map()
    for (const c of rows.content_pulse_cells) {
      if (c.pattern_id !== p.id || c.group_no === null || c.group_no === undefined) continue
      const key = `${c.side}|${c.organ}|${c.depth}`
      if (!groupMap.has(c.group_no)) groupMap.set(c.group_no, [])
      groupMap.get(c.group_no).push(key)
    }
    const groupsArr = [...groupMap.keys()].sort((a, b) => a - b).map((k) => groupMap.get(k))
    const out = { title: p.title, cells }
    if (groupsArr.length) out.groups = groupsArr
    if (p.relations) out.relations = parseJsonColumn(p.relations)
    out.source = p.source
    if (p.note) out.note = p.note
    patterns[p.id] = stripNulls(out)
  }

  const terms = {}
  for (const t of rows.content_pulse_terms) {
    const codes = rows.content_term_codes
      .filter((c) => c.term_key === t.key)
      .sort((a, b) => a.seq - b.seq)
      .map((c) => c.code)
    const also = rows.content_term_also
      .filter((c) => c.term_key === t.key)
      .sort((a, b) => a.seq - b.seq)
      .map((c) => c.code)
    const out = { codes, display: t.display }
    if (also.length) out.also = also
    if (t.note) out.note = t.note
    terms[t.key] = stripNulls(out)
  }

  const symbols = rows.content_symbols.map((s) => {
    const out = { code: s.code, label: s.label, group: s.group }
    if (s.hint) out.hint = s.hint
    return stripNulls(out)
  })

  // ⭐ 每个文件都带上 `$schema` 指针（指向自己那份 schema 文件）
  const withSchema = (name, body) => ({ $schema: `./schema/${name}.schema.json`, ...body })

  return {
    doses: withSchema('doses', doses),
    drugs: withSchema('drugs', { drugs }),
    'formula-reference': withSchema('formula-reference', {
      rows: refRows,
      alias,
      draftExtra,
    }),
    'formula-rules': withSchema('formula-rules', { rules }),
    'pulse-groups': withSchema('pulse-groups', { groups }),
    'pulse-patterns': withSchema('pulse-patterns', { patterns }),
    'pulse-terms': withSchema('pulse-terms', { terms }),
    symbols: withSchema('symbols', { symbols }),
  }
}
