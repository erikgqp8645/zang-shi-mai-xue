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
   * 画到 canvas 上。
   *
   * 尺寸一律由共享包算（planTable / withDiagram），不另写一套 ——
   * 两端出来的图才能一模一样。
   */
  renderCanvas() {
    const set = this.buildSet()
    if (!set.sessions.length) return

    let layout = planTable(set, this.data.customSymbols)
    const session = set.sessions[0]

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

        // 先按表格本体的尺寸建一次画布，再按最终尺寸（含图示）重建 —— 与网站同一顺序
        const dpr = wx.getSystemInfoSync().pixelRatio || 2

        const paint = (plan, diagramPlan) => {
          canvas.width = plan.canvasW * dpr
          canvas.height = plan.height * dpr
          ctx.scale(dpr, dpr)
          ctx.clearRect(0, 0, plan.canvasW, plan.height)
          paintTable(ctx, set, this.data.customSymbols, plan)
          if (diagramPlan) drawDiagram(ctx, diagramPlan, set, session)
          this.setData({ canvasW: plan.canvasW, canvasH: plan.height })
        }

        // 底图（小程序用 canvas.createImage 载入本地资源）
        const img = canvas.createImage ? canvas.createImage() : null
        if (!img) {
          paint(layout, null)
          this.exportReady()
          return
        }
        img.onload = () => {
          const dp = planDiagram({ width: IMG_W, height: IMG_H }, layout.tableW)
          layout = withDiagram(layout, { w: dp.w, h: dp.h })
          paint(layout, Object.assign({}, dp, { dy: layout.diagramDy }))
          this.exportReady()
        }
        img.onerror = () => {
          // 底图没载入出来也把表画上（表格本身不依赖底图）
          paint(layout, null)
          this.exportReady()
        }
        img.src = '/assets/hands-pulse.png'
      })
  },

  /** 出图完成后记下临时文件，供「存相册 / 转发」用 */
  exportReady() {
    const canvas = this.canvasNode
    if (!canvas) return
    wx.canvasToTempFilePath({
      canvas,
      fileType: 'png',
      success: (res) => this.setData({ tempFilePath: res.tempFilePath }),
      fail: () => {},
    })
  },

  /** 存相册 */
  saveImage() {
    const p = this.data.tempFilePath
    if (!p) {
      wx.showToast({ title: '图还没生成，稍等一下', icon: 'none' })
      return
    }
    wx.saveImageToPhotosAlbum({
      filePath: p,
      success: () => wx.showToast({ title: '已存到相册', icon: 'success' }),
      fail: () => {
        wx.showModal({
          title: '需要相册权限',
          content: '去设置里允许「保存到相册」后再试。',
          confirmText: '去设置',
          success: (r) => {
            if (r.confirm) wx.openSetting({})
          },
        })
      },
    })
  },

  /** 转发（分享卡片，图片路径传出去） */
  share() {
    const p = this.data.tempFilePath
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] })
    if (p) {
      wx.showToast({ title: '点右上角「···」转发', icon: 'none' })
    }
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
