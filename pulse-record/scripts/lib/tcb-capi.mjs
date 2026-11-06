/**
 * 腾讯云 `tcb` 服务的 CAPI 客户端（TC3-HMAC-SHA256 签名）
 *
 * ## 为什么要有它
 *
 * 本仓库要直接调 `tcb` 服务的管理面接口：
 *   · `ExecutePGSql`              —— 跑 PostgreSQL（`scripts/pg-admin.mjs`）
 *   · `GetFunction` / `UpdateFunctionConfiguration` —— 管云函数环境变量（`scripts/cf-admin.mjs`）
 *
 * 签名算法是腾讯云 API 3.0 规定的，**只有一份**，别处不要重写。
 *
 * ## 为什么不直接用 CloudBase MCP
 *
 *   · MCP 的 `queryPgDatabase` / `managePgDatabase` 在本机有模块级失败缓存（首次探测失败会被永久缓存）。
 *   · MCP 的 `manageFunctions` 只吃明文参数 —— 密钥一旦走工具调用就会**进对话上下文**。
 *     走脚本就绕开了：密钥从磁盘读进进程内存，**不经过模型**。
 *
 * ## 凭证
 *
 * 三套变量名都认（值一样，只是叫法不同）：
 *   · `TCLOUD_*`        —— 本地临时凭证（`scripts/migrate-sqlite-to-pg.mjs` 等用）
 *   · `PULSE_CB_*`      —— `server/pg-client.mjs` 那套（同一份凭证换个名）
 *   · `TENCENTCLOUD_*` —— 平台注入（云函数里）
 *
 * **凭证只从环境变量读**，绝不写进仓库。
 */

import { createHash, createHmac } from 'node:crypto'

export const HOST = 'tcb.tencentcloudapi.com'
export const SERVICE = 'tcb'
export const VERSION = '2018-06-08'

/* ------------------------------ 签名 ------------------------------ */

export function sha256Hex(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

function hmac(key, s) {
  return createHmac('sha256', key).update(s, 'utf8').digest()
}

/**
 * 腾讯云 API 3.0（TC3-HMAC-SHA256）签名
 *
 * @param {object} o
 * @param {string} o.secretId
 * @param {string} o.secretKey
 * @param {string} [o.token]      临时凭证的 Token
 * @param {string} o.payload      请求体 JSON 字符串（**参与签名哈希，不能与实际发送的不一致**）
 * @param {string} o.action       Action 名
 * @param {number} o.timestamp    Unix 秒
 */
export function sign({
  secretId,
  secretKey,
  token,
  payload,
  action,
  timestamp,
  host = HOST,
  service = SERVICE,
}) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)

  const canonicalHeaders =
    `content-type:application/json; charset=utf-8\n` +
    `host:${host}\n` +
    `x-tc-action:${action.toLowerCase()}\n`
  const signedHeaders = 'content-type;host;x-tc-action'
  const canonicalRequest =
    `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256Hex(payload)}`

  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign =
    `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`

  const secretDate = hmac(`TC3${secretKey}`, date)
  const secretService = hmac(secretDate, service)
  const secretSigning = hmac(secretService, 'tc3_request')
  const signature = createHmac('sha256', secretSigning).update(stringToSign, 'utf8').digest('hex')

  const authorization =
    `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  const headers = {
    Authorization: authorization,
    'Content-Type': 'application/json; charset=utf-8',
    Host: host,
    'X-TC-Action': action,
    'X-TC-Version': VERSION,
    'X-TC-Timestamp': String(timestamp),
  }
  if (token) headers['X-TC-Token'] = token
  return headers
}

/* ------------------------------ 凭证 ------------------------------ */

/** 读当前进程能拿到的腾讯云凭证 */
export function readCredentials() {
  const secretId =
    process.env.TCLOUD_SECRET_ID || process.env.PULSE_CB_SECRET_ID || process.env.TENCENTCLOUD_SECRETID
  const secretKey =
    process.env.TCLOUD_SECRET_KEY || process.env.PULSE_CB_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY
  const token =
    process.env.TCLOUD_SESSION_TOKEN ||
    process.env.PULSE_CB_SESSION_TOKEN ||
    process.env.TENCENTCLOUD_SESSIONTOKEN ||
    ''
  return { secretId, secretKey, token }
}

/* ------------------------------ 调用 ------------------------------ */

/**
 * 调一次 `tcb` 服务的 CAPI。
 *
 * @param {string} action  Action 名（如 `GetFunction`）
 * @param {object} payload 请求体
 * @param {object} [opts]
 * @param {string} [opts.version]  API 版本
 * @param {string} [opts.host]     服务域名
 * @param {string} [opts.service]  服务名（签名用）
 * @param {string} [opts.region]   地域 —— **公共头参数**，放 `X-TC-Region`，
 *                                  不进 body、也不进签名（部分接口必填，如 `GetProviders`）
 * @returns {Promise<object>} `Response` 部分
 * @throws  {Error} 带 `[错误码] 错误信息`
 */
export async function callTcb(
  action,
  payload,
  { version = VERSION, host = HOST, service = SERVICE, region = '' } = {},
) {
  const { secretId, secretKey, token } = readCredentials()
  if (!secretId || !secretKey) {
    throw new Error('缺少凭证环境变量：TCLOUD_SECRET_ID / PULSE_CB_SECRET_ID（或 TENCENTCLOUD_SECRETID）')
  }

  const body = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000)
  const headers = sign({ secretId, secretKey, token, payload: body, action, timestamp, host, service })
  headers['X-TC-Version'] = version
  if (region) headers['X-TC-Region'] = region

  const res = await fetch(`https://${host}/`, {
    method: 'POST',
    headers,
    body,
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`响应不是 JSON（HTTP ${res.status}）：${text.slice(0, 400)}`)
  }
  if (json.Response?.Error) {
    const e = json.Response.Error
    throw new Error(`[${e.Code}] ${e.Message}`)
  }
  return json.Response ?? {}
}
