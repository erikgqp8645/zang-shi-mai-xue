/**
 * 用药记录（小程序端）—— 对应网站的 `MedicationPanel` ＋ `MedicationPicker`
 *
 * 用药记录挂在某一次就诊（visitId）下面，所以必须能选「属于哪一次」。
 *
 * 工具只负责记录：
 * - 不替使用者加减方、不下诊断，也不判断填得对不对
 * - 方剂库只照抄讲稿 2010（组成用比例制）与同和堂版《方剂汇总统表》（成方·克）
 *   **两套分开列、各自标注出处与单位，不换算、不合并**
 * - 「对应脉象」文字与符号**并存**：文字自填，符号从该患者已录入的脉象里挑格子
 *
 * 查方名与查组成的口径走共享包（`utils/core/domain/medication.js` 的
 * findDrug ／ findFormulaDose，以及 `dose-lookup.js` 的 thDoseView ／ draftDoseView），
 * 与网站同一份代码 —— 不重写「同名不同号」「一味药不算方名」这些判定。
 *
 * WXML 不能调用 JS 函数 —— 所有要显示的内容都在这里预先算好放进 data。
 */

const data = require('../../utils/data.js')
const { DRUGS, DRUG_GROUPS } = require('../../utils/core/domain/drugs.js')
const { FORMULA_DOSES } = require('../../utils/core/domain/formula-table.js')
const {
  FORMULA_REFERENCE,
  buildPulseText,
  describeCodes,
  findDrug,
  findFormulaDose,
  pointOrder,
  pulsePointsOf,
} = require('../../utils/core/domain/medication.js')
const { draftDoseView, thDoseView } = require('../../utils/core/domain/dose-lookup.js')

/** 手别文字 */
const HAND_TEXT = { L: '左', R: '右' }

/** 新行的 id（与网站同一套写法） */
let seq = 0
function newId() {
  seq += 1
  return 'm' + Date.now().toString(36) + seq.toString(36)
}

/** 空的表单 */
function emptyForm(visitId) {
  return {
    id: '',
    visitId: visitId || '',
    name: '',
    pulse: '',
    adjust: '',
    usage: '',
    note: '',
  }
}

/** 一套资料的组成（同和堂版·克 ／ 讲稿 2010·比例制） */
function fmtDoseView(view, label) {
  if (!view || view.matched === 'none') {
    return { label: label, missing: true, note: '', entries: [] }
  }
  let note = ''
  if (view.matched === 'contains') {
    note = '同名不同号 ' + view.entries.length + ' 条（原方名各不相同，工具不替你选）'
  } else if (view.matched === 'alias') {
    note = '别名对照（有明确对照依据）'
  }
  return {
    label: label,
    missing: false,
    note: note,
    showName: view.matched === 'contains' || view.matched === 'alias',
    entries: view.entries.map((e) => ({
      name: e.name,
      composition: e.composition || '',
      science: e.science || '',
      usage: e.usage || '',
      source: e.source || '',
      basis: e.basis || '',
    })),
  }
}

/** 一行用药记录的展示数据 */
function fmtRow(r, visitLabel, customSymbols) {
  const keys = Object.keys(r.symbols || {}).filter((k) => (r.symbols[k] || []).length > 0)
  keys.sort((a, b) => pointOrder(a) - pointOrder(b))
  const chips = keys.map((k) => {
    const p = k.split('|')
    return {
      key: k,
      label: (HAND_TEXT[p[0]] || p[0]) + p[1] + ' ' + p[2],
      text: describeCodes(r.symbols[k], customSymbols),
    }
  })
  /* 该行方名的两套组成（克 ／ 比例制，各带出处；查不到写「未载」） */
  const name = (r.name || '').trim()
  const th = name ? fmtDoseView(thDoseView(name), '同和堂版（克）') : null
  const draft = name ? fmtDoseView(draftDoseView(name), '讲稿 2010（比例制）') : null
  const hasTh = !!findFormulaDose(name)
  const hasDraft = !!findDrug(name)
  return {
    id: r.id,
    visitId: r.visitId,
    visitLabel: visitLabel || '（未指定就诊）',
    name: name,
    pulse: r.pulse || '',
    adjust: r.adjust || '',
    usage: r.usage || '',
    note: r.note || '',
    chips: chips,
    symbolSummary: chips.length ? chips.map((c) => c.label + ' ' + c.text).join('；') : '',
    th: th,
    draft: draft,
    hasTh: hasTh,
    hasDraft: hasDraft,
  }
}

