import { useEffect, useMemo } from 'react'
import type { LayoutMode, Session } from '../domain/types'
import {
  PULSE_POSITIONS,
  codeLabels,
  describeCodes,
  pulsePointLabel,
  pulsePointsOf,
  type FormulaReference,
  type PulsePoint,
} from '../domain/medication'
import type { CustomSymbol } from '../domain/symbols'

/**
 * 用药记录的选择器（弹窗）—— 两列
 *
 * 左列：处方（讲义 p42「依脉用方表」28 行）。搜索词与页面下方「原文对照」表**共用**，
 *      原来的筛选方式照旧能用；点一行即回填方名与对应脉象的文字表述。
 * 右列：脉象 —— **该次就诊录到的**符号，按脉位筛选（全部／左寸／右寸／左关／右关／左尺／右尺）。
 *      点一下即把该脉点的符号并入这一行的「对应脉象」，与文字表述并存。
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
