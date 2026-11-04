/**
 * 本地存储 —— 小程序用 wx.setStorageSync，不用 localStorage
 *
 * 与网站端一一对应：
 *   localStorage['pulse.token'] → wx.getStorageSync('pulse.token')
 */

const TOKEN_KEY = 'pulse.token'
const USER_KEY = 'pulse.user'

function getToken() {
  try {
    return wx.getStorageSync(TOKEN_KEY) || ''
  } catch (e) {
    return ''
  }
}

function setToken(token) {
  try {
    wx.setStorageSync(TOKEN_KEY, token)
  } catch (e) {
    /* 存储失败不致命：本次会话仍可用 */
  }
}

function getUser() {
  try {
    return wx.getStorageSync(USER_KEY) || null
  } catch (e) {
    return null
  }
}

function setUser(user) {
  try {
    wx.setStorageSync(USER_KEY, user)
  } catch (e) {
    /* ignore */
  }
}

function clearAuth() {
  try {
    wx.removeStorageSync(TOKEN_KEY)
    wx.removeStorageSync(USER_KEY)
  } catch (e) {
    /* ignore */
  }
}

module.exports = {
  TOKEN_KEY,
  USER_KEY,
  getToken,
  setToken,
  getUser,
  setUser,
  clearAuth,
}
