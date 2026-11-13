import { useMemo, useState } from 'react'
import { groupRows } from '../domain/layout'
import { cellKey, type Hand, type LayoutMode } from '../domain/types'
import { COMMON_GROUPS, SYMBOL_BY_CODE, parseCodes } from '../domain/symbols'
import { allCells, termOf, type CellRequirement, type PulsePattern } from '../domain/pulse-pattern'

/**
 * 脉象图 · **矩阵编辑面板**（受控，无自己的弹层外壳）
 *
 * ## 为什么抽出来
 *
 * 原来这块在 `PatternEditor.tsx`（一个独立弹层）。现在条目与脉象图
 * 合并成**一个界面**（`RuleEditor.tsx`）⇒ 矩阵变成弹层里的一个页签。
 *
 * ## 去重：这一页**不再重复编辑**条目的东西
 *
 * | 东西 | 原来 | 现在 |
 * |---|---|---|
 * | 图名 | 单独的输入框（多数时候就是条目的方名） | **单图时只读**；一个条目有多张图时才出现「区分名」输入框 |
 * | 出处 | 图上不显示 | **只读**显示「本图出处」（转录事实，不单独编辑）—— 出处只由条目的「出处」那一栏管 |
 * | 原文 | 图的「备注」里复述了一遍 | 条目的「原文」栏管原文；这里只写**与原文的出入** |
 *
 * ## 填的是什么
 *
 * 一张图 ＝ 「什么脉象才用这个方」的一份示意。格子里放的是**符号**（`0`/`-`/`+`/`++`/
 * `±`/`±±`/`↑`/`|`/`X`/`#`…），空白 ＝ 这一格没有要求。
 *
 * ⚠️ 输入法是「先打字、失焦才归一」：中途的 `T` 还不能确定是 `TTT`，
 *    所以边打边解析会把 `TTT` 吃掉。归一放在 blur。
 */

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

export function blankPattern(index: number, layout: LayoutMode = 'nine'): PulsePattern {
  return { title: `脉象 ${index + 1}`, layout, cells: [], source: '', origin: 'manual' }
}

interface Props {
  /** 受控的图列表 */
  value: PulsePattern[]
  /** 改图（父级持有草稿） */
  onChange: (next: PulsePattern[]) => void
  /** 条目的条件文字（标题展示用） */
  formulaLabel?: string
  /** 条目的出处（只读对照用 —— 出处只由条目那一栏管） */
  entrySource?: string
}

