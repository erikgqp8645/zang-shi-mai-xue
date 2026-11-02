import type { RecordSet } from '../domain/types'
import { cellKey } from '../domain/types'
import { groupRows } from '../domain/layout'
import { formatCodes, buildCustomLegend, collectUsedCodes, type CustomSymbol } from '../domain/symbols'

/**
 * PNG 导出 —— 用 canvas 自绘，不依赖截图类库，色值与讲义原表一致。
 *
 * 取色自讲义 PDF p34 实例表（1872×3188 扫描页，实例表实测取色）：
 *   部位标签  #FFC000 (255,192,0)
 *   表格底色  #CCE8CF (204,232,207)
 *   网格线    #000000
 *
 * 版式照抄原表像素结构（实测坐标）：
 *   · 姓名格在表头第二行，横跨「部位 + 取法」两列，左缘与部位列对齐
 *   · 日期格横跨「左 + 右」两列，中间不画竖线（竖线只出现在表头第二行）
 *   · 部位列（橙）纵向合并一组三行，组内不画横线，组界画粗线并贯穿橙列
 *   · 取法列仅存在于正文，表头左侧无边框（姓名框上方留白）
 */

const FILL_CELL = '#CCE8CF'
const FILL_ORGAN = '#FFC000'
const LINE = '#000000'

const FONT_LABEL = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif'
const FONT_SYMBOL = '"Songti SC","STSong",serif'

/** 部位列宽（橙） */
const ORGAN_W = 54
/** 取法列宽 */
const DEPTH_W = 54
/** 单个「左 / 右」数据列宽 */
const DATA_W = 66
/** 表头单行高 */
const HEAD_H = 42
/** 正文行高 */
const ROW_H = 40
/** 自定义符号图例条高度（画在表格下方白底上，不动表格本体） */
const LEGEND_H = 34

