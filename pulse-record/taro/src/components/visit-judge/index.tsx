import { useMemo, useState } from 'react'
import { Text, View } from '@tarojs/components'

import type { Constitution, Depth, Hand, LayoutMode, Organ, Therapy } from '@domain/types'
import { cellKey } from '@domain/types'
import {
  BIANMAI_DEFINITION,
  CONSTITUTION_OPTIONS,
  STATE_HINTS,
  THERAPY_OPTIONS,
  prescriptionsOf,
  readTriadReference,
  therapyOf,
} from '@domain/triad'
import { draftDoseView, thDoseView } from '@domain/dose-lookup'

import './index.scss'

/**
 * 页内 tab「判读」—— 开方三部曲的 ①②③
 *
 * 讲义 2026-10 PDF p47（印刷 45）「臧氏脉学 开方三部曲」图：
 *   ①判体质 → ②定疗法 → ③开方药，③ 有一条**虚线回路**回到 ①。
 *
 * 边界（与网站端一致）：
 *   - 体质与疗法**由使用者自己判断后手工选**，工具只记录、不代判、不下诊断、不自动开方。
 *   - 图上两条问句（有变脉？尺脉弱？）只作**参考判据**，标出命中位置，不决定体质。
 *   - 方名照抄（「清挡路方」「冷热水」「引火归元」等），不改成现代教材方名。
 *   - ③ 的方药组成两套并列（同和堂版＝克，讲稿 2010＝比例制），**不可互相换算**。
 *
 * 与原生版最大的差别：**删掉了自带的那套「选患者／选记录」chip** ——
 * 上下文统一由吸顶上下文条提供（见 `store/context.ts`）。
 */
export interface VisitJudgeProps {
  layout: LayoutMode
  /** 当前那一次的脉象值 */
  values: Record<string, string[]>
  constitution: Constitution | null
  therapy: Therapy | null
  /** 体质／疗法改了就写回那次就诊（与网站一致：随记录存） */
  onPersist: (patch: { constitution?: Constitution | null; therapy?: Therapy | null }) => void
}

interface DoseEntry {
  name: string
  composition: string
  science: string
  usage: string
  source: string
  basis: string
}

interface DoseBlock {
  label: string
  missing: boolean
  note: string
  showName: boolean
  entries: DoseEntry[]
}

