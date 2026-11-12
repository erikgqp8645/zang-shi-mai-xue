import { useEffect, useMemo, useState } from 'react'
import { restoreLibraryDefault, saveLibraryPatch, useLibrary } from '../state/library'
import { usePatterns } from '../state/patterns'
import { getEffectiveDrugRaw, getEffectiveRuleRaw } from '../domain/library-store'
import { diffEntryFields, normalizePatterns, patternsChanged } from '../domain/unified-editor.mjs'
import type { PulsePattern } from '../domain/pulse-pattern'
import { ConfirmDialog } from './ConfirmDialog'
import { LibraryFields } from './LibraryFields'
import { PatternPanel } from './PatternPanel'

/**
 * 用方知识库 · **统一编辑弹层**（条目 ＋ 脉象图，一个界面）
 *
 * ## 为什么要归一
 *
 * 原来一个条目有两处能改：
 *   · ③ 知识库条目上的「编辑」→ 改**文字字段**（条件／治法／方名／出处／原文…）
 *   · 方剂卡上「脉象图 · 编辑」→ 改**图**（格位符号／组／体例）
 * 两处是两个弹层、两套表单、两个「保存」按钮；而且**出处、原文、图名
 * 这几样在两边各编一遍** ⇒ 迟早对不上。
 *
 * ⇒ 现在**一个弹层、两个页签、一个保存按钮**：
 *   「条目」页 ＝ 文字字段；「脉象图」页 ＝ 图。
 * 两个入口（③ 的「编辑」、方剂卡的「脉象图 · 编辑」）都进这里，
 * 只是**落在不同的页签**。
 *
 * ## 去重：同一件事只编一处
 *
 * | 东西 | 只在哪儿编 |
 * |---|---|
 * | 出处 | **条目页**（脉象图页只读显示「本图出处」，不另编） |
 * | 原文 | **条目页**（脉象图页的「与原文的出入」只写差异，不抄原文） |
 * | 图名 | **多张图时才编**（一张图时图名就是这条的方名，只读显示） |
 *
 * ## 保存语义
 *
 * 一个「保存」按钮 → **有改动的部分才发请求**：
 *   · 条目改了 → `PATCH /api/library/entries/:kind/:id`（字段级改，只发改了的字段）
 *   · 图改了   → `PUT /api/formula-patterns/:id`（整条替换）
 * 两处**分开报错**：一处存成了、另一处没存成，要说清楚是哪一处，
 * 不能笼统一句「保存失败」。
 *
 * ⓘ 不用 `window.confirm`：原生弹窗在 Electron 桌面端会把整个渲染进程冻住
 *   （点了「恢复默认」，页面就再也不响应，连刷新都救不回来）。
 */

type Tab = 'entry' | 'pattern'

interface Props {
  /** `rule` ｜ `drug` */
  kind: string
  /** 条目 id */
  id: string
  /** 当前生效的那一条（不给就自己取） */
  entry?: Record<string, unknown> | null
  /** 标题（给人看的条目名） */
  title: string
  /** 打开时落在哪个页签 */
  initialTab?: Tab
  /** 条目基线里的脉象图（覆盖层优先，由 `usePatterns` 处理） */
  baseline?: PulsePattern[]
  onClose: () => void
}

