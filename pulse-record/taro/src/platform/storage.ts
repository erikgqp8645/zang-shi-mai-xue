import Taro from '@tarojs/taro'

/**
 * 平台适配层 · 本地存储
 *
 * 微信与鸿蒙都用同步键值存储，接口一致 —— 这里只做一层薄封装，
 * 目的是让「业务代码里不许出现 wx.」这条规矩真正成立：
 * 所有存储读写都从这里过，将来换平台只改这一处。
 *
 * 与网站端一一对应：
 *   localStorage['pulse.token'] → getStorageSync('pulse.token')
 */

export function getStorageSync(key: string): string {
  try {
    return (Taro.getStorageSync(key) as string) || ''
  } catch {
    return ''
  }
}

export function setStorageSync(key: string, value: unknown): void {
  try {
    Taro.setStorageSync(key, value as never)
  } catch {
    /* 存储失败不致命：本次会话仍可用 */
  }
}

export function removeStorageSync(key: string): void {
  try {
    Taro.removeStorageSync(key)
  } catch {
    /* ignore */
  }
}
