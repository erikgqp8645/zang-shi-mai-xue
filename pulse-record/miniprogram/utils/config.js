/**
 * 小程序端配置
 *
 * 改这里就行，不用改别的文件。
 */

/**
 * API 根地址（**不带路径**，只到端口或域名）
 *
 * - 本机联调：微信开发者工具里勾上「不校验合法域名」，填 `http://127.0.0.1:5178`
 * - 真机联调：填电脑的局域网 IP，例如 `http://192.168.1.20:5178`（手机与电脑同一网段）
 * - 上线：填已备案域名的 https 地址，例如 `https://mai.example.com`
 *   —— 微信的 request 合法域名**不接受端口、不接受 IP、必须是 HTTPS 且已 ICP 备案**
 *
 * 迁到 CloudBase 后（见 `docs/cloudbase-migration.md`）：
 * 把 TRANSPORT 改成 'cloud'，API_BASE 就不用了 —— `wx.cloud.callFunction` 不走合法域名校验。
 */
const API_BASE = 'http://127.0.0.1:5178'

/**
 * 传输方式
 *
 * - 'request'：走 `wx.request`（默认）。受「request 合法域名」约束，需要 HTTPS ＋ 备案。
 * - 'cloud'  ：走 `wx.cloud.callFunction`，**不走合法域名校验**。
 *               迁到 CloudBase 后用这个，备案没下来也能先跑通。
 *
 * 两种方式的调用签名完全一样，页面代码不用改。
 */
const TRANSPORT = 'request'

/** TRANSPORT='cloud' 时的云函数名（CloudBase 上要部署一个同名云函数） */
const CLOUD_FUNCTION_NAME = 'pulse-api'

module.exports = {
  API_BASE,
  TRANSPORT,
  CLOUD_FUNCTION_NAME,
}
