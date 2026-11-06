/**
 * 账号体系的**纯逻辑**部分（不碰存储）
 *
 * ## 为什么拆出来
 *
 * 账号与鉴权有两套存储实现（SQLite / PostgreSQL）。密码哈希、登录名规则这些
 * **与后端无关**的规则只有一份 —— 拆出来，两套实现共用，免得改一处漏一处
 * （比如注册规则改了、PG 那边还按老规则放行）。
 *
 * 存储相关的部分在：
 *   · server/auth.mjs     —— SQLite 实现
 *   · server/auth-pg.mjs  —— PostgreSQL 实现
 *
 * 两者导出的**函数名与签名完全一致**，由 server/store.mjs 按 PULSE_STORE 分发。
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
