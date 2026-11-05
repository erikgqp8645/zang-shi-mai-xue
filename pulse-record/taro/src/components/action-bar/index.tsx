import type { PropsWithChildren } from 'react'
import { View } from '@tarojs/components'

import './index.scss'

/**
 * 底部固定操作条（通用件）
 *
 * 固定在屏幕底部，底部留出安全区（Home Indicator）。
 * 内容区要留出等高的底部空白，否则最后一条内容会被压住。
 */
export default function ActionBar({ children }: PropsWithChildren) {
  return <View className='pr-actionbar'>{children}</View>
}
