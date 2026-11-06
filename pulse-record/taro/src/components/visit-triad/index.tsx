import { useMemo } from 'react'
import Taro from '@tarojs/taro'
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
import { resolveFormulaLink, type FormulaLink } from '@domain/formula-links'
import { setFormulaFocus } from '../../store/focus'

import './index.scss'

/**
 * 开方三部曲 —— **拆成三档页内 tab**（体质／疗法／方药）
 *
 * 讲义 2026-10 PDF p47（印刷 45）「臧氏脉学 开方三部曲」图：
 *   ①判体质 → ②定疗法 → ③开方药，③ 有一条**虚线回路**回到 ①。
 *
 * ## 为什么拆开
 *
 * 原来这三步挤在一个「判读」页内 tab 里。那一档**名不副实** ——
 * 里面做的全是「使用者自己判断、自己点选」，工具只负责记下来，
 * 根本不「判读」。2026-11-06 起按实际动作拆成三档：
 *
 *   体质档 → ① 判体质 ＋ 图上两条问句的参考判据
 *   疗法档 → ② 定疗法
 *   方药档 → ③ 开方药清单 ＋ 用药记录（用药记录由页面那一层拼进来）
 *
 * 拆开的依据是**网站端**（`src/components/TriadFrame.tsx`）：
 *   「③ 开方药 → 开方药清单 ＋ 用药记录」 —— 用药记录本来就属于 ③。
 * 小程序原来把「用药」单列一档，等于把 ③ 劈成两半；现在合回去。
 *
 * ## 边界（与网站端一致）
 *
 *   - 体质与疗法**由使用者自己判断后手工选**，工具只记录、不代判、不下诊断、不自动开方。
 *   - 图上两条问句（有变脉？尺脉弱？）只作**参考判据**，标出命中位置，不决定体质。
 *   - 方名照抄（「清挡路方」「冷热水」「引火归元」等），不改成现代教材方名。
 *   - ③ 的方药组成两套并列（同和堂版＝克，讲稿 2010＝比例制），**不可互相换算**。
 *
 * ## 与原生版最大的差别
 *
 * **删掉了自带的那套「选患者／选记录」chip** ——
 * 上下文统一由吸顶上下文条提供（见 `store/context.ts`）。
 */
export type TriadSection = 'constitution' | 'therapy' | 'rx'

export interface VisitTriadProps {
  /** 这一档是三部曲的哪一步 */
  section: TriadSection
  layout: LayoutMode
  /** 当前那一次的脉象值 */
  values: Record<string, string[]>
  constitution: Constitution | null
  therapy: Therapy | null
  /** 体质／疗法改了就写回那次就诊（与网站一致：随记录存） */
  onPersist: (patch: { constitution?: Constitution | null; therapy?: Therapy | null }) => void
}

/** 三步导航的三个框 —— 照讲义 p47 图上的次序与措辞 */
const STEPS: { no: string; key: TriadSection; title: string; note: string }[] = [
  { no: '①', key: 'constitution', title: '判体质', note: '自己判断后点选（工具不代判）' },
  { no: '②', key: 'therapy', title: '定疗法', note: '自己点选（工具不代判）' },
  { no: '③', key: 'rx', title: '开方药', note: '照讲义 p47 图列出那一支的方' },
]

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

