import { useMemo, useState } from 'react'
import type { RuleHit } from '../domain/rules'
import {
  CONSTITUTION_TABLE,
  FORMULA_ROUTE_ORDER,
  STANDING_FORMULA_RULES,
  type FormulaHit,
} from '../domain/formulas'
import { DRUG_BY_ID, DRUG_GROUPS, DRUGS, type Drug } from '../domain/drugs'
import {
  DOSE_SCIENCE_NAME,
  FORMULA_DOSES,
  FORMULA_SCIENCES,
  FORMULA_SCIENCE_BY_NAME,
  type FormulaDose,
  type FormulaScience,
} from '../domain/formula-table'
import { FlowPath } from './FlowPath'
import { DoseLines } from './DoseLines'
import {
  DIM_ORDER,
  groupByHand,
  groupByWuxing,
  groupShortLabel,
  RULE_OR_DRUG_ATTRIB,
  STANDING_DISPLAY,
  type Attribution,
  type Group,
} from '../domain/grouping'

export interface SessionHit {
  sessionId: string
  sessionLabel: string
  hit: RuleHit
}

export interface SessionFormulaHit {
  sessionId: string
  sessionLabel: string
  hit: FormulaHit
}

interface Props {
  hits: SessionHit[]
  formulaHits: SessionFormulaHit[]
  onFocus: (h: SessionHit) => void
  onFocusFormula: (h: SessionFormulaHit) => void
  /** 按五行／按左右手时打开的分组（筛选开关，与 Markdown 导出同步） */
  wuxingFilter: string[]
  handFilter: string[]
  onFilterChange: (dim: 'wuxing' | 'hand', keys: string[]) => void
}

const SEVERITY_LABEL: Record<RuleHit['severity'], string> = {
  high: '高危',
  warn: '提示',
  info: '参考',
}

type Tab = 'risk' | 'formula'

/** 依脉开方的分组维度：讲稿原序 / 按五行 / 按左右手 */
type Dim = 'route' | 'wuxing' | 'hand'

const DIM_LABEL: Record<Dim, string> = {
  route: '讲稿原序',
  wuxing: '按五行',
  hand: '按左右手',
}

const DIM_HINT: Record<Dim, string> = {
  route:
    '依讲稿原序排列：讲义 p44「依脉用方」四个挡路 → 讲稿第四~六讲「清挡路一~六」→ 讲稿第二讲「叁、用方」「肆、依脉辨证论治」。',
  wuxing:
    '按讲稿 2010·第一讲「五行归类」木火土金水→肝心脾肺肾重排；脏位对应据讲义 2026-10·p30（木＝左手关、火＝左手寸、土＝右手关、金＝右手寸、水＝尺）。',
  hand:
    '按讲义 2026-10·p30 的左右手脏位重排：左手＝寸心关肝（血分）、右手＝寸肺关脾（气分）、尺＝肾；主脉位横跨左右者入「双手相兼」。',
}

/** 归类标记：本脏·五行 ＋ 兼涉本脏 */
function AttrChip({ attr }: { attr: Attribution | undefined }) {
  if (!attr) return null
  return (
    <span className="pr-attr" title={attr.basis}>
      <span className="pr-attr-main">
        {attr.wuxing}·{attr.zang}
      </span>
      {attr.also && attr.also.length > 0 && (
        <span className="pr-attr-also">兼{attr.also.join('')}</span>
      )}
      <span className="pr-attr-site">{attr.site}</span>
    </span>
  )
}

/** 归类依据 */
function AttrBasis({ attr }: { attr: Attribution | undefined }) {
  if (!attr) return null
  return <p className="pr-attr-basis">归类依据：{attr.basis}</p>
}