export function PatternPanel({ value, onChange, formulaLabel, entrySource }: Props) {
  const [active, setActive] = useState(0)
  /** 还没失焦的原始输入（格键 → 文本），失焦时归一成 codes */
  const [raw, setRaw] = useState<Record<string, string>>({})
  /** 当前聚焦的格（符号条往哪儿追加） */
  const [focused, setFocused] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const entry = value[active] as PulsePattern | undefined
  const layout = entry?.layout ?? 'nine'
  const groups = useMemo(() => groupRows(layout), [layout])
  /** 多图才需要「区分名」—— 单图时图名就是这条的方名，不该另编一个 */
  const multi = value.length > 1

  function textOf(cell: string): string {
    const pending = raw[cell]
    if (pending !== undefined) return pending
    return cellText(entry?.cells.find((c) => c.cell === cell))
  }

  /**
   * 把一格文本**即时**写进图（不等失焦）。
   *
   * ⚠️ 2026-11-13 修：原来只有 `commitCell`（blur）才写 cells ⇒
   *    在格子里打完字**直接点「保存」**时，那一格还没提交，
   *    保存拿到的是空图 ⇒ 与「至少要标一个格子」的校验撞上，看着像功能坏了。
   *    现在输入、点符号、清空都同步写 cells；`raw` 只负责「输入框里显示什么」。
   */
  function writeLive(cell: string, text: string) {
    if (!entry) return
    const codes = parseCodes(text)
    const cells = withCell(entry.cells, cell, codes)
    onChange(value.map((p, i) => (i === active ? { ...p, cells } : p)))
  }

  /** 失焦时收尾：把值写进图，并清掉这一格的原始输入 */
  function commitCell(cell: string, text: string) {
    if (!entry) return
    writeLive(cell, text)
    setRaw((prev) => {
      if (!(cell in prev)) return prev
      const next = { ...prev }
      delete next[cell]
      return next
    })
  }

  function patchEntry(patch: Partial<PulsePattern>) {
    onChange(value.map((p, i) => (i === active ? { ...p, ...patch } : p)))
  }

  /** 符号条：追加到当前聚焦的那一格 */
  function appendCode(code: string) {
    if (!focused) {
      setError('先点一个格子，再点符号')
      return
    }
    const next = textOf(focused) + code
    setRaw((prev) => ({ ...prev, [focused]: next }))
    writeLive(focused, next)
    setError(null)
  }

  function clearFocused() {
    if (!focused) {
      setError('先点一个格子')
      return
    }
    setRaw((prev) => ({ ...prev, [focused]: '' }))
    writeLive(focused, '')
  }

  /** 换图前先把当前这格的输入收掉，否则切回来会串格 */
  function switchTo(index: number) {
    if (entry && Object.keys(raw).length > 0) {
      let cells = entry.cells
      for (const [cell, text] of Object.entries(raw)) cells = withCell(cells, cell, parseCodes(text))
      onChange(value.map((p, i) => (i === active ? { ...p, cells } : p)))
      setRaw({})
    }
    setActive(index)
    setFocused(null)
  }

  function addPattern(copy: boolean) {
    const base = copy && entry ? (JSON.parse(JSON.stringify(entry)) as PulsePattern) : blankPattern(value.length, layout)
    const next = copy && entry ? { ...base, title: `${base.title ?? '脉象'}（副本）`, origin: 'manual' as const } : base
    onChange([...value, next])
    setRaw({})
    setActive(value.length)
  }

  function removePattern(index: number) {
    onChange(value.filter((_, i) => i !== index))
    setActive((prev) => (prev > index ? prev - 1 : Math.min(prev, value.length - 2)))
    setRaw({})
  }

  function move(index: number, delta: number) {
    const to = index + delta
    if (to < 0 || to >= value.length) return
    const next = [...value]
    const [item] = next.splice(index, 1)
    next.splice(to, 0, item)
    onChange(next)
    setActive(to)
  }

  if (value.length === 0) {
    return (
      <div className="pr-ed-empty">
        <p className="pr-empty">
          {formulaLabel ? `「${formulaLabel}」` : '这个方剂'}现在没有脉象图。
        </p>
        <button type="button" className="pr-led-btn" onClick={() => addPattern(false)}>
          ＋ 新增一张
        </button>
      </div>
    )
  }

  return (
    <div className="pr-ed-body">
      {/* ---- 左：这张条目有几张图 ---- */}
      <aside className="pr-ed-list">
        {value.map((p, i) => (
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
              <button type="button" title="下移" onClick={() => move(i, 1)} disabled={i === value.length - 1}>
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

      {/* ---- 右：矩阵 ---- */}
      <section className="pr-ed-main">
        {entry ? (
          <>
            <div className="pr-ed-fields">
              {multi ? (
                <label className="pr-ed-field">
                  <span>这张图的区分名</span>
                  <input
                    value={entry.title ?? ''}
                    onChange={(e) => patchEntry({ title: e.target.value })}
                    placeholder="如「浮大版」「兼尺弱」"
                  />
                  <small className="pr-led-hint">
                    一条条目有多张图时才要区分；只有一张时，图名就是这条的方名。
                  </small>
                </label>
              ) : (
                <label className="pr-ed-field is-readonly">
                  <span>图名</span>
                  <b className="pr-ed-fixed">{entry.title || '（未命名）'}</b>
                  <small className="pr-led-hint">
                    图名就是本条目的方名（见「条目」页），不在这里另编一个。
                  </small>
                </label>
              )}
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
                              onChange={(e) => {
                                const text = e.target.value
                                setRaw((prev) => ({ ...prev, [key]: text }))
                                // 实时写进图：打完字直接点「保存」也不会漏这一格
                                writeLive(key, text)
                              }}
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
              <span>与原文的出入（可选）</span>
              <input
                value={entry.note ?? ''}
                onChange={(e) => patchEntry({ note: e.target.value })}
                placeholder="如「讲义 p44 标了某侧，讲稿未分左右 —— 本图按讲稿：两侧皆可」"
              />
              <small className="pr-led-hint">
                原文在「条目」页那一栏，这里只写**本图与原文对不上或有出入**的地方，别把原文再抄一遍。
              </small>
            </label>

            {/* 出处只读 —— 出处由条目的「出处」那一栏管（避免两处各编一份） */}
            <p className="pr-ed-src">
              本图出处：{entry.source ? `〔${entry.source}〕` : '（未载）'}
              {entry.source && entrySource && entry.source !== entrySource ? (
                <span className="pr-ed-src-diff">（与条目出处不同：本图另引了出处）</span>
              ) : null}
            </p>

            {error ? <p className="pr-ed-error">{error}</p> : null}
          </>
        ) : (
          <p className="pr-empty">这个方剂现在没有脉象图。点左边「+ 新增一张」开始。</p>
        )}
      </section>
    </div>
  )
}
