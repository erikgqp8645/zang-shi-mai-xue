import { useState } from 'react'
import type { Constitution, Depth, Hand, Organ, RecordSet } from '../domain/types'
import { cellKey } from '../domain/types'
import { groupRows } from '../domain/layout'
import { formatCodes } from '../domain/symbols'
import { CONSTITUTION_OPTIONS } from '../domain/triad'

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
  /** 选体质（该次就诊自判；工具不代判） */
  onPickConstitution: (sessionId: string, c: Constitution) => void
  /** 清除该次就诊的体质（连同随体质带出的疗法） */
  onClearConstitution: (sessionId: string) => void
}

export function PulseTable({
  set,
  selected,
  onSelect,
  highlight,
  activeSessionId,
  onSelectSession,
  onPickConstitution,
  onClearConstitution,
}: Props) {
  const groups = groupRows(set.layout)
  /** 正在选体质的那个记录列 */
  const [editing, setEditing] = useState<string | null>(null)

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
        {/*
          表下「体质」行：体质随治疗推进会变，所以每个记录日期各记各的。
          这一行是工具自己加的（讲义 p34 原表没有），**不进导出**。
        */}
        <tfoot>
          <tr className="pr-tfoot">
            <th className="pr-tfoot-label" colSpan={2}>
              体质
            </th>
            {set.sessions.map((s, i) => (
              <td
                key={s.id}
                colSpan={2}
                className={`pr-tfoot-cell${s.id === activeSessionId ? ' is-active' : ''}${
                  i === set.sessions.length - 1 ? ' pr-group-end' : ''
                }`}
              >
                {editing === s.id ? (
                  <div className="pr-tfoot-pick">
                    {CONSTITUTION_OPTIONS.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        className={`pr-tfoot-opt${s.constitution === o.id ? ' is-on' : ''}`}
                        onClick={() => {
                          onPickConstitution(s.id, o.id)
                          setEditing(null)
                        }}
                        title={o.path}
                      >
                        <b>{o.id}</b>
                        <em>{o.therapy}</em>
                      </button>
                    ))}
                    {s.constitution && (
                      <button
                        type="button"
                        className="pr-tfoot-clear"
                        onClick={() => {
                          onClearConstitution(s.id)
                          setEditing(null)
                        }}
                      >
                        清除
                      </button>
                    )}
                    <span className="pr-tfoot-pick-note">
                      选后按图带出疗法，可在 ② 改
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="pr-tfoot-val"
                    onClick={() => {
                      // 与点表头日期一致：把这一列设为当前日期，
                      // 这样 ① 框里的体质、② 框里的疗法都对得上这一列
                      onSelectSession(s.id)
                      setEditing(s.id)
                    }}
                    title="点一下选这次的体质（同时把这一列设为当前日期）"
                  >
                    {s.constitution ? (
                      <>
                        <b>{s.constitution}体质</b>
                        {s.therapy && <em>{s.therapy}</em>}
                      </>
                    ) : (
                      <span className="pr-muted">（未判）</span>
                    )}
                  </button>
                )}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