/** 方剂卡片：组成／服法／科学中药／加减／适用脉象／禁忌，全部照抄讲稿原文 */
export function DrugCard({ drug, showAttr }: { drug: Drug; showAttr?: boolean }) {
  const attr = RULE_OR_DRUG_ATTRIB[drug.id]
  return (
    <div className="pr-drug" onClick={(e) => e.stopPropagation()}>
      <div className="pr-drug-head">
        <span className="pr-drug-therapy">{drug.therapy}</span>
        <strong>{drug.name}</strong>
        {showAttr && <AttrChip attr={attr} />}
      </div>
      {drug.composition && (
        <p className="pr-drug-line">
          <span className="pr-drug-key">组成</span>
          {drug.composition}
        </p>
      )}
      {drug.usage && (
        <p className="pr-drug-line">
          <span className="pr-drug-key">服法</span>
          {drug.usage}
        </p>
      )}
      {drug.science && (
        <p className="pr-drug-line">
          <span className="pr-drug-key">科学中药</span>
          {drug.science}
        </p>
      )}
      {drug.indication && (
        <p className="pr-drug-line">
          <span className="pr-drug-key">适用脉象</span>
          {drug.indication}
        </p>
      )}
      {drug.adjustments && drug.adjustments.length > 0 && (
        <p className="pr-drug-line">
          <span className="pr-drug-key">加减</span>
          <span className="pr-drug-add">
            {drug.adjustments.map((a, i) => (
              <span key={i} className="pr-drug-add-item">
                · {a}
              </span>
            ))}
          </span>
        </p>
      )}
      {drug.contraindication && (
        <p className="pr-drug-line is-warn">
          <span className="pr-drug-key">禁忌</span>
          {drug.contraindication}
        </p>
      )}
      {showAttr && <AttrBasis attr={attr} />}
      <p className="pr-finding-src">〔{drug.source}〕</p>
    </div>
  )
}

/**
 * 同和堂版《臧氏脉学方剂汇总统表》的一条成方 —— 药味＋**克**，原样转录。
 *
 * 与 `DrugCard`（讲稿 2010，组成用比例制）是**两套资料**，不合并：
 * 单位不同，不可互相换算。
 */
function DoseCard({ dose }: { dose: FormulaDose }) {
  const science = FORMULA_SCIENCE_BY_NAME[DOSE_SCIENCE_NAME[dose.id] ?? '']
  return (
    <div className="pr-drug" onClick={(e) => e.stopPropagation()}>
      <div className="pr-drug-head">
        <span className="pr-drug-therapy">同和堂版</span>
        <strong>{dose.name}</strong>
      </div>
      <p className="pr-drug-line">
        <span className="pr-drug-key">组成</span>
        {dose.composition}
      </p>
      {dose.notes?.map((n, i) => (
        <p key={i} className="pr-drug-line">
          <span className="pr-drug-key">注</span>
          {n}
        </p>
      ))}
      {science && (
        <p className="pr-drug-line">
          <span className="pr-drug-key">科中</span>
          {science.ratio}
        </p>
      )}
      <p className="pr-finding-src">
        〔《臧氏脉学方剂汇总统表（同和堂版）》· 第 {dose.page} 页 · 单位：克〕
      </p>
    </div>
  )
}

/** 「科中」（科学中药）一行 */
function ScienceLine({ s }: { s: FormulaScience }) {
  return (
    <div className="pr-drug" onClick={(e) => e.stopPropagation()}>
      <div className="pr-drug-head">
        <span className="pr-drug-therapy">科中</span>
        <strong>{s.name}</strong>
      </div>
      <p className="pr-drug-line">
        <span className="pr-drug-key">比例</span>
        {s.ratio}
      </p>
      <p className="pr-finding-src">
        〔《臧氏脉学方剂汇总统表（同和堂版）》· 第 {s.page} 页 · 单位：g〕
      </p>
    </div>
  )
}

