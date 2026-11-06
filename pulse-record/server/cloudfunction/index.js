/**
 * CloudBase HTTP 云函数入口（`pulse-api`）
 *
 * ## 干什么
 *
 * 把 CloudBase HTTP 云函数的 **event** 转成「像 node 的 req/res 的东西」，
 * 然后交给**和自建服务完全同一个** `handleApi`（server/index.mjs）。
 *
 * 路由、鉴权、存储 —— 一行都不用改：
 *   自建服务：createServer((req, res) => handleApi(req, res))
 *   云函数  ：event → 伪 req/res → handleApi(req, res)
 *
 * ## 返回形状
 *
 * 小程序端 `taro/src/platform/cloud.ts` 约定：
 *     exports.main = async (event) => ({ statusCode, body })
 * 网站端走 HTTP，用标准的 `{ statusCode, headers, body }`。
 *
 * ## 事件形状（CloudBase HTTP 云函数）
 *
 *     {
 *       path: '/api/patients',
 *       httpMethod: 'GET',
 *       headers: { authorization: 'Bearer xxx', ... },
 *       queryStringParameters: { q: '...' },
 *       body: '...' | base64,
 *       isBase64Encoded: false
 *     }
 *
 * 不同版本的字段名略有出入（`httpMethod` vs `requestContext.http.method`），
 * 下面两种都认。
 */

/**
 * server/*.mjs 是 ESM，而云函数入口是 CommonJS（CloudBase 函数框架用 require 加载）。
 * `require(esm)` 要 Node 20.19+ 才稳，所以这里用**动态 import** —— Node 18+ 都支持。
 */
let api = null
function getApi() {
  if (!api) api = import('./server/index.mjs')
  return api
}

/** 冷启动时初始化一次（开库 + 清过期会话）；后续调用复用 */
let dbReady = null
async function ensureDb() {
  if (!dbReady) {
    const { initDb } = await getApi()
    dbReady = initDb().catch((e) => {
      // 初始化失败要能重试 —— 不能把失败结果永久缓存住
      dbReady = null
      throw e
    })
  }
  return dbReady
}

/**
 * 网关路径前缀 —— 环境变量 `PULSE_API_PREFIX`。
 *
 * Event 函数经网关访问时，开着「路径透传」后收到的是**完整路径**
 * （例如 `/pulse-api/api/patients`）。而路由表里写的是 `/api/patients`，
 * 所以这里把前缀剥掉，两端（小程序直调 / 网站走网关）拿到的都是同一套路径。
 */
const API_PREFIX = (process.env.PULSE_API_PREFIX || '').replace(/\/+$/, '')

/** 从 event 里取出方法 / 路径 / 查询串 */
function parseEvent(event) {
  const http = event?.requestContext?.http ?? {}
  // 两套事件形状都要认：
  //   ① HTTP 触发（网站端走网关 URL）—— method/httpMethod + requestContext.http
  //   ② 云调用（小程序 wx.cloud.callFunction）—— event.method
  const method =
    event?.method || event?.httpMethod || http?.method || event?.requestContext?.httpMethod || 'GET'
  const path = event?.path || http?.path || '/'
  const query = event?.queryStringParameters ?? event?.query ?? {}
  const qs = Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : ''

  let url = path + qs
  if (API_PREFIX && url.startsWith(API_PREFIX)) {
    url = url.slice(API_PREFIX.length) || '/'
  }
  return { method: String(method).toUpperCase(), url }
}

/** body：可能是字符串，也可能是 base64，也可能是对象 */
function parseBody(event) {
  const raw = event?.body
  if (raw == null || raw === '') return ''
  if (typeof raw === 'object') return JSON.stringify(raw)
  if (event?.isBase64Encoded) {
    try {
      return Buffer.from(raw, 'base64').toString('utf8')
    } catch {
      return ''
    }
  }
  return String(raw)
}

/** 伪 req：够 server/index.mjs 用（method / url / headers / 异步迭代 body） */
function makeReq(event) {
  const { method, url } = parseEvent(event)
  const raw = parseBody(event)
  const headers = { ...(event?.headers ?? {}) }

  // 小程序云调用没有 headers，令牌是单独一个字段 —— 补成 Authorization 头，
  // 这样云函数与网站端**走的是同一套鉴权逻辑**（server/index.mjs 的 bearerToken）。
  const token = event?.token
  if (token && !headers.authorization && !headers.Authorization) {
    headers.authorization = `Bearer ${token}`
  }
  if (headers.Authorization && !headers.authorization) headers.authorization = headers.Authorization

  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      if (raw) yield Buffer.from(raw, 'utf8')
    },
  }
}
/** 伪 res：收集状态码 / 响应头 / 响应体 */
function makeRes() {
  const headers = {}
  return {
    statusCode: 200,
    headers,
    writeHead(status, h) {
      this.statusCode = status
      if (h) Object.assign(headers, h)
      return this
    },
    setHeader(key, value) {
      headers[key] = value
      return this
    },
    getHeader(key) {
      return headers[key]
    },
    end(text) {
      this.body = text
      return this
    },
  }
}

exports.main = async (event) => {
  const { handleApi } = await getApi()
  await ensureDb()
  const req = makeReq(event ?? {})
  const res = makeRes()
  await handleApi(req, res)
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: res.body ?? '',
  }
}
