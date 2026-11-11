/**
 * 内容层 · 行级对拍（本地库 vs 远端已发布版）
 *
 * ## 干什么
 *
 * 把两份「表名 → 行数组」比一遍，报出每张表的
 * **新增 / 修改 / 删除**。发布命令用它做「②对拍」——
 * 发布前先告诉人「这次会改哪几行」，而不是发完才知道。
 *
 * ## ⭐ 比对必须按**列类型**归一化
 *
 * 两边方言的同名列，值的形状不完全一样：
 *
 *   · JSON 列 —— SQLite 存 TEXT 字符串，PG 是 jsonb 真值
 *   · BOOL 列 —— SQLite 是 0/1，PG 是 true/false
 *   · JSONB 的**对象键会被 PG 重排**（按长度＋字节序）⇒ 同一个对象
 *     在两边的键顺序可能不同，但内容一样 ⇒ 不能直接比字符串
 *
 * 所以比对前一律按 schema 声明的列类型归一化：
 * `json` → 解析后按键排序再比；`bool` → 真假值；其余 → 原样比。
 * 列类型来自 `src/content/schema/*.schema.json`（唯一真源）。
 */

import { canonicalJson, tableDefs } from './content-schema.mjs'

/** 复合主键的分隔符 —— 用不可见字符，避免和值里的字符撞上 */
const KEY_SEP = String.fromCharCode(0)

/**
 * 归一化一个 JSON 值（对象键排序 ⇒ 两边键序不同也能比相等）。
 *
 * @param {*} v 可能是字符串（SQLite）或真 JSON 值（PG）
 * @returns {*} 归一化后的值
 */
function canonJson(v) {
  if (v === null || v === undefined) return null
  const parsed = typeof v === 'string' ? tryParse(v) : v
  return canonicalJson(parsed)
}

function tryParse(s) {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

/**
 * 取一列的「可比值」。
 *
 * @param {object} col  列定义（来自 schema）
 * @param {object} row  行
 * @returns {*} 归一化后的值
 */
export function comparableValue(col, row) {
  const v = row[col.name]
  if (col.type === 'json') return JSON.stringify(canonJson(v))
  if (col.type === 'bool') {
    if (v === null || v === undefined) return null
    if (typeof v === 'string') return v === 'true' || v === '1'
    return !!v
  }
  if (v === undefined) return null
  if (v === null) return null
  if (typeof v === 'object') return JSON.stringify(canonicalJson(v))
  return v
}

/** 一行的主键值（复合键拼成一个字符串） */
export function rowKey(def, row) {
  const pks = def.columns.filter((c) => c.pk)
  if (!pks.length) return null
  return pks.map((c) => String(row[c.name] ?? '')).join(KEY_SEP)
}

/** 两行是否完全相同（逐列比） */
export function sameRow(def, a, b) {
  for (const c of def.columns) {
    if (comparableValue(c, a) !== comparableValue(c, b)) return false
  }
  return true
}

/**
 * 对拍两份行集合。
 *
 * @param {Record<string, object[]>} localRows  本地库的行
 * @param {Record<string, object[]>} remoteRows 远端的行
 * @param {object[]} [defs] 表定义（默认取 schema 的拓扑序）
 * @returns {Record<string, {added: object[], modified: object[], removed: object[], total: number}>}
 */
export function diffRows(localRows, remoteRows, defs = tableDefs()) {
  const out = {}
  for (const def of defs) {
    const local = localRows[def.table] || []
    const remote = remoteRows[def.table] || []
    const localMap = new Map()
    const remoteMap = new Map()
    for (const r of local) localMap.set(rowKey(def, r), r)
    for (const r of remote) remoteMap.set(rowKey(def, r), r)

    const added = []
    const modified = []
    const removed = []
    for (const [k, r] of localMap) {
      if (!remoteMap.has(k)) added.push(r)
      else if (!sameRow(def, r, remoteMap.get(k))) modified.push(r)
    }
    for (const [k, r] of remoteMap) if (!localMap.has(k)) removed.push(r)

    out[def.table] = { added, modified, removed, total: added.length + modified.length + removed.length }
  }
  return out
}

/** 汇总：改了多少行 */
export function diffTotals(diff) {
  let added = 0
  let modified = 0
  let removed = 0
  for (const t of Object.values(diff)) {
    added += t.added.length
    modified += t.modified.length
    removed += t.removed.length
  }
  return { added, modified, removed, total: added + modified + removed }
}