/** 一条依脉用方条目 */
export function FormulaItem({
  item,
  showAttr,
  sessions,
  onFocusFormula,
  srcNote,
}: {
  item: SessionFormulaHit
  showAttr?: boolean
  /** 按维度分组时，同一条规则合并多次命中，此处列出命中的记录 */
  sessions?: string[]
  /** 「用方知识库」里的条目不是命中项，没有「定位到格子」这一步 */
  onFocusFormula?: (h: SessionFormulaHit) => void
  /** 出处行后面的补充说明（「用方知识库」里写「全量条目」，命中区写命中记录） */
  srcNote?: string
}) {
  const { sessionLabel, hit } = item
  const attr = RULE_OR_DRUG_ATTRIB[hit.id]
  return (
    <div className={`pr-formula is-${hit.kind}`} onClick={() => onFocusFormula?.(item)}>
      <div className="pr-formula-head">
        <span className="pr-formula-kind">{hit.kind}</span>
        <strong>{hit.condition}</strong>
        {showAttr && <AttrChip attr={attr} />}
      </div>
      <p className="pr-formula-therapy">{hit.therapy}</p>
      {hit.formulas.length > 0 && (
        <p className="pr-formula-list-inline">
          {hit.formulas.map((f) => (
            <span key={f} className="pr-formula-chip">
              {f}
            </span>
          ))}
        </p>
      )}
      <p className="pr-formula-quote">{hit.quote}</p>
      {showAttr && <AttrBasis attr={attr} />}
      {hit.drugs && hit.drugs.length > 0 && (
        <div className="pr-drugs">
          {hit.drugs.map((id) => {
            const d = DRUG_BY_ID[id]
            return d ? <DrugCard key={id} drug={d} /> : null
          })}
        </div>
      )}
      {/*
        组成与剂量：讲义 p44／p46 出头的条目多半只给了方名，
        这里按方名补上两套资料（克／比例制）；两套都没载的方名不渲染，免得满屏「未载」。
        已有讲稿方剂卡片的条目只补同和堂版（克）那一套，免得与卡片重复。
      */}
      {hit.formulas.length > 0 && (
        <div className="pr-formula-doses">
          {hit.formulas
            .filter((f) => !(hit.adds && hit.adds.includes(f)))
            .map((f) => (
              <DoseLines
                key={f}
                name={f}
                className="pr-formula-dose"
                sources={hit.drugs && hit.drugs.length > 0 ? ['th'] : ['th', 'draft']}
                skipWhenMissing
              />
            ))}
        </div>
      )}
      <p className="pr-finding-src">
        〔{hit.source}〕
        {srcNote !== undefined
          ? srcNote
          : sessions && sessions.length > 0
            ? sessions[0] === STANDING_LABEL
              ? ' · 常驻条目（不依脉象）'
              : ` · 命中记录 ${sessions.join('、')}`
            : ` · 记录 ${sessionLabel}`}
      </p>
    </div>
  )
}

/** 分组标题 ＋ 分组说明 */
function GroupHead({ group }: { group: Group<unknown> }) {
  return (
    <>
      <h3 className="pr-formula-route">{group.label}</h3>
      <p className="pr-target-line">{group.note}</p>
    </>
  )
}

/** 同一条规则被多次记录命中时合并为一条，并列出命中的记录 */
function mergeByRule(items: SessionFormulaHit[]): { item: SessionFormulaHit; sessions: string[] }[] {
  const map = new Map<string, { item: SessionFormulaHit; sessions: string[] }>()
  for (const it of items) {
    const key = it.hit.id
    const prev = map.get(key)
    if (!prev) {
      map.set(key, { item: it, sessions: [it.sessionLabel] })
    } else if (!prev.sessions.includes(it.sessionLabel)) {
      prev.sessions.push(it.sessionLabel)
    }
  }
  return Array.from(map.values())
}

/** 常驻条目（三不用、白虎汤／肾气丸）：不依赖脉象，始终列出 */
const STANDING_LABEL = '常驻'

/** 把常驻条目并入维度分组，避免在五行／左右手视图里丢失 */
function standingHits(): SessionFormulaHit[] {
  return STANDING_FORMULA_RULES.map((rule) => ({
    sessionId: '__standing__',
    sessionLabel: STANDING_LABEL,
    hit: { ...rule, condition: STANDING_DISPLAY[rule.id] ?? rule.therapy, cells: [] },
  }))
}

