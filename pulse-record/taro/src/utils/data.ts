import type {
  MedicationInput,
  MedicationRow,
  Patient,
  PatientSummary,
  SavePatientInput,
  Visit,
} from '@domain/api'
import type { LayoutMode } from '@domain/types'

import { request } from './api'

/**
 * 病例数据 —— 与网站端 `src/api/patients.ts` 一一对应
 *
 * 服务端的接口形状不变，小程序只是换了个传输层（见 `utils/api.ts`）。
 * 两端读写的是**同一份数据**（同一个 users 账号），不是两套库做同步。
 *
 * **类型**来自 `@domain/api` —— 与网站端共用同一份契约定义，两端不会漂移。
 */

/* ------------------------------- 患者 ------------------------------- */

/** 患者列表（含就诊次数），按最近记录时间倒序 */
export async function listPatients(): Promise<PatientSummary[]> {
  const data = (await request({ method: 'GET', path: '/api/patients' })) as { patients?: PatientSummary[] }
  return data?.patients || []
}

/** 搜索：姓名、日期标签、脉象符号（含「↑」「X」等）都能搜 */
export async function searchPatients(q: string): Promise<PatientSummary[]> {
  const data = (await request({
    method: 'GET',
    path: `/api/search?q=${encodeURIComponent(q)}`,
  })) as { patients?: PatientSummary[] }
  return data?.patients || []
}

/** 一位患者 ＋ 其全部就诊记录 */
export async function getPatient(id: string): Promise<Patient | null> {
  try {
    const data = (await request({
      method: 'GET',
      path: `/api/patients/${encodeURIComponent(id)}`,
    })) as { patient?: Patient }
    return data?.patient || null
  } catch {
    return null
  }
}

/**
 * 整份保存：患者 ＋ 就诊记录列表
 * - 传 id：写回该患者（同 id 的就诊更新、没有的删除）
 * - 不传 id：新建
 */
export async function savePatient(input: SavePatientInput): Promise<Patient | undefined> {
  const data = (await request({
    method: 'POST',
    path: '/api/patients',
    body: input,
  })) as { patient?: Patient }
  return data?.patient
}

/** 重命名患者 */
export async function renamePatient(id: string, name: string): Promise<Patient | undefined> {
  const data = (await request({
    method: 'PATCH',
    path: `/api/patients/${encodeURIComponent(id)}`,
    body: { name },
  })) as { patient?: Patient }
  return data?.patient
}

/** 删除患者（连带其就诊记录） */
export function deletePatient(id: string): Promise<unknown> {
  return request({ method: 'DELETE', path: `/api/patients/${encodeURIComponent(id)}` })
}

/**
 * 改患者的体例（7 脉点 / 9 行）。
 *
 * 体例是患者级属性 —— 病例详情页的记录表与录入页的表格都按它画，
 * 所以切换要**立刻落库**，两处才会一直对得上。
 * 只改体例、不动格值：7↔9 来回切，「尺浮/尺中」两行的数据仍原样留着。
 */
export async function updatePatientLayout(id: string, layout: LayoutMode): Promise<Patient | undefined> {
  const data = (await request({
    method: 'PATCH',
    path: `/api/patients/${encodeURIComponent(id)}`,
    body: { layout },
  })) as { patient?: Patient }
  return data?.patient
}

/** 改一次就诊记录（日期标签／脉象值／体质／疗法／该次用药） */
export async function updateVisit(id: string, patch: unknown): Promise<Visit | undefined> {
  const data = (await request({
    method: 'PATCH',
    path: `/api/visits/${encodeURIComponent(id)}`,
    body: patch,
  })) as { visit?: Visit }
  return data?.visit
}

/** 删除一次就诊记录 */
export function deleteVisit(id: string): Promise<unknown> {
  return request({ method: 'DELETE', path: `/api/visits/${encodeURIComponent(id)}` })
}

/* ------------------------------- 用药 ------------------------------- */

/** 某位患者的全部用药记录 */
export async function listMedication(patientId: string): Promise<MedicationRow[]> {
  const data = (await request({
    method: 'GET',
    path: `/api/patients/${encodeURIComponent(patientId)}/medication`,
  })) as { medication?: MedicationRow[] }
  return data?.medication || []
}

/** 某一次就诊的用药记录 */
export async function listVisitMedication(visitId: string): Promise<MedicationRow[]> {
  const data = (await request({
    method: 'GET',
    path: `/api/visits/${encodeURIComponent(visitId)}/medication`,
  })) as { medication?: MedicationRow[] }
  return data?.medication || []
}

/** 整份覆盖某位患者的用药记录 */
export async function saveMedication(patientId: string, rows: MedicationInput[]): Promise<MedicationRow[]> {
  const data = (await request({
    method: 'POST',
    path: `/api/patients/${encodeURIComponent(patientId)}/medication`,
    body: { medications: rows },
  })) as { medication?: MedicationRow[] }
  return data?.medication || []
}

/** 只覆盖某一次就诊的用药 */
export async function saveVisitMedication(visitId: string, rows: MedicationInput[]): Promise<MedicationRow[]> {
  const data = (await request({
    method: 'POST',
    path: `/api/visits/${encodeURIComponent(visitId)}/medication`,
    body: { medications: rows },
  })) as { medication?: MedicationRow[] }
  return data?.medication || []
}

/** 删一条用药记录 */
export function deleteMedication(id: string): Promise<unknown> {
  return request({ method: 'DELETE', path: `/api/medication/${encodeURIComponent(id)}` })
}

/* ---------------------------- 自定义符号 ---------------------------- */

/** 自定义符号清单（讲义固定符号之外的，使用者自建） */
export async function listCustomSymbols(): Promise<{ code: string; name: string }[]> {
  const data = (await request({ method: 'GET', path: '/api/symbols' })) as {
    symbols?: { code: string; name: string }[]
  }
  return data?.symbols || []
}

/** 新增（或改名）一个自定义符号 */
export async function saveCustomSymbol(symbol: {
  code: string
  name: string
}): Promise<{ code: string; name: string } | undefined> {
  const data = (await request({
    method: 'POST',
    path: '/api/symbols',
    body: { code: symbol.code, name: symbol.name },
  })) as { symbol?: { code: string; name: string } }
  return data?.symbol
}

/** 删除一个自定义符号（已录入的历史符号不受影响） */
export function deleteCustomSymbol(code: string): Promise<unknown> {
  return request({ method: 'DELETE', path: `/api/symbols/${encodeURIComponent(code)}` })
}

/* ------------------------------ 健康检查 ------------------------------ */

/** 服务端状态：{ ok, mode }；mode='single' 表示单机模式（不用登录） */
export function health(): Promise<unknown> {
  return request({ method: 'GET', path: '/api/health' })
}