/** 方剂库：两套资料分开列（讲稿 2010 · 比例制 ／ 同和堂版 · 克），另附讲义 p42 原表 */
function buildLibrary(keyword) {
  const kw = (keyword || '').trim()
  const match = (name, extra) => {
    if (!kw) return true
    if (name.indexOf(kw) >= 0) return true
    if (extra && extra.indexOf(kw) >= 0) return true
    return false
  }

  /* 讲义 2026-10·p42「依脉用方表」—— 方 ↔ 脉象 */
  const refItems = FORMULA_REFERENCE.filter((r) => match(r.name, r.indication)).map((r) => ({
    no: r.no,
    name: r.name,
    indication: r.indication,
  }))

  /* 讲稿 2010（组成用比例制） */
  const draftSections = DRUG_GROUPS.map((g) => ({
    title: g.title,
    unit: '组成用比例制',
    source: '讲稿 2010·第二讲（叁、用方）',
    items: DRUGS.filter((d) => d.therapy === g.therapy)
      .filter((d) => match(d.name, d.indication))
      .map((d) => ({
        name: d.name,
        hint: d.composition || '',
        source: d.source,
      })),
  })).filter((s) => s.items.length)

  /* 同和堂版《方剂汇总统表》（成方·克） */
  const thSections = []
  for (let page = 1; page <= 3; page++) {
    const items = FORMULA_DOSES.filter((d) => d.page === page)
      .filter((d) => match(d.name, d.composition))
      .map((d) => ({
        name: d.name,
        hint: d.composition,
        source: '同和堂版 p' + d.page + ' · 单位：克',
      }))
    if (items.length) {
      thSections.push({
        title: '第 ' + page + ' 页',
        unit: '成方 · 克',
        source: '《臧氏脉学方剂汇总统表（同和堂版）》',
        items: items,
      })
    }
  }

  return {
    refTitle: '讲义 2026-10·p42「依脉用方表」（方 ↔ 脉象）',
    refUnit: '原文照录；只给方名与对应脉象，没有组成',
    refItems: refItems,
    draftSections: draftSections,
    thSections: thSections,
    empty: refItems.length === 0 && draftSections.length === 0 && thSections.length === 0,
  }
}

