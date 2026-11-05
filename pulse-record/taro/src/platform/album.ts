import Taro from '@tarojs/taro'

/**
 * 平台适配层 · 存相册
 *
 * 微信：`Taro.saveImageToPhotosAlbum`。
 *
 * ⚠️ **上线硬阻塞**：小程序后台《用户隐私保护指引》里必须声明「相册（仅写入）」，
 * 否则真机会报 `saveImageToPhotosAlbum:fail privacy permission is not authorized`，
 * 而且用户在设置里也打不开。下面的 `isPrivacyNotAuthorized` 就是在识别这个错。
 *
 * 鸿蒙：对应能力是 ArkTS 的 `photoAccessHelper`，**待验证**（P3 阶段）。
 * 验证前鸿蒙侧走「只预览不落盘」的降级路径，不让整个就诊流程不可用。
 */

/** 授权态：true 已授权 / false 用户明确拒绝过 / undefined 没问过 */
export type AlbumAuthState = boolean | undefined

export function getAlbumAuthState(): Promise<AlbumAuthState> {
  return new Promise((resolve) => {
    Taro.getSetting({
      // 微信的 getSetting 支持 withAuthorization；Taro 的类型没列这个字段 —— 运行时是支持的
      withAuthorization: true,
    } as never)
      .then((res) => {
        // 微信的 authSetting 是**扁平**的：键就是 'scope.writePhotosAlbum'
        const auth = (res.authSetting || {}) as unknown as Record<string, boolean | undefined>
        resolve(auth['scope.writePhotosAlbum'])
      })
      .catch(() => resolve(undefined))
  })
}

/** 打开设置页，让用户重新打开授权 */
export function openSetting(): Promise<void> {
  return new Promise((resolve) => {
    Taro.openSetting({}).catch(() => undefined).then(() => resolve())
  })
}

/** 是不是「开发者没在后台声明相册权限」导致的失败 */
export function isPrivacyNotAuthorized(message: string): boolean {
  return /privacy permission is not authorized/i.test(message || '')
}

/** 真正写相册；失败时把原始错误抛出去，由调用方决定怎么提示 */
export function saveImageToAlbum(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    Taro.saveImageToPhotosAlbum({ filePath })
      .then(() => resolve())
      .catch((err: unknown) => {
        const msg = (err as { errMsg?: string })?.errMsg || '保存失败'
        reject(new Error(msg))
      })
  })
}
