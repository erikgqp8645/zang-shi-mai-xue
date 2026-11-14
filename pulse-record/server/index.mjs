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
 *   GET  /api/content             已发布的知识库内容包（8 个 JSON 的形状）
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
 *   GET    /api/content            → { ok, version, source, content }   已发布内容包
 *   GET    /api/patients           → { patients: [...] }        患者列表（含就诊次数）
 *   GET    /api/search?q=…         → { patients: [...] }        搜索：姓名／日期标签／脉象符号
 *   GET    /api/symbols             → { symbols: [...] }        自定义符号（使用者自建，如「涩」＝S）
 *   POST   /api/symbols             → { symbol }                新增／改名自定义符号
 *   DELETE /api/symbols/:code       → { ok: true }              删除自定义符号
 *   GET    /api/formula-patterns    → { overrides }             手改过的方剂脉象图（只含覆盖层）
 *   PUT    /api/formula-patterns/:formulaId → { formulaId, patterns }  整条替换该方剂的脉象图
 *   DELETE /api/formula-patterns/:formulaId → { ok: true }      撤销覆盖，回到内置基线
 *   GET    /api/library/overrides  → { overrides, meta }        用方知识库 · 管理员覆盖层
 *                                                          （公共资料，所有登录账号共享一份）
 *   GET    /api/library/kinds      → { kinds }                 「什么能改」的注册表（前端表单由它驱动）
 *   PATCH  /api/library/entries/:kind/:id → { entry, changed }  改一条（字段级；body: { patch }）
 *   DELETE /api/library/entries/:kind/:id → { ok, snapshot }   **删一条**（写墓碑，带原内容快照）
 *   POST   /api/library/entries/:kind/:id/restore → { ok }     **恢复默认**（撤覆盖层这一行 → 回基线）
 *   POST   /api/library/entries/:kind/:id/revive  → { ok }     **撤销删除**（把墓碑里的快照放回来）
 *                                                          上面四个写接口：**仅 admin**；
 *                                                          读接口不设闸门 —— 知识库是公共资料，
 *                                                          不同账号看到的必须是同一份。
 *                                                          ⚠️ DELETE 在这里是「删除条目」，
 *                                                          不是「删覆盖行」；后两者见 restore/revive。
 *                                                          语义与命令行 `npm run admin -- library …`
 *                                                          一一对应（set/del/restore/revive）。
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
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib'
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
  listFormulaPatterns,
  putFormulaPatterns,
  deleteFormulaPatterns,
  // 用方知识库覆盖层（公共资料，不按账号隔离）
  listLibraryItems,
  DB_PATH,
  symbolInputError,
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
// 内容层（已发布的知识库）—— 按 PULSE_STORE 分派：pg 读远端，sqlite 读仓库快照
import { readContent, CONTENT_SOURCE } from './content-store.mjs'
// 用方知识库：把覆盖层行按种类分组（前端将来合并时用的形状）
import { groupOverrides } from './library-schema.mjs'
// 用方知识库 · 运行时编辑（网站端 ③ 的「编辑／删除」按钮走这里）
import {
  LibraryError,
  createLibraryEntry,
  deleteLibraryEntry,
  libraryKindsPayload,
  patchLibraryEntry,
  restoreLibraryEntry,
  reviveLibraryEntry,
} from './library-service.mjs'

const PORT = Number(process.env.PORT ?? 5178)
/**
 * 监听地址 —— 默认只听本机回环（`127.0.0.1`），外部访问不到。
 *
 * 真机联调时手机要连电脑的局域网 IP，必须改成 `0.0.0.0`：
 *
 *     npm run mp:dev
 *
 * （`scripts/mp-dev.mjs` **默认就是 `0.0.0.0`**，不用另外设环境变量。
 *  ⚠️ 别写成 `HOST=0.0.0.0 npm run mp:dev` —— 那是 Unix shell 的语法，
 *  Windows 的 cmd 根本不认，会把 `HOST=0.0.0.0` 当成一个命令名去执行。）
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
  '/api/content',
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

/**
 * 是不是管理员。
 *
 * ⓘ `users.role` 只有两个值：`user`／`admin`（`server/schema-pg.sql` 的 CHECK 约束）。
 * ⓘ 单机模式下 `currentUser` 直接返回内置本机账号，它的 role 就是 `admin`
 *   （`server/db.mjs` 建号时写死的）⇒ 本机直接可用。
 */
function isAdmin(user) {
  return String(user?.role ?? '') === 'admin'
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
  const type = MIME[extname(file)] ?? 'application/octet-stream'
  const raw = readFileSync(file)

  /*
   * 缓存策略 —— 走 Cloudflare 的手机端，这一条影响最大。
   *
   * 原来一律 `no-store`：每次打开页面都要重新下载整包 JS/CSS，手机（尤其是
   * 经 Cloudflare 的跨境链路）慢得肉眼可见。改成：
   *   /assets/*   构建产物文件名带内容哈希 ⇒ 一年 immutable，浏览器与 CF 都直接用缓存
   *   index.html  每次回来验一下（它才是指向哪个哈希的那份清单）
   *   其它        （图标、底图等）一小时
   */
  const cacheControl =
    safe === '/index.html'
      ? 'no-cache'
      : safe.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600'

  const { body, encoding } = encodedStatic(
    file,
    raw,
    type,
    String(req.headers['accept-encoding'] ?? ''),
  )

  const headers = { 'content-type': type, 'cache-control': cacheControl }
  if (encoding) {
    headers['content-encoding'] = encoding
    headers.vary = 'Accept-Encoding'
  }
  res.writeHead(200, headers)
  res.end(body)
}

