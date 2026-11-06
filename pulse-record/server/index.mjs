/**
 * 本地／线上服务端 —— 病例记录 API ＋ 静态页面
 *
 * 用途：把「病例记录」落到磁盘上的 SQLite 文件（local-data/history.sqlite），
 *      不再依赖浏览器 localStorage，清缓存／换浏览器／换机都不会丢。
 *
 * ── 多用户 ──────────────────────────────────────────────────────────
 * 除「公开接口」外，所有 /api/* 都必须带 `Authorization: Bearer <token>`，
 * 未登录一律 401。数据按账号隔离：跨用户访问一律当作「不存在」（404）。
 *
 * 公开接口（不需登录）：
 *   GET  /api/health              健康检查（含当前模式）
 *   POST /api/auth/login          登录名＋密码登录
 *   POST /api/auth/register       注册（并自动登录）
 *   POST /api/auth/wechat/login   小程序 wx.login 的 code 换 openid
 *   POST /api/auth/wechat/bind    用网站账号＋密码把微信身份绑到账号上
 *
 * 单机模式（PULSE_SINGLE_USER=1）：所有请求都算内置单机账号，不要求登录，
 *   注册/登录接口返回 409。前端会显示「单机模式」标识，避免误判数据是否共享。
 *
 * 路由：
 *   GET    /api/health             → { ok: true, db, mode }
 *   GET    /api/patients           → { patients: [...] }        患者列表（含就诊次数）
 *   GET    /api/search?q=…         → { patients: [...] }        搜索：姓名／日期标签／脉象符号
 *   GET    /api/symbols             → { symbols: [...] }        自定义符号（使用者自建，如「涩」＝S）
 *   POST   /api/symbols             → { symbol }                新增／改名自定义符号
 *   DELETE /api/symbols/:code       → { ok: true }              删除自定义符号
 *   GET    /api/patients/:id       → { patient }                一位患者 ＋ 其全部就诊记录
 *   POST   /api/patients           → { patient }                整份保存（患者 ＋ 就诊记录 ＋ 用药记录）
 *   PATCH  /api/patients/:id       → { patient }                重命名／改体例（body: {name?} {layout?}）
 *   DELETE /api/patients/:id       → { ok: true }               删除患者（连带其就诊记录）
 *   GET    /api/visits/:id         → { visit }                  取一次就诊记录
 *   PATCH  /api/visits/:id         → { visit }                  改一次就诊记录（标签／脉象值／该次用药）
 *   DELETE /api/visits/:id         → { ok: true }               删除一次就诊记录
 *   GET    /api/patients/:id/medication → { medication: [...] }  该患者的全部用药记录
 *   POST   /api/patients/:id/medication → { medication: [...] }  整份覆盖该患者的用药记录
 *   GET    /api/visits/:id/medication   → { medication: [...] }  某一次就诊的用药记录
 *   POST   /api/visits/:id/medication   → { medication: [...] }  只覆盖该次就诊的用药
 *   DELETE /api/medication/:id     → { ok: true }               删一条用药记录
 *
 * 若已构建过 dist/，同时把前端页面也由本进程托管（单端口的本地应用）。
 */

import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, extname, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  deleteCustomSymbol,
  deleteMedication,
  deletePatient,
  deleteVisit,
  getPatient,
  getVisit,
  listCustomSymbols,
  listMedication,
  listPatients,
  listVisitMedication,
  openDb,
  putCustomSymbol,
  putMedication,
  putPatient,
  putVisit,
  putVisitMedication,
  renamePatient,
  updatePatientLayout,
  searchPatients,
  DB_PATH,
  RESERVED_SYMBOL_CODES,
  getLocalUser,
  // 鉴权层也走 store —— 它按 PULSE_STORE 分发（SQLite ↔ PostgreSQL）
  authenticate,
  bindWechatIdentity,
  changePassword,
  createSession,
  createUser,
  destroySession,
  findUserByWechat,
  getSessionUser,
  hasWechatIdentity,
  purgeExpiredSessions,
  unbindWechatIdentity,
} from './store.mjs'
// 与存储无关的纯逻辑（单机模式开关、会话有效期、登录名规则）
import { SINGLE_USER, SESSION_TTL_MS, isValidLoginName } from './auth-core.mjs'
import { code2Session } from './wechat.mjs'