Page({
  data: {
    patients: [],
    patientId: '',
    patientName: '',
    visits: [],
    rows: [],
    /** 正在编辑的一行（空表单＝新增） */
    form: emptyForm(''),
    editing: false,
    /** 已选符号（这一行） */
    formChips: [],
    /** 该次就诊录到的脉点（可点选） */
    visitPoints: [],
    /** 按符号自动生成的那段文字 */
    autoText: '',
    /** 方剂库面板 */
    pickerOpen: false,
    pickerKeyword: '',
    picker: buildLibrary(''),
    error: '',
    busy: false,
    saved: '',
  },

  onLoad(options) {
    const patientId = (options && options.patientId) || ''
    this._rows = []
    this._visits = []
    this._symbols = {}
    this._customSymbols = []
    this._layout = 'nine'
    this.setData({ patientId: patientId })
    this.loadPatients()
  },

  async loadPatients() {
    try {
      const patients = await data.listPatients()
      this.setData({ patients: patients, error: '' })
      if (this.data.patientId) {
        const exist = patients.filter((p) => p.id === this.data.patientId)[0]
        if (exist) {
          await this.loadPatient(this.data.patientId)
        } else {
          this.setData({ patientId: '' })
        }
      }
    } catch (e) {
      this.setData({ error: (e && e.message) || '读取失败' })
    }
  },

  async selectPatient(e) {
    const id = e.currentTarget.dataset.id
    if (id === this.data.patientId) return
    await this.loadPatient(id)
  },

  /** 取这位患者 ＋ 其就诊记录 ＋ 其用药记录 */
  async loadPatient(id) {
    this.setData({ busy: true })
    try {
      const patient = await data.getPatient(id)
      if (!patient) {
        this.setData({ error: '没有这位患者的记录' })
        return
      }
      this._layout = patient.layout === 'seven' ? 'seven' : 'nine'
      this._visits = patient.visits || []
      const visits = this._visits.map((v) => ({
        id: v.id,
        label: v.label || '（未命名日期）',
      }))
      const rows = await data.listMedication(id)
      this._rows = rows || []
      let customSymbols = []
      try {
        customSymbols = await data.listCustomSymbols()
      } catch (e) {
        /* 自定义符号取不到不挡记录 */
      }
      this._customSymbols = customSymbols || []
      this.setData({
        patientId: id,
        patientName: patient.name || '',
        visits: visits,
        rows: this._rows.map((r) => this.decorateRow(r)),
        form: emptyForm(visits.length ? visits[visits.length - 1].id : ''),
        editing: false,
        error: '',
      })
      this._symbols = {}
      this.refreshForm()
    } catch (e) {
      this.setData({ error: (e && e.message) || '读取失败' })
    } finally {
      this.setData({ busy: false })
    }
  },

  /** 给一行补上展示字段 */
  decorateRow(r) {
    const visit = this._visits.filter((v) => v.id === r.visitId)[0]
    return fmtRow(r, visit ? visit.label : '', this._customSymbols)
  },

  /* ---------------- 表单 ---------------- */

  /** 表单里的输入框 */
  onInput(e) {
    const field = e.currentTarget.dataset.field
    const form = Object.assign({}, this.data.form)
    form[field] = e.detail.value
    this.setData({ form: form, saved: '' })
    if (field === 'pulse') this.refreshForm()
  },

  /** 选所属就诊 */
  selectVisit(e) {
    const id = e.currentTarget.dataset.id
    const form = Object.assign({}, this.data.form)
    form.visitId = id
    this.setData({ form: form })
    this.refreshForm()
  },

  /** 新增一行 */
  addRow() {
    const visitId = this.data.form.visitId || (this.data.visits.length ? this.data.visits[this.data.visits.length - 1].id : '')
    this._symbols = {}
    this.setData({ form: emptyForm(visitId), editing: false, saved: '' })
    this.refreshForm()
  },

  /** 编辑已有的一行 */
  editRow(e) {
    const id = e.currentTarget.dataset.id
    const row = this._rows.filter((r) => r.id === id)[0]
    if (!row) return
    this._symbols = Object.assign({}, row.symbols || {})
    this.setData({
      form: {
        id: row.id,
        visitId: row.visitId,
        name: row.name || '',
        pulse: row.pulse || '',
        adjust: row.adjust || '',
        usage: row.usage || '',
        note: row.note || '',
      },
      editing: true,
      saved: '',
    })
    this.refreshForm()
  },

  /** 取消编辑 */
  cancelEdit() {
    this._symbols = {}
    const visitId = this.data.form.visitId || (this.data.visits.length ? this.data.visits[this.data.visits.length - 1].id : '')
    this.setData({ form: emptyForm(visitId), editing: false })
    this.refreshForm()
  },

  /** 点一个脉点：选／不选（符号与「对应脉象」文字并存） */
  togglePoint(e) {
    const key = e.currentTarget.dataset.key
    const symbols = Object.assign({}, this._symbols)
    if ((symbols[key] || []).length > 0) {
      delete symbols[key]
    } else {
      const point = this.data.visitPoints.filter((p) => p.key === key)[0]
      if (!point) return
      symbols[key] = point.raw.slice()
    }
    this._symbols = symbols
    this.refreshForm()
  },

  /** 清空这一行已选的符号 */
  clearSymbols() {
    this._symbols = {}
    this.refreshForm()
  },

  /** 按符号重填「对应脉象」的文字 */
  refillFromSymbols() {
    const form = Object.assign({}, this.data.form)
    form.pulse = this.data.autoText
    this.setData({ form: form })
  },

  /** 重算表单相关的展示数据（已选符号、可点脉点、自动文字） */
  refreshForm() {
    const symbols = this._symbols || {}
    const keys = Object.keys(symbols).filter((k) => (symbols[k] || []).length > 0)
    keys.sort((a, b) => pointOrder(a) - pointOrder(b))
    const chips = keys.map((k) => {
      const p = k.split('|')
      return {
        key: k,
        label: (HAND_TEXT[p[0]] || p[0]) + p[1] + ' ' + p[2],
        text: describeCodes(symbols[k], this._customSymbols),
      }
    })

    /* 该次就诊录到的脉点（可逐个点选） */
    const visit = this._visits.filter((v) => v.id === this.data.form.visitId)[0]
    const points = []
    if (visit) {
      const list = pulsePointsOf(
        { id: visit.id, label: visit.label, values: visit.values || {} },
        this._layout,
      )
      for (let i = 0; i < list.length; i++) {
        const p = list[i]
        points.push({
          key: p.key,
          label: (HAND_TEXT[p.hand] || p.hand) + p.organ + ' ' + p.depth,
          codes: (p.codes || []).join(' '),
          raw: (p.codes || []).slice(),
          text: describeCodes(p.codes || [], this._customSymbols),
          on: (symbols[p.key] || []).length > 0,
        })
      }
    }

    this.setData({
      formChips: chips,
      visitPoints: points,
      autoText: buildPulseText(symbols, this._customSymbols),
    })
  },

  /* ---------------- 方剂库 ---------------- */

  openLibrary() {
    this.setData({ pickerOpen: true, pickerKeyword: this.data.pickerKeyword })
    this.refreshLibrary()
  },

  closeLibrary() {
    this.setData({ pickerOpen: false })
  },

  onInputKeyword(e) {
    this.setData({ pickerKeyword: e.detail.value })
    this.refreshLibrary()
  },

  refreshLibrary() {
    this.setData({ picker: buildLibrary(this.data.pickerKeyword) })
  },

  /** 选一个方名（讲义 p42 原表另把「对应脉象」一起填上） */
  pickName(e) {
    const name = e.currentTarget.dataset.name
    const indication = e.currentTarget.dataset.indication || ''
    const form = Object.assign({}, this.data.form)
    form.name = name
    if (indication) form.pulse = indication
    this.setData({ form: form, pickerOpen: false })
  },

  /* ---------------- 保存 / 删除 ---------------- */

  /** 整份保存（把没改动的行也带上） */
  async saveRow() {
    const patientId = this.data.patientId
    if (!patientId) {
      wx.showToast({ title: '先选一位患者', icon: 'none' })
      return
    }
    const form = this.data.form
    if (!form.visitId) {
      wx.showToast({ title: '用药记录要挂在某一次就诊上，请先选「属于哪一次」', icon: 'none' })
      return
    }
    const name = (form.name || '').trim()
    const pulse = (form.pulse || '').trim()
    const adjust = (form.adjust || '').trim()
    const usage = (form.usage || '').trim()
    const note = (form.note || '').trim()
    const symbols = this._symbols || {}
    const hasSymbols = Object.keys(symbols).some((k) => (symbols[k] || []).length > 0)
    if (!name && !pulse && !adjust && !usage && !note && !hasSymbols) {
      wx.showToast({ title: '这一行还是空的', icon: 'none' })
      return
    }

    const rows = []
    for (let i = 0; i < this._rows.length; i++) {
      const r = this._rows[i]
      if (r.id === form.id) continue
      rows.push({
        id: r.id,
        visitId: r.visitId,
        name: r.name || '',
        pulse: r.pulse || '',
        symbols: r.symbols || {},
        adjust: r.adjust || '',
        usage: r.usage || '',
        note: r.note || '',
      })
    }
    rows.push({
      id: form.id || newId(),
      visitId: form.visitId,
      name: name,
      pulse: pulse,
      symbols: symbols,
      adjust: adjust,
      usage: usage,
      note: note,
    })

    this.setData({ busy: true })
    try {
      await data.saveMedication(patientId, rows)
      await this.reloadRows()
      this._symbols = {}
      this.setData({ form: emptyForm(form.visitId), editing: false, saved: '已保存' })
      this.refreshForm()
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  /** 删一条用药记录 */
  async removeRow(e) {
    const id = e.currentTarget.dataset.id
    const row = this._rows.filter((r) => r.id === id)[0]
    if (!row) return
    const ok = await new Promise((resolve) =>
      wx.showModal({
        title: '删除这条用药记录？',
        content: (row.name || '（方名未填）') + '　·　删除后不可恢复。',
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      }),
    )
    if (!ok) return
    try {
      await data.deleteMedication(id)
      await this.reloadRows()
      if (this.data.form.id === id) this.cancelEdit()
      wx.showToast({ title: '已删除', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '删除失败', icon: 'none' })
    }
  },

  /** 重新读一遍这位患者的用药记录 */
  async reloadRows() {
    const rows = await data.listMedication(this.data.patientId)
    this._rows = rows || []
    this.setData({ rows: this._rows.map((r) => this.decorateRow(r)) })
  },

  goRecord() {
    wx.navigateTo({
      url: '/pages/record/record?patientId=' + encodeURIComponent(this.data.patientId),
    })
  },
})
