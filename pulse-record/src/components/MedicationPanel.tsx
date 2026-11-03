import { useMemo, useState } from 'react'
import type { LayoutMode, Session } from '../domain/types'
import {
  PULSE_GROUPS,
  buildPulseText,
  describeCodes,
  findDrug,
  findFormulaDose,
  formulaDoseView,
  groupOfText,
  matchGroup,
  pointOrder,
  positionsOf,
  positionLabel,
  pulsePointsOf,
  searchFormulaReference,
  type FormulaReference,
  type Medication,
  type PulseGroup,
  type PulsePoint,
} from '../domain/medication'
import { MedicationPicker } from './MedicationPicker'
import { DOSE_SCIENCE_NAME, FORMULA_SCIENCE_BY_NAME } from '../domain/formula-table'
import type { CustomSymbol } from '../domain/symbols'

/**
 * 用药记录（填写表）—— 使用者自己填实际用了什么方、加减、服法
 *
 * 工具只负责记录：
 * - 不替使用者加减方、不下诊断，也不判断填得对不对
 * - 讲义 p42「依脉用方表」只作**原文对照**，供查、供抄，不是处方建议
 * - 组成／服法只在讲稿第二讲载有的方上显示（原文照录）；讲稿未载就明说未载
 * - 「对应脉象」文字与符号**并存**：文字自填，符号从该次记录里挑，两者一起记
 * - 右列选完符号，文字**自动填进来**（左格不必再打一遍）；
 *   但文字仍可自己写 —— 一旦手改过，符号再变就不再覆盖，只提示「按符号重填」
 */

interface Props {
  /** 主表上的记录列（用药挂在每一次就诊下面） */
  sessions: Session[]
  /** 当前日期（记录列）的 id：新增行默认加在它下面 */
  activeSessionId: string | null
  /** 行结构（决定有哪些脉点） */
  layout: LayoutMode
  /** 自定义符号（给自建符号配文字） */
  customSymbols: CustomSymbol[]
  /** 用药记录（全部） */
  rows: Medication[]
  /** 改动后把新的用药记录交回给上层（保存时随病例一起写库） */
  onChange: (rows: Medication[]) => void
}

let seq = 0
function newId() {
  seq += 1
  return `m${Date.now().toString(36)}${seq.toString(36)}`
}

/**
 * 剂量来源 —— 三套资料里只有两套给了组成，单位还不同。
 *
 * - 同和堂版《方剂汇总统表》＝ 成方，**克**
 * - 讲稿 2010·第二讲 ＝ 组成，**比例制**（如「熟地5、茯苓4」）
 *
 * 两套**不可互相换算**，所以默认只显示一套，需要对照时再切到「两套并列」。
 */
type DoseSource = 'th' | 'draft' | 'both'

const DOSE_SOURCES: { key: DoseSource; label: string; hint: string }[] = [
  { key: 'th', label: '同和堂版（克）', hint: '《臧氏脉学方剂汇总统表（同和堂版）》成方' },
  { key: 'draft', label: '讲稿 2010（比例制）', hint: '讲稿 2010·第二讲「叁、用方」的组成与服法' },
  { key: 'both', label: '两套并列', hint: '两套同时列出 —— 注意单位不同，不可互相换算' },
]

