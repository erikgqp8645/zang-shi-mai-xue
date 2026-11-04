/**
 * 我的 —— 账号信息、微信绑定、改密码、退出登录
 *
 * 账号模型（与服务端一致）：一个 users 账号挂多种登录身份。
 * 微信绑定状态由服务端给（/api/auth/me 的 wechatBound），不本地猜。
 */

const auth = require('../../utils/auth.js')
const config = require('../../utils/config.js')
const data = require('../../utils/data.js')
const storage = require('../../utils/storage.js')

/**
 * 探一次某个地址的 /api/health（不走 api.js —— 那是认令牌的，
 * 这里要测的是「这个地址通不通」，得能对还没保存的地址试）。
 */
function probe(base) {
  return new Promise((resolve) => {
    wx.request({
      url: base + '/api/health',
      method: 'GET',
      timeout: 8000,
      success(res) {
        const body = res.data || {}
        if (res.statusCode === 200 && body.ok) resolve({ ok: true, body })
        else resolve({ ok: false, error: '服务有响应但不像本项目的后端（HTTP ' + res.statusCode + '）' })
      },
      fail(err) {
        resolve({ ok: false, error: (err && err.errMsg) || '连不上' })
      },
    })
  })
}

Page({
  data: {
    user: null,
    loginName: '',
    displayName: '',
    role: '',
    wechatBound: false,
    mode: 'multi',
    dbPath: '',
    /** 当前实际连的服务器地址 */
    apiBase: '',
    /** 输入框里的地址（可能还没保存） */
    apiBaseInput: '',
    apiHint: '',
    apiTesting: false,
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
    this.refreshApiBase()
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

  /* ------------------------------ 服务器地址 ------------------------------ */

  /** 同步当前地址到界面（改完、恢复默认后都走这里） */
  refreshApiBase() {
    const base = config.resolveApiBase()
    this.setData({ apiBase: base, apiBaseInput: base })
  },

  onInputApiBase(e) {
    this.setData({ apiBaseInput: e.detail.value, apiHint: '' })
  },

  async saveApiBase() {
    const res = config.setApiBase(this.data.apiBaseInput)
    if (!res.ok) {
      this.setData({ apiHint: res.error || '保存失败', apiBase: res.base })
      return
    }
    this.setData({ apiBase: res.base, apiBaseInput: res.base, apiHint: '已保存，正在测试连接…' })
    const probeResult = await this.testBase(res.base)
    if (probeResult.ok) {
      const body = probeResult.body
      this.setData({
        apiHint:
          '连接正常（' +
          (body.mode === 'single' ? '单机模式，不用登录' : '多用户模式，需要登录') +
          '）。重新进一次页面即可按新地址取数据。',
        mode: body.mode || this.data.mode,
      })
      const app = getApp()
      if (app) {
        app.globalData.health = body
        app.globalData.mode = body.mode || app.globalData.mode
      }
    } else {
      this.setData({ apiHint: '已保存，但连不上：' + probeResult.error })
    }
  },

  async testApiBase() {
    if (this.data.apiTesting) return
    const base = config.normalizeBase(this.data.apiBaseInput)
    if (!base) {
      this.setData({ apiHint: '地址要以 http:// 或 https:// 开头' })
      return
    }
    this.setData({ apiTesting: true, apiHint: '' })
    const res = await this.testBase(base)
    if (res.ok) {
      const body = res.body
      this.setData({
        apiHint:
          '连接正常：' +
          (body.mode === 'single' ? '单机模式（不用登录）' : '多用户模式（需要登录）') +
          (body.db ? '｜库：' + body.db : ''),
      })
    } else {
      this.setData({ apiHint: '连不上：' + res.error })
    }
    this.setData({ apiTesting: false })
  },

  /** 探一个地址，顺带把「连不上时先查什么」写在提示里 */
  async testBase(base) {
    const res = await probe(base)
    if (res.ok) return res
    const hint = /url not in domain list/i.test(res.error)
      ? '（域名校验没关：开发工具 → 详情 → 本地设置 → 勾「不校验合法域名…」）'
      : /timeout|fail/i.test(res.error)
        ? '（手机与电脑要连同一个 Wi-Fi；电脑防火墙要放行 5178 端口）'
        : ''
    return { ok: false, error: res.error + hint }
  },

  resetApiBase() {
    const res = config.resetApiBase()
    this.setData({
      apiBase: res.base,
      apiBaseInput: res.base,
      apiHint: '已恢复默认地址。',
    })
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
