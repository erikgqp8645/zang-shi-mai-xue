/**
 * API 传输层
 *
 * 上层（页面）只认一个签名：
 *
 *     request({ method, path, body }) → Promise<data>
 *
 * 底下用哪种传输（wx.request / wx.cloud.callFunction）由 `utils/config.js` 的
 * TRANSPORT 决定 —— 迁到 CloudBase 时只改配置，页面代码一行不动。
 *
 * 鉴权：令牌放在 `Authorization: Bearer <token>` 头（与服务端一致）。
 * 401 → 清令牌 ＋ 跳回登录页（不静默失败）。
 *
 * 服务器地址**每次请求都从 config 现取**（`resolveApiBase()`），
 * 所以在「我的」页改完地址立刻生效，不用重启小程序。
 */

const config = require('./config.js')
const storage = require('./storage.js')

/** 统一的错误对象：带 HTTP 状态码，页面据此区分「要重新登录」与「别的错」 */
function ApiError(message, status) {
  const e = new Error(message)
  e.name = 'ApiError'
  e.status = status
  return e
}

/** 令牌失效：清掉本地凭证并回登录页 */
function onUnauthorized() {
  storage.clearAuth()
  const pages = getCurrentPages()
  const cur = pages.length ? pages[pages.length - 1] : null
  if (!cur || cur.route !== 'pages/login/login') {
    wx.reLaunch({ url: '/pages/login/login' })
  }
}

/* ------------------------------ wx.request ------------------------------ */

function viaRequest(options) {
  return new Promise((resolve, reject) => {
    const token = storage.getToken()
    const header = { 'content-type': 'application/json' }
    if (token) header.Authorization = 'Bearer ' + token

    wx.request({
      url: config.resolveApiBase() + options.path,
      method: options.method || 'GET',
      data: options.body,
      header,
      success(res) {
        const data = res.data || {}
        if (res.statusCode === 401) {
          onUnauthorized()
          reject(ApiError(data.error || '请先登录', 401))
          return
        }
        if (res.statusCode >= 400) {
          reject(ApiError(data.error || '请求失败（' + res.statusCode + '）', res.statusCode))
          return
        }
        resolve(data)
      },
      fail(err) {
        reject(ApiError(err.errMsg || '网络请求失败', 0))
      },
    })
  })
}

/* --------------------------- wx.cloud.callFunction --------------------------- */

/**
 * CloudBase 云函数约定：
 *
 *     exports.main = async (event, context) => {
 *       // event = { path, method, body, token }
 *       // 返回 { statusCode, body }
 *     }
 *
 * 这样服务端那一套路由逻辑可以整体搬进云函数，小程序端不用改。
 */
function viaCloud(options) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud) {
      reject(ApiError('当前基础库不支持云调用，请改用 request 传输方式', 0))
      return
    }
    wx.cloud.callFunction({
      name: config.CLOUD_FUNCTION_NAME,
      data: {
        path: options.path,
        method: options.method || 'GET',
        body: options.body || null,
        token: storage.getToken() || '',
      },
      success(res) {
        const r = res.result || {}
        const status = r.statusCode || 500
        const data = r.body || {}
        if (status === 401) {
          onUnauthorized()
          reject(ApiError(data.error || '请先登录', 401))
          return
        }
        if (status >= 400) {
          reject(ApiError(data.error || '请求失败（' + status + '）', status))
          return
        }
        resolve(data)
      },
      fail(err) {
        reject(ApiError(err.errMsg || '云调用失败', 0))
      },
    })
  })
}

/* --------------------------------- 对外 --------------------------------- */

/**
 * 发一个请求
 * @param {{method?: string, path: string, body?: any}} options
 * @returns {Promise<any>}
 */
function request(options) {
  if (config.TRANSPORT === 'cloud') return viaCloud(options)
  return viaRequest(options)
}

module.exports = { request, ApiError }