/** 一格「配伍与剂量」 */
function DoseCell({ r, source }: { r: FormulaReference; source: DoseSource }) {
  const v = formulaDoseView(r)
  const showTh = source === 'th' || source === 'both'
  const showDraft = source === 'draft' || source === 'both'
  const thMissing = v.missing.filter((m) => m.startsWith('同和堂版'))
  const draftMissing = v.missing.filter((m) => m.startsWith('讲稿'))

  return (
    <div className="pr-dose">
      {showTh && v.dose && (
        <div className="pr-dose-block">
          <div className="pr-dose-tag">同和堂版 · 克</div>
          <div className="pr-dose-text">{v.dose.composition}</div>
          {v.dose.notes?.map((n, i) => (
            <div key={i} className="pr-dose-note">
              注：{n}
            </div>
          ))}
          {v.science && <div className="pr-dose-note">科中（科学中药）：{v.science.ratio}</div>}
          <div className="pr-dose-src">
            〔{v.dose.name}｜同和堂版 p{v.dose.page}〕
          </div>
        </div>
      )}
      {showTh && !v.dose && thMissing.map((m) => (
        <div key={m} className="pr-dose-none">
          {m}
        </div>
      ))}

      {showDraft && v.drug && (
        <div className="pr-dose-block">
          <div className="pr-dose-tag">讲稿 2010 · 比例制</div>
          {v.drug.composition && <div className="pr-dose-text">组成：{v.drug.composition}</div>}
          {v.drug.usage && <div className="pr-dose-text">服法：{v.drug.usage}</div>}
          {v.drug.science && <div className="pr-dose-text">科学中药：{v.drug.science}</div>}
          {v.drug.adjustments?.map((a, i) => (
            <div key={i} className="pr-dose-note">
              加减：{a}
            </div>
          ))}
          {v.drug.contraindication && (
            <div className="pr-dose-note">禁忌：{v.drug.contraindication}</div>
          )}
          <div className="pr-dose-src">〔{v.drug.source}〕</div>
        </div>
      )}
      {showDraft && v.draftExtra && (
        <div className="pr-dose-block">
          <div className="pr-dose-tag">讲稿 2010 · 比例制</div>
          <div className="pr-dose-text">组成：{v.draftExtra.composition}</div>
          {v.draftExtra.note && <div className="pr-dose-note">{v.draftExtra.note}</div>}
          <div className="pr-dose-src">〔{v.draftExtra.source}〕</div>
        </div>
      )}
      {showDraft && !v.drug && !v.draftExtra && draftMissing.map((m) => (
        <div key={m} className="pr-dose-none">
          {m}
        </div>
      ))}

      {r.doseBasis && <div className="pr-dose-basis">对照：{r.doseBasis}</div>}
    </div>
  )
}

