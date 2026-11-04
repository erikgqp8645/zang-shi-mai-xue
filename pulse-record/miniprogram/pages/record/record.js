/**
 * 录入页 —— 主表录入（对应网站的 PulseTable ＋ SymbolPalette ＋ 表下体质行）
 *
 * 版式结构与讲义 p34 实例表一一对应（**不是目测**）：
 *   表头第一行：标签区留白（姓名框上方不画线），每个日期横跨「左＋右」两列
 *   表头第二行：姓名框横跨「部位＋取法」两列，其后是「左 / 右」
 *   正文：部位列纵向合并一组三行（组内不画横线），取法列只存在于正文
 *   表下：体质行 —— 每个记录日期各记各的（讲义原表没有这一行，是工具加的，不进导出）
 *
 * 行结构直接取自共享包 `domain/layout.ts` 的 groupRows —— 与网站端同一份代码。
 *
 * 保存语义：整份保存患者（患者 ＋ 就诊记录 ＋ 用药记录）。
 * 用药记录原样带回，避免把已有的用药抹掉。
 */

const data = require('../../utils/data.js')
const { groupRows } = require('../../utils/core/domain/layout.js')
const { cellKey } = require('../../utils/core/domain/types.js')
const {
  COMMON_GROUPS,
  SYMBOL_BY_CODE,
  formatCodes,
  parseCodes,
} = require('../../utils/core/domain/symbols.js')
const { CONSTITUTION_OPTIONS, THERAPY_OPTIONS, therapyOf } = require('../../utils/core/domain/triad.js')
const { todayYmd, ymdToLabel, ymdToTimestamp } = require('../../utils/core/domain/dates.js')

/** 取一次就诊在某格的符号数组 */
function codesOf(session, hand, organ, depth) {
  const v = session.values || {}
  const arr = v[cellKey(hand, organ, depth)]
  return arr || []
}

/** 已选代码 → 查表对象（WXML 里没法调 indexOf） */
function toSet(codes) {
  const out = {}
  codes.forEach((c) => {
    out[c] = true
  })
  return out
}

/** 符号面板：讲义 p48–50 记录表表头的三组「常用脉象」 */
function buildPalette() {
  return COMMON_GROUPS.map((g) => ({
    title: g.title,
    items: g.codes.map((code) => {
      const def = SYMBOL_BY_CODE[code]
      return { code, label: (def && def.label) || code, hint: (def && def.hint) || '' }
    }),
  }))
}