/** 把一个 DoseSourceView 摊平成可渲染的结构 */
function doseBlock(label: string, view: ReturnType<typeof thDoseView>): DoseBlock {
  if (!view || view.matched === 'none') {
    return { label, missing: true, note: '', showName: false, entries: [] }
  }
  const note =
    view.entries.length > 1
      ? `　同名不同号 ${view.entries.length} 条（原方名各不相同，工具不替你选）`
      : '　名称含此名的一条（原方名见后）'
  const showName = view.matched === 'contains' || view.matched === 'alias'
  return {
    label,
    missing: false,
    note: view.matched === 'contains' ? note : view.matched === 'alias' ? '　别名对照（有明确对照依据）' : '',
    showName,
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

export default function VisitJudge({ layout, values, constitution, therapy, onPersist }: VisitJudgeProps) {
  const [carriedTherapy, setCarriedTherapy] = useState('')

  /** 参考判据 ＋ ③ 的方药清单 */
  const computed = useMemo(() => {
    const depthsOf = (organ: string) => {
      const all: Record<string, string[]> = {
        寸: ['浮', '中', '沉'],
        关: ['浮', '中', '沉'],
        尺: layout === 'seven' ? ['沉'] : ['浮', '中', '沉'],
      }
      return all[organ] || []
    }
    const ref = readTriadReference({
      layout,
      get: (hand: Hand, organ: Organ, depth: Depth) => values[cellKey(hand, organ, depth)] || [],
      depths: depthsOf as never,
    })
    const rx = (therapy ? prescriptionsOf(therapy) : []).map((p) => ({
      no: p.no,
      name: p.name,
      source: p.source,
      doses: [
        doseBlock('同和堂版（克）', thDoseView(p.name)),
        doseBlock('讲稿 2010（比例制）', draftDoseView(p.name)),
      ],
    }))
    return {
      recorded: ref.recorded,
      bianmai: ref.bianmai ? ref.bianmai.cells.length : 0,
      chimai: ref.chimai ? ref.chimai.cells.length : 0,
      chimaiReached: ref.chimaiReached,
      suggested: ref.suggested || '',
      rx,
    }
  }, [layout, values, therapy])

  const pickConstitution = (id: Constitution) => {
    const carried = therapyOf(id)
    setCarriedTherapy(carried)
    onPersist({ constitution: id, therapy: therapy || carried })
  }

  const clearConstitution = () => {
    setCarriedTherapy('')
    onPersist({ constitution: null, therapy: null })
  }

  const pickTherapy = (id: Therapy) => {
    onPersist({ therapy: id })
  }

  const clearTherapy = () => {
    onPersist({ therapy: null })
  }

  return (
    <View className='pr-vj'>
      {/* ---------- 三步导航 ---------- */}
      <View className='pr-triad-head'>
        <View className='pr-triad-step'>
          <View className='pr-triad-no'>①</View>
          <View className='pr-triad-step-title'>判体质</View>
          <View className='pr-triad-step-note'>自己判断后点选（工具不代判）</View>
        </View>
        <View className='pr-triad-step'>
          <View className='pr-triad-no'>②</View>
          <View className='pr-triad-step-title'>定疗法</View>
          <View className='pr-triad-step-note'>自己点选（工具不代判）</View>
        </View>
        <View className='pr-triad-step'>
          <View className='pr-triad-no'>③</View>
          <View className='pr-triad-step-title'>开方药</View>
          <View className='pr-triad-step-note'>照讲义 p47 图列出那一支的方</View>
        </View>
      </View>
      <Text className='pr-note'>③ 之后回到 ① 重判（讲义 p47 图上的虚线回路）。</Text>

      {/* ---------- 参考判据（图上两条问句） ---------- */}
      <View className='pr-card'>
        <View className='pr-card-title'>参考判据（只作参考，不决定体质）</View>
        {!computed.recorded ? <Text className='pr-note'>还没录到脉象，图上的判定链走不起来。</Text> : null}
        {computed.bianmai ? (
          <Text className='pr-note'>参考：有变脉？已命中 {computed.bianmai} 处</Text>
        ) : null}
        {computed.recorded && computed.chimaiReached && computed.chimai ? (
          <Text className='pr-note'>参考：尺脉弱？已命中 {computed.chimai} 处</Text>
        ) : null}
        {computed.recorded && computed.chimaiReached && !computed.chimai ? (
          <Text className='pr-note'>参考：尺脉不弱</Text>
        ) : null}
        {computed.suggested ? (
          <Text className='pr-note'>按图会落到：{computed.suggested}体质（仅供参考，是否采用由你决定）</Text>
        ) : null}
        <View className='pr-divider' />
        <Text className='pr-note'>
          {BIANMAI_DEFINITION.title}：{BIANMAI_DEFINITION.text}
        </Text>
        <Text className='pr-note'>〔{BIANMAI_DEFINITION.source}〕</Text>
        <Text className='pr-note'>状态（佐证，不是脉象判据）</Text>
        {STATE_HINTS.map((h) => (
          <Text key={h.constitution} className='pr-note'>
            {h.text} → {h.constitution}　〔{h.source}〕
          </Text>
        ))}
      </View>

      {/* ---------- ① 判体质 ---------- */}
      <View className='pr-card'>
        <View className='pr-card-title'>① 判体质</View>
        {CONSTITUTION_OPTIONS.map((o) => (
          <View
            key={o.id}
            className={`pr-triad-opt ${constitution === o.id ? 'is-on' : ''}`}
            onClick={() => pickConstitution(o.id)}
          >
            <View className='pr-triad-opt-name'>{o.label}</View>
            <Text className='pr-note'>{o.path}</Text>
            {o.stateHint ? <Text className='pr-note'>状态佐证：{o.stateHint}</Text> : null}
            <Text className='pr-note'>〔{o.source}〕</Text>
          </View>
        ))}
        {constitution ? (
          <View className='pr-triad-clear' onClick={clearConstitution}>
            清除体质
          </View>
        ) : null}
      </View>

      {/* ---------- ② 定疗法 ---------- */}
      <View className='pr-card'>
        <View className='pr-card-title'>② 定疗法</View>
        {carriedTherapy ? <Text className='pr-note'>随体质带出「{carriedTherapy}」，仍可改</Text> : null}
        {THERAPY_OPTIONS.map((o) => (
          <View
            key={o.id}
            className={`pr-triad-opt ${therapy === o.id ? 'is-on' : ''}`}
            onClick={() => pickTherapy(o.id)}
          >
            <View className='pr-triad-opt-name'>{o.label}</View>
            <Text className='pr-note'>{o.prescriptions.map((p) => p.name).join('、')}</Text>
            <Text className='pr-note'>〔{o.source}〕</Text>
          </View>
        ))}
        {therapy ? (
          <View className='pr-triad-clear' onClick={clearTherapy}>
            清除疗法
          </View>
        ) : null}
      </View>

      {/* ---------- ③ 开方药 ---------- */}
      <View className='pr-card'>
        <View className='pr-card-title'>③ 开方药</View>
        {!computed.rx.length ? (
          <Text className='pr-note'>在 ② 选定疗法后，按讲义 p47 图列出那一支的方。</Text>
        ) : null}
        {computed.rx.map((r) => (
          <View key={r.no} className='pr-triad-rx'>
            <View className='pr-triad-rx-name'>
              {r.no}. {r.name}
            </View>
            <Text className='pr-note'>〔{r.source}〕</Text>
            {r.doses.map((d) => (
              <View key={d.label}>
                <View className='pr-dose-label'>{d.label}</View>
                {d.missing ? <Text className='pr-note'>未载</Text> : null}
                {!d.missing && d.note ? <Text className='pr-note'>{d.note}</Text> : null}
                {d.entries.map((e) => (
                  <View key={e.name} className='pr-dose-line'>
                    {d.showName ? <Text>{e.name}：</Text> : null}
                    <Text>{e.composition}</Text>
                    {e.science ? <Text>　科中：{e.science}</Text> : null}
                    {e.usage ? <Text>　服法：{e.usage}</Text> : null}
                    <Text className='pr-dose-src'>〔{e.source}〕</Text>
                    {e.basis ? <Text>　对照：{e.basis}</Text> : null}
                  </View>
                ))}
              </View>
            ))}
          </View>
        ))}
      </View>

      <View className='pr-disclaimer'>
        本工具只做记录，不构成诊断。③ 的方名与组成照讲义 p47 与讲稿 2010 原样列出，不替读者加减方。
      </View>
    </View>
  )
}
