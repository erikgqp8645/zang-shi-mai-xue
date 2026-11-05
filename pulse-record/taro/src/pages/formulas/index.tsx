import { useMemo, useState } from 'react'
import { Input, Text, View } from '@tarojs/components'

import {
  CONSTITUTION_TABLE,
  FORMULA_ROUTE_ORDER,
  FORMULA_RULES,
  STANDING_FORMULA_RULES,
} from '@domain/formulas'
import type { FormulaRule } from '@domain/formulas'
import {
  DIM_ORDER,
  RULE_OR_DRUG_ATTRIB,
  STANDING_DISPLAY,
  groupByHand,
  groupByWuxing,
  groupShortLabel,
} from '@domain/grouping'
import type { Attribution, Group } from '@domain/grouping'
import { DRUGS, DRUG_BY_ID, DRUG_GROUPS } from '@domain/drugs'
import type { Drug } from '@domain/drugs'
import {
  DOSE_SCIENCE_NAME,
  FORMULA_DOSES,
  FORMULA_SCIENCES,
  FORMULA_SCIENCE_BY_NAME,
} from '@domain/formula-table'
import { FORMULA_REFERENCE, formulaDoseView } from '@domain/medication'
import { draftDoseView, thDoseView } from '@domain/dose-lookup'
import type { DoseSourceView } from '@domain/dose-lookup'
import { RULES } from '@domain/rules'
import type { Severity } from '@domain/rules'

import './index.scss'

/**
 * tab 3 · 用方 —— **纯知识库浏览页**
 *
 * 迁移自原生版 `miniprogram/pages/findings/`（依脉用方），逐区块对照：
 *
 * | 原生区块 | 本页 |
 * |---|---|
 * | 选择记录（患者 ＋ 日期 chip） | **删掉** —— 上下文由全局上下文条负责，本页与患者无关 |
 * | 判读提示（命中条目 ＋ 命中的格子） | 改成**静态清单**：讲稿点名的脉象组合逐条原文照录，命中与否在「就诊」页比对（位置仍在第二位） |
 * | 依脉用方 · 讲稿原序 | 迁 —— 但**列出全部条目**（原生只列命中的；本页没有脉象可命中） |
 * | 分组维度与筛选（按五行／按左右手） | 迁 —— 纯知识筛选，与上下文无关；按新结构**上移到顶部**（顶部＝搜索框 ＋ 分组筛选 chip） |
 * | 依脉开方 · 按五行／按左右手 | 迁 |
 * | 方剂备查（讲稿 2010·叁、用方） | 迁 |
 * | 用药禁忌（常驻） | 迁 |
 * | 附表一体质用药对照（讲义 p46） | 迁 |
 * | 讲义 p42「依脉用方表」原文对照（28 行） | 迁 |
 * | 方剂备查（同和堂版《方剂汇总统表》） | 迁 |
 * | 声明 | 迁（措辞随页面职责微调） |
 *
 * ## 纪律
 *
 * - 术语沿用讲稿／讲义原文用字：病油子、清挡路、有尺脉、上盛下虚、
 *   依脉辨证论治、三焦疗法／五脏疗法／一体疗法（三法并列，不合并）。
 * - 出处标注照抄：讲义内容标 `讲义 2026-10·pNN`，讲稿标 `讲稿 2010·第N讲`，
 *   同和堂版标 `同和堂版 pN`。
 * - **两套剂量单位不可换算、不可合并**：同和堂版＝克，讲稿 2010＝比例制，分栏标注。
 * - **两套体质命名体系不可互换**：讲稿 2010（肾虚／上盛下虚／有尺脉）与
 *   讲义 2026-10（1／2／3 号）是两条资料线，各标各的出处。
 * - 不替读者加减方、不下诊断。
 *
 * 知识库 domain **只在本页 import**（见 `docs/taro-migration.md` §8 包体）。
 */

/* -------------------------------------------------------------------------- */
/* 视图模型                                                                    */
/* -------------------------------------------------------------------------- */

/** 归类信息（照网站 AttrChip ／ AttrBasis 的内容） */
interface AttrView {
  main: string
  also: string
  site: string
  basis: string
}

/** 一条组成（来自某一套资料） */
interface DoseEntryView {
  name: string
  composition: string
  science: string
  usage: string
  source: string
  basis: string
}

/** 一套资料的组成（同和堂版·克 ／ 讲稿 2010·比例制） */
interface DoseBlockView {
  label: string
  missing: boolean
  note: string
  showName: boolean
  entries: DoseEntryView[]
}

/** 一行「方名 → 两套组成」 */
interface DoseLineView {
  name: string
  th: DoseBlockView
  draft: DoseBlockView
}

/** 一张方剂卡 */
interface DrugView {
  id: string
  name: string
  therapy: string
  composition: string
  usage: string
  science: string
  indication: string
  adjustments: string[]
  contraindication: string
  source: string
  attr: AttrView | null
}

/** 一条依脉用方条目 */
interface FormulaView {
  id: string
  kind: string
  condition: string
  therapy: string
  formulas: string[]
  adds: string[]
  addsText: string
  quote: string
  source: string
  attr: AttrView | null
  doseLines: DoseLineView[]
  drugCards: DrugView[]
  srcLine: string
}

/** 分组（含标签与归类依据） */
interface FormulaGroupView {
  key: string
  label: string
  note: string
  items: FormulaView[]
}

interface DrugGroupView {
  key: string
  label: string
  note: string
  items: DrugView[]
}

/** 分组筛选 chip */
interface ChipView {
  key: string
  label: string
  rules: number
  drugs: number
  on: boolean
}