export function RuleEditor({ kind, id, entry: entryProp, title, initialTab, baseline, onClose }: Props) {
  const { kinds, overrides } = useLibrary()
  const { patternsOf, save: savePatterns, reset: resetPatterns, isOverridden: isPatternOverridden } =
    usePatterns()

  /** 生效的那一条（入口没给就自己取 —— 方剂卡那个入口拿不到整条） */
  const effective = useMemo(() => {
    if (entryProp) return entryProp
    return kind === 'rule' ? getEffectiveRuleRaw(id) : getEffectiveDrugRaw(id)
  }, [entryProp, kind, id])

  /** 条目的基线（用于比较「有没有变」；恢复默认后会刷新） */
  const [entryBase, setEntryBase] = useState<Record<string, unknown>>(() => ({ ...(effective ?? {}) }))
  /** 条目草稿 */
  const [draft, setDraft] = useState<Record<string, unknown>>(() => ({ ...(effective ?? {}) }))

  /** 当前生效的图（基线 ⊕ 覆盖层） */
  const currentPatterns = useMemo(() => patternsOf(id, baseline), [patternsOf, id, baseline])
  /** 图草稿 */
  const [patternDraft, setPatternDraft] = useState<PulsePattern[]>(() =>
    JSON.parse(JSON.stringify(currentPatterns)) as PulsePattern[],
  )

  const [tab, setTab] = useState<Tab>(initialTab ?? 'entry')
  const [saving, setSaving] = useState(false)
  /** 条目保存失败的原因（与图的分开） */
  const [entryError, setEntryError] = useState<string | null>(null)
  /** 脉象图保存失败的原因 */
  const [patternError, setPatternError] = useState<string | null>(null)
  /** 待确认的「恢复默认」（站内确认框用） */
  const [confirmRestore, setConfirmRestore] = useState<null | 'entry' | 'pattern'>(null)

  /** 条目有没有被改过（覆盖层里有这一行） */
  const entryOverridden = !!overrides?.[kind]?.[id]
  /** 图有没有被改过 */
  const patternOverridden = isPatternOverridden(id)

  /* Esc 关闭（确认框开着时先关确认框，别把编辑器一起关了） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || saving) return
      if (confirmRestore) {
        setConfirmRestore(null)
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

  /** 条目真变了哪些字段（只发真变了的） */
  function changedFields(): Record<string, unknown> {
    return diffEntryFields(draft, entryBase)
  }

  async function doSave() {
    const changed = changedFields()
    const hasEntryChange = Object.keys(changed).length > 0
    const hasPatternChange = patternsChanged(patternDraft, currentPatterns)

    if (!hasEntryChange && !hasPatternChange) {
      onClose()
      return
    }

    setSaving(true)
    setEntryError(null)
    setPatternError(null)

    // 两处**分开存、分开报错** —— 一处存成了不能说成「保存失败」
    let entryOk = true
    if (hasEntryChange) {
      try {
        await saveLibraryPatch(kind, id, changed)
        setEntryBase({ ...draft })
      } catch (e) {
        entryOk = false
        setEntryError(e instanceof Error ? e.message : String(e))
      }
    }

    let patternOk = true
    if (hasPatternChange) {
      try {
        await savePatterns(id, normalizePatterns(patternDraft))
      } catch (e) {
        patternOk = false
        setPatternError(e instanceof Error ? e.message : String(e))
      }
    }

    setSaving(false)
    if (entryOk && patternOk) onClose()
  }

  /** 真的恢复（确认框点了「恢复默认」才走这里） */
  async function confirmRestoreNow() {
    const which = confirmRestore
    setConfirmRestore(null)
    setSaving(true)
    setEntryError(null)
    setPatternError(null)
    try {
      if (which === 'entry') {
        await restoreLibraryDefault(kind, id)
        // 恢复后重新取生效的那一条，草稿跟着回到基线
        const fresh = kind === 'rule' ? getEffectiveRuleRaw(id) : getEffectiveDrugRaw(id)
        if (fresh) {
          setEntryBase({ ...fresh })
          setDraft({ ...fresh })
        }
      } else if (which === 'pattern') {
        await resetPatterns(id)
        setPatternDraft(JSON.parse(JSON.stringify(patternsOf(id, baseline))) as PulsePattern[])
      }
    } catch (e) {
      if (which === 'entry') setEntryError(e instanceof Error ? e.message : String(e))
      else setPatternError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const hasPatternTab = kind === 'rule'

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
            <button type="button" className="pr-ps-close" onClick={onClose} disabled={saving}>
              ✕
            </button>
          </header>

          {/* ---- 页签：一个界面里两处都能改 ---- */}
          <nav className="pr-ed-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'entry'}
              className={`pr-ed-tab${tab === 'entry' ? ' is-on' : ''}`}
              onClick={() => setTab('entry')}
            >
              条目
            </button>
            {hasPatternTab && (
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'pattern'}
                className={`pr-ed-tab${tab === 'pattern' ? ' is-on' : ''}`}
                onClick={() => setTab('pattern')}
              >
                脉象图
                {patternOverridden ? <i className="pr-ed-tab-dot" title="这一条的手改过图" /> : null}
              </button>
            )}
            <span className="pr-ed-tabs-right">
              {tab === 'entry' && entryOverridden ? (
                <button
                  type="button"
                  className="pr-ed-link"
                  onClick={() => setConfirmRestore('entry')}
                  disabled={saving}
                >
                  恢复默认（本条）
                </button>
              ) : null}
              {tab === 'pattern' && patternOverridden ? (
                <button
                  type="button"
                  className="pr-ed-link"
                  onClick={() => setConfirmRestore('pattern')}
                  disabled={saving}
                >
                  恢复默认（脉象图）
                </button>
              ) : null}
            </span>
          </nav>

          {/* ---- 内容 ---- */}
          {tab === 'entry' ? (
            <div className="pr-ed-body">
              <section className="pr-ed-main">
                <LibraryFields
                  kinds={kinds ?? undefined}
                  kind={kind}
                  draft={draft}
                  onChange={setField}
                />
                {entryError ? <p className="pr-ed-error">{entryError}</p> : null}
              </section>
            </div>
          ) : (
            <>
              <PatternPanel
                value={patternDraft}
                onChange={setPatternDraft}
                formulaLabel={title}
                entrySource={String(entryBase.source ?? '')}
              />
              {patternError ? (
                <p className="pr-ed-error pr-ed-error-out">{patternError}</p>
              ) : null}
            </>
          )}

          <footer className="pr-ed-foot">
            {entryError || patternError ? (
              <span className="pr-ed-error">
                {entryError && patternError
                  ? '条目的改动与脉象图的改动都没存成（看上面的提示）。'
                  : entryError
                    ? '条目的改动没存成（脉象图的不受影响）。'
                    : '脉象图的改动没存成（条目的已存好）。'}
              </span>
            ) : (
              <span className="pr-ed-tip">
                两处一起保存，写进服务端覆盖层，所有账号共享一份；仓库里的基线文件不动。
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
            confirmRestore === 'entry' ? (
              <p>这一条在网站里改过的内容会被撤掉（这一份是所有账号共享的）。</p>
            ) : (
              <p>这一条手改过的脉象图会被撤掉（这台机器和其他机器都会回到基线）。</p>
            )
          }
          okText="恢复默认"
          onOk={() => void confirmRestoreNow()}
          onCancel={() => setConfirmRestore(null)}
        />
      )}
    </>
  )
}