const PORT = Number(process.env.PORT ?? 5178)
/**
 * 监听地址 —— 默认只听本机回环（`127.0.0.1`），外部访问不到。
 *
 * 真机联调时手机要连电脑的局域网 IP，必须改成 `0.0.0.0`：
 *
 *     HOST=0.0.0.0 npm run mp:dev
 *
 * 不改的话，手机请求会直接超时/连不上 —— 这是「本机能跑、手机连不上」最常见的原因。
 * 只在本机开发时可以保持默认值，避免把服务暴露到公网上。
 */
const HOST = process.env.HOST ?? '127.0.0.1'
/**
 * 前端构建产物目录。
 * 桌面版（Electron）把打包后的 dist/ 放在 asar 外的 resources/ui，
 * 用 PULSE_DIST 指过来；网页版走默认的 ../dist。
 */
const DIST = process.env.PULSE_DIST ?? join(import.meta.dirname, '..', 'dist')

/**
 * 数据库句柄 —— 由 startServer() 赋值。
 *
 * 以前是模块加载期就 openDb()，那样「被 import 就会开库并监听」，
 * Electron 桌面壳没法复用这个模块。现在开库/清会话/监听都收进 startServer()，
 * 被 import 时**什么都不做**。
 */
let db = null

/** 不需要登录的接口 */
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/wechat/login',
  '/api/auth/wechat/bind',
])

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

