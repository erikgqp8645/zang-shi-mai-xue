import { useEffect, useMemo, useState } from 'react'
import { FORMULA_RULES, FORMULA_ROUTE_ORDER, type FormulaRule } from '../domain/formulas'
import { DRUGS, DRUG_GROUPS, type Drug } from '../domain/drugs'
import { FORMULA_REFERENCE } from '../domain/medication'
import { formulaAnchor, formulaAnchorId, type FormulaLink } from '../domain/formula-links'
import {
  buildDrugIndex,
  buildRefIndex,
  buildRuleIndex,
  searchEntries,
} from '../domain/library-search'
import {
  DIM_ORDER,
  groupByHand,
  groupByWuxing,
  groupShortLabel,
  type Group,
} from '../domain/grouping'
import { usePatterns } from '../state/patterns'
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
 *
 * ## 搜索与滚动
 *
 * 检索规则在 `src/domain/library-search.ts`（纯函数，网站与小程序共用），
 * 这里只管**把命中的筛出来渲染**。
 *
 * 三处细节，都是踩过的：
 *   1. 搜索框放在**头部**、不在滚动区里 —— 滚到一半还得滚回去改词很难用；
 *   2. 有搜索词就**自动展开** —— 折叠着搜，看不见结果等于没搜；
 *   3. `focus` 进来先**清空搜索** —— 目标可能正被筛掉，锚点元素不在 DOM 里就滚不过去。
 */

