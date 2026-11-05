import type { Constitution, LayoutMode, Therapy } from './types'

/**
 * 服务端数据契约 —— **网站端与小程序端共用一份**
 *
 * ## 为什么放在 domain 层
 *
 * 2026-11-05 迁 Taro 时发现：网站端 `src/api/patients.ts` 里的这些 interface
 * 是**纯类型**（不碰 DOM、不碰 fetch），但那个文件整体 import 了 `./http`
 * （fetch + localStorage），小程序端没法直接引。
 *
 * 于是把**类型**抽到这里，`src/api/patients.ts` 改成从这里再导出 ——
 * 网站端的**运行时行为一字未改**（只是 type import），小程序端则通过
 * alias `@domain/api` 直接引同一份定义。两端不会漂移。
 *
 * 注意：这里只有**形状**，没有函数 —— 函数由各端的传输层提供
 * （网站 `src/api/patients.ts`、小程序 `taro/src/utils/data.ts`）。
 */

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
  /** 对应脉象（符号表述）：key 同 visits.values，值为符号代码数组；与文字并存 */
  symbols: Record<string, string[]>
  adjust: string
  usage: string
  note: string
}

/** 用药记录的写入形状（新建时 id 可省） */
export interface MedicationInput {
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
}

/** 整份保存患者时的写入形状 */
export interface SavePatientInput {
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
  medications?: MedicationInput[]
}

/** 改一次就诊记录的补丁形状 */
export interface VisitPatch {
  label?: string
  values?: Record<string, string[]>
  at?: number
  /** 使用者自判的体质（传 null＝清除） */
  constitution?: Constitution | null
  /** 使用者自选的疗法（传 null＝清除） */
  therapy?: Therapy | null
  medications?: MedicationInput[]
}

/** 保存时间 → 本地可读文本 */
export function formatAt(at: number): string {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
