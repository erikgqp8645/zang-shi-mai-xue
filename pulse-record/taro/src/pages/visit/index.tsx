import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'

import type { MedicationInput } from '@domain/api'
import type { Constitution, LayoutMode, Therapy } from '@domain/types'
import { todayYmd, ymdToLabel, ymdToTimestamp } from '@domain/dates'
import { sampleShaoJuan } from '@domain/sample'

import { getPatient, listCustomSymbols, savePatient, updatePatientLayout, updateVisit } from '../../utils/data'
import { getStorageSync, setStorageSync } from '../../platform/storage'
import { selectVisit, useVisitContext } from '../../store/context'

import ContextBar from '../../components/context-bar'
import SubTabs from '../../components/sub-tabs'
import ActionBar from '../../components/action-bar'
import VisitPulse from '../../components/visit-pulse'
import VisitTriad from '../../components/visit-triad'
import MedicationPanel from '../../components/medication-panel'
import type { SheetSession } from '../../components/record-sheet'

import './index.scss'

/**
 * tab 2 · 就诊 —— **工作台**（一次就诊一屏完成）
 *
 * ## 为什么不是「列表 → 详情 → 跳页」
 *
 * 原生版是一次就诊要 6~8 次跳页 ＋ 3 次重复选上下文。
 * 现在：一个 tab 页里装下**吸顶上下文条 ＋ 4 个页内 tab ＋ 底部操作条**，
 * 上下文只选一次（吸顶条），全程不跳页。
 *
 *   摸脉 → 录这一次的左右手脉象（宽表 ／ 一次一屏）
 *   体质 → 开方三部曲的 ①（自己判断后点选，工具不代判）
 *   疗法 → 开方三部曲的 ②
 *   方药 → 开方三部曲的 ③（照讲义 p47 列出那一支的方）＋ 用药记录
 *
 * ## 四档怎么来的（2026-11-06）
 *
 * 原来只有三档：脉象／判读／用药。
 * **「判读」那一档名不副实** —— 里面做的全是「使用者自己判断、自己点选」，
 * 工具只负责记下来，根本不「判读」。于是按实际动作拆开：
 *
 *   判读 → 体质 ＋ 疗法   （= 三部曲的 ①②）
 *   用药 → 并进「方药」   （= 三部曲的 ③ 的「开方药清单 ＋ 用药记录」）
 *   脉象 → 摸脉           （录的是「摸出来的脉象」，说法跟三部曲对齐）
 *
 * 依据是**网站端**（`src/components/TriadFrame.tsx`）：
 *   「③ 开方药 → 开方药清单 ＋ 用药记录」—— 用药记录本来就属于 ③，
 * 小程序原来把「用药」单列一档，等于把 ③ 劈成两半；现在合回去。
 *
 * ## 这里**没有**「寸关尺关系图」（2026-11-06 改回原生版的规矩）
 *
 * 原生回退工程 `miniprogram/pages/record/record` 里**一个图示入口都没有**，
 * 底部也只有「保存」一个按钮 —— **关系图属于「看」的页面，不进「录」的页面**。
 * Taro 版一度把它做成这里的第 4 档页内 tab（外加底部一个「出图」按钮），
 * 既破了这条规矩，又和**病例详情页**（那里才摆着关系图）重复。
 * → 现在这一页只有四档；关系图仍然在病例详情页，跟记录表并排。
 *
 * ## 落库语义
 *
 * · 体质／疗法：**改了就写回那次就诊**（与网站一致：随记录存）
 *   —— 但**本地新建、还没落库**的那次例外：库里没有它，只改本地，等「保存」整份写进去
 * · 脉象格值／用药：**留在本地，点「保存」整份提交**
 * · 体例：**立刻落库**（体例是患者级属性，唯一真源在库里）
 *
 * ## 「当前那一次」（2026-11-07 统一）
 *
 * 宽表点某个日期 → 那一列高亮 → 点「一次一屏」只摊开那一次 → 顶上放大显示日期／体质／疗法。
 * 这一串动作认的都是同一个「当前那一次」：`activeSessionId`（本地选中）
 * ＋ 全局上下文 `ctx.visitId`（落盘、吸顶条显示）—— 两者**同步**，不再各说各话。
 */
