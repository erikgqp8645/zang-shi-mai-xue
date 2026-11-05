import Taro from '@tarojs/taro'

import { IMG_H, IMG_W } from '@domain/diagram'
import type { RecordSet, Session } from '@domain/types'
import { drawDiagram, planDiagram } from '@export/diagram'
import { paintTable, planTable, withDiagram, type TableLayout } from '@export/table-painter'
import type { PainterCtx } from '@export/canvas'

/**
 * 平台适配层 · 画布出图
 *
 * ## 画的是哪一份代码
 *
 * **绘制逻辑不在这一层** —— 在 `src/export/table-painter.ts` 与 `src/export/diagram.ts`
 * （与网站端同一份源码，通过 alias `@export` 直接引）。这一层只管三件事：
 *
 *   1. 拿到画布节点
 *   2. 把共享绘制器接到画布上下文上
 *   3. canvas → 临时文件
 *
 * 所以两端导出的 PNG 尺寸一致（记录表 1272×1977 @dpr2；图示 1070×876 @scale1）。
 *
 * ## 鸿蒙降级
 *
 * 鸿蒙侧能否拿到 2D 画布节点**待验证**（P3 阶段实测）。
 * 若拿不到，这一层会抛错并带明确的降级提示 ——
 * 上层应当降级为「在页内显示 ＋ 让用户自行截图」，**不得让整个就诊流程不可用**。
 */

/** 导出倍率：与网站端一致（dpr 2） */
export const EXPORT_DPR = 2

/** 小程序侧的画布节点（type="2d"） */
export interface CanvasNode {
  width: number
  height: number
  getContext(type: '2d'): PainterCtx
  createImage?: () => CanvasImage
}

export interface CanvasImage {
  src: string
  width: number
  height: number
  onload: (() => void) | null
  onerror: (() => void) | null
}

/** 离屏画布的 selector —— 页面里要放一个 <canvas id="pulse-off-canvas" type="2d" /> */
export const OFF_CANVAS_ID = 'pulse-off-canvas'

/** 底图（寸关尺图示的原图）在小程序包里的路径 */
const HANDS_IMAGE = '/assets/hands-pulse.png'

/**
 * 取离屏画布节点（只取一次）—— 离屏画布不显示，只用来出图。
 *
 * 注意：出图画布要放在**独立容器**里，不要塞进 ScrollView ——
 * ScrollView 的 DOM 结构变化会让节点引用失效（见 docs/progress.md 的坑位记录）。
 */
export function getOffCanvas(selector = `#${OFF_CANVAS_ID}`): Promise<CanvasNode> {
  return new Promise((resolve, reject) => {
    try {
      Taro.createSelectorQuery()
        .select(selector)
        .fields({ node: true, size: true } as never)
        .exec((res) => {
          const info = res && (res as unknown[])[0] as { node?: CanvasNode } | undefined
          if (!info || !info.node) {
            reject(new Error('拿不到画布节点（本平台可能不支持 2D 画布，可降级为页内显示＋自行截图）'))
            return
          }
          resolve(info.node)
        })
    } catch (e) {
      reject(new Error(`画布不可用：${(e as Error)?.message || '未知原因'}`))
    }
  })
}

/** 载入底图（小程序用 canvas.createImage 载入本地资源） */
function loadImage(canvas: CanvasNode, src: string): Promise<CanvasImage | null> {
  const img = canvas.createImage ? canvas.createImage() : null
  if (!img) return Promise.resolve(null)
  return new Promise((resolve) => {
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** canvas → 临时文件 */
export function toTempFile(canvas: CanvasNode): Promise<string> {
  return new Promise((resolve, reject) => {
    Taro.canvasToTempFilePath({ canvas: canvas as never, fileType: 'png' })
      .then((res) => resolve(res.tempFilePath))
      .catch((err: unknown) => {
        reject(new Error((err as { errMsg?: string })?.errMsg || '出图失败'))
      })
  })
}

function paintExport(
  canvas: CanvasNode,
  ctx: PainterCtx,
  set: RecordSet,
  session: Session | null,
  layout: TableLayout,
  diagramPlan: ReturnType<typeof planDiagram> | null,
): void {
  canvas.width = layout.canvasW * EXPORT_DPR
  canvas.height = layout.height * EXPORT_DPR
  ctx.scale(EXPORT_DPR, EXPORT_DPR)
  ctx.clearRect(0, 0, layout.canvasW, layout.height)
  paintTable(ctx, set, [], layout)
  if (diagramPlan) drawDiagram(ctx, diagramPlan, set, session)
}

/**
 * 出「表格 ＋ 寸关尺图示」的图（存相册／转发用）。
 *
 * 与网站 src/export/png.ts 同一套绘制代码、同一 dpr＝2 → 两端导出的 PNG 尺寸一致。
 */
export async function renderExportImage(set: RecordSet): Promise<string> {
  if (!set.sessions.length) throw new Error('还没有记录')
  const session = set.sessions[0]
  const canvas = await getOffCanvas()
  const ctx = canvas.getContext('2d')

  let layout = planTable(set)

  const img = await loadImage(canvas, HANDS_IMAGE)
  if (!img) {
    // 底图没载入出来也把表画上（表格本身不依赖底图）
    paintExport(canvas, ctx, set, session, layout, null)
    return toTempFile(canvas)
  }

  // 底图对象必须**传进 plan** —— drawDiagram 会 ctx.drawImage(plan.image, …)。
  // 传尺寸占位对象（{width,height}）会直接抛 TypeError，表格和图示一个都画不出来。
  const dp = planDiagram(img, layout.tableW)
  layout = withDiagram(layout, { w: dp.w, h: dp.h })
  paintExport(canvas, ctx, set, session, layout, { ...dp, dy: layout.diagramDy })
  return toTempFile(canvas)
}

/**
 * 出「只有寸关尺图示」的图（预览用）。
 *
 * 按原图 1:1 画（scale＝1、画布＝原图像素）—— 不放大，所以不糊。
 */
export async function renderDiagramImage(set: RecordSet): Promise<string> {
  if (!set.sessions.length) throw new Error('还没有记录')
  const session = set.sessions[0]
  const canvas = await getOffCanvas()
  const ctx = canvas.getContext('2d')

  const img = await loadImage(canvas, HANDS_IMAGE)
  if (!img) throw new Error('底图没载入')
  img.onload = null
  img.onerror = null

  // planDiagram(image, IMG_W) → scale＝1（不放大），画布就是原图像素
  const dp = planDiagram(img, IMG_W)
  canvas.width = IMG_W
  canvas.height = IMG_H
  ctx.clearRect(0, 0, IMG_W, IMG_H)
  drawDiagram(ctx, { ...dp, dy: 0 }, set, session)
  return toTempFile(canvas)
}
