/**
 * 病例详情 ＋ 出图 —— 对应网站的病例详情与「导出 PNG / Markdown / CSV」
 *
 * 出图走**共享包**里网站同一份绘制代码（`export/table-painter.ts` ＋ `export/diagram.ts`），
 * 所以小程序存到相册的图与网站导出的图**版式完全一致**（同一套绘制代码，不是照着画一遍）。
 *
 * 小程序不能下载文件 → 改成：
 *   PNG  → canvas 出图 → 存相册 / 转发
 *   文字 → 复制到剪贴板（Markdown / CSV）
 */

const data = require('../../utils/data.js')
const { planTable, withDiagram, paintTable } = require('../../utils/core/export/table-painter.js')
const { planDiagram, drawDiagram } = require('../../utils/core/export/diagram.js')
const { IMG_W, IMG_H } = require('../../utils/core/domain/diagram.js')
const { toMarkdown, toCsv } = require('../../utils/core/export/text.js')
const { formatCodes } = require('../../utils/core/domain/symbols.js')

/** 导出用像素倍率 —— 与网站 src/export/png.ts 相同（2），两端导出的 PNG 尺寸一致 */
const EXPORT_DPR = 2

/** 时间戳 → 本地可读文本 */
function formatAt(at) {
  const d = new Date(at)
  const p = (n) => String(n).padStart(2, '0')
  return (
    d.getFullYear() +
    '-' +
    p(d.getMonth() + 1) +
    '-' +
    p(d.getDate()) +
    ' ' +
    p(d.getHours()) +
    ':' +
    p(d.getMinutes())
  )
}

