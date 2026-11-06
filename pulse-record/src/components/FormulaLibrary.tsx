import { useEffect, useMemo, useState } from 'react'
import { FORMULA_RULES, FORMULA_ROUTE_ORDER, type FormulaRule } from '../domain/formulas'
import { DRUGS, DRUG_GROUPS, type Drug } from '../domain/drugs'
import { formulaAnchor, formulaAnchorId, type FormulaLink } from '../domain/formula-links'
import {
  DIM_ORDER,
  groupByHand,
  groupByWuxing,
  groupShortLabel,
  type Group,
} from '../domain/grouping'
import { DrugCard, FormulaItem, type SessionFormulaHit } from './Findings'

/**
 * 用方知识库 —— ③「开方药」档里的一块**可折叠**全量视图
 *
 * ## 要解决什么
 *
 * ③ 开方药档列的是**讲义 p47「开方三部曲图」上的方名**（上焦方／中焦方／清挡路方／下焦方／
 * 引火归元／冷热水）。这些方名**看得见，点不进去** —— 读者不知道这方怎么吃、
 * 什么脉象才用、有什么禁忌。
 *
 * 「用方」知识库（讲义 p44 依脉用方 ＋ 讲稿第二讲方剂 ＋ 同和堂版成方）在别处，
 * 两边是**同一个方在不同资料里的不同写法**，所以要能对上。
 * 对照表在 `src/domain/formula-links.ts`（`resolveFormulaLink`），
 * **每条对照都带依据**，查不到就返回 null（界面上明说「用方页未载」，不硬凑）。
 *
 * ## 为什么放在 ③ 而不是 ②
 *
 * ②「定疗法」面板的「方剂备查」是**判读时的参考**（依脉命中了什么方 → 回头查组成）。
 * ③ 是**正在开方的那一支** —— 读者在这一档问的是「这一支的方，具体怎么吃」。
 * 用途不同，不是无意义重复。
 *
 * ## 定位怎么做的
 *
 * 每张卡片外面套一个带 `id` 的壳，`id` 由 `formulaAnchor(kind, id)` 统一生成 ——
 * 渲染与跳转走**同一个函数**，不会走偏。
 * 点 ③ 的方名 → `focus` 传进来 → 先展开本区块 → 再滚到锚点 → 锚点高亮。
 *
 * 锚点 id 在整页**唯一**：本区块是页面里唯一给这些卡片发 id 的地方
 * （② 的命中区不给 id），所以不会出现两个元素抢同一个锚点。
 */

interface Props {
  /** 要定位到哪一条（③ 的方名点进来时传） */
  focus?: FormulaLink | null
}

/** 依脉开方的分组维度：讲稿原序 / 按五行 / 按左右手（与 ② 面板同一套） */
type Dim = 'route' | 'wuxing' | 'hand'

const DIM_LABEL: Record<Dim, string> = {
  route: '讲稿原序',
  wuxing: '按五行',
  hand: '按左右手',
}

/**
 * 知识库里的条目**不是命中项** —— 它没有「命中记录」可写。
 * 这里造一个空 `cells` 的命中项，渲染时用 `srcNote` 改掉出处行。
 */
function libraryRule(rule: FormulaRule): SessionFormulaHit {
  return {
    sessionId: '__library__',
    sessionLabel: '全量',
    hit: { ...rule, cells: [] },
  }
}

