import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Constitution, LayoutMode, RecordSet, Session, Therapy } from './domain/types'
import { cellKey } from './domain/types'
import { groupRows } from './domain/layout'
import { todayYmd, ymdToLabel, ymdToTimestamp } from './domain/dates'
import { evaluateRules, type RuleContext } from './domain/rules'
import { evaluateFormulas } from './domain/formulas'
import { PulseTable, type CellRef } from './components/PulseTable'
import { PulseDiagram } from './components/PulseDiagram'
import { SymbolPalette } from './components/SymbolPalette'
import { Findings, type SessionHit, type SessionFormulaHit } from './components/Findings'
import {
  BianmaiNote,
  ConstitutionPicker,
  HitNote,
  RxList,
  StateHints,
  TherapyPicker,
  TriadHeader,
  TriadSection,
  type TriadStep,
} from './components/TriadFrame'
import { TriadImage } from './components/TriadImage'
import { FormulaLibrary } from './components/FormulaLibrary'
import type { FormulaLink } from './domain/formula-links'
import { prescriptionsOf, readTriadReference, therapyOf } from './domain/triad'
import { HistoryPanel, type EditingRef } from './components/HistoryPanel'
import { MedicationPanel } from './components/MedicationPanel'
import type { Medication } from './domain/medication'
import { DIM_ORDER } from './domain/grouping'
import { validateCustomSymbol, type CustomSymbol } from './domain/symbols'
import { toCsv, toMarkdown } from './export/text'
import { downloadPng } from './export/png'
import { downloadBlob } from './export/download'
import {
  deletePatient,
  deleteVisit,
  getPatient,
  listMedication,
  listPatients,
  listVisitMedication,
  renamePatient,
  savePatient,
  updatePatientLayout,
  updateVisit,
  type PatientSummary,
} from './api/patients'
import { deleteCustomSymbol, listCustomSymbols, saveCustomSymbol } from './api/symbols'
import { sampleShaoJuan } from './domain/sample'
import { LoginPanel } from './components/LoginPanel'
import { logout as apiLogout, me, serverState, type AuthUser } from './api/auth'
import { ApiError, UNAUTHORIZED_EVENT } from './api/http'