/**
 * 静态资源编码缓存：key = 路径 ＋ mtime。
 *
 * 不缓存的话，每个请求都要把 JS（500KB 级）压一遍 —— 省了带宽、费了 CPU，
 * 首屏反而更慢。构建产物换版本时文件名会变，mtime 也变，旧条目自然失效。
 */
const STATIC_ENCODED = new Map()

/** 只压文本类：图片／字体本身就是压缩格式，再压没收益还费 CPU */
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|xml)|image\/svg\+xml)/

function encodedStatic(file, body, type, acceptEncoding) {
  if (!COMPRESSIBLE.test(type) || body.length < 1024) return { body, encoding: null }

  const key = `${file}:${statSync(file).mtimeMs}`
  let entry = STATIC_ENCODED.get(key)
  if (!entry) {
    // 构建产物就那么几个文件；超了说明来回换过版本，整张表清掉即可
    if (STATIC_ENCODED.size > 64) STATIC_ENCODED.clear()
    entry = {}
    STATIC_ENCODED.set(key, entry)
  }

  if (/\bbr\b/.test(acceptEncoding)) {
    // quality 5：压缩率与耗时折中（11 会把首次请求拖慢几百毫秒）
    entry.br ??= brotliCompressSync(body, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 },
    })
    return { body: entry.br, encoding: 'br' }
  }

  if (/\bgzip\b/.test(acceptEncoding)) {
    entry.gz ??= gzipSync(body)
    return { body: entry.gz, encoding: 'gzip' }
  }

  return { body, encoding: null }
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

    // 内容包（已发布的知识库）。公开接口 —— 内容是全局的一份，不按人分片。
    // ⭐ 不可达时**直接报错**（500 ＋ 明确信息），不做本地缓存兜底：
    //    静默拿旧内容顶上，用户会以为改动已经上线（与 src/api/patterns.ts 同一纪律）。
    if (path === '/api/content' && method === 'GET') {
      let pack
      try {
        pack = await readContent()
      } catch (err) {
        console.error('[臧氏脉学] 读内容包失败：', err)
        sendJson(res, 500, {
          error: `内容库不可达：${String(err?.message ?? err)}`,
          source: CONTENT_SOURCE,
        })
        return
      }
      sendJson(res, 200, {
        ok: true,
        version: pack.version,
        source: pack.source,
        content: pack.content,
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
      // 校验只有一份（server/symbol-codes.mjs），路由与两套存储都调它
      const invalid = symbolInputError(code, name)
      if (invalid) {
        sendJson(res, 400, { error: invalid })
        return
      }
      const symbol = await putCustomSymbol(db, ownerId, { code, name })
      if (!symbol) {
        // 存储层也不收（理论上到不了这里）—— 但**绝不能**回 200 + null：
        // 那会变成「界面说已添加、清单里没有」的静默失败。
        sendJson(res, 400, { error: '这个符号存不进去，换一个试试' })
        return
      }
      sendJson(res, 200, { symbol })
      return
    }

    const sm = path.match(/^\/api\/symbols\/([^/]+)$/)
    if (sm && method === 'DELETE') {
      let code = sm[1]
      try {
        code = decodeURIComponent(code)
      } catch {
        // 畸形百分号编码（如 `%E0%A4%A`）：回 400，别让它冒成 500 并回显内部错误
        sendJson(res, 400, { error: '符号代码的编码不对' })
        return
      }
      const ok = await deleteCustomSymbol(db, code, ownerId)
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: '没有这个自定义符号' })
      return
    }

    /* ---- 方剂脉象图：内置基线在 src/content/pulse-patterns.json（只读），   */
    /*      这里只存使用者手改过的条目（覆盖层）。                             */

    if (path === '/api/formula-patterns' && method === 'GET') {
      sendJson(res, 200, { overrides: await listFormulaPatterns(db, ownerId) })
      return
    }

    const fm = path.match(/^\/api\/formula-patterns\/([^/]+)$/)
    if (fm) {
      let formulaId = fm[1]
      try {
        formulaId = decodeURIComponent(formulaId)
      } catch {
        // 与 /api/symbols 一样：畸形编码回 400，别冒成 500
        sendJson(res, 400, { error: '条目 id 的编码不对' })
        return
      }

      if (method === 'PUT') {
        const body = await readJson(req)
        if (!Array.isArray(body?.patterns)) {
          sendJson(res, 400, { error: 'patterns 必须是数组（每张图一个对象）' })
          return
        }
        const ok = await putFormulaPatterns(db, ownerId, formulaId, body.patterns)
        if (!ok) {
          // 绝不回 200 + 假成功：那会变成「界面显示已保存、别的机器打开却没有」
          sendJson(res, 400, {
            error: '脉象图存不进去：一个方剂最多 20 张，单张不能超过 32KB，且每张必须有 cells 数组',
          })
          return
        }
        // 回这一条的最新结果，客户端用它替换本地那一项（不必整表重拉）
        sendJson(res, 200, { formulaId, patterns: body.patterns })
        return
      }

      if (method === 'DELETE') {
        const ok = await deleteFormulaPatterns(db, ownerId, formulaId)
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: '这条没有手改过的脉象图' })
        return
      }
    }

    /* ---- 用方知识库 · 管理员覆盖层 ------------------------------------ */
    /*      内置基线在 src/content/*.json（只读，编译期内联进前端）。      */
    /*      这里只存管理员改过的那些条目 —— **公共资料**，所有账号共享一份。 */

    if (path === '/api/library/overrides' && method === 'GET') {
      const rows = await listLibraryItems(db)
      const overrides = groupOverrides(rows)
      let count = 0
      let updatedAt = null
      for (const kind of Object.keys(overrides)) {
        for (const item of Object.values(overrides[kind])) {
          count += 1
          if (typeof item.updatedAt === 'number' && (updatedAt === null || item.updatedAt > updatedAt)) {
            updatedAt = item.updatedAt
          }
        }
      }
      sendJson(res, 200, { overrides, meta: { count, updatedAt } })
      return
    }

    /* ---- 用方知识库 · 运行时编辑（网站端 ③ 的编辑／删除按钮） ------------ */
    /*      写接口：**仅 admin**。读接口不设闸门 —— 知识库是公共资料，      */
    /*      不同账号看到的必须是同一份（否则一个设置两处真源）。            */
    /*      ⚠️ 语义与命令行 `npm run admin -- library …` 一一对应：        */
    /*         PATCH＝set、DELETE＝del、restore＝restore、revive＝revive。  */

    if (path === '/api/library/kinds' && method === 'GET') {
      sendJson(res, 200, { kinds: libraryKindsPayload() })
      return
    }

    const libEntry = path.match(/^\/api\/library\/entries\/([^/]+)\/([^/]+)(\/(restore|revive))?$/)
    const libCreate = path.match(/^\/api\/library\/entries\/([^/]+)$/)
    // **新增**：POST /api/library/entries/:kind（body: { entry }）
    // 与命令行 `library add` 同一件事；p44 条目必须自带脉象图（画图即条件）。
    // ⚠️ 单独成块：两段路径只认 POST，其它方法回 405 ——
    //    不能落进下面的 libEntry 分支（那里 libEntry 是 null）。
    if (libCreate) {
      if (!isAdmin(user)) {
        sendJson(res, 403, {
          error: '只有管理员能改用方知识库（这一份是所有账号共享的公共资料）。',
        })
        return
      }
      if (method !== 'POST') {
        sendJson(res, 405, { error: '这个地址只支持 POST（新增一条条目）。' })
        return
      }
      const kind = decodeURIComponent(libCreate[1])
      const by = String(user.login_name ?? user.loginName ?? user.id ?? 'admin')
      try {
        const body = await readJson(req)
        const out = await createLibraryEntry(db, kind, body?.entry, by)
        sendJson(res, 200, { ok: true, ...out })
      } catch (err) {
        const status = err instanceof LibraryError ? err.status : 500
        if (status >= 500) console.error('[臧氏脉学] 用方知识库新增失败：', err)
        sendJson(res, status, { error: err?.message ?? String(err) })
      }
      return
    }
    if (libEntry) {
      if (!isAdmin(user)) {
        sendJson(res, 403, {
          error: '只有管理员能改用方知识库（这一份是所有账号共享的公共资料）。',
        })
        return
      }
      const kind = decodeURIComponent(libEntry[1])
      const id = decodeURIComponent(libEntry[2])
      const action = libEntry[3] ? libEntry[3].slice(1) : ''
      const by = String(user.login_name ?? user.loginName ?? user.id ?? 'admin')
      try {
        if (method === 'PATCH' && !action) {
          const body = await readJson(req)
          const out = await patchLibraryEntry(db, kind, id, body?.patch, by)
          sendJson(res, 200, { ok: true, ...out })
          return
        }
        if (method === 'DELETE' && !action) {
          const out = await deleteLibraryEntry(db, kind, id, by)
          sendJson(res, 200, { ok: true, ...out })
          return
        }
        if (method === 'POST' && action === 'restore') {
          const out = await restoreLibraryEntry(db, kind, id)
          sendJson(res, 200, { ok: true, ...out })
          return
        }
        if (method === 'POST' && action === 'revive') {
          const out = await reviveLibraryEntry(db, kind, id, by)
          sendJson(res, 200, { ok: true, ...out })
          return
        }
        sendJson(res, 405, { error: '这个地址不支持这个方法。' })
      } catch (err) {
        const status = err instanceof LibraryError ? err.status : 500
        if (status >= 500) console.error('[臧氏脉学] 用方知识库写入失败：', err)
        sendJson(res, status, { error: err?.message ?? String(err) })
      }
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
