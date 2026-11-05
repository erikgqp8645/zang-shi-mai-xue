/**
 * 录入记录表（自定义组件）—— **录入页与病例详情页「记录表」共用同一个**
 *
 * ## 为什么要做成组件
 *
 * 2026-11-05 的毛病就出在这儿：病例详情页的「记录表」是 canvas 画的，
 * 录入页的「录入记录」是 WXML 画的 —— **两套各画各的**，于是同一位患者
 * 在两个界面长得不一样（canvas 版没有表下「体质／（未判）」两行、也不能编辑）。
 *
 * 现在两处都用这个组件：**版式与交互只有一份**，不可能再走偏。
 *
 * ## 版式（照抄讲义 2026-10 PDF p34「④ 脉象记录」实例表）
 *
 *   表头第一行：标签区留白（姓名框上方不画线），每个日期横跨「左＋右」两列
 *   表头第二行：姓名框横跨「部位＋取法」两列，其后是「左 / 右」
 *   正文：部位列纵向合并一组三行（组内不画横线），取法列只存在于正文
 *   表下：体质行 / 疗法行 —— **每个记录日期各记各的**
 *        （讲义原表没有这两行，是工具自己加的，**不进导出**）
 *
 * 行结构直接取自共享包 `domain/layout.ts` 的 groupRows —— 与网站端同一份代码。
 *
 * ## 对外接口
 *
 *   properties: sessions / layout / customSymbols / name / editable
 *   events:     change（detail: { sessions }）—— 格值／体质／疗法有改动时抛出
 *               sessiontap（detail: { id }）—— 点了表头日期
 *
 * 组件**只管显示与交互**，落库由页面决定：
 *   · 录入页：拿到 change 更新本地 state，点「保存」才落库
 *   · 病例详情页：拿到 change **立即落库**（那里没有「保存」按钮）
 */

const { groupRows } = require('../../utils/core/domain/layout.js')
const { cellKey } = require('../../utils/core/domain/types.js')
const {
  COMMON_GROUPS,
  SYMBOL_BY_CODE,
  formatCodes,
  parseCodes,
} = require('../../utils/core/domain/symbols.js')
const { CONSTITUTION_OPTIONS, THERAPY_OPTIONS, therapyOf } = require('../../utils/core/domain/triad.js')

/**
 * 把「一个格子的符号」还原成数组。
 *
 * ## 为什么需要这一步（2026-11-05 踩到的坑）
 *
 * 自定义组件的属性（sessions）会走一圈 **逻辑层 → 视图层 → 逻辑层**。
 * 视图层的数据协议把**嵌套数组**压成了「数字下标的普通对象」：
 * `["X"]` 回来变成 `{"0":"X"}`。
 * 于是 `formatCodes` 里的 `codes.join` 直接抛「codes.join is not a function」——
 * 而且是**静默失败**：表格那一列画不出来，页面上看不出所以然。
 *
 * 更要命的是第二次编辑：格值已经是对象了，再点另一格就会把
 * `{"0":"X"}` 这种形状**存进数据库**，以后这个患者这一格就读不出来了。
 *
 * 所以：**凡是读格值、凡是往外抛 sessions，都先按数字下标还原回数组。**
 */
function toCodeArray(v) {
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object') {
    return Object.keys(v)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => v[k])
  }
  return []
}

/** 把一次就诊的 values 里每个格值都规整成数组（空的格＝没有这一格） */
function cleanValues(values) {
  const out = {}
  Object.keys(values || {}).forEach((k) => {
    const arr = toCodeArray(values[k])
    if (arr.length) out[k] = arr
  })
  return out
}

/** 把整份 sessions 规整（每个格值都还原成数组） */
function cleanSessions(sessions) {
  return (sessions || []).map((s) => Object.assign({}, s, { values: cleanValues(s.values) }))
}

