import { useCallback, useRef, useState } from 'react'
import { Canvas, Text, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter, useShareAppMessage } from '@tarojs/taro'

import type { MedicationRow, Patient } from '@domain/api'
import { formatAt } from '@domain/api'
import type { LayoutMode } from '@domain/types'
import { toCsv, toMarkdown } from '@export/text'

import { getPatient, listCustomSymbols, listMedication, updateVisit } from '../../utils/data'
import { getAlbumAuthState, isPrivacyNotAuthorized, saveImageToAlbum } from '../../platform/album'
import { previewImage } from '../../platform/preview'
import { renderDiagramImage, renderExportImage } from '../../platform/canvas'
import { selectPatient, useVisitContext } from '../../store/context'

import RecordSheet, { type SheetSession } from '../../components/record-sheet'

import './index.scss'

/**
 * 病例详情 —— **看表 + 出图**（非 tab 页）
 *
 * ## 记录表与录入记录是**同一个组件**
 *
 * 用 `components/record-sheet` —— 与「就诊」工作台的脉象页**完全同一个组件**，
 * 版式与交互只有一份，不可能再长得不一样。
 * 这里可以直接点格子改脉象、改体质／疗法，**改完立刻落库**（这一页没有「保存」按钮）。
 *
 * ## 与原生版的差别
 *
 * 原生版把 7 个高频动作做成**文字链接**（寸关尺图示／存到相册／转发／复制 Markdown／
 * 复制 CSV／用药记录／录入编辑），埋在页面里。这里**全部提升为按钮**并按
 * 「出图／录入／去就诊」分组 —— 手机上好点。
 */
