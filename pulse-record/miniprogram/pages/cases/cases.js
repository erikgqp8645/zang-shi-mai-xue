/**
 * 病例列表 —— 对应网站的「病例记录」面板
 *
 * 两级结构：患者 → 每次就诊记录。
 * 搜索：姓名、日期标签、脉象符号（如 ↑ / X）都能搜（服务端 /api/search）。
 */

const data = require('../../utils/data.js')
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

/** 一次就诊记录的符号摘要：部位-取法 手别+符号（如「寸浮 左+」） */
function visitSummary(visit) {
  const parts = []
  const values = visit.values || {}
  Object.keys(values).forEach((key) => {
    const codes = values[key]
    if (!codes || codes.length === 0) return
    const seg = key.split('|')
    parts.push(seg[1] + seg[2] + ' ' + (seg[0] === 'R' ? '右' : '左') + formatCodes(codes))
  })
  return parts.length ? parts.join('　') : '（无符号）'
}

/** 给列表条目补上展示用的字段 */
function decorate(p) {
  return Object.assign({}, p, {
    atText: formatAt(p.at),
    matchedLabels: (p.matchedVisits || []).map((v) => v.label).join('、'),
  })
}

Page({
  data: {
    keyword: '',
    patients: [],
    /** 展示用的列表（搜索时是搜索结果，否则是完整列表） */
    list: [],
    expanded: '',
    detail: null,
    loading: false,
    error: '',
    renaming: '',
    renameText: '',
    mode: 'multi',
  },

  onShow() {
    const app = getApp()
    if (app) this.setData({ mode: app.globalData.mode })
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh())
  },

  async refresh() {
    try {
      const patients = await data.listPatients()
      this.setData({ patients, error: '' })
      this.applyList(patients)
      if (this.data.expanded) this.loadDetail(this.data.expanded)
    } catch (e) {
      this.setData({ error: (e && e.message) || '读取失败' })
    }
  },

  /** found 有值就用搜索结果，否则用完整列表 */
  applyList(patients) {
    const found = this.data.found
    const src = found || patients
    this.setData({ list: src.map(decorate) })
  },

  async loadDetail(id) {
    this.setData({ loading: true })
    try {
      const detail = await data.getPatient(id)
      if (!detail) {
        this.setData({ detail: null })
        return
      }
      const visits = (detail.visits || []).map((v) =>
        Object.assign({}, v, { atText: formatAt(v.at), summary: visitSummary(v) }),
      )
      this.setData({ detail: Object.assign({}, detail, { visits }) })
    } catch (e) {
      this.setData({ detail: null })
    } finally {
      this.setData({ loading: false })
    }
  },

  onInputKeyword(e) {
    const keyword = e.detail.value
    this.setData({ keyword })
    if (!keyword.trim()) {
      clearTimeout(this._searchTimer)
      this.setData({ found: null })
      this.applyList(this.data.patients)
      return
    }
    clearTimeout(this._searchTimer)
    this._searchTimer = setTimeout(() => {
      data
        .searchPatients(keyword.trim())
        .then((found) => {
          this.setData({ found })
          this.applyList(this.data.patients)
        })
        .catch(() => {
          this.setData({ found: null })
          this.applyList(this.data.patients)
        })
    }, 200)
  },

  clearKeyword() {
    clearTimeout(this._searchTimer)
    this.setData({ keyword: '', found: null })
    this.applyList(this.data.patients)
  },

  toggleExpand(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.expanded === id) {
      this.setData({ expanded: '', detail: null })
      return
    }
    this.setData({ expanded: id })
    this.loadDetail(id)
  },

  startRename(e) {
    const { id, name } = e.currentTarget.dataset
    this.setData({ renaming: id, renameText: name })
  },
  onInputRename(e) {
    this.setData({ renameText: e.detail.value })
  },
  async commitRename() {
    const id = this.data.renaming
    const name = this.data.renameText.trim()
    this.setData({ renaming: '' })
    if (!id || !name) return
    try {
      await data.renamePatient(id, name)
      this.refresh()
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '重命名失败', icon: 'none' })
    }
  },

  confirmDelete(title) {
    return new Promise((resolve) =>
      wx.showModal({
        title,
        content: '删除后不可恢复。',
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      }),
    )
  },

  async removePatient(e) {
    const id = e.currentTarget.dataset.id
    if (!(await this.confirmDelete('删除该患者的全部记录？'))) return
    try {
      await data.deletePatient(id)
      if (this.data.expanded === id) this.setData({ expanded: '', detail: null })
      this.refresh()
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '删除失败', icon: 'none' })
    }
  },

  async removeVisit(e) {
    const id = e.currentTarget.dataset.id
    if (!(await this.confirmDelete('删除这次记录？'))) return
    try {
      await data.deleteVisit(id)
      this.loadDetail(this.data.expanded)
      this.refresh()
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '删除失败', icon: 'none' })
    }
  },

  /** 去录入页编辑这位患者的全部记录 */
  goRecord(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/record/record?patientId=' + encodeURIComponent(id) })
  },

  /** 去详情页（看表、出图） */
  goDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/case-detail/case-detail?patientId=' + encodeURIComponent(id) })
  },

  /** 去录入页新建 */
  goNew() {
    wx.navigateTo({ url: '/pages/record/record' })
  },
})
