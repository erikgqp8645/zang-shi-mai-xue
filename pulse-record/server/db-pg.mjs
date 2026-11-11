/**
 * 病例记录库（PostgreSQL）—— CloudBase PG 版的存储实现
 *
 * ## 与 SQLite 版（server/db.mjs）的关系
 *
 * **同名同签名的同一套契约**（见 server/store.mjs）。路由层、前端、小程序**一行不用改**。
 *
 * 差别只在「怎么执行」：
 *   · SQLite 版：拼 SQL 字符串 → `db.prepare(sql).run/get/all`
 *   · PG 版：调 **PG 函数（RPC）**，函数定义在 server/pg-functions.sql
 *
 * 选 RPC 而不是 postgREST 的 builder，原因有三个：
 *   1. **事务** —— 一次 RPC ＝ 一个事务，「整份覆盖」语义是原子的（builder 没有）
 *   2. **复杂 SQL 不受 builder 限制**（聚合、子查询、UPSERT）
 *   3. **JS 侧不写 SQL** —— 两套实现不会因为方言不同而漂移
 *
 * ## 规整逻辑在哪
 *
 * 格值规整（把视图层压过的 {"0":"X"} 还原成数组）用**共享模块** server/values.mjs，
 * 与 SQLite 版共用同一份 —— 写库前规整、读出来再规整。
 *
 * PG 侧只负责存取，**不做形状规整**（`values` / `symbols` 在 PG 里是 JSON 字符串）。
 */

import { dataRpc } from './pg-client.mjs'
import { CONSTITUTIONS, THERAPIES, normalizeValues, parseValues, pickEnum } from './values.mjs'
import { RESERVED_SYMBOL_CODES, symbolInputError } from './symbol-codes.mjs'

export { RESERVED_SYMBOL_CODES }

/** 存储位置的描述（SQLite 版是文件路径，这里是文字说明） */
export const DB_PATH = 'CloudBase PostgreSQL'

/* ------------------------------------------------------------------ *
 * 打开／初始化
 * ------------------------------------------------------------------ */

/**
 * 打开存储。
 *
 * PG 的表与函数是**部署时**建好的（server/schema-pg.sql ＋ server/pg-functions.sql，
 * 由 scripts/pg-admin.mjs 推到远端），这里只做两件事：
 *   1. 确认连得上（连不上要报清楚「表还没建」，而不是一堆 500）
 *   2. 确保内置单机账号存在（SQLite 版在 migrate() 里做同一件事）
 *
 * @returns {Promise<object>} 「db 句柄」—— PG 实现里它只是个标记，
 *   所有数据访问都走模块级的 PG 客户端。
 */
export async function openDb() {
  await dataRpc('pulse_local_user', '')
  const now = Date.now()
  await dataRpc('pulse_auth_ensure_local_user', '', { now })
  return { backend: 'pg' }
}

/* ------------------------------------------------------------------ *
 * 行 → 领域对象
 * ------------------------------------------------------------------ */

/** 一次就诊记录（values 是 PG 里的 JSON 字符串 → 还原成数组） */
function rowToVisit(row) {
  return {
    id: row.id,
    label: row.label,
    at: Number(row.at),
    values: normalizeValues(parseValues(row.values)),
    constitution: pickEnum(CONSTITUTIONS, row.constitution),
    therapy: pickEnum(THERAPIES, row.therapy),
  }
}

/** 一位患者 ＋ 其全部就诊记录 */
function rowToPatient(row) {
  const visits = (row.visits ?? []).map(rowToVisit)
  return {
    id: row.id,
    name: row.name,
    layout: row.layout,
    at: visits.length ? visits[visits.length - 1].at : Number(row.at),
    visits,
  }
}

/** 一条用药记录（symbols 是 PG 里的 JSON 字符串 → 还原成对象） */
function rowToMedication(row) {
  return {
    id: row.id,
    patientId: row.patientId,
    visitId: row.visitId,
    name: row.name,
    pulse: row.pulse ?? '',
    symbols: parseValues(row.symbols),
    adjust: row.adjust ?? '',
    usage: row.usage ?? '',
    note: row.note ?? '',
    createdAt: Number(row.createdAt),
  }
}

/** 用药记录写回库前的形状规整（与 SQLite 版 writeMedicationRows 一致） */
function normalizeMedicationRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((m) => ({
    id: m.id,
    visitId: m.visitId,
    name: String(m.name ?? '').trim(),
    pulse: String(m.pulse ?? '').trim(),
    symbols: m.symbols && typeof m.symbols === 'object' ? m.symbols : {},
    adjust: String(m.adjust ?? '').trim(),
    usage: String(m.usage ?? '').trim(),
    note: String(m.note ?? '').trim(),
  }))
}

/* ------------------------------------------------------------------ *
 * 账号
 * ------------------------------------------------------------------ */

/** 取内置单机账号（鉴权中间件在单机模式下用） */
export async function getLocalUser(db) {
  const res = await dataRpc('pulse_local_user', '')
  return res?.user ?? null
}