interface Props {
  /** 要定位到哪一条（③ 的方名点进来时传） */
  focus?: FormulaLink | null
  /** 常驻条目（用药禁忌）显不显示 —— 与② 命中区共用同一个开关 */
  showStanding: boolean
  onToggleStanding: () => void
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

export function FormulaLibrary({ focus, showStanding, onToggleStanding }: Props) {
  const [open, setOpen] = useState(false)
  const [dim, setDim] = useState<Dim>('route')
  const [query, setQuery] = useState('')
  /** 合并层读数：手填的脉象图也要能被搜到 */
  const { patternsOf } = usePatterns()

  const searching = query.trim() !== ''

  /** 有 focus 或正在搜索时**强制展开** —— 不展开就没法滚到里面／看见结果 */
  const expanded = open || !!focus || searching

  /** 当前要高亮的锚点 id（由 focus 推出，不用另外存 state） */
  const focusId = focus ? formulaAnchorId(focus) : ''

  /* ------------------------------------------------------------------ */
  /* 定位：滚到锚点                                                       */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    if (!focus) return
    // 目标可能被当前筛选词挡在 DOM 外 —— 先清词，等下一次 effect 再滚
    if (query !== '') {
      setQuery('')
      return
    }
    // 本区块此时已是展开状态（expanded 含 focus），锚点元素已进 DOM
    const el = document.getElementById(formulaAnchorId(focus))
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focus, query])

  /* ------------------------------------------------------------------ */
  /* 数据：p44 依脉用方（全量）＋ 讲稿方剂（全量）                          */
  /* ------------------------------------------------------------------ */

  /**
   * 讲义 p44 依脉用方里**要显示的**那部分。
   *
   * 常驻条目（三不用／白虎汤·肾气丸，route＝「用药禁忌」）不依脉象，
   * 关掉开关就不列 —— 与② 命中区同一个开关（状态在 App 里）。
   */
  const visibleRules = useMemo(
    () => (showStanding ? FORMULA_RULES : FORMULA_RULES.filter((r) => !r.always)),
    [showStanding],
  )

  /** 讲义 p44 依脉用方：按维度分组（全量，不是只列命中的） */
  const ruleGroups = useMemo<Group<FormulaRule>[]>(() => {
    if (dim === 'wuxing') return groupByWuxing(visibleRules, (r) => r.id)
    if (dim === 'hand') return groupByHand(visibleRules, (r) => r.id)
    // 讲稿原序：按 route 分组，顺序依 FORMULA_ROUTE_ORDER
    const map = new Map<string, FormulaRule[]>()
    for (const r of visibleRules) {
      const list = map.get(r.route) ?? []
      list.push(r)
      map.set(r.route, list)
    }
    const order = [
      ...FORMULA_ROUTE_ORDER,
      ...Array.from(map.keys()).filter((route) => !FORMULA_ROUTE_ORDER.includes(route)),
    ]
    return order
      .filter((route) => map.has(route))
      .map((route) => ({
        key: route,
        label: route,
        note: '讲义 2026-10·p44「依脉用方」全量条目（按讲稿原序排列）',
        items: map.get(route)!,
      }))
  }, [dim, visibleRules])

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

  /* ------------------------------------------------------------------ */
  /* 检索                                                                */
  /* ------------------------------------------------------------------ */

  const ruleIndex = useMemo(
    // 用 visibleRules（不是 FORMULA_RULES）—— 关掉常驻条目后，它也不该被搜出来，
    // 否则「命中 N 条」会比实际列出来的多。
    () => buildRuleIndex(visibleRules, (rule) => patternsOf(rule.id, rule.patterns)),
    [visibleRules, patternsOf],
  )
  const drugIndex = useMemo(() => buildDrugIndex(DRUGS), [])
  const refIndex = useMemo(() => buildRefIndex(FORMULA_REFERENCE), [])

  /** 命中 id 集合 —— 查询为空时是全集，所以渲染侧只有一套过滤逻辑 */
  const hitRules = useMemo(
    () => new Set(searchEntries(ruleIndex, query).map((e) => e.item.id)),
    [ruleIndex, query],
  )
  const hitDrugs = useMemo(
    () => new Set(searchEntries(drugIndex, query).map((e) => e.item.id)),
    [drugIndex, query],
  )
  const hitRefs = useMemo(
    () => (searching ? searchEntries(refIndex, query).map((e) => e.item) : []),
    [refIndex, query, searching],
  )

  const hitCount = hitRules.size + hitDrugs.size
  const nothing = searching && hitCount === 0 && hitRefs.length === 0

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
            讲义 p44 依脉用方 {visibleRules.length} 条 · 讲稿方剂 {DRUGS.length} 方
          </span>
        </button>
        {/* 计数说明放在按钮外面 —— 按钮里的数字是「现在显示了多少」 */}
        {!showStanding && (
          <span className="pr-flib-standing-note">
            已隐藏常驻条目（用药禁忌）{FORMULA_RULES.length - visibleRules.length} 条
          </span>
        )}

        <div className="pr-flib-search">
          <input
            type="text"
            className="pr-flib-input"
            value={query}
            placeholder="搜方名 · 脉象（如 五味异功散、右寸）"
            aria-label="搜索用方知识库"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query !== '' && (
            <button
              type="button"
              className="pr-flib-input-clear"
              onClick={() => setQuery('')}
              aria-label="清空搜索"
            >
              ×
            </button>
          )}
        </div>

        <p className="pr-flib-hint">
          ③ 里的方名点得进来：对照讲义 p44 与讲稿第二讲，讲得清的给出依据，讲不清的明说「用方页未载」。
          搜索按**方名／脉位／取法／原文用字**匹配，空格分隔多个词即「同时满足」。
        </p>
      </header>

      {expanded && (
        <>
          <div className="pr-flib-tools">
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
            {/*
              常驻条目开关 —— 与② 命中区共用同一个（状态在 App 里）。
              常驻条目不依脉象，关掉后知识库里那一组（「用药禁忌」）整组消失。
            */}
            <button
              type="button"
              className={`pr-filter-chip pr-standing-toggle${showStanding ? ' is-on' : ''}`}
              aria-pressed={showStanding}
              onClick={onToggleStanding}
              title="这两条不依脉象（讲稿第一讲：三不用／上盛用白虎汤·下虚用肾气丸），默认一直在；关掉后② 命中区与③ 用方知识库一起不再列它"
            >
              <span className="pr-filter-key">常驻条目（禁忌）</span>
              <span className="pr-filter-num">{showStanding ? '显示中' : '已隐藏'}</span>
            </button>
            {searching && (
              <p className="pr-flib-hit">
                命中 <strong>{hitCount}</strong> 条
                {hitRefs.length > 0 && <>，另见讲义 p42 表 {hitRefs.length} 条</>}
                <button type="button" className="pr-flib-hit-clear" onClick={() => setQuery('')}>
                  清空
                </button>
              </p>
            )}
          </div>

          <div className="pr-flib-body">
            {nothing ? (
              <p className="pr-flib-empty">
                没有匹配的条目。可试方名（五味异功散）、脉位（右寸）、取法（浮／沉）、
                原文用字（浮大）或关系型说法（尺脉不平衡）。
              </p>
            ) : (
              <>
                {/* ---- 讲义 p44 依脉用方（全量） ---- */}
                <section className="pr-formula-group">
                  <h3 className="pr-formula-route">讲义 p44「依脉用方」· 全量条目</h3>
                  <p className="pr-target-line">
                    {dim === 'route'
                      ? '按讲稿原序排列：讲义 p44 四个挡路 → 讲稿第四~六讲「清挡路一~六」→ 讲稿第二讲「叁、用方」「肆、依脉辨证论治」。'
                      : '同一条按脏腑／左右手归位；条件、治法、原文仍照讲义原样转录。'}
                  </p>
                  {ruleGroups.map((g) => {
                    const items = g.items.filter((r) => hitRules.has(r.id))
                    // 整组都被筛掉就整组不渲染 —— 留个空标题只会让人以为下面还有东西
                    if (items.length === 0) return null
                    return (
                      <div key={g.key} className="pr-flib-group">
                        <h4 className="pr-drug-group-title">
                          {dim === 'route' ? g.label : groupShortLabel(dim, g.key)}
                          {searching && <span className="pr-flib-group-hit">{items.length}</span>}
                        </h4>
                        {dim !== 'route' && <p className="pr-target-line">{g.note}</p>}
                        {items.map((r) => (
                          <div
                            key={r.id}
                            id={formulaAnchor('rule', r.id)}
                            className={`pr-flib-anchor${focusId === formulaAnchor('rule', r.id) ? ' is-focus' : ''}`}
                          >
                            {/*
                              紧凑一行：折叠时只留「标题 ｜ 疗法 ｜ 方名」，点开才看
                              脉象图／原文／方剂卡。kind 徽章在紧凑态不出现 ——
                              route 标题已经表达了结构（详见 Findings.tsx 的 FormulaItem）。
                              从 ③ 的方名跳进来时（focusId 对上）自动展开那一条。
                            */}
                            <FormulaItem
                              item={libraryRule(r)}
                              srcNote=" · 全量条目（知识库）"
                              compact
                              autoOpen={focusId === formulaAnchor('rule', r.id)}
                            />
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </section>

                {/* ---- 讲稿 2010 方剂（全量） ---- */}
                <section className="pr-formula-group">
                  <h3 className="pr-formula-route">
                    {dim === 'route'
                      ? '讲稿 2010·第二讲「叁、用方」· 全量方剂'
                      : `讲稿方剂 · ${DIM_LABEL[dim]}`}
                  </h3>
                  <p className="pr-target-line">
                    组成、服法、科学中药、加减与禁忌**原样转录**，不替读者加减方。
                  </p>
                  {drugGroups.map((g) => {
                    const items = g.items.filter((d) => hitDrugs.has(d.id))
                    if (items.length === 0) return null
                    return (
                      <div key={g.key} className="pr-flib-group">
                        <h4 className="pr-drug-group-title">
                          {dim === 'route' ? g.label : groupShortLabel(dim, g.key)}
                          {searching && <span className="pr-flib-group-hit">{items.length}</span>}
                        </h4>
                        {dim !== 'route' && <p className="pr-target-line">{g.note}</p>}
                        {items.map((d) => (
                          <div
                            key={d.id}
                            id={formulaAnchor('drug', d.id)}
                            className={`pr-flib-anchor${focusId === formulaAnchor('drug', d.id) ? ' is-focus' : ''}`}
                          >
                            {/* 与上面同一种紧凑一行 —— 讲稿方剂也要能一眼扫完 */}
                            <DrugCard
                              drug={d}
                              showAttr={dim !== 'route'}
                              compact
                              autoOpen={focusId === formulaAnchor('drug', d.id)}
                            />
                          </div>
                        ))}
                      </div>
                    )
                  })}
                  {dim !== 'route' && groupOrder.length > 0 && drugGroups.length === 0 && (
                    <p className="pr-empty">当前维度下没有方剂。</p>
                  )}
                </section>

                {/*
                  讲义 p42「依脉用方表」的另一份转录 —— 它渲染在下方「用药记录」里，
                  不在本区块。搜方名时不该因为「在另一块」就搜不到，所以命中时列出来。
                  只列命中的行，不当成第三套全量视图（那会与备查表重复）。
                */}
                {hitRefs.length > 0 && (
                  <section className="pr-flib-extra">
                    <h3 className="pr-formula-route">另见 · 讲义 p42「依脉用方表」</h3>
                    <p className="pr-target-line">
                      这 {hitRefs.length} 条在下方「用药记录 · 方剂备查」里，此处只列命中的原表行。
                    </p>
                    <ul className="pr-flib-extra-list">
                      {hitRefs.map((ref) => (
                        <li key={ref.no}>
                          <span className="pr-flib-extra-no">{ref.no}</span>
                          <strong className="pr-flib-extra-name">{ref.name}</strong>
                          <span className="pr-flib-extra-ind">{ref.indication}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </div>
        </>
      )}
    </section>
  )
}
