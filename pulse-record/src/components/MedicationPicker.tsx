import { useEffect, useMemo } from 'react'
import type { LayoutMode, Session } from '../domain/types'
import {
  PULSE_GROUPS,
  PULSE_POSITIONS,
  buildPulseText,
  codeLabels,
  describeCodes,
  groupPositionsLabel,
  pulsePointLabel,
  pulsePointsOf,
  type FormulaReference,
  type PulseGroup,
  type PulsePoint,
} from '../domain/medication'
import type { CustomSymbol } from '../domain/symbols'

/**
 * 用药记录的选择器（弹窗）—— 两列
 *
 * 左列：处方（讲义 p42「依脉用方表」28 行）。搜索词与页面下方「原文对照」表**共用**，
 *      原来的筛选方式照旧能用；点一行即回填方名与对应脉象的文字表述。
 * 右列：脉象 —— **该次就诊录到的**符号，分两层：
 *      ① 脉位组合（原文名，如「双关同治」「肝肺同治」「肝心同治」「双寸」「双尺」…），
 *         点一下整组选上／再点取消，用来记「双关同治」这类跨脉位的组合；
 *      ② 本次录到的单个脉点，可逐个点选自由组合。
 *      选中的符号会**自动填进左格「对应脉象」**的文字（若该文字未被手改）。
 *
 * 边界：这里只是**记录**与**原文对照**，不是处方建议；工具不替使用者加减方、不下诊断。
 */

interface Props {
  /** 这一行所属的那次就诊（取它录到的脉象） */
  session: Session
  layout: LayoutMode
  customSymbols: CustomSymbol[]
  /** 讲义 p42 处方筛选词（与页面下方「原文对照」表共用） */
  keyword: string
  onKeyword: (kw: string) => void
  /** 已按筛选词过滤的处方列表 */
  formulas: FormulaReference[]
  /** 脉位筛选（'' ＝ 全部） */
  position: string
  onPosition: (p: string) => void
  /** 这一行已选的符号（key 同 Session.values） */
  selected: Record<string, string[]>
  /** 点一个脉点：选／不选 */
  onToggle: (p: PulsePoint) => void
  /** 点一个脉位组合：整组选上／取消 */
  onToggleGroup: (g: PulseGroup) => void
  /** 清掉这一行已选的符号 */
  onClear: () => void
  /** 选一个处方：回填方名与对应脉象文字 */
  onPickFormula: (f: FormulaReference) => void
  onClose: () => void
}

