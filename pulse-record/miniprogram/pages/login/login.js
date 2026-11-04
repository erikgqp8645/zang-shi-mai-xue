/**
 * 登录页 —— 微信登录 / 账号密码绑定 / 账号密码登录 / 注册
 *
 * 账号模型（与服务端一致）：一个 users 账号挂多种登录身份。
 * 小程序用「网站账号＋密码」把微信身份绑到同一个账号上 —— 绑定后两端看到同一份数据。
 *
 * 流程：
 *   wx.login → code → 服务端换 openid
 *     ├ 已绑定 → 签发令牌 → 直接进
 *     └ 未绑定 → need_bind → 本页引导输入「网站账号＋密码」绑定
 *                  （也可以直接在这里注册一个新账号）
 *
 * 服务端没配微信（WX_APPID/WX_APPSECRET 未设）时，会明确提示原因，
 * 这时可以直接用「账号密码登录」进。
 */

const auth = require('../../utils/auth.js')
const data = require('../../utils/data.js')

Page({
  data: {
    /** 'wechat' 首次进 | 'bind' 要绑账号 | 'account' 账号密码登录 | 'register' 注册 */
    step: 'wechat',
    loginName: '',
    password: '',
    displayName: '',
    busy: false,
    error: '',
    notice: '',
    /** 服务端是单机模式时为 true —— 不用登录 */
    singleMode: false,
  },

  onLoad() {
    const app = getApp()
    if (app && app.globalData.mode === 'single') {
      this.setData({ singleMode: true })
      wx.switchTab({ url: '/pages/cases/cases' })
      return
    }
    this.tryWechat()
  },

  /** 试一次微信登录：已绑定就直接进，没绑定就转去绑定 */
  async tryWechat() {
    this.setData({ busy: true, error: '', notice: '' })
    try {
      const res = await auth.wechatLogin()
      if (res && res.status === 'bound') {
        const app = getApp()
        if (app) app.setUser(res.user)
        wx.switchTab({ url: '/pages/cases/cases' })
        return
      }
      this.setData({
        step: 'bind',
        notice: '这个微信还没绑定账号。输入网站上的账号和密码，绑定后两端看到同一份病例。',
      })
    } catch (e) {
      this.setData({
        step: 'account',
        notice: '',
        error: (e && e.message) || '微信登录失败',
      })
    } finally {
      this.setData({ busy: false })
    }
  },

  onInputLoginName(e) {
    this.setData({ loginName: e.detail.value })
  },
  onInputPassword(e) {
    this.setData({ password: e.detail.value })
  },
  onInputDisplayName(e) {
    this.setData({ displayName: e.detail.value })
  },

  /** 账号密码登录（不绑定微信） */
  async onLogin() {
    if (this.data.busy) return
    this.setData({ busy: true, error: '' })
    try {
      const res = await auth.login(this.data.loginName.trim(), this.data.password)
      const app = getApp()
      if (app) app.setUser(res.user)
      wx.switchTab({ url: '/pages/cases/cases' })
    } catch (e) {
      this.setData({ error: (e && e.message) || '登录失败' })
    } finally {
      this.setData({ busy: false })
    }
  },

  /** 用网站账号＋密码把当前微信绑上 */
  async onBind() {
    if (this.data.busy) return
    this.setData({ busy: true, error: '' })
    try {
      const res = await auth.wechatBind(this.data.loginName.trim(), this.data.password)
      const app = getApp()
      if (app) app.setUser(res.user)
      wx.switchTab({ url: '/pages/cases/cases' })
    } catch (e) {
      this.setData({ error: (e && e.message) || '绑定失败' })
    } finally {
      this.setData({ busy: false })
    }
  },

  /** 注册新账号（同时把当前微信绑上） */
  async onRegister() {
    if (this.data.busy) return
    this.setData({ busy: true, error: '' })
    const name = this.data.displayName.trim() || this.data.loginName.trim()
    try {
      // 先注册（注册即登录），再把微信身份绑到这个账号上
      await auth.register(this.data.loginName.trim(), name, this.data.password)
      await auth.wechatBind(this.data.loginName.trim(), this.data.password)
      const app = getApp()
      const me = await auth.me()
      if (app) app.setUser(me.user)
      wx.switchTab({ url: '/pages/cases/cases' })
    } catch (e) {
      this.setData({ error: (e && e.message) || '注册失败' })
    } finally {
      this.setData({ busy: false })
    }
  },

  goAccount() {
    this.setData({ step: 'account', error: '', notice: '' })
  },
  goBind() {
    this.setData({ step: 'bind', error: '', notice: '' })
  },
  goRegister() {
    this.setData({ step: 'register', error: '', notice: '' })
  },
  retryWechat() {
    this.tryWechat()
  },
})
