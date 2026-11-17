import { Fragment, useMemo } from 'react'
import type { FormulaRule } from '../domain/formulas'
import type { Drug } from '../domain/drugs'
import type { Group } from '../domain/grouping'
import { attribOf } from '../domain/grouping'
import { hasCells } from './PatternSheet'
import { PatternSheet } from './PatternSheet'
import type { PulsePattern } from '../domain/pulse-pattern'

/**
 * 用方知识库 · **卡片视图**（与列表视图共存，由工具行的开关切换）
 *
 * ## 一张卡片放什么
 *
 * 依脉用方：**脉象图 · 脉象 · 治法 · 说明**（外加类别徽章）。
 * 讲稿方剂：**组成 · 服法 · 适用脉象 · 禁忌**（外加类别徽章；方剂没有脉象图）。
 * 方名与出处**不上卡片** —— 需要时点「编辑」或切回列表看。
 *
 * ## 一个网格，不是一堆网格
 *
 * ⚠️ 原来每个分组各建一个 grid ⇒ 组内条目数不是 4 的倍数时，末尾空格子
 *    露出来是一大块脏灰（容器底色 `var(--line-soft)` ＝ 分隔线颜色，
 *    「1px gap ＋ 底色露出来」那套画线方式撑不住空格）。
 *    现在**所有分组的卡片连在一个网格里**，组标题是 `grid-column: 1 / -1`
 *    的跨列行 ⇒ 只有整个列表的最后一行才可能不满。
 *
 * ## 分隔线靠卡片自己的边框
 *
 * 卡片各有 `border` ＋ `border-radius`，卡间留 8px 空隙；容器**透明**。
 * 空位就是空位，不会再有灰块。
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

/** 一组条目（复用 `domain/grouping.ts` 的 `Group<T>` 形状） */
export type CardGroup<T> = Group<T>

interface Props {
  /** 分组（组标题会跨列渲染成一行） */
  groups: CardGroup<FormulaRule>[]
  /** 取这一条的脉象图（生效集：基线 ⊕ 覆盖层） */
  patternsOf: (id: string, baseline?: PulsePattern[]) => PulsePattern[]
  canEdit: boolean
  /** 点「编辑」—— 与列表视图走同一个编辑弹层 */
  onEdit: (rule: FormulaRule) => void
  /** 分组标题要不要显示（与列表视图共用同一个共享层开关） */
  showGroupTitles: boolean
  /** 按维度分组时，标题用短名（按五行／按左右手）；讲稿原序用全名 */
  groupLabel?: (g: CardGroup<FormulaRule>) => string
}

/** 类别 → 颜色（与列表视图的左色条同一套语义） */
const KIND_ROLE: Record<string, string> = {
  主线: 'cinnabar',
  挡路: 'clay',
  加味: 'dai',
  禁忌: 'sage',
}

export function LibraryCards({
  groups,
  patternsOf,
  canEdit,
  onEdit,
  showGroupTitles,
  groupLabel,
}: Props) {
  /** 每条配它的图（第一张）；关系型条目没有图 */
  const cards = useMemo(() => {
    const map = new Map<string, PulsePattern | null>()
    for (const g of groups) {
      for (const r of g.items) {
        if (map.has(r.id)) continue
        map.set(r.id, (patternsOf(r.id) ?? [])[0] ?? null)
      }
    }
    return map
  }, [groups, patternsOf])

  const total = groups.reduce((n, g) => n + g.items.length, 0)
  if (total === 0) {
    return <p className="pr-flib-empty">没有匹配的条目。</p>
  }

  return (
    <div className="pr-libcards">
      {groups.map((g) => (
        <Fragment key={g.key}>
          {showGroupTitles ? (
            <h4 className="pr-libcards-head">{groupLabel ? groupLabel(g) : g.label}</h4>
          ) : null}
          {g.items.map((r) => {
            const role = KIND_ROLE[r.kind] ?? 'muted'
            const pattern = cards.get(r.id) ?? null
            return (
              <article key={r.id} className={`pr-libcard is-${role}`}>
                <header className="pr-libcard-head">
                  <span className={`pr-libcard-kind is-${role}`}>{r.kind}</span>
                  <h4 className="pr-libcard-title">{r.condition}</h4>
                  {/* 没定归类的标一下 —— 按讲次排时看不出哪些待补（2026-11-15） */}
                  {attribOf(r.id, r) ? null : (
                    <span className="pr-libcard-unclassified">未分类</span>
                  )}
                </header>

                {/* 有格子才画；关系型条目这里什么都不渲染 */}
                {pattern && hasCells(pattern) ? (
                  <div className="pr-libcard-diagram">
                    <PatternSheet pattern={pattern} compact />
                  </div>
                ) : null}

                <dl className="pr-libcard-meta">
                  <dt>治法</dt>
                  <dd>{r.therapy || '—'}</dd>
                  <dt>说明</dt>
                  <dd className="pr-libcard-quote">{r.quote || '—'}</dd>
                </dl>

                {canEdit ? (
                  <footer className="pr-libcard-foot">
                    <button type="button" className="pr-led-btn" onClick={() => onEdit(r)}>
                      编辑
                    </button>
                  </footer>
                ) : null}
              </article>
            )
          })}
        </Fragment>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 讲稿方剂 · 卡片                                                     */
/* ------------------------------------------------------------------ */

interface DrugCardsProps {
  groups: CardGroup<Drug>[]
  canEdit: boolean
  /** 点「编辑」—— 走同一个编辑弹层（`openForeignEditor`） */
  onEdit: (kind: string, id: string, name: string) => void
  showGroupTitles: boolean
  groupLabel?: (g: CardGroup<Drug>) => string
}

/**
 * 讲稿 2010 方剂的卡片。
 *
 * 方剂**没有脉象图**（那是依脉用方才有的）⇒ 卡片从标题直接进正文。
 * 字段取讲稿原样照录的四行：组成 / 服法 / 适用脉象 / 禁忌。
 */
export function LibraryDrugCards({
  groups,
  canEdit,
  onEdit,
  showGroupTitles,
  groupLabel,
}: DrugCardsProps) {
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  if (total === 0) {
    return <p className="pr-flib-empty">没有匹配的方剂。</p>
  }

  return (
    <div className="pr-libcards">
      {groups.map((g) => (
        <Fragment key={g.key}>
          {showGroupTitles ? (
            <h4 className="pr-libcards-head">{groupLabel ? groupLabel(g) : g.label}</h4>
          ) : null}
          {g.items.map((d) => (
            <article key={d.id} className="pr-libcard is-muted">
              <header className="pr-libcard-head">
                <span className="pr-libcard-kind is-muted">方剂</span>
                <h4 className="pr-libcard-title">{d.name}</h4>
              </header>

              <dl className="pr-libcard-meta">
                <dt>组成</dt>
                <dd>{d.composition || '—'}</dd>
                <dt>服法</dt>
                <dd>{d.usage || '—'}</dd>
                <dt>适用</dt>
                <dd>{d.indication || '—'}</dd>
                <dt>禁忌</dt>
                <dd>{d.contraindication || '—'}</dd>
              </dl>

              {canEdit ? (
                <footer className="pr-libcard-foot">
                  <button
                    type="button"
                    className="pr-led-btn"
                    onClick={() => onEdit('drug', d.id, d.name)}
                  >
                    编辑
                  </button>
                </footer>
              ) : null}
            </article>
          ))}
        </Fragment>
      ))}
    </div>
  )
}