async function readJson(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  if (chunks.length === 0) return {}
  const raw = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * 允许跨域的来源（逗号分隔）。
 *
 * 同源部署（同进程托管页面与 API）时**留空即可**，不需要任何 CORS 头。
 * 迁到 CloudBase 后，静态托管（`*.tcloudbaseapp.com`）与云函数 API **不同源**，
 * 那时把静态托管的域名填进来（例如 PULSE_CORS_ORIGINS=https://env-xxx.tcloudbaseapp.com）。
 *
 * 不填 `*`：病例数据敏感，只允许明确列出的来源。
 */
const CORS_ORIGINS = (process.env.PULSE_CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

/** 给响应加上 CORS 头（来源不在白名单就不加，浏览器会自己拦） */
function applyCors(req, res) {
  if (CORS_ORIGINS.length === 0) return
  const origin = String(req.headers.origin ?? '')
  if (!origin || !CORS_ORIGINS.includes(origin)) return
  res.setHeader('access-control-allow-origin', origin)
  res.setHeader('access-control-allow-credentials', 'true')
  res.setHeader('access-control-allow-headers', 'content-type, authorization')
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  res.setHeader('access-control-max-age', '600')
  res.setHeader('vary', 'Origin')
}

/** 从 Authorization 头里取 Bearer 令牌 */
function bearerToken(req) {
  const h = req.headers.authorization ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(String(h))
  return m ? String(m[1]).trim() : ''
}

/**
 * 解析当前登录者；没有或过期 → null。
 * 单机模式下直接是内置账号。
 */
async function currentUser(req) {
  if (SINGLE_USER) return await getLocalUser(db)
  return await getSessionUser(db, bearerToken(req))
}

/** 用户对外展示的信息 */
function publicUser(user) {
  return {
    id: user.id,
    loginName: user.login_name ?? user.loginName,
    displayName: user.display_name ?? user.displayName,
    role: user.role,
  }
}

function serveStatic(req, res) {
  if (!existsSync(DIST)) {
    sendJson(res, 404, { error: '尚未构建前端；请先 npm run build，或用 npm run dev 启动开发服务器。' })
    return
  }
  const url = new URL(req.url ?? '/', 'http://localhost')
  let rel = decodeURIComponent(url.pathname)
  if (rel === '/' || rel === '') rel = '/index.html'
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '') // 防目录穿越
  let file = join(DIST, safe)
  if (!file.startsWith(DIST)) file = join(DIST, 'index.html')
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html')
  if (!existsSync(file)) {
    sendJson(res, 404, { error: 'not found' })
    return
  }
  const body = readFileSync(file)
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
  res.end(body)
}

/* ------------------------------ 账号接口 ------------------------------ */

/** 注册 → 建账号 → 挂 password 身份 → 直接签发会话 */
async function handleRegister(res, body) {
  if (SINGLE_USER) {
    sendJson(res, 409, { error: '当前是单机模式，只能用本机数据，不能注册新账号' })
    return
  }
  const result = await createUser(db, {
    loginName: body?.loginName,
    displayName: body?.displayName,
    password: body?.password,
  })
  if (result.error) {
    const map = {
      invalid_login_name: [400, '登录名要用 11 位手机号，或 4~20 位字母开头的字母数字下划线'],
      weak_password: [400, '密码至少 6 位'],
      login_name_taken: [409, '这个登录名已经被用了，换一个'],
    }
    const [status, error] = map[result.error] ?? [400, '注册失败']
    sendJson(res, status, { error })
    return
  }
  const token = await createSession(db, result.user.id, '')
  sendJson(res, 200, { user: publicUser(result.user), token })
}

/** 登录 */
async function handleLogin(res, body) {
  if (SINGLE_USER) {
    sendJson(res, 409, { error: '当前是单机模式，不用登录' })
    return
  }
  const result = await authenticate(db, body?.loginName, body?.password)
  if (result.error) {
    sendJson(res, 401, { error: '登录名或密码不对' })
    return
  }
  const token = await createSession(db, result.user.id, '')
  sendJson(res, 200, { user: publicUser(result.user), token })
}

/**
 * 小程序登录：code → openid → 看这个微信身份有没有绑账号。
 * 绑了 → 直接签发会话；没绑 → 返回 need_bind，让小程序引导用户输入网站账号密码。
 */
async function handleWechatLogin(res, body) {
  const r = await code2Session(body?.code)
  if (!r.ok) {
    sendJson(res, 400, { error: r.error })
    return
  }
  const user = await findUserByWechat(db, r.openid)
  if (!user) {
    sendJson(res, 200, { status: 'need_bind' })
    return
  }
  const token = await createSession(db, user.id, '')
  sendJson(res, 200, { status: 'bound', user: publicUser(user), token })
}

/**
 * 小程序绑定：code → openid，再用「网站账号＋密码」验证 → 把 openid 绑到这个账号。
 * 绑定后两端看到同一份数据。
 */
async function handleWechatBind(res, body) {
  const r = await code2Session(body?.code)
  if (!r.ok) {
    sendJson(res, 400, { error: r.error })
    return
  }
  const result = await authenticate(db, body?.loginName, body?.password)
  if (result.error) {
    sendJson(res, 401, { error: '账号或密码不对，绑定失败' })
    return
  }
  const bind = await bindWechatIdentity(db, result.user.id, r.openid, r.unionId)
  if (bind.error) {
    sendJson(res, 409, { error: '这个微信已经绑到别的账号上了' })
    return
  }
  const token = await createSession(db, result.user.id, '')
  sendJson(res, 200, { status: 'bound', user: publicUser(result.user), token })
}

/* -------------------------------- 主路由 -------------------------------- */

/**
 * 初始化存储（开库 ＋ 清过期会话）
 *
 * 自建服务与**云函数**都要用 —— 云函数是「冷启动时初始化一次，之后复用」。
 * openDb 可能是 async（PG 版要连库、建内置单机账号）—— await 一个非 Promise 也没问题。
 */
export async function initDb() {
  db = await openDb()
  await purgeExpiredSessions(db)
  return db
}

/**
 * 起服务：开库 → 清过期会话 → 监听。
 *
 * 两种用法：
 * 1. 命令行直接跑（`node server/index.mjs`）→ 文件末尾的 isMain 分支会调它。
 * 2. 被 import（桌面壳 desktop/server-entry.mjs、e2e 回归）→ 由调用方决定何时起、起在哪个端口。
 *
 * @param {number} port  0 = 由操作系统分配空闲端口（桌面版用它避开端口冲突）
 * @param {string} host  只监听本机
 */
export async function startServer({ port = 0, host = '127.0.0.1' } = {}) {
  await initDb()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  return { server, db, port: server.address().port }
}

/**
 * 路由主体 —— **与传输方式无关**。
 *
 * 自建 Node 服务与 CloudBase HTTP 云函数**共用这一份**：
 *   · 自建服务：createServer((req, res) => handleApi(req, res))
 *   · 云函数：把云函数的 event 转成「像 req/res 的东西」，调用同一个 handleApi
 *
 * 这样迁到 CloudBase 时，路由与鉴权逻辑**一行都不用改** ——
 * 改的只有「怎么把请求送进来」。
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export async function handleApi(req, res) {
  const started = Date.now()
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  const method = req.method ?? 'GET'

  let user = null
  try {
    applyCors(req, res)

    // 预检请求：直接回 204，不进业务逻辑
    if (method === 'OPTIONS' && path.startsWith('/api/')) {
      res.writeHead(204)
      res.end()
      return
    }

    if (path.startsWith('/api/') && !PUBLIC_PATHS.has(path)) {
      user = await currentUser(req)
      if (!user) {
        sendJson(res, 401, { error: '请先登录' })
        return
      }
    }

    /* ---- 公开接口 ---- */

    if (path === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        db: DB_PATH,
        mode: SINGLE_USER ? 'single' : 'multi',
        sessionTtlDays: Math.round(SESSION_TTL_MS / 86400000),
      })
      return
    }

    if (path === '/api/auth/register' && method === 'POST') {
      await handleRegister(res, await readJson(req))
      return
    }

    if (path === '/api/auth/login' && method === 'POST') {
      await handleLogin(res, await readJson(req))
      return
    }

    if (path === '/api/auth/wechat/login' && method === 'POST') {
      await handleWechatLogin(res, await readJson(req))
      return
    }

    if (path === '/api/auth/wechat/bind' && method === 'POST') {
      await handleWechatBind(res, await readJson(req))
      return
    }

    /* ---- 需要登录的接口 ---- */

    // 到这里的 /api/ 请求都已经过鉴权门（user 非空）；静态页请求不走下面的路由。
    // 用 ?. 是为了静态请求时 user 为 null 也不炸 —— 此时 ownerId 是 undefined，
    // 万一有路由误落进来，查询会 owner_id = undefined → 查不到任何行（fail-closed）。
    const ownerId = user?.id

    if (path === '/api/auth/me' && method === 'GET') {
      sendJson(res, 200, {
        user: publicUser(user),
        wechatBound: SINGLE_USER ? false : await hasWechatIdentity(db, ownerId),
      })
      return
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      if (!SINGLE_USER) await destroySession(db, bearerToken(req))
      sendJson(res, 200, { ok: true })
      return
    }

    if (path === '/api/auth/change-password' && method === 'POST') {
      if (SINGLE_USER) {
        sendJson(res, 409, { error: '单机模式不能改密码' })
        return
      }
      const body = await readJson(req)
      const r = await changePassword(db, ownerId, body?.oldPassword, body?.newPassword)
      if (r.error) {
        const map = {
          weak_password: [400, '新密码至少 6 位'],
          bad_credentials: [401, '原密码不对'],
          no_user: [401, '请先登录'],
        }
        const [status, error] = map[r.error] ?? [400, '改密码失败']
        sendJson(res, status, { error })
        return
      }
      sendJson(res, 200, { ok: true })
      return
    }

    if (path === '/api/auth/wechat' && method === 'DELETE') {
      if (SINGLE_USER) {
        sendJson(res, 409, { error: '单机模式没有微信绑定' })
        return
      }
      const ok = await unbindWechatIdentity(db, ownerId)
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: '还没有绑定微信' })
      return
    }

    if (path === '/api/patients' && method === 'GET') {
      sendJson(res, 200, { patients: await listPatients(db, ownerId) })
      return
    }

    if (path === '/api/search' && method === 'GET') {
      sendJson(res, 200, { patients: await searchPatients(db, url.searchParams.get('q') ?? '', ownerId) })
      return
    }

    if (path === '/api/symbols' && method === 'GET') {
      sendJson(res, 200, { symbols: await listCustomSymbols(db, ownerId) })
      return
    }

    if (path === '/api/symbols' && method === 'POST') {
      const body = await readJson(req)
      const code = String(body?.code ?? '').trim()
      const name = String(body?.name ?? '').trim()
      if (!code || !name) {
        sendJson(res, 400, { error: '请填写符号代码与名称' })
        return
      }
      if (code.length > 3) {
        sendJson(res, 400, { error: '符号代码最多 3 个字符' })
        return
      }
      if (/\s/.test(code) || code.includes('/')) {
        sendJson(res, 400, { error: '符号代码里不能有空格或「/」' })
        return
      }
      if (name.length > 12) {
        sendJson(res, 400, { error: '符号名称最多 12 个字符' })
        return
      }
      if (RESERVED_SYMBOL_CODES.includes(code)) {
        sendJson(res, 400, { error: `代码「${code}」与讲义固定符号重复，换一个` })
        return
      }
      const symbol = await putCustomSymbol(db, ownerId, { code, name })
      sendJson(res, 200, { symbol })
      return
    }

    const sm = path.match(/^\/api\/symbols\/([^/]+)$/)
    if (sm && method === 'DELETE') {
      const code = decodeURIComponent(sm[1])
      const ok = await deleteCustomSymbol(db, code, ownerId)
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: '没有这个自定义符号' })
      return
    }

    if (path === '/api/patients' && method === 'POST') {
      const body = await readJson(req)
      if (!body || typeof body.name !== 'string' || !Array.isArray(body.visits)) {
        sendJson(res, 400, { error: '请求体需含 name 与 visits' })
        return
      }
      const patient = await putPatient(db, ownerId, {
        id: typeof body.id === 'string' && body.id ? body.id : undefined,
        name: body.name || '未命名',
        layout: body.layout,
        visits: body.visits,
        medications: Array.isArray(body.medications) ? body.medications : [],
      })
      if (!patient) {
        sendJson(res, 404, { error: '没有这位患者的记录' })
        return
      }
      sendJson(res, 200, { patient })
      return
    }

    // 用药记录：某位患者的全部用药 / 某一次就诊的用药
    const pmMed = path.match(/^\/api\/patients\/([^/]+)\/medication$/)
    if (pmMed) {
      const id = decodeURIComponent(pmMed[1])
      if (method === 'GET') {
        if (!(await getPatient(db, id, ownerId))) {
          sendJson(res, 404, { error: '没有这位患者的记录' })
          return
        }
        sendJson(res, 200, { medication: await listMedication(db, id, ownerId) })
        return
      }
      if (method === 'POST' || method === 'PUT') {
        const body = await readJson(req)
        const rows = Array.isArray(body?.medications)
          ? body.medications
          : Array.isArray(body)
            ? body
            : []
        if (!(await getPatient(db, id, ownerId))) {
          sendJson(res, 404, { error: '没有这位患者的记录' })
          return
        }
        sendJson(res, 200, { medication: await putMedication(db, id, ownerId, rows) })
        return
      }
    }

    const vmMed = path.match(/^\/api\/visits\/([^/]+)\/medication$/)
    if (vmMed) {
      const id = decodeURIComponent(vmMed[1])
      if (method === 'GET') {
        if (!await getVisit(db, id, ownerId)) {
          sendJson(res, 404, { error: '没有这条就诊记录' })
          return
        }
        sendJson(res, 200, { medication: await listVisitMedication(db, id, ownerId) })
        return
      }
      // 单次语义：只写回这一次的用药，不动该患者的其它次
      if (method === 'POST' || method === 'PUT') {
        const body = await readJson(req)
        const rows = Array.isArray(body?.medications)
          ? body.medications
          : Array.isArray(body)
            ? body
            : []
        const med = await putVisitMedication(db, id, ownerId, rows)
        if (!med) {
          sendJson(res, 404, { error: '没有这条就诊记录' })
          return
        }
        sendJson(res, 200, { medication: med })
        return
      }
    }

    const medm = path.match(/^\/api\/medication\/([^/]+)$/)
    if (medm) {
      const id = decodeURIComponent(medm[1])
      if (method === 'DELETE') {
        const ok = await deleteMedication(db, id, ownerId)
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: '没有这条用药记录' })
        return
      }
    }

    const pm = path.match(/^\/api\/patients\/([^/]+)$/)
    if (pm) {
      const id = decodeURIComponent(pm[1])
      if (method === 'GET') {
        const patient = await getPatient(db, id, ownerId)
        if (!patient) {
          sendJson(res, 404, { error: '没有这位患者的记录' })
          return
        }
        sendJson(res, 200, { patient })
        return
      }
      if (method === 'PATCH') {
        const body = await readJson(req)
        // PATCH 改两样：姓名（重命名）、体例（7 脉点 / 9 行）。
        // 体例是患者级属性 —— 记录表与录入记录都按它画，所以改一下就落库，
        // 不能只留在某个页面的临时状态里（同一位患者两个页面显示不同行数）。
        const hasName = typeof body.name === 'string'
        const hasLayout = body.layout === 'nine' || body.layout === 'seven'
        if (!hasName && !hasLayout) {
          sendJson(res, 400, { error: '请求体需含 name（改姓名）或 layout（nine / seven，改体例）' })
          return
        }
        let patient = null
        if (hasName) {
          patient = await renamePatient(db, id, ownerId, body.name)
        }
        if (hasLayout) {
          patient = await updatePatientLayout(db, id, ownerId, body.layout)
        }
        if (!patient) {
          sendJson(res, 404, { error: '没有这位患者的记录' })
          return
        }
        sendJson(res, 200, { patient })
        return
      }
      if (method === 'DELETE') {
        const ok = await deletePatient(db, id, ownerId)
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: '没有这位患者的记录' })
        return
      }
    }

    const vm = path.match(/^\/api\/visits\/([^/]+)$/)
    if (vm) {
      const id = decodeURIComponent(vm[1])
      if (method === 'GET') {
        const visit = await getVisit(db, id, ownerId)
        if (!visit) {
          sendJson(res, 404, { error: '没有这条就诊记录' })
          return
        }
        sendJson(res, 200, { visit })
        return
      }
      if (method === 'PATCH') {
        const body = await readJson(req)
        const visit = await putVisit(db, id, ownerId, body ?? {})
        if (!visit) {
          sendJson(res, 404, { error: '没有这条就诊记录' })
          return
        }
        sendJson(res, 200, { visit })
        return
      }
      if (method === 'DELETE') {
        const ok = await deleteVisit(db, id, ownerId)
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: '没有这条就诊记录' })
        return
      }
    }

    if (path.startsWith('/api/')) {
      sendJson(res, 404, { error: '接口不存在' })
      return
    }

    serveStatic(req, res)
  } catch (err) {
    console.error(`[臧氏脉学] ${method} ${path} 出错：`, err)
    sendJson(res, 500, { error: String(err?.message ?? err) })
  } finally {
    // 极简访问日志：不含请求体（病例数据敏感）
    if (path.startsWith('/api/')) {
      console.log(
        `[api] ${method} ${path} → ${res.statusCode} ${Date.now() - started}ms${user ? ` user=${user.id}` : ''}`,
      )
    }
  }
}