/** 讲义 p42「依脉用方表」一行 */
interface RefRowView {
  no: number
  name: string
  indication: string
  th: {
    missing: boolean
    composition: string
    notes: string[]
    science: string
    src: string
  }
  draft: {
    missing: boolean
    composition: string
    usage: string
    science: string
    adjustments: string[]
    contraindication: string
    src: string
  }
  basis: string
}

/** 讲义 p46 附表一行 */
interface ConstitutionRowView {
  mark: string
  therapy: string
  formulas: string
}

/** 同和堂版成方（第 1~3 页） */
interface ThDoseView {
  id: string
  name: string
  composition: string
  notes: string[]
  science: string
  src: string
}

/** 同和堂版第 4 页「科中」 */
interface ThScienceView {
  id: string
  name: string
  ratio: string
  src: string
}

/** 判读规则（静态清单） */
interface RuleView {
  id: string
  title: string
  severity: Severity
  severityLabel: string
  detail: string
  source: string
}

interface RuleGroupView {
  key: string
  label: string
  items: RuleView[]
}

/* -------------------------------------------------------------------------- */
/* 常量                                                                        */
/* -------------------------------------------------------------------------- */

/** severity → 徽标文字（与网站一致） */
const SEVERITY_LABEL: Record<Severity, string> = { high: '高危', warn: '提示', info: '参考' }

/** 分组维度（与网站一致：讲稿原序 ／ 按五行 ／ 按左右手） */
type DimKey = 'route' | 'wuxing' | 'hand'

const DIM_OPTIONS: { key: DimKey; label: string }[] = [
  { key: 'route', label: '讲稿原序' },
  { key: 'wuxing', label: '按五行' },
  { key: 'hand', label: '按左右手' },
]

/** 各维度的说明（照抄原生版） */
const DIM_HINT: Record<DimKey, string> = {
  route:
    '依讲稿原序排列：讲义 p44「依脉用方」四个挡路 → 讲稿第四~六讲「清挡路一~六」→ 讲稿第二讲「叁、用方」「肆、依脉辨证论治」。讲稿原序不设分组筛选。',
  wuxing:
    '按讲稿 2010·第一讲「五行归类」木火土金水→肝心脾肺肾重排；脏位对应据讲义 2026-10·p30（木＝左手关、火＝左手寸、土＝右手关、金＝右手寸、水＝尺）。',
  hand:
    '按讲义 2026-10·p30 的左右手脏位重排：左手＝寸心关肝（血分）、右手＝寸肺关脾（气分）、尺＝肾；主脉位横跨左右者入「双手相兼」。',
}

/** 常驻条目的 id（三不用／白虎汤肾气丸） */
const STANDING_IDS = STANDING_FORMULA_RULES.map((r) => r.id)

/** 「讲稿原序」维度没有分组筛选 —— 用一个常量空数组，免得每次 render 都换引用 */
const EMPTY_KEYS: string[] = []

/* -------------------------------------------------------------------------- */
/* 取值与拼装（照搬原生版 findings.js 的同一套拼装）                            */
/* -------------------------------------------------------------------------- */

/** 归类信息（照网站 AttrChip ／ AttrBasis 的内容） */
function attrText(attr?: Attribution): AttrView | null {
  if (!attr) return null
  return {
    main: attr.wuxing + '·' + attr.zang,
    also: attr.also && attr.also.length ? '兼' + attr.also.join('') : '',
    site: attr.site || '',
    basis: attr.basis || '',
  }
}

