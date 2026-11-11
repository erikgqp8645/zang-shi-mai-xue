/**
 * 内容层的不变量校验（断言 A1~A4 ＋ 往返）
 *
 * ## 为什么要单独一个模块
 *
 * ① `scripts/content-seed.mjs --check` 要用它；
 * ② `scripts/e2e/content-schema-break.mjs` 要在**故意写坏的库**上用同一份检查，
 *    验证「检查真的能抓到」—— 仓库铁律：新增/修改断言必须先故意写坏验证能抓到。
 *
 * 所以这里**只出结论、不改数据**，由调用方决定往库里写什么坏数据。
 *
 * ## ⭐ 结论的形状
 *
 * 每条结论是 `{ id, msg }`，**不是裸字符串**。`id` 是机器可读的断言编号
 * （`A1`／`A2`／`A3`／`A4`／`RT`），调用方按 `id` 判定「哪条断言抓到了」，
 * 不靠 `msg` 文案匹配 —— 文案会改，`id` 不会。
 */

import { buildContentFromRows, qi, tableDefs } from './content-schema.mjs'

/** 内容表名（只算 `content_*`；`directus_*` 等外来表不管） */
export function contentTableNames(db) {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'content\\_%' ESCAPE '\\'",
    )
    .all()
    .map((r) => r.name)
}

/**
 * 表在不在。
 *
 * ⭐ 检查函数**自己不许崩**：库结构被改坏时（表没了、列没了），
 * 检查器必须**报出问题**而不是抛异常 —— 崩了就变成「没查到问题」，
 * 坏数据反而被放过。所以每一处查表前都要先问一句表在不在。
 */
export function hasTable(db, table) {
  const r = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table)
  return !!r
}

/**
 * 唯一的列组合（用来核对唯一索引）
 *
 *  · `unique: true` 的列 ⇒ 自己一个唯一索引
 *  · 主键 ⇒ 整个主键一个唯一索引，**但有一个例外**：
 *    单列 `INTEGER PRIMARY KEY` 在 SQLite 里是 **rowid 别名**，
 *    SQLite 根本不给它建索引（`PRAGMA index_list` 是空的）——
 *    这种主键靠 `PRAGMA table_info` 的 `pk` 序号核对，不查索引。
 */
function expectedUniqueSets(def) {
  const sets = []
  for (const c of def.columns) if (c.unique) sets.push([c.name])
  const pkCols = def.columns.filter((c) => c.pk)
  if (pkCols.length === 1 && pkCols[0].type === 'integer') return sets // rowid 别名
  if (pkCols.length) sets.push(pkCols.map((c) => c.name).sort())
  return sets
}

/** 库里这张表的唯一索引覆盖了哪些列（按索引分组） */
function actualUniqueSets(db, table) {
  const out = []
  for (const ix of db.prepare(`PRAGMA index_list(${qi(table)})`).all()) {
    if (!ix.unique) continue
    if (ix.partial) continue
    const cols = db
      .prepare(`PRAGMA index_info(${qi(ix.name)})`)
      .all()
      .map((r) => r.name)
      .sort()
    out.push(cols)
  }
  return out
}

/**
 * A1：schema ↔ 库结构一致（表、列、类型、可空性、主键、唯一约束）
 */
export function checkSchemaVsDb(db) {
  const problems = []
  const fail = (id, m) => problems.push({ id, msg: m })
  const defs = tableDefs()
  const actual = new Set(contentTableNames(db))
  for (const def of defs) {
    if (!actual.has(def.table)) {
      fail('A1', `缺表：${def.table}`)
      continue
    }
    const info = db.prepare(`PRAGMA table_info(${def.table})`).all()
    const byName = new Map(info.map((r) => [r.name, r]))
    for (const col of def.columns) {
      const got = byName.get(col.name)
      if (!got) {
        fail('A1', `缺列：${def.table}.${col.name}`)
        continue
      }
      const expectType = { text: 'TEXT', integer: 'INTEGER', bool: 'INTEGER', json: 'TEXT' }[col.type]
      if (String(got.type).toUpperCase() !== expectType) {
        fail('A1', `类型不符：${def.table}.${col.name} 期望 ${expectType}，实际 ${got.type}`)
      }
      // ⚠️ PRAGMA table_info 的 pk 列是**主键内的序号**（0＝不在主键里，
      //    1＝主键第 1 列，2＝第 2 列…），不是布尔。复合主键第 2 列 pk=2。
      const notNull = Number(got.notnull) === 1
      if (col.notNull !== notNull) {
        fail('A1', `可空性不符：${def.table}.${col.name} 期望 notNull=${col.notNull}，实际 ${notNull}`)
      }
      const pk = Number(got.pk) > 0
      if (col.pk !== pk) {
        fail('A1', `主键不符：${def.table}.${col.name} 期望 pk=${col.pk}，实际 ${pk}`)
      }
    }
    const extra = info.map((r) => r.name).filter((n) => !def.columns.some((c) => c.name === n))
    if (extra.length) fail('A1', `多出的列：${def.table}.${extra.join(', ')}`)
    // 唯一约束：漏了它，外键指向（content_alias.target → content_drugs.name）就没法保证唯一
    const gotSets = actualUniqueSets(db, def.table)
    for (const want of expectedUniqueSets(def)) {
      const ok = gotSets.some((s) => s.join(',') === want.join(','))
      if (!ok) {
        fail('A1', `缺唯一约束：${def.table}(${want.join(', ')}) —— 库里没有对应的唯一索引`)
      }
    }
  }
  const known = new Set(defs.map((d) => d.table))
  for (const t of actual) if (!known.has(t)) fail('A1', `库里多出内容表：${t}`)
  return problems
}

