import {
  BIANMAI_DEFINITION,
  STATE_HINTS,
  TRIAD_STAGES,
  type Constituion,
  type Prescription,
  type TriadResult,
} from '../domain/triad'

/**
 * 开方三部曲 · 流程面板
 *
 * 按讲义 2026-10 PDF p47（印刷 45）「臧氏脉学 开方三部曲」图呈现：
 *   ①判体质 → ②定疗法 → ③开方药，③ 有一条虚线回路回到 ①。
 *
 * 呈现方式＝**照图上那条路径走一遍**：
 * - 走到的分支实线、走不到的分支置灰，体质／疗法／开方药随路径依次点亮；
 * - 命中只表示「本次录到的脉象符合该判据」，不等于诊断结论。
 *
 * 明确不做：不替读者加减方、不下诊断、不自动开方、不替使用者决定「应该走哪条路」。
 */

interface Props {
  /** 判定结果 */
  result: TriadResult
  /** 命中的单元格（供点击定位） */
  onFocusCells?: (cells: string[]) => void
}

/** 阶段标题条 */
function StageHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="pr-triad-stage-head">
      <span className="pr-triad-stage-title">{title}</span>
      <span className="pr-triad-stage-note">{note}</span>
    </div>
  )
}

/** 分支标签（是／否） */
function BranchTag({ text }: { text: string }) {
  return <span className="pr-triad-branch-tag">{text}</span>
}

/** 开方药折角纸片 */
function RxCard({ rx }: { rx: Prescription }) {
  return (
    <li className="pr-triad-rx">
      <span className="pr-triad-rx-no">{rx.no}.</span>
      <span className="pr-triad-rx-name">{rx.name}</span>
      <span className="pr-triad-rx-src">〔{rx.source}〕</span>
    </li>
  )
}

