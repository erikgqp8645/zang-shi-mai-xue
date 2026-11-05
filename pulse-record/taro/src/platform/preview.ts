import Taro from '@tarojs/taro'

/**
 * 平台适配层 · 预览大图
 *
 * 微信：`Taro.previewImage`（系统图片预览，可双指缩放）。
 * 鸿蒙：Taro 侧是否等价可用**待验证**（P3 阶段实测）。
 */

export function previewImage(filePath: string): void {
  Taro.previewImage({ urls: [filePath], current: filePath })
}
