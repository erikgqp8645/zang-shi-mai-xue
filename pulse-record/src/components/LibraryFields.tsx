import { removeChip } from '../domain/library-chips.mjs'
import type { LibraryKind, LibraryKindField } from '../domain/library-store'

/**
 * 用方知识库 · **条目字段表单**（受控面板）
 *
 * ## 为什么抽出来
 *
 * 原来这块在 `LibraryEditor.tsx`（一个独立的弹层）。现在条目与脉象图
 * 合并成**一个界面**（`RuleEditor.tsx`），表单就变成弹层里的一个页签 ⇒
 * 它得能单独渲染、能被父级控制草稿 ⇒ 拆成受控面板。
 *
 * ## 表单是**数据驱动**的
 *
 * 字段清单、类型、标签、可选值，全部来自服务端的 `/api/library/kinds`
 * （那是后端 `LIBRARY_KINDS` 注册表）⇒ **前端不硬编码字段表** ⇒ 一个来源。
 *
 * ⓘ `id` **只读**：改 id ＝ 删掉这一条再重加一条，而 p44 新增要配判定函数
 *   （数据长不出逻辑）⇒ 本轮不开放新增 ⇒ id 不给改。
 */

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

interface Props {
  /** 服务端给的字段表（`/api/library/kinds`） */
  kinds: Record<string, LibraryKind> | undefined
  /** 这一类的 kind（'rule' ｜ 'drug'） */
  kind: string
  /** 草稿（父级持有） */
  draft: Record<string, unknown>
  /** 改一个字段 */
  onChange: (key: string, value: unknown) => void
  /**
   * **新增**时 id 要能填 —— 编辑态下 id 只读（改 id ＝ 删了重加）。
   */
  creating?: boolean
  /**
   * 新增时「自动生成」那个按钮的回调。
   *
   * ⓘ 只在点按钮的那一刻往输入框里填一个 id —— **后台什么都不写**；
   *   真正落库还是「保存」那一下（留空也会在保存时补上）。
   */
  onGenerateId?: () => string
}

export function LibraryFields({ kinds, kind, draft, onChange, creating, onGenerateId }: Props) {
  const spec = kinds?.[kind]
  if (!spec) {
    return <p className="pr-empty">还没拿到字段表（注册表没加载上），先刷新页面再试。</p>
  }
  return (
    <div className="pr-led-grid">
      {/*
        `json` 字段（如 rule 的 `patterns`）不在这个表单里编 ——
        它由「脉象图」页签的编辑器负责，在这里渲染只会多出一个没意义的输入框。
      */}
      {spec.fields
        .filter((field) => field.type !== 'json' && !field.hidden)
        .map((field) => (
          <label key={field.key} className={`pr-led-field${field.long ? ' is-long' : ''}`}>
            <span className="pr-led-label">
              {field.label}
              {field.required ? <em>＊</em> : null}
            </span>
            {/*
              新增时 id 旁边给一个「自动生成」——
              ⓘ 点它只是把 id 填进输入框，**后台不写任何东西**；
                真正落库在「保存」那一下（留空也会自动补）。
            */}
            {field.key === spec.idField && creating && onGenerateId ? (
              <div className="pr-led-idrow">
                <FieldInput
                  field={field}
                  value={draft[field.key]}
                  readOnly={false}
                  onChange={(v) => onChange(field.key, v)}
                />
                <button
                  type="button"
                  className="pr-led-btn pr-led-idgen"
                  title="自动生成一个条目 id（只是填进输入框，保存时才落库）"
                  onClick={() => onChange(field.key, onGenerateId())}
                >
                  自动生成
                </button>
              </div>
            ) : (
              <FieldInput
                field={field}
                value={draft[field.key]}
                readOnly={field.key === spec.idField}
                onChange={(v) => onChange(field.key, v)}
              />
            )}
            {field.key === spec.idField ? (
              <small className="pr-led-hint">
                {creating
                  ? '「自动生成」得到 u-日期-随机（如 u-261113-tmcz）；也可自己填语义化的名字（如 u-yiti-lengshui）。留空保存时自动生成。'
                  : '条目 id 不能改（改它等于删了重加）。'}
              </small>
            ) : null}
          </label>
        ))}
    </div>
  )
}
