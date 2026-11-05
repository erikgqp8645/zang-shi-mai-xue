/**
 * 画布上下文 —— 网站与小程序**共用**的最小结构类型
 *
 * 浏览器的 `CanvasRenderingContext2D` 与小程序的 canvas 2d 上下文
 * （`wx.createSelectorQuery().select('#x').fields({node:true,size:true})` 取到的 `ctx`）
 * 在下面这些方法上是一致的，所以用**结构类型**描述，**同一份绘制代码两端通用**。
 *
 * 为什么不用 `CanvasRenderingContext2D`：
 *   那是 DOM 专属类型，小程序侧没有；共享包若依赖它，老机型与小程序都编不过。
 *
 * 只列**实际用到**的方法 —— 少写一个方法，每个平台就少一处不兼容。
 *
 * 2026-11-05 补 `quadraticCurveTo` / `closePath`：微信的 canvas 2d 把 `roundRect`
 * 的半径按**序列**收（传数字直接抛错），`src/export/diagram.ts` 于是改用手写圆角路径兜底，
 * 这两个方法是那条路径要用的。
 */
export type PainterCtx = {
  // ---- 状态 ----
  save(): void
  restore(): void
  translate(x: number, y: number): void
  scale(x: number, y: number): void

  // ---- 绘制 ----
  fillRect(x: number, y: number, w: number, h: number): void
  clearRect(x: number, y: number, w: number, h: number): void
  rect(x: number, y: number, w: number, h: number): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { width: number }
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void
  closePath(): void
  stroke(): void
  fill(): void
  setLineDash(segments: number[]): void
  /** 画底图；`image` 的类型两端不同（浏览器 Image / 小程序 canvas.createImage()），故用 unknown */
  drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void

  // ---- 样式 ----
  fillStyle: unknown
  strokeStyle: unknown
  lineWidth: number
  lineJoin: string
  font: string
  textAlign: string
  textBaseline: string
}
