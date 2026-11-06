import { Input, Picker, Text, View } from '@tarojs/components'

import type { LayoutMode } from '@domain/types'

import RecordSheet, { type CustomSymbol, type SheetSession } from '../record-sheet'

import './index.scss'

/**
 * 页内 tab「摸脉」—— 录入这一次的脉象
 *
 * 档名从「脉象」改成「摸脉」（2026-11-06）：这一档做的动作是**摸**，
 * 摸出来的才是「脉象」；跟后面三档（体质／疗法／方药）的说法对齐。
 *
 * 表格本体是 `record-sheet` 组件 —— 与病例详情页的「记录表」**同一个组件**，
 * 版式与交互只有一份，不可能再走偏。
 *
 * 这里只做三件事：
 *   1. 工具条（姓名／＋记录／体例／载入示例）
 *   2. 视图切换（宽表 ／ 一次一屏）—— **同一个组件的两个渲染分支**
 *   3. 把组件的改动交给工作台（落库由工作台在「保存」时做）
 */
export interface VisitPulseProps {
  name: string
  layout: LayoutMode
  sessions: SheetSession[]
  customSymbols: CustomSymbol[]
  activeSessionId: string | null
  view: 'wide' | 'single'
  /** 日期选择器的默认值（今天） */
  today: string
  /** 视图切换（本地偏好，不落库） */
  onViewChange: (view: 'wide' | 'single') => void
  onNameChange: (name: string) => void
  onSessionsChange: (sessions: SheetSession[]) => void
  onSessionTap: (id: string) => void
  onToggleLayout: () => void
  onAddVisit: (ymd: string) => void
  onLoadSample: () => void
}

export default function VisitPulse(props: VisitPulseProps) {
  const {
    name,
    layout,
    sessions,
    customSymbols,
    activeSessionId,
    view,
    today,
    onViewChange,
    onNameChange,
    onSessionsChange,
    onSessionTap,
    onToggleLayout,
    onAddVisit,
    onLoadSample,
  } = props

  return (
    <View className='pr-vp'>
      {/* ---------- 工具条 ---------- */}
      <View className='pr-toolbar'>
        <Input
          className='pr-input pr-name-input'
          value={name}
          placeholder='姓名'
          onInput={(e) => onNameChange(e.detail.value)}
        />
        <View className='pr-toolbar-ops'>
          <Picker mode='date' value={today} onChange={(e) => onAddVisit(e.detail.value)}>
            <View className='pr-btn pr-btn-sm'>＋ 记录</View>
          </Picker>
          <View className='pr-btn pr-btn-sm' onClick={onToggleLayout}>
            体例 {layout === 'nine' ? '9 行' : '7 脉点'}
          </View>
          <View className='pr-btn pr-btn-sm' onClick={onLoadSample}>
            载入示例
          </View>
        </View>
      </View>

      {/* ---------- 视图切换：宽表 ／ 一次一屏 ----------
          切换不丢数据：两个视图共用同一份 values。 */}
      <View className='pr-viewswitch'>
        <View
          className={`pr-chip ${view === 'wide' ? 'pr-chip-on' : ''}`}
          onClick={() => onViewChange('wide')}
        >
          宽表
        </View>
        <View
          className={`pr-chip ${view === 'single' ? 'pr-chip-on' : ''}`}
          onClick={() => onViewChange('single')}
        >
          一次一屏
        </View>
        <Text className='pr-note pr-viewswitch-hint'>
          {view === 'wide'
            ? '宽表＝讲义 p34 的记录表体例，横向可滚'
            : '一次一屏＝只摊开这一次就诊的脉点，手机上好点'}
        </Text>
      </View>

      {/* ---------- 主表 ----------
          表格与符号面板、体质／疗法弹层都在 record-sheet 组件里。 */}
      <RecordSheet
        sessions={sessions}
        layout={layout}
        customSymbols={customSymbols}
        name={name}
        editable
        view={view}
        activeSessionId={activeSessionId}
        onChange={onSessionsChange}
        onSessionTap={onSessionTap}
      />
    </View>
  )
}
