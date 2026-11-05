/**
 * 病例详情 ＋ 出图 —— 对应网站的病例详情与「导出 PNG / Markdown / CSV」
 *
 * ## 记录表：与「录入记录」**同一个组件**
 *
 * 2026-11-05 的毛病：这里的「记录表」是 canvas 画的，录入页的「录入记录」是 WXML 画的，
 * 两套各画各的 —— 同一位患者在两个界面长得不一样（canvas 版没有表下「体质／（未判）」两行、也不能改）。
 * 现在两处都用 `components/record-sheet`：**版式与交互只有一份**，不可能再走偏。
 *
 * 这里**没有「保存」按钮** —— 改完立即落库（与「体例切换即落库」同一原则）。
 * 逐次就诊的改动走 `PATCH /api/visits/:id`，只写回被改动的那一次，不动该患者的其它次。
 *
 * ## 出图走**共享包**里网站同一份绘制代码
 *
 * （`export/table-painter.ts` ＋ `export/diagram.ts`），所以小程序存到相册的图与网站导出的图
 * **版式完全一致**（同一套绘制代码，不是照着画一遍）。
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

/** 两份格值是否一样（键序可能不同，按键排序后比） */
function sameValues(a, b) {
  const ka = Object.keys(a || {}).sort()
  const kb = Object.keys(b || {}).sort()
  if (ka.length !== kb.length) return false
  for (let i = 0; i < ka.length; i += 1) {
    if (ka[i] !== kb[i]) return false
    if (JSON.stringify(a[ka[i]]) !== JSON.stringify(b[kb[i]])) return false
  }
  return true
}

Page({
  data: {
    patientId: '',
    name: '',
    layout: 'nine',
    /** 每次就诊一次记录（record-sheet 组件的数据源） */
    sessions: [],
    /** 「每次就诊记录」列表用（带本地时间文本） */
    visits: [],
    medications: [],
    customSymbols: [],
    /** 当前列（点表头日期切换） */
    activeSessionId: '',
    /** 离屏画布的逻辑尺寸（与共享包算出的版式一致） */
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
    // 从「录入编辑」返回时，体例／记录可能已经被改过（那边是**切换即落库**）——
    // 这里重新拉一次，记录表画的行数与内容才跟录入页对得上。
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
      const sessions = (patient.visits || []).map((v) => ({
        id: v.id,
        label: v.label,
        at: v.at,
        values: v.values || {},
        constitution: v.constitution || null,
        therapy: v.therapy || null,
      }))
      this.setData({
        name: patient.name || '',
        layout: patient.layout === 'seven' ? 'seven' : 'nine',
        sessions,
        visits: sessions.map((v) => Object.assign({}, v, { atText: formatAt(v.at) })),
        medications,
        customSymbols,
      })
      // 落库前的快照 —— 用来判断「哪一次就诊被改了」
      this.snapshot = sessions.map((s) => ({
        id: s.id,
        values: s.values,
        constitution: s.constitution,
        therapy: s.therapy,
      }))
      this.syncCanvasSize()
    } catch (e) {
      this.setData({ error: (e && e.message) || '读取失败' })
    }
  },

  /** 离屏画布的显示尺寸（只影响画布在屏幕外的占位，出图尺寸另由 canvas.width/height 决定） */
  syncCanvasSize() {
    const set = this.buildSet()
    if (!set.sessions.length) return
    const layout = planTable(set, this.data.customSymbols)
    this.setData({ canvasW: layout.canvasW, canvasH: layout.height })
  },

  /* --------------------------- 组件回调 --------------------------- */

  /**
   * 组件里改了格值／体质／疗法 → **立即落库**（这一页没有「保存」按钮）。
   *
   * 只写回**被改动的那一次**就诊（PATCH /api/visits/:id），
   * 该患者其它次的记录、用药记录都不动 —— 与网站「单次编辑」语义一致。
   */
  async onSheetChange(e) {
    const sessions = (e.detail && e.detail.sessions) || []
    this.setData({ sessions })
    this.syncVisits(sessions)

    const before = this.snapshot || []
    const changed = []
    sessions.forEach((s) => {
      const old = before.find((o) => o.id === s.id)
      if (!old) return
      if (
        sameValues(old.values, s.values) &&
        (old.constitution || null) === (s.constitution || null) &&
        (old.therapy || null) === (s.therapy || null)
      ) {
        return
      }
      changed.push(s)
    })
    if (!changed.length) return

    try {
      for (const s of changed) {
        await data.updateVisit(s.id, {
          values: s.values || {},
          constitution: s.constitution || null,
          therapy: s.therapy || null,
        })
      }
      // 落库成功后更新快照（失败的这次不更新 → 下次还能重试）
      this.snapshot = sessions.map((s) => ({
        id: s.id,
        values: s.values,
        constitution: s.constitution,
        therapy: s.therapy,
      }))
    } catch (err) {
      this.setData({ error: (err && err.message) || '保存失败' })
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
      // 存不进去就把页面重新拉回库里的样子，别让人以为改成功了
      this.load()
    }
  },

  /** 点了表头日期 → 设为当前列（与网站一致：图示、① 框都跟着这一列） */
  onSessionTap(e) {
    const id = e.detail && e.detail.id
    if (id) this.setData({ activeSessionId: id })
  },

  /** 「每次就诊记录」列表跟着表里的改动更新（体质／疗法标签） */
  syncVisits(sessions) {
    this.setData({
      visits: sessions.map((v) => Object.assign({}, v, { atText: formatAt(v.at) })),
    })
  },

  /* --------------------------- 出图 --------------------------- */

  /** 组一份绘制用的 RecordSet（与网站同一形状） */
  buildSet() {
    return {
      name: this.data.name,
      layout: this.data.layout,
      sessions: (this.data.sessions || []).map((s) => ({
        id: s.id,
        label: s.label,
        values: s.values || {},
      })),
    }
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
      img.src = '/assets/hands-pulse.jpg'
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
      img.src = '/assets/hands-pulse.jpg'
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
   * 页面上没有可见画布（记录表已经是 WXML 组件），所以要存的那张得单独出。
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

  /**
   * 复制 Markdown
   *
   * ⚠️ fail 分支不能省：后台《用户隐私保护指引》没声明「读取你的剪切板」时，
   * setClipboardData 直接被禁用且**没有任何提示**，用户点了像坏了。
   */
  copyMarkdown() {
    const set = this.buildSet()
    const md = toMarkdown(set, undefined, this.data.customSymbols, set.sessions[0] && set.sessions[0].id)
    wx.setClipboardData({
      data: md,
      success: () => wx.showToast({ title: 'Markdown 已复制', icon: 'success' }),
      fail: (err) => {
        const msg = (err && err.errMsg) || '复制失败'
        wx.showToast({
          title: /api scope is not declared in the privacy agreement/.test(msg)
            ? '复制失败：后台未声明剪贴板权限'
            : msg,
          icon: 'none',
        })
      },
    })
  },

  /** 复制 CSV */
  copyCsv() {
    const csv = toCsv(this.buildSet())
    wx.setClipboardData({
      data: csv,
      success: () => wx.showToast({ title: 'CSV 已复制', icon: 'success' }),
      fail: (err) => {
        const msg = (err && err.errMsg) || '复制失败'
        wx.showToast({
          title: /api scope is not declared in the privacy agreement/.test(msg)
            ? '复制失败：后台未声明剪贴板权限'
            : msg,
          icon: 'none',
        })
      },
    })
  },

  /** 「录入编辑」→ 跳到录入页（那边能加记录、改名、换体例、显式保存） */
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