/**
 * A2/A3/A4：格位不变量
 *
 *  · A2 每张图固定 18 行（9 部位×取法 × 左右），seq 连续
 *  · A3 组号是**一个共用编号空间**里的组序号（1..N 连续，不允许左右各一套）
 *  · A4 填了用字或符号就必须有组号
 */
export function checkCells(db) {
  const problems = []
  const fail = (id, m) => problems.push({ id, msg: m })
  // 表没了是 A1 的事（缺表已报过），这里不能崩
  if (!hasTable(db, 'content_pulse_cells') || !hasTable(db, 'content_pulse_patterns')) {
    fail('A2', '缺 content_pulse_cells 或 content_pulse_patterns 表，无法核对格位')
    return problems
  }
  const rows = db.prepare('SELECT * FROM content_pulse_cells').all()
  const patterns = db.prepare('SELECT id FROM content_pulse_patterns').all()
  for (const p of patterns) {
    const mine = rows.filter((r) => r.pattern_id === p.id)
    if (mine.length !== 18) {
      fail('A2', `${p.id} 的格位数应为 18（9 部位×取法 × 左右），实际 ${mine.length}`)
    }
    const seqs = mine.map((r) => r.seq).sort((a, b) => a - b)
    const expected = Array.from({ length: 18 }, (_, i) => i)
    if (seqs.join(',') !== expected.join(',')) {
      fail('A2', `${p.id} 的 seq 不连续`)
    }
  }
  for (const r of rows) {
    if ((r.term_id || r.codes) && (r.group_no === null || r.group_no === undefined)) {
      fail(
        'A4',
        `${r.pattern_id}「${r.side}·${r.organ}·${r.depth}」填了用字/符号却没有组号` +
          `（组号是左右共用的一个编号空间里的组序号）`,
      )
    }
  }
  const byPattern = new Map()
  for (const r of rows) {
    if (r.group_no === null || r.group_no === undefined) continue
    if (!byPattern.has(r.pattern_id)) byPattern.set(r.pattern_id, new Map())
    const m = byPattern.get(r.pattern_id)
    const key = `${r.side}|${r.organ}|${r.depth}`
    if (!m.has(r.group_no)) m.set(r.group_no, new Set())
    m.get(r.group_no).add(key)
  }
  for (const [pid, groups] of byPattern) {
    const nos = [...groups.keys()].sort((a, b) => a - b)
    if (nos.join(',') !== nos.map((_, i) => i + 1).join(',')) {
      fail('A3', `${pid} 的组号不是连续的 1..N（实际 ${nos.join(',')}）—— 组号必须是一个编号空间`)
    }
  }
  return problems
}

/**
 * A5：派生代理主键 `id` 与它的派生规则一致
 *
 * 复合键的表（连接表、格位表）都带一个派生的 `id`（＝「父键|序号」）。
 * 这个 `id` 是**算出来的**，不是内容 —— 一旦有人手改了它，
 * 「父键＋序号」和 `id` 就会对不上 ⇒ 断言必须抓到。
 */
export function checkDerivedIds(db) {
  const problems = []
  const fail = (id, m) => problems.push({ id, msg: m })
  for (const def of tableDefs()) {
    if (!def.derivedId) continue
    if (!hasTable(db, def.table)) continue
    const { columns, separator } = def.derivedId
    for (const r of db.prepare(`SELECT * FROM ${qi(def.table)}`).all()) {
      const want = columns.map((c) => String(r[c] ?? '')).join(separator)
      if (r.id !== want) {
        fail('A5', `${def.table} 的 id 与派生规则不符：期望「${want}」，实际「${r.id}」`)
      }
    }
  }
  return problems
}

/** 深比较用：数组保序、对象键排序 */
function norm(v) {
  if (Array.isArray(v)) return v.map(norm)
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = norm(v[k])
    return out
  }
  return v
}

/**
 * 往返：库 → JSON 是否与源 JSON 一致（逐字段）
 *
 * 这条同时验了三件事：落库函数没丢字段、库结构没漂移、导出函数没丢字段。
 */
export function checkRoundTrip(db, content) {
  const problems = []
  const defs = tableDefs()
  const rows = {}
  for (const def of defs) {
    // 表没了是 A1 的事（缺表已报过），这里跳过而不是崩
    if (!hasTable(db, def.table)) continue
    rows[def.table] = db.prepare(`SELECT * FROM ${def.table}`).all()
  }
  const back = buildContentFromRows(rows)
  for (const key of Object.keys(content)) {
    const a = JSON.stringify(norm(back[key]))
    const b = JSON.stringify(norm(content[key]))
    if (a !== b) {
      problems.push({
        id: 'RT',
        msg: `往返不一致：${key}\n    源：${b.slice(0, 300)}\n    回：${a.slice(0, 300)}`,
      })
    }
  }
  return problems
}

/** 跑全部检查 */
export function runChecks(db, content) {
  return [
    ...checkSchemaVsDb(db),
    ...checkCells(db),
    ...checkDerivedIds(db),
    ...checkRoundTrip(db, content),
  ]
}
