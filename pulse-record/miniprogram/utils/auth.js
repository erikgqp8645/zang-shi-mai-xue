/**
 * 账号 —— 微信登录 / 账号密码绑定 / 注册 / 登出
 *
 * 账号模型（与服务端一致）：一个 `users` 账号挂多种登录身份（`identities`）。
 * 小程序用「网站账号＋密码」把微信身份绑到同一个账号上，绑定后两端看到同一份数据。
 *
 * `wx.login` 拿到的 code **一次性、时效短**，服务端收到后立即用掉；
 * 失败要能重试 —— 所以每次都重新 `wx.login()` 拿新 code。
 */

const api = require('./api.js')
const storage = require('./storage.js')

/** 拿一个新的 wx.login code */
function wxLoginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        if (res && res.code) resolve(res.code)
        else reject(new Error('微信登录失败：没有拿到 code'))
      },
      fail(err) {
        reject(new Error(err.errMsg || '微信登录失败'))
      },
    })
  })
}

/** 记住登录结果 */
function acceptAuth(payload) {
  if (payload && payload.token) storage.setToken(payload.token)
  if (payload && payload.user) storage.setUser(payload.user)
  return payload
}

/**
 * 微信登录
 * @returns {Promise<{status:'bound',user,token} | {status:'need_bind'}>}
 */
async function wechatLogin() {
  const code = await wxLoginCode()
  const data = await api.request({ method: 'POST', path: '/api/auth/wechat/login', body: { code } })
  if (data && data.status === 'bound') acceptAuth(data)
  return data
}

/**
 * 用「网站账号＋密码」把当前微信身份绑到该账号
 * @returns {Promise<{status:'bound',user,token}>}
 */
async function wechatBind(loginName, password) {
  const code = await wxLoginCode()
  const data = await api.request({
    method: 'POST',
    path: '/api/auth/wechat/bind',
    body: { code, loginName, password },
  })
  if (data && data.token) acceptAuth(data)
  return data
}

/** 账号密码登录 */
async function login(loginName, password) {
  const data = await api.request({
    method: 'POST',
    path: '/api/auth/login',
    body: { loginName, password },
  })
  return acceptAuth(data)
}

/** 注册新账号（同时登录） */
async function register(loginName, displayName, password) {
  const data = await api.request({
    method: 'POST',
    path: '/api/auth/register',
    body: { loginName, displayName, password },
  })
  return acceptAuth(data)
}

/** 当前登录者 ＋ 微信绑定状态 */
async function me() {
  const data = await api.request({ method: 'GET', path: '/api/auth/me' })
  if (data && data.user) storage.setUser(data.user)
  return data
}

/** 改密码（改完服务端会清掉本人全部会话） */
async function changePassword(oldPassword, newPassword) {
  return api.request({
    method: 'POST',
    path: '/api/auth/change-password',
    body: { oldPassword, newPassword },
  })
}

/** 解绑微信身份 */
async function unbindWechat() {
  return api.request({ method: 'DELETE', path: '/api/auth/wechat' })
}

/** 登出（本地清凭证；服务端会话由服务端删） */
async function logout() {
  try {
    await api.request({ method: 'POST', path: '/api/auth/logout' })
  } catch (e) {
    /* 令牌已失效也算登出成功 */
  }
  storage.clearAuth()
}

module.exports = {
  wxLoginCode,
  wechatLogin,
  wechatBind,
  login,
  register,
  me,
  changePassword,
  unbindWechat,
  logout,
}
