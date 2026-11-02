import type { RecordSet, Session } from './types'
import { cellKey } from './types'
import { parseCodes } from './symbols'

/**
 * 讲义 2026-10 PDF p34「④ 脉象记录」实例表原样转录 —— 少娟 6 次记录。
 *
 * 仅作示例与格式核对之用；数值照抄原表，不做任何改动。
 * 顺序：21日 / 2月5 / 29日 / 1月21日 / 13日 / 1月5日，每项左右各一。
 */

const LAYOUT: { organ: '寸' | '关' | '尺'; depth: '浮' | '中' | '沉'; cells: string[] }[] = [
  { organ: '寸', depth: '浮', cells: ['+', '+', '↑', '↑', '↑', '↑', '↑', '↑', '↑', '↑', '-', '++'] },
  { organ: '寸', depth: '中', cells: ['++', '++', '↑', '↑', '↑', '↑', '↑', '↑', '↑', '↑', '++', '++'] },
  { organ: '寸', depth: '沉', cells: ['++', '++', '↑', '↑', '↑', '↑', '↑', '↑', '↑', '↑', '++', '++'] },
  { organ: '关', depth: '浮', cells: ['0', '-', '0', '-', '0', '0', '+', '↑', '-', '↑', '-', '-'] },
  { organ: '关', depth: '中', cells: ['-', '↑', '-', 'X↑', '-', '+', '+', '↑', '++', '↑', '+', '+'] },
  { organ: '关', depth: '沉', cells: ['++', '↑', '++', 'X↑', '++', '++', '+', '+', '+', '↑', '++', '++'] },
  { organ: '尺', depth: '浮', cells: ['0', '0', '0', '0', '0', '0', '0', '0', '0', '↑', '0', '0'] },
  { organ: '尺', depth: '中', cells: ['0', '↑', '0+#', '0+#', '0', '+', '0', '0', '+', '↑', '0', '-'] },
  { organ: '尺', depth: '沉', cells: ['++', '↑', '0+#', '0+#', '++', '++', '-', '-', '-', '↑', '-', '+#'] },
]

const LABELS = ['21日', '2月5', '29日', '1月21日', '13日', '1月5日']

export function sampleShaoJuan(): RecordSet {
  const sessions: Session[] = LABELS.map((label, si) => {
    const values: Record<string, string[]> = {}
    for (const row of LAYOUT) {
      const left = row.cells[si * 2]
      const right = row.cells[si * 2 + 1]
      if (left) values[cellKey('L', row.organ, row.depth)] = parseCodes(left)
      if (right) values[cellKey('R', row.organ, row.depth)] = parseCodes(right)
    }
    return { id: `sample-${si}-${label}`, label, values }
  })

  return { name: '少娟', layout: 'nine', sessions }
}
