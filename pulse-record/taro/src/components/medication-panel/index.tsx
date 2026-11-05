import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'

import type { MedicationInput, Visit } from '@domain/api'
import { DRUGS, DRUG_GROUPS } from '@domain/drugs'
import type { DoseSourceView } from '@domain/dose-lookup'
import { draftDoseView, thDoseView } from '@domain/dose-lookup'
import { FORMULA_DOSES } from '@domain/formula-table'
import {
  FORMULA_REFERENCE,
  buildPulseText,
  describeCodes,
  pointOrder,
  pulsePointsOf,
} from '@domain/medication'
import type { CustomSymbol } from '@domain/symbols'
import { HAND_LABEL } from '@domain/types'
import type { Hand, LayoutMode } from '@domain/types'

import { deleteMedication, getPatient, listCustomSymbols, listMedication } from '../../utils/data'
import Sheet from '../sheet'
import { cleanValues } from '../record-sheet/shapes'

import './index.scss'

/**
 * 用药记录（页内组件）—— 迁自原生 `pages/medication/medication`
 *
 * ## 它是什么
 *
 * 原生版是一整页；IA 重构后「就诊」成了工作台，用药是其中的一个**页内 tab**，
 * 所以这里做成了**组件**（不是页面）—— 由工作台嵌进去，不跳页。
 *
 * ## 与原生版的差别（只有这三处，其余逐条照搬）
 *
 * 1. **不选患者**：原生页自带患者 chip 选择器；新 IA 里患者由吸顶条（context-bar）
 *    统一管，四处共用一份上下文，所以这里不再重复选，只按 `patientId` 读数据。
 * 2. **落库归父组件**：原生页的「保存这一行」直接 `saveMedication` 整份覆盖；
 *    现在组件只改内存里的行并 `onChange` 抛给父组件，**父组件在「保存」时整份落库**。
 *    删除仍是立即落库（`deleteMedication`），与原生一致、不可恢复。
 * 3. **方剂库改用底部弹层**：原生是页内展开的一张长卡片；组件化后改用仓库已有的
 *    `Sheet` 组件，内容与类名（`.pr-lib*`）不变。
 *
 * ## 剂量单位：两套分栏，不可换算
 *
 * - 同和堂版《方剂汇总统表》＝**成方·克**
 * - 讲稿 2010＝**比例制**
 *
 * 两套分开列、各自标注出处与单位，**不换算、不合并**；查不到写「未载」，不臆造。
 *
 * ## 术语纪律
 *
 * 方名沿用原文用字（「二仁茯芪」「六神」「加味理中」「加味龙胆泻肝」等），
 * 不改写成现代教材方名；讲义标 `（讲义 2026-10·pNN）`、讲稿标 `（讲稿 2010·第N讲）`、
 * 同和堂版标 `（同和堂版 pN）`。工具只做记录，不替使用者加减方、不下诊断。
 *
 * ## 形状规整（跨进程的老坑）
 *
 * `symbols` / `values` 里装的是**嵌套数组**。组件属性经过「逻辑层 → 视图层 → 逻辑层」
 * 这一圈，嵌套数组会被压成「数字下标的普通对象」（`["X"]` → `{"0":"X"}`），
 * 于是 `.join` / `.map` 直接抛「not a function」——而且是**静默失败**。
 *
 * 所以：**凡是读格值、凡是往外抛 rows，都先按数字下标还原回数组。**
 * 与 `components/record-sheet` 同一份实现（`components/record-sheet/shapes.ts` 的 `cleanValues`）。
 */

/* -------------------------------------------------------------------------- */
/* 对外接口                                                                    */
/* -------------------------------------------------------------------------- */

export interface MedicationPanelProps {
  /** 当前患者 id；null＝没选患者 */
  patientId: string | null
  /** 当前就诊 id；null＝「新建一次」 */
  visitId: string | null
  /** 这次就诊的日期标签（新建时用） */
  visitDate?: string
  /**
   * 数据变化时通知父组件（父组件在「保存」时整份落库）。
   *
   * 抛出的**永远是该患者当前的完整用药集合**（不是只有本次就诊的那几条）——
   * 父组件拿它去 `saveMedication(patientId, rows)` 整份覆盖，不会把别的就诊的记录抹掉。
   *
   * 触发时机：读数据完成后、增删改行后。
   */
  onChange?: (rows: MedicationInput[]) => void
  /**
   * 「录入编辑脉象」的回调 —— 可选。
   *
   * 原生页这里是跳转到录入页；新 IA 里脉象是**同一个工作台的页内 tab**，
   * 组件自己跳不过去，所以交给父组件接（父组件接到就切到「脉象」tab）。
   * 不传就不显示这个入口，只留一句指引。
   */
  onGoRecord?: () => void
}

