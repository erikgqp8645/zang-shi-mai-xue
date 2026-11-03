/**
 * 领域模型 —— 臧氏脉学脉象记录表
 *
 * 依据：
 * - 讲义 2026-10 PDF p33「③ 标准脉象」、p34「④ 脉象记录」、p48–50「脉象记录表」
 * - 讲稿 2010（民国99年）第十四讲「体质配对 / 结论」
 *
 * 用字一律沿用讲义原文符号，不做简化或替换。
 */

export type Hand = 'L' | 'R'
export type Depth = '浮' | '中' | '沉'
export type Organ = '寸' | '关' | '尺'

/**
 * 体质 —— 讲义 2026-10·p47（印刷 45）「臧氏脉学 开方三部曲」图上三个椭圆
 *   肾虚体质 ／ 上盛下虚体质 ／ 平和体质
 *
 * 注意：这是**使用者自判**后记在本工具里的值，工具不代判、不下诊断。
 * 讲义 p39 的「1 号／2 号／3 号」是另一套按手足温度分的命名，不与此混用。
 */
export type Constitution = '肾虚' | '上盛下虚' | '平和'

/**
 * 疗法 —— 讲义 p47 图上三个六边形
 *   三焦疗法 ／ 五脏疗法 ／ 一体疗法
 *
 * 与讲稿 2010·第二讲「叁、用方」的三种疗法同名同义（一体／三焦／五脏，三者并列）。
 */
export type Therapy = '三焦疗法' | '五脏疗法' | '一体疗法'

/**
 * 行结构模式
 * - nine  ：9 行（寸浮中沉 / 关浮中沉 / 尺浮中沉）—— 与讲义 p34 实例表、p48–50 空白表一致
 * - seven ：7 脉点（寸浮中沉 / 关浮中沉 / 尺只沉）—— 与讲义 p34「14 个脉点」定义一致
 */
export type LayoutMode = 'nine' | 'seven'

export interface RowDef {
  organ: Organ
  depth: Depth
}

/** 单次记录（一列「日期 × 左右」） */
export interface Session {
  id: string
  /** 显示用日期标签，如「21日」「2月5」；新增记录用六位年月日，如「261102」 */
  label: string
  /** 该次记录的实际日期（毫秒时间戳）；新增记录＝所选日期当天 00:00 */
  at?: number
  /** key = `${hand}|${organ}|${depth}`，值为符号代码数组（可叠加，如 ['X','↑']） */
  values: Record<string, string[]>
  /** 使用者自判的体质（讲义 p47「①判体质」手动选择的结果；工具不代判） */
  constitution?: Constitution | null
  /** 使用者自选的疗法（讲义 p47「②定疗法」手动选择的结果；随体质带出后仍可改） */
  therapy?: Therapy | null
}

/** 一位受检者的一组记录 */
export interface RecordSet {
  name: string
  layout: LayoutMode
  sessions: Session[]
}

export const ORGANS: Organ[] = ['寸', '关', '尺']
export const DEPTHS: Depth[] = ['浮', '中', '沉']
export const HANDS: Hand[] = ['L', 'R']

export const HAND_LABEL: Record<Hand, string> = { L: '左', R: '右' }

export function cellKey(hand: Hand, organ: Organ, depth: Depth): string {
  return `${hand}|${organ}|${depth}`
}