/** 一套资料的组成（同和堂版·克 ／ 讲稿 2010·比例制） */
function fmtDoseView(view: DoseSourceView, label: string): DoseBlockView {
  if (!view || view.matched === 'none') {
    return { label: label, missing: true, note: '', showName: false, entries: [] }
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

/** 一张方剂卡 */
function fmtDrug(d: Drug, withAttr: boolean): DrugView {
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

/**
 * 一条依脉用方条目。
 *
 * 与原生版的差别只有一处：**出处行不再缀「· 记录 <日期>」** —— 本页没有患者记录。
 * 其余（加减药不查成方、讲稿侧已出方剂卡片时只补同和堂版那一套）逐条照搬。
 */
function fmtFormula(rule: FormulaRule, isStanding: boolean): FormulaView {
  const attr = attrText(RULE_OR_DRUG_ATTRIB[rule.id])
  const formulas = rule.formulas || []
  const adds = rule.adds || []
  /** 讲稿侧若已出方剂卡片，剂量行只补同和堂版那一套（免得与卡片重复） */
  const hasDrugCard = !!(rule.drugs && rule.drugs.length)
  const doseLines: DoseLineView[] = []
  for (const name of formulas) {
    /* 加减药不是方名（如「知柏」「羌活」），不去查成方 */
    if (adds.indexOf(name) >= 0) continue
    const th = thDoseView(name)
    const draft = hasDrugCard
      ? ({ matched: 'none', entries: [], unit: '' } as DoseSourceView)
      : draftDoseView(name)
    if (th.matched === 'none' && draft.matched === 'none') continue
    doseLines.push({
      name: name,
      th: fmtDoseView(th, '同和堂版（克）'),
      draft: fmtDoseView(draft, '讲稿 2010（比例制）'),
    })
  }
  const drugCards: DrugView[] = []
  for (const id of rule.drugs || []) {
    const d = DRUG_BY_ID[id]
    if (d) drugCards.push(fmtDrug(d, false))
  }
  return {
    id: rule.id,
    kind: rule.kind,
    condition: rule.condition,
    therapy: rule.therapy,
    formulas: formulas,
    adds: adds,
    addsText: adds.join('、'),
    quote: rule.quote,
    source: rule.source,
    attr: attr,
    doseLines: doseLines,
    drugCards: drugCards,
    srcLine: isStanding ? '〔' + rule.source + '〕· 常驻条目（不依脉象）' : '〔' + rule.source + '〕',
  }
}

/* -------------------------------------------------------------------------- */
/* 静态数据（与患者／记录无关，算一次即可）                                     */
/* -------------------------------------------------------------------------- */

/** 依脉用方 · 讲稿原序 —— 按 route 分组（常驻条目另立一节，不在此重复） */
const ROUTE_GROUPS: { route: string; items: FormulaView[] }[] = (() => {
  const map = new Map<string, FormulaRule[]>()
  for (const rule of FORMULA_RULES) {
    if (rule.always) continue
    const list = map.get(rule.route)
    if (list) list.push(rule)
    else map.set(rule.route, [rule])
  }
  const extra: string[] = []
  map.forEach((_, route) => {
    if (FORMULA_ROUTE_ORDER.indexOf(route) < 0) extra.push(route)
  })
  const order = FORMULA_ROUTE_ORDER.concat(extra)
  const out: { route: string; items: FormulaView[] }[] = []
  for (const route of order) {
    const rules = map.get(route)
    if (!rules) continue
    out.push({ route: route, items: rules.map((r) => fmtFormula(r, false)) })
  }
  return out
})()

/** 两个维度的用方条目分组（含常驻条目） */
function ruleGroupsBy(dim: 'wuxing' | 'hand'): FormulaGroupView[] {
  const groups: Group<FormulaRule>[] =
    dim === 'wuxing'
      ? groupByWuxing(FORMULA_RULES, (r) => r.id)
      : groupByHand(FORMULA_RULES, (r) => r.id)
  return groups.map((g) => ({
    key: g.key,
    label: g.label,
    note: g.note,
    items: g.items.map((r) => fmtFormula(r, STANDING_IDS.indexOf(r.id) >= 0)),
  }))
}

/** 两个维度的方剂分组 */
function drugGroupsBy(dim: 'wuxing' | 'hand'): DrugGroupView[] {
  const groups: Group<Drug>[] =
    dim === 'wuxing' ? groupByWuxing(DRUGS, (d) => d.id) : groupByHand(DRUGS, (d) => d.id)
  return groups.map((g) => ({
    key: g.key,
    label: g.label,
    note: g.note,
    items: g.items.map((d) => fmtDrug(d, true)),
  }))
}

const WUXING_RULE_GROUPS = ruleGroupsBy('wuxing')
const HAND_RULE_GROUPS = ruleGroupsBy('hand')
const WUXING_DRUG_GROUPS = drugGroupsBy('wuxing')
const HAND_DRUG_GROUPS = drugGroupsBy('hand')

/** 分组筛选 chip：组名 ＋ 本组条目数 ＋ 方剂数 */
function buildChips(
  dimName: 'wuxing' | 'hand',
  ruleGroups: FormulaGroupView[],
  drugGroups: DrugGroupView[],
  active: string[],
): ChipView[] {
  const out: ChipView[] = []
  const keys = DIM_ORDER[dimName]
  for (const key of keys) {
    const g = ruleGroups.filter((x) => x.key === key)[0]
    const d = drugGroups.filter((x) => x.key === key)[0]
    out.push({
      key: key,
      label: groupShortLabel(dimName, key),
      rules: g ? g.items.length : 0,
      drugs: d ? d.items.length : 0,
      on: active.indexOf(key) >= 0,
    })
  }
  return out
}

/** 用药禁忌（常驻）：不依脉象，与记录无关 */
const STANDING_ITEMS: FormulaView[] = STANDING_FORMULA_RULES.map((rule) =>
  fmtFormula(
    Object.assign({}, rule, {
      condition: STANDING_DISPLAY[rule.id] || rule.therapy,
    }),
    true,
  ),
)

/** 附表一（讲义 p46）：切 ／ 治疗 ／ 方 */
const CONSTITUTION_ROWS: ConstitutionRowView[] = CONSTITUTION_TABLE.map((row) => ({
  mark: row.mark,
  therapy: row.therapy,
  formulas: row.formulas.join('｜'),
}))

/** 讲义 p42「依脉用方表」28 行 —— 两套剂量分栏，各带出处，查不到写「未载」 */
const REF_ROWS: RefRowView[] = FORMULA_REFERENCE.map((r) => {
  const v = formulaDoseView(r)
  let th: RefRowView['th']
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
  let draft: RefRowView['draft']
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

/** 方剂备查（同和堂版）：第 1~3 页成方 */
const TH_DOSE_GROUPS: { page: number; items: ThDoseView[] }[] = (() => {
  const out: { page: number; items: ThDoseView[] }[] = []
  for (let page = 1; page <= 3; page += 1) {
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
    out.push({ page: page, items: items })
  }
  return out
})()

/** 方剂备查（同和堂版）：第 4 页「科中」科学中药比例 */
const TH_SCIENCE_ROWS: ThScienceView[] = FORMULA_SCIENCES.map((s) => ({
  id: s.id,
  name: s.name,
  ratio: s.ratio,
  src: '〔《臧氏脉学方剂汇总统表（同和堂版）》· 第 ' + s.page + ' 页 · 单位：g〕',
}))

/** 方剂备查（讲稿 2010·叁、用方）：按三种疗法 */
const DRAFT_DRUG_GROUPS: { title: string; items: DrugView[] }[] = DRUG_GROUPS.map((g) => ({
  title: g.title,
  items: DRUGS.filter((d) => d.therapy === g.therapy).map((d) => fmtDrug(d, false)),
}))

/** 判读规则 —— 静态清单（讲稿点名的脉象组合，原文照录） */
const RULE_GROUPS: RuleGroupView[] = (() => {
  const sevs: Severity[] = ['high', 'warn', 'info']
  const out: RuleGroupView[] = []
  for (const sev of sevs) {
    const items = RULES.filter((r) => r.severity === sev).map((r) => ({
      id: r.id,
      title: r.title,
      severity: r.severity,
      severityLabel: SEVERITY_LABEL[r.severity] || '',
      detail: r.detail,
      source: r.source,
    }))
    if (items.length) out.push({ key: sev, label: SEVERITY_LABEL[sev], items: items })
  }
  return out
})()

/* -------------------------------------------------------------------------- */
/* 搜索                                                                        */
/* -------------------------------------------------------------------------- */

/** 关键词匹配器（空关键词＝全中） */
function makeMatcher(kw: string) {
  const k = kw.trim()
  return (...texts: (string | undefined)[]): boolean => {
    if (!k) return true
    for (const t of texts) {
      if (t && t.indexOf(k) >= 0) return true
    }
    return false
  }
}

/** 一条用方条目的可检索文本 */
function formulaBlob(f: FormulaView): string {
  const dose = f.doseLines
    .map(
      (l) =>
        l.name +
        ' ' +
        l.th.entries.map((e) => e.composition).join(' ') +
        ' ' +
        l.draft.entries.map((e) => e.composition).join(' '),
    )
    .join(' ')
  const cards = f.drugCards
    .map((d) => [d.name, d.composition, d.usage, d.indication].join(' '))
    .join(' ')
  return [f.condition, f.therapy, f.formulas.join(' '), f.addsText, f.quote, f.source, dose, cards].join(' ')
}

/** 一张方剂卡的可检索文本 */
function drugBlob(d: DrugView): string {
  return [
    d.name,
    d.composition,
    d.usage,
    d.science,
    d.indication,
    d.adjustments.join(' '),
    d.contraindication,
    d.source,
  ].join(' ')
}

/* -------------------------------------------------------------------------- */
/* 展示组件                                                                    */
/* -------------------------------------------------------------------------- */

/** 一套资料的组成（克 ／ 比例制，分栏标注，不可互相换算） */
function DoseBlock({ block }: { block: DoseBlockView }) {
  if (block.missing) {
    return (
      <View className='pr-dose-block'>
        <Text className='pr-dose-tag'>{block.label}</Text>
        <Text className='pr-dose-none'>未载</Text>
      </View>
    )
  }
  return (
    <View className='pr-dose-block'>
      <Text className='pr-dose-tag'>
        {block.label}
        {block.note}
      </Text>
      {block.entries.map((e, i) => (
        <View key={e.name + '-' + i} className='pr-dose-entry'>
          {block.showName ? <Text>{e.name}：</Text> : null}
          {e.composition}
          {e.science ? <Text className='pr-dose-sci'>　科中：{e.science}</Text> : null}
          {e.usage ? <Text className='pr-dose-usage'>　服法：{e.usage}</Text> : null}
          <Text className='pr-dose-src'>〔{e.source}〕</Text>
          {e.basis ? <Text className='pr-dose-ref'>　对照：{e.basis}</Text> : null}
        </View>
      ))}
    </View>
  )
}

/** 一条依脉用方条目 */
function FormulaCard({ item }: { item: FormulaView }) {
  return (
    <View className='pr-formula'>
      <View className='pr-formula-head'>
        <Text className='pr-formula-kind'>{item.kind}</Text>
        <Text className='pr-formula-cond'>{item.condition}</Text>
      </View>
      <View className='pr-formula-therapy'>{item.therapy}</View>
      {item.formulas.length ? (
        <View className='pr-formula-names'>
          {item.formulas.map((f, i) => (
            <Text key={f + '-' + i} className='pr-formula-chip'>
              {f}
            </Text>
          ))}
        </View>
      ) : null}
      {item.adds.length ? (
        <View className='pr-formula-adds'>加减药（非方名，不查成方）：{item.addsText}</View>
      ) : null}
      <View className='pr-formula-quote'>{item.quote}</View>

      {/* 归类：also（兼涉）与 basis（归类依据） */}
      {item.attr ? (
        <View className='pr-attr'>
          <Text className='pr-attr-main'>{item.attr.main}</Text>
          {item.attr.also ? <Text className='pr-attr-also'>{item.attr.also}</Text> : null}
          <Text className='pr-attr-site'>{item.attr.site}</Text>
        </View>
      ) : null}
      {item.attr ? <View className='pr-attr-basis'>归类依据：{item.attr.basis}</View> : null}

      {/* 组成与剂量：两套资料并列，各带出处与单位，不可互相换算 */}
      {item.doseLines.map((dl, i) => (
        <View key={dl.name + '-' + i} className='pr-dose'>
          <View className='pr-dose-name'>{dl.name}</View>
          <DoseBlock block={dl.th} />
          <DoseBlock block={dl.draft} />
        </View>
      ))}

      {/* 讲稿 2010 的方剂卡片（原文照录） */}
      {item.drugCards.map((d) => (
        <DrugCard key={d.id} drug={d} />
      ))}

      <View className='pr-item-src'>{item.srcLine}</View>
    </View>
  )
}

/** 一张方剂卡（讲稿 2010 ／ 同和堂版通用） */
function DrugCard({ drug }: { drug: DrugView }) {
  return (
    <View className='pr-drug'>
      <View className='pr-drug-head'>
        <Text className='pr-drug-therapy'>{drug.therapy}</Text>
        <Text className='pr-drug-name'>{drug.name}</Text>
      </View>
      {drug.attr ? (
        <View className='pr-attr'>
          <Text className='pr-attr-main'>{drug.attr.main}</Text>
          {drug.attr.also ? <Text className='pr-attr-also'>{drug.attr.also}</Text> : null}
          <Text className='pr-attr-site'>{drug.attr.site}</Text>
        </View>
      ) : null}
      {drug.attr ? <View className='pr-attr-basis'>归类依据：{drug.attr.basis}</View> : null}
      {drug.composition ? (
        <View className='pr-drug-line'>
          <Text className='pr-drug-key'>组成</Text>
          {drug.composition}
        </View>
      ) : null}
      {drug.usage ? (
        <View className='pr-drug-line'>
          <Text className='pr-drug-key'>服法</Text>
          {drug.usage}
        </View>
      ) : null}
      {drug.science ? (
        <View className='pr-drug-line'>
          <Text className='pr-drug-key'>科学中药</Text>
          {drug.science}
        </View>
      ) : null}
      {drug.indication ? (
        <View className='pr-drug-line'>
          <Text className='pr-drug-key'>适用脉象</Text>
          {drug.indication}
        </View>
      ) : null}
      {drug.adjustments.length ? (
        <View className='pr-drug-line'>
          <Text className='pr-drug-key'>加减</Text>
          {drug.adjustments.map((a, i) => (
            <Text key={a + '-' + i} className='pr-drug-add'>
              · {a}
            </Text>
          ))}
        </View>
      ) : null}
      {drug.contraindication ? (
        <View className='pr-drug-line is-warn'>
          <Text className='pr-drug-key'>禁忌</Text>
          {drug.contraindication}
        </View>
      ) : null}
      <View className='pr-item-src'>〔{drug.source}〕</View>
    </View>
  )
}

/* -------------------------------------------------------------------------- */
/* 页面                                                                        */
/* -------------------------------------------------------------------------- */

export default function Formulas() {
  const [dim, setDim] = useState<DimKey>('route')
  const [kw, setKw] = useState('')
  const [filter, setFilter] = useState<{ wuxing: string[]; hand: string[] }>({
    wuxing: DIM_ORDER.wuxing.slice(),
    hand: DIM_ORDER.hand.slice(),
  })

  const view = useMemo(() => {
    const m = makeMatcher(kw)
    /** 当前维度下打开的组（「未归类」为异常兜底组，始终保留） */
    const active = dim === 'route' ? EMPTY_KEYS : filter[dim]

    /* 讲稿原序：本页没有脉象可命中 —— 列出全部条目 */
    const routeGroups = ROUTE_GROUPS.map((g) => ({
      route: g.route,
      items: g.items.filter((f) => m(formulaBlob(f))),
    })).filter((g) => g.items.length > 0)

    /* 按五行 ／ 按左右手 */
    const ruleGroups = dim === 'wuxing' ? WUXING_RULE_GROUPS : dim === 'hand' ? HAND_RULE_GROUPS : []
    const drugGroupsAll = dim === 'wuxing' ? WUXING_DRUG_GROUPS : dim === 'hand' ? HAND_DRUG_GROUPS : []
    const dimFormulaGroups = ruleGroups
      .filter((g) => g.key === '未归类' || active.indexOf(g.key) >= 0)
      .map((g) => ({
        key: g.key,
        label: g.label,
        note: g.note,
        items: g.items.filter((f) => m(formulaBlob(f))),
      }))
      .filter((g) => g.items.length > 0)
    const dimDrugGroups = drugGroupsAll
      .filter((g) => g.key === '未归类' || active.indexOf(g.key) >= 0)
      .map((g) => ({
        key: g.key,
        label: g.label,
        note: g.note,
        items: g.items.filter((d) => m(drugBlob(d))),
      }))
      .filter((g) => g.items.length > 0)

    /* 方剂备查（讲稿 2010·叁、用方） */
    const draftDrugGroups = DRAFT_DRUG_GROUPS.map((g) => ({
      title: g.title,
      items: g.items.filter((d) => m(drugBlob(d))),
    })).filter((g) => g.items.length > 0)

    /* 方剂备查（同和堂版） */
    const thDoseGroups = TH_DOSE_GROUPS.map((g) => ({
      page: g.page,
      items: g.items.filter(
        (d) => m(d.name, d.composition, d.science, d.notes.join(' ')),
      ),
    })).filter((g) => g.items.length > 0)
    const thScienceRows = TH_SCIENCE_ROWS.filter((s) => m(s.name, s.ratio))

    /* 用药禁忌（常驻）：不依脉象，始终列出，不受搜索影响 */
    /* 附表一（讲义 p46） */
    const constitutionRows = CONSTITUTION_ROWS.filter((r) => m(r.mark, r.therapy, r.formulas))

    /* 讲义 p42 原文对照 */
    const refRows = REF_ROWS.filter((r) =>
      m(
        r.name,
        r.indication,
        r.basis,
        r.th.composition,
        r.th.science,
        r.draft.composition,
        r.draft.usage,
      ),
    )

    /* 判读规则（静态清单） */
    const ruleGroupsOut = RULE_GROUPS.map((g) => ({
      key: g.key,
      label: g.label,
      items: g.items.filter((r) => m(r.title, r.detail, r.source)),
    })).filter((g) => g.items.length > 0)

    return {
      routeGroups: routeGroups,
      dimFormulaGroups: dimFormulaGroups,
      dimDrugGroups: dimDrugGroups,
      draftDrugGroups: draftDrugGroups,
      thDoseGroups: thDoseGroups,
      thScienceRows: thScienceRows,
      constitutionRows: constitutionRows,
      refRows: refRows,
      ruleGroups: ruleGroupsOut,
    }
  }, [dim, filter, kw])

  /* 分组筛选 chip */
  const wuxingChips = useMemo(
    () => buildChips('wuxing', WUXING_RULE_GROUPS, WUXING_DRUG_GROUPS, filter.wuxing),
    [filter.wuxing],
  )
  const handChips = useMemo(
    () => buildChips('hand', HAND_RULE_GROUPS, HAND_DRUG_GROUPS, filter.hand),
    [filter.hand],
  )

  /** 点一下开／关一组 */
  const toggleGroup = (dimName: 'wuxing' | 'hand', key: string) => {
    setFilter((prev) => {
      const cur = prev[dimName]
      const on = cur.indexOf(key) >= 0
      const next: string[] = []
      for (const k of DIM_ORDER[dimName]) {
        if (k === key) {
          if (!on) next.push(k)
        } else if (cur.indexOf(k) >= 0) {
          next.push(k)
        }
      }
      return { ...prev, [dimName]: next }
    })
  }

  /** 全选 */
  const selectAll = (dimName: 'wuxing' | 'hand') => {
    setFilter((prev) => ({ ...prev, [dimName]: DIM_ORDER[dimName].slice() }))
  }

  /** 清空 */
  const clearAll = (dimName: 'wuxing' | 'hand') => {
    setFilter((prev) => ({ ...prev, [dimName]: [] }))
  }

  const dimSuffix = dim === 'route' ? '' : ' · ' + (dim === 'wuxing' ? '按五行' : '按左右手')
  const ruleTotal = view.routeGroups.reduce((n, g) => n + g.items.length, 0)

  return (
    <View className='pr-page pr-yf'>
      {/* ========== 顶部：说明 ＋ 搜索 ＋ 分组筛选 ========== */}
      <View className='pr-card'>
        <View className='pr-card-title'>用方 · 知识库</View>
        <View className='pr-note'>
          本页只做知识浏览与原文对照：讲稿原序、按五行、按左右手、方剂备查（讲稿 2010·叁、用方 ／
          同和堂版）、用药禁忌、附表一体质用药对照（讲义 p46）、讲义 p42「依脉用方表」原文对照（28 行）。
          依脉判读要拿具体脉象来比对 —— 在「就诊」页录入脉象后进行；本页不代判、不下诊断，也不替使用者加减方。
        </View>
        <Input
          className='pr-input pr-search'
          value={kw}
          placeholder='搜方名／脉象条件／原文'
          onInput={(e) => setKw(e.detail.value)}
        />
        <View className='pr-note'>
          当前关键词「{kw.trim() || '（无）'}」；讲稿原序共 {ruleTotal} 条用方条目。
        </View>
      </View>

      <View className='pr-card'>
        <View className='pr-card-title'>分组维度与筛选</View>
        <View className='pr-chips'>
          {DIM_OPTIONS.map((o) => (
            <View
              key={o.key}
              className={'pr-chip' + (dim === o.key ? ' pr-chip-on' : '')}
              onClick={() => setDim(o.key)}
            >
              {o.label}
            </View>
          ))}
        </View>
        <View className='pr-note'>{DIM_HINT[dim]}</View>

        <View className='pr-filter-row'>
          <View className='pr-filter-head'>
            <Text className='pr-filter-label'>按五行</Text>
            <Text className='pr-filter-act' onClick={() => selectAll('wuxing')}>
              全选
            </Text>
            <Text className='pr-filter-act' onClick={() => clearAll('wuxing')}>
              清空
            </Text>
          </View>
          <View className='pr-chips'>
            {wuxingChips.map((c) => (
              <View
                key={c.key}
                className={'pr-chip pr-chip-filter' + (c.on ? ' pr-chip-on' : '')}
                onClick={() => toggleGroup('wuxing', c.key)}
              >
                <Text className='pr-chip-name'>{c.label}</Text>
                <Text className='pr-chip-num'>
                  {c.rules}条 · {c.drugs}方
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View className='pr-filter-row'>
          <View className='pr-filter-head'>
            <Text className='pr-filter-label'>按左右手</Text>
            <Text className='pr-filter-act' onClick={() => selectAll('hand')}>
              全选
            </Text>
            <Text className='pr-filter-act' onClick={() => clearAll('hand')}>
              清空
            </Text>
          </View>
          <View className='pr-chips'>
            {handChips.map((c) => (
              <View
                key={c.key}
                className={'pr-chip pr-chip-filter' + (c.on ? ' pr-chip-on' : '')}
                onClick={() => toggleGroup('hand', c.key)}
              >
                <Text className='pr-chip-name'>{c.label}</Text>
                <Text className='pr-chip-num'>
                  {c.rules}条 · {c.drugs}方
                </Text>
              </View>
            ))}
          </View>
        </View>
        <View className='pr-note'>
          两排开关各自记住状态；切换上面的「分组维度」即按该维度筛选「依脉开方」与「方剂备查」。
        </View>
      </View>

      {/* ========== 判读规则（讲稿原文 · 静态清单） ========== */}
      <View className='pr-card'>
        <View className='pr-card-title'>判读规则（讲稿原文 · 静态清单）</View>
        <View className='pr-note'>
          讲稿明确点名的脉象组合，逐条原文照录。命中与否要拿具体脉象来比对 —— 在「就诊」页录入脉象后自动比对；
          这里只列清单，不下诊断。
        </View>
        {view.ruleGroups.map((group) => (
          <View key={group.key} className='pr-rule-group'>
            <View className='pr-rule-group-title'>
              {group.label}（{group.items.length}）
            </View>
            {group.items.map((r) => (
              <View key={r.id} className={'pr-item pr-item-' + r.severity}>
                <View className='pr-item-title'>
                  <Text className={'pr-badge is-' + r.severity}>{r.severityLabel}</Text>
                  {r.title}
                </View>
                <View className='pr-item-body'>{r.detail}</View>
                <View className='pr-item-src'>〔{r.source}〕</View>
              </View>
            ))}
          </View>
        ))}
      </View>

      {/* ========== 依脉用方（讲稿原序） ========== */}
      <View className='pr-card'>
        <View className='pr-card-title'>依脉用方 · 讲稿原序</View>
        <View className='pr-note'>
          讲义 p44「依脉用方」＋ p46 附表一「治疗」列，讲稿第二讲「叁、用方」「肆、依脉辨证论治」与第三~六讲方剂为补充 ·
          只照抄原文写明的方，不加减方。本页无脉象可比对，故逐条列出原文写明的全部条目。
        </View>
        {view.routeGroups.length ? null : (
          <View className='pr-empty'>当前关键词下没有用方条目。</View>
        )}
        {view.routeGroups.map((group) => (
          <View key={group.route} className='pr-formula-group'>
            <View className='pr-formula-route'>{group.route}</View>
            {group.items.map((item) => (
              <FormulaCard key={item.id} item={item} />
            ))}
          </View>
        ))}
      </View>

      {/* ========== 依脉用方（按五行 ／ 按左右手） ========== */}
      {dim !== 'route' ? (
        <View className='pr-card'>
          <View className='pr-card-title'>
            依脉开方 · {dim === 'wuxing' ? '按五行' : '按左右手'}
          </View>
          {view.dimFormulaGroups.length ? null : (
            <View className='pr-empty'>
              当前筛选下没有分组，请在上面的「分组筛选」里至少打开一组。
            </View>
          )}
          {view.dimFormulaGroups.map((group) => (
            <View key={group.key} className='pr-formula-group'>
              <View className='pr-formula-route'>{group.label}</View>
              <View className='pr-note'>{group.note}</View>
              {group.items.map((item) => (
                <FormulaCard key={item.id} item={item} />
              ))}
            </View>
          ))}
        </View>
      ) : null}

      {/* ========== 方剂备查（讲稿 2010·叁、用方） ========== */}
      <View className='pr-card'>
        <View className='pr-card-title'>方剂备查（讲稿 2010·叁、用方）{dimSuffix}</View>
        {dim === 'route' ? (
          <View className='pr-note'>
            三种疗法与讲稿写明的方剂组成、服法、加减与禁忌，原样转录，不替读者加减方。
          </View>
        ) : (
          <View className='pr-note'>
            同一方剂按脏腑／左右手归位；组成、服法、加减与禁忌仍照讲稿原样转录。
          </View>
        )}

        {/* 讲稿原序：按三种疗法 */}
        {dim === 'route'
          ? view.draftDrugGroups.map((group) => (
              <View key={group.title} className='pr-drug-group'>
                <View className='pr-drug-group-title'>{group.title}</View>
                {group.items.map((d) => (
                  <DrugCard key={d.id} drug={d} />
                ))}
              </View>
            ))
          : null}

        {/* 按五行／按左右手：按归属重排（受上面的筛选控制） */}
        {dim !== 'route'
          ? view.dimDrugGroups.map((group) => (
              <View key={group.key} className='pr-drug-group'>
                <View className='pr-drug-group-title'>{group.label}</View>
                <View className='pr-note'>{group.note}</View>
                {group.items.map((d) => (
                  <DrugCard key={d.id} drug={d} />
                ))}
              </View>
            ))
          : null}
        {dim !== 'route' && !view.dimDrugGroups.length ? (
          <View className='pr-empty'>
            当前筛选下没有方剂，请在上面的「分组筛选」里至少打开一组。
          </View>
        ) : null}
      </View>

      {/* ========== 用药禁忌（常驻） ========== */}
      <View className='pr-card'>
        <View className='pr-card-title'>用药禁忌（常驻）</View>
        <View className='pr-note'>不依赖脉象，始终列出。</View>
        {STANDING_ITEMS.map((item) => (
          <FormulaCard key={item.id} item={item} />
        ))}
      </View>

      {/* ========== 附表一体质用药对照（讲义 p46） ========== */}
      <View className='pr-card'>
        <View className='pr-card-title'>附表一体质用药对照（讲义 p46）</View>
        <View className='pr-note'>
          这一列要靠望、问、切多项合参才能定，本工具不据脉象自动判定，仅作对照参考。
        </View>
        {view.constitutionRows.length ? null : (
          <View className='pr-empty'>当前关键词下没有附表行。</View>
        )}
        {view.constitutionRows.map((r) => (
          <View key={r.mark} className='pr-ref'>
            <View className='pr-ref-row'>
              <Text className='pr-ref-k'>切</Text>
              <Text className='pr-ref-v'>{r.mark}</Text>
            </View>
            <View className='pr-ref-row'>
              <Text className='pr-ref-k'>治疗</Text>
              <Text className='pr-ref-v'>{r.therapy}</Text>
            </View>
            <View className='pr-ref-row'>
              <Text className='pr-ref-k'>方</Text>
              <Text className='pr-ref-v'>{r.formulas}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* ========== 讲义 p42「依脉用方表」原文对照（28 行） ========== */}
      <View className='pr-card'>
        <View className='pr-card-title'>讲义 p42「依脉用方表」原文对照（28 行）</View>
        <View className='pr-note'>
          原文照录，供查供抄；不是处方建议，不构成诊断。两套剂量单位不同（克 ／ 比例制），不可互相换算。
        </View>
        {view.refRows.length ? null : <View className='pr-empty'>当前关键词下没有对照行。</View>}
        {view.refRows.map((r) => (
          <View key={r.no} className='pr-ref'>
            <View className='pr-ref-head'>
              <Text className='pr-ref-no'>{r.no}</Text>
              <Text className='pr-ref-name'>{r.name}</Text>
            </View>
            <View className='pr-ref-row'>
              <Text className='pr-ref-k'>对应脉象及加减</Text>
              <Text className='pr-ref-v'>{r.indication}</Text>
            </View>
            <View className='pr-ref-row'>
              <Text className='pr-ref-k'>配伍与剂量（同和堂版·克）</Text>
              <View className='pr-ref-v'>
                {r.th.missing ? (
                  <View>未载</View>
                ) : (
                  <View>
                    <View>{r.th.composition}</View>
                    {r.th.notes.map((n, i) => (
                      <View key={n + '-' + i} className='pr-note'>
                        注：{n}
                      </View>
                    ))}
                    {r.th.science ? (
                      <View className='pr-note'>科中（科学中药）：{r.th.science}</View>
                    ) : null}
                    <View className='pr-item-src'>{r.th.src}</View>
                  </View>
                )}
              </View>
            </View>
            <View className='pr-ref-row'>
              <Text className='pr-ref-k'>组成（讲稿 2010·第二讲·比例制）</Text>
              <View className='pr-ref-v'>
                {r.draft.missing ? (
                  <View>未载</View>
                ) : (
                  <View>
                    {r.draft.composition ? <View>组成：{r.draft.composition}</View> : null}
                    {r.draft.usage ? <View>服法：{r.draft.usage}</View> : null}
                    {r.draft.science ? <View>科学中药：{r.draft.science}</View> : null}
                    {r.draft.adjustments.map((a, i) => (
                      <View key={a + '-' + i} className='pr-note'>
                        加减：{a}
                      </View>
                    ))}
                    {r.draft.contraindication ? (
                      <View className='pr-note'>禁忌：{r.draft.contraindication}</View>
                    ) : null}
                    <View className='pr-item-src'>{r.draft.src}</View>
                  </View>
                )}
              </View>
            </View>
            {r.basis ? (
              <View className='pr-ref-row'>
                <Text className='pr-ref-k'>对照依据</Text>
                <Text className='pr-ref-v'>{r.basis}</Text>
              </View>
            ) : null}
          </View>
        ))}
      </View>

      {/* ========== 方剂备查（同和堂版） ========== */}
      <View className='pr-card'>
        <View className='pr-card-title'>方剂备查（同和堂版《臧氏脉学方剂汇总统表》）</View>
        <View className='pr-note'>
          纸质讲义第 1~4 页原样转录：成方（药味＋克）与第 4 页「科中」科学中药比例。单位是克，与讲稿 2010
          的比例制不同 —— 两套不可互相换算，也不合并。本组条目无五行／左右手归属，不参与分组筛选。
        </View>
        {view.thDoseGroups.map((group) => (
          <View key={group.page} className='pr-drug-group'>
            <View className='pr-drug-group-title'>第 {group.page} 页</View>
            {group.items.map((d) => (
              <View key={d.id} className='pr-drug'>
                <View className='pr-drug-head'>
                  <Text className='pr-drug-therapy'>同和堂版</Text>
                  <Text className='pr-drug-name'>{d.name}</Text>
                </View>
                <View className='pr-drug-line'>
                  <Text className='pr-drug-key'>组成</Text>
                  {d.composition}
                </View>
                {d.notes.map((n, i) => (
                  <View key={n + '-' + i} className='pr-drug-line'>
                    <Text className='pr-drug-key'>注</Text>
                    {n}
                  </View>
                ))}
                {d.science ? (
                  <View className='pr-drug-line'>
                    <Text className='pr-drug-key'>科中</Text>
                    {d.science}
                  </View>
                ) : null}
                <View className='pr-item-src'>{d.src}</View>
              </View>
            ))}
          </View>
        ))}
        {view.thScienceRows.length ? (
          <View className='pr-drug-group'>
            <View className='pr-drug-group-title'>第 4 页 · 科中（科学中药）</View>
            {view.thScienceRows.map((s) => (
              <View key={s.id} className='pr-drug'>
                <View className='pr-drug-head'>
                  <Text className='pr-drug-therapy'>科中</Text>
                  <Text className='pr-drug-name'>{s.name}</Text>
                </View>
                <View className='pr-drug-line'>
                  <Text className='pr-drug-key'>比例</Text>
                  {s.ratio}
                </View>
                <View className='pr-item-src'>{s.src}</View>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {/* ========== 声明 ========== */}
      <View className='pr-disclaimer'>
        本页只做原文对照与查方，不构成诊断，也不替使用者加减方。体质与疗法由使用者自己判断后手工选。
      </View>
    </View>
  )
}
