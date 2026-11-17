import { useMemo } from 'react'
import type { FormulaRule } from '../domain/formulas'
import { hasCells } from './PatternSheet'
import { PatternSheet } from './PatternSheet'
import type { PulsePattern } from '../domain/pulse-pattern'

/**
 * 用方知识库 · **卡片视图**（与列表视图共存，由工具行的开关切换）
 *
 * ## 一张卡片放什么
 *
 * 按使用者定的四样：**脉象图 · 脉象 · 治法 · 说明**（外加类别徽章）。
 * 方名与出处**不上卡片** —— 需要时点「编辑」或切回列表看。
 *
 * ## 没有矩阵的条目不画图
 *
 * 「关系型」条目（如变脉无力）原文就不是格子，是「任一部位出现变脉…」这种话。
 * 这类卡片**不画任何图**（`PatternSheet` 对空 cells 自己返回 null），
 * 卡片就只剩文字 —— 不拿文字块硬填一个「图」的位置。
 *
 * ## 说明只留两行
 *
 * 原文引用普遍很长，卡片里两行截断（CSS `line-clamp`）。
 * 全文在列表视图 / 编辑弹层里看。
 */

interface Props {
  rules: FormulaRule[]
  /** 取这一条的脉象图（生效集：基线 ⊕ 覆盖层） */
  patternsOf: (id: string, baseline?: PulsePattern[]) => PulsePattern[]
  canEdit: boolean
  /** 点「编辑」—— 与列表视图走同一个编辑弹层 */
  onEdit: (rule: FormulaRule) => void
}

/** 类别 → 颜色（与列表视图的左色条同一套语义） */
const KIND_ROLE: Record<string, string> = {
  主线: 'cinnabar',
  挡路: 'clay',
  加味: 'dai',
  禁忌: 'sage',
}

export function LibraryCards({ rules, patternsOf, canEdit, onEdit }: Props) {
  const cards = useMemo(
    () =>
      rules.map((r) => ({
        rule: r,
        pattern: (patternsOf(r.id) ?? [])[0] ?? null,
      })),
    [rules, patternsOf],
  )

  if (cards.length === 0) {
    return <p className="pr-flib-empty">没有匹配的条目。</p>
  }

  return (
    <div className="pr-libcards">
      {cards.map(({ rule, pattern }) => {
        const role = KIND_ROLE[rule.kind] ?? 'muted'
        return (
          <article key={rule.id} className={`pr-libcard is-${role}`}>
            <header className="pr-libcard-head">
              <span className={`pr-libcard-kind is-${role}`}>{rule.kind}</span>
              <h4 className="pr-libcard-title">{rule.condition}</h4>
            </header>

            {/* 有格子才画；关系型条目这里什么都不渲染 */}
            {pattern && hasCells(pattern) ? (
              <div className="pr-libcard-diagram">
                <PatternSheet pattern={pattern} compact />
              </div>
            ) : null}

            <dl className="pr-libcard-meta">
              <dt>治法</dt>
              <dd>{rule.therapy || '—'}</dd>
              <dt>说明</dt>
              <dd className="pr-libcard-quote">{rule.quote || '—'}</dd>
            </dl>

            {canEdit ? (
              <footer className="pr-libcard-foot">
                <button type="button" className="pr-led-btn" onClick={() => onEdit(rule)}>
                  编辑
                </button>
              </footer>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}
