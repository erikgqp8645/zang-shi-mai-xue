import { useEffect, useMemo, useRef, useState } from 'react'
import { draftDoseView, thDoseView, type DoseEntry } from '../domain/dose-lookup'
import { getEffectiveDoseRaw, getEffectiveDrugRaw } from '../domain/library-store'
import { diffEntryFields } from '../domain/unified-editor.mjs'
import { saveLibraryPatch, useLibrary } from '../state/library'
import { LibraryFields } from './LibraryFields'

/**
 * 「剂量」页签 —— 在这一条用方条目的编辑弹层里，直接改它引用的成方／方剂。
 *
 * ## 为什么并进来
 *
 * 以前改剂量要点剂（量）行末尾那个「编辑」，弹出来的是**另一个只有「条目」
 * 一个页签的弹层**，跟主条目的「条目／脉象图」弹层长得不是一回事，用户得记
 * 两个地方。现在收进同一个弹层，作为第三个页签。
 *
 * ## 改的是「那一条方」本身
 *
 * 这里编辑的对象是 `dose`（同和堂版成方）或 `drug`（讲稿 2010 方剂）条目，
 * **不是这条 rule 的私有副本** —— 同一个方名被别的条目引用时，那边也会跟着变。
 * 界面上一句话写明，免得以为是局部改动。
 *
 * ## 三件可在这一页做的事
 *
 * 1. 改组成／附注／页码等（`LibraryFields`）
 * 2. 改「科中」比例（`science` 条目，走另一个覆盖层分组）
 * 3. 把这一条**隐藏**（`visible=false`）—— 隐藏后剂量对照里不再列它，
 *    但这一页仍然看得见（带「已隐藏」标记），随时能放回来。
 *
 * ## 数据从哪来
 *
 * 方名取自**当前草稿**的 `formulas[]`（「条目」页刚改完还没保存也能看到），
 * 再用 `dose-lookup` 的两套查法找条目 —— 与页面下方剂行的查法**同一份实现**，
 * 不会出现「页面上查得到、这里查不到」。
 */

interface Props {
  /** 这一条 rule 当前的方名（草稿里的 `formulas[]`） */
  formulas: string[]
  /** 从剂量行点「编辑」进来时要自动展开的那一条 */
  focusDose?: { kind: string; id: string } | null
}

/** 一行可编辑的剂量 */
interface Row {
  key: string
  /** 资料名（同和堂版（克）／讲稿 2010（比例制）） */
  label: string
  entry: DoseEntry
}

