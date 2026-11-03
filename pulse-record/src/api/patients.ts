/**
 * 病例记录 API（永久存储层）—— 与本地 SQLite 服务通信
 *
 * 存盘位置：pulse-record/local-data/history.sqlite（服务端进程内，见 server/db.mjs）
 * 开发时前端走 Vite 代理 /api → http://127.0.0.1:5178；构建后由服务端同端口托管页面与 API。
 *
 * 两级结构：患者（patients）→ 就诊记录（visits）。一次就诊记录＝某一天的一组左右手脉象。
 * 与旧版的差别：不再写浏览器 localStorage —— 清缓存、换浏览器、换机都还在。
 */

import type { Constitution, LayoutMode, Therapy } from '../domain/types'

/** 一次就诊记录（某一天的脉象） */
export interface Visit {
  id: string
  /** 日期标签，如「21日」「2月5」 */
  label: string
  /** 记录时间（毫秒时间戳） */
  at: number
  /** key = `${hand}|${organ}|${depth}`，值为符号代码数组 */
  values: Record<string, string[]>
  /** 使用者自判的体质（讲义 p47「①判体质」）；null＝未判 */
  constitution?: Constitution | null
  /** 使用者自选的疗法（讲义 p47「②定疗法」）；null＝未定 */
  therapy?: Therapy | null
}

/** 患者列表条目 */
export interface PatientSummary {
  id: string
  name: string
  layout: LayoutMode
  /** 就诊次数 */
  visitCount: number
  /** 最近一次记录时间 */
  at: number
  /** 搜索命中方式：all（未搜索）／name（姓名命中）／visit（有次记录命中） */
  matchType?: 'all' | 'name' | 'visit'
  /** 命中的次记录（matchType 为 visit 时有值） */
  matchedVisits?: { id: string; label: string; at: number }[]
}

/** 一位患者 ＋ 其全部就诊记录 */
export interface Patient extends PatientSummary {
  visits: Visit[]
}

/** 一条用药记录（使用者自己填实际用什么方、加减、服法） */
export interface MedicationRow {
  id: string
  /** 挂在哪一次就诊 */
  visitId: string
  name: string
  /** 对应脉象（文字表述） */
  pulse: string
  /** 对应脉象（符号表述）：key 同 visits.pulse_values，值为符号代码数组；与文字并存 */
  symbols: Record<string, string[]>
  adjust: string
  usage: string
  note: string
}

/** 服务端没起／起不来时，给出可照做的提示，而不是静默丢数据 */
const OFFLINE =
  '连不上本地病例记录服务（/api/patients）。请用 npm run dev 起前后端（开发），或 npm run build && npm start（本地应用）。'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    throw new Error(OFFLINE)
  }
  if (!res.ok) {
    // 502/503/504 多为代理连不上后端（服务没起），给可照做的提示
    if ([502, 503, 504].includes(res.status)) throw new Error(OFFLINE)
    let msg = `请求失败（${res.status}）`
    try {
      const body = await res.json()
      if (body?.error) msg = String(body.error)
    } catch {
      /* 保留默认信息 */
    }
    throw new Error(msg)
  }
  return (await res.json()) as T
}

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
export async function savePatient(input: {
  id?: string
  name: string
  layout: LayoutMode
  visits: {
    id?: string
    label: string
    at?: number
    values: Record<string, string[]>
    /** 使用者自判的体质（null＝未判） */
    constitution?: Constitution | null
    /** 使用者自选的疗法（null＝未定） */
    therapy?: Therapy | null
  }[]
  /** 用药记录（整份覆盖；挂在 visits 上） */
  medications?: {
    id?: string
    visitId: string
    name: string
    /** 对应脉象（文字） */
    pulse?: string
    /** 对应脉象（符号），与文字并存 */
    symbols?: Record<string, string[]>
    adjust?: string
    usage?: string
    note?: string
  }[]
}): Promise<Patient> {
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

/** 删除患者（连带其就诊记录） */
export async function deletePatient(id: string): Promise<void> {
  await request<{ ok: true }>(`/api/patients/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** 改一次就诊记录（日期标签／脉象值／该次用药） */
export async function updateVisit(
  id: string,
  patch: {
    label?: string
    values?: Record<string, string[]>
    at?: number
    /** 使用者自判的体质（传 null＝清除） */
    constitution?: Constitution | null
    /** 使用者自选的疗法（传 null＝清除） */
    therapy?: Therapy | null
    medications?: {
      id?: string
      name: string
      pulse?: string
      symbols?: Record<string, string[]>
      adjust?: string
      usage?: string
      note?: string
    }[]
  },
): Promise<Visit> {
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
  rows: {
    id?: string
    visitId: string
    name: string
    pulse?: string
    symbols?: Record<string, string[]>
    adjust?: string
    usage?: string
    note?: string
  }[],
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

/** 保存时间 → 本地可读文本 */
export function formatAt(at: number): string {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