/* ------------------------------------------------------------------ *
 * 患者
 * ------------------------------------------------------------------ */

/** 该账号的患者列表（含就诊次数与最近一次记录时间），按最近记录时间倒序 */
export async function listPatients(db, ownerId) {
  const rows = await dataRpc('pulse_list_patients', ownerId)
  return (rows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    layout: r.layout,
    visitCount: Number(r.visitCount),
    at: Number(r.at),
  }))
}

/**
 * 搜索：按关键字找患者与其就诊记录。
 *
 * 命中口径 —— 患者姓名包含关键字，或某次就诊的日期标签包含关键字，
 * 或该次脉象里出现过该符号（如「↑」「X」）。
 */
export async function searchPatients(db, q, ownerId) {
  const rows = await dataRpc('pulse_search_patients', ownerId, { q: String(q ?? '') })
  return (rows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    layout: r.layout,
    visitCount: Number(r.visitCount),
    at: Number(r.at),
    matchType: r.matchType,
    matchedVisits: (r.matchedVisits ?? []).map((v) => ({
      id: v.id,
      label: v.label,
      at: Number(v.at),
    })),
  }))
}

/** 一位患者 ＋ 其全部就诊记录；不属于该 owner → null */
export async function getPatient(db, id, ownerId) {
  const res = await dataRpc('pulse_get_patient', ownerId, { id })
  return res?.found && res.patient ? rowToPatient(res.patient) : null
}

/** 一次就诊记录；不属于该 owner → null */
export async function getVisit(db, id, ownerId) {
  const res = await dataRpc('pulse_get_visit', ownerId, { id })
  if (!res?.found || !res.visit) return null
  return { ...rowToVisit(res.visit), patientId: res.visit.patientId }
}

/**
 * 存一位患者及其就诊记录（整份覆盖语义）：
 * - 已存在的 visit（同 id）更新；新 visit 插入；库里多出来、本次没有的 visit 删除
 * - patients 行不存在则新建
 * - owner_id 一律由 ownerId 决定，请求体里的 owner 一律忽略
 */
export async function putPatient(db, ownerId, patient) {
  const now = Date.now()
  const visits = (Array.isArray(patient.visits) ? patient.visits : []).map((v) => ({
    id: v.id,
    label: v.label || '',
    at: Number(v.at) || now,
    // 写库前规整成「每格一个数组」——客户端可能送来视图层压过的 {"0":"X"} 形状
    values: JSON.stringify(normalizeValues(v.values)),
    constitution: pickEnum(CONSTITUTIONS, v.constitution),
    therapy: pickEnum(THERAPIES, v.therapy),
  }))

  const res = await dataRpc('pulse_put_patient', ownerId, {
    patient: {
      id: patient.id,
      name: patient.name || '未命名',
      layout: patient.layout === 'seven' ? 'seven' : 'nine',
      visits,
      medications: normalizeMedicationRows(patient.medications),
    },
  })
  return res?.patient ? rowToPatient(res.patient) : null
}

/** 只改某一次就诊记录（单次编辑语义，不动该患者的其它次） */
export async function putVisit(db, id, ownerId, patch) {
  const cur = await getVisit(db, id, ownerId)
  if (!cur) return null
  const has = (k) => Object.prototype.hasOwnProperty.call(patch, k)
  // 格值一律规整成「每格一个数组」
  const values = normalizeValues(
    patch.values && typeof patch.values === 'object' ? patch.values : cur.values,
  )
  const body = {
    id,
    patch: {
      label: typeof patch.label === 'string' ? patch.label : cur.label,
      values: JSON.stringify(values),
      at: Number(patch.at) || cur.at,
    },
  }
  // 体质与疗法：patch 里带了这两个键就按给的写（可以是 null＝清除），没带就保持原值
  if (has('constitution')) body.patch.constitution = pickEnum(CONSTITUTIONS, patch.constitution)
  if (has('therapy')) body.patch.therapy = pickEnum(THERAPIES, patch.therapy)
  // 用药：只写回这一次的（该患者其它次的用药不动）
  if (Array.isArray(patch.medications)) {
    body.medications = normalizeMedicationRows(patch.medications)
  }

  const res = await dataRpc('pulse_put_visit', ownerId, body)
  if (!res?.visit) return null
  return { ...rowToVisit(res.visit), patientId: res.visit.patientId }
}

/** 只改患者姓名 */
export async function renamePatient(db, id, ownerId, name) {
  const res = await dataRpc('pulse_rename_patient', ownerId, { id, name })
  return res?.patient ? rowToPatient(res.patient) : null
}

/**
 * 只改患者的**体例**（7 脉点 / 9 行）。
 *
 * 体例是**患者级**属性 —— 记录表与录入记录都必须按同一个值画。
 * 只改体例**不动格值**：7↔9 来回切时，「尺浮/尺中」两行的数据仍原样留在 visits 里。
 */
