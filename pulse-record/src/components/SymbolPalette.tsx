import { COMMON_GROUPS, formatCodes, parseCodes, SYMBOL_BY_CODE } from '../domain/symbols'

interface Props {
  codes: string[]
  target: string | null
  onChange: (codes: string[]) => void
}

export function SymbolPalette({ codes, target, onChange }: Props) {
  const toggle = (code: string) => {
    if (codes.includes(code)) onChange(codes.filter((c) => c !== code))
    else onChange([...codes, code])
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
      </div>

      <div className="pr-manual">
        <label>
          手输组合
          <input
            type="text"
            value={formatCodes(codes)}
            placeholder="如 X↑ / 0+# / ++"
            disabled={!target}
            onChange={(e) => onChange(parseCodes(e.target.value))}
          />
        </label>
        <button type="button" className="pr-ghost" disabled={!target} onClick={() => onChange([])}>
          清空本格
        </button>
      </div>
    </section>
  )
}