/** 取一次就诊在某格的符号数组 */
function codesOf(session, hand, organ, depth) {
  const v = session.values || {}
  return toCodeArray(v[cellKey(hand, organ, depth)])
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

Component({
  // apply-shared：app.wxss 的全局样式（.pr-input 等）在组件内部照样生效
  options: { styleIsolation: 'apply-shared' },

  properties: {
    /** 每次就诊一次记录：{ id, label, at, values, constitution, therapy } */
    sessions: { type: Array, value: [] },
    /** 行结构：nine（9 行）／seven（7 脉点，尺只沉） */
    layout: { type: String, value: 'nine' },
    /** 自定义符号（自建，如 涩＝S） */
    customSymbols: { type: Array, value: [] },
    /** 姓名（表头第二行左侧那格） */
    name: { type: String, value: '' },
    /** 能不能改；false 时点格子不弹面板 */
    editable: { type: Boolean, value: true },
  },

  data: {
    /** 渲染用的正文（按部位分组，组内三行） */
    groups: [],
    /** 渲染用的表头列 */
    headSessions: [],
    /** 体质／疗法候选项 */
    constitutionOptions: CONSTITUTION_OPTIONS,
    therapyOptions: THERAPY_OPTIONS,
    /** 符号面板 */
    paletteGroups: [],
    /** 正在录入的那一格 */
    selected: null,
    selectedCodes: [],
    /** 已选代码集合（WXML 里没法调 indexOf，用对象查） */
    selectedSet: {},
    selectedTarget: '',
    manualText: '',
    /** 正在选体质／疗法的那个记录列 */
    editingConstitution: '',
    editingTherapy: '',
  },

  observers: {
    'sessions, layout': function () {
      this.rebuild()
    },
  },

  lifetimes: {
    attached() {
      this.setData({ paletteGroups: buildPalette() })
    },
  },

  methods: {
    /**
     * 把 sessions 摊平成渲染用的结构。
     * 结构与讲义原表一一对应：部位列纵向合并（组内不画横线）、日期组横跨左右两列。
     */
    rebuild() {
      const sessions = cleanSessions(this.data.sessions)
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
      if (!this.data.editable) return
      const { sessionId, hand, organ, depth } = e.currentTarget.dataset
      const session = (this.data.sessions || []).find((s) => s.id === sessionId)
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
      const codes = parseCodes(text, (this.data.customSymbols || []).map((s) => s.code))
      this.setData({ manualText: text, selectedCodes: codes, selectedSet: toSet(codes) })
      this.applyCodes(codes)
    },

    /** 清空本格 */
    clearCell() {
      this.setData({ selectedCodes: [], selectedSet: {}, manualText: '' })
      this.applyCodes([])
    },

    /**
     * 把符号写回当前格。
     *
     * 只改本地 state，**不落库** —— 落库由页面决定（录入页等「保存」，
     * 病例详情页收到 change 事件后立即存）。
     */
    applyCodes(codes) {
      const sel = this.data.selected
      if (!sel) return
      // 先把整份规整（格值都还原成数组），再改这一格 ——
      // 否则上一轮留下的 {"0":"X"} 会被原样带出去、存进数据库。
      const sessions = cleanSessions(this.data.sessions).map((s) => {
        if (s.id !== sel.sessionId) return s
        const values = Object.assign({}, s.values)
        const key = cellKey(sel.hand, sel.organ, sel.depth)
        if (!codes.length) delete values[key]
        else values[key] = codes.slice()
        return Object.assign({}, s, { values })
      })
      this.setData({ sessions })
      this.triggerEvent('change', { sessions })
    },

    /* --------------------------- 记录（日期列） --------------------------- */

    /** 点表头日期 → 设为当前列（与网站一致：图示、① 框都跟着这一列） */
    onHeadTap(e) {
      const id = e.currentTarget.dataset.id
      this.triggerEvent('sessiontap', { id })
    },

    /* --------------------------- 体质 / 疗法 --------------------------- */

    onConstitutionTap(e) {
      if (!this.data.editable) return
      const id = e.currentTarget.dataset.id
      this.setData({ editingConstitution: id, editingTherapy: '' })
    },

    onTherapyTap(e) {
      if (!this.data.editable) return
      const id = e.currentTarget.dataset.id
      this.setData({ editingTherapy: id, editingConstitution: '' })
    },

    /** 选体质 → 按讲义 p47 图上的配对带出疗法（仍可改） */
    pickConstitution(e) {
      const { sessionId, id } = e.currentTarget.dataset
      const therapy = therapyOf(id)
      const sessions = cleanSessions(this.data.sessions).map((s) =>
        s.id === sessionId ? Object.assign({}, s, { constitution: id, therapy }) : s,
      )
      this.setData({ sessions, editingConstitution: '' })
      this.triggerEvent('change', { sessions })
    },

    clearConstitution(e) {
      const { sessionId } = e.currentTarget.dataset
      const sessions = cleanSessions(this.data.sessions).map((s) =>
        s.id === sessionId ? Object.assign({}, s, { constitution: null, therapy: null }) : s,
      )
      this.setData({ sessions, editingConstitution: '' })
      this.triggerEvent('change', { sessions })
    },

    pickTherapy(e) {
      const { sessionId, id } = e.currentTarget.dataset
      const sessions = cleanSessions(this.data.sessions).map((s) =>
        s.id === sessionId ? Object.assign({}, s, { therapy: id }) : s,
      )
      this.setData({ sessions, editingTherapy: '' })
      this.triggerEvent('change', { sessions })
    },

    /** 弹层里阻止冒泡（catchtap 用） */
    noop() {},
  },
})
