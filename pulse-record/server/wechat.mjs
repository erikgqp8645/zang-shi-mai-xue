/**
 * 微信小程序登录（code2Session 代理）
 *
 * 小程序 wx.login() 拿到一次性 code → 发给服务端 → 服务端用它换 openid。
 *
 *   GET https://api.weixin.qq.com/sns/jscode2session
 *       ?appid=APPID&secret=SECRET&js_code=JS_CODE&grant_type=authorization_code
 *
 * 官方文档：https://developers.weixin.qq.com/miniprogram/dev/server/API/user-login/api_code2session.html
 *   - 「适用范围：小程序 ✔ / 小游戏 ✔」——**不按主体类型限制**，个人主体可用
 *   - 接口应在服务器端调用，不可在前端直接调用
 *   - 返回 openid / session_key / unionid（unionid 需小程序绑了开放平台才有）
 *
 * **session_key 只留在服务端内存里**，既不落库也不下发前端。
 *
 * AppID / AppSecret 来自环境变量，**绝不入库、不进仓库**。
 *
 * ## 变量名为什么是 `PULSE_WX_*`，不是 `WX_*`
 *
 * 云函数跑在 CloudBase 运行时里，`WX_` 这个前缀**被平台自己占着**（留给微信云开发的
 * 小程序关联信息）。我们把 AppID 写进 `WX_APPID`，运行时那边会用平台的值把它**盖掉** ——
 * 环境没关联小程序时那个值是空的，于是服务端永远以为「没配 AppID」。
 *
 * 实测（2026-11，CloudBase 体验版环境）：
 *   · 新增 `PULSE_SINGLE_USER` → 立刻生效
 *   · 更新 `PULSE_CORS_ORIGINS` → 立刻生效
 *   · 新增 `WX_APPID` / `WX_APPSECRET` → API 存进去了、GetFunction 也读得到，**但运行时读不到**
 *
 * 所以本项目一律用 `PULSE_` 前缀；`WX_APPID` / `WX_APPSECRET` 只作为**兜底**保留
 * （本地自建服务、老部署里用的还是老名字）。
 */

const WX_API = 'https://api.weixin.qq.com/sns/jscode2session'

/** 微信返回的错误码 → 中文提示（给使用者看的，不给开发者看） */
const ERRCODE_MESSAGES = {
  40029: '登录凭证已失效，请重新进入页面再试',
  40226: '该微信账号被平台拦截了（存在安全风险），本工具暂时无法为你登录',
  45011: '操作太频繁了，请稍后再试',
  40013: '小程序配置有误（AppID 不正确），请联系维护者',
  40125: '小程序配置有误（AppSecret 不正确），请联系维护者',
  '-1': '微信服务器繁忙，请稍后再试',
}

/**
 * 读环境变量里的 AppID / AppSecret。
 *
 * 优先 `PULSE_WX_*`（云函数用这个 —— `WX_` 前缀会被平台覆盖，见文件头说明），
 * 退回 `WX_*`（本地自建服务 / 老部署还在用老名字）。
 */
export function wxConfig() {
  return {
    appid: process.env.PULSE_WX_APPID || process.env.WX_APPID || '',
    appsecret: process.env.PULSE_WX_APPSECRET || process.env.WX_APPSECRET || '',
  }
}

/** 是否配好了微信登录所需的配置 */
export function isWxConfigured() {
  const { appid, appsecret } = wxConfig()
  return !!(appid && appsecret)
}

/**
 * 用 code 换 openid。
 * 成功 → { ok: true, openid, unionId }
 * 失败 → { ok: false, error, code }，error 是可直接展示的中文提示
 */
export async function code2Session(code) {
  const jsCode = String(code ?? '').trim()
  if (!jsCode) return { ok: false, error: '缺少登录凭证（code）', code: 0 }

  const { appid, appsecret } = wxConfig()
  if (!appid || !appsecret) {
    // 两个变量名都要出现（要能一眼看出配哪个），同时点名**具体缺哪个**
    const missing = []
    if (!appid) missing.push('PULSE_WX_APPID')
    if (!appsecret) missing.push('PULSE_WX_APPSECRET')
    return {
      ok: false,
      error:
        '服务端还没配置小程序登录' +
        '（需要 PULSE_WX_APPID 与 PULSE_WX_APPSECRET，当前缺少 ' +
        missing.join(' / ') +
        '），请先用账号密码登录',
      code: 0,
    }
  }

  const url =
    `${WX_API}?appid=${encodeURIComponent(appid)}` +
    `&secret=${encodeURIComponent(appsecret)}` +
    `&js_code=${encodeURIComponent(jsCode)}` +
    `&grant_type=authorization_code`

  let data
  try {
    const res = await fetch(url, { method: 'GET' })
    data = await res.json()
  } catch (e) {
    return { ok: false, error: '连不上微信服务器，请检查网络后重试', code: 0 }
  }

  if (data?.errcode) {
    const code = Number(data.errcode)
    return {
      ok: false,
      error: ERRCODE_MESSAGES[code] ?? `微信登录失败（错误码 ${code}）`,
      code,
    }
  }

  if (!data?.openid) {
    return { ok: false, error: '微信没有返回用户标识，请稍后再试', code: 0 }
  }

  // session_key 不外传
  return { ok: true, openid: String(data.openid), unionId: data.unionid ? String(data.unionid) : null }
}