export function MedicationPicker({
  session,
  layout,
  customSymbols,
  keyword,
  onKeyword,
  formulas,
  position,
  onPosition,
  selected,
  onToggle,
  onToggleGroup,
  onClear,
  onPickFormula,
  onClose,
}: Props) {
  /** 该次就诊录到的脉点（带文字） */
  const points = useMemo(() => {
    const list = pulsePointsOf(session, layout)
    return list.map((p) => ({ ...p, text: codeLabels(p.codes, customSymbols) }))
  }, [session, layout, customSymbols])

  /** 按脉位筛选（选「右关」就只列右关的脉） */
  const shown = useMemo(
    () => (position ? points.filter((p) => `${p.hand}|${p.organ}` === position) : points),
    [points, position],
  )

  /**
   * 脉位组合 —— 只列**本次录得到**的成员；全选＝整组在选上。
   * 成员一个都没录到的组合置灰（点了也没东西可选）。
   */
  const groups = useMemo(
    () =>
      PULSE_GROUPS.map((g) => {
        const members = points.filter((p) => g.positions.includes(`${p.hand}|${p.organ}`))
        const on = members.length > 0 && members.every((p) => (selected[p.key] ?? []).length > 0)
        return { group: g, members, on }
      }),
    [points, selected],
  )

  /** 已选的符号（这一行） */
  const picked = useMemo(
    () =>
      Object.keys(selected)
        .filter((k) => (selected[k] ?? []).length > 0)
        .map((k) => {
          const [hand, organ, depth] = k.split('|')
          return {
            key: k,
            label: `${hand === 'L' ? '左' : '右'}${organ} ${depth}`,
            text: describeCodes(selected[k], customSymbols),
          }
        }),
    [selected, customSymbols],
  )

  /** 选完后会自动写进左格「对应脉象」的那段文字 */
  const autoText = useMemo(
    () => buildPulseText(selected ?? {}, customSymbols),
    [selected, customSymbols],
  )

  /** 选中的组合（把出处一并写出来，免得看不出名字的来路） */
  const onGroups = groups.filter((g) => g.on)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="pr-picker-mask" onClick={onClose}>
      <div className="pr-picker" onClick={(e) => e.stopPropagation()}>
        <header className="pr-picker-head">
          <h3>选方与脉象</h3>
          <span className="pr-muted">
            {session.label}　·　左列选处方，右列选本次记录到的脉象；对应脉象的文字与符号并存
          </span>
          <button type="button" className="pr-x" onClick={onClose} title="关闭">
            ×
          </button>
        </header>

        <div className="pr-picker-body">
          {/* 左列：处方（讲义 p42 原表） */}
          <section className="pr-picker-col">
            <h4>处方</h4>
            <input
              className="pr-med-search"
              type="text"
              value={keyword}
              placeholder="搜方名或脉象，如 右关"
              onChange={(e) => onKeyword(e.target.value)}
            />
            <p className="pr-muted pr-picker-hint">
              讲义 2026-10·p42「依脉用方表」{formulas.length} 行
              {formulas.length < 28 && `（筛选「${keyword}」后）`}
              <span className="pr-muted">　·　筛选词与下方「原文对照」表共用</span>
            </p>
            <ul className="pr-picker-list">
              {formulas.map((f) => (
                <li key={f.no}>
                  <button type="button" className="pr-picker-item" onClick={() => onPickFormula(f)}>
                    <span className="pr-picker-no">{f.no}</span>
                    <span className="pr-picker-name">{f.name}</span>
                    <span className="pr-picker-ind">{f.indication}</span>
                  </button>
                </li>
              ))}
              {formulas.length === 0 && <li className="pr-muted pr-picker-none">没有匹配的方。</li>}
            </ul>
          </section>

          {/* 右列：脉象（该次记录到的符号，按脉位筛选） */}
          <section className="pr-picker-col">
            <h4>脉象（本次记录到的）</h4>
            <div className="pr-picker-pos">
              {PULSE_POSITIONS.map((p) => (
                <button
                  key={p.key || 'all'}
                  type="button"
                  className={`pr-picker-chip${position === p.key ? ' is-on' : ''}`}
                  onClick={() => onPosition(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* 脉位组合：一次选多个脉位（名字取原文） */}
            <h5 className="pr-picker-sub">脉位组合（名称取自原文）</h5>
            <div className="pr-picker-groups">
              {groups.map(({ group, members, on }) => (
                <button
                  key={group.id}
                  type="button"
                  className={`pr-picker-chip pr-picker-grp${on ? ' is-on' : ''}${
                    members.length === 0 ? ' is-off' : ''
                  }`}
                  disabled={members.length === 0}
                  title={`${groupPositionsLabel(group)}｜${group.source}`}
                  onClick={() => onToggleGroup(group)}
                >
                  {group.name}
                </button>
              ))}
            </div>
            <p className="pr-muted pr-picker-hint">
              点一下＝整组选上，再点＝取消；组内只在本次录到的脉点上生效。
            </p>
            {onGroups.length > 0 && (
              <div className="pr-picker-srcs">
                {onGroups.map(({ group }) => (
                  <p key={group.id} className="pr-picker-src">
                    {group.name}（{groupPositionsLabel(group)}）—— {group.source}
                  </p>
                ))}
              </div>
            )}

            <ul className="pr-picker-list">
              {shown.map((p) => {
                const on = (selected[p.key] ?? []).length > 0
                return (
                  <li key={p.key}>
                    <button
                      type="button"
                      className={`pr-picker-item pr-picker-pulse${on ? ' is-on' : ''}`}
                      onClick={() => onToggle(p)}
                    >
                      <span className="pr-picker-name">{pulsePointLabel(p)}</span>
                      <span className="pr-picker-codes">{p.codes.join(' ')}</span>
                      <span className="pr-picker-ind">{p.text}</span>
                    </button>
                  </li>
                )
              })}
              {shown.length === 0 && (
                <li className="pr-muted pr-picker-none">
                  {position ? '该脉位这次没有录到符号。' : '这次还没有录到脉象符号。'}
                </li>
              )}
            </ul>
          </section>
        </div>

        <footer className="pr-picker-foot">
          <div className="pr-picker-picked">
            <span className="pr-muted">对应脉象（符号）：</span>
            {picked.length === 0 && <span className="pr-muted">（未选）</span>}
            {picked.map((p) => (
              <span key={p.key} className="pr-med-chip">
                {p.label} {p.text}
              </span>
            ))}
          </div>
          <div className="pr-picker-auto">
            <span className="pr-muted">自动写入左格「对应脉象」：</span>
            <span>{autoText || '（未选符号，暂不填）'}</span>
          </div>
          <div className="pr-picker-actions">
            <button type="button" className="pr-link" onClick={onClear}>
              清空符号
            </button>
            <button type="button" className="pr-ghost" onClick={onClose}>
              完成
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
