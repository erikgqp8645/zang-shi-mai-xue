import {
  BLOCK_GATES,
  BLOCK_ORDER_NOTE,
  BLOCK_ORDER_NOTE_2,
  FLOW_PATHS,
  TRIAD_STEPS,
  TRIAD_VARIANTS,
  type BlockGate,
  type FlowStep,
} from '../domain/sequence'

/**
 * 流程骨架引导条 —— 放在「依脉用方 · 讲稿原序」顶部。
 *
 * 只做两件事：
 * 1. 把讲义 p44 与讲稿写明的先后次序摆出来（静态，附出处）。
 * 2. 命中标示：某一步被点亮 = 现有依脉用方规则在该步有命中。
 *
 * 明确不做：不推荐方、不替读者加减方、不下诊断、不自动推进到下一步。
 */

interface Props {
  /** 命中的路线名集合（来自 formulaHits 的 route） */
  hitRoutes: string[]
}

/** 一个步骤节点 */
function StepNode({
  step,
  lit,
  order,
}: {
  step: FlowStep
  lit: boolean
  order?: string
}) {
  return (
    <li className={`pr-flow-step${lit ? ' is-lit' : ''}`}>
      <span className="pr-flow-step-mark">
        {order && <span className="pr-flow-step-no">{order}</span>}
        <span className="pr-flow-step-title">{step.title}</span>
        {lit && <span className="pr-flow-dot" title="该步在现有依脉用方规则中有命中" />}
      </span>
      {step.detail && <span className="pr-flow-step-detail">{step.detail}</span>}
    </li>
  )
}

/** 一关（挡路次序） */
function GateNode({ gate, lit }: { gate: BlockGate; lit: boolean }) {
  return (
    <li className={`pr-flow-gate is-${gate.priority}${lit ? ' is-lit' : ''}`}>
      <span className="pr-flow-gate-mark">
        <span className="pr-flow-gate-no">{gate.no}</span>
        <span className="pr-flow-gate-title">{gate.title}</span>
        {lit && <span className="pr-flow-dot" title="该关在现有依脉用方规则中有命中" />}
      </span>
      <span className="pr-flow-gate-detail">{gate.detail}</span>
    </li>
  )
}

export function FlowPath({ hitRoutes }: Props) {
  const routes = new Set(hitRoutes)
  const isLit = (list: string[]) => list.some((r) => routes.has(r))

  const firstGates = BLOCK_GATES.filter((g) => g.priority === 'first')
  const laterGates = BLOCK_GATES.filter((g) => g.priority === 'later')

  return (
    <section className="pr-flow">
      <h3 className="pr-flow-title">总路线（流程骨架）</h3>
      <p className="pr-target-line">
        讲义 2026-10·p44「依脉用方」图 ＋ 讲稿 2010 第二讲「变脉有力三部曲」、第四讲「一、二、三、四」、第五讲「一二三四五六」、第六讲逐关说明 ·
        只转述原文写明的先后次序，不推荐方、不加减方；亮起只表示该步在现有依脉用方规则中有命中
      </p>

      {/* ---- 一、路径级：肾虚 ⇄ 上盛下虚 ---- */}
      <div className="pr-flow-level">
        <span className="pr-flow-level-tag">路径</span>
        <div className="pr-flow-paths">
          {FLOW_PATHS.map((p) => (
            <div key={p.id} className="pr-flow-path">
              <h4 className="pr-flow-path-title">{p.title}</h4>
              <ol className="pr-flow-steps">
                {p.steps.map((s, i) => (
                  <StepNode key={s.id} step={s} lit={isLit(s.routes)} order={String(i + 1)} />
                ))}
              </ol>
              <p className="pr-flow-path-note">{p.note}</p>
              <p className="pr-finding-src">〔{p.source}〕</p>
            </div>
          ))}
          <div className="pr-flow-link" title="讲义 p44 两框之间为双向箭头">
            <span>⇄</span>
          </div>
        </div>
      </div>

      {/* ---- 二、步骤级：变脉有力三部曲 ---- */}
      <div className="pr-flow-level">
        <span className="pr-flow-level-tag">变脉有力三部曲</span>
        <ol className="pr-flow-steps is-inline">
          {TRIAD_STEPS.map((s, i) => (
            <StepNode key={s.id} step={s} lit={isLit(s.routes)} order={String(i + 1)} />
          ))}
        </ol>
        <p className="pr-finding-src">
          〔{TRIAD_STEPS[0].source}〕 · {TRIAD_STEPS[0].quote}
        </p>
        <div className="pr-flow-variants">
          <span className="pr-flow-variants-label">讲义与讲稿写法并列（不合并）</span>
          {TRIAD_VARIANTS.map((v) => (
            <span key={v.source} className="pr-flow-variant">
              <span className="pr-flow-variant-text">{v.text}</span>
              <span className="pr-flow-variant-src">〔{v.source}〕</span>
            </span>
          ))}
        </div>
      </div>

      {/* ---- 三、次序级：六大挡路 ---- */}
      <div className="pr-flow-level">
        <span className="pr-flow-level-tag">挡路次序</span>
        <div className="pr-flow-gates">
          <div className="pr-flow-gate-group is-first">
            <p className="pr-flow-gate-group-title">
              先解决（一～四）<span className="pr-flow-gate-group-note">{BLOCK_ORDER_NOTE.first}</span>
            </p>
            <ol className="pr-flow-gate-list">
              {firstGates.map((g) => (
                <GateNode key={g.id} gate={g} lit={isLit(g.routes)} />
              ))}
            </ol>
          </div>
          <div className="pr-flow-gate-group is-later">
            <p className="pr-flow-gate-group-title">
              不用先解决（五～六）<span className="pr-flow-gate-group-note">{BLOCK_ORDER_NOTE.later}</span>
            </p>
            <ol className="pr-flow-gate-list">
              {laterGates.map((g) => (
                <GateNode key={g.id} gate={g} lit={isLit(g.routes)} />
              ))}
            </ol>
          </div>
        </div>
        <p className="pr-finding-src">
          〔{BLOCK_ORDER_NOTE.source}〕 · {BLOCK_ORDER_NOTE.quote}
        </p>
        <p className="pr-finding-src">
          〔{BLOCK_ORDER_NOTE_2.source}〕 · {BLOCK_ORDER_NOTE_2.text}
        </p>
      </div>
    </section>
  )
}
