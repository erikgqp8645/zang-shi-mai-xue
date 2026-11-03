import { useMemo, useState } from 'react'
import type { LayoutMode, Session } from '../domain/types'
import {
  describeCodes,
  findDrug,
  searchFormulaReference,
  type FormulaReference,
  type Medication,
  type PulsePoint,
} from '../domain/medication'
import { MedicationPicker } from './MedicationPicker'
import type { CustomSymbol } from '../domain/symbols'

/**
 * 用药记录（填写表）—— 使用者自己填实际用了什么方、加减、服法
 *
 * 工具只负责记录：
 * - 不替使用者加减方、不下诊断，也不判断填得对不对
 * - 讲义 p42「依脉用方表」只作**原文对照**，供查、供抄，不是处方建议
 * - 组成／服法只在讲稿第二讲载有的方上显示（原文照录）；讲稿未载就明说未载
 * - 「对应脉象」文字与符号**并存**：文字自填，符号从该次记录里挑，两者一起记
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
  /** 脉位筛选（选择器右列；关掉弹窗也留着） */
  const [position, setPosition] = useState('')

  const refRows = useMemo(() => searchFormulaReference(kw), [kw])

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

  /** 打开选择器（记下是哪一行） */
  const openPicker = (id: string) => {
    setFocusId(id)
    setPickerFor(id)
  }

  /** 选／不选一个脉点的符号（并入这一行的「对应脉象」，与文字并存） */
  const toggleSymbol = (p: PulsePoint) => {
    if (!pickerFor) return
    onChange(
      rows.map((r) => {
        if (r.id !== pickerFor) return r
        const symbols = { ...(r.symbols ?? {}) }
        if ((symbols[p.key] ?? []).length > 0) delete symbols[p.key]
        else symbols[p.key] = [...p.codes]
        return { ...r, symbols }
      }),
    )
  }

  /** 清掉这一行已选的符号 */
  const clearSymbols = () => {
    if (!pickerFor) return
    onChange(rows.map((r) => (r.id === pickerFor ? { ...r, symbols: {} } : r)))
  }

  /** 选一个处方：回填方名与对应脉象的文字表述 */
  const pickFormula = (f: FormulaReference) => {
    if (!pickerFor) return
    update(pickerFor, { name: f.name, pulse: f.indication })
  }

  /** 这一行已选的符号（按 左寸→右尺 排，不按字符串序） */
  const pickedChips = (r: Medication) => {
    const order = ['L|寸', 'R|寸', 'L|关', 'R|关', 'L|尺', 'R|尺']
    const keys = Object.keys(r.symbols ?? {})
      .filter((k) => (r.symbols[k] ?? []).length > 0)
      .sort((a, b) => {
        const pa = order.indexOf(a.split('|').slice(0, 2).join('|'))
        const pb = order.indexOf(b.split('|').slice(0, 2).join('|'))
        return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb) || a.localeCompare(b)
      })
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
  /** 打开选择器的那一行所在的就诊（取它录到的脉象） */
  const pickerRow = rows.find((r) => r.id === pickerFor) ?? null
  const pickerSession = pickerRow ? sessions.find((s) => s.id === pickerRow.visitId) : undefined

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

      {/* 讲稿第二讲的组成／服法（原文照录；讲稿未载就明说） */}
      {focusRow && (
        <div className="pr-med-ref">
          {focusDrug ? (
            <>
              <p className="pr-med-ref-title">
                讲稿 2010·第二讲「{focusDrug.name}」
                <span className="pr-muted">（原文照录）</span>
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
            <p className="pr-muted">
              「{focusRow.name || '（方名未填）'}」：讲稿 2010·第二讲未载其组成与服法。
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
            <table className="pr-med-reftable">
              <thead>
                <tr>
                  <th>#</th>
                  <th>处方</th>
                  <th>对应脉象及加减</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {refRows.map((r) => (
                  <tr key={r.no}>
                    <td>{r.no}</td>
                    <td>{r.name}</td>
                    <td>{r.indication}</td>
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
                    <td colSpan={4} className="pr-muted">
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
          onPosition={setPosition}
          selected={pickerRow.symbols ?? {}}
          onToggle={toggleSymbol}
          onClear={clearSymbols}
          onPickFormula={pickFormula}
          onClose={() => setPickerFor(null)}
        />
      )}
    </section>
  )
}
