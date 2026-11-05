import { useCallback, useState } from 'react'
import { Input, Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'

import type { PatientSummary } from '@domain/api'
import { formatAt } from '@domain/api'

import { listPatients } from '../../utils/data'
import { selectPatient, selectVisit, useVisitContext } from '../../store/context'
import Sheet from '../sheet'

import './index.scss'

/**
 * 吸顶上下文条 —— **全局上下文（患者 × 就诊）的唯一入口**
 *
 * ## 它解决什么
 *
 * 原生版里同一个上下文散在 5 个地方各选各的、互不同步，还完全不持久化。
 * 现在四个 tab 共用这一条：顶部一直显示「谁 · 哪一次」，点它换人换次。
 *
 * ## 行为
 *
 *   · 点一下 → 底部弹层：上半是患者（可搜索），下半是这位患者的每次就诊
 *   · 选患者 → 自动落到该患者最近一次就诊（没有则进入「新建一次」状态）
 *   · 选就诊 → 日期标签跟着这次走
 *   · 上下文**落盘**，杀掉重进还记得
 */
export interface ContextBarProps {
  /** 外部已经加载好患者列表时可传入，省一次请求 */
  patients?: PatientSummary[]
}

export default function ContextBar({ patients: patientsProp }: ContextBarProps) {
  const ctx = useVisitContext()
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [patients, setPatients] = useState<PatientSummary[]>(patientsProp || [])
  const [visits, setVisits] = useState<
    { id: string; label: string; at: number; summary?: string }[]
  >([])

  /** 拉患者列表（弹层打开时用） */
  const loadPatients = useCallback(async () => {
    try {
      const list = patientsProp || (await listPatients())
      setPatients(list)
    } catch {
      setPatients([])
    }
  }, [patientsProp])

  useDidShow(() => {
    if (patientsProp) setPatients(patientsProp)
  })

  /** 换患者：同时把该患者的每次就诊拉出来 */
  const onPickPatient = useCallback(
    async (id: string) => {
      try {
        const detail = await import('../../utils/data').then((m) => m.getPatient(id))
        const list = (detail?.visits || []).map((v) => ({
          id: v.id,
          label: v.label,
          at: v.at,
        }))
        setVisits(list)
        selectPatient(id, list)
      } catch {
        setVisits([])
        selectPatient(id, [])
      }
      // 选完人就把抽屉收掉 —— 上下文已经落到这位患者最近一次就诊（`selectPatient` 干的），
      // 留着抽屉只会挡住底下要录的表。要换别的就诊，再点一次吸顶条。
      setOpen(false)
    },
    [],
  )

  const shown = keyword.trim()
    ? patients.filter(
        (p) =>
          p.name.includes(keyword.trim()) ||
          (p.matchedVisits || []).some((v) => v.label.includes(keyword.trim())),
      )
    : patients

  const currentName =
    patients.find((p) => p.id === ctx.patientId)?.name || (ctx.patientId ? '（患者）' : '')

  return (
    <View className='pr-ctx'>
      <View
        className='pr-ctx-bar'
        onClick={() => {
          setOpen(true)
          loadPatients()
        }}
      >
        <Text className='pr-ctx-who'>{currentName || '选患者'}</Text>
        <Text className='pr-ctx-when'>{ctx.visitDate}</Text>
        <Text className='pr-ctx-caret'>▾</Text>
      </View>

      <Sheet visible={open} title='选患者 · 选就诊' onClose={() => setOpen(false)}>
        <Input
          className='pr-input'
          value={keyword}
          placeholder='搜姓名 / 日期'
          onInput={(e) => setKeyword(e.detail.value)}
        />

        <View className='pr-ctx-sec'>患者</View>
        {shown.length ? (
          shown.map((p) => (
            <View
              key={p.id}
              className={`pr-ctx-item ${p.id === ctx.patientId ? 'is-on' : ''}`}
              onClick={() => onPickPatient(p.id)}
            >
              <Text className='pr-ctx-item-name'>{p.name}</Text>
              <Text className='pr-ctx-item-meta'>{p.visitCount} 次</Text>
            </View>
          ))
        ) : (
          <View className='pr-empty'>没有匹配的患者</View>
        )}

        <View className='pr-ctx-sec'>这次就诊</View>
        {visits.length ? (
          visits.map((v) => (
            <View
              key={v.id}
              className={`pr-ctx-item ${v.id === ctx.visitId ? 'is-on' : ''}`}
              onClick={() => {
                selectVisit(v)
                setOpen(false)
              }}
            >
              <Text className='pr-ctx-item-name'>{v.label || '（未命名日期）'}</Text>
              <Text className='pr-ctx-item-meta'>{formatAt(v.at)}</Text>
            </View>
          ))
        ) : (
          <View className='pr-note'>先选一位患者 —— 选完这里会列出她的每次就诊。</View>
        )}
      </Sheet>
    </View>
  )
}
