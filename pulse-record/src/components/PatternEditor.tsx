import { useEffect, useMemo, useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { groupRows } from '../domain/layout'
import { cellKey, type Hand, type LayoutMode } from '../domain/types'
import { COMMON_GROUPS, SYMBOL_BY_CODE, parseCodes } from '../domain/symbols'
import { allCells, termOf, type CellRequirement, type PulsePattern } from '../domain/pulse-pattern'
import { usePatterns } from '../state/patterns'

/**
 * 方剂脉象图编辑器
 *
 * ## 填的是什么
 *
 * 一张图 ＝ 「什么脉象才用这个方」的一份示意。格子里放的是**符号**（`0`/`-`/`+`/`++`/
 * `±`/`±±`/`↑`/`|`/`X`/`#`…），空白 ＝ 这一格没有要求。
 *
 * ## 为什么格子里是输入框而不是「点一下弹面板」
 *
 * 录一张 9 行的表，最省事的是手不离键盘。所以每格就是一个输入框：
 * 点进去直接敲，也可以用下面的符号条点选（追加到当前格）。
 * 与主记录表同一个解析器（`parseCodes`），长码优先 —— `++` 不会被拆成两个 `+`。
 *
 * ⚠️ 输入法是「先打字、失焦才归一」：中途的 `T` 还不能确定是 `TTT`，
 *    所以边打边解析会把 `TTT` 吃掉。归一放在 blur／保存两处。
 *
 * ## 保存语义
 *
 * 保存 = **整条替换**该方剂的图列表。若原来这条用的是内置基线，保存后就被覆盖层接管；
 * 「恢复默认」＝ 删掉覆盖，回落到基线。
 */

interface Props {
  formulaId: string
  /** 条目名（条件文字），只用于标题展示 */
  formulaLabel: string
  /** 当前生效的图（基线或覆盖都行） */
  current: PulsePattern[]
  onClose: () => void
}

/** 一格里显示什么：手填符号优先，其次是术语的代表符号 */
function cellText(req: CellRequirement | undefined): string {
  if (!req) return ''
  if (req.codes && req.codes.length > 0) return req.codes.join('')
  if (req.term) {
    const t = termOf(req.term)
    if (t) return t.display
  }
  return req.term ?? ''
}

/** 固定的格序（按 9 行版），保证保存后的 cells 顺序稳定、diff 好看 */
const CELL_ORDER = allCells('nine')
function orderOf(cell: string): number {
  const i = CELL_ORDER.indexOf(cell)
  return i < 0 ? 999 : i
}

/** 改一格：给空数组就是删掉这一格 */
function withCell(cells: CellRequirement[], cell: string, codes: string[]): CellRequirement[] {
  const rest = cells.filter((c) => c.cell !== cell)
  if (codes.length === 0) return rest
  const next = [...rest, { cell, term: '', codes }]
  next.sort((a, b) => orderOf(a.cell) - orderOf(b.cell))
  return next
}

function blankPattern(index: number, layout: LayoutMode = 'nine'): PulsePattern {
  return { title: `脉象 ${index + 1}`, layout, cells: [], source: '', origin: 'manual' }
}

/** 深拷贝 —— 编辑期全在内存里，点「取消」要能干净丢弃 */
function cloneOrSeed(current: PulsePattern[]): PulsePattern[] {
  const cloned = current.map((p) => JSON.parse(JSON.stringify(p)) as PulsePattern)
  return cloned.length > 0 ? cloned : [blankPattern(0)]
}

export function PatternEditor({ formulaId, formulaLabel, current, onClose }: Props) {
  const { save, reset, isOverridden } = usePatterns()
  const [draft, setDraft] = useState<PulsePattern[]>(() => cloneOrSeed(current))
  const [active, setActive] = useState(0)
  /** 还没失焦的原始输入（格键 → 文本），失焦或保存时归一成 codes */
  const [raw, setRaw] = useState<Record<string, string>>({})
  const [focused, setFocused] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * 待确认的「恢复默认」（站内确认框用）。
   *
   * ⓘ 不用 `window.confirm`：原生弹窗在 Electron 桌面端会把整个渲染进程冻住
   *   （点了「恢复默认」，页面就再也不响应，连刷新都救不回来）。
   */
  const [confirmReset, setConfirmReset] = useState(false)

  const entry = draft[active] as PulsePattern | undefined
  const layout = entry?.layout ?? 'nine'
  const groups = useMemo(() => groupRows(layout), [layout])

  /* Esc 关闭（确认框开着时先关确认框，别把编辑器一起关了） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || saving) return
      if (confirmReset) {
        setConfirmReset(false)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saving, confirmReset, onClose])

  function textOf(cell: string): string {
    const pending = raw[cell]
    if (pending !== undefined) return pending
    return cellText(entry?.cells.find((c) => c.cell === cell))
  }

  /** 把一格写入草稿（归一后的 codes） */
  function commitCell(cell: string, text: string) {
    if (!entry) return
    const codes = parseCodes(text)
    const cells = withCell(entry.cells, cell, codes)
    setDraft((prev) => prev.map((p, i) => (i === active ? { ...p, cells } : p)))
    setRaw((prev) => {
      if (!(cell in prev)) return prev
      const next = { ...prev }
      delete next[cell]
      return next
    })
  }

  function patchEntry(patch: Partial<PulsePattern>) {
    setDraft((prev) => prev.map((p, i) => (i === active ? { ...p, ...patch } : p)))
  }

  /** 符号条：追加到当前聚焦的那一格 */
  function appendCode(code: string) {
    if (!focused) {
      setError('先点一个格子，再点符号')
      return
    }
    setRaw((prev) => ({ ...prev, [focused]: textOf(focused) + code }))
    setError(null)
  }

  function clearFocused() {
    if (!focused) {
      setError('先点一个格子')
      return
    }
    setRaw((prev) => ({ ...prev, [focused]: '' }))
  }

  function switchTo(index: number) {
    // 换图前先把当前这格的输入收掉，否则切回来会串格
    if (entry && Object.keys(raw).length > 0) {
      let cells = entry.cells
      for (const [cell, text] of Object.entries(raw)) cells = withCell(cells, cell, parseCodes(text))
      setDraft((prev) => prev.map((p, i) => (i === active ? { ...p, cells } : p)))
      setRaw({})
    }
    setActive(index)
    setFocused(null)
  }

  function addPattern(copy: boolean) {
    const base = copy && entry ? (JSON.parse(JSON.stringify(entry)) as PulsePattern) : blankPattern(draft.length, layout)
    const next = copy && entry ? { ...base, title: `${base.title ?? '脉象'}（副本）`, origin: 'manual' as const } : base
    setDraft((prev) => [...prev, next])
    setRaw({})
    setActive(draft.length)
  }

  function removePattern(index: number) {
    setDraft((prev) => prev.filter((_, i) => i !== index))
    setActive((prev) => (prev > index ? prev - 1 : Math.min(prev, draft.length - 2)))
    setRaw({})
  }

  function move(index: number, delta: number) {
    const to = index + delta
    if (to < 0 || to >= draft.length) return
    setDraft((prev) => {
      const next = [...prev]
      const [item] = next.splice(index, 1)
      next.splice(to, 0, item)
      return next
    })
    setActive(to)
  }

  async function doSave() {
    // 还没失焦的输入先归一进来
    let cells = entry?.cells ?? []
    for (const [cell, text] of Object.entries(raw)) cells = withCell(cells, cell, parseCodes(text))

    const cleaned = draft.map((p, i) => {
      const own = i === active ? cells : p.cells
      return {
        ...p,
        cells: own.filter((c) => (c.codes && c.codes.length > 0) || !!c.term),
        title: (p.title ?? '').trim() || `脉象 ${i + 1}`,
      }
    })

    setSaving(true)
    setError(null)
    try {
      await save(formulaId, cleaned)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  /** 恢复默认（先问一句） */
  function doReset() {
    setConfirmReset(true)
  }

  /** 真的恢复（确认框点了「恢复默认」才走这里） */
  async function confirmResetNow() {
    setSaving(true)
    setError(null)
    try {
      await reset(formulaId)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
      setConfirmReset(false)
    }
  }

  return (
    <>
      <div className="pr-ps-modal" onClick={() => !saving && onClose()}>
        <div
          className="pr-ps-modal-box is-editor"
          role="dialog"
          aria-label="编辑脉象图"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="pr-ps-modal-head">
            <h4>编辑脉象图</h4>
            <span className="pr-ed-subject" title={formulaLabel}>
              {formulaLabel}
            </span>
            {isOverridden(formulaId) && (
              <button type="button" className="pr-ed-link" onClick={() => doReset()} disabled={saving}>
                恢复默认
              </button>
            )}
            <button type="button" className="pr-ps-close" onClick={onClose} disabled={saving}>
              ✕
            </button>
          </header>

          <div className="pr-ed-body">
            {/* ---- 左：这个方剂的几张图 ---- */}
            <aside className="pr-ed-list">
              {draft.map((p, i) => (
                <div key={i} className={`pr-ed-item${i === active ? ' is-on' : ''}`}>
                  <button type="button" className="pr-ed-item-main" onClick={() => switchTo(i)}>
                    <span className="pr-ed-item-no">{i + 1}</span>
                    <span className="pr-ed-item-name">{p.title || `脉象 ${i + 1}`}</span>
                    <span className="pr-ed-item-count">{p.cells.length} 格</span>
                  </button>
                  <span className="pr-ed-item-ops">
                    <button type="button" title="上移" onClick={() => move(i, -1)} disabled={i === 0}>
                      ▲
                    </button>
                    <button type="button" title="下移" onClick={() => move(i, 1)} disabled={i === draft.length - 1}>
                      ▼
                    </button>
                    <button type="button" title="删除这张" onClick={() => removePattern(i)}>
                      ✕
                    </button>
                  </span>
                </div>
              ))}
              <div className="pr-ed-add">
                <button type="button" onClick={() => addPattern(false)}>
                  + 新增一张
                </button>
                {entry && <button type="button" onClick={() => addPattern(true)}>复制这张</button>}
              </div>
            </aside>

            {/* ---- 右：矩阵编辑器 ---- */}
            <section className="pr-ed-main">
              {entry ? (
                <>
                  <div className="pr-ed-fields">
                    <label className="pr-ed-field">
                      <span>图名</span>
                      <input
                        value={entry.title ?? ''}
                        onChange={(e) => patchEntry({ title: e.target.value })}
                        placeholder="如「浮大版」「兼尺弱」"
                      />
                    </label>
                    <label className="pr-ed-field is-narrow">
                      <span>体例</span>
                      <select
                        value={layout}
                        onChange={(e) => {
                          setRaw({})
                          patchEntry({ layout: e.target.value as LayoutMode })
                        }}
                      >
                        <option value="nine">9 行（尺含浮中沉）</option>
                        <option value="seven">7 行（尺只沉）</option>
                      </select>
                    </label>
                  </div>

                  <table className="pr-psheet is-edit">
                    <thead>
                      <tr>
                        <th className="pr-ps-corner" colSpan={2}>
                          部位·取法
                        </th>
                        <th>左</th>
                        <th className="pr-ps-end">右</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((g, gi) =>
                        g.rows.map((row, ri) => (
                          <tr key={`${g.organ}-${row.depth}`}>
                            {ri === 0 && (
                              <th
                                className={`pr-ps-organ${gi > 0 ? ' pr-ps-group-start' : ''}`}
                                rowSpan={g.rows.length}
                              >
                                {g.organ}
                              </th>
                            )}
                            <th className="pr-ps-depth">{row.depth}</th>
                            {(['L', 'R'] as Hand[]).map((hand) => {
                              const key = cellKey(hand, row.organ, row.depth)
                              const dirty = raw[key] !== undefined
                              return (
                                <td key={hand} className={`pr-ed-cell${dirty ? ' is-dirty' : ''}`}>
                                  <input
                                    value={textOf(key)}
                                    onChange={(e) => setRaw((prev) => ({ ...prev, [key]: e.target.value }))}
                                    onFocus={() => setFocused(key)}
                                    onBlur={(e) => commitCell(key, e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault()
                                        e.currentTarget.blur()
                                      }
                                    }}
                                    title={`${hand === 'L' ? '左' : '右'}${row.organ}${row.depth}`}
                                    aria-label={`${hand === 'L' ? '左' : '右'}${row.organ}${row.depth}`}
                                  />
                                </td>
                              )
                            })}
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>

                  <div className="pr-ed-palette">
                    {COMMON_GROUPS.map((group) => (
                      <div key={group.title} className="pr-ed-pal-row">
                        <span className="pr-ed-pal-title">{group.title}</span>
                        {group.codes.map((code) => (
                          <button
                            key={code}
                            type="button"
                            className="pr-ed-code"
                            title={SYMBOL_BY_CODE[code]?.label ?? code}
                            onClick={() => appendCode(code)}
                          >
                            {code}
                          </button>
                        ))}
                      </div>
                    ))}
                    <div className="pr-ed-pal-row">
                      <span className="pr-ed-pal-title">操作</span>
                      <button type="button" className="pr-ed-code is-wide" onClick={clearFocused}>
                        清空这格
                      </button>
                      <span className="pr-ed-pal-hint">
                        点格子 → 直接打字，或点上面的符号追加。`++` 要打两次 `+`，`TTT` 打三次。
                      </span>
                    </div>
                  </div>

                  <label className="pr-ed-field is-block">
                    <span>备注（可选）</span>
                    <input
                      value={entry.note ?? ''}
                      onChange={(e) => patchEntry({ note: e.target.value })}
                      placeholder="如「按讲稿原文，未分左右」"
                    />
                  </label>
                </>
              ) : (
                <p className="pr-empty">这个方剂现在没有脉象图。点左边「+ 新增一张」开始。</p>
              )}
            </section>
          </div>

          <footer className="pr-ed-foot">
            {error ? (
              <span className="pr-ed-error">{error}</span>
            ) : (
              <span className="pr-ed-tip">
                保存后写入服务端，其他机器／浏览器打开就是这一份。
              </span>
            )}
            <button type="button" className="pr-ghost" onClick={onClose} disabled={saving}>
              取消
            </button>
            <button type="button" onClick={() => void doSave()} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </footer>
        </div>
      </div>

      {/* 「恢复默认」的确认框（站内，不用 `window.confirm` —— 原生弹窗会冻住整页） */}
      {confirmReset && (
        <ConfirmDialog
          title="恢复成内置基线？"
          body={
            <p>你手改的这几张会被删掉（这台机器和其他机器都会回到基线）。</p>
          }
          okText="恢复默认"
          onOk={() => void confirmResetNow()}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </>
  )
}
