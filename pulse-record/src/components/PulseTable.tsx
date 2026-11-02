import type { Depth, Hand, Organ, RecordSet } from '../domain/types'
import { cellKey } from '../domain/types'
import { groupRows } from '../domain/layout'
import { formatCodes } from '../domain/symbols'

export interface CellRef {
  sessionId: string
  hand: Hand
  organ: Organ
  depth: Depth
}

interface Props {
  set: RecordSet
  selected: CellRef | null
  onSelect: (ref: CellRef) => void
  highlight: Set<string>
  /** 当前选中的日期（记录列）：该列高亮 */
  activeSessionId: string | null
  /** 点表头日期 → 切换当前日期 */
  onSelectSession: (id: string) => void
}

export function PulseTable({ set, selected, onSelect, highlight, activeSessionId, onSelectSession }: Props) {
  const groups = groupRows(set.layout)

  if (set.sessions.length === 0) {
    return <p className="pr-empty">还没有记录。先在工具条添加一次记录（日期），再在格子里选脉象。</p>
  }

  return (
    <div className="pr-table-wrap">
      <table className="pr-table">
        <thead>
          {/* 表头第一行：标签区留白（照讲义原表，姓名框上方不画线），日期横跨左右两列 */}
          <tr>
            <th className="pr-lead" colSpan={2} />
            {set.sessions.map((s, i) => (
              <th
                key={s.id}
                className={`pr-date${i === set.sessions.length - 1 ? ' pr-group-end' : ''}${s.id === activeSessionId ? ' is-active' : ''}`}
                colSpan={2}
                onClick={() => onSelectSession(s.id)}
                title="点一下把这一列设为当前日期（寸关尺图示随之变化）"
              >
                {s.label}
              </th>
            ))}
          </tr>
          {/* 表头第二行：姓名框横跨「部位 + 取法」两列 */}
          <tr>
            <th className="pr-name" colSpan={2}>{set.name || '姓名'}</th>
            {set.sessions.flatMap((s, i) => [
              <th key={`${s.id}-L`}>左</th>,
              <th
                key={`${s.id}-R`}
                className={i === set.sessions.length - 1 ? 'pr-group-end' : ''}
              >
                右
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {groups.map((g, gi) =>
            g.rows.map((row, ri) => (
              <tr key={`${g.organ}-${row.depth}`}>
                {ri === 0 && (
                  <th
                    className={`pr-organ${gi > 0 ? ' pr-group-start' : ''}`}
                    rowSpan={g.rows.length}
                  >
                    {g.organ}
                  </th>
                )}
                <th className="pr-depth">{row.depth}</th>
                {set.sessions.flatMap((s) =>
                  (['L', 'R'] as const).map((hand) => {
                    const key = cellKey(hand, row.organ, row.depth)
                    const codes = s.values[key] ?? []
                    const isSel =
                      selected?.sessionId === s.id &&
                      selected.hand === hand &&
                      selected.organ === row.organ &&
                      selected.depth === row.depth
                    const isHit = highlight.has(`${s.id}::${key}`)
                    const isActive = s.id === activeSessionId
                    return (
                      <td
                        key={`${s.id}-${hand}`}
                        className={`pr-cell${isSel ? ' is-selected' : ''}${isHit ? ' is-hit' : ''}${isActive ? ' is-active' : ''}`}
                        onClick={() => onSelect({ sessionId: s.id, hand, organ: row.organ, depth: row.depth })}
                        title={isSel ? '已选中，点击下方符号面板录入' : '点击录入脉象'}
                      >
                        {formatCodes(codes)}
                      </td>
                    )
                  }),
                )}
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  )
}
