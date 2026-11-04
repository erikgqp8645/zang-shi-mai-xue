/**
 * 依脉用方（小程序端）—— 对应网站的 `Findings` 面板
 *
 * 一个长页面，分段自上而下：上下文 → 判读提示 → 依脉用方 → 分组筛选 →
 * 用药禁忌（常驻）→ 附表一体质用药对照（讲义 p46）→ 讲义 p42 原文对照（28 行）→
 * 方剂备查（同和堂版）→ 方剂备查（讲稿 2010·叁、用方）。
 *
 * 判读与查方的逻辑**一律走共享包**（`utils/core/domain/**`），与网站同一份代码：
 *   evaluateRules / evaluateFormulas / groupByWuxing / groupByHand /
 *   formulaDoseView / thDoseView / draftDoseView
 * 小程序这边只做「取值 → 拼装展示数据」，不重写任何判定。
 *
 * WXML 不能调用 JS 函数 —— 所有要显示的内容都在这里预先算好放进 data。
 *
 * 纪律：术语沿用讲稿／讲义原文用字；讲义（2026-10）与讲稿（2010）两条资料线分开标注；
 * 两套剂量（克 ／ 比例制）不换算、不合并；不替读者加减方、不下诊断。
 */

const data = require('../../utils/data.js')
const { evaluateRules } = require('../../utils/core/domain/rules.js')
const {
  CONSTITUTION_TABLE,
  FORMULA_ROUTE_ORDER,
  STANDING_FORMULA_RULES,
  evaluateFormulas,
} = require('../../utils/core/domain/formulas.js')
const {
  DIM_ORDER,
  RULE_OR_DRUG_ATTRIB,
  STANDING_DISPLAY,
  groupByHand,
  groupByWuxing,
  groupShortLabel,
} = require('../../utils/core/domain/grouping.js')
const { DRUGS, DRUG_BY_ID, DRUG_GROUPS } = require('../../utils/core/domain/drugs.js')
const {
  DOSE_SCIENCE_NAME,
  FORMULA_DOSES,
  FORMULA_SCIENCES,
  FORMULA_SCIENCE_BY_NAME,
} = require('../../utils/core/domain/formula-table.js')
const { FORMULA_REFERENCE, formulaDoseView } = require('../../utils/core/domain/medication.js')
const { draftDoseView, thDoseView } = require('../../utils/core/domain/dose-lookup.js')
const { cellKey } = require('../../utils/core/domain/types.js')
const { groupRows } = require('../../utils/core/domain/layout.js')

/** 手别文字 */
const HAND_TEXT = { L: '左', R: '右' }

/** severity → 徽标文字（与网站一致） */
const SEVERITY_LABEL = { high: '高危', warn: '提示', info: '参考' }

/** 分组维度（与网站一致：讲稿原序 ／ 按五行 ／ 按左右手） */
const DIM_OPTIONS = [
  { key: 'route', label: '讲稿原序' },
  { key: 'wuxing', label: '按五行' },
  { key: 'hand', label: '按左右手' },
]

/** 格子 key（`L|关|浮`）→ 文字（左关 浮） */
function cellLabel(key) {
  const parts = String(key).split('|')
  return (HAND_TEXT[parts[0]] || parts[0]) + parts[1] + ' ' + parts[2]
}