Page({
  data: {
    patientId: '',
    name: '',
    layout: 'nine',
    visits: [],
    medications: [],
    customSymbols: [],
    /** 画布尺寸（rpx 换算后的逻辑尺寸，与共享包算出的版式一致） */
    canvasW: 0,
    canvasH: 0,
    busy: false,
    error: '',
    tempFilePath: '',
  },

  onLoad(options) {
    const patientId = (options && options.patientId) || ''
    this.setData({ patientId })
    this.load()
  },

  onShow() {
    // 从「录入编辑」返回时，体例可能已经被改过（那边是**切换即落库**）——
    // 这里重新拉一次，记录表画的行数才跟录入页对得上。
    if (this._shown && this.data.patientId) {
      this.load()
    }
    this._shown = true
  },

  async load() {
    try {
      const [patient, customSymbols] = await Promise.all([
        data.getPatient(this.data.patientId),
        data.listCustomSymbols(),
      ])
      if (!patient) {
        this.setData({ error: '没有这位患者的记录' })
        return
      }
      const medications = await data.listMedication(this.data.patientId)
      const visits = (patient.visits || []).map((v) =>
        Object.assign({}, v, { atText: formatAt(v.at) }),
      )
      this.setData({
        name: patient.name || '',
        layout: patient.layout === 'seven' ? 'seven' : 'nine',
        visits,
        medications,
        customSymbols,
      })
      this.renderCanvas()
    } catch (e) {
      this.setData({ error: (e && e.message) || '读取失败' })
    }
  },

  /** 组一份绘制用的 RecordSet（与网站同一形状） */
  buildSet() {
    return {
      name: this.data.name,
      layout: this.data.layout,
      sessions: this.data.visits.map((v) => ({
        id: v.id,
        label: v.label,
        values: v.values || {},
      })),
    }
  },

  /**
   * 画到**页面上的** canvas —— 只画表格，不带寸关尺图示。
   *
   * 为什么页面不画图示：底图只有 1070×876，塞进表格宽的画布里会被放大
   * （手机 dpr＝3 时放大 1.8 倍），又宽过手机屏，看着是一张糊掉的大手。
   * 所以页面默认不显示它；要看的时候点「寸关尺图示」，单独一个窗体打开
   * （系统图片预览，可双指缩放）。
   *
   * 导出到相册／转发的图**仍然带图示** —— 与网站导出同一份绘制代码、同一 dpr。
   */
  renderCanvas() {
    const set = this.buildSet()
    if (!set.sessions.length) return

    // planTable 不带图示：canvasW＝表宽，height＝表高＋自定义符号图例高
    const layout = planTable(set, this.data.customSymbols)

    const query = wx.createSelectorQuery()
    query
      .select('#pulse-canvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        const info = res && res[0]
        if (!info || !info.node) {
          this.setData({ error: '画布没拿到（canvas 节点不可用）' })
          return
        }
        const canvas = info.node
        const ctx = canvas.getContext('2d')
        this.canvasNode = canvas

        const dpr = (wx.getDeviceInfo && wx.getDeviceInfo().pixelRatio) || 2
        canvas.width = layout.canvasW * dpr
        canvas.height = layout.height * dpr
        ctx.scale(dpr, dpr)
        ctx.clearRect(0, 0, layout.canvasW, layout.height)
        paintTable(ctx, set, this.data.customSymbols, layout)
        this.setData({ canvasW: layout.canvasW, canvasH: layout.height })
      })
  },

  /** 取离屏画布节点（只取一次）—— 离屏画布不显示，只用来出图 */
  getOffCanvas() {
    if (this._offCanvas) return Promise.resolve(this._offCanvas)
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .select('#pulse-off-canvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const info = res && res[0]
          if (!info || !info.node) {
            reject(new Error('离屏画布没拿到'))
            return
          }
          this._offCanvas = info.node
          resolve(info.node)
        })
    })
  },

  /**
   * 出「表格 ＋ 寸关尺图示」的图（存相册／转发用）。
   *
   * 与网站 src/export/png.ts 同一套绘制代码、同一 dpr＝2 → 两端导出的 PNG 尺寸一致。
   */
  async renderExportImage() {
    const set = this.buildSet()
    if (!set.sessions.length) throw new Error('还没有记录')
    const session = set.sessions[0]
    const canvas = await this.getOffCanvas()
    const ctx = canvas.getContext('2d')

    let layout = planTable(set, this.data.customSymbols)

    // 底图（小程序用 canvas.createImage 载入本地资源）
    const img = canvas.createImage ? canvas.createImage() : null
    if (!img) {
      this.paintExport(canvas, ctx, set, session, layout, null)
      return this.toTempFile(canvas)
    }
    await new Promise((resolve) => {
      img.onload = () => {
        // 底图对象必须**传进 plan** —— drawDiagram 会 ctx.drawImage(plan.image, …)。
        // 传尺寸占位对象（{width,height}）会直接抛 TypeError，表格和图示一个都画不出来。
        // 网站端 src/export/png.ts 用的是 loadHandsImage() 返回的真图片，两边同理。
        const dp = planDiagram(img, layout.tableW)
        layout = withDiagram(layout, { w: dp.w, h: dp.h })
        this.paintExport(canvas, ctx, set, session, layout, Object.assign({}, dp, { dy: layout.diagramDy }))
        resolve()
      }
      img.onerror = () => {
        // 底图没载入出来也把表画上（表格本身不依赖底图）
        this.paintExport(canvas, ctx, set, session, layout, null)
        resolve()
      }
      img.src = '/assets/hands-pulse.png'
    })
    return this.toTempFile(canvas)
  },

  paintExport(canvas, ctx, set, session, layout, diagramPlan) {
    canvas.width = layout.canvasW * EXPORT_DPR
    canvas.height = layout.height * EXPORT_DPR
    ctx.scale(EXPORT_DPR, EXPORT_DPR)
    ctx.clearRect(0, 0, layout.canvasW, layout.height)
    paintTable(ctx, set, this.data.customSymbols, layout)
    if (diagramPlan) drawDiagram(ctx, diagramPlan, set, session)
  },

  /**
   * 出「只有寸关尺图示」的图（预览用）。
   *
   * 按原图 1:1 画（scale＝1、画布＝原图像素）—— 不放大，所以不糊。
   */
  async renderDiagramImage() {
    const set = this.buildSet()
    if (!set.sessions.length) throw new Error('还没有记录')
    const session = set.sessions[0]
    const canvas = await this.getOffCanvas()
    const ctx = canvas.getContext('2d')

    const img = canvas.createImage ? canvas.createImage() : null
    if (!img) throw new Error('底图拿不到')
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = () => reject(new Error('底图没载入'))
      img.src = '/assets/hands-pulse.png'
    })

    // planDiagram(image, IMG_W) → scale＝1（不放大），画布就是原图像素
    const dp = planDiagram(img, IMG_W)
    canvas.width = IMG_W
    canvas.height = IMG_H
    ctx.clearRect(0, 0, IMG_W, IMG_H)
    drawDiagram(ctx, Object.assign({}, dp, { dy: 0 }), set, session)
    return this.toTempFile(canvas)
  },

  /** canvas → 临时文件 */
  toTempFile(canvas) {
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas,
        fileType: 'png',
        success: (res) => resolve(res.tempFilePath),
        fail: (err) => reject(new Error((err && err.errMsg) || '出图失败')),
      })
    })
  },

  /** 「寸关尺图示」—— 单独一个窗体看（系统图片预览，可双指缩放） */
  async showDiagram() {
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      const path = await this.renderDiagramImage()
      wx.previewImage({ urls: [path], current: path })
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '图示出不来', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  /**
   * 存相册 —— 导出图（表格＋寸关尺图示）现场出，再问相册权限。
   *
   * 页面上的画布只画表格（不带图示），所以要存的那张得单独出。
   */
  async saveImage() {
    if (this.data.busy) return
    this.setData({ busy: true })
    let p = ''
    try {
      p = await this.renderExportImage()
      this.setData({ tempFilePath: p })
    } catch (e) {
      this.setData({ busy: false })
      wx.showToast({ title: (e && e.message) || '图还没生成', icon: 'none' })
      return
    }
    this.setData({ busy: false })
    // 先看授权态：用户明确拒绝过就别白跑一趟，直接引导去设置页重新打开。
    // 没拒绝过（undefined）就直接调，第一次会由系统弹授权框。
    wx.getSetting({
      withAuthorization: true,
      success: (res) => {
        const granted = res.authSetting && res.authSetting['scope.writePhotosAlbum']
        if (granted === false) {
          this.showAlbumDenied()
          return
        }
        this.saveToAlbum(p)
      },
      fail: () => this.saveToAlbum(p),
    })
  },

  /** 真正写相册 */
  saveToAlbum(p) {
    wx.saveImageToPhotosAlbum({
      filePath: p,
      success: () => wx.showToast({ title: '已存到相册', icon: 'success' }),
      fail: (err) => {
        const msg = (err && err.errMsg) || ''
        if (/privacy permission is not authorized/i.test(msg)) {
          // 小程序后台《用户隐私保护指引》里没声明「相册（仅写入）」——
          // 这是开发者侧的配置缺失，用户在设置里也打不开，只能如实告知。
          wx.showModal({
            title: '暂时存不了',
            content: '这个小程序还没在后台声明「保存到相册」的使用说明，需要开发者补充后才能保存。',
            showCancel: false,
            confirmText: '知道了',
          })
          return
        }
        this.showAlbumDenied()
      },
    })
  },

  /** 用户拒绝过授权时的引导 */
  showAlbumDenied() {
    wx.showModal({
      title: '需要相册权限',
      content: '去设置里允许「保存到相册」后再试。',
      confirmText: '去设置',
      success: (r) => {
        if (r.confirm) wx.openSetting({})
      },
    })
  },

  /** 转发（分享卡片，图片路径传出去） */
  async share() {
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] })
    if (!this.data.tempFilePath) {
      try {
        this.setData({ tempFilePath: await this.renderExportImage() })
      } catch (e) {
        // 出不来也不拦着转发
      }
    }
    wx.showToast({ title: '点右上角「···」转发', icon: 'none' })
  },

  /** 复制 Markdown */
  copyMarkdown() {
    const set = this.buildSet()
    const md = toMarkdown(set, undefined, this.data.customSymbols, set.sessions[0] && set.sessions[0].id)
    wx.setClipboardData({
      data: md,
      success: () => wx.showToast({ title: 'Markdown 已复制', icon: 'success' }),
    })
  },

  /** 复制 CSV */
  copyCsv() {
    const csv = toCsv(this.buildSet())
    wx.setClipboardData({
      data: csv,
      success: () => wx.showToast({ title: 'CSV 已复制', icon: 'success' }),
    })
  },

  goRecord() {
    wx.navigateTo({
      url: '/pages/record/record?patientId=' + encodeURIComponent(this.data.patientId),
    })
  },

  goMedication() {
    wx.navigateTo({
      url: '/pages/medication/medication?patientId=' + encodeURIComponent(this.data.patientId),
    })
  },
})
