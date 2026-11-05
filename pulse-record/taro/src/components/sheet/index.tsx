import type { PropsWithChildren } from 'react'
import { ScrollView, View } from '@tarojs/components'

import './index.scss'

/**
 * 底部弹层（Bottom Sheet）—— 通用件
 *
 * 遮罩点击关闭；内容区点一下不关（`stopPropagation`）；
 * 底部留出安全区，避免被 Home Indicator 压住。
 */
export interface SheetProps {
  visible: boolean
  title?: string
  /** 右上角关闭按钮的文案；空＝不显示 */
  closeText?: string
  onClose?: () => void
}

export default function Sheet({ visible, title, closeText = '×', onClose, children }: PropsWithChildren<SheetProps>) {
  if (!visible) return null
  return (
    <View className='pr-sheet-mask' onClick={() => onClose?.()}>
      <View className='pr-sheet-panel' onClick={(e) => e.stopPropagation()}>
        {title || closeText ? (
          <View className='pr-sheet-panel-head'>
            <View className='pr-sheet-panel-title'>{title}</View>
            <View className='pr-sheet-panel-close' onClick={() => onClose?.()}>
              {closeText}
            </View>
          </View>
        ) : null}
        <ScrollView scrollY className='pr-sheet-panel-body'>
          {children}
        </ScrollView>
      </View>
    </View>
  )
}
