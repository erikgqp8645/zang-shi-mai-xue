import {
  BIANMAI_DEFINITION,
  CONSTITUTION_OPTIONS,
  STATE_HINTS,
  THERAPY_OPTIONS,
  therapyOf,
  type Prescription,
  type TriadReference,
} from '../domain/triad'
import type { Constitution, Therapy } from '../domain/types'
import { resolveFormulaLink, type FormulaLink } from '../domain/formula-links'
import { DoseLines } from './DoseLines'

/**
 * 开方三部曲 · 框架
 *
 * 讲义 2026-10 PDF p47（印刷 45）「臧氏脉学 开方三部曲」图：
 *   ①判体质 → ②定疗法 → ③开方药，③ 有一条虚线回路回到 ①。
 *
 * 这套图是**整个工具的主框架**——所有内容都装在它的三步里：
 *   ①判体质 → 摸脉录入（主表 / 符号录入 / 寸关尺图示）
 *   ②定疗法 → 判读提示（依脉用方 / 风险提示）
 *   ③开方药 → 开方药清单 ＋ 用药记录
 *
 * 框头是三步导航：点哪一步跳到哪一步；每一步标「已完成 / 进行中 / 待进行」，
 * 按 ①→②→③ 的次序走。③ 之后回到 ① 重判（讲义 p47 图上的虚线回路）。
 *
 * 边界：只标示不下诊断、不替读者加减方、不自动开方。
 */

/** 一步的状态 */
export type StepState = 'done' | 'current' | 'todo'

/** 一步（框头导航与框头共用） */
export interface TriadStep {
  /** ① / ② / ③ */
  no: '①' | '②' | '③'
  /** 标题 */
  title: string
  /** 说明（照图） */
  note: string
  /** 状态 */
  state: StepState
  /** 这一步的结果摘要（如「肾虚体质」） */
  result?: string
}

interface HeaderProps {
  steps: TriadStep[]
  /** 点某一步 → 跳到那个框 */
  onJump?: (no: '①' | '②' | '③') => void
  /** 命中提示（可点击定位） */
  hitNote?: React.ReactNode
}

/** 框头：三步导航 */
export function TriadHeader({ steps, onJump, hitNote }: HeaderProps) {
  return (
    <header className="pr-triad-head">
      <div className="pr-triad-head-left">
        <span className="pr-triad-head-title">开方三部曲</span>
        <span className="pr-triad-head-src">讲义 2026-10·p47（印刷 45）</span>
      </div>

      <ol className="pr-triad-steps">
        {steps.map((s) => (
          <li key={s.no} className={`pr-triad-step is-${s.state}`}>
            <button
              type="button"
              className="pr-triad-step-btn"
              onClick={() => onJump?.(s.no)}
              title={`跳到 ${s.no}${s.title}`}
            >
              <span className="pr-triad-step-no">{s.no}</span>
              <span className="pr-triad-step-title">{s.title}</span>
              {s.result && <span className="pr-triad-step-state">{s.result}</span>}
            </button>
            <span className="pr-triad-step-flag">
              {s.state === 'done' ? '已完成' : s.state === 'current' ? '进行中' : '待进行'}
            </span>
          </li>
        ))}
      </ol>

      <div className="pr-triad-head-right">
        {hitNote}
        <span className="pr-triad-loop" title="讲义 p47 图上③有一条虚线回到①">
          ⟲ ③ 后回 ① 重判
        </span>
      </div>
    </header>
  )
}

/* ------------------------------------------------------------------ */
/* 框：装内容的容器                                                    */
/* ------------------------------------------------------------------ */

interface SectionProps {
  /** ① / ② / ③ */
  stage: '①' | '②' | '③'
  /** 这一步的标题 */
  title: string
  /** 这一步的说明（照图） */
  note: string
  /** 状态 */
  state: StepState
  /** 右上角的结果摘要（如「→ 肾虚体质」） */
  result?: string
  children: React.ReactNode
}

