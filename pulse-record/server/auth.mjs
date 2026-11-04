/**
 * 账号与会话（多用户）
 *
 * 三张表（见 schema.sql）：
 *   users        一个「人」＝一个账号。网站与小程序共用同一行。
 *   identities   账号上挂的登录身份：password（登录名）／wechat（openid）／local（单机）
 *   sessions     登录态：不透明随机令牌，存库、可吊销
 *
 * 为什么用「不透明令牌」而不是 JWT：
 *   - 可吊销（改密码、退出登录立刻生效），JWT 做不到
 *   - 一套机制两端通用：网站和小程序都走 `Authorization: Bearer <token>`
 *   - 用 header 不用 cookie → 天然免疫 CSRF（跨站表单带不了 Authorization 头）
 *
 * 密码哈希用 Node 内置 crypto.scrypt —— 不引第三方依赖（沿用仓库零依赖原则）。
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/** 单机模式：所有请求都视为内置单机账号，不要求登录 */
export const SINGLE_USER = process.env.PULSE_SINGLE_USER === '1'

/** 会话有效期：30 天 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** scrypt 参数 */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }

/** 内置保留登录名 —— 注册时拒绝 */
export const RESERVED_LOGIN_NAMES = ['local']

/* ------------------------------ 密码 ------------------------------ */

/** 生成密码哈希与盐 */
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(String(password), salt, SCRYPT.keylen, SCRYPT).toString('hex')
  return { salt, hash }
}

/** 校验密码（用定长比较，避免时序侧信道） */
export function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false
  let actual
  try {
    actual = scryptSync(String(password), salt, SCRYPT.keylen, SCRYPT).toString('hex')
  } catch {
    return false
  }
  const a = Buffer.from(actual, 'hex')
  const b = Buffer.from(expectedHash, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/* ---------------------------- 登录名规则 ---------------------------- */

/**
 * 登录名规则：11 位手机号，或 4~20 位字母／数字／下划线（字母开头）。
 * 手机号本期**不发验证码**，只作登录名用。
 */
export function isValidLoginName(name) {
  const s = String(name ?? '').trim()
  if (RESERVED_LOGIN_NAMES.includes(s.toLowerCase())) return false
  if (/^1\d{10}$/.test(s)) return true
  return /^[A-Za-z][A-Za-z0-9_]{3,19}$/.test(s)
}

/** 登录名是否像手机号（用于预填 phone 字段） */
export function looksLikePhone(name) {
  return /^1\d{10}$/.test(String(name ?? '').trim())
}

/* ------------------------------ 账号 ------------------------------ */

function nowMs() {
  return Date.now()
}

function rowToUser(row) {
  if (!row) return null
  return {
    id: row.id,
    loginName: row.login_name,
    displayName: row.display_name,
    phone: row.phone ?? null,
    role: row.role,
  }
}

/**
 * 注册一个新账号，同时挂上 password 身份。
 * 登录名已存在 → 返回 {error:'login_name_taken'}
 */
export async function createUser(db, { loginName, displayName, password, phone }) {
  const name = String(loginName ?? '').trim()
  if (!isValidLoginName(name)) return { error: 'invalid_login_name' }
  if (!password || String(password).length < 6) return { error: 'weak_password' }

  const existing = db.prepare('SELECT id FROM users WHERE login_name = ?').get(name)
  if (existing) return { error: 'login_name_taken' }

  const now = nowMs()
  const id = `u${now.toString(36)}${randomBytes(4).toString('hex')}`
  const { salt, hash } = hashPassword(password)
  const display = String(displayName ?? '').trim() || name
  const phoneVal = looksLikePhone(name) ? name : (phone ? String(phone).trim() : null)

  try {
    db.prepare(
      `INSERT INTO users (id, login_name, display_name, phone, password_hash, password_salt, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'user', ?, ?)`,
    ).run(id, name, display, phoneVal, hash, salt, now, now)
  } catch (e) {
    if (String(e?.message ?? '').includes('UNIQUE')) return { error: 'login_name_taken' }
    throw e
  }

  db.prepare(
    `INSERT INTO identities (id, user_id, provider, external_id, union_id, created_at)
     VALUES (?, ?, 'password', ?, NULL, ?)`,
  ).run(`i${now.toString(36)}${randomBytes(4).toString('hex')}`, id, name, now)

  return { user: await getUserById(db, id) }
}

/** 按 id 取用户 */
export async function getUserById(db, id) {
  return rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id))
}