function uid(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 用药记录的 id（与就诊 id 同族，但前缀不同） */
function muid(): string {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  // 桌面版走系统另存为对话框，Web 端走浏览器下载（见 src/export/download.ts）
  void downloadBlob(filename, blob)
}

export default function App() {
  const [set, setSet] = useState<RecordSet>(() => ({ name: '', layout: 'nine', sessions: [] }))
  const [selected, setSelected] = useState<CellRef | null>(null)
  const [highlight, setHighlight] = useState<Set<string>>(new Set())
  /** 新增记录所选日期（<input type="date"> 的值，YYYY-MM-DD），默认今天 */
  const [newDate, setNewDate] = useState(() => todayYmd())
  /** 当前选中的日期（记录列）：主表高亮列 ＋ 寸关尺图示取这一列的符号 */
  const [activeSessionIdRaw, setActiveSessionId] = useState<string | null>(null)

  /** 病例记录：存本机 SQLite（见 server/db.mjs），不经浏览器 localStorage */
  const [patients, setPatients] = useState<PatientSummary[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [dbPath, setDbPath] = useState<string | null>(null)
  /** 主表当前正在编辑的对象：患者（整体编辑）或其中某一次就诊（单次编辑） */
  const [editing, setEditing] = useState<EditingRef>({ patientId: null, visitId: null })
  const [historyOpen, setHistoryOpen] = useState(false)
  /** 每次保存后自增，让病例面板把展开的明细重新拉一遍 */
  const [historyVersion, setHistoryVersion] = useState(0)
  /** 切换体例后的提示（说清多出/少掉哪两行） */
  const [layoutHint, setLayoutHint] = useState('')

  /** 自定义符号（使用者自建，如「涩」＝S）：存本机 SQLite，与病例记录同一套永久存储 */
  const [customSymbols, setCustomSymbols] = useState<CustomSymbol[]>([])
  const [symbolError, setSymbolError] = useState<string | null>(null)

  /**
   * 登录状态（多用户）。
   * - 单机模式（服务端 PULSE_SINGLE_USER=1）：不用登录，直接进
   * - 多用户模式：必须登录；令牌失效（401）→ 广播事件 → 回到登录页
   */
  const [user, setUser] = useState<AuthUser | null>(null)
  const [mode, setMode] = useState<'single' | 'multi'>('multi')
  const [authReady, setAuthReady] = useState(false)

  /** 启动时问一次服务端：什么模式、我是谁 */
  useEffect(() => {
    void (async () => {
      const state = await serverState()
      setMode(state.mode)
      if (state.mode === 'single') {
        setUser({ id: 'local', loginName: 'local', displayName: '本机用户', role: 'admin' })
        setAuthReady(true)
        return
      }
      const cur = await me()
      setUser(cur?.user ?? null)
      setAuthReady(true)
    })()
  }, [])

  /** 令牌失效（401）→ 回到登录页 */
  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null)
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  /** 退出登录 */
  const doLogout = useCallback(async () => {
    try {
      await apiLogout()
    } finally {
      setUser(null)
    }
  }, [])

  /**
   * 用药记录：使用者自己填「实际用了什么方、加减、服法」。
   * 挂在某一次就诊下（一次就诊可挂多条方），与脉象记录一起存本机 SQLite。
   * 工具只负责记录，不替使用者加减方、不下诊断。
   */
  const [medications, setMedications] = useState<Medication[]>([])

  const refreshHistory = useCallback(async () => {
    try {
      setPatients(await listPatients())
      setHistoryError(null)
    } catch (e) {
      setHistoryError(String((e as Error)?.message ?? e))
    } finally {
      setHistoryVersion((v) => v + 1)
    }
  }, [])

  useEffect(() => {
    void serverState().then((s) => setDbPath(s.db ?? null))
  }, [])

  /**
   * 桌面版：主进程那边「导入数据文件」完成后会通知一声，
   * 这边把病例列表重新拉一遍（导入的病例要立刻看得见）。
   * Web 端没有这个桥，什么都不做。
   */
  useEffect(() => {
    const bridge = window.__pulseDesktop
    if (!bridge) return
    return bridge.onDataChanged(() => {
      void refreshHistory()
      void (async () => {
        try {
          setCustomSymbols(await listCustomSymbols())
        } catch {
          setCustomSymbols([])
        }
      })()
    })
  }, [refreshHistory])

  /**
   * 病例记录与自定义符号：登录后才拉。
   * （未登录时拉会拿到 401，白白报错 —— 等登录完再拉。）
   */
  useEffect(() => {
    if (!user) return
    void refreshHistory()
    void (async () => {
      try {
        setCustomSymbols(await listCustomSymbols())
      } catch {
        setCustomSymbols([])
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  /** 分组筛选：按五行／按左右手时打开哪些组（页面与 Markdown 导出共用一份状态） */
  const [groupFilter, setGroupFilter] = useState<{ wuxing: string[]; hand: string[] }>(() => ({
    wuxing: [...DIM_ORDER.wuxing],
    hand: [...DIM_ORDER.hand],
  }))

  function changeFilter(dim: 'wuxing' | 'hand', keys: string[]) {
    setGroupFilter((prev) => ({ ...prev, [dim]: keys }))
  }

  /**
   * ③（或 ②）里的方名点进来 → 要定位到「用方知识库」里的哪一条。
   *
   * 定位由 `FormulaLibrary` 自己完成（展开 → 滚到锚点 → 高亮），
   * 这里只负责记住意图 —— 与小程序端那套「内存态 ＋ 切 tab」不同，
   * web 端是单页平铺，同一个 state 直接传下去就行。
   */
  const [formulaFocus, setFormulaFocus] = useState<FormulaLink | null>(null)

  const openFormula = useCallback((link: FormulaLink) => {
    setFormulaFocus(link)
  }, [])

  const groups = useMemo(() => groupRows(set.layout), [set.layout])

  /**
   * 当前日期（记录列）：
   * - 显式选过就用选中的那个；选中的那条被删了就回落到最后一列
   * - 主表与寸关尺图示共用这一份状态，所以两边永远指向同一天
   */
  const activeSessionId = useMemo(() => {
    if (set.sessions.length === 0) return null
    if (activeSessionIdRaw && set.sessions.some((s) => s.id === activeSessionIdRaw)) return activeSessionIdRaw
    return set.sessions[set.sessions.length - 1].id
  }, [set.sessions, activeSessionIdRaw])

  /** 全部规则命中（跨所有记录） */
  const hits = useMemo<SessionHit[]>(() => {
    return set.sessions.flatMap((s) => {
      const ctx: RuleContext = {
        layout: set.layout,
        get: (hand, organ, depth) => s.values[cellKey(hand, organ, depth)] ?? [],
        depths: (organ) => groups.find((g) => g.organ === organ)!.rows.map((r) => r.depth),
      }
      return evaluateRules(ctx).map((hit) => ({
        sessionId: s.id,
        sessionLabel: s.label,
        hit,
      }))
    })
  }, [set, groups])

  /** 依脉用方命中（跨所有记录） */
  const formulaHits = useMemo<SessionFormulaHit[]>(() => {
    return set.sessions.flatMap((s) => {
      const ctx: RuleContext = {
        layout: set.layout,
        get: (hand, organ, depth) => s.values[cellKey(hand, organ, depth)] ?? [],
        depths: (organ) => groups.find((g) => g.organ === organ)!.rows.map((r) => r.depth),
      }
      return evaluateFormulas(ctx).map((hit) => ({
        sessionId: s.id,
        sessionLabel: s.label,
        hit,
      }))
    })
  }, [set, groups])

  /**
   * 当前选中那一次记录（①判体质、②定疗法、参考判据都针对它）。
   */
  const activeSession = useMemo<Session | null>(() => {
    if (set.sessions.length === 0) return null
    return set.sessions.find((x) => x.id === activeSessionId) ?? set.sessions[set.sessions.length - 1]
  }, [set.sessions, activeSessionId])

  /**
   * 图上两条问句的**参考判据**（讲义 2026-10·p47）：
   * 按当前选中那一次记录标出「有变脉？」「尺脉弱？」的命中位置。
   * 只作参考——体质与疗法由使用者在 ① ② 里自己选，工具不代判。
   */
  const triadRef = useMemo(() => {
    if (!activeSession) return null
    const ctx: RuleContext = {
      layout: set.layout,
      get: (hand, organ, depth) => activeSession.values[cellKey(hand, organ, depth)] ?? [],
      depths: (organ) => groups.find((g) => g.organ === organ)!.rows.map((r) => r.depth),
    }
    return readTriadReference(ctx)
  }, [set.layout, groups, activeSession])

  /** 使用者自选的体质与疗法（存在这一次记录上，随病例记录一起存） */
  const manualConstitution: Constitution | null = activeSession?.constitution ?? null
  const manualTherapy: Therapy | null = activeSession?.therapy ?? null
  /** 按所选疗法，图上那一支的开方药 */
  const manualPrescriptions = manualTherapy ? prescriptionsOf(manualTherapy) : []

  /** 改某一次记录上的字段 */
  const patchSession = (id: string, patch: Partial<Session>) =>
    setSet((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }))

  /** ①选体质：按图上的配对带出疗法（带出后仍可改） */
  const pickConstitution = (c: Constitution) => {
    if (!activeSession) return
    patchSession(activeSession.id, { constitution: c, therapy: therapyOf(c) })
  }

  /** ①清除体质：疗法是随体质带出的，一并清掉 */
  const clearConstitution = () => {
    if (!activeSession) return
    patchSession(activeSession.id, { constitution: null, therapy: null })
  }

  /** ②选疗法 */
  const pickTherapy = (t: Therapy) => {
    if (!activeSession) return
    patchSession(activeSession.id, { therapy: t })
  }

  /** ②清除疗法（体质保留） */
  const clearTherapy = () => {
    if (!activeSession) return
    patchSession(activeSession.id, { therapy: null })
  }

  /** 流程面板点击格子 → 定位到主表 */
  const focusTriadCells = (cells: string[]) => {
    const s = activeSession
    if (!s || cells.length === 0) return
    setHighlight(new Set(cells.map((c) => `${s.id}::${c}`)))
    const [hand, organ, depth] = cells[0].split('|') as [CellRef['hand'], CellRef['organ'], CellRef['depth']]
    setSelected({ sessionId: s.id, hand, organ, depth })
  }

  /**
   * 三步的状态：按「有没有录脉象 → 有没有自判体质 → 有没有记用药」推进。
   * 只标示走到哪一步，不替使用者决定该不该开方。
   */
  const triadSteps = useMemo<TriadStep[]>(() => {
    const recorded = !!triadRef?.recorded
    const judged = manualConstitution !== null
    const prescribed =
      !!activeSessionId && medications.some((m) => m.visitId === activeSessionId && m.name.trim() !== '')

    /** 已完成的步数 → 下一个「进行中」 */
    const doneCount = [recorded, judged, prescribed].filter(Boolean).length
    const stateOf = (i: number): TriadStep['state'] => {
      const ok = [recorded, judged, prescribed][i]
      if (ok && doneCount > i) return 'done'
      return doneCount === i ? 'current' : 'todo'
    }

    return [
      {
        no: '①',
        title: '判体质',
        note: '摸脉 → 判断方式 → 状态',
        state: stateOf(0),
        result: manualConstitution ? `${manualConstitution}体质` : undefined,
      },
      {
        no: '②',
        title: '定疗法',
        note: '按体质定疗法',
        state: stateOf(1),
        result: manualTherapy ?? undefined,
      },
      {
        no: '③',
        title: '开方药',
        note: '按疗法列方',
        state: stateOf(2),
        result: manualPrescriptions.length
          ? manualPrescriptions.map((p) => p.name).join('、')
          : undefined,
      },
    ]
  }, [activeSessionId, triadRef, manualConstitution, manualTherapy, manualPrescriptions, medications])

  /** 点框头的某一步 → 跳到那个框 */
  const jumpToStep = (no: '①' | '②' | '③') => {
    const idx = ['①', '②', '③'].indexOf(no)
    document.querySelectorAll<HTMLElement>('.pr-triad-box')[idx]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /** 当前选中格的符号 */
  const selectedCodes = useMemo(() => {
    if (!selected) return []
    const s = set.sessions.find((x) => x.id === selected.sessionId)
    if (!s) return []
    return s.values[cellKey(selected.hand, selected.organ, selected.depth)] ?? []
  }, [selected, set])

  const selectedTarget = selected
    ? (() => {
        const s = set.sessions.find((x) => x.id === selected.sessionId)
        const hand = selected.hand === 'L' ? '左' : '右'
        return s ? `${s.label} · ${selected.organ}${selected.depth} · ${hand}` : null
      })()
    : null

  const setCellCodes = (ref: CellRef, codes: string[]) => {
    setSet((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) => {
        if (s.id !== ref.sessionId) return s
        const key = cellKey(ref.hand, ref.organ, ref.depth)
        const values = { ...s.values }
        if (codes.length === 0) delete values[key]
        else values[key] = codes
        return { ...s, values }
      }),
    }))
  }

  const addSession = () => {
    // 日期标签用六位年月日（YYMMDD），如 261102；未选日期则退回「第 N 次」
    const label = newDate ? ymdToLabel(newDate) : `第 ${set.sessions.length + 1} 次`
    const at = newDate ? ymdToTimestamp(newDate) : Date.now()
    const s = { id: uid(), label, at, values: {} as Record<string, string[]> }
    setSet((prev) => ({ ...prev, sessions: [...prev.sessions, s] }))
    // 新加的这一次即为当前日期（图示跟着显示它）
    setActiveSessionId(s.id)
  }

  const removeSession = (id: string) => {
    setSet((prev) => ({ ...prev, sessions: prev.sessions.filter((s) => s.id !== id) }))
    setSelected((sel) => (sel?.sessionId === id ? null : sel))
    // 删掉这一列，它下面的用药记录也一并作废
    setMedications((prev) => prev.filter((m) => m.visitId !== id))
  }

  const renameSession = (id: string, label: string) => {
    setSet((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) => (s.id === id ? { ...s, label } : s)),
    }))
  }

  const focusHit = (h: SessionHit) => {
    setHighlight(new Set(h.hit.cells.map((c) => `${h.sessionId}::${c}`)))
    if (h.hit.cells.length > 0) {
      const [hand, organ, depth] = h.hit.cells[0].split('|') as [CellRef['hand'], CellRef['organ'], CellRef['depth']]
      setSelected({ sessionId: h.sessionId, hand, organ, depth })
    }
  }

  const focusFormula = (h: SessionFormulaHit) => {
    setHighlight(new Set(h.hit.cells.map((c) => `${h.sessionId}::${c}`)))
    if (h.hit.cells.length > 0) {
      const [hand, organ, depth] = h.hit.cells[0].split('|') as [CellRef['hand'], CellRef['organ'], CellRef['depth']]
      setSelected({ sessionId: h.sessionId, hand, organ, depth })
    }
  }

  /** 主表的次记录 → 病例记录里的 visits（体质与疗法一并带走） */
  const toVisits = () =>
    set.sessions.map((s) => ({
      id: s.id,
      label: s.label,
      at: s.at ?? Date.now(),
      values: s.values,
      constitution: s.constitution ?? null,
      therapy: s.therapy ?? null,
    }))

  /** 只留还挂在当前记录列上的用药（删掉的记录列，其用药随之作废） */
  const liveMedications = () =>
    medications.filter((m) => set.sessions.some((s) => s.id === m.visitId))

  /**
   * 保存当前：
   * - 正在编辑某一次就诊（单次模式）→ 只写回那一次，不动该患者的其它次
   * - 正在编辑某位患者（整体模式）→ 整份写回（同 id 的次记录更新、没有的删除）
   * - 都没在编辑 → 新建一位患者
   */
  const doSave = async () => {
    try {
      if (editing.visitId) {
        const s = set.sessions[0]
        if (!s) return
        await updateVisit(editing.visitId, {
          label: s.label,
          values: s.values,
          at: s.at,
          // 自判体质与自选疗法：只写回这一次的
          constitution: s.constitution ?? null,
          therapy: s.therapy ?? null,
          // 单次语义：只写回这一次的用药
          medications: liveMedications().filter((m) => m.visitId === s.id),
        })
        await renamePatient(editing.patientId!, set.name || '未命名')
        await refreshHistory()
        setHistoryError(null)
        return
      }
      const patient = await savePatient({
        id: editing.patientId ?? undefined,
        name: set.name || '未命名',
        layout: set.layout,
        visits: toVisits(),
        medications: liveMedications(),
      })
      setEditing({ patientId: patient.id, visitId: null })
      await refreshHistory()
      setHistoryError(null)
    } catch (e) {
      setHistoryError(String((e as Error)?.message ?? e))
    }
  }

  /**
   * 另存为新患者（不动正在编辑的那位）。
   *
   * 另存＝复制一份：就诊记录与用药记录都要换新的 id，
   * 否则同一批 visit id 会把原患者的那几次就诊「搬」到新患者名下（原患者就少了记录）。
   */
  const doSaveAsNew = async () => {
    try {
      const idMap = new Map<string, string>()
      const visits = set.sessions.map((s) => {
        const nid = uid()
        idMap.set(s.id, nid)
        return {
          id: nid,
          label: s.label,
          at: s.at ?? Date.now(),
          values: s.values,
          constitution: s.constitution ?? null,
          therapy: s.therapy ?? null,
        }
      })
      const newMeds: Medication[] = liveMedications().map((m) => ({
        id: muid(),
        visitId: idMap.get(m.visitId) ?? m.visitId,
        name: m.name,
        pulse: m.pulse,
        symbols: { ...(m.symbols ?? {}) },
        adjust: m.adjust,
        usage: m.usage,
        note: m.note,
      }))
      const patient = await savePatient({
        name: set.name || '未命名',
        layout: set.layout,
        visits,
        medications: newMeds,
      })
      // 本地状态换成新 id（与库里一致，后续再保存就是更新而不是新增）
      setSet((prev) => ({
        ...prev,
        sessions: prev.sessions.map((s) => ({ ...s, id: idMap.get(s.id) ?? s.id })),
      }))
      setMedications(newMeds)
      setEditing({ patientId: patient.id, visitId: null })
      await refreshHistory()
      setHistoryError(null)
    } catch (e) {
      setHistoryError(String((e as Error)?.message ?? e))
    }
  }

  /**
   * 切换体例（7 脉点 / 9 行）。
   *
   * 体例是**患者级**属性 —— 记录表（导出 PNG）与录入记录都必须按同一个值画，
   * 所以这里切换**立刻落库**（新建患者还没 id 时才只改本地）：
   * 否则同一位患者会在两个界面显示出不同的行数 —— 记录表 7 行、录入记录 9 行。
   *
   * 只改体例、不动格值：7↔9 来回切，「尺浮/尺中」两行的数据仍原样留着，切回来还在。
   */
  const doSwitchLayout = async (layout: LayoutMode) => {
    if (layout === set.layout) return
    const patientId = editing.patientId
    // 新建患者（还没落库）→ 没有 id 可改，先切本地，保存时随患者一起存
    if (!patientId) {
      setSet((p) => ({ ...p, layout }))
      setLayoutHint('')
      return
    }
    try {
      const patient = await updatePatientLayout(patientId, layout)
      // 以服务端返回的为准（服务端是唯一真源）
      const applied: LayoutMode = patient.layout === 'seven' ? 'seven' : 'nine'
      setSet((p) => ({ ...p, layout: applied }))
      setLayoutHint(
        applied === 'nine'
          ? '已改为 9 行：多出「尺浮、尺中」两行，没数据就是空行，导出的图也会多两行'
          : '已改为 7 脉点：「尺浮、尺中」两行不再显示，数据仍留着，切回来还在',
      )
    } catch (e) {
      setHistoryError(String((e as Error)?.message ?? e))
    }
  }

  /** 载入某位患者的全部次记录（整体编辑模式） */
  const doLoadPatient = async (id: string) => {
    try {
      const patient = await getPatient(id)
      if (!patient) return
      setSet({
        name: patient.name,
        layout: patient.layout,
        sessions: patient.visits.map((v) => ({
          id: v.id,
          label: v.label,
          at: v.at,
          values: v.values,
          constitution: v.constitution ?? null,
          therapy: v.therapy ?? null,
        })),
      })
      setMedications(await listMedication(patient.id))
      setEditing({ patientId: patient.id, visitId: null })
      setSelected(null)
      setHighlight(new Set())
    } catch (e) {
      setHistoryError(String((e as Error)?.message ?? e))
    }
  }

  /** 载入某一次就诊记录（单次编辑模式）：主表只显示这一条 */
  const doLoadVisit = async (patientId: string, visitId: string) => {
    try {
      const patient = await getPatient(patientId)
      const visit = patient?.visits.find((v) => v.id === visitId)
      if (!patient || !visit) return
      setSet({
        name: patient.name,
        layout: patient.layout,
        sessions: [
          {
            id: visit.id,
            label: visit.label,
            at: visit.at,
            values: visit.values,
            constitution: visit.constitution ?? null,
            therapy: visit.therapy ?? null,
          },
        ],
      })
      setMedications(await listVisitMedication(visitId))
      setEditing({ patientId, visitId })
      setSelected(null)
      setHighlight(new Set())
    } catch (e) {
      setHistoryError(String((e as Error)?.message ?? e))
    }
  }

  const doRenamePatient = async (id: string, name: string) => {
    try {
      await renamePatient(id, name)
      if (editing.patientId === id) setSet((p) => ({ ...p, name }))
      await refreshHistory()
    } catch (e) {
      setHistoryError(String((e as Error)?.message ?? e))
    }
  }

  const doRemovePatient = async (id: string) => {
    try {
      await deletePatient(id)
      if (editing.patientId === id) setEditing({ patientId: null, visitId: null })
      await refreshHistory()
    } catch (e) {
      setHistoryError(String((e as Error)?.message ?? e))
    }
  }

  const doRemoveVisit = async (id: string) => {
    try {
      await deleteVisit(id)
      if (editing.visitId === id) setEditing({ patientId: null, visitId: null })
      await refreshHistory()
    } catch (e) {
      setHistoryError(String((e as Error)?.message ?? e))
    }
  }

  /** 载入讲义 p34 实例表原样数据，用于核对体例 */
  const doLoadSample = () => {
    setSet(sampleShaoJuan())
    setMedications([])
    setSelected(null)
    setHighlight(new Set())
  }

  /** 新增／改名一个自定义符号（成功返回 true，失败时错误写到 symbolError） */
  const doAddCustomSymbol = async (code: string, name: string): Promise<boolean> => {
    const err = validateCustomSymbol(code, name, customSymbols)
    if (err) {
      setSymbolError(err)
      return false
    }
    try {
      const saved = await saveCustomSymbol({ code: code.trim(), name: name.trim() })
      setCustomSymbols((prev) => [...prev.filter((s) => s.code !== saved.code), saved])
      setSymbolError(null)
      return true
    } catch (e) {
      setSymbolError(String((e as Error)?.message ?? e))
      return false
    }
  }

  /** 删除一个自定义符号（已录入的历史符号不受影响） */
  const doRemoveCustomSymbol = async (code: string): Promise<boolean> => {
    try {
      await deleteCustomSymbol(code)
      setCustomSymbols((prev) => prev.filter((s) => s.code !== code))
      setSymbolError(null)
      return true
    } catch (e) {
      // 404 ＝ 服务端已经没有这个符号了（另一台设备／小程序先删过）——
      // 本地也去掉，别让这个 chip 永远删不掉。与小程序端同一处理。
      if (e instanceof ApiError && e.status === 404) {
        setCustomSymbols((prev) => prev.filter((s) => s.code !== code))
        setSymbolError(null)
        return true
      }
      setSymbolError(String((e as Error)?.message ?? e))
      return false
    }
  }

  const baseName = `脉象记录表-${set.name || '未命名'}`

  // 还没问完服务端状态时，先别渲染主界面（免得先闪一下没数据的空表）
  if (!authReady) {
    return (
      <div className="pr-login">
        <div className="pr-login-card">
          <p className="pr-login-note">正在连接病例记录服务…</p>
        </div>
      </div>
    )
  }

  // 未登录（多用户模式）→ 登录页
  if (!user) {
    return (
      <LoginPanel
        single={mode === 'single'}
        onEnterSingle={() => setUser({ id: 'local', loginName: 'local', displayName: '本机用户', role: 'admin' })}
        onLoggedIn={setUser}
      />
    )
  }

  return (
    <div className="pr-app">
      {/* ---- 讲义 p47 原图：整套工具的总纲，放在最顶端 ---- */}
      <TriadImage />

      <header className="pr-header">
        <div>
          <h1>臧氏脉学 · 脉象记录表生成器</h1>
          <p className="pr-sub">
            表格体例据讲义 2026-10 PDF p34「④ 脉象记录」实例表；判读提示逐条出自讲稿 2010 第十四讲等处，
            依脉用方据讲义 p44「依脉用方」与 p46 附表一「治疗」列。
          </p>
        </div>
        <div className="pr-header-actions">
          <button
            type="button"
            onClick={() =>
              downloadPng(set, `${baseName}.png`, customSymbols, {
                diagram: true,
                activeSessionId,
              })
            }
          >
            导出 PNG
          </button>
          <button
            type="button"
            onClick={() =>
              downloadText(
                `${baseName}.md`,
                toMarkdown(set, groupFilter, customSymbols, activeSessionId),
                'text/markdown',
              )
            }
          >
            导出 Markdown
          </button>
          <button type="button" onClick={() => downloadText(`${baseName}.csv`, toCsv(set), 'text/csv')}>
            导出 CSV
          </button>
          <span className="pr-header-user" title={mode === 'single' ? '单机模式：本机数据，不与他人共享' : '当前登录账号'}>
            <span className={mode === 'single' ? 'pr-mode-badge pr-mode-single' : 'pr-mode-badge'}>
              {mode === 'single' ? '单机模式' : '多用户'}
            </span>
            {mode === 'multi' && <span className="pr-user-name">{user.displayName || user.loginName}</span>}
          </span>
          {mode === 'multi' && (
            <button type="button" className="pr-ghost" onClick={() => void doLogout()}>
              退出登录
            </button>
          )}
        </div>
      </header>

      <section className="pr-toolbar">
        <label className="pr-field">
          姓名
          <input
            type="text"
            value={set.name}
            placeholder="如 少娟"
            onChange={(e) => setSet((p) => ({ ...p, name: e.target.value }))}
          />
        </label>

        <div className="pr-field">
          布局
          <div className="pr-radio">
            {(
              [
                { v: 'nine', label: '9 行（尺浮中沉）' },
                { v: 'seven', label: '7 脉点（尺只沉）' },
              ] as { v: LayoutMode; label: string }[]
            ).map((o) => (
              <label key={o.v} className={set.layout === o.v ? 'is-on' : ''}>
                <input
                  type="radio"
                  name="layout"
                  checked={set.layout === o.v}
                  onChange={() => doSwitchLayout(o.v)}
                />
                {o.label}
              </label>
            ))}
          </div>
          <span className="pr-field-hint">
            体例是这位患者的设置，切换立即保存；记录表与录入记录都按它画。
            {layoutHint ? ' ' + layoutHint : ''}
          </span>
        </div>

        <div className="pr-field">
          新增记录
          <div className="pr-inline">
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addSession()
              }}
            />
            <button type="button" onClick={addSession}>添加</button>
          </div>
          <span className="pr-field-hint">
            日期按年月日六位记，如 <b>{ymdToLabel(newDate) || '——'}</b>
          </span>
        </div>

        <div className="pr-field pr-field-wide">
          已有记录
          <div className="pr-sessions">
            {set.sessions.length === 0 && <span className="pr-muted">（无）</span>}
            {set.sessions.map((s) => (
              <span key={s.id} className="pr-chip">
                <input
                  type="text"
                  value={s.label}
                  onFocus={() => setActiveSessionId(s.id)}
                  onChange={(e) => renameSession(s.id, e.target.value)}
                />
                <button type="button" className="pr-x" onClick={() => removeSession(s.id)} title="删除该记录">
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>

        <div className="pr-field pr-field-wide">
          病例记录（存本机 SQLite）
          <div className="pr-sessions">
            <button type="button" className="pr-ghost" onClick={() => setHistoryOpen((v) => !v)}>
              {historyOpen ? '收起病例记录' : `病例记录 ${patients.length}`}
            </button>
            <button type="button" className="pr-ghost" onClick={doSave}>
              {editing.visitId ? '保存该次记录' : editing.patientId ? '保存该患者记录' : '保存为新患者'}
            </button>
            {editing.patientId && (
              <button type="button" className="pr-ghost" onClick={doSaveAsNew}>
                另存为新患者
              </button>
            )}
            <button type="button" className="pr-ghost" onClick={doLoadSample}>
              载入示例（少娟）
            </button>
          </div>
          {editing.patientId && (
            <p className="pr-history-current">
              正在编辑：{set.name || '未命名'}
              {editing.visitId ? '（单次记录，改动只写回这一次）' : '（该患者的全部记录）'}
            </p>
          )}
        </div>
      </section>

      {historyOpen && (
        <HistoryPanel
          patients={patients}
          editing={editing}
          dbPath={dbPath}
          error={historyError}
          version={historyVersion}
          onLoadPatient={doLoadPatient}
          onLoadVisit={doLoadVisit}
          onRename={doRenamePatient}
          onDeletePatient={doRemovePatient}
          onDeleteVisit={doRemoveVisit}
          onRefresh={refreshHistory}
        />
      )}

      {triadRef && (
        <TriadHeader
          steps={triadSteps}
          onJump={jumpToStep}
          hitNote={<HitNote result={triadRef} onFocusCells={focusTriadCells} />}
        />
      )}

      {/* ---- ①判体质：自选体质 ＋ 摸脉录入 ---- */}
      <TriadSection
        stage="①"
        title="判体质"
        note="摸脉 → 判断方式 → 状态"
        state={triadSteps[0].state}
        result={manualConstitution ? `→ ${manualConstitution}体质` : undefined}
      >
        <ConstitutionPicker
          value={manualConstitution}
          onChange={pickConstitution}
          onClear={clearConstitution}
        />
        <BianmaiNote />
        <StateHints constitution={manualConstitution} />

        <PulseTable
          set={set}
          selected={selected}
          onSelect={(ref) => {
            setSelected(ref)
            setHighlight(new Set())
            // 点格子＝同时把这一列设为当前日期（图示随之变化）
            setActiveSessionId(ref.sessionId)
          }}
          highlight={highlight}
          activeSessionId={activeSessionId}
          onSelectSession={setActiveSessionId}
          onPickConstitution={(sessionId, c) => {
            // 体质随治疗推进会变，所以每次就诊各记各的；选体质按图上的配对带出疗法
            patchSession(sessionId, { constitution: c, therapy: therapyOf(c) })
          }}
          onClearConstitution={(sessionId) =>
            patchSession(sessionId, { constitution: null, therapy: null })
          }
        />

        {/* 底排：左列「符号录入」，右列「寸关尺图示」 */}
        <div className="pr-bottom">
          <div className="pr-bottom-left">
            <SymbolPalette
              codes={selectedCodes}
              target={selectedTarget}
              onChange={(c) => selected && setCellCodes(selected, c)}
              customSymbols={customSymbols}
              onAddCustom={doAddCustomSymbol}
              onDeleteCustom={doRemoveCustomSymbol}
              error={symbolError}
            />
          </div>

          <PulseDiagram
            set={set}
            activeSessionId={activeSessionId}
            selected={selected}
            onSelect={(ref) => {
              setSelected(ref)
              setHighlight(new Set())
            }}
            onSelectSession={setActiveSessionId}
          />
        </div>
      </TriadSection>

      {/* ---- ②定疗法：自选疗法 ＋ 判读提示（依脉用方 / 风险提示） ---- */}
      <TriadSection
        stage="②"
        title="定疗法"
        note="按体质定疗法"
        state={triadSteps[1].state}
        result={manualTherapy ? `→ ${manualTherapy}` : undefined}
      >
        <TherapyPicker
          value={manualTherapy}
          onChange={pickTherapy}
          onClear={clearTherapy}
          constitution={manualConstitution}
          onOpenFormula={openFormula}
        />

        <div className="pr-findings-row">
          <Findings
            hits={hits}
            formulaHits={formulaHits}
            onFocus={focusHit}
            onFocusFormula={focusFormula}
            wuxingFilter={groupFilter.wuxing}
            handFilter={groupFilter.hand}
            onFilterChange={changeFilter}
          />
        </div>
      </TriadSection>

      {/* ---- ③开方药：开方药清单 ＋ 用药记录 ---- */}
      <TriadSection
        stage="③"
        title="开方药"
        note="按疗法列方"
        state={triadSteps[2].state}
        result={manualPrescriptions.length ? `→ ${manualPrescriptions.map((p) => p.name).join('、')}` : undefined}
      >
        <RxList prescriptions={manualPrescriptions} onOpenFormula={openFormula} />

        {/* 用方知识库：③ 的方名点得进来（组成／服法／加减／禁忌） */}
        <FormulaLibrary focus={formulaFocus} />

        {/* 用药记录（使用者自己填实际用了什么方、加减、服法） */}
        <MedicationPanel
          sessions={set.sessions}
          activeSessionId={activeSessionId}
          layout={set.layout}
          customSymbols={customSymbols}
          rows={medications}
          onChange={setMedications}
        />

        <p className="pr-triad-loop">
          <span className="pr-flow-loop-arrow">⟲</span>
          用完方回到 ① 重新判体质（讲义 p47 图上③→①的虚线回路）
        </p>
      </TriadSection>

      <footer className="pr-footer">
        <p>
          符号体例：<code>0</code> 无 ｜ <code>-</code> 弱 ｜ <code>+</code> 有 ｜ <code>±</code> 比有弱 ｜{' '}
          <code>++</code> 有力 ｜ <code>±±</code> 比有力弱 ｜ <code>+++</code> 很有力 ｜{' '}
          <code>++++</code> 非常有力 ｜ <code>↑</code> 顶 ｜ <code>|</code> 弦 ｜ <code>#</code> 变脉 ｜{' '}
          <code>X</code> 细 ｜ <code>TTT</code> 跳调停 ｜ <code>DDX</code> 大大小
        </p>
        {customSymbols.length > 0 && (
          <p>
            自定义符号：{customSymbols.map((s) => `${s.code}＝${s.name}`).join(' ｜ ')}
            <span className="pr-muted">（使用者自建，不参与讲稿判读与用方比对）</span>
          </p>
        )}
        <p className="pr-muted">
          提示只标出讲稿明确点名的脉象组合，不构成诊断；临床判断请由持证医师作出。
        </p>
      </footer>
    </div>
  )
}
