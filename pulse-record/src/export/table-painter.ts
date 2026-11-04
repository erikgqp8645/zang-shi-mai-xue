import type { RecordSet } from '../domain/types'
import { cellKey } from '../domain/types'
import { groupRows } from '../domain/layout'
import { formatCodes, buildCustomLegend, collectUsedCodes, type CustomSymbol } from '../domain/symbols'
import type { PainterCtx } from './canvas'

/**
 * 记录表的 canvas 绘制 —— **纯函数，不碰 DOM**
 *
 * 这一份是网站与小程序**共用**的：网站用 `export/png.ts`（浏览器 canvas），
 * 小程序用它自己的 canvas 节点，两边画出来的是同一张图。
 *
 * 色值取自讲义 PDF p34 实例表（1872×3188 扫描页，实例表实测取色）：
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
/** 表格与图示之间的留白 */
export const DIAGRAM_GAP = 24

/** 版式计算结果 —— 表格与图示的位置都由它决定，两端共用 */
export interface TableLayout {
  /** 画布总宽 */
  canvasW: number
  /** 画布总高 */
  height: number
  /** 表格本体宽 */
  tableW: number
  /** 表格本体在画布上的横向偏移（居中时非零） */
  tableDx: number
  /** 表格本体高 */
  tableH: number
  /** 自定义符号图例条高（没有图例时为 0） */
  legendH: number
  /** 寸关尺图示左上角的 y 坐标（不画图示时为 0） */
  diagramDy: number
  /** 标签区（部位列 + 取法列）总宽 */
  labelW: number
  /** 正文行数 */
  rowCount: number
  /** 数据列数（左＋右 各一列） */
  dataCols: number
}

/**
 * 算版式（只算不画）。
 *
 * 分两步走，与网站原来的做法一致：
 *   1) 先算表格本体（`planTable`）—— 拿到 tableW
 *   2) 再用 tableW 去算寸关尺图示的尺寸（domain/diagram.ts 的 planDiagram）
 *   3) 把图示尺寸回填（`withDiagram`），得到最终画布大小
 *
 * 这样图示的宽高由 domain/diagram.ts 一处决定，两端（网站／小程序）算出来的完全一样。
 */
export function planTable(set: RecordSet, customSymbols: CustomSymbol[] = []): TableLayout {
  const groups = groupRows(set.layout)
  const rowCount = groups.reduce((n, g) => n + g.rows.length, 0)
  const dataCols = set.sessions.length * 2

  const legend = buildCustomLegend(customSymbols, collectUsedCodes(set.sessions))

  const labelW = ORGAN_W + DEPTH_W
  const tableW = labelW + dataCols * DATA_W
  const tableH = HEAD_H * 2 + rowCount * ROW_H
  const legendH = legend.length > 0 ? LEGEND_H : 0

  return {
    canvasW: tableW,
    height: tableH + legendH,
    tableW,
    tableDx: 0,
    tableH,
    legendH,
    diagramDy: 0,
    labelW,
    rowCount,
    dataCols,
  }
}

/**
 * 把寸关尺图示的尺寸回填进版式，算出最终画布。
 *
 * 画布宽度取「表格宽」与「图示宽」的较大者 —— 表格太窄时宁可画布宽一点，
 * 也不把符号缩到看不清。
 */
export function withDiagram(
  layout: TableLayout,
  diagram: { w: number; h: number },
): TableLayout {
  const canvasW = Math.max(layout.tableW, diagram.w)
  return {
    ...layout,
    canvasW,
    height: layout.tableH + layout.legendH + DIAGRAM_GAP + diagram.h,
    tableDx: (canvasW - layout.tableW) / 2,
    diagramDy: layout.tableH + layout.legendH + DIAGRAM_GAP,
  }
}

/**
 * 把记录表画到 ctx 上（只画表格本体 ＋ 自定义符号图例条，不含寸关尺图示）。
 *
 * 图示由调用方在表格下方接着画（坐标取自 domain/diagram.ts）。
 */
export function paintTable(
  ctx: PainterCtx,
  set: RecordSet,
  customSymbols: CustomSymbol[],
  layout: TableLayout,
): void {
  const groups = groupRows(set.layout)
  const { labelW, tableW: width, tableH, legendH } = layout
  const bodyY0 = HEAD_H * 2

  /** 图例：自定义符号表 ＋ 记录里用到但已从符号表删掉的代码 */
  const legend = buildCustomLegend(customSymbols, collectUsedCodes(set.sessions))

  // ---- 底色 ----
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, layout.canvasW, layout.height)

  // 表格本体整体平移（画布比表格宽时居中）
  ctx.save()
  ctx.translate(layout.tableDx, 0)

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

  /**
   * 量文字：放得下就用最大字号；放不下先缩字号，缩到最小仍放不下则截断加省略号。
   * 姓名格只有「部位 + 取法」两列宽，姓名字号须自适应，才不会溢出到「左」列或表格外。
   */
  const fitText = (s: string, maxW: number, maxSize: number, minSize = 11) => {
    if (!s) return { s, size: maxSize }
    ctx.font = `${maxSize}px ${FONT_LABEL}`
    if (ctx.measureText(s).width <= maxW) return { s, size: maxSize }
    for (let size = maxSize - 1; size > minSize; size--) {
      ctx.font = `${size}px ${FONT_LABEL}`
      if (ctx.measureText(s).width <= maxW) return { s, size }
    }
    ctx.font = `${minSize}px ${FONT_LABEL}`
    let out = s
    while (out.length > 1 && ctx.measureText(`${out}…`).width > maxW) {
      out = out.slice(0, -1)
    }
    return { s: `${out}…`, size: minSize }
  }

  // 姓名（在表头第二行，横跨部位列 + 取法列）——字号随姓名格宽度自适应
  const nameFit = fitText(set.name || '', labelW - 8, 24)
  text(nameFit.s, labelW / 2, HEAD_H * 1.5, nameFit.size, FONT_LABEL)

  // 日期组（横跨左右两列）+ 左 / 右
  set.sessions.forEach((s, i) => {
    // 日期标签居中于「左 + 右」合并组（两列宽），六位年月日如 261102 亦放得下
    const labelFit = fitText(s.label, DATA_W * 2 - 8, 21)
    text(labelFit.s, labelW + (i * 2 + 1) * DATA_W, HEAD_H / 2, labelFit.size, FONT_LABEL)
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

  // 表格画完，撤掉居中平移
  ctx.restore()
}
