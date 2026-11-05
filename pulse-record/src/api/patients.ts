/**
 * 病例记录 API（永久存储层）—— 与本地 SQLite 服务通信
 *
 * 存盘位置：pulse-record/local-data/history.sqlite（服务端进程内，见 server/db.mjs）
 * 开发时前端走 Vite 代理 /api → http://127.0.0.1:5178；构建后由服务端同端口托管页面与 API。
 *
 * 两级结构：患者（patients）→ 就诊记录（visits）。一次就诊记录＝某一天的一组左右手脉象。
 * 与旧版的差别：不再写浏览器 localStorage —— 清缓存、换浏览器、换机都还在。
 */

import type { LayoutMode } from '../domain/types'
import type {
  MedicationInput,
  MedicationRow,
  Patient,
  PatientSummary,
  SavePatientInput,
  Visit,
  VisitPatch,
} from '../domain/api'
import { request } from './http'

/**
 * 数据契约的类型来自 `domain/api.ts` —— **与小程序端共用同一份**。
 * 这里是 type-only 的再导出：网站端的运行时行为一字未改，
 * 但两端不会各自漂移出一套形状。
 */
export type {
  MedicationInput,
  MedicationRow,
  Patient,
  PatientSummary,
  SavePatientInput,
  Visit,
  VisitPatch,
}
export { formatAt } from '../domain/api'

/**
 * 服务端没起／起不来时，给出可照做的提示，而不是静默丢数据。
 * 统一在 api/http.ts 的 request() 里处理（带登录令牌、401 语义化）。
 */

/** 患者列表（含就诊次数），按最近记录时间倒序 */
export async function listPatients(): Promise<PatientSummary[]> {
  const { patients } = await request<{ patients: PatientSummary[] }>('/api/patients')
  return patients ?? []
}

/** 搜索患者／次记录：姓名、日期标签、脉象符号（含「↑」「X」等）都能搜 */
export async function searchPatients(q: string): Promise<PatientSummary[]> {
  const { patients } = await request<{ patients: PatientSummary[] }>(`/api/search?q=${encodeURIComponent(q)}`)
  return patients ?? []
}

/** 取一位患者 ＋ 其全部就诊记录 */
export async function getPatient(id: string): Promise<Patient | null> {
  try {
    const { patient } = await request<{ patient: Patient }>(`/api/patients/${encodeURIComponent(id)}`)
    return patient ?? null
  } catch {
    return null
  }
}

/**
 * 整份保存：患者 ＋ 就诊记录列表。
 * - 传 id：写回该患者（同 id 的就诊记录更新、没有的删除）
 * - 不传 id：新建一位患者
 */
export async function savePatient(input: SavePatientInput): Promise<Patient> {
  const { patient } = await request<{ patient: Patient }>('/api/patients', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return patient
}

/** 重命名患者 */
export async function renamePatient(id: string, name: string): Promise<Patient> {
  const { patient } = await request<{ patient: Patient }>(`/api/patients/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
  return patient
}

/**
 * 改患者的体例（7 脉点 / 9 行）。
 *
 * 体例是患者级属性 —— 记录表（导出 PNG）与录入记录都必须按同一个值画，
 * 所以改一下就落库，不能只留在某个页面的临时状态里，
 * 否则同一位患者在两个界面会显示出不同的行数。
 * 只改体例、不动格值：7↔9 来回切，「尺浮/尺中」两行的数据仍原样留着。
 */
export async function updatePatientLayout(id: string, layout: LayoutMode): Promise<Patient> {
  const { patient } = await request<{ patient: Patient }>(`/api/patients/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ layout }),
  })
  return patient
}

/** 删除患者（连带其就诊记录） */
export async function deletePatient(id: string): Promise<void> {
  await request<{ ok: true }>(`/api/patients/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** 改一次就诊记录（日期标签／脉象值／该次用药） */
export async function updateVisit(id: string, patch: VisitPatch): Promise<Visit> {
  const { visit } = await request<{ visit: Visit }>(`/api/visits/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  return visit
}

/** 取某位患者的全部用药记录 */
export async function listMedication(patientId: string): Promise<MedicationRow[]> {
  const { medication } = await request<{ medication: MedicationRow[] }>(
    `/api/patients/${encodeURIComponent(patientId)}/medication`,
  )
  return medication ?? []
}

/** 取某一次就诊的用药记录 */
export async function listVisitMedication(visitId: string): Promise<MedicationRow[]> {
  const { medication } = await request<{ medication: MedicationRow[] }>(
    `/api/visits/${encodeURIComponent(visitId)}/medication`,
  )
  return medication ?? []
}

/** 整份覆盖某位患者的用药记录 */
export async function saveMedication(
  patientId: string,
  rows: MedicationInput[],
): Promise<MedicationRow[]> {
  const { medication } = await request<{ medication: MedicationRow[] }>(
    `/api/patients/${encodeURIComponent(patientId)}/medication`,
    { method: 'POST', body: JSON.stringify({ medications: rows }) },
  )
  return medication ?? []
}

/** 删除一次就诊记录 */
export async function deleteVisit(id: string): Promise<void> {
  await request<{ ok: true }>(`/api/visits/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
