/**
 * 小程序入口
 *
 * 全局只放三样东西：当前登录者、服务端模式（单机/多用户）、以及「是否已登录」。
 * 业务逻辑一律在页面里，全局不藏逻辑。
 */

const storage = require('./utils/storage.js')
const data = require('./utils/data.js')

App({
  globalData: {
    /** 当前登录者 { id, loginName, displayName, role }；未登录为 null */
    user: null,
    /** 服务端模式：'single'（单机，不用登录）| 'multi'（多用户，需登录） */
    mode: 'multi',
    /** 服务端探活结果；null＝还没探到 */
    health: null,
  },

  onLaunch() {
    // 本地有凭证就先记上（真正是否有效由页面调 /api/auth/me 确认）
    const user = storage.getUser()
    if (user) this.globalData.user = user

    // 探一次服务端，顺带确认当前是单机还是多用户模式
    data
      .health()
      .then((h) => {
        this.globalData.health = h
        this.globalData.mode = (h && h.mode) || 'multi'
      })
      .catch(() => {
        this.globalData.health = null
      })
  },

  /** 页面统一从这里取当前用户 */
  currentUser() {
    return this.globalData.user
  },

  /** 登录/登出后同步 */
  setUser(user) {
    this.globalData.user = user || null
  },
})