/* -------------------------------------------------------------------------- */
/* 形状规整                                                                    */
/* -------------------------------------------------------------------------- */

/*
 * 「凡是读格值、凡是往外抛 sessions，都先按数字下标还原回数组」——
 * 这条规矩的实现放在 `components/record-sheet/shapes.ts`（纯函数、被回归脚本直接断言），
 * **这里直接复用，不另写一份**：这个坑（跨进程后嵌套数组被压成 {"0":"X"}，
 * 于是 codes.join 抛 "not a function"，而且是静默失败）一旦两份实现漂移，
 * 就会出现「一处修了另一处没修」的历史重演。
 *
 * 用法：
 *   cleanValues(visit.values)  → 该次就诊每格的符号数组
 *   cleanValues(row.symbols)   → 该行已选符号（key = 手|部位|取法）
 */

/* -------------------------------------------------------------------------- */
/* 类型与小工具                                                                */
/* -------------------------------------------------------------------------- */

/** 落在库里的那一行（id 一定有） */
type StoredRow = MedicationInput & { id: string; visitId: string; name: string }

/** 正在录入／编辑的那一行 */
interface MedForm {
  id: string
  visitId: string
  name: string
  pulse: string
  adjust: string
  usage: string
  note: string
  /** 对应脉象（符号）：key = 手|部位|取法，值为符号代码数组；与文字并存 */
  symbols: Record<string, string[]>
}

/** 一套资料的组成（同和堂版·克 ／ 讲稿 2010·比例制） */
interface DoseView {
  label: string
  /** 该套资料里查不到这个方 */
  missing: boolean
  note: string
  /** 要不要把资料里的方名也写出来（同名不同号／别名对照时才写） */
  showName: boolean
  entries: {
    name: string
    composition: string
    science: string
    usage: string
    source: string
    basis: string
  }[]
}

/** 新行的 id（与网站同一套写法） */
let seq = 0
function newId(): string {
  seq += 1
  return 'm' + Date.now().toString(36) + seq.toString(36)
}

/** 空的表单 */
function emptyForm(visitId: string): MedForm {
  return {
    id: '',
    visitId,
    name: '',
    pulse: '',
    adjust: '',
    usage: '',
    note: '',
    symbols: {},
  }
}

/** 服务端的一行 → 组件内部的一行（顺手把 symbols 规整成数组） */
function toStoredRow(r: {
  id: string
  visitId: string
  name: string
  pulse?: string
  symbols?: Record<string, string[]>
  adjust?: string
  usage?: string
  note?: string
}): StoredRow {
  return {
    id: r.id,
    visitId: r.visitId || '',
    name: r.name || '',
    pulse: r.pulse || '',
    symbols: cleanValues(r.symbols),
    adjust: r.adjust || '',
    usage: r.usage || '',
    note: r.note || '',
  }
}

