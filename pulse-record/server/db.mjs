/**
 * 病例记录库（SQLite）—— 永久存储层
 *
 * 存盘位置：pulse-record/local-data/history.sqlite（运行产物，不进版本库）
 * 依赖：Node 22+ 内置 node:sqlite（DatabaseSync），无原生模块、无第三方依赖。
 *
 * 两级结构（表结构见 server/schema.sql）：
 *   patient  一位受检者/患者
 *   visit    该患者的一次就诊记录（日期标签 ＋ 这次的脉象符号）
 * 这里只做读写，不含业务判断。
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(here, '..')
export const DB_PATH = process.env.PULSE_DB ?? join(ROOT, 'local-data', 'history.sqlite')

/** 打开数据库（首次自动建库建表） */
export function openDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true })
  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'))
  return db
}

function parseValues(json) {
  try {
    const v = JSON.parse(json)
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

/** 一次就诊记录 */
function rowToVisit(row) {
  return {
    id: row.id,
    label: row.label,
    at: Number(row.at),
    values: parseValues(row.pulse_values),
  }
}

/** 一位患者 ＋ 其全部就诊记录 */
function rowToPatient(db, row) {
  const visits = db
    .prepare('SELECT id, label, at, pulse_values FROM visits WHERE patient_id = ? ORDER BY seq, at')
    .all(row.id)
    .map(rowToVisit)
  return {
    id: row.id,
    name: row.name,
    layout: row.layout,
    at: visits.length ? visits[visits.length - 1].at : Number(row.updated_at),
    visits,
  }
}

/** 患者列表（含就诊次数与最近一次记录时间），按最近记录时间倒序 */
export function listPatients(db) {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.layout, p.updated_at,
              (SELECT COUNT(*) FROM visits v WHERE v.patient_id = p.id) AS visit_count,
              (SELECT MAX(v.at) FROM visits v WHERE v.patient_id = p.id) AS last_at
         FROM patients p
        ORDER BY COALESCE(last_at, p.updated_at) DESC`,
    )
    .all()
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    layout: r.layout,
    visitCount: Number(r.visit_count),
    at: Number(r.last_at ?? r.updated_at),
  }))
}

/**
 * 搜索：按关键字找患者与其就诊记录。
 * 命中口径 —— 患者姓名包含关键字，或某次就诊的日期标签包含关键字，或该次脉象里出现过该符号（如「↑」「X」）。
 * 返回的每个患者带 matchType：all（无关键字，列出全部）／name（姓名命中）／visit（有次记录命中）。
 */
export function searchPatients(db, q) {
  const kw = String(q ?? '').trim()
  if (!kw) {
    return listPatients(db).map((p) => ({ ...p, matchType: 'all', matchedVisits: [] }))
  }
  const rows = db.prepare('SELECT id, name, layout, updated_at FROM patients').all()
  const out = []
  for (const r of rows) {
    const visits = db
      .prepare('SELECT id, label, at, pulse_values FROM visits WHERE patient_id = ? ORDER BY seq, at')
      .all(r.id)
    const nameHit = r.name.includes(kw)
    const hitVisits = visits.filter((v) => v.label.includes(kw) || String(v.pulse_values).includes(kw))
    if (!nameHit && hitVisits.length === 0) continue
    out.push({
      id: r.id,
      name: r.name,
      layout: r.layout,
      visitCount: visits.length,
      at: visits.length ? Number(visits[visits.length - 1].at) : Number(r.updated_at),
      matchType: nameHit ? 'name' : 'visit',
      matchedVisits: hitVisits.map((v) => ({ id: v.id, label: v.label, at: Number(v.at) })),
    })
  }
  out.sort((a, b) => b.at - a.at)
  return out
}

export function getPatient(db, id) {
  const row = db.prepare('SELECT id, name, layout, updated_at FROM patients WHERE id = ?').get(id)
  return row ? rowToPatient(db, row) : null
}

export function getVisit(db, id) {
  const row = db.prepare('SELECT id, patient_id, label, at, pulse_values FROM visits WHERE id = ?').get(id)
  if (!row) return null
  return { ...rowToVisit(row), patientId: row.patient_id }
}

/**
 * 存一位患者及其就诊记录（整份覆盖语义）：
 * - 已存在的 visit（同 id）更新；新 visit 插入；库里多出来、本次没有的 visit 删除
 * - patients 行不存在则新建
 */
export function putPatient(db, patient) {
  const now = Date.now()
  const id = patient.id || `p${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const layout = patient.layout === 'seven' ? 'seven' : 'nine'
  const visits = Array.isArray(patient.visits) ? patient.visits : []

  db.exec('BEGIN')
  try {
    const exists = db.prepare('SELECT id FROM patients WHERE id = ?').get(id)
    if (exists) {
      db.prepare('UPDATE patients SET name = ?, layout = ?, updated_at = ? WHERE id = ?').run(
        patient.name || '未命名',
        layout,
        now,
        id,
      )
    } else {
      db.prepare('INSERT INTO patients (id, name, layout, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        id,
        patient.name || '未命名',
        layout,
        now,
        now,
      )
    }

    const keep = new Set()
    const upsert = db.prepare(
      `INSERT INTO visits (id, patient_id, label, at, pulse_values, seq)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET label = excluded.label, at = excluded.at,
         pulse_values = excluded.pulse_values, seq = excluded.seq, patient_id = excluded.patient_id`,
    )
    visits.forEach((v, i) => {
      const vid = v.id || `v${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`
      keep.add(vid)
      upsert.run(vid, id, v.label || '', Number(v.at) || now, JSON.stringify(v.values ?? {}), i)
    })

    // 本次没有的旧记录：删掉（患者级编辑语义）
    const olds = db.prepare('SELECT id FROM visits WHERE patient_id = ?').all(id)
    const del = db.prepare('DELETE FROM visits WHERE id = ?')
    for (const o of olds) if (!keep.has(o.id)) del.run(o.id)

    // 用药记录：整份覆盖（挂在本次的 visits 上；被删掉的 visit 其用药随之级联删除）
    writeMedicationRows(db, id, patient.medications, null)

    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return getPatient(db, id)
}

/** 只改某一次就诊记录（单次编辑语义，不动该患者的其它次） */
export function putVisit(db, id, patch) {
  const cur = getVisit(db, id)
  if (!cur) return null
  const label = typeof patch.label === 'string' ? patch.label : cur.label
  const values = patch.values && typeof patch.values === 'object' ? patch.values : cur.values
  const at = Number(patch.at) || cur.at
  db.exec('BEGIN')
  try {
    db.prepare('UPDATE visits SET label = ?, pulse_values = ?, at = ? WHERE id = ?').run(
      label,
      JSON.stringify(values),
      at,
      id,
    )
    db.prepare('UPDATE patients SET updated_at = ? WHERE id = ?').run(Date.now(), cur.patientId)
    // 用药：只写回这一次的（该患者其它次的用药不动）
    if (Array.isArray(patch.medications)) {
      writeMedicationRows(db, cur.patientId, patch.medications, id)
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return getVisit(db, id)
}

/** 只改患者姓名 */
export function renamePatient(db, id, name) {
  const cur = getPatient(db, id)
  if (!cur) return null
  db.prepare('UPDATE patients SET name = ?, updated_at = ? WHERE id = ?').run(
    name || '未命名',
    Date.now(),
    id,
  )
  return getPatient(db, id)
}

export function deleteVisit(db, id) {
  const info = db.prepare('DELETE FROM visits WHERE id = ?').run(id)
  return Number(info.changes) > 0
}

export function deletePatient(db, id) {
  const info = db.prepare('DELETE FROM patients WHERE id = ?').run(id)
  return Number(info.changes) > 0
}

/* ---------------- 用药记录（使用者自己填实际用什么方） ---------------- */

/** 一条用药记录 */
function rowToMedication(row) {
  return {
    id: row.id,
    patientId: row.patient_id,
    visitId: row.visit_id,
    name: row.name,
    pulse: row.pulse ?? '',
    adjust: row.adjust ?? '',
    usage: row.usage ?? '',
    note: row.note ?? '',
    createdAt: Number(row.created_at),
  }
}

/** 某位患者的全部用药记录（按就诊顺序、组内顺序） */
export function listMedication(db, patientId) {
  return db
    .prepare(
      `SELECT id, patient_id, visit_id, name, pulse, adjust, usage, note, created_at
         FROM medication WHERE patient_id = ? ORDER BY visit_id, seq, created_at`,
    )
    .all(patientId)
    .map(rowToMedication)
}

/** 某一次就诊的用药记录 */
export function listVisitMedication(db, visitId) {
  return db
    .prepare(
      `SELECT id, patient_id, visit_id, name, pulse, adjust, usage, note, created_at
         FROM medication WHERE visit_id = ? ORDER BY seq, created_at`,
    )
    .all(visitId)
    .map(rowToMedication)
}

/**
 * 写一批用药记录（**不开事务**，由调用方控制）。
 * - 同 id 更新；新 id 插入；库里多出来、本次没有的删除
 * - visitId 传 null 表示整位患者覆盖；传具体 id 表示只覆盖那一次就诊
 * - visit_id 必须是该患者已有的就诊记录（外键约束）
 */
function writeMedicationRows(db, patientId, rows, visitId = null) {
  const list = Array.isArray(rows) ? rows : []
  const now = Date.now()
  const upsert = db.prepare(
    `INSERT INTO medication (id, patient_id, visit_id, seq, name, pulse, adjust, usage, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET visit_id = excluded.visit_id, seq = excluded.seq,
       name = excluded.name, pulse = excluded.pulse, adjust = excluded.adjust,
       usage = excluded.usage, note = excluded.note`,
  )
  const keep = new Set()
  const hasVisitAny = db.prepare('SELECT id FROM visits WHERE id = ?')
  const hasVisitOwn = db.prepare('SELECT id FROM visits WHERE id = ? AND patient_id = ?')
  // 组内序号：同一次就诊内按传入顺序编号
  const seqOf = new Map()
  list.forEach((m) => {
    const id = m.id || `m${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const name = String(m.name ?? '').trim()
    if (!name) return
    const vid = visitId ?? String(m.visitId ?? '')
    // 外键保护：跳过指向不存在（或不属于该患者）就诊记录的用药，免得整个保存失败
    const exists = visitId ? hasVisitAny.get(vid) : hasVisitOwn.get(vid, patientId)
    if (!exists) return
    keep.add(id)
    const seq = seqOf.get(vid) ?? 0
    seqOf.set(vid, seq + 1)
    upsert.run(
      id,
      patientId,
      vid,
      seq,
      name,
      String(m.pulse ?? ''),
      String(m.adjust ?? ''),
      String(m.usage ?? ''),
      String(m.note ?? ''),
      now,
    )
  })
  // 本次没有的旧用药：删掉（整份覆盖语义）
  const olds = visitId
    ? db.prepare('SELECT id FROM medication WHERE visit_id = ?').all(visitId)
    : db.prepare('SELECT id FROM medication WHERE patient_id = ?').all(patientId)
  const del = db.prepare('DELETE FROM medication WHERE id = ?')
  for (const o of olds) if (!keep.has(o.id)) del.run(o.id)
}

/**
 * 写一位患者的用药记录（整份覆盖语义）。
 */
export function putMedication(db, patientId, rows) {
  db.exec('BEGIN')
  try {
    writeMedicationRows(db, patientId, rows, null)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return listMedication(db, patientId)
}

/** 只改某一次就诊的用药（单次编辑语义，不动该患者的其它次） */
export function putVisitMedication(db, visitId, rows) {
  const cur = getVisit(db, visitId)
  if (!cur) return null
  db.exec('BEGIN')
  try {
    writeMedicationRows(db, cur.patientId, rows, visitId)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return listVisitMedication(db, visitId)
}

/** 删一条用药记录 */
export function deleteMedication(db, id) {
  const info = db.prepare('DELETE FROM medication WHERE id = ?').run(id)
  return Number(info.changes) > 0
}

/* ---------------- 自定义符号（使用者自建，如「涩」记作 S） ---------------- */

/**
 * 讲义 p33–34 的固定符号代码，自定义符号不得占用。
 * 与 src/domain/symbols.ts 的 SYMBOLS 保持一致（那边是前端 TS，这边是服务端 .mjs，无法互相 import）。
 */
export const RESERVED_SYMBOL_CODES = [
  '0', '-', '+', '±', '++', '±±', '+++', '++++', '↑', '|', '#', 'TTT', 'DDX', 'X',
]

/** 自定义符号清单，按添加顺序 */
export function listCustomSymbols(db) {
  return db
    .prepare('SELECT code, name FROM custom_symbols ORDER BY created_at, rowid')
    .all()
    .map((r) => ({ code: r.code, name: r.name }))
}

/** 新增／改名一个自定义符号（同名同代码则覆盖名称） */
export function putCustomSymbol(db, symbol) {
  const code = String(symbol?.code ?? '').trim()
  const name = String(symbol?.name ?? '').trim()
  if (!code || !name) return null
  if (RESERVED_SYMBOL_CODES.includes(code)) return null
  db.prepare(
    `INSERT INTO custom_symbols (code, name, created_at) VALUES (?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET name = excluded.name`,
  ).run(code, name, Date.now())
  return { code, name }
}

/** 删掉一个自定义符号（不影响已录入的历史符号） */
export function deleteCustomSymbol(db, code) {
  const info = db.prepare('DELETE FROM custom_symbols WHERE code = ?').run(code)
  return Number(info.changes) > 0
}
