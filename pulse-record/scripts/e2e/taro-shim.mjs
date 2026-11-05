/**
 * Taro 垫片 —— 在 Node 里跑**真实的小程序代码**，连**真实的后端**
 *
 * ## 为什么要有这个
 *
 * 小程序页面只能在微信开发者工具／真机里点，但页面底下那一层
 * （`utils/config.ts` / `utils/api.ts` / `utils/data.ts` / `utils/auth.ts`）
 * 是纯 TS，只依赖 `Taro.request` 与 `Taro.*Storage*`。
 * 垫一个 `Taro` 上去，就能在没有开发者工具的机器上、在 CI 里，把
 * 「登录 → 建患者 → 读回 → 搜索 → 改就诊 → 用药 → 自定义符号 → 令牌失效」
 * 这条链路真跑一遍。
 *
 * 它验证的是**页面真正会走的那条路**：
 *   - 请求确实从 `config.resolveApiBase()` 取地址（「我的」页改地址能生效）
 *   - 令牌放在 Authorization 头里，401 会清凭证并 reLaunch 到登录页
 *   - `data.ts` 每个方法的返回形状与页面用法一致
 *
 * ## 与原生版的差别
 *
 * 原生版垫的是 `wx`（`mp-api.mjs`），这版垫的是 `Taro`。
 * 业务代码里不许出现 `wx.`（见 `docs/taro-migration.md`）——
 * 所以垫片不叫 `wx`，这正是要查的：**只要业务代码里写 `wx.`，esbuild 的
 * alias 就拦不住它，垫片也接不到** —— 那正是 `taro-lint.mjs` 要抓的。
 */

const store = new Map()
export const relaunched = []
export const calls = []

globalThis.getCurrentPages = () => []

const Taro = {
  request({ url, method = 'GET', data, header = {} }) {
    calls.push({ url, method, header })
    const init = { method, headers: header }
    if (data !== undefined && method !== 'GET') init.body = JSON.stringify(data)
    return fetch(url, init).then(async (res) => {
      const text = await res.text()
      let body = {}
      try {
        body = text ? JSON.parse(text) : {}
      } catch {
        body = text
      }
      return { statusCode: res.status, data: body }
    })
  },

  getStorageSync(key) {
    return store.has(key) ? store.get(key) : ''
  },
  setStorageSync(key, value) {
    store.set(key, value)
  },
  removeStorageSync(key) {
    store.delete(key)
  },

  getCurrentPages() {
    return []
  },
  reLaunch({ url }) {
    relaunched.push(url)
    return Promise.resolve()
  },
  showToast() {
    return Promise.resolve()
  },
  showModal() {
    return Promise.resolve({ confirm: true, cancel: false })
  },
  login() {
    return Promise.resolve({ code: 'shim-code' })
  },
  getSetting() {
    return Promise.resolve({ authSetting: {} })
  },
  openSetting() {
    return Promise.resolve({})
  },
  saveImageToPhotosAlbum() {
    return Promise.resolve({})
  },
  previewImage() {
    return Promise.resolve()
  },
  setClipboardData() {
    return Promise.resolve()
  },
  canvasToTempFilePath() {
    return Promise.resolve({ tempFilePath: '/tmp/shim.png' })
  },
  createSelectorQuery() {
    return {
      select() {
        return this
      },
      fields() {
        return this
      },
      exec(cb) {
        cb([{ node: null }])
      },
    }
  },
}

/** 供测试断言用的内部状态 */
export const __store = store
export const __calls = calls

export default Taro
