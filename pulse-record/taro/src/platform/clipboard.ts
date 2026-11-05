import Taro from '@tarojs/taro'

/**
 * 平台适配层 · 剪贴板
 *
 * 微信：`Taro.setClipboardData`。
 *
 * ⚠️ **上线硬阻塞（与相册同理，但更隐蔽）**：后台《用户隐私保护指引》里必须声明
 * 「读取你的剪切板」（`Clipboard`），否则真机调用直接被禁用。
 *
 * 为什么单独立一个文件：`setClipboardData` 不给 `fail` 回调时**失败是完全静默的** ——
 * 用户点了「复制」，什么都没发生，控制台也不报错。微信社区里大量
 * 「iOS 上 setClipboardData 点不动」的帖子，根因全是后台没声明剪切板隐私类型。
 * 所以这里强制要求调用方接住错误并提示，不能再让失败无声消失。
 */

/** 是不是「开发者没在后台声明剪切板隐私类型」导致的失败 */
export function isPrivacyNotDeclared(message: string): boolean {
  return /api scope is not declared in the privacy agreement/i.test(message || '')
}

/**
 * 写剪贴板。失败时抛出带原始 errMsg 的 Error。
 *
 * 成功时微信自己会弹「内容已复制」的系统提示，不需要再自己弹一次 toast。
 */
export function setClipboard(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    Taro.setClipboardData({ data: text })
      .then(() => resolve())
      .catch((err: unknown) => {
        const msg = (err as { errMsg?: string })?.errMsg || '复制失败'
        reject(new Error(msg))
      })
  })
}
