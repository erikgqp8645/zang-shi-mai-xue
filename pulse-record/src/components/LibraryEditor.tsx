import { useEffect, useState } from 'react'
import { restoreLibraryDefault, saveLibraryPatch, useLibrary } from '../state/library'
import { removeChip } from '../domain/library-chips.mjs'
import { ConfirmDialog } from './ConfirmDialog'
import type { LibraryKindField } from '../domain/library-store'

/**
 * 用方知识库 · 条目编辑弹层
 *
 * ## 表单是**数据驱动**的
 *
 * 字段清单、类型、标签、可选值，全部来自服务端的 `/api/library/kinds`
 * （那��是后端 `LIBRARY_KINDS` 注册表）⇒ **前端不硬编码字段表** ⇒ 一个来源。
 *
 * ⓘ `id` **只读**：改 id ＝ 删掉这一条再重加一条，而 p44 新增要配判定函数
 *   （数据长不出逻辑）⇒ 本轮不开放新增 ⇒ id 不给改。
 *
 * ## 保存语义
 *
 * 保存 = **字段级**改：只把「真变了」的字段发上去（服务端以当前生效的那条为底合并），
 * 其余字段一字不动。
 * 「恢复默认」＝撤掉覆盖层里对这一条的改动 → 回到内置基线。
 *
 * ## 样式
 *
 * 沿用 `PatternEditor.tsx` 的那套（`pr-ps-modal`／`pr-ed-*`）—— 同一套弹层，
 * 不另发明一套。
 */

interface Props {
  /** `rule` ｜ `drug` */
  kind: string
  /** 条目 id */
  id: string
  /** 当前生效的那一条（基线 ⊕ 覆盖层） */
  entry: Record<string, unknown>
  /** 标题（给人看的条目名） */
  title: string
  onClose: () => void
}

/** 一个字段的输入控件 */
function FieldInput({
  field,
  value,
  readOnly,
  onChange,
}: {
  field: LibraryKindField
  value: unknown
  readOnly: boolean
  onChange: (next: unknown) => void
}) {
  if (field.type === 'boolean') {
    return (
      <label className="pr-led-check">
        <input
          type="checkbox"
          checked={value === true}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{value === true ? '是' : '否'}</span>
      </label>
    )
  }

  if (field.type === 'enum') {
    return (
      <select
        value={String(value ?? '')}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
      >
        {(field.values ?? []).map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    )
  }

  if (field.type === 'string[]') {
    const arr = Array.isArray(value) ? (value as string[]) : []
    return (
      <div className="pr-led-arr">
        {arr.map((item, i) => (
          <div key={i} className="pr-led-arr-row">
            <input
              value={item}
              disabled={readOnly}
              onChange={(e) => {
                const next = [...arr]
                next[i] = e.target.value
                onChange(next)
              }}
              aria-label={`${field.label} 第 ${i + 1} 项`}
            />
            <button
              type="button"
              title="删掉这一项"
              disabled={readOnly}
              onClick={() => onChange(removeChip(arr, i))}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="pr-led-add"
          disabled={readOnly}
          onClick={() => onChange([...arr, ''])}
        >
          ＋ 加一项
        </button>
      </div>
    )
  }

  if (field.type === 'string' && field.long) {
    return (
      <textarea
        value={String(value ?? '')}
        rows={4}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }

  if (field.type === 'string') {
    return (
      <input
        value={String(value ?? '')}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }

  // number / positiveInt / page
  return (
    <input
      type="number"
      value={value === undefined || value === null ? '' : String(value)}
      disabled={readOnly}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
    />
  )
}

export function LibraryEditor({ kind, id, entry, title, onClose }: Props) {
  const { kinds, overrides } = useLibrary()
  const spec = kinds?.[kind]
  /** 编辑期全在内存里，点「取消」要能干净丢弃 */
  const [draft, setDraft] = useState<Record<string, unknown>>(() => ({ ...entry }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * 待确认的「恢复默认」（站内确认框用）。
   *
   * ⓘ 不用 `window.confirm`：原生弹窗在 Electron 桌面端会把整个渲染进程冻住
   *   （点了「恢复默认」，页面就再也不响应，连刷新都救不回来）。
   */
  const [confirmRestore, setConfirmRestore] = useState(false)

  /** 覆盖层里动过这一条 ⇒ 可以「恢复默认」 */
  const isOverridden = !!overrides?.[kind]?.[id]

  /* Esc 关闭（确认框开着时先关确认框，别把编辑器一起关了） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || saving) return
      if (confirmRestore) {
        setConfirmRestore(false)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saving, confirmRestore, onClose])

  function setField(key: string, value: unknown) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  async function doSave() {
    // 只把「真变了」的字段发上去（字段级改）
    const changed: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(draft)) {
      if (JSON.stringify(v) !== JSON.stringify(entry[k])) changed[k] = v
    }
    if (Object.keys(changed).length === 0) {
      onClose()
      return
    }
    setSaving(true)
    setError(null)
    try {
      await saveLibraryPatch(kind, id, changed)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function doRestore() {
    setConfirmRestore(true)
  }

  /** 真的恢复（确认框点了「恢复默认」才走这里） */
  async function confirmRestoreNow() {
    setSaving(true)
    setError(null)
    try {
      await restoreLibraryDefault(kind, id)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
      setConfirmRestore(false)
    }
  }

  return (
    <>
      <div className="pr-ps-modal" onClick={() => !saving && onClose()}>
        <div
          className="pr-ps-modal-box is-editor"
          role="dialog"
          aria-label="编辑用方知识库条目"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="pr-ps-modal-head">
            <h4>编辑条目</h4>
            <span className="pr-ed-subject" title={title}>
              {title}
            </span>
            {isOverridden && (
              <button type="button" className="pr-ed-link" onClick={() => doRestore()} disabled={saving}>
                恢复默认
              </button>
            )}
            <button type="button" className="pr-ps-close" onClick={onClose} disabled={saving}>
              ✕
            </button>
          </header>

          <div className="pr-ed-body">
            <section className="pr-ed-main">
              {!spec ? (
                <p className="pr-empty">还没拿到字段表（注册表没加载上），先刷新页面再试。</p>
              ) : (
                <div className="pr-led-grid">
                  {spec.fields.map((field) => (
                    <label key={field.key} className={`pr-led-field${field.long ? ' is-long' : ''}`}>
                      <span className="pr-led-label">
                        {field.label}
                        {field.required ? <em>＊</em> : null}
                      </span>
                      <FieldInput
                        field={field}
                        value={draft[field.key]}
                        readOnly={field.key === spec.idField}
                        onChange={(v) => setField(field.key, v)}
                      />
                      {field.key === spec.idField ? (
                        <small className="pr-led-hint">条目 id 不能改（改它等于删了重加）。</small>
                      ) : null}
                    </label>
                  ))}
                </div>
              )}
            </section>
          </div>

          <footer className="pr-ed-foot">
            {error ? (
              <span className="pr-ed-error">{error}</span>
            ) : (
              <span className="pr-ed-tip">
                改动写进服务端覆盖层，所有账号共享一份；仓库里的基线文件不动。
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
      {confirmRestore && (
        <ConfirmDialog
          title="恢复成内置基线？"
          body={
            <p>这一条在网站里改过的内容会被撤掉（这一份是所有账号共享的）。</p>
          }
          okText="恢复默认"
          onOk={() => void confirmRestoreNow()}
          onCancel={() => setConfirmRestore(false)}
        />
      )}
    </>
  )
}
