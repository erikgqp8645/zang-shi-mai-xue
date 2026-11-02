/**
 * 本地服务端 —— 病例记录 API ＋ 静态页面
 *
 * 用途：把「病例记录」落到本机磁盘上的 SQLite 文件（local-data/history.sqlite），
 *      不再依赖浏览器 localStorage，清缓存／换浏览器／换机都不会丢。
 *
 * 路由：
 *   GET    /api/health             → { ok: true, db: <db 路径> }
 *   GET    /api/patients           → { patients: [...] }        患者列表（含就诊次数）
 *   GET    /api/search?q=…         → { patients: [...] }        搜索：姓名／日期标签／脉象符号
 *   GET    /api/patients/:id       → { patient }                一位患者 ＋ 其全部就诊记录
 *   POST   /api/patients           → { patient }                整份保存（患者 ＋ 就诊记录）
 *   PATCH  /api/patients/:id       → { patient }                重命名
 *   DELETE /api/patients/:id       → { ok: true }               删除患者（连带其就诊记录）
 *   GET    /api/visits/:id         → { visit }                  取一次就诊记录
 *   PATCH  /api/visits/:id         → { visit }                  改一次就诊记录（标签／脉象值）
 *   DELETE /api/visits/:id         → { ok: true }               删除一次就诊记录
 *
 * 若已构建过 dist/，同时把前端页面也由本进程托管（单端口的本地应用）。
 */

import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import {
  deletePatient,
  deleteVisit,
  getPatient,
  getVisit,
  listPatients,
  openDb,
  putPatient,
  putVisit,
  renamePatient,
  searchPatients,
  DB_PATH,
} from './db.mjs'

const PORT = Number(process.env.PORT ?? 5178)
const DIST = join(import.meta.dirname, '..', 'dist')

const db = openDb()

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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  const method = req.method ?? 'GET'

  try {
    if (path === '/api/health') {
      sendJson(res, 200, { ok: true, db: DB_PATH })
      return
    }

    if (path === '/api/patients' && method === 'GET') {
      sendJson(res, 200, { patients: listPatients(db) })
      return
    }

    if (path === '/api/search' && method === 'GET') {
      sendJson(res, 200, { patients: searchPatients(db, url.searchParams.get('q') ?? '') })
      return
    }

    if (path === '/api/patients' && method === 'POST') {
      const body = await readJson(req)
      if (!body || typeof body.name !== 'string' || !Array.isArray(body.visits)) {
        sendJson(res, 400, { error: '请求体需含 name 与 visits' })
        return
      }
      const patient = putPatient(db, {
        id: typeof body.id === 'string' && body.id ? body.id : undefined,
        name: body.name || '未命名',
        layout: body.layout,
        visits: body.visits,
      })
      sendJson(res, 200, { patient })
      return
    }

    const pm = path.match(/^\/api\/patients\/([^/]+)$/)
    if (pm) {
      const id = decodeURIComponent(pm[1])
      if (method === 'GET') {
        const patient = getPatient(db, id)
        if (!patient) {
          sendJson(res, 404, { error: '没有这位患者的记录' })
          return
        }
        sendJson(res, 200, { patient })
        return
      }
      if (method === 'PATCH') {
        const body = await readJson(req)
        if (typeof body.name !== 'string') {
          sendJson(res, 400, { error: '请求体需含 name' })
          return
        }
        const patient = renamePatient(db, id, body.name)
        if (!patient) {
          sendJson(res, 404, { error: '没有这位患者的记录' })
          return
        }
        sendJson(res, 200, { patient })
        return
      }
      if (method === 'DELETE') {
        const ok = deletePatient(db, id)
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: '没有这位患者的记录' })
        return
      }
    }

    const vm = path.match(/^\/api\/visits\/([^/]+)$/)
    if (vm) {
      const id = decodeURIComponent(vm[1])
      if (method === 'GET') {
        const visit = getVisit(db, id)
        if (!visit) {
          sendJson(res, 404, { error: '没有这条就诊记录' })
          return
        }
        sendJson(res, 200, { visit })
        return
      }
      if (method === 'PATCH') {
        const body = await readJson(req)
        const visit = putVisit(db, id, body ?? {})
        if (!visit) {
          sendJson(res, 404, { error: '没有这条就诊记录' })
          return
        }
        sendJson(res, 200, { visit })
        return
      }
      if (method === 'DELETE') {
        const ok = deleteVisit(db, id)
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
    sendJson(res, 500, { error: String(err?.message ?? err) })
  }
})

server.listen(PORT, () => {
  console.log(`[臧氏脉学] 病例记录服务已启动：http://localhost:${PORT}/api/health`)
  console.log(`[臧氏脉学] SQLite 文件：${DB_PATH}`)
  if (existsSync(DIST)) console.log(`[臧氏脉学] 同时托管已构建页面：${DIST}`)
})
