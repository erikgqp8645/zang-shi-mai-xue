import handsUrl from '../assets/hands-pulse.png'
import { cellKey, type Depth, type Hand, type Organ, type RecordSet } from '../domain/types'
import { depthsOf } from '../domain/layout'
import { formatCodes } from '../domain/symbols'
import type { CellRef } from './PulseTable'

/**
 * 寸关尺图示 —— 以「双手掌面 + 寸关尺标记」为模版，把当前日期的脉象符号标到对应位置上
 *
 * 模版图：原图 1070 × 876（已裁掉右侧边框），左「左 阴（血）」、右「右 阳（气）」，
 * 左手腕 心—寸 / 肝—关 / 肾（阴）—尺，右手腕 肺—寸 / 脾—关 / 肾（阳）—尺。
 * 标记坐标按原图像素量得（见 MARKS / BADGE），覆盖层与原图同一坐标系，缩放不跑位。
 *
 * 交互：
 * - 图上方一排日期 chip，点一下切换「当前日期」，图上符号随之变化（与主表同一份状态）
 * - 点图上某个「取法」行 → 选中主表对应格子（可接着用符号面板录入）
 */

/** 原图尺寸（裁掉右侧边框后的宽 × 高） */
const IMG_W = 1070
const IMG_H = 876

/** 标记块高度（原图像素） */
const BADGE_H = 34
/** 左手侧标记块左缘：压在原图「寸/关/尺」三字上（原字实测 x 268–294），用自己的位置字替掉 */
const LEFT_X = 266
/** 右手侧标记块左缘：原图右手侧没有「寸/关/尺」三字，自带一个位置字 */
const RIGHT_X = 580
/** 右手侧引线终点（原图圆点实测 x 823–835） */
const RIGHT_DOT_X = 823
/** 每个取法组（浮/中/沉）的横向步距 */
const GROUP_STEP = 54

interface Mark {
  hand: Hand
  organ: Organ
  /** 该位置的脏名（讲义 p30 脏位；肾分阴/阳） */
  organName: string
  /** 标记点在原图里的纵坐标（像素，实测：左字中心 725/768.5/812.5、右圆点 721/766/807） */
  y: number
}

/** 六个标记点 */
const MARKS: Mark[] = [
  { hand: 'L', organ: '寸', organName: '心', y: 723 },
  { hand: 'L', organ: '关', organName: '肝', y: 767 },
  { hand: 'L', organ: '尺', organName: '肾（阴）', y: 810 },
  { hand: 'R', organ: '寸', organName: '肺', y: 723 },
  { hand: 'R', organ: '关', organName: '脾', y: 767 },
  { hand: 'R', organ: '尺', organName: '肾（阳）', y: 810 },
]

interface Props {
  set: RecordSet
  /** 当前选中的日期（记录列）；null 表示没有 */
  activeSessionId: string | null
  /** 主表当前选中的格子 */
  selected: CellRef | null
  onSelect: (ref: CellRef) => void
  onSelectSession: (id: string) => void
}