export function Findings({
  hits,
  formulaHits,
  onFocus,
  onFocusFormula,
  wuxingFilter,
  handFilter,
  onFilterChange,
}: Props) {
  const [tab, setTab] = useState<Tab>('risk')
  const [dim, setDim] = useState<Dim>('route')

  /** 依脉用方命中的路线名（供流程骨架标示位置用） */
  const hitRoutes = useMemo(() => Array.from(new Set(formulaHits.map((h) => h.hit.route))), [formulaHits])

  /** 依脉用方按讲稿原序（路线）分组，路线顺序依讲稿第四讲「一、二、三、四……第五、第六」 */
  const grouped = useMemo(() => {
    const map = new Map<string, SessionFormulaHit[]>()
    for (const h of formulaHits) {
      const list = map.get(h.hit.route) ?? []
      list.push(h)
      map.set(h.hit.route, list)
    }
    const order = [...FORMULA_ROUTE_ORDER, ...Array.from(map.keys()).filter((k) => !FORMULA_ROUTE_ORDER.includes(k))]
    return order.filter((r) => map.has(r)).map((r) => ({ route: r, items: map.get(r)! }))
  }, [formulaHits])

  /** 按五行 / 按左右手分组（含常驻条目） */
  const dimGroups = useMemo<Group<SessionFormulaHit>[]>(() => {
    const all = [...formulaHits, ...standingHits()]
    if (dim === 'wuxing') return groupByWuxing(all, (h) => h.hit.id)
    if (dim === 'hand') return groupByHand(all, (h) => h.hit.id)
    return []
  }, [dim, formulaHits])

  /** 方剂备查：讲稿原序按三种疗法；五行／左右手按归属重排 */
  const drugGroups = useMemo<Group<Drug>[]>(() => {
    if (dim === 'wuxing') return groupByWuxing(DRUGS, (d) => d.id)
    if (dim === 'hand') return groupByHand(DRUGS, (d) => d.id)
    return []
  }, [dim])

  /** 当前维度打开的分组；讲稿原序不分组筛选 */
  const activeKeys = dim === 'wuxing' ? wuxingFilter : handFilter
  const groupOrder = dim === 'wuxing' ? DIM_ORDER.wuxing : DIM_ORDER.hand

  /** 筛选开关上的分组按钮：名称 ＋ 本组条目数 ＋ 方剂数（未命中的组显示 0，仍可打开） */
  const filterChips = useMemo(() => {
    if (dim === 'route') return []
    return groupOrder.map((key) => {
      const g = dimGroups.find((x) => x.key === key)
      const d = drugGroups.find((x) => x.key === key)
      return {
        key,
        label: groupShortLabel(dim, key),
        rules: g ? mergeByRule(g.items).length : 0,
        drugs: d ? d.items.length : 0,
      }
    })
  }, [dim, groupOrder, dimGroups, drugGroups])

  /** 依筛选后要显示的分组（「未归类」为异常兜底组，始终保留） */
  const shownGroups = useMemo(
    () => dimGroups.filter((g) => g.key === '未归类' || activeKeys.includes(g.key)),
    [dimGroups, activeKeys],
  )
  const shownDrugGroups = useMemo(
    () => drugGroups.filter((g) => g.key === '未归类' || activeKeys.includes(g.key)),
    [drugGroups, activeKeys],
  )

  /** 点一下开／关一组；全关时页面给出提示，不留空白 */
  function toggleGroup(key: string) {
    const on = activeKeys.includes(key)
    onFilterChange(
      dim as 'wuxing' | 'hand',
      groupOrder.filter((k) => (k === key ? !on : activeKeys.includes(k))),
    )
  }

  return (
    <section className="pr-panel">
      <header className="pr-panel-head">
        <h2>判读提示</h2>
        <div className="pr-tabs">
          <button
            type="button"
            className={`pr-tab${tab === 'risk' ? ' is-on' : ''}`}
            onClick={() => setTab('risk')}
          >
            风险提示 {hits.length}
          </button>
          <button
            type="button"
            className={`pr-tab${tab === 'formula' ? ' is-on' : ''}`}
            onClick={() => setTab('formula')}
          >
            依脉用方 {formulaHits.length}
          </button>
        </div>
      </header>

      {tab === 'risk' ? (
        hits.length === 0 ? (
          <p className="pr-empty">暂无命中的脉象组合。规则全部来自讲稿原文，录入后自动比对。</p>
        ) : (
          <>
            <p className="pr-target-line">按讲稿规则检查 · 点击定位到格子</p>
            <ul className="pr-findings">
              {hits.map(({ sessionId, sessionLabel, hit }) => (
                <li
                  key={`${sessionId}-${hit.id}`}
                  className={`pr-finding is-${hit.severity}`}
                  onClick={() => onFocus({ sessionId, sessionLabel, hit })}
                >
                  <div className="pr-finding-head">
                    <span className={`pr-badge is-${hit.severity}`}>{SEVERITY_LABEL[hit.severity]}</span>
                    <strong>{hit.title}</strong>
                  </div>
                  <p className="pr-finding-detail">{hit.detail}</p>
                  <p className="pr-finding-src">
                    〔{hit.source}〕· 记录 {sessionLabel}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )
      ) : (
        <>
          <p className="pr-target-line">
            讲义 p44「依脉用方」＋ p46 附表一「治疗」列，讲稿第二讲「叁、用方」「肆、依脉辨证论治」与第三~六讲方剂为补充 · 只照抄原文写明的方，不加减方
          </p>

          <div className="pr-dim">
            <span className="pr-dim-label">依脉开方 · 分组维度</span>
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
          <p className="pr-target-line">{DIM_HINT[dim]}</p>

          {dim !== 'route' && (
            <div className="pr-filter">
              <span className="pr-filter-label">筛选分组</span>
              {filterChips.map((c) => {
                const on = activeKeys.includes(c.key)
                return (
                  <button
                    key={c.key}
                    type="button"
                    className={`pr-filter-chip${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() => toggleGroup(c.key)}
                  >
                    <span className="pr-filter-key">{c.label}</span>
                    <span className="pr-filter-num">
                      {c.rules}条 · {c.drugs}方
                    </span>
                  </button>
                )
              })}
              <button
                type="button"
                className="pr-filter-act"
                onClick={() => onFilterChange(dim as 'wuxing' | 'hand', [...groupOrder])}
              >
                全选
              </button>
              <button
                type="button"
                className="pr-filter-act"
                onClick={() => onFilterChange(dim as 'wuxing' | 'hand', [])}
              >
                清空
              </button>
            </div>
          )}

          {grouped.length === 0 && STANDING_FORMULA_RULES.length === 0 ? (
            <p className="pr-empty">
              暂无命中的用方条目。录入脉象后，按讲义 p44 的六个方框与讲稿第四讲「清挡路一~四」自动比对。
            </p>
          ) : null}

          {dim !== 'route' && shownGroups.length === 0 && (
            <p className="pr-empty">当前筛选下没有分组，请在「筛选分组」里至少打开一组。</p>
          )}

          {dim === 'route' && <FlowPath hitRoutes={hitRoutes} />}

          <div className="pr-formula-list">
            {dim === 'route'
              ? grouped.map(({ route, items }) => (
                  <section key={route} className="pr-formula-group">
                    <h3 className="pr-formula-route">{route}</h3>
                    {items.map((item) => (
                      <FormulaItem key={`${item.sessionId}-${item.hit.id}`} item={item} onFocusFormula={onFocusFormula} />
                    ))}
                  </section>
                ))
              : shownGroups.map((g) => (
                  <section key={g.key} className="pr-formula-group">
                    <GroupHead group={g} />
                    {mergeByRule(g.items).map(({ item, sessions }) => (
                      <FormulaItem
                        key={item.hit.id}
                        item={item}
                        showAttr
                        sessions={sessions}
                        onFocusFormula={onFocusFormula}
                      />
                    ))}
                  </section>
                ))}

            {dim === 'route' && STANDING_FORMULA_RULES.length > 0 && (
              <section className="pr-formula-group">
                <h3 className="pr-formula-route">用药禁忌（常驻）</h3>
                {STANDING_FORMULA_RULES.map((rule) => (
                  <div key={rule.id} className={`pr-formula is-${rule.kind}`}>
                    <div className="pr-formula-head">
                      <span className="pr-formula-kind">{rule.kind}</span>
                      <strong>{rule.condition}</strong>
                    </div>
                    <p className="pr-formula-therapy">{rule.therapy}</p>
                    {rule.formulas.length > 0 && (
                      <p className="pr-formula-list-inline">
                        {rule.formulas.map((f) => (
                          <span key={f} className="pr-formula-chip">
                            {f}
                          </span>
                        ))}
                      </p>
                    )}
                    <p className="pr-formula-quote">{rule.quote}</p>
                    <p className="pr-finding-src">〔{rule.source}〕</p>
                  </div>
                ))}
              </section>
            )}
          </div>

          <section className="pr-formula-group">
            <h3 className="pr-formula-route">附表一体质用药对照（讲义 p46）</h3>
            <p className="pr-target-line">
              这一列要靠望、问、切多项合参才能定，本工具不据脉象自动判定，仅作对照参考。
            </p>
            <table className="pr-constitution">
              <thead>
                <tr>
                  <th>切</th>
                  <th>治疗</th>
                  <th>方</th>
                </tr>
              </thead>
              <tbody>
                {CONSTITUTION_TABLE.map((row) => (
                  <tr key={row.mark}>
                    <td className="pr-constitution-mark">{row.mark}</td>
                    <td>{row.therapy}</td>
                    <td className="pr-constitution-formulas">{row.formulas.join('｜')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="pr-formula-group">
            <h3 className="pr-formula-route">
              {dim === 'route'
                ? '方剂备查（讲稿 2010·第二讲 叁、用方）'
                : `方剂备查 · ${DIM_LABEL[dim]}`}
            </h3>
            <p className="pr-target-line">
              {dim === 'route'
                ? '三种疗法与讲稿写明的方剂组成、服法、加减与禁忌，原样转录，不替读者加减方。'
                : '同一方剂按脏腑／左右手归位；组成、服法、加减与禁忌仍照讲稿原样转录。'}
            </p>
            {dim === 'route'
              ? DRUG_GROUPS.map((g) => (
                  <div key={g.therapy} className="pr-drug-group">
                    <h4 className="pr-drug-group-title">{g.title}</h4>
                    {DRUGS.filter((d) => d.therapy === g.therapy).map((d) => (
                      <DrugCard key={d.id} drug={d} />
                    ))}
                  </div>
                ))
              : shownDrugGroups.map((g) => (
                  <div key={g.key} className="pr-drug-group">
                    <h4 className="pr-drug-group-title">{g.label}</h4>
                    <p className="pr-target-line">{g.note}</p>
                    {g.items.map((d) => (
                      <DrugCard key={d.id} drug={d} showAttr />
                    ))}
                  </div>
                ))}
            {dim !== 'route' && shownDrugGroups.length === 0 && (
              <p className="pr-empty">当前筛选下没有方剂，请在「筛选分组」里至少打开一组。</p>
            )}
          </section>

          {/* 同和堂版成方：三个维度都显示（它没有五行／左右手归属，不参与分组筛选） */}
          <section className="pr-formula-group">
            <h3 className="pr-formula-route">方剂备查（同和堂版《臧氏脉学方剂汇总统表》）</h3>
            <p className="pr-target-line">
              纸质讲义第 1~4 页原样转录：成方（药味＋**克**）与第 4 页「科中」科学中药比例。
              单位是克，与讲稿 2010 的比例制不同 —— 两套**不可互相换算**，也不合并。
              {dim !== 'route' && '　本组条目无五行／左右手归属，不参与上面的分组筛选。'}
            </p>
            {[1, 2, 3].map((page) => (
              <div key={page} className="pr-drug-group">
                <h4 className="pr-drug-group-title">第 {page} 页</h4>
                {FORMULA_DOSES.filter((d) => d.page === page).map((d) => (
                  <DoseCard key={d.id} dose={d} />
                ))}
              </div>
            ))}
            <div className="pr-drug-group">
              <h4 className="pr-drug-group-title">第 4 页 · 科中（科学中药）</h4>
              {FORMULA_SCIENCES.map((s) => (
                <ScienceLine key={s.id} s={s} />
              ))}
            </div>
          </section>
        </>
      )}
    </section>
  )
}