export default function CaseDetail() {
  const router = useRouter()
  const ctx = useVisitContext()
  const patientId = String(router.params.patientId || '')

  const [name, setName] = useState('')
  const [layout, setLayout] = useState<LayoutMode>('nine')
  const [sessions, setSessions] = useState<SheetSession[]>([])
  const [medications, setMedications] = useState<MedicationRow[]>([])
  const [customSymbols, setCustomSymbols] = useState<{ code: string; name: string }[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  /** 落库前的快照 —— 用来判断「哪一次就诊被改了」 */
  const snapshot = useRef<{ id: string; values: Record<string, string[]>; constitution: string | null; therapy: string | null }[]>([])

  const load = useCallback(async () => {
    if (!patientId) {
      setError('没有这位患者的记录')
      return
    }
    try {
      const [patient, syms] = await Promise.all([getPatient(patientId), listCustomSymbols()])
      if (!patient) {
        setError('没有这位患者的记录')
        return
      }
      const meds = await listMedication(patientId)
      const list: SheetSession[] = (patient.visits || []).map((v) => ({
        id: v.id,
        label: v.label,
        at: v.at,
        values: v.values || {},
        constitution: v.constitution || null,
        therapy: v.therapy || null,
      }))
      setName(patient.name || '')
      setLayout(patient.layout === 'seven' ? 'seven' : 'nine')
      setSessions(list)
      setMedications(meds)
      setCustomSymbols(syms)
      setError('')
      snapshot.current = list.map((s) => ({
        id: s.id,
        values: s.values || {},
        constitution: s.constitution || null,
        therapy: s.therapy || null,
      }))
    } catch (e) {
      setError((e as Error)?.message || '读取失败')
    }
  }, [patientId])

  useDidShow(() => {
    load()
  })

  /* --------------------------- 组件回调 --------------------------- */

  /** 两个 values 是否等价 */
  const sameValues = (a: Record<string, string[]>, b: Record<string, string[]>) =>
    JSON.stringify(a || {}) === JSON.stringify(b || {})

  /**
   * 组件里改了格值／体质／疗法 → **立即落库**（这一页没有「保存」按钮）。
   *
   * 只写回**被改动的那一次**就诊（PATCH /api/visits/:id），
   * 该患者其它次的记录、用药记录都不动 —— 与网站「单次编辑」语义一致。
   */
  const onSheetChange = async (next: SheetSession[]) => {
    setSessions(next)

    const before = snapshot.current || []
    const changed: SheetSession[] = []
    next.forEach((s) => {
      const old = before.find((o) => o.id === s.id)
      if (!old) return
      if (
        sameValues(old.values, s.values || {}) &&
        (old.constitution || null) === (s.constitution || null) &&
        (old.therapy || null) === (s.therapy || null)
      ) {
        return
      }
      changed.push(s)
    })
    if (!changed.length) return

    try {
      for (const s of changed) {
        await updateVisit(s.id, {
          values: s.values,
          constitution: s.constitution ?? null,
          therapy: s.therapy ?? null,
        })
        // 更新快照 —— 连续改两格不能把第一格写坏
        const snap = snapshot.current.map((o) =>
          o.id === s.id
            ? { ...o, values: s.values || {}, constitution: s.constitution ?? null, therapy: s.therapy ?? null }
            : o,
        )
        snapshot.current = snap
      }
    } catch (e) {
      setError((e as Error)?.message || '保存失败')
    }
  }

  /* --------------------------- 出图 --------------------------- */

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
    const granted = await getAlbumAuthState()
    if (granted === false) {
      Taro.showModal({
        title: '暂时存不了',
        content: '你之前拒绝过「保存到相册」的授权。可以在设置里重新打开。',
        confirmText: '去设置',
        success: (r: { confirm?: boolean }) => {
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

  const onCopyMarkdown = () => {
    Taro.setClipboardData({ data: toMarkdown(buildSet(), undefined, customSymbols, activeSessionId) })
  }

  const onCopyCsv = () => {
    Taro.setClipboardData({ data: toCsv(buildSet()) })
  }

  /** 去「就诊」工作台 —— 切 tab，不是跳页 */
  const goVisit = async () => {
    try {
      const p = (await getPatient(patientId)) as Patient | null
      const visits = (p?.visits || []).map((v) => ({ id: v.id, label: v.label, at: v.at }))
      selectPatient(patientId, visits)
    } catch {
      selectPatient(patientId, [])
    }
    Taro.switchTab({ url: '/pages/visit/index' })
  }

  useShareAppMessage(() => ({
    title: `脉象记录表 · ${name}`,
    path: `/pages/case-detail/index?patientId=${encodeURIComponent(patientId)}`,
  }))

  return (
    <View className='pr-page'>
      {error ? <Text className='pr-note pr-err'>{error}</Text> : null}

      <View className='pr-card'>
        <View className='pr-case-row'>
          <View className='pr-case-name'>{name}</View>
          <View className='pr-case-meta'>{sessions.length} 次记录</View>
        </View>
        <View className='pr-case-ops'>
          <View className='pr-btn pr-btn-sm' onClick={goVisit}>
            去就诊
          </View>
          {ctx.patientId === patientId ? <Text className='pr-note'>当前上下文就是这位患者</Text> : null}
        </View>
      </View>

      {/* 记录表：与「录入记录」**同一个组件**（record-sheet）——
          版式、交互只有一份，两处不可能长得不一样。
          这里可以直接点格子改脉象、改体质／疗法，改完立刻落库。 */}
      <View className='pr-card'>
        <View className='pr-card-head'>
          <View className='pr-card-title'>记录表</View>
          <View className='pr-card-actions'>
            <View className='pr-btn pr-btn-sm' onClick={goVisit}>
              录入编辑
            </View>
          </View>
        </View>
        {/* 体例写在标题旁边：这一页画的行数、录入页画的行数，认的都是它 */}
        <Text className='pr-note'>
          {layout === 'nine' ? '9 行体例（尺浮中沉）' : '7 脉点体例（尺只沉）'} —— 与录入记录的体例一致
        </Text>

        <RecordSheet
          sessions={sessions}
          layout={layout}
          customSymbols={customSymbols}
          name={name}
          editable
          onChange={onSheetChange}
          onSessionTap={setActiveSessionId}
        />

        {/* 高频动作全部是按钮（原生版是文字链接，手机上不好点） */}
        <View className='pr-detail-ops'>
          <View className='pr-btn' onClick={onShowDiagram}>
            寸关尺图示
          </View>
          <View className='pr-btn' onClick={onSaveImage}>
            存到相册
          </View>
          <View className='pr-btn' onClick={onCopyMarkdown}>
            复制 Markdown
          </View>
          <View className='pr-btn' onClick={onCopyCsv}>
            复制 CSV
          </View>
        </View>
      </View>

      {/* 每次就诊记录 */}
      <View className='pr-card'>
        <View className='pr-card-title'>每次就诊记录</View>
        {!sessions.length ? <Text className='pr-note'>（该患者还没有记录）</Text> : null}
        {sessions.map((v) => (
          <View key={v.id} className='pr-visit'>
            <View className='pr-visit-head'>
              <Text className='pr-visit-label'>{v.label || '（未命名日期）'}</Text>
              <Text className='pr-visit-at'>{formatAt(v.at || 0)}</Text>
            </View>
            {v.constitution ? (
              <Text className='pr-visit-tags'>
                {v.constitution}体质 · {v.therapy}
              </Text>
            ) : null}
          </View>
        ))}
      </View>

      {/* 用药记录 */}
      <View className='pr-card'>
        <View className='pr-card-title'>用药记录</View>
        {!medications.length ? <Text className='pr-note'>（还没有用药记录）</Text> : null}
        {medications.map((m) => (
          <View key={m.id} className='pr-visit'>
            <View className='pr-visit-head'>
              <Text className='pr-visit-label'>{m.name}</Text>
            </View>
            {m.pulse ? <Text className='pr-visit-summary'>对应脉象：{m.pulse}</Text> : null}
            {m.adjust ? <Text className='pr-visit-summary'>加减：{m.adjust}</Text> : null}
            {m.usage ? <Text className='pr-visit-summary'>服法：{m.usage}</Text> : null}
            {m.note ? <Text className='pr-visit-summary'>备注：{m.note}</Text> : null}
          </View>
        ))}
      </View>

      {/* 离屏画布：不显示，只用来出图（存相册／转发／寸关尺图示预览） */}
      <Canvas id='pulse-off-canvas' type='2d' className='pr-off-canvas' />

      <View className='pr-disclaimer pr-detail-disclaimer'>
        本工具只做记录，不构成诊断。体质与疗法由使用者自己判断后手工选，工具不代判。
      </View>
    </View>
  )
}
