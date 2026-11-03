/**
 * 日期工具 —— 新增记录（就诊）用
 *
 * 记录日期标签用「年月日」六位（YYMMDD），如 261102 ＝ 2026 年 11 月 2 日。
 * 取公历后两位年：讲稿／讲义正文用民国纪年（99 年 ＝ 2010），
 * 但「新增记录」是使用者当下录人的日期，按公历记，不折算民国纪年。
 *
 * 日期选择器用 <input type="date">，其值是 YYYY-MM-DD；本模块负责
 * 「YYYY-MM-DD（选择器值）→ YYMMDD（记录标签）」与「YYYY-MM-DD → 时间戳」的换算。
 */

/** 今天的日期（本地时区），格式 YYYY-MM-DD */
export function todayYmd(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** YYYY-MM-DD → YYMMDD 六位标签，如 2026-11-02 → 261102；格式不对则返回空串 */
export function ymdToLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd ?? '').trim())
  if (!m) return ''
  return `${m[1].slice(2)}${m[2]}${m[3]}`
}

/** YYYY-MM-DD → 当天 00:00（本地时区）的时间戳；格式不对则回落到现在 */
export function ymdToTimestamp(ymd: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd ?? '').trim())
  if (!m) return Date.now()
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}
