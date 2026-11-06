/**
 * 账号与会话（PostgreSQL 版）
 *
 * 与 server/auth.mjs（SQLite 版）**同名同签名**的同一套契约，
 * 由 server/store.mjs 按 PULSE_STORE 分发。
 *
 * 差别只在「怎么执行」：SQLite 版拼 SQL，PG 版调 **PG 函数（RPC）**
 * （定义见 server/pg-functions.sql）。
 *
 * 密码哈希仍然在 JS 侧算（Node 内置 crypto.scrypt，仓库零第三方依赖原则）——
 * PG 只存不验。
 */

import { randomBytes } from 'node:crypto'

import { authRpc } from './pg-client.mjs'
import { hashPassword, isValidLoginName, looksLikePhone, verifyPassword } from './auth-core.mjs'

export {
  RESERVED_LOGIN_NAMES,
  SESSION_TTL_MS,
  SINGLE_USER,
  hashPassword,
  isValidLoginName,
  looksLikePhone,
  verifyPassword,
} from './auth-core.mjs'

function nowMs() {
  return Date.now()
}

/** PG 返回的是原样行（snake_case 列名）→ 对外的驼峰形状 */
function rowToUser(row) {
  if (!row) return null
  return {
    id: row.id,
    loginName: row.login_name ?? row.loginName,
    displayName: row.display_name ?? row.displayName,
    phone: row.phone ?? null,
    role: row.role,
  }
}

/* ------------------------------ 账号 ------------------------------ */

/**
 * 注册一个新账号，同时挂上 password 身份。
 * 登录名已存在 → 返回 {error:'login_name_taken'}
 */
export async function createUser(db, { loginName, displayName, password, phone }) {
  const name = String(loginName ?? '').trim()
  if (!isValidLoginName(name)) return { error: 'invalid_login_name' }
  if (!password || String(password).length < 6) return { error: 'weak_password' }

  const now = nowMs()
  const id = `u${now.toString(36)}${randomBytes(4).toString('hex')}`
  const { salt, hash } = hashPassword(password)
  const display = String(displayName ?? '').trim() || name
  const phoneVal = looksLikePhone(name) ? name : (phone ? String(phone).trim() : null)

  const res = await authRpc('pulse_auth_register', {
    id,
    identityId: `i${now.toString(36)}${randomBytes(4).toString('hex')}`,
    loginName: name,
    displayName: display,
    phone: phoneVal,
    passwordHash: hash,
    passwordSalt: salt,
    now,
  })
  if (res?.error) return { error: res.error }
  return { user: await getUserById(db, id) }
}

/** 按 id 取用户 */
export async function getUserById(db, id) {
  const res = await authRpc('pulse_auth_user_by_id', { id })
  return rowToUser(res?.user)
}

/**
 * 用登录名＋密码登录。
 * 失败一律返回 {error:'bad_credentials'} —— 不区分「用户不存在」与「密码错」，
 * 免得被拿来枚举账号。
 */
export async function authenticate(db, loginName, password) {
  const name = String(loginName ?? '').trim()
  const res = await authRpc('pulse_auth_user_by_login', { loginName: name })
  const row = res?.user
  if (!row) {
    // 走一次同样的哈希计算，让「用户不存在」和「密码错」耗时接近
    hashPassword(String(password ?? ''))
    return { error: 'bad_credentials' }
  }
  if (!verifyPassword(password, row.password_salt, row.password_hash)) {
    return { error: 'bad_credentials' }
  }
  return { user: rowToUser(row) }
}

/** 改密码：旧密码要对；改完把该用户所有会话清掉（别人手上的旧令牌立刻失效） */
export async function changePassword(db, userId, oldPassword, newPassword) {
  if (!newPassword || String(newPassword).length < 6) return { error: 'weak_password' }
  const res = await authRpc('pulse_auth_user_by_id', { id: userId })
  const row = res?.user
  if (!row) return { error: 'no_user' }
  if (!verifyPassword(oldPassword, row.password_salt, row.password_hash)) {
    return { error: 'bad_credentials' }
  }
  const { salt, hash } = hashPassword(newPassword)
  const done = await authRpc('pulse_auth_update_password', {
    userId,
    passwordHash: hash,
    passwordSalt: salt,
    now: nowMs(),
  })
  if (!done?.ok) return { error: 'no_user' }
  return { ok: true }
}

