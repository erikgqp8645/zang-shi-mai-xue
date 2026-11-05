import Taro from '@tarojs/taro'

/**
 * 平台适配层 · 微信登录
 *
 * 小程序主体是**个人主体** → 不支持 `getPhoneNumber`、不支持 `web-view`。
 * 所以账号打通用「网站账号 ＋ 密码把微信身份绑到同一账号」这条路：
 *
 *   Taro.login() 拿 code → 服务端用它换 openid → 查该微信身份绑的账号
 *   · 已绑定 → 直接给令牌
 *   · 未绑定 → 提示用账号密码绑定
 *
 * `code` **一次性、时效短**，服务端收到后立即用掉；失败要能重试 ——
 * 所以每次都重新 `Taro.login()` 拿新 code。
 *
 * 鸿蒙：一键登录能力**待验证**（P3 阶段）。在此之前账号密码为主。
 */

/** 拿一个新的登录 code */
export function loginCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    Taro.login()
      .then((res) => {
        if (res && res.code) resolve(res.code)
        else reject(new Error('微信登录失败：没有拿到 code'))
      })
      .catch((err: unknown) => {
        reject(new Error((err as { errMsg?: string })?.errMsg || '微信登录失败'))
      })
  })
}
