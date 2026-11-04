/**
 * 我的 —— 账号信息、微信绑定、改密码、退出登录
 *
 * 账号模型（与服务端一致）：一个 users 账号挂多种登录身份。
 * 微信绑定状态由服务端给（/api/auth/me 的 wechatBound），不本地猜。
 */

const auth = require('../../utils/auth.js')
const data = require('../../utils/data.js')
const storage = require('../../utils/storage.js')

Page({
  data: {
    user: null,
    loginName: '',
    displayName: '',
    role: '',
    wechatBound: false,
    mode: 'multi',
    dbPath: '',
    oldPassword: '',
    newPassword: '',
    busy: false,
    error: '',
    notice: '',
  },

  onShow() {
    const app = getApp()
    if (app) {
      this.setData({
        mode: app.globalData.mode,
        dbPath: (app.globalData.health && app.globalData.health.db) || '',
      })
    }
    const cached = storage.getUser()
    if (cached) {
      this.setData({
        user: cached,
        loginName: cached.loginName || '',
        displayName: cached.displayName || '',
        role: cached.role || '',
      })
    }
    this.refresh()
  },

  async refresh() {
    try {
      const res = await auth.me()
      const u = (res && res.user) || null
      this.setData({
        user: u,
        loginName: (u && u.loginName) || '',
        displayName: (u && u.displayName) || '',
        role: (u && u.role) || '',
        wechatBound: !!(res && res.wechatBound),
        error: '',
      })
      const app = getApp()
      if (app) app.setUser(u)
    } catch (e) {
      // 未登录／令牌失效时 api 层会跳登录页，这里只记录原因
      this.setData({ error: (e && e.message) || '读取账号信息失败' })
    }
  },

  onInputOldPassword(e) {
    this.setData({ oldPassword: e.detail.value })
  },
  onInputNewPassword(e) {
    this.setData({ newPassword: e.detail.value })
  },

  async changePassword() {
    if (this.data.busy) return
    if (!this.data.oldPassword || !this.data.newPassword) {
      this.setData({ error: '原密码与新密码都要填' })
      return
    }
    this.setData({ busy: true, error: '', notice: '' })
    try {
      await auth.changePassword(this.data.oldPassword, this.data.newPassword)
      this.setData({
        notice: '密码已改。改密码后全部会话失效，需要重新登录。',
        oldPassword: '',
        newPassword: '',
      })
      await auth.logout()
      wx.reLaunch({ url: '/pages/login/login' })
    } catch (e) {
      this.setData({ error: (e && e.message) || '改密码失败' })
    } finally {
      this.setData({ busy: false })
    }
  },

  async unbindWechat() {
    const ok = await new Promise((resolve) =>
      wx.showModal({
        title: '解绑微信？',
        content: '解绑后这个微信再打开小程序要重新输入网站账号和密码。',
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      }),
    )
    if (!ok) return
    try {
      await auth.unbindWechat()
      this.setData({ wechatBound: false, notice: '已解绑微信。' })
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '解绑失败', icon: 'none' })
    }
  },

  async logout() {
    const ok = await new Promise((resolve) =>
      wx.showModal({
        title: '退出登录？',
        content: '数据仍存在服务器上，重新登录即可看到。',
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      }),
    )
    if (!ok) return
    await auth.logout()
    const app = getApp()
    if (app) app.setUser(null)
    wx.reLaunch({ url: '/pages/login/login' })
  },
})