export function TriadFlow({ result, onFocusCells }: Props) {
  const { constitution, therapy, prescriptions, bianmai, chimai, chimaiReached, cells } = result

  /** 判定菱形的状态：yes 命中 / no 未命中 / pass 这一问已被排除 / off 没走到这一步 */
  const bianmaiState = bianmai ? 'yes' : 'no'
  const chimaiState = !chimaiReached ? 'off' : chimai ? 'yes' : 'no'

  /** 体质节点：走到且被选中＝亮起；走到但没选中＝实线未选中；没走到＝置灰 */
  const constState = (c: Constituion) => {
    if (constitution === c) return 'is-on'
    // 肾虚走「有变脉＝是」，上盛下虚／平和走「无变脉」分支
    const reached = c === '肾虚' ? !!bianmai : chimaiReached
    return reached ? 'is-off-path' : 'is-off'
  }

  const therapyState = (t: string) => (therapy === t ? 'is-on' : 'is-off-path')

  return (
    <section className="pr-triad">
      <h3 className="pr-triad-title">开方三部曲</h3>
      <p className="pr-target-line">
        讲义 2026-10·p47（印刷 45）「臧氏脉学 开方三部曲」图 · 按图上那条路径走一遍，
        只标示本次脉象符合哪一步，不替使用者决定路径、不替读者加减方、不下诊断
      </p>

      {/* ---- ①判体质 ---- */}
      <div className="pr-triad-stage is-judge">
        <StageHead title={TRIAD_STAGES[0].title} note={TRIAD_STAGES[0].note} />

        <div className="pr-triad-chain">
          {/* 摸脉 → 有变脉？ */}
          <div className="pr-triad-chain-row">
            <div className="pr-triad-node is-input">
              <span className="pr-triad-node-label">摸脉</span>
            </div>

            <div className="pr-triad-arrow is-h">→</div>

            {/* 有变脉？ */}
            <div className={`pr-triad-node is-decision is-${bianmaiState}`}>
              <span className="pr-triad-node-label">有变脉？</span>
              {bianmai && (
                <button
                  type="button"
                  className="pr-triad-hit"
                  onClick={() => onFocusCells?.(bianmai.cells)}
                  title="定位到命中的格子"
                >
                  已命中 {bianmai.cells.length} 处
                </button>
              )}
            </div>
          </div>

          {/* 变脉的定义（图上旁注，另起一行，不挤占判定框） */}
          <p className="pr-triad-def">
            <span className="pr-triad-def-key">{BIANMAI_DEFINITION.title}：</span>
            {BIANMAI_DEFINITION.text}
            <span className="pr-triad-def-src">〔{BIANMAI_DEFINITION.source}〕</span>
          </p>

          {/* 两个分支 */}
          <div className="pr-triad-branches">
            {/* 是 → 肾虚体质 */}
            <div className={`pr-triad-branch ${bianmai ? 'is-taken' : 'is-off'}`}>
              <span className="pr-triad-branch-line">
                <BranchTag text="是" />
                <span className="pr-triad-branch-conn">→</span>
              </span>
              <div className={`pr-triad-node is-constitution ${constState('肾虚')}`}>
                <span className="pr-triad-node-label">肾虚体质</span>
                <span className="pr-triad-node-note">状态：{STATE_HINTS[0].text}</span>
                <span className="pr-triad-node-src">〔讲义 2026-10·p47（开方三部曲图）〕</span>
              </div>
            </div>

            {/* 否 → 尺脉弱？ → 上盛下虚／平和 */}
            <div className={`pr-triad-branch ${!bianmai ? 'is-taken' : 'is-off'}`}>
              <span className="pr-triad-branch-line">
                <BranchTag text="否" />
                <span className="pr-triad-branch-conn">→</span>
              </span>

              <div className={`pr-triad-node is-decision is-${chimaiState}`}>
                <span className="pr-triad-node-label">尺脉弱？</span>
                {!chimaiReached && <span className="pr-triad-node-note">有变脉时不到这一步</span>}
                {chimai && (
                  <button
                    type="button"
                    className="pr-triad-hit"
                    onClick={() => onFocusCells?.(chimai.cells)}
                    title="定位到命中的格子"
                  >
                    已命中 {chimai.cells.length} 处
                  </button>
                )}
              </div>

              <div className="pr-triad-subbranches">
                <div className={`pr-triad-branch is-inner ${constitution === '上盛下虚' ? 'is-taken' : 'is-off'}`}>
                  <span className="pr-triad-branch-line">
                    <BranchTag text="是" />
                    <span className="pr-triad-branch-conn">→</span>
                  </span>
                  <div className={`pr-triad-node is-constitution ${constState('上盛下虚')}`}>
                    <span className="pr-triad-node-label">上盛下虚体质</span>
                    <span className="pr-triad-node-note">状态：{STATE_HINTS[1].text}</span>
                    <span className="pr-triad-node-src">〔讲义 2026-10·p47（开方三部曲图）〕</span>
                  </div>
                </div>

                <div className={`pr-triad-branch is-inner ${constitution === '平和' ? 'is-taken' : 'is-off'}`}>
                  <span className="pr-triad-branch-line">
                    <BranchTag text="否" />
                    <span className="pr-triad-branch-conn">→</span>
                  </span>
                  <div className={`pr-triad-node is-constitution ${constState('平和')}`}>
                    <span className="pr-triad-node-label">平和体质</span>
                    <span className="pr-triad-node-src">〔讲义 2026-10·p47（开方三部曲图）〕</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---- ②定疗法 ---- */}
      <div className="pr-triad-stage is-therapy">
        <StageHead title={TRIAD_STAGES[1].title} note={TRIAD_STAGES[1].note} />
        <div className="pr-triad-therapies">
          {(['三焦疗法', '一体疗法', '五脏疗法'] as const).map((t) => (
            <div key={t} className={`pr-triad-node is-therapy ${therapyState(t)}`}>
              <span className="pr-triad-node-label">{t}</span>
              <span className="pr-triad-node-src">〔讲义 2026-10·p47（开方三部曲图）〕</span>
            </div>
          ))}
        </div>
      </div>

      {/* ---- ③开方药 ---- */}
      <div className="pr-triad-stage is-prescribe">
        <StageHead title={TRIAD_STAGES[2].title} note={TRIAD_STAGES[2].note} />
        <ul className="pr-triad-rx-list">
          {prescriptions.length > 0 ? (
            prescriptions.map((rx) => <RxCard key={`${rx.no}-${rx.name}`} rx={rx} />)
          ) : (
            <li className="pr-triad-rx-empty">录入脉象后按图上判据标示</li>
          )}
        </ul>
        <p className="pr-flow-loop">
          <span className="pr-flow-loop-arrow">⟲</span>
          ③ 之后回到 ① 重判（讲义 p47 图上的虚线回路）
        </p>
      </div>

      {/* ---- 判据来源 ---- */}
      {cells.length > 0 && (
        <p className="pr-triad-basis">
          本次判据取自：
          {cells.map((c) => {
            const [hand, organ, depth] = c.split('|')
            return (
              <button
                key={c}
                type="button"
                className="pr-triad-basis-cell"
                onClick={() => onFocusCells?.([c])}
              >
                {hand === 'L' ? '左' : '右'}
                {organ}
                {depth}
              </button>
            )
          })}
        </p>
      )}
      <p className="pr-triad-hint">
        命中只表示「本次录到的脉象符合该判据」，不等于诊断结论；路径最终由使用者判定。
      </p>
    </section>
  )
}