/** 一套资料的查得结果 → 展示用 */
function fmtDoseView(view: DoseSourceView, label: string): DoseView {
  if (!view || view.matched === 'none') {
    return { label, missing: true, note: '', showName: false, entries: [] }
  }
  let note = ''
  if (view.matched === 'contains') {
    note = '同名不同号 ' + view.entries.length + ' 条（原方名各不相同，工具不替你选）'
  } else if (view.matched === 'alias') {
    note = '别名对照（有明确对照依据）'
  }
  return {
    label,
    missing: false,
    note,
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

/* -------------------------------------------------------------------------- */
/* 方剂库（三套资料分开列）                                                     */
/* -------------------------------------------------------------------------- */

interface LibItem {
  name: string
  hint: string
  /** 讲义 p42 原表的序号与对应脉象（点它会连「对应脉象」一起填上） */
  no?: number
  indication?: string
}

interface LibSection {
  title: string
  unit: string
  source: string
  items: LibItem[]
}

function buildLibrary(keyword: string) {
  const kw = (keyword || '').trim()
  const match = (name: string, extra?: string) => {
    if (!kw) return true
    if (name.indexOf(kw) >= 0) return true
    if (extra && extra.indexOf(kw) >= 0) return true
    return false
  }

  /* 讲义 2026-10·p42「依脉用方表」—— 方 ↔ 脉象 */
  const refItems: LibItem[] = FORMULA_REFERENCE.filter((r) => match(r.name, r.indication)).map((r) => ({
    no: r.no,
    name: r.name,
    hint: '',
    indication: r.indication,
  }))

  /* 讲稿 2010（组成用比例制） */
  const draftSections: LibSection[] = DRUG_GROUPS.map((g) => ({
    title: g.title,
    unit: '组成用比例制',
    source: '讲稿 2010·第二讲（叁、用方）',
    items: DRUGS.filter((d) => d.therapy === g.therapy)
      .filter((d) => match(d.name, d.indication))
      .map((d) => ({
        name: d.name,
        hint: d.composition || '',
      })),
  })).filter((s) => s.items.length)

  /* 同和堂版《方剂汇总统表》（成方·克） */
  const thSections: LibSection[] = []
  for (let page = 1; page <= 3; page += 1) {
    const items: LibItem[] = FORMULA_DOSES.filter((d) => d.page === page)
      .filter((d) => match(d.name, d.composition))
      .map((d) => ({
        name: d.name,
        hint: d.composition,
      }))
    if (items.length) {
      thSections.push({
        title: '第 ' + page + ' 页',
        unit: '成方 · 克',
        source: '《臧氏脉学方剂汇总统表（同和堂版）》',
        items,
      })
    }
  }

  return {
    refTitle: '讲义 2026-10·p42「依脉用方表」（方 ↔ 脉象）',
    refUnit: '原文照录；只给方名与对应脉象，没有组成',
    refItems,
    draftSections,
    thSections,
    empty: refItems.length === 0 && draftSections.length === 0 && thSections.length === 0,
  }
}

/* -------------------------------------------------------------------------- */
/* 组成与剂量（两套并列，各带出处与单位）                                       */
/* -------------------------------------------------------------------------- */

function DoseBlock({
  view,
  scienceLabel,
  showUsage,
}: {
  view: DoseView
  /** 「科中」＝同和堂版第 4 页的科学中药比例表；「科学中药」＝讲稿 2010 的写法 */
  scienceLabel: string
  /** 讲稿 2010 才有服法 */
  showUsage: boolean
}) {
  if (view.missing) {
    return (
      <View className='pr-dose-block'>
        <Text className='pr-dose-tag'>{view.label}</Text>
        <Text className='pr-dose-none'>未载</Text>
      </View>
    )
  }
  return (
    <View className='pr-dose-block'>
      <Text className='pr-dose-tag'>{view.label}{view.note}</Text>
      {view.entries.map((e) => (
        <View key={e.name} className='pr-dose-entry'>
          {view.showName ? <Text>{e.name}：</Text> : null}
          {e.composition}
          {e.science ? <Text className='pr-dose-sci'>　{scienceLabel}：{e.science}</Text> : null}
          {showUsage && e.usage ? <Text className='pr-dose-usage'>　服法：{e.usage}</Text> : null}
          <Text className='pr-dose-src'>〔{e.source}〕</Text>
          {e.basis ? <Text className='pr-dose-ref'>　对照：{e.basis}</Text> : null}
        </View>
      ))}
    </View>
  )
}

/* -------------------------------------------------------------------------- */
/* 组件                                                                        */
/* -------------------------------------------------------------------------- */

export default function MedicationPanel(props: MedicationPanelProps) {
  const { patientId, visitId, visitDate, onChange, onGoRecord } = props

  const [patientName, setPatientName] = useState('')
  const [visits, setVisits] = useState<Visit[]>([])
  const [layout, setLayout] = useState<LayoutMode>('nine')
  const [rows, setRows] = useState<StoredRow[]>([])
  const [customSymbols, setCustomSymbols] = useState<CustomSymbol[]>([])
  /** 正在编辑的一行（空表单＝新增） */
  const [form, setForm] = useState<MedForm>(() => emptyForm(visitId || ''))
  const [editing, setEditing] = useState(false)
  /** 方剂库面板 */
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerKeyword, setPickerKeyword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState('')

  /** 最新的 visitId —— 读数据的回调里要用（异步返回时 props 可能已经变了） */
  const visitIdRef = useRef<string | null>(visitId)
  useEffect(() => {
    visitIdRef.current = visitId
  }, [visitId])

  /** 最新的 onChange —— 同理，读数据的回调里要拿最新的那一个 */
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  /* ---------------------------------------------------------------------- */
  /* 读数据                                                                  */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false

    if (!patientId) {
      setPatientName('')
      setVisits([])
      setRows([])
      setCustomSymbols([])
      setForm(emptyForm(''))
      setEditing(false)
      setError('')
      return
    }

    setBusy(true)
    ;(async () => {
      try {
        const patient = await getPatient(patientId)
        if (cancelled) return
        if (!patient) {
          setError('没有这位患者的记录')
          return
        }
        const meds = await listMedication(patientId)
        if (cancelled) return
        let customs: CustomSymbol[] = []
        try {
          customs = await listCustomSymbols()
        } catch {
          /* 自定义符号取不到不挡记录 */
        }
        if (cancelled) return

        const nextRows = (meds || []).map(toStoredRow)
        setPatientName(patient.name || '')
        setVisits(patient.visits || [])
        setLayout(patient.layout === 'seven' ? 'seven' : 'nine')
        setCustomSymbols(customs)
        setRows(nextRows)
        setForm(emptyForm(visitIdRef.current || ''))
        setEditing(false)
        setError('')
        /* 父组件要拿整份去落库 —— 读完就把完整集合抛出去 */
        onChangeRef.current?.(nextRows)
      } catch (e) {
        if (!cancelled) setError((e as Error)?.message || '读取失败')
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()

    return () => {
      cancelled = true
    }
    /* 依赖只放 patientId：换患者才重读。onChange 走 ref（上面），不会拿到旧的。 */
  }, [patientId])

  /* 换了就诊 → 新行跟着走（正在编辑的旧行保留它自己的就诊） */
  useEffect(() => {
    setForm((prev) => (prev.id ? prev : { ...prev, visitId: visitId || '' }))
    setSaved('')
  }, [visitId])

  /* ---------------------------------------------------------------------- */
  /* 派生数据                                                                */
  /* ---------------------------------------------------------------------- */

  /** 每次就诊的标签（供「属于哪一次」chip 用） */
  const visitChips = useMemo(() => {
    const list = visits.map((v) => ({ id: v.id, label: v.label || '（未命名日期）' }))
    if (!visitId) {
      list.unshift({
        id: '',
        label: visitDate ? `（本次新建的就诊 · ${visitDate}）` : '（本次新建的就诊）',
      })
    }
    return list
  }, [visits, visitId, visitDate])

  /** 某一行挂在哪一次就诊（人话） */
  const visitLabelOf = useCallback(
    (id: string) => {
      if (!id) return visitDate ? `（尚未落库的就诊 · ${visitDate}）` : '（尚未落库的就诊）'
      const v = visits.filter((x) => x.id === id)[0]
      return v ? v.label || '（未命名日期）' : '（未指定就诊）'
    },
    [visits, visitDate],
  )

  /** 显示哪些行：按 visitId 过滤；没有 visitId 就显示该患者的全部行 */
  const displayRows = useMemo(() => {
    const list = visitId ? rows.filter((r) => r.visitId === visitId) : rows
    return list.map((r) => {
      const symbols = cleanValues(r.symbols)
      const keys = Object.keys(symbols)
        .filter((k) => symbols[k].length > 0)
        .sort((a, b) => pointOrder(a) - pointOrder(b))
      const chips = keys.map((k) => {
        const p = k.split('|')
        return {
          key: k,
          label: (HAND_LABEL[p[0] as Hand] || p[0]) + p[1] + ' ' + p[2],
          text: describeCodes(symbols[k], customSymbols),
        }
      })
      const name = (r.name || '').trim()
      return {
        row: r,
        visitLabel: visitLabelOf(r.visitId),
        chips,
        symbolSummary: chips.length ? chips.map((c) => c.label + ' ' + c.text).join('；') : '',
        th: name ? fmtDoseView(thDoseView(name), '同和堂版（克）') : null,
        draft: name ? fmtDoseView(draftDoseView(name), '讲稿 2010（比例制）') : null,
      }
    })
  }, [rows, visitId, visitLabelOf, customSymbols])

  /** 表单里已选的符号 */
  const formChips = useMemo(() => {
    const keys = Object.keys(form.symbols)
      .filter((k) => form.symbols[k].length > 0)
      .sort((a, b) => pointOrder(a) - pointOrder(b))
    return keys.map((k) => {
      const p = k.split('|')
      return {
        key: k,
        label: (HAND_LABEL[p[0] as Hand] || p[0]) + p[1] + ' ' + p[2],
        text: describeCodes(form.symbols[k], customSymbols),
      }
    })
  }, [form.symbols, customSymbols])

  /** 按符号自动生成的那段文字 */
  const autoText = useMemo(() => buildPulseText(form.symbols, customSymbols), [form.symbols, customSymbols])

  /** 该次就诊录到的脉点（可逐个点选） */
  const visitPoints = useMemo(() => {
    const visit = visits.filter((v) => v.id === form.visitId)[0]
    if (!visit) return []
    const list = pulsePointsOf(
      { id: visit.id, label: visit.label, values: cleanValues(visit.values) },
      layout,
    )
    return list.map((p) => ({
      key: p.key,
      label: (HAND_LABEL[p.hand] || p.hand) + p.organ + ' ' + p.depth,
      codes: (p.codes || []).join(' '),
      raw: (p.codes || []).slice(),
    }))
  }, [visits, form.visitId, layout])

  /** 方剂库（按关键词实时算） */
  const library = useMemo(() => buildLibrary(pickerKeyword), [pickerKeyword])

  /* ---------------------------------------------------------------------- */
  /* 表单                                                                    */
  /* ---------------------------------------------------------------------- */

  /** 输入框 */
  const setField = useCallback(
    (field: 'name' | 'pulse' | 'adjust' | 'usage' | 'note', value: string) => {
      setForm((prev) => ({ ...prev, [field]: value }))
      setSaved('')
    },
    [],
  )

  /** 选所属就诊 */
  const selectVisit = useCallback((id: string) => {
    setForm((prev) => ({ ...prev, visitId: id }))
    setSaved('')
  }, [])

  /** 新增一行（清空表单，不动已有行） */
  const addRow = useCallback(() => {
    setForm(emptyForm(visitId || ''))
    setEditing(false)
    setSaved('')
  }, [visitId])

  /** 编辑已有的一行 */
  const editRow = useCallback((row: StoredRow) => {
    setForm({
      id: row.id,
      visitId: row.visitId,
      name: row.name || '',
      pulse: row.pulse || '',
      adjust: row.adjust || '',
      usage: row.usage || '',
      note: row.note || '',
      symbols: cleanValues(row.symbols),
    })
    setEditing(true)
    setSaved('')
  }, [])

  /** 取消编辑 */
  const cancelEdit = useCallback(() => {
    setForm(emptyForm(visitId || ''))
    setEditing(false)
    setSaved('')
  }, [visitId])

  /** 点一个脉点：选／不选（符号与「对应脉象」文字并存） */
  const togglePoint = useCallback(
    (key: string) => {
      setForm((prev) => {
        const symbols = { ...prev.symbols }
        if ((symbols[key] || []).length > 0) {
          delete symbols[key]
        } else {
          const point = visitPoints.filter((p) => p.key === key)[0]
          if (!point) return prev
          symbols[key] = point.raw.slice()
        }
        return { ...prev, symbols }
      })
      setSaved('')
    },
    [visitPoints],
  )

  /** 清空这一行已选的符号 */
  const clearSymbols = useCallback(() => {
    setForm((prev) => ({ ...prev, symbols: {} }))
    setSaved('')
  }, [])

  /** 按符号重填「对应脉象」的文字 */
  const refillFromSymbols = useCallback(() => {
    setForm((prev) => ({ ...prev, pulse: autoText }))
    setSaved('')
  }, [autoText])

  /** 把这一行并进整份记录（落库由父组件在「保存」时做） */
  const commitRow = useCallback(() => {
    if (!patientId) {
      Taro.showToast({ title: '先选一位患者', icon: 'none' })
      return
    }
    const name = form.name.trim()
    const pulse = form.pulse.trim()
    const adjust = form.adjust.trim()
    const usage = form.usage.trim()
    const note = form.note.trim()
    const symbols = cleanValues(form.symbols)
    const hasSymbols = Object.keys(symbols).some((k) => symbols[k].length > 0)
    if (!name && !pulse && !adjust && !usage && !note && !hasSymbols) {
      Taro.showToast({ title: '这一行还是空的', icon: 'none' })
      return
    }

    const row: StoredRow = {
      id: form.id || newId(),
      visitId: form.visitId,
      name,
      pulse,
      symbols,
      adjust,
      usage,
      note,
    }
    const next = rows.filter((r) => r.id !== form.id).concat([row])
    setRows(next)
    onChange?.(next)
    setForm(emptyForm(form.visitId))
    setEditing(false)
    setSaved('这一行已更新 · 工作台保存后落库')
  }, [patientId, form, rows, onChange])

  /** 删一条用药记录（立即落库，与原生一致：删除后不可恢复） */
  const removeRow = useCallback(
    async (id: string) => {
      const row = rows.filter((r) => r.id === id)[0]
      if (!row) return
      let ok = false
      try {
        const res = await Taro.showModal({
          title: '删除这条用药记录？',
          content: `${row.name || '（方名未填）'}　·　删除后不可恢复。`,
        })
        ok = !!res.confirm
      } catch {
        ok = false
      }
      if (!ok) return
      try {
        await deleteMedication(id)
        const next = rows.filter((r) => r.id !== id)
        setRows(next)
        onChange?.(next)
        if (form.id === id) {
          setForm(emptyForm(visitId || ''))
          setEditing(false)
        }
        Taro.showToast({ title: '已删除', icon: 'success' })
      } catch (e) {
        Taro.showToast({ title: (e as Error)?.message || '删除失败', icon: 'none' })
      }
    },
    [rows, form.id, visitId, onChange],
  )

  /* ---------------------------------------------------------------------- */
  /* 方剂库                                                                  */
  /* ---------------------------------------------------------------------- */

  const openLibrary = useCallback(() => {
    setPickerOpen(true)
    setPickerKeyword(pickerKeyword)
  }, [pickerKeyword])

  const closeLibrary = useCallback(() => {
    setPickerOpen(false)
  }, [])

  /** 选一个方名（讲义 p42 原表另把「对应脉象」一起填上） */
  const pickName = useCallback((name: string, indication?: string) => {
    setForm((prev) => ({ ...prev, name, pulse: indication || prev.pulse }))
    setPickerOpen(false)
    setSaved('')
  }, [])

  /* ---------------------------------------------------------------------- */
  /* 渲染                                                                    */
  /* ---------------------------------------------------------------------- */

  return (
    <View className='pr-med-panel'>
      {error ? <View className='pr-note pr-err'>{error}</View> : null}

      {/* ========== 患者概况 ========== */}
      {patientId ? (
        <View className='pr-card'>
          <View className='pr-case-row'>
            <View className='pr-case-name'>{patientName}</View>
            <View className='pr-case-meta'>
              {visits.length} 次记录 · {rows.length} 条用药
            </View>
          </View>
          <View className='pr-case-ops'>
            {onGoRecord ? (
              <Text className='pr-link' onClick={() => onGoRecord?.()}>
                录入编辑脉象
              </Text>
            ) : (
              <Text className='pr-note'>脉象在同一个工作台的「脉象」页内 tab 录入。</Text>
            )}
          </View>
          {visits.length ? null : (
            <View className='pr-note'>
              这位患者还没有就诊记录 —— 用药记录要挂在某一次就诊下面，请先录入一次脉象。
            </View>
          )}
        </View>
      ) : null}

      {/* ========== 用药记录（已有） ========== */}
      {patientId ? (
        <View className='pr-card'>
          <View className='pr-card-title'>用药记录</View>
          <View className='pr-note'>
            自己填实际用了什么方、加减与服法；工具不替加减方、不下诊断。
          </View>
          {visitId ? <View className='pr-note'>（下面只列这次就诊的记录）</View> : null}
          {busy ? <View className='pr-note'>读取中…</View> : null}
          {displayRows.length ? null : <View className='pr-empty'>（这位患者还没有用药记录）</View>}

          {displayRows.map((item) => (
            <View key={item.row.id} className='pr-med-row'>
              <View className='pr-med-head'>
                <Text className='pr-med-name'>{item.row.name || '（方名未填）'}</Text>
                <Text className='pr-med-visit'>挂在：{item.visitLabel}</Text>
              </View>
              {item.row.pulse ? (
                <View className='pr-med-line'>
                  <Text className='pr-med-k'>对应脉象</Text>
                  {item.row.pulse}
                </View>
              ) : null}
              {item.symbolSummary ? (
                <View className='pr-med-line'>
                  <Text className='pr-med-k'>符号</Text>
                  {item.symbolSummary}
                </View>
              ) : null}
              {item.row.adjust ? (
                <View className='pr-med-line'>
                  <Text className='pr-med-k'>加减</Text>
                  {item.row.adjust}
                </View>
              ) : null}
              {item.row.usage ? (
                <View className='pr-med-line'>
                  <Text className='pr-med-k'>服法</Text>
                  {item.row.usage}
                </View>
              ) : null}
              {item.row.note ? (
                <View className='pr-med-line'>
                  <Text className='pr-med-k'>备注</Text>
                  {item.row.note}
                </View>
              ) : null}

              {/* 组成与剂量：两套资料并列，各带出处与单位，不可互相换算 */}
              {item.th ? (
                <View className='pr-dose'>
                  <DoseBlock view={item.th} scienceLabel='科中' showUsage={false} />
                  {item.draft ? (
                    <DoseBlock view={item.draft} scienceLabel='科学中药' showUsage />
                  ) : null}
                </View>
              ) : null}

              <View className='pr-case-ops'>
                <Text className='pr-link' onClick={() => editRow(item.row)}>
                  编辑
                </Text>
                <Text className='pr-x' onClick={() => removeRow(item.row.id)}>
                  ×
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {/* ========== 没选患者 ========== */}
      {patientId ? null : (
        <View className='pr-card'>
          <View className='pr-card-title'>用药记录</View>
          <View className='pr-empty'>
            先在上方吸顶条选一位患者 —— 用药记录要挂在某一次就诊下面。
          </View>
        </View>
      )}

      {/* ========== 新增／编辑一行 ========== */}
      {patientId ? (
        <View className='pr-card'>
          <View className='pr-card-title'>{editing ? '编辑这一行' : '新增一行'}</View>

          <View className='pr-label'>属于哪一次（用药记录挂在某一次就诊下面）</View>
          <View className='pr-chips'>
            {visitChips.map((v) => (
              <View
                key={v.id || 'new'}
                className={`pr-chip ${form.visitId === v.id ? 'pr-chip-on' : ''}`}
                onClick={() => selectVisit(v.id)}
              >
                {v.label}
              </View>
            ))}
          </View>
          {visits.length ? null : (
            <View className='pr-note'>这位患者还没有就诊记录，先到「脉象」页内 tab 建一次。</View>
          )}
          {form.visitId ? null : (
            <View className='pr-note'>
              这一行挂在「本次新建的就诊」上 —— 保存时由工作台一起落库。
            </View>
          )}

          <View className='pr-label'>方名</View>
          <Input
            className='pr-input'
            value={form.name}
            placeholder='如 加味理中（也可从下面方剂库选）'
            onInput={(e) => setField('name', e.detail.value)}
          />
          <View className='pr-case-ops'>
            <Text className='pr-link' onClick={openLibrary}>
              从方剂库选
            </Text>
          </View>

          <View className='pr-label'>对应脉象（文字）</View>
          <Input
            className='pr-input'
            value={form.pulse}
            placeholder='如 右关弱'
            onInput={(e) => setField('pulse', e.detail.value)}
          />

          <View className='pr-label'>对应脉象（符号，从该次记录里挑格子）</View>
          {visitPoints.length ? null : (
            <View className='pr-note'>这次就诊还没有录到符号 —— 先到「脉象」页内 tab 录入。</View>
          )}
          {visitPoints.length ? (
            <View className='pr-chips'>
              {visitPoints.map((p) => (
                <View
                  key={p.key}
                  className={`pr-chip ${(form.symbols[p.key] || []).length ? 'pr-chip-on' : ''}`}
                  onClick={() => togglePoint(p.key)}
                >
                  {p.label} {p.codes}
                </View>
              ))}
            </View>
          ) : null}
          {formChips.length ? (
            <View className='pr-case-ops'>
              <Text className='pr-link' onClick={clearSymbols}>
                清空符号
              </Text>
            </View>
          ) : null}
          {formChips.length ? (
            <View className='pr-note'>
              已选：{formChips.length} 个格子　·　按符号生成：{autoText || '（未选符号，暂不填）'}
            </View>
          ) : null}
          {formChips.length ? (
            <View className='pr-case-ops'>
              <Text className='pr-link' onClick={refillFromSymbols}>
                按符号重填「对应脉象」
              </Text>
            </View>
          ) : null}

          <View className='pr-label'>加减</View>
          <Input
            className='pr-input'
            value={form.adjust}
            placeholder='依脉加减'
            onInput={(e) => setField('adjust', e.detail.value)}
          />

          <View className='pr-label'>服法</View>
          <Input
            className='pr-input'
            value={form.usage}
            placeholder='如 餐后温服'
            onInput={(e) => setField('usage', e.detail.value)}
          />

          <View className='pr-label'>备注</View>
          <Input
            className='pr-input'
            value={form.note}
            placeholder='如 服用几天后的反应'
            onInput={(e) => setField('note', e.detail.value)}
          />

          <View className='pr-case-ops'>
            <View className='pr-btn pr-btn-primary' onClick={commitRow}>
              保存这一行
            </View>
            <View className='pr-btn' onClick={addRow}>
              ＋ 新增一行
            </View>
            <View className='pr-btn' onClick={cancelEdit}>
              取消
            </View>
          </View>
          {saved ? <View className='pr-note'>{saved}</View> : null}
        </View>
      ) : null}

      {/* ========== 方剂库（两套资料分开列） ========== */}
      <Sheet visible={pickerOpen} title='方剂库' closeText='收起' onClose={closeLibrary}>
        <View className='pr-note'>
          两套资料分开列、各自标注出处与单位，不换算、不合并。点一个方名即填入上面的「方名」格。
        </View>
        <Input
          className='pr-input'
          value={pickerKeyword}
          placeholder='搜方名或脉象（如 右关）'
          confirmType='search'
          onInput={(e) => setPickerKeyword(e.detail.value)}
        />

        {library.refItems.length ? (
          <View className='pr-lib'>
            <View className='pr-lib-title'>{library.refTitle}</View>
            <View className='pr-note'>{library.refUnit}</View>
            {library.refItems.map((f) => (
              <View key={f.no} className='pr-lib-item' onClick={() => pickName(f.name, f.indication)}>
                <View className='pr-lib-name'>
                  {f.no} · {f.name}
                </View>
                <View className='pr-lib-hint'>{f.indication}</View>
              </View>
            ))}
          </View>
        ) : null}

        {library.draftSections.map((sec) => (
          <View key={sec.title} className='pr-lib'>
            <View className='pr-lib-title'>{sec.title}</View>
            <View className='pr-note'>
              讲稿 2010 · {sec.unit}　〔{sec.source}〕
            </View>
            {sec.items.map((f) => (
              <View key={f.name} className='pr-lib-item' onClick={() => pickName(f.name)}>
                <View className='pr-lib-name'>{f.name}</View>
                <View className='pr-lib-hint'>{f.hint}</View>
              </View>
            ))}
          </View>
        ))}

        {library.thSections.map((sec) => (
          <View key={sec.title} className='pr-lib'>
            <View className='pr-lib-title'>同和堂版《方剂汇总统表》· {sec.title}</View>
            <View className='pr-note'>
              同和堂版 · {sec.unit}　〔{sec.source}〕
            </View>
            {sec.items.map((f) => (
              <View key={f.name} className='pr-lib-item' onClick={() => pickName(f.name)}>
                <View className='pr-lib-name'>{f.name}</View>
                <View className='pr-lib-hint'>{f.hint}</View>
              </View>
            ))}
          </View>
        ))}

        {library.empty ? <View className='pr-empty'>没有匹配的方。</View> : null}
      </Sheet>

      {/* ========== 声明 ========== */}
      <View className='pr-disclaimer'>
        本工具只做记录与原文对照，不构成诊断，也不替使用者加减方。讲义 2026-10·p42「依脉用方表」只作原文对照，供查供抄，不是处方建议。
      </View>
    </View>
  )
}