/** 管理员重置密码（不校验旧密码） */
export async function resetPassword(db, userId, newPassword) {
  if (!newPassword || String(newPassword).length < 6) return { error: 'weak_password' }
  const res = await authRpc('pulse_auth_user_by_id', { id: userId })
  if (!res?.user) return { error: 'no_user' }
  const { salt, hash } = hashPassword(newPassword)
  const done = await authRpc('pulse_auth_update_password', {
    userId,
    passwordHash: hash,
    passwordSalt: salt,
    now: nowMs(),
  })
  if (!done?.ok) return { error: 'no_user' }
  return { ok: true }
}

/* ------------------------------ 会话 ------------------------------ */

/** 建一个会话，返回令牌 */
export async function createSession(db, userId, userAgent = '') {
  const now = nowMs()
  const token = randomBytes(32).toString('base64url')
  const res = await authRpc('pulse_auth_create_session', {
    token,
    userId,
    createdAt: now,
    expiresAt: now + 30 * 24 * 60 * 60 * 1000,
    userAgent: String(userAgent).slice(0, 200),
  })
  if (!res?.ok) throw new Error('创建会话失败')
  return token
}

/** 用令牌取用户；过期或不存在 → null */
export async function getSessionUser(db, token) {
  if (!token) return null
  const res = await authRpc('pulse_auth_session_user', { token })
  const row = res?.user
  if (!row) return null
  if (Number(row.expires_at) <= nowMs()) {
    await authRpc('pulse_auth_delete_session', { token })
    return null
  }
  // 滑动续期（每 5 分钟才写一次，避免每次请求都落库）
  await authRpc('pulse_auth_touch_session', { token, now: nowMs() })
  return rowToUser(row)
}

/** 退出登录：删掉这一个会话 */
export async function destroySession(db, token) {
  if (!token) return false
  const res = await authRpc('pulse_auth_delete_session', { token })
  return res?.ok === true
}

/** 清掉某人的全部会话 */
export async function destroyUserSessions(db, userId) {
  const res = await authRpc('pulse_auth_delete_user_sessions', { userId })
  return Number(res?.n ?? 0)
}

/** 清掉过期会话（启动时跑一次，顺手清理） */
export async function purgeExpiredSessions(db) {
  const res = await authRpc('pulse_auth_purge_expired', { now: nowMs() })
  return Number(res?.n ?? 0)
}

/* --------------------------- 微信身份 --------------------------- */

/** 按 openid 找已绑定的账号 */
export async function findUserByWechat(db, openid) {
  const res = await authRpc('pulse_auth_user_by_wechat', { openid: String(openid) })
  return rowToUser(res?.user)
}

/**
 * 把微信身份绑到某个账号上。
 * 该 openid 已绑到别人 → 不覆盖（返回 error:'already_bound'）。
 */
export async function bindWechatIdentity(db, userId, openid, unionId = null) {
  const now = nowMs()
  return await authRpc('pulse_auth_bind_wechat', {
    userId,
    openid: String(openid),
    unionId: unionId ?? null,
    identityId: `i${now.toString(36)}${randomBytes(4).toString('hex')}`,
    now,
  })
}

/** 解绑微信身份 */
export async function unbindWechatIdentity(db, userId) {
  const res = await authRpc('pulse_auth_unbind_wechat', { userId })
  return res?.ok === true
}

/** 该账号是否已绑微信 */
export async function hasWechatIdentity(db, userId) {
  const res = await authRpc('pulse_auth_has_wechat', { userId })
  return res?.ok === true
}