Page({
  data: {
    patientId: '',
    name: '',
    layout: 'nine',
    /** 渲染用的表头列 */
    headSessions: [],
    /** 渲染用的正文（按部位分组，组内三行） */
    groups: [],
    /** 表下体质行 / 疗法行 */
    constitutionOptions: CONSTITUTION_OPTIONS,
    therapyOptions: THERAPY_OPTIONS,
    editingConstitution: '',
    editingTherapy: '',
    /** 符号面板 */
    paletteGroups: [],
    customSymbols: [],
    selected: null,
    selectedCodes: [],
    /** 已选代码集合（WXML 里没法调 indexOf，用对象查） */
    selectedSet: {},
    selectedTarget: '',
    manualText: '',
    today: '',
    busy: false,
    error: '',
    saving: false,
  },

  onLoad(options) {
    const patientId = (options && options.patientId) || ''
    const today = todayYmd()
    this.setData({ patientId, today, paletteGroups: buildPalette() })
    this.load(patientId)
  },

  /** 弹层里阻止冒泡（catchtap 用） */
  noop() {},

  async load(patientId) {
    try {
      const customSymbols = await data.listCustomSymbols()
      this.setData({ customSymbols })
    } catch (e) {
      /* 自定义符号取不到不挡录入 */
    }
    if (!patientId) {
      this.setData({ name: '', layout: 'nine', sessions: [], medications: [] })
      this.rebuild()
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
      this.rebuild()
    } catch (e) {
      this.setData({ error: (e && e.message) || '读取失败' })
    }
  },

  /**
   * 把 sessions 摊平成渲染用的结构。
   * 结构与讲义原表一一对应：部位列纵向合并（组内不画横线）、日期组横跨左右两列。
   */
  rebuild() {
    const sessions = this.data.sessions
    const layout = this.data.layout

    const groups = groupRows(layout).map((g) => ({
      organ: g.organ,
      rows: g.rows.map((row) => ({
        organ: row.organ,
        depth: row.depth,
        cells: sessions.map((s) => ({
          sessionId: s.id,
          L: formatCodes(codesOf(s, 'L', row.organ, row.depth)),
          R: formatCodes(codesOf(s, 'R', row.organ, row.depth)),
        })),
      })),
    }))

    this.setData({
      groups,
      headSessions: sessions.map((s) => ({
        id: s.id,
        label: s.label,
        constitution: s.constitution || '',
        therapy: s.therapy || '',
      })),
    })
  },

  /* --------------------------- 表格交互 --------------------------- */

  /** 点一个格子 → 选中它，弹出符号面板 */
  onCellTap(e) {
    const { sessionId, hand, organ, depth } = e.currentTarget.dataset
    const session = this.data.sessions.find((s) => s.id === sessionId)
    if (!session) return
    const codes = codesOf(session, hand, organ, depth)
    this.setData({
      selected: { sessionId, hand, organ, depth },
      selectedCodes: codes.slice(),
      selectedSet: toSet(codes),
      selectedTarget: (hand === 'R' ? '右' : '左') + organ + depth,
      manualText: formatCodes(codes),
      editingConstitution: '',
      editingTherapy: '',
    })
  },

  /** 关闭符号面板 */
  closePalette() {
    this.setData({ selected: null, selectedCodes: [], selectedSet: {}, selectedTarget: '', manualText: '' })
  },

  /** 点一个符号 → 在当前格里加/去这个符号 */
  toggleSymbol(e) {
    const code = e.currentTarget.dataset.code
    const codes = this.data.selectedCodes.slice()
    const i = codes.indexOf(code)
    if (i >= 0) codes.splice(i, 1)
    else codes.push(code)
    this.setData({ selectedCodes: codes, selectedSet: toSet(codes), manualText: formatCodes(codes) })
    this.applyCodes(codes)
  },

  /** 手输组合 */
  onManualInput(e) {
    const text = e.detail.value
    const codes = parseCodes(text, this.data.customSymbols.map((s) => s.code))
    this.setData({ manualText: text, selectedCodes: codes, selectedSet: toSet(codes) })
    this.applyCodes(codes)
  },

  /** 清空本格 */
  clearCell() {
    this.setData({ selectedCodes: [], selectedSet: {}, manualText: '' })
    this.applyCodes([])
  },

  /** 把符号写回当前格（只改本地 state，保存时才落库） */
  applyCodes(codes) {
    const sel = this.data.selected
    if (!sel) return
    const sessions = this.data.sessions.map((s) => {
      if (s.id !== sel.sessionId) return s
      const values = Object.assign({}, s.values)
      const key = cellKey(sel.hand, sel.organ, sel.depth)
      if (!codes.length) delete values[key]
      else values[key] = codes.slice()
      return Object.assign({}, s, { values })
    })
    this.setData({ sessions })
    this.rebuild()
  },

  /* --------------------------- 记录（日期列） --------------------------- */

  /** 选日期 → 加一列记录（标签用六位年月日，如 261102） */
  onPickDate(e) {
    const ymd = e.detail.value
    const label = ymdToLabel(ymd)
    if (!label) return
    const at = ymdToTimestamp(ymd)
    const id = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const sessions = this.data.sessions.concat([{ id, label, at, values: {}, constitution: null, therapy: null }])
    this.setData({ sessions, today: ymd })
    this.rebuild()
  },

  /** 点表头日期 → 设为当前列（与网站一致：图示、① 框都跟着这一列） */
  onHeadTap(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ activeSessionId: id })
  },

  /** 删掉一列记录 */
  removeSession(e) {
    const id = e.currentTarget.dataset.id
    const sessions = this.data.sessions.filter((s) => s.id !== id)
    this.setData({ sessions, editingConstitution: '', editingTherapy: '' })
    this.rebuild()
  },

  /* --------------------------- 体质 / 疗法 --------------------------- */

  onConstitutionTap(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ editingConstitution: id, editingTherapy: '' })
  },

  onTherapyTap(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ editingTherapy: id, editingConstitution: '' })
  },

  /** 选体质 → 按讲义 p47 图上的配对带出疗法（仍可改） */
  pickConstitution(e) {
    const { sessionId, id } = e.currentTarget.dataset
    const therapy = therapyOf(id)
    const sessions = this.data.sessions.map((s) =>
      s.id === sessionId ? Object.assign({}, s, { constitution: id, therapy }) : s,
    )
    this.setData({ sessions, editingConstitution: '' })
    this.rebuild()
  },

  clearConstitution(e) {
    const { sessionId } = e.currentTarget.dataset
    const sessions = this.data.sessions.map((s) =>
      s.id === sessionId ? Object.assign({}, s, { constitution: null, therapy: null }) : s,
    )
    this.setData({ sessions, editingConstitution: '' })
    this.rebuild()
  },

  pickTherapy(e) {
    const { sessionId, id } = e.currentTarget.dataset
    const sessions = this.data.sessions.map((s) =>
      s.id === sessionId ? Object.assign({}, s, { therapy: id }) : s,
    )
    this.setData({ sessions, editingTherapy: '' })
    this.rebuild()
  },

  /* --------------------------- 其他 --------------------------- */

  onInputName(e) {
    this.setData({ name: e.detail.value })
  },

  toggleLayout() {
    this.setData({ layout: this.data.layout === 'nine' ? 'seven' : 'nine' })
    this.rebuild()
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
    this.rebuild()
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
