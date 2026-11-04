import type { RecordSet } from '../domain/types'
import type { CustomSymbol } from '../domain/symbols'
import handsUrl from '../assets/hands-pulse.png'
import { drawDiagram, planDiagram, type DiagramImage, type DiagramPlan } from './diagram'
import { paintTable, planTable, withDiagram, type TableLayout } from './table-painter'
import { downloadBlob } from './download'

/**
 * PNG 导出 —— 浏览器侧（DOM 驱动）
 *
 * 这一层只做三件事：**建 canvas** → **调共享绘制器** → **下载**。
 * 真正的绘制逻辑在 `export/table-painter.ts`（纯函数）与 `export/diagram.ts` 里，
 * 小程序用**同一份**绘制代码，只是 canvas 的取法不同。
 *
 * 色值与版式说明见 `export/table-painter.ts`（讲义 PDF p34 实例表实测取色与像素结构）。
 */

/** 导出选项 */
export interface PngExportOptions {
  /** 是否在表格下方拼上寸关尺图示 */
  diagram?: boolean
  /** 图示画哪一次记录的符号；不给则取第一个 */
  activeSessionId?: string | null
}

/**
 * 载入底图（Vite 打包后是带 hash 的 URL，同一 URL 只载一次）。
 *
 * 小程序侧改用 `canvas.createImage()` ＋ 本地路径，其余流程一致。
 */
let handsImage: DiagramImage | null = null
let handsLoading: Promise<DiagramImage> | null = null

export function loadHandsImage(url: string): Promise<DiagramImage> {
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

/**
 * 渲染成 canvas。
 *
 * 两步走（与原实现一致）：
 *   1) `planTable` 算表格本体版式
 *   2) 有图示时，用 `planDiagram` 算图示尺寸，再 `withDiagram` 回填得到最终画布大小
 */
export async function renderTableCanvas(
  set: RecordSet,
  customSymbols: CustomSymbol[] = [],
  options: PngExportOptions = {},
): Promise<HTMLCanvasElement> {
  let layout: TableLayout = planTable(set, customSymbols)

  /** 图示画哪一次记录 */
  const diagramSession =
    set.sessions.find((s) => s.id === options.activeSessionId) ?? set.sessions[0] ?? null

  let diagram: DiagramPlan | null = null
  if (options.diagram && diagramSession) {
    const image = await loadHandsImage(handsUrl)
    const plan = planDiagram(image, layout.tableW)
    layout = withDiagram(layout, { w: plan.w, h: plan.h })
    diagram = { ...plan, dy: layout.diagramDy }
  }

  const dpr = 2
  const canvas = document.createElement('canvas')
  canvas.width = layout.canvasW * dpr
  canvas.height = layout.height * dpr
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)

  paintTable(ctx, set, customSymbols, layout)

  // 寸关尺图示：接在表格下方，与页面上的 SVG 同一套坐标
  if (diagram) {
    drawDiagram(ctx, diagram, set, diagramSession)
  }

  return canvas
}

/** 触发 PNG 下载 */
export async function downloadPng(
  set: RecordSet,
  filename?: string,
  customSymbols: CustomSymbol[] = [],
  options: PngExportOptions = {},
) {
  const canvas = await renderTableCanvas(set, customSymbols, options)
  canvas.toBlob((blob) => {
    if (!blob) return
    // 桌面版走系统另存为对话框，Web 端走浏览器下载（见 src/export/download.ts）
    void downloadBlob(filename ?? `脉象记录表-${set.name || '未命名'}.png`, blob)
  }, 'image/png')
}