export function DoseTab({ formulas, focusDose }: Props) {
  const { overrides, kinds } = useLibrary()
  const [editing, setEditing] = useState<{ kind: string; id: string; name: string } | null>(null)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [base, setBase] = useState<Record<string, unknown>>({})
  /** 科中（科学中药）比例 —— 属于另一个条目（`science`），单独存 */
  const [sciDraft, setSciDraft] = useState('')
  const [sciBase, setSciBase] = useState('')
  const [sciId, setSciId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  /** focusDose 只自动展开一次，别把用户手动收起又弹回来 */
  const focusedOnce = useRef(false)

  /** 按方名分组：每个方名下面并列两套资料 */
  const groups = useMemo(() => {
    return formulas
      .map((name) => {
        const rows: Row[] = []
        const th = thDoseView(name)
        for (const e of th.entries) rows.push({ key: `th:${e.kind}:${e.id ?? e.name}`, label: '同和堂版（克）', entry: e })
        const dr = draftDoseView(name)
        for (const e of dr.entries) rows.push({ key: `dr:${e.kind}:${e.id ?? e.name}`, label: '讲稿 2010（比例制）', entry: e })
        return { name, rows }
      })
      .filter((g) => g.rows.length > 0)
    // ⚠️ `overrides` 只是依赖：保存后要重新查一遍，否则还显示旧组成
  }, [formulas, overrides])

  function startEdit(entry: DoseEntry) {
    const kind = entry.kind
    const id = entry.id
    if (!kind || !id) return
    // 优先用查询结果里自带的那一份（数据就在手边）；store 只是兜底
    const raw = entry.raw ?? (kind === 'dose' ? getEffectiveDoseRaw(id) : getEffectiveDrugRaw(id))
    if (!raw) {
      setError('这一条现在取不到（可能刚被删掉）—— 刷新页面再试。')
      return
    }
    setError(null)
    setSavedNote(null)
    setDraft({ ...raw })
    setBase({ ...raw })
    setSciDraft(entry.science ?? '')
    setSciBase(entry.science ?? '')
    setSciId(entry.scienceId ?? null)
    setEditing({ kind, id, name: entry.name })
  }

  /* 从剂量行点「编辑」进来：那条一开始渲染出来就展开它 */
  useEffect(() => {
    if (!focusDose || focusedOnce.current) return
    const hit = groups
      .flatMap((g) => g.rows)
      .find((r) => r.entry.kind === focusDose.kind && r.entry.id === focusDose.id)
    if (!hit) return
    focusedOnce.current = true
    startEdit(hit.entry)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusDose?.kind, focusDose?.id, groups])

  async function doSave() {
    if (!editing) return
    const changed = diffEntryFields(draft, base)
    const hasEntryChange = Object.keys(changed).length > 0
    const hasSciChange = !!sciId && sciDraft !== sciBase

    if (!hasEntryChange && !hasSciChange) {
      setEditing(null)
      return
    }

    setSaving(true)
    setError(null)
    try {
      if (hasEntryChange) await saveLibraryPatch(editing.kind, editing.id, changed)
      if (hasSciChange && sciId) await saveLibraryPatch('science', sciId, { ratio: sciDraft })
      setSavedNote(`已保存「${String(draft.name ?? editing.name)}」`)
      setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  /** 显示／隐藏这一条（`visible=false` 后剂量对照里不再列它） */
  async function toggleVisible(entry: DoseEntry) {
    if (!entry.kind || !entry.id) return
    const next = entry.visible === false
    setError(null)
    try {
      await saveLibraryPatch(entry.kind, entry.id, { visible: next })
      setSavedNote(next ? `已显示「${entry.name}」` : `已隐藏「${entry.name}」`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (formulas.length === 0) {
    return (
      <div className="pr-ed-body">
        <p className="pr-empty">这一条还没有方名 —— 先在「条目」页填上方名，剂量才会出现在这里。</p>
      </div>
    )
  }

  return (
    <div className="pr-ed-body pr-dosetab">
      <p className="pr-dosetab-hint">
        这里的「编辑」改的是<b>那一条方本身</b>（同和堂版成方 ／ 讲稿方剂），
        所有引用同一个方名的条目都会同步变化。
      </p>

      {error ? <p className="pr-ed-error">{error}</p> : null}
      {savedNote ? <p className="pr-dosetab-saved">{savedNote}</p> : null}

      {groups.map((g) => (
        <section key={g.name} className="pr-dosetab-group">
          <h5 className="pr-dosetab-name">{g.name}</h5>
          {g.rows.map((r) => {
            const isEditing =
              !!editing && editing.kind === r.entry.kind && editing.id === r.entry.id
            const hidden = r.entry.visible === false
            return (
              <div key={r.key} className="pr-dosetab-row-wrap">
                <p className={`pr-dosetab-row${hidden ? ' is-hidden' : ''}`}>
                  <span className="pr-dosetab-src">{r.label}</span>
                  <span className="pr-dosetab-text">
                    {hidden ? <span className="pr-dosetab-tag">已隐藏</span> : null}
                    {r.entry.composition ? r.entry.composition : '未载'}
                    {r.entry.science ? `　科中：${r.entry.science}` : ''}
                  </span>
                  {r.entry.kind && r.entry.id ? (
                    <>
                      <button
                        type="button"
                        className="pr-led-btn"
                        onClick={() => startEdit(r.entry)}
                        disabled={saving}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="pr-led-btn"
                        title={
                          hidden
                            ? '重新在剂量对照里显示这一条'
                            : '在剂量对照里不显示这一条（随时可以放回来）'
                        }
                        onClick={() => void toggleVisible(r.entry)}
                        disabled={saving}
                      >
                        {hidden ? '显示' : '隐藏'}
                      </button>
                    </>
                  ) : null}
                </p>

                {isEditing ? (
                  <div className="pr-dosetab-form">
                    <LibraryFields
                      kinds={kinds ?? undefined}
                      kind={editing.kind}
                      draft={draft}
                      onChange={(key, value) => setDraft((prev) => ({ ...prev, [key]: value }))}
                      creating={false}
                    />

                    {/*
                      科中比例不在 `dose` 自己的字段表里 —— 它是另一个条目（`science`），
                      单独长一栏，保存时写它自己的覆盖层。
                    */}
                    {sciId ? (
                      <label className="pr-led-field is-long">
                        <span className="pr-led-label">科中比例（科学中药）</span>
                        <input
                          type="text"
                          value={sciDraft}
                          onChange={(e) => setSciDraft(e.target.value)}
                          placeholder="如 麦冬、玄参、生地=1:1:1"
                        />
                      </label>
                    ) : null}

                    <div className="pr-dosetab-actions">
                      <button
                        type="button"
                        className="pr-ghost"
                        onClick={() => {
                          setEditing(null)
                          setError(null)
                        }}
                        disabled={saving}
                      >
                        取消
                      </button>
                      <button type="button" className="pr-primary" onClick={() => void doSave()} disabled={saving}>
                        {saving ? '保存中…' : '保存这一条'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </section>
      ))}

      {groups.length === 0 ? (
        <p className="pr-empty">两套资料里都没查到这个方名的组成（未载）。</p>
      ) : null}
    </div>
  )
}
