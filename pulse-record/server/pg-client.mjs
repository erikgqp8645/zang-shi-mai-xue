/**
 * CloudBase PostgreSQL 访问客户端（**唯一**碰 PG 的地方）
 *
 * ## 走哪条路
 *
 * 用 `@cloudbase/node-sdk` 的 `app.rdb()` —— CloudBase PG 的官方通路
 * （走 PG HTTP 网关，不是 TCP 直连）。
 *
 * **为什么不用 TCP 直连（pg 驱动）**：本环境是 `SHARED` 托管实例，
 * 没有暴露连接地址；而且个人版/体验版的内网互联（VPC）与公网直连开关都不可用。
 * SDK 路线不需要 VPC、不需要数据库账号密码、不需要网络打通 —— 少三个坑。
 *
 * ## 凭证从哪来
 *
 * | 环境 | 来源 |
 * |---|---|
 * | 云函数 | 平台自动注入 `TENCENTCLOUD_SECRETID` / `TENCENTCLOUD_SECRETKEY` / `TENCENTCLOUD_SESSIONTOKEN`，env 从 `TCB_ENV` 或 `SCF_NAMESPACE` 取 —— **不用配** |
 * | 本地 | `PULSE_CB_SECRET_ID` / `PULSE_CB_SECRET_KEY` / `PULSE_CB_SESSION_TOKEN`（或直接用 `TENCENTCLOUD_*`） |
 *
 * 凭证**只从环境变量读**，绝不写进仓库。
 *
 * ## 数据访问怎么组织
 *
 * 所有读写都走 **PG 函数（RPC）**，函数定义见 server/pg-functions.sql：
 *   · 一次 RPC ＝ 一个事务 → 「整份覆盖」语义是原子的
 *   · JS 侧不写 SQL → 不会出现方言漂移
 *   · 语义与 server/db.mjs（SQLite 版）一一对应
 */

import nodeSdk from '@cloudbase/node-sdk'

/** SDK 的入口：CJS 互操作后可能是函数，也可能是 { default } 包装 */
const cloudbase = typeof nodeSdk === 'function' ? nodeSdk : (nodeSdk?.default ?? nodeSdk)

let rdb = null

/** 环境 id：云函数里从平台注入的变量取；本地用 PULSE_CB_ENV */
function resolveEnv() {
  return (
    process.env.PULSE_CB_ENV ||
    process.env.TCB_ENV ||
    process.env.SCF_NAMESPACE ||
    ''
  )
}

/**
 * 初始化（懒加载 —— 只在真正用到 PG 时才建连接）
 *
 * 凭证优先级：PULSE_CB_* 显式配置 → 平台注入的 TENCENTCLOUD_*（SDK 原生读取）。
 */
function getRdb() {
  if (rdb) return rdb

  const env = resolveEnv()
  if (!env) {
    throw new Error(
      'PG 后端缺少环境 id：请设 PULSE_CB_ENV（本地）或让平台注入 TCB_ENV / SCF_NAMESPACE（云函数）',
    )
  }

  const options = { env }
  const secretId = process.env.PULSE_CB_SECRET_ID || process.env.TENCENTCLOUD_SECRETID
  const secretKey = process.env.PULSE_CB_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY
  const sessionToken = process.env.PULSE_CB_SESSION_TOKEN || process.env.TENCENTCLOUD_SESSIONTOKEN
  if (secretId && secretKey) {
    options.secretId = secretId
    options.secretKey = secretKey
    if (sessionToken) options.sessionToken = sessionToken
  }

  rdb = cloudbase.init(options).rdb()
  return rdb
}

/**
 * 调一个 PG 函数（RPC）
 *
 * @param {string} fn   函数名（server/pg-functions.sql 里定义的那些）
 * @param {object} args 参数对象，形如 { p_owner, p_args }
 * @returns {Promise<any>} PG 返回的 jsonb
 */
export async function rpc(fn, args) {
  let result
  try {
    result = await getRdb().rpc(fn, args)
  } catch (e) {
    throw new Error(`调用 PG 函数 ${fn} 失败：${e?.message ?? e}`)
  }
  const { data, error } = result ?? {}
  if (error) {
    throw new Error(`调用 PG 函数 ${fn} 出错：${error?.message ?? JSON.stringify(error)}`)
  }
  return data
}

/**
 * 数据域调用：owner 必填（**只认它**，请求体里的 owner 一律忽略）
 * @param {string} fn
 * @param {string} ownerId
 * @param {object} args
 */
export function dataRpc(fn, ownerId, args = {}) {
  return rpc(fn, { p_owner: String(ownerId ?? ''), p_args: args })
}

/** 鉴权域调用（用不上 owner） */
export function authRpc(fn, args = {}) {
  return rpc(fn, { p_owner: '', p_args: args })
}

/** 存储位置的描述（只用于 /api/health 与页面提示，不参与业务逻辑） */
export const DB_DESCRIPTION = 'CloudBase PostgreSQL'
