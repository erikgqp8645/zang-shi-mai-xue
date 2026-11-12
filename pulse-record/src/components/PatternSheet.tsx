import type { Hand } from '../domain/types'
import { cellKey } from '../domain/types'
import { groupRows } from '../domain/layout'
import { termOf, type CellRequirement, type PulsePattern } from '../domain/pulse-pattern'

/**
 * 脉象图（条件示意表）—— **只读**渲染
 *
 * 画法与主记录表同一套体例（讲义 p34）：部位列橙色、合并成组、组界 1.6px 更粗，
 * 表头「左 / 右」两列。区别只有一处：主表横轴是**日期组**，这里横轴只有一对左右手。
 *
 * ## 格里显示什么
 *
 * 老数据存的是**术语**（`term`，如「大或顶」），术语再展开成一组允许的符号；
 * 图上显示该术语的代表符号（`PATTERN_TERMS[term].display`），完整符号集放在 `title` 里。
 * 手填的新数据直接存符号（`codes`），显示时原样拼起来。
 *
 * ⚠️ 一格显示 `++` 不等于「只能填 ++」。它是「这一格要求有力」的代表符号，
 *    可能是 `++/±±/+++/++++/↑` 中的任一个 —— 悬停能看到完整集合。
 *    这条不写清楚，读者会拿 `++` 当标准答案去比对记录。
 *
 * ## AND 组
 *
 * 20 条数据有多个 AND 组（组内「且」、组间「或」）。这种**不在格子里画组号角标** ——
 * 角标是程序自己加的（资料原图上没有），而且跟脉象符号挤在一格里分不清：
 * `0²` 看着像「另一种脉象」，空格中央飘一个 `1` 更莫名其妙。
 * 组信息改由 `groupLegend()` 出一行文字，在图下方列明「哪几格属于哪一组」。
 */

const HANDS: Hand[] = ['L', 'R']
const HAND_LABEL: Record<Hand, string> = { L: '左', R: '右' }

/** 一格显示什么：手填符号优先；老数据按术语取代表符号 */
export function requirementText(req: CellRequirement): string {
  if (req.codes && req.codes.length > 0) return req.codes.join('')
  const t = termOf(req.term)
  return t ? t.display : req.term
}

/** 悬停说明：术语原字 ＋ 允许的符号集 ＋ 该格备注 */
function requirementTitle(req: CellRequirement, hand: Hand, organ: string, depth: string): string {
  const head = `${HAND_LABEL[hand]}${organ}${depth}`
  if (req.codes && req.codes.length > 0) {
    return `${head}：${req.codes.join(' / ')}`
  }
  const t = termOf(req.term)
  if (!t) return `${head}：${req.term}`
  const allowed = t.also && t.also.length ? `${t.codes.join(' / ')} ＋ ${t.also.join(' / ')}` : t.codes.join(' / ')
  const lines = [`${head}：原文用字「${req.term}」`, `允许：${allowed}`]
  if (t.note) lines.push(t.note)
  if (req.note) lines.push(req.note)
  if (req.flex) lines.push('（柔性格：还要配合关系型要求才成立）')
  return lines.join('\n')
}

interface Props {
  pattern: PulsePattern
  /** 缩略模式：字号与列宽收窄，用于卡片里那一排小图 */
  compact?: boolean
}

export function PatternSheet({ pattern, compact }: Props) {
  const layout = pattern.layout ?? 'nine'
  const groups = groupRows(layout)

  // 格键 → 要求（数据里没有重复格，见 pulse-patterns 的校验）
  const byCell = new Map<string, CellRequirement>()
  for (const c of pattern.cells) byCell.set(c.cell, c)

  // 关系型条目没有格位 —— 由 PatternStrip 渲染成注记卡，这里不出空表
  if (pattern.cells.length === 0) return null

  return (
    <table className={`pr-psheet${compact ? ' is-compact' : ''}`}>
      <thead>
        <tr>
          <th className="pr-ps-corner" colSpan={2}>
            {compact ? '·' : '部位·取法'}
          </th>
          {HANDS.map((h) => (
            <th key={h} className={h === 'R' ? 'pr-ps-end' : undefined}>
              {HAND_LABEL[h]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map((g, gi) =>
          g.rows.map((row, ri) => (
            <tr key={`${g.organ}-${row.depth}`}>
              {ri === 0 && (
                <th
                  className={`pr-ps-organ${gi > 0 ? ' pr-ps-group-start' : ''}`}
                  rowSpan={g.rows.length}
                >
                  {g.organ}
                </th>
              )}
              <th className="pr-ps-depth">{row.depth}</th>
              {HANDS.map((hand) => {
                const key = cellKey(hand, row.organ, row.depth)
                const req = byCell.get(key)
                return (
                  <td
                    key={hand}
                    className={`pr-ps-cell${req ? ' is-set' : ''}${
                      hand === 'R' ? ' pr-ps-end' : ''
                    }`}
                    title={req ? requirementTitle(req, hand, row.organ, row.depth) : undefined}
                  >
                    {req ? requirementText(req) : ''}
                  </td>
                )
              })}
            </tr>
          )),
        )}
      </tbody>
    </table>
  )
}

/** 这张图有没有格位（false ＝ 只有关系型要求，要画注记卡） */
export function hasCells(pattern: PulsePattern): boolean {
  return pattern.cells.length > 0
}
