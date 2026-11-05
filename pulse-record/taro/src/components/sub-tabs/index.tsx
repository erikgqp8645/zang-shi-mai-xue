import { ScrollView, Text, View } from '@tarojs/components'

import './index.scss'

/**
 * 页内 tab（通用件）—— 工作台里的分段切换，**不跳页**
 *
 * 横向可滚动；选中态用主色下划线。
 */
export interface SubTabItem {
  key: string
  label: string
}

export interface SubTabsProps {
  tabs: SubTabItem[]
  active: string
  onChange: (key: string) => void
}

export default function SubTabs({ tabs, active, onChange }: SubTabsProps) {
  return (
    <View className='pr-subtabs'>
      <ScrollView scrollX showScrollbar={false} className='pr-subtabs-scroll'>
        <View className='pr-subtabs-inner'>
          {tabs.map((t) => (
            <View
              key={t.key}
              className={`pr-subtab ${t.key === active ? 'is-on' : ''}`}
              onClick={() => onChange(t.key)}
            >
              <Text className='pr-subtab-label'>{t.label}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}