export function MedicationPanel({
  sessions,
  activeSessionId,
  layout,
  customSymbols,
  rows,
  onChange,
}: Props) {
  /** 正在编辑的那一行（点方名格会记住它；对照表点一行就填到这里） */
  const [focusId, setFocusId] = useState<string | null>(null)
  /** 打开选择器的那一行 */
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  /** 讲义 p42 对照表／选择器左列共用的检索词 */
  const [kw, setKw] = useState('')
  /** 对照表是否展开 */
  const [refOpen, setRefOpen] = useState(false)
  /** 「配伍与剂量」列显示哪一套资料（默认同和堂版的克数） */
  const [doseSource, setDoseSource] = useState<DoseSource>('th')
  /** 脉位筛选（选择器右列；关掉弹窗也留着） */
  const [position, setPosition] = useState('')
  /**
   * **主组合**（哪一组是使用者点的那一组）—— 按行记。
   *
   * 组合之间成员互相重叠（右关同属双关同治／双关右寸／右关尺），
   * 所以「亮着的只能有一组」：以点选的那一组为准，其余不亮。
   * 文字前缀里也记着这一组（形如「肝肺同治（…）」），刷新后仍认得出。
   */
  const [primaryState, setPrimaryState] = useState<Record<string, string>>({})

  const refRows = useMemo(() => searchFormulaReference(kw), [kw])

  /**
   * 右列选脉位 → **左列自动用同一个词筛**（选右关，左列就筛右关）。
   *
   * 两列看同一件事：右列看这次记录到的脉象，左列看讲义 p42 里对应的方。
   * 用的是同一个 `kw`，所以页面下方「原文对照」表也跟着一起筛。
   *
   * **单向**：只右→左。左框自己打字**不会**回改右列的脉位筛选
   * （`position` 只由右列的脉位 chip 改），左框随时可以自己改。
   */
  const pickPosition = (p: string) => {
    setPosition(p)
    setKw(positionLabel(p))
  }

  const rowsOf = (visitId: string) => rows.filter((r) => r.visitId === visitId)

  const update = (id: string, patch: Partial<Medication>) => {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const remove = (id: string) => {
    onChange(rows.filter((r) => r.id !== id))
    if (focusId === id) setFocusId(null)
    if (pickerFor === id) setPickerFor(null)
  }

  const addRow = (visitId: string, seed?: { name?: string; pulse?: string }) => {
    const row: Medication = {
      id: newId(),
      visitId,
      name: seed?.name ?? '',
      pulse: seed?.pulse ?? '',
      symbols: {},
      adjust: '',
      usage: '',
      note: '',
    }
    onChange([...rows, row])
    setFocusId(row.id)
    return row
  }

  /** 点讲义 p42 对照表的一行：填进正在编辑的那一行，没有就新加一行 */
  const applyReference = (visitId: string, name: string, pulse: string) => {
    const focused = rows.find((r) => r.id === focusId)
    if (focused && focused.visitId === visitId) {
      update(focused.id, { name, pulse })
      return
    }
    addRow(visitId, { name, pulse })
  }

  /** 打开选择器的那一行所在的就诊（取它录到的脉象） */
  const pickerRow = rows.find((r) => r.id === pickerFor) ?? null
  const pickerSession = pickerRow ? sessions.find((s) => s.id === pickerRow.visitId) : undefined

  /** 打开选择器（记下是哪一行） */
  const openPicker = (id: string) => {
    setFocusId(id)
    setPickerFor(id)
  }

  /** 按符号生成的那段文字（自动填进「对应脉象」用） */
  const autoTextOf = (symbols: Record<string, string[]>, groupName?: string) =>
    buildPulseText(symbols, customSymbols, groupName)

  /** 这一行的**主组合**（点过的那一组；没点过就按脉位精确匹配推一个） */
  const primaryName = (r: Medication): string | undefined =>
    primaryState[r.id] ?? groupOfText(r.pulse)?.name ?? matchGroup(positionsOf(r.symbols ?? {}))?.name

  /** 这一行按符号生成的那段文字（带主组合名） */
  const autoTextOfRow = (r: Medication) => autoTextOf(r.symbols ?? {}, primaryName(r))

  /** 这一格的文字还是「自动生成」的吗？（空着也算 —— 等着被自动填） */
  const isAutoText = (r: Medication) => r.pulse === '' || r.pulse === autoTextOfRow(r)

  /** 记／清主组合 */
  const setPrimary = (rowId: string, name?: string) =>
    setPrimaryState((s) => {
      const next = { ...s }
      if (name) next[rowId] = name
      else delete next[rowId]
      return next
    })

  /** 某组在这次就诊里**录到**的成员（只有录到符号的脉点才算） */
  const groupMembers = (g: PulseGroup, session: Session | undefined) =>
    session
      ? pulsePointsOf(session, layout).filter((p) => g.positions.includes(`${p.hand}|${p.organ}`))
      : []

  /** 这些成员是否都还在选择里 */
  const covered = (symbols: Record<string, string[]>, members: PulsePoint[]) =>
    members.length > 0 && members.every((m) => (symbols[m.key] ?? []).length > 0)

  /** 选／不选一个脉点的符号（并入这一行的「对应脉象」，与文字并存） */
  const toggleSymbol = (p: PulsePoint) => {
    if (!pickerFor) return
    const row = rows.find((r) => r.id === pickerFor)
    if (!row) return
    const symbols = { ...(row.symbols ?? {}) }
    if ((symbols[p.key] ?? []).length > 0) delete symbols[p.key]
    else symbols[p.key] = [...p.codes]
    // 主组合若还覆盖得住就留着，覆盖不住（成员被取消）就丢掉
    const primary = primaryName(row)
    const members = primary
      ? groupMembers(PULSE_GROUPS.find((g) => g.name === primary) as PulseGroup, pickerSession)
      : []
    const keep = primary && covered(symbols, members) ? primary : undefined
    if (primary && !keep) setPrimary(row.id, undefined)
    // 右 → 左：文字没被手改过，就按新选的符号自动重写
    update(row.id, {
      symbols,
      pulse: isAutoText(row) ? autoTextOf(symbols, keep) : row.pulse,
    })
  }

  /**
   * 点一个脉位组合：
   * - 点一下＝**就用这一组**（把当前选择换成该组本次录到的成员）
   * - 再点同一组（已是主组合且选全了）＝取消这一组
   */
  const toggleGroup = (g: PulseGroup) => {
    if (!pickerFor || !pickerSession) return
    const row = rows.find((r) => r.id === pickerFor)
    if (!row) return
    const members = groupMembers(g, pickerSession)
    if (members.length === 0) return
    // 左列跟着右列走：用这一组的原文检索词筛处方
    setKw(g.ref)
    const symbols = { ...(row.symbols ?? {}) }
    if (covered(symbols, members) && primaryName(row) === g.name) {
      // 再点一次＝取消这一组
      for (const m of members) delete symbols[m.key]
      setPrimary(row.id, undefined)
      update(row.id, { symbols, pulse: isAutoText(row) ? '' : row.pulse })
      return
    }
    // 点一下＝就用这一组（替换当前选择）
    for (const k of Object.keys(symbols)) delete symbols[k]
    for (const m of members) symbols[m.key] = [...m.codes]
    setPrimary(row.id, g.name)
    update(row.id, {
      symbols,
      pulse: isAutoText(row) ? autoTextOf(symbols, g.name) : row.pulse,
    })
  }

  /** 清掉这一行已选的符号 */
  const clearSymbols = () => {
    if (!pickerFor) return
    const row = rows.find((r) => r.id === pickerFor)
    if (!row) return
    setPrimary(row.id, undefined)
    update(row.id, { symbols: {}, pulse: isAutoText(row) ? '' : row.pulse })
  }

  /** 选一个处方：回填方名与对应脉象的文字表述 */
  const pickFormula = (f: FormulaReference) => {
    if (!pickerFor) return
    update(pickerFor, { name: f.name, pulse: f.indication })
  }

  /** 手动把文字重填成「按符号生成」的那段 */
  const refillFromSymbols = (id: string) => {
    const r = rows.find((x) => x.id === id)
    if (!r) return
    update(id, { pulse: autoTextOfRow(r) })
  }

  /** 这一行已选的符号（按 左寸→右尺 排，不按字符串序） */
  const pickedChips = (r: Medication) => {
    const keys = Object.keys(r.symbols ?? {})
      .filter((k) => (r.symbols[k] ?? []).length > 0)
      .sort((a, b) => pointOrder(a) - pointOrder(b))
    return keys.map((k) => {
      const [hand, organ, depth] = k.split('|')
      return {
        key: k,
        label: `${hand === 'L' ? '左' : '右'}${organ} ${depth}`,
        text: describeCodes(r.symbols[k], customSymbols),
      }
    })
  }

  /** 正在编辑的那一行，方名若讲稿第二讲有载，就显示原文的组成／服法 */
  const focusRow = rows.find((r) => r.id === focusId) ?? null
  const focusDrug = focusRow ? findDrug(focusRow.name) : undefined
  /** 同和堂版《方剂汇总统表》里查得到的那一条（成方 · 克） */
  const focusDose = focusRow ? findFormulaDose(focusRow.name) : undefined
  /** 同和堂版第 4 页「科中」对应行 */
  const focusDoseScience = focusDose
    ? FORMULA_SCIENCE_BY_NAME[DOSE_SCIENCE_NAME[focusDose.id] ?? '']
    : undefined

  if (sessions.length === 0) {
    return (
      <section className="pr-med">
        <header className="pr-med-head">
          <h2>用药记录</h2>
          <span className="pr-muted">先在工具条添加一次记录（日期），才能在它下面记方。</span>
        </header>
      </section>
    )
  }

  return (
    <section className="pr-med">
      <header className="pr-med-head">
        <h2>用药记录</h2>
        <span className="pr-muted">
          自己填实际用了什么方、加减与服法；工具不替加减方、不下诊断。
        </span>
      </header>

      {sessions.map((s) => {
        const list = rowsOf(s.id)
        const isActive = s.id === activeSessionId
        return (
          <div key={s.id} className={`pr-med-group${isActive ? ' is-active' : ''}`}>
            <div className="pr-med-group-head">
              <h3 className="pr-med-sub">{s.label}</h3>
              {isActive && <em className="pr-med-flag">　当前日期</em>}
              <button type="button" className="pr-link" onClick={() => addRow(s.id)}>
                ＋ 添加一行
              </button>
            </div>

            {list.length === 0 ? (
              <p className="pr-muted pr-med-empty">（这次还没有记方）</p>
            ) : (
              <table className="pr-med-table">
                <thead>
                  <tr>
                    <th>方名</th>
                    <th>对应脉象</th>
                    <th>加减</th>
                    <th>服法</th>
                    <th>备注</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id} className={r.id === focusId ? 'is-focus' : undefined}>
                      <td>
                        <input
                          type="text"
                          value={r.name}
                          placeholder="如 加味理中"
                          onFocus={() => setFocusId(r.id)}
                          onChange={(e) => update(r.id, { name: e.target.value })}
                        />
                        <span className="pr-med-subline">
                          <button type="button" className="pr-link" onClick={() => openPicker(r.id)}>
                            选择
                          </button>
                          {findDrug(r.name) && <em className="pr-med-flag">讲稿第二讲有载</em>}
                        </span>
                      </td>
                      <td>
                        <input
                          type="text"
                          value={r.pulse}
                          placeholder="如 右关弱"
                          onFocus={() => setFocusId(r.id)}
                          onChange={(e) => update(r.id, { pulse: e.target.value })}
                        />
                        <span className="pr-med-subline">
                          <button type="button" className="pr-link" onClick={() => openPicker(r.id)}>
                            选择
                          </button>
                          {pickedChips(r).map((c) => (
                            <em key={c.key} className="pr-med-chip">
                              {c.label} {c.text}
                            </em>
                          ))}
                          {/* 文字是自动生成的还是自己写的 —— 手写过的不会被符号变动覆盖 */}
                          {pickedChips(r).length > 0 && isAutoText(r) && (
                            <em className="pr-med-flag">按符号生成</em>
                          )}
                          {pickedChips(r).length > 0 && !isAutoText(r) && (
                            <>
                              <em className="pr-med-flag">已手改</em>
                              <button
                                type="button"
                                className="pr-link"
                                onClick={() => refillFromSymbols(r.id)}
                              >
                                按符号重填
                              </button>
                            </>
                          )}
                        </span>
                      </td>
                      <td>
                        <input
                          type="text"
                          value={r.adjust}
                          placeholder="依脉加减"
                          onFocus={() => setFocusId(r.id)}
                          onChange={(e) => update(r.id, { adjust: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={r.usage}
                          placeholder="如 餐后温服"
                          onFocus={() => setFocusId(r.id)}
                          onChange={(e) => update(r.id, { usage: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={r.note}
                          onFocus={() => setFocusId(r.id)}
                          onChange={(e) => update(r.id, { note: e.target.value })}
                        />
                      </td>
                      <td className="pr-med-ops">
                        <button
                          type="button"
                          className="pr-x"
                          onClick={() => remove(r.id)}
                          title="删除这一行"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}

      {/* 同和堂版《方剂汇总统表》＋ 讲稿第二讲的组成／服法（原文照录；未载就明说） */}
      {focusRow && (
        <div className="pr-med-ref">
          {focusDose && (
            <>
              <p className="pr-med-ref-title">
                同和堂版《臧氏脉学方剂汇总统表》「{focusDose.name}」
                <span className="pr-muted">（原文照录 · 第 {focusDose.page} 页 · 单位：克）</span>
              </p>
              <p>组成：{focusDose.composition}</p>
              {focusDose.notes?.map((n, i) => (
                <p key={i} className="pr-muted">
                  注：{n}
                </p>
              ))}
              {focusDoseScience && <p>科中（科学中药）：{focusDoseScience.ratio}</p>}
            </>
          )}
          {focusDrug ? (
            <>
              <p className="pr-med-ref-title">
                讲稿 2010·第二讲「{focusDrug.name}」
                <span className="pr-muted">（原文照录 · 组成用比例制）</span>
              </p>
              {focusDrug.composition && <p>组成：{focusDrug.composition}</p>}
              {focusDrug.usage && <p>服法：{focusDrug.usage}</p>}
              {focusDrug.science && <p>科学中药：{focusDrug.science}</p>}
              {focusDrug.adjustments && focusDrug.adjustments.length > 0 && (
                <p>加减：{focusDrug.adjustments.join('；')}</p>
              )}
              {focusDrug.contraindication && <p>禁忌：{focusDrug.contraindication}</p>}
              {focusDrug.source && <p className="pr-muted">〔{focusDrug.source}〕</p>}
            </>
          ) : (
            !focusDose && (
              <p className="pr-muted">
                「{focusRow.name || '（方名未填）'}」：讲稿 2010·第二讲未载其组成与服法。
              </p>
            )
          )}
          {!focusDose && focusDrug && (
            <p className="pr-muted">
              同和堂版《方剂汇总统表》未载「{focusRow.name}」这一条的组成。
            </p>
          )}
        </div>
      )}

      {/* 讲义 p42 原表对照 */}
      <div className="pr-med-refbox">
        <div className="pr-med-refbox-head">
          <h3 className="pr-med-sub">讲义 2026-10·p42「依脉用方表」原文对照（28 行）</h3>
          <button type="button" className="pr-link" onClick={() => setRefOpen((v) => !v)}>
            {refOpen ? '收起' : '展开'}
          </button>
          <span className="pr-muted">原文照录，供查供抄；不是处方建议，不构成诊断。</span>
        </div>
        {refOpen && (
          <>
            <input
              className="pr-med-search"
              type="text"
              value={kw}
              placeholder="搜方名或脉象，如 天王 / 右关弱"
              onChange={(e) => setKw(e.target.value)}
            />
            <div className="pr-med-dosebar">
              <span className="pr-muted">剂量来源：</span>
              {DOSE_SOURCES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={`pr-chip-btn ${doseSource === s.key ? 'on' : ''}`}
                  title={s.hint}
                  onClick={() => setDoseSource(s.key)}
                >
                  {s.label}
                </button>
              ))}
              <span className="pr-muted pr-med-dosebar-note">
                两套剂量单位不同（克 ／ 比例制），不可互相换算
              </span>
            </div>
            <table className="pr-med-reftable">
              <thead>
                <tr>
                  <th>#</th>
                  <th>处方</th>
                  <th>对应脉象及加减</th>
                  <th>配伍与剂量</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {refRows.map((r) => (
                  <tr key={r.no}>
                    <td>{r.no}</td>
                    <td>{r.name}</td>
                    <td>{r.indication}</td>
                    <td className="pr-med-dose">
                      <DoseCell r={r} source={doseSource} />
                    </td>
                    <td className="pr-med-ops">
                      <button
                        type="button"
                        className="pr-link"
                        onClick={() => {
                          const visitId = activeSessionId ?? sessions[0]?.id
                          if (!visitId) return
                          applyReference(visitId, r.name, r.indication)
                        }}
                      >
                        填入
                      </button>
                    </td>
                  </tr>
                ))}
                {refRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="pr-muted">
                      没有匹配的方。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* 选择器（弹窗）：左列处方、右列脉象 */}
      {pickerRow && pickerSession && (
        <MedicationPicker
          session={pickerSession}
          layout={layout}
          customSymbols={customSymbols}
          keyword={kw}
          onKeyword={setKw}
          formulas={searchFormulaReference(kw)}
          position={position}
          onPosition={pickPosition}
          selected={pickerRow.symbols ?? {}}
          primary={pickerRow ? primaryName(pickerRow) : undefined}
          onToggle={toggleSymbol}
          onToggleGroup={toggleGroup}
          onClear={clearSymbols}
          onPickFormula={pickFormula}
          onClose={() => setPickerFor(null)}
        />
      )}
    </section>
  )
}
