/**
 * 录入页 —— 主表录入（对应网站的 PulseTable ＋ SymbolPalette ＋ 表下体质行）
 *
 * ## 版式结构与讲义 p34 实例表一一对应（**不是目测**）：
 *   表头第一行：标签区留白（姓名框上方不画线），每个日期横跨「左＋右」两列
 *   表头第二行：姓名框横跨「部位＋取法」两列，其后是「左 / 右」
 *   正文：部位列纵向合并一组三行（组内不画横线），取法列只存在于正文
 *   表下：体质行 —— 每个记录日期各记各的（讲义原表没有这一行，是工具加的，不进导出）
 *
 * 这些版式与交互**都在 `components/record-sheet` 里** ——
 * 病例详情页的「记录表」用的是同一个组件，两处不可能长得不一样。
 *
 * 保存语义：整份保存患者（患者 ＋ 就诊记录 ＋ 用药记录）。
 * 用药记录原样带回，避免把已有的用药抹掉。
 */

const data = require('../../utils/data.js')
const { todayYmd, ymdToLabel, ymdToTimestamp } = require('../../utils/core/domain/dates.js')

Page({
  data: {
    patientId: '',
    name: '',
    layout: 'nine',
    /** 每次就诊一次记录（组件的数据源） */
    sessions: [],
    /** 用药记录（保存时原样带回） */
    medications: [],
    customSymbols: [],
    /** 当前列（点表头日期切换） */
    activeSessionId: '',
    today: '',
    busy: false,
    error: '',
    saving: false,
  },

  onLoad(options) {
    const patientId = (options && options.patientId) || ''
    const today = todayYmd()
    this.setData({ patientId, today })
    this.load(patientId)
  },

  async load(patientId) {
    try {
      const customSymbols = await data.listCustomSymbols()
      this.setData({ customSymbols })
    } catch (e) {
      /* 自定义符号取不到不挡录入 */
    }
    if (!patientId) {
      this.setData({ name: '', layout: 'nine', sessions: [], medications: [] })
      return
    }
    try {
      const patient = await data.getPatient(patientId)
      if (!patient) {
        this.setData({ error: '没有这位患者的记录' })
        return
      }
      const medications = await data.listMedication(patientId)
      this.setData({
        patientId,
        name: patient.name || '',
        layout: patient.layout === 'seven' ? 'seven' : 'nine',
        sessions: (patient.visits || []).map((v) => ({
          id: v.id,
          label: v.label,
          at: v.at,
          values: v.values || {},
          constitution: v.constitution || null,
          therapy: v.therapy || null,
        })),
        medications,
      })
    } catch (e) {
      this.setData({ error: (e && e.message) || '读取失败' })
    }
  },

  /* --------------------------- 组件回调 --------------------------- */

  /** 组件里改了格值／体质／疗法 → 收回本地 state（落库在「保存」） */
  onSheetChange(e) {
    const sessions = (e.detail && e.detail.sessions) || []
    this.setData({ sessions })
  },

  /** 点了表头日期 → 设为当前列（与网站一致：图示、① 框都跟着这一列） */
  onSessionTap(e) {
    const id = e.detail && e.detail.id
    if (id) this.setData({ activeSessionId: id })
  },

  /* --------------------------- 记录（日期列） --------------------------- */

  /** 选日期 → 加一列记录（标签用六位年月日，如 261102） */
  onPickDate(e) {
    const ymd = e.detail.value
    const label = ymdToLabel(ymd)
    if (!label) return
    const at = ymdToTimestamp(ymd)
    const id = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const sessions = this.data.sessions.concat([
      { id, label, at, values: {}, constitution: null, therapy: null },
    ])
    this.setData({ sessions, today: ymd })
  },

  /* --------------------------- 其他 --------------------------- */

  onInputName(e) {
    this.setData({ name: e.detail.value })
  },

  /**
   * 切换体例（7 脉点 / 9 行）。
   *
   * **体例是患者级属性** —— 病例详情页的「记录表」与这一页的表格都按它画。
   * 所以这里切换**立刻落库**（新建患者还没 id 时才只改本地）：
   * 否则同一位患者会在两个页面显示出不同的行数 —— 记录表 7 行、录入记录 9 行。
   *
   * 只改体例、不动格值：7↔9 来回切，「尺浮/尺中」两行的数据仍原样留着，切回来还在。
   */
  async toggleLayout() {
    if (this.data.saving) return
    const next = this.data.layout === 'nine' ? 'seven' : 'nine'
    const patientId = this.data.patientId

    // 新建患者（还没落库）→ 没有 id 可改，先切本地，保存时随患者一起存
    if (!patientId) {
      this.setData({ layout: next })
      this.hintLayout(next)
      return
    }

    try {
      const patient = await data.updatePatientLayout(patientId, next)
      if (!patient) throw new Error('没有这位患者的记录')
      // 以服务端返回的为准（服务端是唯一真源）
      const applied = patient.layout === 'seven' ? 'seven' : 'nine'
      this.setData({ layout: applied })
      this.hintLayout(applied)
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '体例改不了', icon: 'none' })
    }
  },

  /** 切换体例后把影响说清楚（多出/少掉哪两行、导出也会跟着变） */
  hintLayout(layout) {
    const text =
      layout === 'nine'
        ? '已改为 9 行：多出「尺浮、尺中」两行，没数据就是空行，导出的图也会多两行'
        : '已改为 7 脉点：「尺浮、尺中」两行不再显示，数据仍留着，切回来还在'
    wx.showToast({ title: text, icon: 'none', duration: 2600 })
  },

  /** 载入讲义 p34 的实例（少娟 6 次记录）—— 与网站同一个按钮 */
  loadSample() {
    const sample = require('../../utils/core/domain/sample.js').sampleShaoJuan()
    const sessions = sample.sessions.map((s) => ({
      id: 'v' + Math.random().toString(36).slice(2, 8),
      label: s.label,
      at: Date.now(),
      values: s.values,
      constitution: null,
      therapy: null,
    }))
    this.setData({ name: sample.name, sessions, medications: [] })
  },

  /** 保存：整份保存（用药记录原样带回，不抹掉已有的） */
  async save() {
    if (this.data.saving) return
    this.setData({ saving: true, error: '' })
    try {
      const payload = {
        id: this.data.patientId || undefined,
        name: (this.data.name || '').trim() || '未命名',
        layout: this.data.layout,
        visits: this.data.sessions.map((s) => ({
          id: s.id,
          label: s.label,
          at: s.at,
          values: s.values,
          constitution: s.constitution,
          therapy: s.therapy,
        })),
        medications: this.data.medications || [],
      }
      const saved = await data.savePatient(payload)
      wx.showToast({ title: '已保存', icon: 'success' })
      const pages = getCurrentPages()
      if (pages.length > 1) {
        wx.navigateBack()
      } else {
        wx.switchTab({ url: '/pages/cases/cases' })
      }
      return saved
    } catch (e) {
      this.setData({ error: (e && e.message) || '保存失败' })
      wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },
})