export async function updatePatientLayout(db, id, ownerId, layout) {
  if (layout !== 'nine' && layout !== 'seven') return null
  const res = await dataRpc('pulse_update_patient_layout', ownerId, { id, layout })
  return res?.patient ? rowToPatient(res.patient) : null
}

/** 删一次就诊记录 */
export async function deleteVisit(db, id, ownerId) {
  const res = await dataRpc('pulse_delete_visit', ownerId, { id })
  return res?.ok === true
}

/** 删一位患者（连带其就诊记录与用药） */
export async function deletePatient(db, id, ownerId) {
  const res = await dataRpc('pulse_delete_patient', ownerId, { id })
  return res?.ok === true
}

/* ------------------------------------------------------------------ *
 * 用药记录（使用者自己填实际用什么方）
 * ------------------------------------------------------------------ */

/** 某位患者的全部用药记录（按就诊顺序、组内顺序） */
export async function listMedication(db, patientId, ownerId) {
  const rows = await dataRpc('pulse_list_medication', ownerId, { patientId })
  return (rows ?? []).map(rowToMedication)
}

/** 某一次就诊的用药记录 */
export async function listVisitMedication(db, visitId, ownerId) {
  const rows = await dataRpc('pulse_list_visit_medication', ownerId, { visitId })
  return (rows ?? []).map(rowToMedication)
}

/** 写一位患者的用药记录（整份覆盖语义） */
export async function putMedication(db, patientId, ownerId, rows) {
  const res = await dataRpc('pulse_put_medication', ownerId, {
    patientId,
    rows: normalizeMedicationRows(rows),
  })
  return (res?.medication ?? []).map(rowToMedication)
}

/** 只改某一次就诊的用药（单次编辑语义，不动该患者的其它次） */
export async function putVisitMedication(db, visitId, ownerId, rows) {
  const res = await dataRpc('pulse_put_visit_medication', ownerId, {
    visitId,
    rows: normalizeMedicationRows(rows),
  })
  if (!res?.found) return null
  return (res?.medication ?? []).map(rowToMedication)
}

/** 删一条用药记录 */
export async function deleteMedication(db, id, ownerId) {
  const res = await dataRpc('pulse_delete_medication', ownerId, { id })
  return res?.ok === true
}

/* ------------------------------------------------------------------ *
 * 自定义符号（使用者自建，如「涩」记作 S）
 * ------------------------------------------------------------------ */

/** 自定义符号清单，按添加顺序（只看该 owner 的） */
export async function listCustomSymbols(db, ownerId) {
  const rows = await dataRpc('pulse_list_symbols', ownerId)
  return (rows ?? []).map((r) => ({ code: r.code, name: r.name }))
}

/** 新增／改名一个自定义符号（同名同代码则覆盖名称） */
export async function putCustomSymbol(db, ownerId, symbol) {
  const code = String(symbol?.code ?? '').trim()
  const name = String(symbol?.name ?? '').trim()
  // 与路由**同一个函数**（server/symbol-codes.mjs）—— SQLite 与 PG 不再各写一份
  if (symbolInputError(code, name)) return null
  const res = await dataRpc('pulse_put_symbol', ownerId, { code, name })
  return res?.symbol ?? null
}

/** 删掉一个自定义符号（不影响已录入的历史符号） */
export async function deleteCustomSymbol(db, code, ownerId) {
  const res = await dataRpc('pulse_delete_symbol', ownerId, { code })
  return res?.ok === true
}

/* ------------------------------------------------------------------ */
/* 方剂脉象图（覆盖层）                                                 */
/* ------------------------------------------------------------------ */

/** 与 SQLite 版同一个上限 */
const MAX_PATTERNS_PER_FORMULA = 20
const MAX_PATTERN_BYTES = 32 * 1024

/** 手改过的全部脉象图：`{ [formulaId]: entry[] }`（函数已按 seq 排好） */
export async function listFormulaPatterns(db, ownerId) {
  const res = await dataRpc('pulse_list_formula_patterns', ownerId, {})
  if (!res || typeof res !== 'object' || Array.isArray(res)) return {}
  return res
}

/** 整条替换某方剂的脉象图（PG 函数内是一个事务） */
export async function putFormulaPatterns(db, ownerId, formulaId, entries) {
  if (typeof formulaId !== 'string' || formulaId.trim() === '') return false
  if (!Array.isArray(entries) || entries.length > MAX_PATTERNS_PER_FORMULA) return false
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.cells)) return false
    if (JSON.stringify(entry).length > MAX_PATTERN_BYTES) return false
  }
  const res = await dataRpc('pulse_put_formula_patterns', ownerId, { formulaId, patterns: entries })
  return res?.ok === true
}

/** 撤销覆盖（回到内置基线） */
export async function deleteFormulaPatterns(db, ownerId, formulaId) {
  const res = await dataRpc('pulse_delete_formula_patterns', ownerId, { formulaId })
  return res?.ok === true
}