/** 归类信息（照网站 AttrChip ／ AttrBasis 的内容） */
function attrText(attr) {
  if (!attr) return null
  return {
    main: attr.wuxing + '·' + attr.zang,
    also: attr.also && attr.also.length ? '兼' + attr.also.join('') : '',
    site: attr.site || '',
    basis: attr.basis || '',
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

/** 讲稿 2010 的一张方剂卡 */
function fmtDrug(d, withAttr) {
  return {
    id: d.id,
    name: d.name,
    therapy: d.therapy,
    composition: d.composition || '',
    usage: d.usage || '',
    science: d.science || '',
    indication: d.indication || '',
    adjustments: d.adjustments || [],
    contraindication: d.contraindication || '',
    source: d.source,
    attr: withAttr ? attrText(RULE_OR_DRUG_ATTRIB[d.id]) : null,
  }
}

/** 一条依脉用方条目 */
function fmtFormula(hit, visitLabel, isStanding) {
  const attr = attrText(RULE_OR_DRUG_ATTRIB[hit.id])
  const formulas = hit.formulas || []
  const adds = hit.adds || []
  /** 讲稿侧若已出方剂卡片，剂量行只补同和堂版那一套（免得与卡片重复） */
  const hasDrugCard = !!(hit.drugs && hit.drugs.length)
  const doseLines = []
  for (let i = 0; i < formulas.length; i++) {
    const name = formulas[i]
    /* 加减药不是方名（如「知柏」「羌活」），不去查成方 */
    if (adds.indexOf(name) >= 0) continue
    const th = thDoseView(name)
    const draft = hasDrugCard ? { matched: 'none', entries: [] } : draftDoseView(name)
    if (th.matched === 'none' && draft.matched === 'none') continue
    doseLines.push({
      name: name,
      th: fmtDoseView(th, '同和堂版（克）'),
      draft: fmtDoseView(draft, '讲稿 2010（比例制）'),
    })
  }
  const drugCards = []
  if (hit.drugs) {
    for (let i = 0; i < hit.drugs.length; i++) {
      const d = DRUG_BY_ID[hit.drugs[i]]
      if (d) drugCards.push(fmtDrug(d, false))
    }
  }
  return {
    id: hit.id,
    kind: hit.kind,
    condition: hit.condition,
    therapy: hit.therapy,
    formulas: formulas,
    adds: adds,
    addsText: adds.join('、'),
    quote: hit.quote,
    source: hit.source,
    attr: attr,
    doseLines: doseLines,
    drugCards: drugCards,
    cells: (hit.cells || []).map(cellLabel),
    srcLine: isStanding
      ? '〔' + hit.source + '〕· 常驻条目（不依脉象）'
      : '〔' + hit.source + '〕· 记录 ' + visitLabel,
  }
}

/** 一条判读提示 */
function fmtRule(hit, visitLabel) {
  return {
    id: hit.id,
    severity: hit.severity,
    severityLabel: SEVERITY_LABEL[hit.severity] || '',
    title: hit.title,
    detail: hit.detail,
    source: hit.source,
    cells: (hit.cells || []).map(cellLabel),
    srcLine: '〔' + hit.source + '〕· 记录 ' + visitLabel,
  }
}

/** 常驻条目的 id（三不用／白虎汤肾气丸） */
const STANDING_IDS = STANDING_FORMULA_RULES.map((r) => r.id)

/** 同一条规则合并（按 id），命中的记录名汇总 */
function mergeByRule(items, visitLabel) {
  const map = {}
  const order = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const key = it.id
    if (!map[key]) {
      map[key] = { item: it, sessions: [visitLabel] }
      order.push(key)
    } else if (map[key].sessions.indexOf(visitLabel) < 0) {
      map[key].sessions.push(visitLabel)
    }
  }
  const out = []
  for (let i = 0; i < order.length; i++) out.push(map[order[i]])
  return out
}

Page({
  data: {
    /* ---- 上下文 ---- */
    patients: [],
    patientId: '',
    patientName: '',
    visits: [],
    visitId: '',
    visitLabel: '',
    ready: false,
    hint: '先选一位患者和一次记录。',
    error: '',
    loading: false,

    /* ---- 判读提示 ---- */
    ruleGroups: [],
    ruleTotal: 0,

    /* ---- 依脉用方（讲稿原序） ---- */
    formulaGroups: [],
    formulaTotal: 0,

    /* ---- 分组维度与筛选 ---- */
    dim: 'route',
    dimOptions: DIM_OPTIONS,
    dimHint: '',
    dimSuffix: '',
    wuxingChips: [],
    handChips: [],

    /* ---- 分组视图（按五行／按左右手） ---- */
    dimFormulaGroups: [],
    dimDrugGroups: [],
    dimEmpty: false,

    /* ---- 用药禁忌（常驻） ---- */
    standingItems: [],

    /* ---- 附表一（讲义 p46） ---- */
    constitutionRows: [],

    /* ---- 讲义 p42 原文对照（28 行） ---- */
    refRows: [],

    /* ---- 方剂备查（同和堂版） ---- */
    thDoseGroups: [],
    thScienceRows: [],

    /* ---- 方剂备查（讲稿 2010·叁、用方） ---- */
    draftDrugGroups: [],
  },

  onLoad() {
    this._filter = { wuxing: DIM_ORDER.wuxing.slice(), hand: DIM_ORDER.hand.slice() }
    this._dim = 'route'
    this._visits = []
    this._layout = 'nine'
    this.buildStatic()
    this.loadPatients()
  },

  /** 患者列表 */
  async loadPatients() {
    try {
      const patients = await data.listPatients()
      this.setData({ patients: patients, error: '' })
      if (this.data.patientId) {
        const still = patients.filter((p) => p.id === this.data.patientId)[0]
        if (!still) {
          this.setData({ patientId: '', visitId: '', visits: [] })
          this._visits = []
          this.rebuild()
          return
        }
        await this.loadPatient(this.data.patientId, true)
      }
    } catch (e) {
      this.setData({ error: (e && e.message) || '读取失败' })
    }
  },

  /** 选患者：取其全部就诊记录 */
  async selectPatient(e) {
    const id = e.currentTarget.dataset.id
    if (id === this.data.patientId) return
    await this.loadPatient(id, false)
  },

  async loadPatient(id, keepVisit) {
    this.setData({ loading: true })
    try {
      const patient = await data.getPatient(id)
      if (!patient) {
        this.setData({ error: '没有这位患者的记录' })
        return
      }
      this._layout = patient.layout === 'seven' ? 'seven' : 'nine'
      const visits = patient.visits || []
      this._visits = visits
      const disp = visits.map((v) => ({
        id: v.id,
        label: v.label || '（未命名日期）',
        atText: v.at ? formatAt(v.at) : '',
      }))
      let visitId = ''
      if (keepVisit) {
        const exist = disp.filter((v) => v.id === this.data.visitId)[0]
        if (exist) visitId = exist.id
      }
      if (!visitId && disp.length) visitId = disp[disp.length - 1].id
      this.setData({
        patientId: id,
        patientName: patient.name || '',
        visits: disp,
        visitId: visitId,
        error: '',
      })
      this.rebuild()
    } catch (e) {
      this.setData({ error: (e && e.message) || '读取失败' })
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 选记录（日期） */
  selectVisit(e) {
    const id = e.currentTarget.dataset.id
    if (id === this.data.visitId) return
    this.setData({ visitId: id })
    this.rebuild()
  },

  /** 切分组维度 */
  setDim(e) {
    const key = e.currentTarget.dataset.key
    if (key === this._dim) return
    this._dim = key
    this.rebuild()
  },

  /** 点一下开／关一组 */
  toggleGroup(e) {
    const dim = e.currentTarget.dataset.dim
    const key = e.currentTarget.dataset.key
    const cur = this._filter[dim]
    const on = cur.indexOf(key) >= 0
    const order = DIM_ORDER[dim]
    const next = []
    for (let i = 0; i < order.length; i++) {
      const k = order[i]
      if (k === key) {
        if (!on) next.push(k)
      } else if (cur.indexOf(k) >= 0) {
        next.push(k)
      }
    }
    this._filter[dim] = next
    this.rebuild()
  },

  /** 全选 */
  selectAll(e) {
    const dim = e.currentTarget.dataset.dim
    this._filter[dim] = DIM_ORDER[dim].slice()
    this.rebuild()
  },

  /** 清空 */
  clearAll(e) {
    const dim = e.currentTarget.dataset.dim
    this._filter[dim] = []
    this.rebuild()
  },

  /** 构造判读上下文（写法同网站 `src/export/text.ts`） */
  buildCtx(visit) {
    const values = visit.values || {}
    const groups = groupRows(this._layout)
    return {
      layout: this._layout,
      get: (hand, organ, depth) => values[cellKey(hand, organ, depth)] || [],
      depths: (organ) => {
        for (let i = 0; i < groups.length; i++) {
          if (groups[i].organ === organ) {
            return groups[i].rows.map((r) => r.depth)
          }
        }
        return []
      },
    }
  },

  /** 重新算一遍并拼装展示数据 */
  rebuild() {
    const visit = this._visits.filter((v) => v.id === this.data.visitId)[0]
    if (!this.data.patientId || !visit) {
      this.setData({
        ready: false,
        hint: '先选一位患者和一次记录。',
        ruleGroups: [],
        ruleTotal: 0,
        formulaGroups: [],
        formulaTotal: 0,
        dimFormulaGroups: [],
        dimDrugGroups: [],
        dimEmpty: false,
      })
      return
    }

    const visitLabel = visit.label || '（未命名日期）'
    const ctx = this.buildCtx(visit)

    /* ---- 判读提示（按 severity 分组） ---- */
    const hits = evaluateRules(ctx)
    const ruleGroups = []
    const sevs = ['high', 'warn', 'info']
    for (let i = 0; i < sevs.length; i++) {
      const sev = sevs[i]
      const items = hits
        .filter((h) => h.severity === sev)
        .map((h) => fmtRule(h, visitLabel))
      if (items.length) {
        ruleGroups.push({ key: sev, label: SEVERITY_LABEL[sev], items: items })
      }
    }

    /* ---- 依脉用方（讲稿原序，按 route 分组） ---- */
    const fh = evaluateFormulas(ctx)
    const routeMap = {}
    const routeOrder = []
    for (let i = 0; i < fh.length; i++) {
      const r = fh[i].route
      if (!routeMap[r]) {
        routeMap[r] = []
        routeOrder.push(r)
      }
      routeMap[r].push(fh[i])
    }
    const order = FORMULA_ROUTE_ORDER.concat(
      routeOrder.filter((r) => FORMULA_ROUTE_ORDER.indexOf(r) < 0),
    )
    const formulaGroups = []
    for (let i = 0; i < order.length; i++) {
      const r = order[i]
      if (!routeMap[r]) continue
      const items = routeMap[r].map((h) => fmtFormula(h, visitLabel, false))
      formulaGroups.push({ route: r, items: items })
    }

    /* ---- 常驻条目（不依脉象） ---- */
    const standingHits = STANDING_FORMULA_RULES.map((rule) =>
      Object.assign({}, rule, {
        condition: STANDING_DISPLAY[rule.id] || rule.therapy,
        cells: [],
      }),
    )

    /* ---- 两个维度的分组（含常驻条目） ---- */
    const allItems = fh.concat(standingHits)
    const wuxingGroups = groupByWuxing(allItems, (h) => h.id)
    const handGroups = groupByHand(allItems, (h) => h.id)
    const wuxingDrugGroups = groupByWuxing(DRUGS, (d) => d.id)
    const handDrugGroups = groupByHand(DRUGS, (d) => d.id)

    const dim = this._dim
    /* 「讲稿原序」不设分组筛选 —— 分组视图只在按五行／按左右手时出现 */
    const dimGroups = dim === 'wuxing' ? wuxingGroups : dim === 'hand' ? handGroups : []
    const dimDrugGroupsAll =
      dim === 'wuxing' ? wuxingDrugGroups : dim === 'hand' ? handDrugGroups : []
    const active = this._filter[dim]

    /* 筛选后的分组（「未归类」为异常兜底组，始终保留） */
    const shownGroups = dimGroups.filter((g) => g.key === '未归类' || active.indexOf(g.key) >= 0)
    const shownDrugGroups = dimDrugGroupsAll.filter(
      (g) => g.key === '未归类' || active.indexOf(g.key) >= 0,
    )

    const dimFormulaGroups = shownGroups.map((g) => ({
      key: g.key,
      label: g.label,
      note: g.note,
      items: mergeByRule(g.items, visitLabel).map((m) => {
        const isStanding = STANDING_IDS.indexOf(m.item.id) >= 0
        const item = fmtFormula(m.item, visitLabel, isStanding)
        item.srcLine = isStanding
          ? '〔' + m.item.source + '〕· 常驻条目（不依脉象）'
          : '〔' + m.item.source + '〕· 命中记录 ' + m.sessions.join('、')
        return item
      }),
    }))
    const dimDrugGroups = shownDrugGroups.map((g) => ({
      key: g.key,
      label: g.label,
      note: g.note,
      items: g.items.map((d) => fmtDrug(d, true)),
    }))

    /* 筛选 chip：组名 ＋ 本组条目数 ＋ 方剂数 */
    const buildChips = (dimName, groups, drugGroups) => {
      const out = []
      const keys = DIM_ORDER[dimName]
      const cur = this._filter[dimName]
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        const g = groups.filter((x) => x.key === key)[0]
        const d = drugGroups.filter((x) => x.key === key)[0]
        out.push({
          key: key,
          label: groupShortLabel(dimName, key),
          rules: g ? mergeByRule(g.items, visitLabel).length : 0,
          drugs: d ? d.items.length : 0,
          on: cur.indexOf(key) >= 0,
        })
      }
      return out
    }
    const wuxingChips = buildChips('wuxing', wuxingGroups, wuxingDrugGroups)
    const handChips = buildChips('hand', handGroups, handDrugGroups)

    let dimHint = '依讲稿原序排列：讲义 p44「依脉用方」四个挡路 → 讲稿第四~六讲「清挡路一~六」→ 讲稿第二讲「叁、用方」「肆、依脉辨证论治」。讲稿原序不设分组筛选。'
    if (dim === 'wuxing') {
      dimHint = '按讲稿 2010·第一讲「五行归类」木火土金水→肝心脾肺肾重排；脏位对应据讲义 2026-10·p30（木＝左手关、火＝左手寸、土＝右手关、金＝右手寸、水＝尺）。'
    } else if (dim === 'hand') {
      dimHint = '按讲义 2026-10·p30 的左右手脏位重排：左手＝寸心关肝（血分）、右手＝寸肺关脾（气分）、尺＝肾；主脉位横跨左右者入「双手相兼」。'
    }

    this.setData({
      ready: true,
      hint: '',
      visitLabel: visitLabel,
      ruleGroups: ruleGroups,
      ruleTotal: hits.length,
      formulaGroups: formulaGroups,
      formulaTotal: fh.length,
      dim: dim,
      dimHint: dimHint,
      dimSuffix: dim === 'route' ? '' : ' · ' + (dim === 'wuxing' ? '按五行' : '按左右手'),
      wuxingChips: wuxingChips,
      handChips: handChips,
      dimFormulaGroups: dimFormulaGroups,
      dimDrugGroups: dimDrugGroups,
      dimEmpty: dimFormulaGroups.length === 0 && dimDrugGroups.length === 0,
    })
  },

  /**
   * 与「方剂备查」「原文对照」无关、但每次都要重算的部分。
   * 这些内容与选中的记录无关，放到 onLoad 算一次即可（数据量不小，每次重算会拖慢页面）。
   */
  buildStatic() {
    /* 用药禁忌（常驻）：不依脉象，与选中的记录无关 */
    const standingItems = STANDING_FORMULA_RULES.map((rule) =>
      fmtFormula(
        Object.assign({}, rule, {
          condition: STANDING_DISPLAY[rule.id] || rule.therapy,
          cells: [],
        }),
        '',
        true,
      ),
    )

    /* 附表一（讲义 p46）：切 ／ 治疗 ／ 方 */
    const constitutionRows = CONSTITUTION_TABLE.map((row) => ({
      mark: row.mark,
      therapy: row.therapy,
      formulas: row.formulas.join('｜'),
    }))

    /* 讲义 p42「依脉用方表」28 行 —— 两套剂量分栏，各带出处，查不到写「未载」 */
    const refRows = FORMULA_REFERENCE.map((r) => {
      const v = formulaDoseView(r)
      let th
      if (v.dose) {
        th = {
          missing: false,
          composition: v.dose.composition,
          notes: v.dose.notes || [],
          science: v.science ? v.science.ratio : '',
          src: '〔' + v.dose.name + '｜同和堂版 p' + v.dose.page + ' · 单位：克〕',
        }
      } else {
        const miss = v.missing.filter((m) => m.indexOf('同和堂版') === 0)
        th = {
          missing: true,
          composition: miss.length ? miss.join('；') : '同和堂版《方剂汇总统表》未载其组成',
          notes: [],
          science: '',
          src: '',
        }
      }
      let draft
      if (v.drug) {
        draft = {
          missing: false,
          composition: v.drug.composition || '',
          usage: v.drug.usage || '',
          science: v.drug.science || '',
          adjustments: v.drug.adjustments || [],
          contraindication: v.drug.contraindication || '',
          src: '〔' + v.drug.source + '·组成用比例制〕',
        }
      } else if (v.draftExtra) {
        draft = {
          missing: false,
          composition: v.draftExtra.composition || '',
          usage: '',
          science: '',
          adjustments: v.draftExtra.note ? [v.draftExtra.note] : [],
          contraindication: '',
          src: '〔' + v.draftExtra.source + '·组成用比例制〕',
        }
      } else {
        const miss = v.missing.filter((m) => m.indexOf('讲稿') === 0)
        draft = {
          missing: true,
          composition: miss.length ? miss.join('；') : '讲稿 2010 未载其组成',
          usage: '',
          science: '',
          adjustments: [],
          contraindication: '',
          src: '',
        }
      }
      return {
        no: r.no,
        name: r.name,
        indication: r.indication,
        th: th,
        draft: draft,
        basis: r.doseBasis || '',
      }
    })

    /* 方剂备查（同和堂版）：第 1~3 页成方 ＋ 第 4 页「科中」 */
    const thDoseGroups = []
    for (let page = 1; page <= 3; page++) {
      const items = FORMULA_DOSES.filter((d) => d.page === page).map((d) => {
        const sciName = DOSE_SCIENCE_NAME[d.id]
        const sci = sciName ? FORMULA_SCIENCE_BY_NAME[sciName] : null
        return {
          id: d.id,
          name: d.name,
          composition: d.composition,
          notes: d.notes || [],
          science: sci ? sci.ratio : '',
          src: '〔《臧氏脉学方剂汇总统表（同和堂版）》· 第 ' + d.page + ' 页 · 单位：克〕',
        }
      })
      thDoseGroups.push({ page: page, items: items })
    }
    const thScienceRows = FORMULA_SCIENCES.map((s) => ({
      id: s.id,
      name: s.name,
      ratio: s.ratio,
      src: '〔《臧氏脉学方剂汇总统表（同和堂版）》· 第 ' + s.page + ' 页 · 单位：g〕',
    }))

    /* 方剂备查（讲稿 2010·叁、用方）：按三种疗法 */
    const draftDrugGroups = DRUG_GROUPS.map((g) => ({
      title: g.title,
      items: DRUGS.filter((d) => d.therapy === g.therapy).map((d) => fmtDrug(d, false)),
    }))

    this.setData({
      standingItems: standingItems,
      constitutionRows: constitutionRows,
      refRows: refRows,
      thDoseGroups: thDoseGroups,
      thScienceRows: thScienceRows,
      draftDrugGroups: draftDrugGroups,
    })
  },
})

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
