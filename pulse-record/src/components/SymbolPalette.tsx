import { useState } from 'react'
import {
  COMMON_GROUPS,
  formatCodes,
  parseCodes,
  SYMBOL_BY_CODE,
  type CustomSymbol,
} from '../domain/symbols'

interface Props {
  codes: string[]
  target: string | null
  onChange: (codes: string[]) => void
  /** 自定义符号（使用者自建，如「涩」＝S） */
  customSymbols: CustomSymbol[]
  onAddCustom: (code: string, name: string) => Promise<boolean>
  onDeleteCustom: (code: string) => Promise<boolean>
  /** 服务端/校验的错误提示 */
  error: string | null
}

export function SymbolPalette({
  codes,
  target,
  onChange,
  customSymbols,
  onAddCustom,
  onDeleteCustom,
  error,
}: Props) {
  const [adding, setAdding] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const toggle = (code: string) => {
    if (codes.includes(code)) onChange(codes.filter((c) => c !== code))
    else onChange([...codes, code])
  }

  const submit = async () => {
    setBusy(true)
    try {
      const ok = await onAddCustom(newCode.trim(), newName.trim())
      if (ok) {
        setNewCode('')
        setNewName('')
        setAdding(false)
      }
    } finally {
      setBusy(false)
    }
  }

  const remove = async (code: string) => {
    setBusy(true)
    try {
      await onDeleteCustom(code)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="pr-panel">
      <header className="pr-panel-head">
        <h2>符号录入</h2>
        <span className="pr-target">
          {target ? `当前格：${target}` : '未选中格子 —— 先点表格里的一个格'}
        </span>
      </header>

      <div className="pr-palette">
        {COMMON_GROUPS.map((grp) => (
          <div key={grp.title} className="pr-grp">
            <div className="pr-grp-title">常用脉象 {grp.title}</div>
            <div className="pr-grp-btns">
              {grp.codes.map((code) => {
                const def = SYMBOL_BY_CODE[code]
                const on = codes.includes(code)
                return (
                  <button
                    key={code}
                    type="button"
                    className={`pr-sym${on ? ' is-on' : ''}`}
                    onClick={() => toggle(code)}
                    disabled={!target}
                    title={def?.hint ?? def?.label}
                  >
                    <span className="pr-sym-code">{code}</span>
                    <span className="pr-sym-label">{def?.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {/* 自定义符号：使用者自建，讲义固定符号集之外另加 */}
        <div className="pr-grp">
          <div className="pr-grp-title">
            自定义符号（自建，如 涩＝S）
            {!adding && (
              <button type="button" className="pr-ghost pr-add-symbol" onClick={() => setAdding(true)}>
                ＋ 添加
              </button>
            )}
          </div>

          {customSymbols.length > 0 && (
            <div className="pr-grp-btns">
              {customSymbols.map((s) => {
                const on = codes.includes(s.code)
                return (
                  <span key={s.code} className="pr-sym-wrap">
                    <button
                      type="button"
                      className={`pr-sym is-custom${on ? ' is-on' : ''}`}
                      onClick={() => toggle(s.code)}
                      disabled={!target}
                      title={`自定义符号：${s.name}`}
                    >
                      <span className="pr-sym-code">{s.code}</span>
                      <span className="pr-sym-label">{s.name}</span>
                    </button>
                    <button
                      type="button"
                      className="pr-x"
                      onClick={() => remove(s.code)}
                      disabled={busy}
                      title="删除该自定义符号（已录入的历史记录不受影响）"
                    >
                      ×
                    </button>
                  </span>
                )
              })}
            </div>
          )}

          {adding && (
            <div className="pr-custom-form">
              <input
                type="text"
                value={newName}
                placeholder="名称，如 涩"
                maxLength={12}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit()
                }}
              />
              <input
                type="text"
                value={newCode}
                placeholder="代码，如 S"
                maxLength={3}
                onChange={(e) => setNewCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit()
                }}
              />
              <button type="button" onClick={submit} disabled={busy}>
                添加
              </button>
              <button type="button" className="pr-ghost" onClick={() => setAdding(false)} disabled={busy}>
                取消
              </button>
            </div>
          )}

          {error && <p className="pr-custom-err">{error}</p>}

          {customSymbols.length === 0 && !adding && (
            <p className="pr-muted pr-custom-hint">
              讲义固定符号之外，可自建符号（如「涩」记作 S），存本机、跟着记录与导出走。
            </p>
          )}
        </div>
      </div>

      <div className="pr-manual">
        <label>
          手输组合
          <input
            type="text"
            value={formatCodes(codes)}
            placeholder="如 X↑ / 0+# / ++"
            disabled={!target}
            onChange={(e) => onChange(parseCodes(e.target.value, customSymbols.map((s) => s.code)))}
          />
        </label>
        <button type="button" className="pr-ghost" disabled={!target} onClick={() => onChange([])}>
          清空本格
        </button>
      </div>
    </section>
  )
}