const TABS = [
  { key: 'pulse', label: '摸脉' },
  { key: 'constitution', label: '体质' },
  { key: 'therapy', label: '疗法' },
  { key: 'rx', label: '方药' },
]

/** 录入视图偏好（本地，不落库 —— 落库的只有体例） */
const VIEW_KEY = 'pulse.recordView'

export default function Visit() {
  const ctx = useVisitContext()
  const [tab, setTab] = useState('pulse')
  const [name, setName] = useState('')
  const [layout, setLayout] = useState<LayoutMode>('nine')
  const [sessions, setSessions] = useState<SheetSession[]>([])
  const [medications, setMedications] = useState<MedicationInput[]>([])
  const [customSymbols, setCustomSymbols] = useState<{ code: string; name: string }[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [view, setView] = useState<'wide' | 'single'>('wide')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  /* ---------------- 载入 ---------------- */

  const load = useCallback(async (patientId: string | null) => {
    if (!patientId) {
      setName('')
      setSessions([])
      setMedications([])
      setActiveSessionId(null)
      return
    }
    try {
      const p = await getPatient(patientId)
      if (!p) {
        setError('没有这位患者的记录')
        return
      }
      const list: SheetSession[] = (p.visits || []).map((v) => ({
        id: v.id,
        label: v.label,
        at: v.at,
        values: v.values || {},
        constitution: v.constitution || null,
        therapy: v.therapy || null,
      }))
      setName(p.name || '')
      setLayout(p.layout === 'seven' ? 'seven' : 'nine')
      setSessions(list)
      setError('')
    } catch (e) {
      setError((e as Error)?.message || '读取失败')
    }
    try {
      const syms = await listCustomSymbols()
      setCustomSymbols(syms)
    } catch {
      /* 自定义符号取不到不挡录入 */
    }
  }, [])

  useEffect(() => {
    load(ctx.patientId)
  }, [ctx.patientId, load])

  useDidShow(() => {
    load(ctx.patientId)
    const v = getStorageSync(VIEW_KEY)
    if (v === 'single' || v === 'wide') setView(v)
  })

  /**
   * 当前那一次就诊 —— **以「表格里选中的那次」为准**（2026-11-07 统一）。
   *
   * 以前这里是 `sessions.find(s => s.id === ctx.visitId)`，
   * 而点宽表日期只改本地的 `activeSessionId` —— **两套「当前那一次」各说各话**：
   * 宽表高亮的那次 ≠ 体质／疗法档显示的那次 ≠ 关系图标的那次。
   * 现在一处推导：先认表格里选中的那次，再退到上下文那次，最后退到最后一次。
   */
  const activeSession = useMemo(
    () =>
      sessions.find((s) => s.id === activeSessionId) ||
      sessions.find((s) => s.id === ctx.visitId) ||
      sessions[sessions.length - 1] ||
      null,
    [sessions, activeSessionId, ctx.visitId],
  )

  /**
   * 上下文里的那次（全局、落盘）变了 → 表格里选中的那次跟着变。
   *
   * 用 ref 记住上一次见过的 `ctx.visitId`：**只有上下文真的变了**才同步。
   * 否则「表格点日期 → 同步到上下文」这条回路会被这个 effect 反着拽回去。
   */
  const ctxVisitRef = useRef<string | null>(ctx.visitId)
  useEffect(() => {
    if (ctx.visitId === ctxVisitRef.current) return
    ctxVisitRef.current = ctx.visitId
    setActiveSessionId(ctx.visitId)
  }, [ctx.visitId])

  /** 载入后落到「上下文那次」；上下文没有就落最后一次 */
  useEffect(() => {
    setActiveSessionId((prev) => {
      if (prev && sessions.some((s) => s.id === prev)) return prev
      const fromCtx =
        ctx.visitId && sessions.some((s) => s.id === ctx.visitId) ? ctx.visitId : null
      return fromCtx || sessions[sessions.length - 1]?.id || null
    })
  }, [sessions])

  /* ---------------- 脉象 ---------------- */

  const onToggleLayout = async () => {
    if (saving) return
    const next: LayoutMode = layout === 'nine' ? 'seven' : 'nine'
    if (!ctx.patientId) {
      setLayout(next)
      hintLayout(next)
      return
    }
    try {
      const p = await updatePatientLayout(ctx.patientId, next)
      if (!p) throw new Error('没有这位患者的记录')
      // 以服务端返回的为准（服务端是唯一真源）
      const applied: LayoutMode = p.layout === 'seven' ? 'seven' : 'nine'
      setLayout(applied)
      hintLayout(applied)
    } catch (e) {
      Taro.showToast({ title: (e as Error)?.message || '体例改不了', icon: 'none' })
    }
  }

  /** 切换体例后把影响说清楚 */
  const hintLayout = (l: LayoutMode) => {
    const text =
      l === 'nine'
        ? '已改为 9 行：多出「尺浮、尺中」两行，没数据就是空行，导出的图也会多两行'
        : '已改为 7 脉点：「尺浮、尺中」两行不再显示，数据仍留着，切回来还在'
    Taro.showToast({ title: text, icon: 'none', duration: 2600 })
  }

  /**
   * 还没落库的几次就诊（本地新建的）。
   *
   * 为什么要单独记：体质／疗法是「改了就立刻写回那次就诊」的，
   * 但本地新建的那次**库里还没有** —— 直接 PATCH 会 404。
   * 所以这几次只改本地，等「保存」时随整份一起写进去。
   */
  const pendingVisitIds = useRef<Set<string>>(new Set())

  /** 选日期 → 加一列记录 */
  const onAddVisit = (ymd: string) => {
    const label = ymdToLabel(ymd)
    if (!label) return
    const at = ymdToTimestamp(ymd)
    const id = `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const next = sessions.concat([
      { id, label, at, values: {}, constitution: null, therapy: null },
    ])
    setSessions(next)
    setActiveSessionId(id)
    // 这一列**还没落库** —— 体质／疗法改了先只改本地，等「保存」整份写进去。
    pendingVisitIds.current.add(id)
  }

  /**
   * 点宽表里的日期 → 选中那一次，并把**全局上下文**也切过去。
   *
   * 2026-11-07：以前这里只改本地的 `activeSessionId`，
   * 吸顶条、体质／疗法档、关系图全都还指着上下文里那一次 —— 各说各话。
   * 现在一次点选，四处一起走。
   */
  const onSessionTap = useCallback(
    (id: string) => {
      setActiveSessionId(id)
      const s = sessions.find((x) => x.id === id)
      if (!s) return
      selectVisit({ id: s.id, label: s.label || '', at: s.at })
    },
    [sessions],
  )

  /** 载入讲义 p34 的实例（少娟 6 次记录）—— 与网站同一个按钮 */
  const onLoadSample = () => {
    const sample = sampleShaoJuan()
    const next: SheetSession[] = sample.sessions.map((s) => ({
      id: `v${Math.random().toString(36).slice(2, 8)}`,
      label: s.label,
      at: Date.now(),
      values: s.values,
      constitution: null,
      therapy: null,
    }))
    setName(sample.name)
    setSessions(next)
    setMedications([])
    // 示例的几次也**还没落库** —— 体质／疗法先只改本地，等「保存」。
    next.forEach((s) => pendingVisitIds.current.add(s.id))
    setActiveSessionId(next[0]?.id || null)
  }

  const onViewChange = (v: 'wide' | 'single') => {
    setView(v)
    setStorageSync(VIEW_KEY, v)
  }

  /* ---------------- 体质／疗法（开方三部曲的 ①②） ---------------- */

  const onPersistTriad = async (patch: { constitution?: Constitution | null; therapy?: Therapy | null }) => {
    // 本地先更新（界面立刻反映）
    setSessions((prev) =>
      prev.map((s) =>
        s.id === (activeSession?.id || '') ? { ...s, ...patch } : s,
      ),
    )
    const visitId = activeSession?.id
    if (!visitId) return
    // 本地新建、还没落库的那次：库里没有它，PATCH 会 404 ——
    // 先只改本地，等「保存」整份写进去。（2026-11-07）
    if (pendingVisitIds.current.has(visitId)) return
    try {
      await updateVisit(visitId, patch)
    } catch (e) {
      setError((e as Error)?.message || '保存失败')
    }
  }

  /* ---------------- 保存 ---------------- */

  const onSave = async () => {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      // 新建的那一次就诊此刻还没有 id（id 是前端先生成的），
      // 用药面板里新加的行 visitId 是空串 —— 这里统一补成当前那一次就诊的 id，
      // 否则这批行会带着空 visitId 落库，之后再也没法归到任何一次就诊上。
      const targetVisitId = activeSession?.id || ''
      const meds = medications.map((m) => ({
        ...m,
        visitId: m.visitId || targetVisitId,
      }))
      const payload = {
        id: ctx.patientId || undefined,
        name: (name || '').trim() || '未命名',
        layout,
        visits: sessions.map((s) => ({
          id: s.id,
          label: s.label || '',
          at: s.at,
          values: s.values || {},
          constitution: s.constitution ?? null,
          therapy: (s.therapy as Therapy) ?? null,
        })),
        medications: meds,
      }
      await savePatient(payload)
      // 全写进去了 —— 那些「还没落库」的标记可以清掉
      pendingVisitIds.current.clear()
      Taro.showToast({ title: '已保存', icon: 'success' })
    } catch (e) {
      setError((e as Error)?.message || '保存失败')
      Taro.showToast({ title: (e as Error)?.message || '保存失败', icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  /* ---------------- 渲染 ---------------- */

  return (
    <View className='pr-page pr-visit'>
      <ContextBar />

      <SubTabs tabs={TABS} active={tab} onChange={setTab} />

      {error ? <Text className='pr-note pr-err'>{error}</Text> : null}

      {!ctx.patientId ? (
        <View className='pr-card'>
          <View className='pr-card-title'>还没选患者</View>
          <Text className='pr-note'>点上面那条吸顶条选一位患者，就能开始记了。</Text>
        </View>
      ) : null}

      {/* ---------- 摸脉 ---------- */}
      {tab === 'pulse' && ctx.patientId ? (
        <VisitPulse
          name={name}
          layout={layout}
          sessions={sessions}
          customSymbols={customSymbols}
          activeSessionId={activeSessionId}
          view={view}
          today={todayYmd()}
          onViewChange={onViewChange}
          onNameChange={setName}
          onSessionsChange={setSessions}
          onSessionTap={onSessionTap}
          onToggleLayout={onToggleLayout}
          onAddVisit={onAddVisit}
          onLoadSample={onLoadSample}
        />
      ) : null}

      {/* ---------- 体质（①判体质） ---------- */}
      {tab === 'constitution' && ctx.patientId ? (
        <VisitTriad
          section='constitution'
          layout={layout}
          values={activeSession?.values || {}}
          constitution={(activeSession?.constitution as Constitution) || null}
          therapy={(activeSession?.therapy as Therapy) || null}
          onPersist={onPersistTriad}
        />
      ) : null}

      {/* ---------- 疗法（②定疗法） ---------- */}
      {tab === 'therapy' && ctx.patientId ? (
        <VisitTriad
          section='therapy'
          layout={layout}
          values={activeSession?.values || {}}
          constitution={(activeSession?.constitution as Constitution) || null}
          therapy={(activeSession?.therapy as Therapy) || null}
          onPersist={onPersistTriad}
        />
      ) : null}

      {/* ---------- 方药（③开方药 ＋ 用药记录） ----------
          用药记录并进这一档，依据网站端「③ 开方药 → 开方药清单 ＋ 用药记录」。 */}
      {tab === 'rx' && ctx.patientId ? (
        <>
          <VisitTriad
            section='rx'
            layout={layout}
            values={activeSession?.values || {}}
            constitution={(activeSession?.constitution as Constitution) || null}
            therapy={(activeSession?.therapy as Therapy) || null}
            onPersist={onPersistTriad}
          />
          <MedicationPanel
            patientId={ctx.patientId}
            visitId={activeSession?.id ?? null}
            visitDate={ctx.visitDate}
            onChange={setMedications}
            onGoRecord={() => setTab('pulse')}
          />
        </>
      ) : null}

      {/* ---------- 底部固定操作条 ---------- */}
      <View className='pr-disclaimer pr-visit-disclaimer'>
        本工具只做记录，不构成诊断。体质与疗法由使用者自己判断后手工选，工具不代判、不自动开方。
      </View>

      <ActionBar>
        <View className={`pr-btn pr-btn-primary ${saving ? 'is-busy' : ''}`} onClick={onSave}>
          {saving ? '保存中…' : '保存'}
        </View>
        <View className='pr-btn' onClick={() => Taro.switchTab({ url: '/pages/cases/index' })}>
          病例
        </View>
      </ActionBar>
    </View>
  )
}