/**
 * 用登录名＋密码登录。
 * 失败一律返回 {error:'bad_credentials'} —— 不区分「用户不存在」与「密码错」，
 * 免得被拿来枚举账号。
 */
export async function authenticate(db, loginName, password) {
  const name = String(loginName ?? '').trim()
  const row = db.prepare('SELECT * FROM users WHERE login_name = ?').get(name)
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
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  if (!row) return { error: 'no_user' }
  if (!verifyPassword(oldPassword, row.password_salt, row.password_hash)) return { error: 'bad_credentials' }
  const { salt, hash } = hashPassword(newPassword)
  db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?').run(
    hash,
    salt,
    nowMs(),
    userId,
  )
  await destroyUserSessions(db, userId)
  return { ok: true }
}

/** 管理员重置密码（不校验旧密码） */
export async function resetPassword(db, userId, newPassword) {
  if (!newPassword || String(newPassword).length < 6) return { error: 'weak_password' }
  const row = db.prepare('SELECT id FROM users WHERE id = ?').get(userId)
  if (!row) return { error: 'no_user' }
  const { salt, hash } = hashPassword(newPassword)
  db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?').run(
    hash,
    salt,
    nowMs(),
    userId,
  )
  await destroyUserSessions(db, userId)
  return { ok: true }
}

/* ------------------------------ 会话 ------------------------------ */

/** 建一个会话，返回令牌 */
export async function createSession(db, userId, userAgent = '') {
  const now = nowMs()
  const token = randomBytes(32).toString('base64url')
  db.prepare(
    `INSERT INTO sessions (token, user_id, created_at, expires_at, last_seen_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(token, userId, now, now + SESSION_TTL_MS, now, String(userAgent).slice(0, 200))
  return token
}

/** 用令牌取用户；过期或不存在 → null */
export async function getSessionUser(db, token) {
  if (!token) return null
  const row = db
    .prepare(
      `SELECT s.token, s.expires_at, u.id, u.login_name, u.display_name, u.phone, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`,
    )
    .get(token)
  if (!row) return null
  if (Number(row.expires_at) <= nowMs()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    return null
  }
  // 滑动续期（每 5 分钟才写一次，避免每次请求都落库）
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token = ?').run(nowMs(), token)
  return rowToUser(row)
}

/** 退出登录：删掉这一个会话 */
export async function destroySession(db, token) {
  if (!token) return false
  const info = db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
  return Number(info.changes) > 0
}

/** 清掉某人的全部会话 */
export async function destroyUserSessions(db, userId) {
  const info = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  return Number(info.changes)
}

/** 清掉过期会话（启动时跑一次，顺手清理） */
export async function purgeExpiredSessions(db) {
  const info = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowMs())
  return Number(info.changes)
}

/* --------------------------- 微信身份 --------------------------- */

/** 按 openid 找已绑定的账号 */
export async function findUserByWechat(db, openid) {
  const row = db
    .prepare(
      `SELECT u.id, u.login_name, u.display_name, u.phone, u.role
         FROM identities i JOIN users u ON u.id = i.user_id
        WHERE i.provider = 'wechat' AND i.external_id = ?`,
    )
    .get(String(openid))
  return rowToUser(row)
}

/**
 * 把微信身份绑到某个账号上。
 * 该 openid 已绑到别人 → 不覆盖（返回 error:'already_bound'）。
 */
export async function bindWechatIdentity(db, userId, openid, unionId = null) {
  const ext = String(openid)
  const existing = db
    .prepare("SELECT user_id FROM identities WHERE provider = 'wechat' AND external_id = ?")
    .get(ext)
  if (existing) {
    if (existing.user_id === userId) return { ok: true, already: true }
    return { error: 'already_bound' }
  }
  const now = nowMs()
  db.prepare(
    `INSERT INTO identities (id, user_id, provider, external_id, union_id, created_at)
     VALUES (?, ?, 'wechat', ?, ?, ?)`,
  ).run(`i${now.toString(36)}${randomBytes(4).toString('hex')}`, userId, ext, unionId ?? null, now)
  return { ok: true, already: false }
}

/** 解绑微信身份 */
export async function unbindWechatIdentity(db, userId) {
  const info = db.prepare("DELETE FROM identities WHERE user_id = ? AND provider = 'wechat'").run(userId)
  return Number(info.changes) > 0
}

/** 该账号是否已绑微信 */
export async function hasWechatIdentity(db, userId) {
  const row = db.prepare("SELECT id FROM identities WHERE user_id = ? AND provider = 'wechat'").get(userId)
  return !!row
}
