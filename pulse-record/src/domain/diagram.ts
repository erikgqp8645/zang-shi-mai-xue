import type { Depth, Hand, LayoutMode, Organ } from './types'
import { depthsOf } from './layout'

/**
 * 寸关尺图示的几何 —— 页面 SVG 与 PNG 导出共用同一套坐标，两边画出来必须一致。
 *
 * 模版图：用户提供的原图（已裁掉右侧边框），1070 × 876。
 * 左「左 阴（血）」、右「右 阳（气）」；左手腕 心—寸 / 肝—关 / 肾（阴）—尺，
 * 右手腕 肺—寸 / 脾—关 / 肾（阳）—尺。
 *
 * 坐标按原图像素量得（见仓库根 AGENTS.md「寸关尺图示（pulse-record）」），不得目测：
 * 左手「寸/关/尺」三字 x 268–294、左手圆点 x 245–255、右手圆点 x 823–835；
 * 三行纵坐标 723 / 767 / 810。
 */

/** 原图尺寸（裁掉右侧边框后的宽 × 高） */
export const IMG_W = 1070
export const IMG_H = 876

/** 标记块高度（原图像素） */
export const BADGE_H = 34
/** 左手侧标记块左缘：压在原图「寸/关/尺」三字上（原字实测 x 268–294），用自己的位置字替掉 */
export const LEFT_X = 266
/** 右手侧标记块左缘：原图右手侧没有「寸/关/尺」三字，自带一个位置字 */
export const RIGHT_X = 580
/** 右手侧引线终点（原图圆点实测 x 823–835） */
export const RIGHT_DOT_X = 823
/** 每个取法组（浮/中/沉）的横向步距 */
export const GROUP_STEP = 54

export interface Mark {
  hand: Hand
  organ: Organ
  /** 该位置的脏名（讲义 p30 脏位；肾分阴/阳） */
  organName: string
  /** 标记点在原图里的纵坐标（像素，实测：左字中心 725/768.5/812.5、右圆点 721/766/807） */
  y: number
}

/** 六个标记点 */
export const MARKS: Mark[] = [
  { hand: 'L', organ: '寸', organName: '心', y: 723 },
  { hand: 'L', organ: '关', organName: '肝', y: 767 },
  { hand: 'L', organ: '尺', organName: '肾（阴）', y: 810 },
  { hand: 'R', organ: '寸', organName: '肺', y: 723 },
  { hand: 'R', organ: '关', organName: '脾', y: 767 },
  { hand: 'R', organ: '尺', organName: '肾（阳）', y: 810 },
]

/** 该标记块左缘的横坐标 */
export function markX(hand: Hand): number {
  return hand === 'L' ? LEFT_X : RIGHT_X
}

/** 标记块宽度：按取法个数定，三档对齐 */
export function badgeWidth(depthCount: number): number {
  return 50 + (depthCount - 1) * GROUP_STEP + 42
}

/** 该标记位在当前布局下包含哪些取法 */
export function markDepths(layout: LayoutMode, organ: Organ): Depth[] {
  return depthsOf(layout, organ)
}

/** 该布局下图示要横排的取法（以寸为准：九行＝浮中沉，7 脉点＝只沉） */
export function layoutDepths(layout: LayoutMode): Depth[] {
  return depthsOf(layout, '寸')
}