/** 一个框 */
export function TriadSection({ stage, title, note, state, result, children }: SectionProps) {
  return (
    <section className={`pr-triad-box is-${stage} is-${state}`} id={`pr-triad-box-${stage}`} data-stage={stage}>
      <header className="pr-triad-box-head">
        <span className="pr-triad-box-no">{stage}</span>
        <span className="pr-triad-box-title">{title}</span>
        <span className="pr-triad-box-note">{note}</span>
        <span className="pr-triad-box-flag">
          {state === 'done' ? '已完成' : state === 'current' ? '进行中' : '待进行'}
        </span>
        {result && <span className="pr-triad-box-result">{result}</span>}
      </header>
      <div className="pr-triad-box-body">{children}</div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* 框内的零件                                                          */
/* ------------------------------------------------------------------ */

/** 变脉定义（图上旁注） */
export function BianmaiNote() {
  return (
    <p className="pr-triad-def">
      <span className="pr-triad-def-key">{BIANMAI_DEFINITION.title}：</span>
      {BIANMAI_DEFINITION.text}
      <span className="pr-triad-def-src">〔{BIANMAI_DEFINITION.source}〕</span>
    </p>
  )
}

/** 状态佐证（图上两个云朵框；是佐证，不是脉象判据） */
export function StateHints({ constitution }: { constitution: Constitution | null }) {
  return (
    <div className="pr-triad-states">
      <span className="pr-triad-states-label">状态（佐证，不是脉象判据）</span>
      {STATE_HINTS.map((h) => (
        <span
          key={h.constitution}
          className={`pr-triad-state${constitution === h.constitution ? ' is-on' : ''}`}
        >
          {h.text} → {h.constitution}
        </span>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 手动选择：①判体质 / ②定疗法                                         */
/* ------------------------------------------------------------------ */

/**
 * ①判体质 —— 由使用者自己判断后点选。
 *
 * 图上三个椭圆（讲义 p47）：肾虚体质 / 上盛下虚体质 / 平和体质。
 * 工具只记录选择结果，不代判、不下诊断。
 */
export function ConstitutionPicker({
  value,
  onChange,
  onClear,
}: {
  value: Constitution | null
  onChange: (c: Constitution) => void
  onClear?: () => void
}) {
  return (
    <div className="pr-triad-pick">
      <div className="pr-triad-pick-head">
        <span className="pr-triad-pick-title">判体质</span>
        <span className="pr-triad-pick-note">自己判断后点选（工具不代判）</span>
        {value && (
          <button type="button" className="pr-triad-pick-clear" onClick={onClear}>
            清除
          </button>
        )}
      </div>
      <div className="pr-triad-pick-opts">
        {CONSTITUTION_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`pr-triad-pick-opt${value === o.id ? ' is-on' : ''}`}
            onClick={() => onChange(o.id)}
            title={o.path}
          >
            <span className="pr-triad-pick-name">{o.label}</span>
            <span className="pr-triad-pick-path">{o.path}</span>
            {o.stateHint && <span className="pr-triad-pick-hint">{o.stateHint}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * ②定疗法 —— 由使用者自己点选。
 *
 * 图上三个六边形（讲义 p47）：三焦疗法 / 五脏疗法 / 一体疗法。
 * 选了体质会按图上的配对带出疗法（suggested），带出后仍可改。
 */
export function TherapyPicker({
  value,
  onChange,
  onClear,
  constitution,
  onOpenFormula,
}: {
  value: Therapy | null
  onChange: (t: Therapy) => void
  onClear?: () => void
  /** 已选的体质；用来提示「这个疗法是随体质带出来的」 */
  constitution?: Constitution | null
  /** 点疗法里的方名 → 跳到「用方知识库」里那一条（与 ③ 的方名同一套对照） */
  onOpenFormula?: (link: FormulaLink) => void
}) {
  const carried = constitution ? therapyOf(constitution) : null
  return (
    <div className="pr-triad-pick">
      <div className="pr-triad-pick-head">
        <span className="pr-triad-pick-title">定疗法</span>
        <span className="pr-triad-pick-note">
          {carried ? `随体质带出「${carried}」，仍可改` : '自己点选（工具不代判）'}
        </span>
        {value && (
          <button type="button" className="pr-triad-pick-clear" onClick={onClear}>
            清除
          </button>
        )}
      </div>
      <div className="pr-triad-pick-opts">
        {THERAPY_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`pr-triad-pick-opt${value === o.id ? ' is-on' : ''}${
              carried === o.id && value !== o.id ? ' is-carried' : ''
            }`}
            onClick={() => onChange(o.id)}
          >
            <span className="pr-triad-pick-name">{o.label}</span>
            <span className="pr-triad-pick-path">
              {o.prescriptions.map((p, i) => {
                const link = onOpenFormula ? resolveFormulaLink(p.name) : null
                return (
                  <span key={p.name}>
                    {i > 0 && '、'}
                    {link ? (
                      <button
                        type="button"
                        className="pr-link"
                        onClick={() => onOpenFormula?.(link)}
                        title={`看「${link.label}」的完整条目　依据：${link.basis}`}
                      >
                        {p.name}
                      </button>
                    ) : (
                      <span>{p.name}</span>
                    )}
                  </span>
                )
              })}
            </span>
            {carried === o.id && value !== o.id && (
              <span className="pr-triad-pick-hint">随体质带出</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * 开方药清单（③ 里照图列出的方名）
 *
 * ## 方名可点
 *
 * 图上的方名（「上焦方」「清挡路方」「引火归元」…）是**讲义 p47 的用名**，
 * 而「用方」知识库是另一套写法 —— 两者是**同一个方**，对照表在
 * `src/domain/formula-links.ts`（每条都带依据）。
 *
 * - 对得上的 → 方名变成链接，点进去看完整条目（组成／服法／加减／禁忌）；
 * - 对不上的 → **明说「用方页未载」**，不硬凑、不改名去匹配。
 */
export function RxList({
  prescriptions,
  onOpenFormula,
}: {
  prescriptions: Prescription[]
  /** 点方名 → 跳到「用方知识库」里那一条 */
  onOpenFormula?: (link: FormulaLink) => void
}) {
  if (prescriptions.length === 0) {
    return <p className="pr-triad-rx-empty">在 ② 选定疗法后，按讲义 p47 图列出那一支的方</p>
  }
  return (
    <ul className="pr-triad-rx-list">
      {prescriptions.map((rx) => {
        const link = onOpenFormula ? resolveFormulaLink(rx.name) : null
        return (
          <li key={`${rx.no}-${rx.name}`} className="pr-triad-rx">
            <span className="pr-triad-rx-no">{rx.no}.</span>
            <span className="pr-triad-rx-name">
              {link ? (
                <button
                  type="button"
                  className="pr-link"
                  onClick={() => onOpenFormula?.(link)}
                  title={`看「${link.label}」的完整条目　依据：${link.basis}`}
                >
                  {rx.name}
                </button>
              ) : (
                <span>{rx.name}</span>
              )}
              {onOpenFormula && !link && (
                <span className="pr-triad-rx-unknown">　用方页未载</span>
              )}
            </span>
            <span className="pr-triad-rx-src">〔{rx.source}〕</span>
            {/* 两套资料的组成并列（克 ／ 比例制），各带出处；查不到就明说未载 */}
            <DoseLines name={rx.name} className="pr-triad-rx-dose" />
          </li>
        )
      })}
    </ul>
  )
}

/** 参考判据命中提示（框头用，可点击定位） */
export function HitNote({
  result,
  onFocusCells,
}: {
  result: TriadReference
  onFocusCells?: (cells: string[]) => void
}) {
  const { bianmai, chimai, chimaiReached, recorded } = result
  return (
    <>
      {bianmai && (
        <button
          type="button"
          className="pr-triad-hit"
          onClick={() => onFocusCells?.(bianmai.cells)}
          title="定位到命中的格子"
        >
          参考：有变脉？已命中 {bianmai.cells.length} 处
        </button>
      )}
      {recorded && chimaiReached && chimai && (
        <button
          type="button"
          className="pr-triad-hit"
          onClick={() => onFocusCells?.(chimai.cells)}
          title="定位到命中的格子"
        >
          参考：尺脉弱？已命中 {chimai.cells.length} 处
        </button>
      )}
      {recorded && chimaiReached && !chimai && (
        <span className="pr-triad-head-tag">参考：尺脉不弱</span>
      )}
    </>
  )
}
