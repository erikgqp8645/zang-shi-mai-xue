import type { Depth, LayoutMode, Organ, RowDef } from './types'

/**
 * 行结构 —— 两套并存，可切换，默认 9 行。
 *
 * 讲义内部本身存在两处不一致：
 *   p34 上方定义「寸取 3、关取 3、尺只沉取 1，共 7 个脉点，双手 14 个脉点」
 *   p34 实例表与 p48–50 空白表实际都是每人 9 行（尺含浮、中、沉）
 * 本工具两套都提供，不替读者取舍。
 */
export const LAYOUTS: Record<LayoutMode, RowDef[]> = {
  nine: [
    { organ: '寸', depth: '浮' },
    { organ: '寸', depth: '中' },
    { organ: '寸', depth: '沉' },
    { organ: '关', depth: '浮' },
    { organ: '关', depth: '中' },
    { organ: '关', depth: '沉' },
    { organ: '尺', depth: '浮' },
    { organ: '尺', depth: '中' },
    { organ: '尺', depth: '沉' },
  ],
  seven: [
    { organ: '寸', depth: '浮' },
    { organ: '寸', depth: '中' },
    { organ: '寸', depth: '沉' },
    { organ: '关', depth: '浮' },
    { organ: '关', depth: '中' },
    { organ: '关', depth: '沉' },
    { organ: '尺', depth: '沉' },
  ],
}

/** 按部位分组，返回每组及其行（用于表格的 rowspan 结构） */
export function groupRows(layout: LayoutMode): { organ: Organ; rows: RowDef[] }[] {
  const rows = LAYOUTS[layout]
  const groups: { organ: Organ; rows: RowDef[] }[] = []
  for (const row of rows) {
    const last = groups[groups.length - 1]
    if (last && last.organ === row.organ) last.rows.push(row)
    else groups.push({ organ: row.organ, rows: [row] })
  }
  return groups
}

/** 该布局下某部位包含哪些取法 */
export function depthsOf(layout: LayoutMode, organ: Organ): Depth[] {
  return LAYOUTS[layout].filter((r) => r.organ === organ).map((r) => r.depth)
}
