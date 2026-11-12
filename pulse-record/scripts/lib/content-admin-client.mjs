/**
 * 本地后台（Directus）的 HTTP 客户端。
 *
 * ⭐ **唯一一份** —— `content-admin-init.mjs`（写元数据）与
 *    `lib/content-admin-checks.mjs`（断言）都用它，
 *    不各写一份登录/请求逻辑（铁律：能合成一个来源的，绝不留在两处）。
 *
 * 凭证只从环境变量读，默认值是本地开发账号：
 *   PULSE_ADMIN_URL       默认 http://localhost:8055
 *   PULSE_ADMIN_EMAIL     默认 admin@example.com
 *   PULSE_ADMIN_PASSWORD  默认 PulseLocal2026
 */

export const ADMIN_URL = (process.env.PULSE_ADMIN_URL || 'http://localhost:8055').replace(/\/$/, '')
export const ADMIN_EMAIL = process.env.PULSE_ADMIN_EMAIL || 'admin@example.com'
export const ADMIN_PASSWORD = process.env.PULSE_ADMIN_PASSWORD || 'PulseLocal2026'

/**
 * 建一个后台客户端。
 *
 * ⚠️ **不是 async** —— 它不发网络请求（登录是单独一步），
 *    返回 Promise 会让人写成 `client.login()` 而实际拿到的是 Promise ⇒ 踩坑。
 *
 * 登录失败**不抛异常** —— 返回 `{ ok: false }`，
 * 让调用方决定是「跳过」还是「报错」（容器没起 ≠ 配置坏了）。
 */
export function createAdminClient(opts = {}) {
  const url = (opts.url || ADMIN_URL).replace(/\/$/, '')
  const email = opts.email || ADMIN_EMAIL
  const password = opts.password || ADMIN_PASSWORD

  let token = null

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      /* 非 JSON 响应，留在 json=null */
    }
    return { ok: res.ok, status: res.status, json, text }
  }

  async function login() {
    const r = await api('/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    if (!r.ok || !r.json?.data?.access_token) {
      return { ok: false, status: r.status, text: r.text }
    }
    token = r.json.data.access_token
    return { ok: true, status: r.status }
  }

  return { url, email, api, login }
}

/** 后台在不在（不发鉴权请求 —— `/server/ping` 是公开的） */
export async function pingAdmin(url = ADMIN_URL) {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/server/ping`)
    const text = await res.text()
    return { ok: res.ok, text }
  } catch (e) {
    return { ok: false, text: String(e?.message || e) }
  }
}