export function PulseDiagram({ set, activeSessionId, selected, onSelect, onSelectSession }: Props) {
  const active = set.sessions.find((s) => s.id === activeSessionId) ?? null

  if (set.sessions.length === 0) {
    return (
      <section className="pr-diagram">
        <header className="pr-diagram-head">
          <h2>寸关尺图示</h2>
          <span className="pr-muted">还没有记录。先在工具条添加一次记录（日期），图上就会标出该日期的寸关尺脉象。</span>
        </header>
      </section>
    )
  }

  return (
    <section className="pr-diagram">
      <header className="pr-diagram-head">
        <h2>寸关尺图示</h2>
        <div className="pr-diagram-dates">
          {set.sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`pr-diagram-date${s.id === activeSessionId ? ' is-active' : ''}`}
              onClick={() => onSelectSession(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="pr-muted">
          {active ? `当前日期：${active.label}` : '未选日期'}
          {'　（点图上「浮/中/沉」可选中主表对应格子）'}
        </span>
      </header>

      <div className="pr-diagram-canvas">
        <img className="pr-diagram-img" src={handsUrl} alt="寸关尺位置示意：左手心肝肾、右手肺脾肾" />
        <svg
          className="pr-diagram-svg"
          viewBox={`0 0 ${IMG_W} ${IMG_H}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {MARKS.map((m) => {
            const depths = depthsOf(set.layout, m.organ)
            const x0 = m.hand === 'L' ? LEFT_X : RIGHT_X
            const y0 = m.y - BADGE_H / 2
            /** 标记块宽度按取法个数定，三档对齐 */
            const bw = 50 + (depths.length - 1) * GROUP_STEP + 42
            const isSel = (d: Depth) =>
              selected?.sessionId === activeSessionId &&
              selected.hand === m.hand &&
              selected.organ === m.organ &&
              selected.depth === d
            return (
              <g key={`${m.hand}-${m.organ}`}>
                {m.hand === 'R' && (
                  <line
                    x1={x0 + bw}
                    y1={m.y}
                    x2={RIGHT_DOT_X}
                    y2={m.y}
                    stroke="#2c2925"
                    strokeWidth={1.4}
                    strokeDasharray="5 4"
                  />
                )}
                <rect
                  x={x0}
                  y={y0}
                  width={bw}
                  height={BADGE_H}
                  rx={3}
                  fill="#ffffff"
                  fillOpacity={0.96}
                  stroke="#2c2925"
                  strokeWidth={1.2}
                />
                {/* 位置字：放在标记块左端，紧挨原图的圆点 */}
                <text
                  x={x0 + 15}
                  y={m.y + 8}
                  textAnchor="middle"
                  fontFamily="'Songti SC','STSong',serif"
                  fontSize={22}
                  fill="#2c2925"
                >
                  {m.organ}
                </text>
                <line
                  x1={x0 + 30}
                  y1={y0 + 6}
                  x2={x0 + 30}
                  y2={y0 + BADGE_H - 6}
                  stroke="#e6e2d6"
                  strokeWidth={1}
                />
                {/* 浮/中/沉 横排 */}
                {depths.map((d, i) => {
                  const codes = active?.values[cellKey(m.hand, m.organ, d)] ?? []
                  const text = formatCodes(codes)
                  const gx = x0 + 36 + i * GROUP_STEP
                  const sel = isSel(d)
                  return (
                    <g
                      key={d}
                      className="pr-diagram-row"
                      onClick={() =>
                        active && onSelect({ sessionId: active.id, hand: m.hand, organ: m.organ, depth: d })
                      }
                    >
                      <title>
                        {m.hand === 'L' ? '左' : '右'}
                        {m.organ} · {m.organName} · {d}取：{text || '（无）'}
                      </title>
                      <rect
                        x={gx - 4}
                        y={y0 + 3}
                        width={GROUP_STEP - 6}
                        height={BADGE_H - 6}
                        rx={2}
                        fill={sel ? '#2c2925' : 'transparent'}
                      />
                      <text x={gx} y={m.y + 7} fontSize={13.5} fill={sel ? '#cfcabb' : '#7c8974'}>
                        {d}
                      </text>
                      <text
                        x={gx + 17}
                        y={m.y + 8}
                        fontFamily="'Songti SC','STSong',serif"
                        fontSize={17}
                        fontWeight={700}
                        fill={sel ? '#fdfbf7' : text ? '#2c2925' : '#cfcabb'}
                      >
                        {text || '—'}
                      </text>
                    </g>
                  )
                })}
              </g>
            )
          })}
        </svg>
      </div>

      <p className="pr-muted pr-diagram-note">
        图为示意，位置按原图标注（左手 心·寸 / 肝·关 / 肾（阴）·尺；右手 肺·寸 / 脾·关 / 肾（阳）·尺）；
        标记块内按「浮／中／沉」横排该位置的符号，取自讲义 p33–34 符号集。点日期切换当前日期，点取法选中主表格子。
      </p>
    </section>
  )
}