/** 自建 Node 服务：把请求交给同一个 handleApi */
const server = createServer((req, res) => {
  handleApi(req, res).catch((err) => {
    console.error('[臧氏脉学] 请求处理出错：', err)
    if (!res.headersSent) sendJson(res, 500, { error: '服务器内部错误' })
  })
})

/**
 * 命令行直跑才起服务；被 import 时（桌面壳／e2e）由调用方调 startServer()。
 * 用**路径**比较而不是 URL 比较 —— 仓库路径里可能有中文，
 * pathToFileURL 会做百分号编码，两边编码规则不一致容易对不上。
 */
const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false

if (isMain) {
  const { port } = await startServer({ port: PORT, host: HOST })
  console.log(`[臧氏脉学] 病例记录服务已启动：http://localhost:${port}/api/health`)
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    console.log(`[臧氏脉学] 已监听 ${HOST} —— 手机可用电脑局域网 IP 访问（记得放行防火墙 ${port} 端口）`)
  }
  console.log(`[臧氏脉学] SQLite 文件：${DB_PATH}`)
  console.log(`[臧氏脉学] 模式：${SINGLE_USER ? '单机（不用登录）' : '多用户（需登录）'}`)
  if (existsSync(DIST)) console.log(`[臧氏脉学] 同时托管已构建页面：${DIST}`)
}
