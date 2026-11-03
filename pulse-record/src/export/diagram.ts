import type { RecordSet, Session } from '../domain/types'
import { cellKey } from '../domain/types'
import { formatCodes } from '../domain/symbols'
import {
  BADGE_H,
  GROUP_STEP,
  IMG_H,
  IMG_W,
  MARKS,
  RIGHT_DOT_X,
  badgeWidth,
  markDepths,
  markX,
} from '../domain/diagram'

/**
 * 寸关尺图示（PNG 导出用）—— 与页面上的 SVG 覆盖层画同一张图，共用 domain/diagram.ts 的坐标。
 *
 * 页面用 SVG 叠在原图上；导出时把原图 drawImage 到 canvas，再用同样的坐标画标记块，
 * 两边画出来必须一致（坐标一律取自 domain/diagram.ts，不在导出里另写一套）。
 */

/** 位置字与符号用宋体；取法字沿用页面无衬线 */
const FONT_POS = "'Songti SC','STSong',serif"
const FONT_UI = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"

/** 底图（双手掌面原图）只载入一次，缓存住 */
let handsImage: HTMLImageElement | null = null
let handsLoading: Promise<HTMLImageElement> | null = null

/** 载入底图（Vite 打包后是带 hash 的 URL，同一 URL 只载一次） */
export function loadHandsImage(url: string): Promise<HTMLImageElement> {
  if (handsImage) return Promise.resolve(handsImage)
  if (!handsLoading) {
    handsLoading = new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        handsImage = img
        resolve(img)
      }
      img.onerror = () => reject(new Error('寸关尺底图载入失败'))
      img.src = url
    })
  }
  return handsLoading
}

/** 图示在导出画布上的摆放 */
export interface DiagramPlan {
  image: HTMLImageElement
  /** 缩放比（相对原图像素） */
  scale: number
  /** 图示左上角在画布上的位置 */
  dx: number
  dy: number
  w: number
  h: number
}

/**
 * 算图示怎么摆：宽度跟表格走（表格越宽图示越大），但不放大超过原图尺寸；
 * 表格太窄时图示保底 0.5 倍，宁可画布比表格宽一点，也不把符号缩到看不清。
 */
export function planDiagram(image: HTMLImageElement, tableWidth: number): DiagramPlan {
  let scale = tableWidth / IMG_W
  if (scale < 0.5) scale = 0.5
  if (scale > 1) scale = 1
  const w = IMG_W * scale
  const h = IMG_H * scale
  const canvasW = Math.max(tableWidth, w)
  return {
    image,
    scale,
    dx: (canvasW - w) / 2,
    dy: 0,
    w,
    h,
  }
}

/** 圆角矩形（老浏览器没有 roundRect 时退回直角） */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
    return
  }
  ctx.beginPath()
  ctx.rect(x, y, w, h)
}

/**
 * 在 ctx 上画图示（ctx 的坐标系已按 plan.scale 平移缩放过，即原图像素坐标系）
 */
export function drawDiagram(
  ctx: CanvasRenderingContext2D,
  plan: DiagramPlan,
  set: RecordSet,
  session: Session | null,
) {
  ctx.save()
  ctx.translate(plan.dx, plan.dy)
  ctx.scale(plan.scale, plan.scale)

  // 底图
  ctx.drawImage(plan.image, 0, 0, IMG_W, IMG_H)

  ctx.textBaseline = 'alphabetic'

  for (const m of MARKS) {
    const depths = markDepths(set.layout, m.organ)
    const x0 = markX(m.hand)
    const y0 = m.y - BADGE_H / 2
    const bw = badgeWidth(depths.length)

    // 右手侧：虚线引到腕上的圆点
    if (m.hand === 'R') {
      ctx.save()
      ctx.strokeStyle = '#2c2925'
      ctx.lineWidth = 1.4
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.moveTo(x0 + bw, m.y)
      ctx.lineTo(RIGHT_DOT_X, m.y)
      ctx.stroke()
      ctx.restore()
    }

    // 标记块底
    ctx.save()
    ctx.fillStyle = 'rgba(255,255,255,0.96)'
    roundRect(ctx, x0, y0, bw, BADGE_H, 3)
    ctx.fill()
    ctx.strokeStyle = '#2c2925'
    ctx.lineWidth = 1.2
    ctx.stroke()
    ctx.restore()

    // 位置字（寸/关/尺）：放在标记块左端，紧挨原图的圆点
    ctx.save()
    ctx.font = `22px ${FONT_POS}`
    ctx.textAlign = 'center'
    ctx.fillStyle = '#2c2925'
    ctx.fillText(m.organ, x0 + 15, m.y + 8)
    ctx.restore()

    // 位置字与取法之间的细分隔线
    ctx.save()
    ctx.strokeStyle = '#e6e2d6'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x0 + 30, y0 + 6)
    ctx.lineTo(x0 + 30, y0 + BADGE_H - 6)
    ctx.stroke()
    ctx.restore()

    // 浮/中/沉 横排
    depths.forEach((d, i) => {
      const codes = session?.values[cellKey(m.hand, m.organ, d)] ?? []
      const text = formatCodes(codes)
      const gx = x0 + 36 + i * GROUP_STEP

      ctx.save()
      ctx.font = `13.5px ${FONT_UI}`
      ctx.textAlign = 'left'
      ctx.fillStyle = '#7c8974'
      ctx.fillText(d, gx, m.y + 7)
      ctx.restore()

      ctx.save()
      ctx.font = `bold 17px ${FONT_POS}`
      ctx.textAlign = 'left'
      ctx.fillStyle = text ? '#2c2925' : '#cfcabb'
      ctx.fillText(text || '—', gx + 17, m.y + 8)
      ctx.restore()
    })
  }

  ctx.restore()
}
