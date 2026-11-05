import type { VisitContext, VisitRef } from './types'

/**
 * 上下文的纯推导 —— **没有副作用，能被回归脚本直接断言**
 *
 * Taro 化之后 `miniprogram-automator` 驱动不了页面实例（页面是 React 组件，
 * 拿不到实例方法），所以这类逻辑必须抽成纯函数才有测试面。
 */

/** 本地日期 → `YYYY-MM-DD` */
export function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 空上下文（还没选患者） */
export function emptyContext(): VisitContext {
  return { patientId: null, visitId: null, visitDate: today() }
}

/** 把任何形状的存档规整成合法上下文 */
export function normalizeContext(raw: unknown): VisitContext {
  const src = (raw || {}) as Partial<VisitContext>
  const patientId = typeof src.patientId === 'string' && src.patientId ? src.patientId : null
  const visitId = typeof src.visitId === 'string' && src.visitId ? src.visitId : null
  const visitDate = typeof src.visitDate === 'string' && src.visitDate ? src.visitDate : today()
  return { patientId, visitId, visitDate }
}

/**
 * 挑「最近一次就诊」。
 *
 * 就诊列表按记录时间倒序（服务端就是这个约定），所以取第一个；
 * 没有记录则返回 null —— 表示「这位患者还没有任何记录」。
 */
export function pickLatestVisit(visits: VisitRef[] | undefined | null): VisitRef | null {
  if (!visits || !visits.length) return null
  const withTime = visits.filter((v) => typeof v.at === 'number')
  if (withTime.length) {
    return withTime.reduce((a, b) => ((a.at as number) >= (b.at as number) ? a : b))
  }
  return visits[0]
}

/**
 * 切换患者后的上下文。
 *
 * 规则：
 *   · 患者变了 → 就诊重置为该患者最近一次；没有则 `visitId = null`（新建状态）
 *   · 患者没变 → 保留原就诊（若原就诊仍属于该患者）
 */
export function contextAfterPatientChange(
  patientId: string,
  visits: VisitRef[] | undefined | null,
  prev: VisitContext,
): VisitContext {
  if (prev.patientId === patientId) {
    // 还是同一位患者：原就诊若还在就留着
    const stillThere = (visits || []).some((v) => v.id === prev.visitId)
    return {
      patientId,
      visitId: stillThere ? prev.visitId : null,
      visitDate: stillThere ? prev.visitDate : today(),
    }
  }
  const latest = pickLatestVisit(visits)
  return {
    patientId,
    visitId: latest ? latest.id : null,
    visitDate: latest ? latest.label : today(),
  }
}

/** 切换就诊后的上下文（患者不变，日期标签跟着这次就诊走） */
export function contextAfterVisitChange(
  patientId: string | null,
  visit: VisitRef | null,
): VisitContext {
  if (!visit) return { patientId, visitId: null, visitDate: today() }
  return { patientId, visitId: visit.id, visitDate: visit.label || today() }
}

/** 吸顶条上显示的那行字 */
export function contextLabel(
  ctx: VisitContext,
  patientName: string | null | undefined,
): string {
  const who = patientName || '（未选患者）'
  const when = ctx.visitDate || today()
  return `${who} · ${when}`
}
