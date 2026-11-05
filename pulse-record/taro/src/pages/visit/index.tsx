import { useCallback, useEffect, useMemo, useState } from 'react'
import { Canvas, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'

import type { MedicationInput } from '@domain/api'
import type { Constitution, LayoutMode, Therapy } from '@domain/types'
import { todayYmd, ymdToLabel, ymdToTimestamp } from '@domain/dates'
import { sampleShaoJuan } from '@domain/sample'
import { toCsv, toMarkdown } from '@export/text'

import { getPatient, listCustomSymbols, savePatient, updatePatientLayout, updateVisit } from '../../utils/data'
import { getStorageSync, setStorageSync } from '../../platform/storage'
import { getAlbumAuthState, isPrivacyNotAuthorized, saveImageToAlbum } from '../../platform/album'
import { isPrivacyNotDeclared, setClipboard } from '../../platform/clipboard'
import { previewImage } from '../../platform/preview'
import { renderDiagramImage, renderExportImage } from '../../platform/canvas'
import { useVisitContext } from '../../store/context'

import ContextBar from '../../components/context-bar'
import SubTabs from '../../components/sub-tabs'
import ActionBar from '../../components/action-bar'
import VisitPulse from '../../components/visit-pulse'
import VisitJudge from '../../components/visit-judge'
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
 *   脉象 → 录入这一次的左右手脉象（宽表 ／ 一次一屏）
 *   判读 → 开方三部曲的 ①②③（体质／疗法落库到这次就诊）
 *   用药 → 这一次的用药记录
 *   出图 → 寸关尺图示 ＋ 记录表 PNG（存相册／复制 Markdown／CSV）
 *
 * ## 落库语义
 *
 * · 体质／疗法：**改了就写回那次就诊**（与网站一致：随记录存）
 * · 脉象格值／用药：**留在本地，点「保存」整份提交**
 * · 体例：**立刻落库**（体例是患者级属性，唯一真源在库里）
 */
const TABS = [
  { key: 'pulse', label: '脉象' },
  { key: 'judge', label: '判读' },
  { key: 'med', label: '用药' },
  { key: 'export', label: '出图' },
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
  const [busy, setBusy] = useState(false)

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

  /** 当前那一次就诊 */
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === ctx.visitId) || sessions[sessions.length - 1] || null,
    [sessions, ctx.visitId],
  )

  useEffect(() => {
    if (activeSession) setActiveSessionId(activeSession.id)
  }, [activeSession])

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
  }

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
  }

  const onViewChange = (v: 'wide' | 'single') => {
    setView(v)
    setStorageSync(VIEW_KEY, v)
  }

  /* ---------------- 判读 ---------------- */

  const onPersistJudge = async (patch: { constitution?: Constitution | null; therapy?: Therapy | null }) => {
    // 本地先更新（界面立刻反映）
    setSessions((prev) =>
      prev.map((s) =>
        s.id === (activeSession?.id || '') ? { ...s, ...patch } : s,
      ),
    )
    const visitId = activeSession?.id
    if (!visitId) return
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
      Taro.showToast({ title: '已保存', icon: 'success' })
    } catch (e) {
      setError((e as Error)?.message || '保存失败')
      Taro.showToast({ title: (e as Error)?.message || '保存失败', icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  /* ---------------- 出图 ---------------- */

  /** 组一份绘制用的 RecordSet（与网站同一形状） */
  const buildSet = () => ({
    name,
    layout,
    sessions: sessions.map((s) => ({
      id: s.id,
      label: s.label || '',
      values: s.values || {},
    })),
  })

  /** 存相册 —— 现场出图，再问相册权限 */
  const onSaveImage = async () => {
    if (busy) return
    setBusy(true)
    let p = ''
    try {
      p = await renderExportImage(buildSet())
    } catch (e) {
      setBusy(false)
      Taro.showToast({ title: (e as Error)?.message || '图还没生成', icon: 'none' })
      return
    }
    setBusy(false)
    // 先看授权态：用户明确拒绝过就别白跑一趟，直接引导去设置页重新打开。
    const granted = await getAlbumAuthState()
    if (granted === false) {
      Taro.showModal({
        title: '暂时存不了',
        content: '你之前拒绝过「保存到相册」的授权。可以在设置里重新打开。',
        confirmText: '去设置',
        success: (r) => {
          if (r.confirm) Taro.openSetting({})
        },
      })
      return
    }
    try {
      await saveImageToAlbum(p)
      Taro.showToast({ title: '已存到相册', icon: 'success' })
    } catch (e) {
      const msg = (e as Error)?.message || ''
      if (isPrivacyNotAuthorized(msg)) {
        // 小程序后台《用户隐私保护指引》里没声明「相册（仅写入）」——
        // 这是开发者侧的配置缺失，用户在设置里也打不开，只能如实告知。
        Taro.showModal({
          title: '暂时存不了',
          content: '这个小程序还没在后台声明「保存到相册」的使用说明，需要开发者补充后才能保存。',
          showCancel: false,
          confirmText: '知道了',
        })
        return
      }
      Taro.showToast({ title: msg || '保存失败', icon: 'none' })
    }
  }

  /** 「寸关尺图示」—— 单独一个窗体看（系统图片预览，可双指缩放） */
  const onShowDiagram = async () => {
    if (busy) return
    setBusy(true)
    try {
      const path = await renderDiagramImage(buildSet())
      previewImage(path)
    } catch (e) {
      Taro.showToast({ title: (e as Error)?.message || '图示出不来', icon: 'none' })
    } finally {
      setBusy(false)
    }
  }

  /** 复制 Markdown／CSV：失败一定要提示，否则用户点了完全没反应（后台未声明剪贴板隐私时就是这样） */
  const copyText = async (text: string) => {
    try {
      await setClipboard(text)
    } catch (e) {
      const msg = (e as Error)?.message || '复制失败'
      Taro.showToast({
        title: isPrivacyNotDeclared(msg) ? '复制失败：后台未声明剪贴板权限' : msg,
        icon: 'none',
      })
    }
  }

  const onCopyMarkdown = () => {
    void copyText(toMarkdown(buildSet(), undefined, customSymbols, activeSessionId))
  }

  const onCopyCsv = () => {
    void copyText(toCsv(buildSet()))
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

      {/* ---------- 脉象 ---------- */}
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
          onSessionTap={setActiveSessionId}
          onToggleLayout={onToggleLayout}
          onAddVisit={onAddVisit}
          onLoadSample={onLoadSample}
        />
      ) : null}

      {/* ---------- 判读 ---------- */}
      {tab === 'judge' && ctx.patientId ? (
        <VisitJudge
          layout={layout}
          values={activeSession?.values || {}}
          constitution={(activeSession?.constitution as Constitution) || null}
          therapy={(activeSession?.therapy as Therapy) || null}
          onPersist={onPersistJudge}
        />
      ) : null}

      {/* ---------- 用药 ---------- */}
      {tab === 'med' && ctx.patientId ? (
        <MedicationPanel
          patientId={ctx.patientId}
          visitId={activeSession?.id ?? null}
          visitDate={ctx.visitDate}
          onChange={setMedications}
        />
      ) : null}

      {/* ---------- 出图 ---------- */}
      {tab === 'export' ? (
        <View className='pr-card'>
          <View className='pr-card-title'>出图</View>
          <Text className='pr-note'>
            导出的记录表照讲义 p34 的版例画（表格 ＋ 寸关尺图示），与网站端同一套绘制代码。
          </Text>

          {/* 离屏画布：不显示，只用来出图。
              不放进 ScrollView —— ScrollView 的 DOM 变化会让节点引用失效。 */}
          <Canvas id='pulse-off-canvas' type='2d' className='pr-off-canvas' />

          <View className='pr-export-ops'>
            <View className='pr-btn pr-btn-primary' onClick={onSaveImage}>
              导出 PNG 存相册
            </View>
            <View className='pr-btn' onClick={onShowDiagram}>
              看寸关尺图示
            </View>
            <View className='pr-btn' onClick={onCopyMarkdown}>
              复制 Markdown
            </View>
            <View className='pr-btn' onClick={onCopyCsv}>
              复制 CSV
            </View>
          </View>
          <Text className='pr-note'>存相册需要「保存到相册」授权；开发者若还没在后台声明，会提示存不了。</Text>
        </View>
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
        <View className='pr-btn' onClick={() => setTab('export')}>
          出图
        </View>
      </ActionBar>
    </View>
  )
}
