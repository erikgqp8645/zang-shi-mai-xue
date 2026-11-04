/**
 * 开方三部曲 —— 对应网站的 TriadFrame ＋ TriadImage
 *
 * 讲义 2026-10 PDF p47（印刷 45）「臧氏脉学 开方三部曲」图：
 *   ①判体质 → ②定疗法 → ③开方药，③ 有一条**虚线回路**回到 ①。
 *
 * 边界（与网站端一致）：
 *   - 体质与疗法**由使用者自己判断后手工选**，工具只记录、不代判、不下诊断、不自动开方。
 *   - 图上两条问句（有变脉？尺脉弱？）只作**参考判据**，标出命中位置，不决定体质。
 *   - 方名照抄（「清挡路方」「冷热水」「引火归元」等），不改成现代教材方名。
 *   - ③ 的方药组成两套并列（同和堂版＝克，讲稿 2010＝比例制），**不可互相换算**。
 */

const data = require('../../utils/data.js')
const {
  BIANMAI_DEFINITION,
  CONSTITUTION_OPTIONS,
  STATE_HINTS,
  THERAPY_OPTIONS,
  therapyOf,
  prescriptionsOf,
  readTriadReference,
} = require('../../utils/core/domain/triad.js')
const { thDoseView, draftDoseView } = require('../../utils/core/domain/dose-lookup.js')
const { cellKey } = require('../../utils/core/domain/types.js')

/** 把一个 DoseSourceView 摊平成可渲染的数组 */
function doseBlock(label, view) {
  if (!view || view.matched === 'none') {
    return { label, missing: true, entries: [] }
  }
  const note =
    view.entries.length > 1
      ? '　同名不同号 ' + view.entries.length + ' 条（原方名各不相同，工具不替你选）'
      : '　名称含此名的一条（原方名见后）'
  const showName = view.matched === 'contains' || view.matched === 'alias'
  return {
    label,
    missing: false,
    note: view.matched === 'contains' ? note : view.matched === 'alias' ? '　别名对照（有明确对照依据）' : '',
    showName,
    entries: view.entries.map((e) => ({
      name: e.name,
      composition: e.composition,
      science: e.science || '',
      usage: e.usage || '',
      source: e.source || '',
      basis: e.basis || '',
    })),
  }
}

Page({
  data: {
    patients: [],
    patientId: '',
    visits: [],
    visitId: '',
    /** 选定那次就诊的脉象值 */
    values: {},
    layout: 'nine',

    /* ① 体质 */
    constitutionOptions: CONSTITUTION_OPTIONS,
    constitution: '',
    /* ② 疗法（补一个 rxNames：图上那一支的方名，WXML 里不能自己 map） */
    therapyOptions: THERAPY_OPTIONS.map((o) =>
      Object.assign({}, o, { rxNames: o.prescriptions.map((p) => p.name).join('、') }),
    ),
    therapy: '',
    carriedTherapy: '',
    /* ③ 开方药 */
    rx: [],
    /* 参考判据 */
    reference: null,
    bianmaiDefinition: BIANMAI_DEFINITION,
    stateHints: STATE_HINTS,
    error: '',
    busy: false,
  },

  onLoad(options) {
    const patientId = (options && options.patientId) || ''
    this.setData({ patientId })
    this.loadPatients(patientId)
  },

  async loadPatients(patientId) {
    try {
      const patients = await data.listPatients()
      this.setData({ patients })
      if (patientId) this.loadPatient(patientId)
    } catch (e) {
      this.setData({ error: (e && e.message) || '读取失败' })
    }
  },

  async loadPatient(patientId) {
    try {
      const patient = await data.getPatient(patientId)
      if (!patient) {
        this.setData({ error: '没有这位患者的记录' })
        return
      }
      const visits = patient.visits || []
      const visitId = visits.length ? visits[0].id : ''
      this.setData({
        patientId,
        layout: patient.layout === 'seven' ? 'seven' : 'nine',
        visits,
        visitId,
      })
      this.applyVisit(visitId)
    } catch (e) {
      this.setData({ error: (e && e.message) || '读取失败' })
    }
  },

  onPickPatient(e) {
    this.loadPatient(e.currentTarget.dataset.id)
  },

  onPickVisit(e) {
    this.applyVisit(e.currentTarget.dataset.id)
  },

  /** 选定一次就诊 → 取其脉象值，重算参考判据与 ①②③ */
  applyVisit(visitId) {
    const visit = this.data.visits.find((v) => v.id === visitId)
    if (!visit) {
      this.setData({ visitId: '', values: {}, constitution: '', therapy: '', rx: [], reference: null })
      return
    }
    const values = visit.values || {}
    const constitution = visit.constitution || ''
    const therapy = visit.therapy || ''
    this.setData({ visitId, values, constitution, therapy })
    this.recompute(constitution, therapy)
  },

  /** 重算参考判据 ＋ ③ 的方药清单 */
  recompute(constitution, therapy) {
    const values = this.data.values
    const layout = this.data.layout
    const depthsOf = (organ) => {
      const order = layout === 'seven' ? ['寸', '关', '尺'] : ['寸', '关', '尺']
      const all = {
        寸: ['浮', '中', '沉'],
        关: ['浮', '中', '沉'],
        尺: layout === 'seven' ? ['沉'] : ['浮', '中', '沉'],
      }
      return order.indexOf(organ) >= 0 ? all[organ] : []
    }
    const ctx = {
      layout,
      get: (hand, organ, depth) => values[cellKey(hand, organ, depth)] || [],
      depths: depthsOf,
    }

    const ref = readTriadReference(ctx)
    const rx = prescriptionsOf(therapy).map((p) => ({
      no: p.no,
      name: p.name,
      source: p.source,
      doses: [doseBlock('同和堂版（克）', thDoseView(p.name)), doseBlock('讲稿 2010（比例制）', draftDoseView(p.name))],
    }))

    this.setData({
      reference: {
        recorded: ref.recorded,
        bianmai: ref.bianmai ? ref.bianmai.cells.length : 0,
        chimai: ref.chimai ? ref.chimai.cells.length : 0,
        chimaiReached: ref.chimaiReached,
        suggested: ref.suggested || '',
      },
      rx,
    })
  },

  /* ---------------- ① 判体质 ---------------- */

  pickConstitution(e) {
    const id = e.currentTarget.dataset.id
    const carried = therapyOf(id)
    this.setData({ constitution: id, carriedTherapy: carried })
    this.recompute(id, this.data.therapy || carried)
    this.persist({ constitution: id, therapy: this.data.therapy || carried })
  },

  clearConstitution() {
    this.setData({ constitution: '', carriedTherapy: '' })
    this.recompute('', this.data.therapy)
    this.persist({ constitution: null, therapy: null })
  },

  /* ---------------- ② 定疗法 ---------------- */

  pickTherapy(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ therapy: id })
    this.recompute(this.data.constitution, id)
    this.persist({ therapy: id })
  },

  clearTherapy() {
    this.setData({ therapy: '' })
    this.recompute(this.data.constitution, '')
    this.persist({ therapy: null })
  },

  /** 把体质/疗法写回那次就诊（与网站一致：随记录存） */
  async persist(patch) {
    if (!this.data.visitId) return
    try {
      await data.updateVisit(this.data.visitId, patch)
    } catch (e) {
      this.setData({ error: (e && e.message) || '保存失败' })
    }
  },

  goRecord() {
    const url = this.data.patientId
      ? '/pages/record/record?patientId=' + encodeURIComponent(this.data.patientId)
      : '/pages/record/record'
    wx.navigateTo({ url })
  },
})