export default function VisitTriad({
  section,
  layout,
  values,
  constitution,
  therapy,
  onPersist,
}: VisitTriadProps) {
  /** 参考判据（图上两条问句）—— 只有「体质」那一档用得上 */
  const hits = useMemo(() => {
    const depthsOf = (organ: string) => {
      const all: Record<string, string[]> = {
        寸: ['浮', '中', '沉'],
        关: ['浮', '中', '沉'],
        尺: layout === 'seven' ? ['沉'] : ['浮', '中', '沉'],
      }
      return all[organ] || []
    }
    const r = readTriadReference({
      layout,
      get: (hand: Hand, organ: Organ, depth: Depth) => values[cellKey(hand, organ, depth)] || [],
      depths: depthsOf as never,
    })
    return {
      recorded: r.recorded,
      bianmai: r.bianmai ? r.bianmai.cells.length : 0,
      chimai: r.chimai ? r.chimai.cells.length : 0,
      chimaiReached: r.chimaiReached,
      suggested: r.suggested || '',
    }
  }, [layout, values])

  /** ③ 的方药清单 —— 只有「方药」那一档用得上 */
  const rx = useMemo(() => {
    return (therapy ? prescriptionsOf(therapy) : []).map((p) => ({
      no: p.no,
      name: p.name,
      source: p.source,
      doses: [
        doseBlock('同和堂版（克）', thDoseView(p.name)),
        doseBlock('讲稿 2010（比例制）', draftDoseView(p.name)),
      ],
    }))
  }, [therapy])

  /**
   * ③ 的方名 → 跳到「用方」tab 并定位到那一条。
   *
   * `switchTab` **不能带 query 参数**（微信小程序限制），
   * 所以先把意图记在内存态（`store/focus.ts`），用方页 `useDidShow` 时取走。
   */
  const openFormula = (link: FormulaLink) => {
    setFormulaFocus(link)
    Taro.switchTab({ url: '/pages/formulas/index' })
  }

  const pickConstitution = (id: Constitution) => {
    const carried = therapyOf(id)
    onPersist({ constitution: id, therapy: therapy || carried })
  }

  const clearConstitution = () => {
    onPersist({ constitution: null, therapy: null })
  }

  const pickTherapy = (id: Therapy) => {
    onPersist({ therapy: id })
  }

  const clearTherapy = () => {
    onPersist({ therapy: null })
  }

  /**
   * 「随体质带出的那个疗法」—— **由体质直接推出来，不另存一份状态**。
   *
   * 拆档之前它是个组件内的 useState（选体质时写进去），
   * 拆成三档之后组件会随切档卸载，那份状态就丢了 —— 改成推出来的，
   * 切档来回走也不会失忆，还多带一句「现在选的是哪个」。
   */
  const carried = constitution ? therapyOf(constitution) : ''

  return (
    <View className='pr-vt'>
      {/* ---------- 三步导航（讲义 p47 那条链） ---------- */}
      <View className='pr-triad-head'>
        {STEPS.map((s) => (
          <View key={s.no} className={`pr-triad-step ${s.key === section ? 'is-on' : ''}`}>
            <View className='pr-triad-no'>{s.no}</View>
            <View className='pr-triad-step-title'>{s.title}</View>
            <View className='pr-triad-step-note'>{s.note}</View>
          </View>
        ))}
      </View>
      <Text className='pr-note'>③ 之后回到 ① 重判（讲义 p47 图上的虚线回路）。</Text>

      {/* ---------- 体质档：① 判体质 ---------- */}
      {section === 'constitution' ? (
        <>
          {/* 参考判据（图上两条问句） */}
          <View className='pr-card'>
            <View className='pr-card-title'>参考判据（只作参考，不决定体质）</View>
            {!hits.recorded ? <Text className='pr-note'>还没录到脉象，图上的判定链走不起来。</Text> : null}
            {hits.bianmai ? (
              <Text className='pr-note'>参考：有变脉？已命中 {hits.bianmai} 处</Text>
            ) : null}
            {hits.recorded && hits.chimaiReached && hits.chimai ? (
              <Text className='pr-note'>参考：尺脉弱？已命中 {hits.chimai} 处</Text>
            ) : null}
            {hits.recorded && hits.chimaiReached && !hits.chimai ? (
              <Text className='pr-note'>参考：尺脉不弱</Text>
            ) : null}
            {hits.suggested ? (
              <Text className='pr-note'>按图会落到：{hits.suggested}体质（仅供参考，是否采用由你决定）</Text>
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

          {/* ① 判体质 */}
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
        </>
      ) : null}

      {/* ---------- 疗法档：② 定疗法 ---------- */}
      {section === 'therapy' ? (
        <View className='pr-card'>
          <View className='pr-card-title'>② 定疗法</View>
          {carried ? (
            <Text className='pr-note'>
              随体质带出「{carried}」
              {therapy && therapy !== carried ? `，现在选的是「${therapy}」` : ''}
              ，仍可改
            </Text>
          ) : null}
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
      ) : null}

      {/* ---------- 方药档：③ 开方药 ---------- */}
      {section === 'rx' ? (
        <View className='pr-card'>
          <View className='pr-card-title'>③ 开方药</View>
          {!rx.length ? (
            <Text className='pr-note'>在 ② 选定疗法后，按讲义 p47 图列出那一支的方。</Text>
          ) : null}
          {rx.map((r) => {
            /* ③ 的方名 → 「用方」知识库条目。
               对得上的**可点**（跳过去看组成／服法／禁忌），
               对不上的明说「用方页未载」—— 不硬凑（依据见 @domain/formula-links）。 */
            const link = resolveFormulaLink(r.name)
            return (
              <View key={r.no} className='pr-triad-rx'>
                <View className='pr-triad-rx-name'>
                  {r.no}.{' '}
                  {link ? (
                    <Text className='pr-link' onClick={() => openFormula(link)}>
                      {r.name}
                    </Text>
                  ) : (
                    <Text>{r.name}</Text>
                  )}
                  {link ? null : <Text className='pr-note'>　用方页未载</Text>}
                </View>
                {link ? (
                  <Text className='pr-note' onClick={() => openFormula(link)}>
                    〔点方名看「用方」里的完整条目：{link.label}〕
                  </Text>
                ) : null}
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
            )
          })}
        </View>
      ) : null}

      {/* ---------- 声明 ----------
          「本工具只做记录，不构成诊断」那句由**页面那一层**统一出（对四档都成立），
          这里不再重复一遍 —— 重复出来两份一模一样的字，反倒看不出哪句管哪档。
          这一层只补 ③ 特有的那一句：方名与组成照抄，不替读者加减方。 */}
      {section === 'rx' ? (
        <View className='pr-disclaimer'>
          ③ 的方名与组成照讲义 p47 与讲稿 2010 原样列出，不替读者加减方。
        </View>
      ) : null}
    </View>
  )
}