export function FormulaLibrary({ focus }: Props) {
  const [open, setOpen] = useState(false)
  const [dim, setDim] = useState<Dim>('route')

  /** 有 focus 时**强制展开** —— 不展开就没法滚到里面 */
  const expanded = open || !!focus

  /** 当前要高亮的锚点 id（由 focus 推出，不用另外存 state） */
  const focusId = focus ? formulaAnchorId(focus) : ''

  /* ------------------------------------------------------------------ */
  /* 定位：滚到锚点                                                       */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    if (!focus) return
    const anchor = formulaAnchorId(focus)
    // 本区块此时已是展开状态（expanded 含 focus），锚点元素已进 DOM
    const el = document.getElementById(anchor)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focus])

  /* ------------------------------------------------------------------ */
  /* 数据：p44 依脉用方（全量）＋ 讲稿方剂（全量）                          */
  /* ------------------------------------------------------------------ */

  /** 讲义 p44 依脉用方：按维度分组（全量，不是只列命中的） */
  const ruleGroups = useMemo<Group<FormulaRule>[]>(() => {
    if (dim === 'wuxing') return groupByWuxing(FORMULA_RULES, (r) => r.id)
    if (dim === 'hand') return groupByHand(FORMULA_RULES, (r) => r.id)
    // 讲稿原序：按 route 分组，顺序依 FORMULA_ROUTE_ORDER
    const map = new Map<string, FormulaRule[]>()
    for (const r of FORMULA_RULES) {
      const list = map.get(r.route) ?? []
      list.push(r)
      map.set(r.route, list)
    }
    const order = [
      ...FORMULA_ROUTE_ORDER,
      ...Array.from(map.keys()).filter((k) => !FORMULA_ROUTE_ORDER.includes(k)),
    ]
    return order
      .filter((route) => map.has(route))
      .map((route) => ({
        key: route,
        label: route,
        note: '讲义 2026-10·p44「依脉用方」全量条目（按讲稿原序排列）',
        items: map.get(route)!,
      }))
  }, [dim])

  /** 讲稿 2010 方剂：按维度分组（全量） */
  const drugGroups = useMemo<Group<Drug>[]>(() => {
    if (dim === 'wuxing') return groupByWuxing(DRUGS, (d) => d.id)
    if (dim === 'hand') return groupByHand(DRUGS, (d) => d.id)
    // 讲稿原序：按讲稿第二讲「叁、用方」的三种疗法
    return DRUG_GROUPS.map((g) => ({
      key: g.therapy,
      label: g.title,
      note: '讲稿 2010·第二讲「叁、用方」',
      items: DRUGS.filter((d) => d.therapy === g.therapy),
    })).filter((g) => g.items.length > 0)
  }, [dim])

  /** 按五行／左右手时的分组顺序（与 ② 面板同一套） */
  const groupOrder = dim === 'wuxing' ? DIM_ORDER.wuxing : dim === 'hand' ? DIM_ORDER.hand : []

  return (
    <section className={`pr-flib${expanded ? ' is-open' : ''}`} id="pr-flib">
      <header className="pr-flib-head">
        <button
          type="button"
          className="pr-flib-toggle"
          onClick={() => setOpen(!open)}
          aria-expanded={expanded}
        >
          <span className="pr-flib-caret">{expanded ? '▾' : '▸'}</span>
          <span className="pr-flib-title">用方知识库</span>
          <span className="pr-flib-count">
            讲义 p44 依脉用方 {FORMULA_RULES.length} 条 · 讲稿方剂 {DRUGS.length} 方
          </span>
        </button>
        <p className="pr-flib-hint">
          ③ 里的方名点得进来：对照讲义 p44 与讲稿第二讲，讲得清的给出依据，讲不清的明说「用方页未载」。
        </p>
      </header>

      {expanded && (
        <div className="pr-flib-body">
          <div className="pr-dim">
            <span className="pr-dim-label">用方知识库 · 分组维度</span>
            {(Object.keys(DIM_LABEL) as Dim[]).map((d) => (
              <button
                key={d}
                type="button"
                className={`pr-dim-btn${dim === d ? ' is-on' : ''}`}
                onClick={() => setDim(d)}
              >
                {DIM_LABEL[d]}
              </button>
            ))}
          </div>

          {/* ---- 讲义 p44 依脉用方（全量） ---- */}
          <section className="pr-formula-group">
            <h3 className="pr-formula-route">讲义 p44「依脉用方」· 全量条目</h3>
            <p className="pr-target-line">
              {dim === 'route'
                ? '按讲稿原序排列：讲义 p44 四个挡路 → 讲稿第四~六讲「清挡路一~六」→ 讲稿第二讲「叁、用方」「肆、依脉辨证论治」。'
                : '同一条按脏腑／左右手归位；条件、治法、原文仍照讲义原样转录。'}
            </p>
            {ruleGroups.map((g) => (
              <div key={g.key} className="pr-flib-group">
                <h4 className="pr-drug-group-title">
                  {dim === 'route' ? g.label : groupShortLabel(dim, g.key)}
                </h4>
                {dim !== 'route' && <p className="pr-target-line">{g.note}</p>}
                {g.items.map((r) => (
                  <div
                    key={r.id}
                    id={formulaAnchor('rule', r.id)}
                    className={`pr-flib-anchor${focusId === formulaAnchor('rule', r.id) ? ' is-focus' : ''}`}
                  >
                    <FormulaItem item={libraryRule(r)} srcNote=" · 全量条目（知识库）" />
                  </div>
                ))}
              </div>
            ))}
          </section>

          {/* ---- 讲稿 2010 方剂（全量） ---- */}
          <section className="pr-formula-group">
            <h3 className="pr-formula-route">
              {dim === 'route' ? '讲稿 2010·第二讲「叁、用方」· 全量方剂' : `讲稿方剂 · ${DIM_LABEL[dim]}`}
            </h3>
            <p className="pr-target-line">
              组成、服法、科学中药、加减与禁忌**原样转录**，不替读者加减方。
            </p>
            {drugGroups.map((g) => (
              <div key={g.key} className="pr-flib-group">
                <h4 className="pr-drug-group-title">
                  {dim === 'route' ? g.label : groupShortLabel(dim, g.key)}
                </h4>
                {dim !== 'route' && <p className="pr-target-line">{g.note}</p>}
                {g.items.map((d) => (
                  <div
                    key={d.id}
                    id={formulaAnchor('drug', d.id)}
                    className={`pr-flib-anchor${focusId === formulaAnchor('drug', d.id) ? ' is-focus' : ''}`}
                  >
                    <DrugCard drug={d} showAttr={dim !== 'route'} />
                  </div>
                ))}
              </div>
            ))}
            {dim !== 'route' && groupOrder.length > 0 && drugGroups.length === 0 && (
              <p className="pr-empty">当前维度下没有方剂。</p>
            )}
          </section>
        </div>
      )}
    </section>
  )
}