export function renderTableCanvas(set: RecordSet, customSymbols: CustomSymbol[] = []): HTMLCanvasElement {
  const groups = groupRows(set.layout)
  const rowCount = groups.reduce((n, g) => n + g.rows.length, 0)
  const dataCols = set.sessions.length * 2

  /** 图例：自定义符号表 ＋ 记录里用到但已从符号表删掉的代码 */
  const legend = buildCustomLegend(customSymbols, collectUsedCodes(set.sessions))

  /** 标签区（部位列 + 取法列）总宽 */
  const labelW = ORGAN_W + DEPTH_W
  const width = labelW + dataCols * DATA_W
  /** 表格本体高度 */
  const tableH = HEAD_H * 2 + rowCount * ROW_H
  /** 自定义符号图例另占一条 */
  const legendH = legend.length > 0 ? LEGEND_H : 0
  const height = tableH + legendH
  const bodyY0 = HEAD_H * 2

  const dpr = 2
  const canvas = document.createElement('canvas')
  canvas.width = width * dpr
  canvas.height = height * dpr
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)

  // ---- 底色 ----
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = FILL_CELL
  ctx.fillRect(0, 0, width, tableH)

  // 部位标签列（橙，纵向合并整组）——压在底色之上
  let gy = bodyY0
  for (const g of groups) {
    ctx.fillStyle = FILL_ORGAN
    ctx.fillRect(0, gy, ORGAN_W, g.rows.length * ROW_H)
    gy += g.rows.length * ROW_H
  }

  // ---- 网格线 ----
  ctx.strokeStyle = LINE
  ctx.lineJoin = 'miter'

  const line = (x0: number, y0: number, x1: number, y1: number, w: number) => {
    ctx.lineWidth = w
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
  }

  // 外框：顶边贯穿全宽（含姓名区上方），左边自姓名格起
  line(0, 0, width, 0, 1.6)
  line(0, tableH, width, tableH, 1.6)
  line(width, 0, width, tableH, 1.6)
  line(0, HEAD_H, 0, tableH, 1.6)

  // 数据区左缘（贯穿表头与正文）
  line(labelW, 0, labelW, tableH, 1)

  // 部位列 | 取法列（仅正文）
  line(ORGAN_W, bodyY0, ORGAN_W, tableH, 1)

  // 姓名格：上边补齐（表头第一行的标签区留白，故姓名格自带上边）
  line(0, HEAD_H, labelW, HEAD_H, 1)

  // 表头第一行 | 第二行：仅数据区有线，标签区不画（姓名框自带上边）
  line(labelW, HEAD_H, width, HEAD_H, 1)

  // 表头第二行 | 正文：贯穿全宽
  line(0, bodyY0, width, bodyY0, 1.6)

  // 「左 | 右」分隔线：只在表头第二行，日期格不被劈开
  set.sessions.forEach((_, i) => {
    const x = labelW + (i * 2 + 1) * DATA_W
    line(x, HEAD_H, x, bodyY0, 1)
  })

  // 日期组之间：贯穿整列，粗线
  set.sessions.forEach((_, i) => {
    const x = labelW + (i * 2 + 2) * DATA_W
    line(x, 0, x, tableH, 1.6)
  })

  // 正文行线：组内从取法列起（不穿橙列），组界贯穿全宽
  let y = bodyY0
  for (const g of groups) {
    for (let i = 0; i < g.rows.length; i++) {
      y += ROW_H
      if (i < g.rows.length - 1) line(ORGAN_W, y, width, y, 1)
      else line(0, y, width, y, 1.6)
    }
  }

  // ---- 文字 ----
  const text = (s: string, cx: number, cy: number, size: number, family: string, color = '#000000') => {
    if (!s) return
    ctx.fillStyle = color
    ctx.font = `${size}px ${family}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(s, cx, cy)
  }

  // 姓名（在表头第二行，横跨部位列 + 取法列）
  text(set.name || '', labelW / 2, HEAD_H * 1.5, 24, FONT_LABEL)

  // 日期组（横跨左右两列）+ 左 / 右
  set.sessions.forEach((s, i) => {
    text(s.label, labelW + (i * 2 + 1) * DATA_W, HEAD_H / 2, 21, FONT_LABEL)
    text('左', labelW + i * 2 * DATA_W + DATA_W / 2, HEAD_H * 1.5, 20, FONT_LABEL)
    text('右', labelW + (i * 2 + 1) * DATA_W + DATA_W / 2, HEAD_H * 1.5, 20, FONT_LABEL)
  })

  // 部位 + 取法 + 数据
  y = bodyY0
  for (const g of groups) {
    const organCY = y + (g.rows.length * ROW_H) / 2
    text(g.organ, ORGAN_W / 2, organCY, 26, FONT_LABEL)

    g.rows.forEach((row, ri) => {
      const cy = y + ri * ROW_H + ROW_H / 2
      text(row.depth, ORGAN_W + DEPTH_W / 2, cy, 19, FONT_LABEL)

      set.sessions.forEach((s, si) => {
        for (const [hi, hand] of (['L', 'R'] as const).entries()) {
          const codes = s.values[cellKey(hand, row.organ, row.depth)] ?? []
          const cx = labelW + (si * 2 + hi) * DATA_W + DATA_W / 2
          if (codes.length === 0) continue
          text(formatCodes(codes), cx, cy, 21, FONT_SYMBOL)
        }
      })
    })
    y += g.rows.length * ROW_H
  }

  // 自定义符号图例：表下方白底一条，不动表格本体（讲义 p34 原表无图例）
  if (legend.length > 0) {
    ctx.fillStyle = '#000000'
    ctx.font = `15px ${FONT_LABEL}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(
      `自定义符号：${legend.map((s) => `${s.code}＝${s.name}`).join('　')}`,
      2,
      tableH + legendH / 2,
    )
  }

  return canvas
}

/** 触发 PNG 下载 */
export function downloadPng(set: RecordSet, filename?: string, customSymbols: CustomSymbol[] = []) {
  const canvas = renderTableCanvas(set, customSymbols)
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename ?? `脉象记录表-${set.name || '未命名'}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, 'image/png')
}
