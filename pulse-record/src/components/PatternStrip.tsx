import { useEffect, useState } from 'react'
import type { PulsePattern } from '../domain/pulse-pattern'
import { groupLegend } from '../domain/pulse-pattern'
import { usePatterns } from '../state/patterns'
import { PatternSheet, hasCells } from './PatternSheet'
import { RuleEditor } from './RuleEditor'

/**
 * 方剂条目的「脉象图」一栏
 *
 * ## 放在哪
 *
 * 紧跟在方剂名之后。一条用方条目讲的其实是「什么脉象 → 用什么方」，
 * 图和方名贴在一起读才顺。
 *
 * ## 数据从哪来
 *
 * 不直接吃传入的数组，而是问 `usePatterns()` 要**合并后的结果**：
 * 手改过的条目用服务端覆盖层，没改过的用内置基线。传入的 `baseline`
 * 只是兜底（内置数据就在 bundle 里，正常情况下 context 自己也能查）。
 *
 * ## 两种画法
 *
 * · **有格位** → 缩略矩阵，点开看大图；
 * · **只有关系注记**（如「尺脉不平衡＝左右尺取法不同」）→ **注记卡**。
 *   这类不能画成空表：一张全空的 9 行表看起来像坏了，也传达不了「关系」这层意思。
 */
interface Props {
  /** FormulaRule.id —— 存覆盖层用的键 */
  formulaId: string
  /** 条件文字，编辑器标题用 */
  formulaLabel: string
  /** 内置基线（context 里查不到时用） */
  baseline?: PulsePattern[]
}

export function PatternStrip({ formulaId, formulaLabel, baseline }: Props) {
  const { patternsOf } = usePatterns()
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)

  const patterns = patternsOf(formulaId, baseline)
  const open = openIndex === null ? null : patterns[openIndex] ?? null
  /** 组说明：多组才有（单组＝所有格同时成立，不用另说） */
  const openLegend = open && hasCells(open) ? groupLegend(open) : null

  /* Esc 关闭大图 */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenIndex(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  /* 一条图都没有：只留一个「加」按钮，不占地方，但入口一直在 */
  if (patterns.length === 0) {
    return (
      <div className="pr-ps" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="pr-ps-add" onClick={() => setEditing(true)}>
          ＋ 加脉象图
        </button>
        {editing && (
          <RuleEditor
            kind="rule"
            id={formulaId}
            title={formulaLabel}
            initialTab="pattern"
            baseline={baseline}
            onClose={() => setEditing(false)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="pr-ps" onClick={(e) => e.stopPropagation()}>
      <div className="pr-ps-head">
        <span className="pr-ps-title">脉象图</span>
        <span className="pr-ps-count">
          {patterns.length > 1 ? `${patterns.length} 张` : '条件示意'}
        </span>
        {/* 与条目上的「编辑／删除」同一套按钮样式（`pr-led-btn`），只留定位 */}
        <button type="button" className="pr-led-btn pr-ps-edit" onClick={() => setEditing(true)}>
          编辑
        </button>
      </div>

      <div className="pr-ps-list">
        {patterns.map((p, i) => {
          const legend = hasCells(p) ? groupLegend(p) : null
          return (
            <button
              key={`${p.title ?? 'p'}-${i}`}
              type="button"
              className={`pr-ps-thumb${hasCells(p) ? '' : ' is-note'}`}
              onClick={() => setOpenIndex(i)}
              title="点开看大图"
            >
              {hasCells(p) ? <PatternSheet pattern={p} compact /> : <NoteThumb pattern={p} />}
              <span className="pr-ps-thumb-label">
                {p.origin === 'manual' && <i className="pr-ps-manual" title="手动填写">手</i>}
                {p.title || `脉象 ${i + 1}`}
              </span>
              {legend && <span className="pr-ps-thumb-groups">{legend}</span>}
            </button>
          )
        })}
      </div>

      {open && (
        <div className="pr-ps-modal" onClick={() => setOpenIndex(null)}>
          <div
            className="pr-ps-modal-box"
            role="dialog"
            aria-label={open.title || '脉象图'}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="pr-ps-modal-head">
              <h4>{open.title || '脉象图'}</h4>
              <button type="button" className="pr-ps-close" onClick={() => setOpenIndex(null)}>
                ✕
              </button>
            </header>

            <div className="pr-ps-modal-body">
              {hasCells(open) && <PatternSheet pattern={open} />}

              {hasCells(open) && openLegend && (
                <p className="pr-ps-legend">
                  <b>每组内部要同时成立；组与组之间有一组成立即算符合。</b>
                  {openLegend}
                </p>
              )}

              {!hasCells(open) && (
                <p className="pr-ps-legend">
                  这一条要求的是<b>关系</b>，不是某几格的具体取值，所以画不成矩阵。
                </p>
              )}

              {open.relations && open.relations.length > 0 && (
                <ul className="pr-ps-relations">
                  {open.relations.map((r, i) => (
                    <li key={`${r.kind}-${i}`}>
                      <b>{r.kind}</b>
                      <span>{r.text}</span>
                    </li>
                  ))}
                </ul>
              )}

              {open.note && <p className="pr-ps-note">{open.note}</p>}
              {open.source && <p className="pr-ps-src">〔{open.source}〕</p>}
              {open.origin === 'manual' && <p className="pr-ps-src">（手动填写，非原文转录）</p>}
            </div>
          </div>
        </div>
      )}

      {editing && (
        <RuleEditor
          kind="rule"
          id={formulaId}
          title={formulaLabel}
          initialTab="pattern"
          baseline={baseline}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  )
}

/** 关系型要求：画不成一格一格的表，用文字卡表达 */
function NoteThumb({ pattern }: { pattern: PulsePattern }) {
  const rel = pattern.relations?.[0]
  return (
    <div className="pr-ps-note-card">
      <span className="pr-ps-note-tag">关系示意</span>
      {rel ? (
        <>
          <b>{rel.kind}</b>
          <span>{rel.text}</span>
        </>
      ) : (
        <span>（无格位，详见出处）</span>
      )}
      {pattern.relations && pattern.relations.length > 1 && (
        <span className="pr-ps-note-more">另有 {pattern.relations.length - 1} 条</span>
      )}
    </div>
  )
}
