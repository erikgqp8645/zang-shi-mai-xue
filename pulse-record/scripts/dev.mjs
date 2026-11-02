/**
 * 开发模式：同时起「前端 Vite」与「本地 SQLite 服务」。
 *
 * 不引第三方依赖（不用 concurrently），直接 spawn 两个子进程并把输出转发到同一个终端。
 * Ctrl+C 时一并退出。
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

const API_PORT = process.env.PORT ?? '5178'
const WEB_PORT = process.env.WEB_PORT ?? '5180'

/** 端口是否已被占用（占用时给出可照做的提示，而不是让子进程抛 EADDRINUSE） */
function portBusy(port) {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(true))
    srv.once('listening', () => srv.close(() => resolve(false)))
    srv.listen(Number(port), '127.0.0.1')
  })
}

if (await portBusy(API_PORT)) {
  process.stderr.write(
    `[dev] 端口 ${API_PORT} 已被占用 —— 可能已有一个病例记录服务在跑。\n` +
      `      要同时用两个：另起一个用 PORT=<别的端口> PORT=... npm run dev；\n` +
      `      或先停掉旧的那个（lsof -ti :${API_PORT} | xargs kill）。\n`,
  )
  process.exit(1)
}

const children = []

function run(name, cmd, args) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
  const prefix = `[${name}]`
  const pipe = (stream, out) => {
    stream.setEncoding('utf8')
    let buf = ''
    stream.on('data', (chunk) => {
      buf += chunk
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) out.write(`${prefix} ${line}\n`)
    })
  }
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)
  child.on('exit', (code) => {
    process.stdout.write(`${prefix} 退出（code=${code}）\n`)
    shutdown(code ?? 0)
  })
  children.push(child)
  return child
}

function shutdown(code) {
  for (const c of children) {
    if (!c.killed) c.kill('SIGTERM')
  }
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

run('api', process.execPath, ['server/index.mjs'])
run('web', process.execPath, ['node_modules/vite/bin/vite.js', '--port', WEB_PORT, '--strictPort'])

process.stdout.write(`[dev] 前端 http://localhost:${WEB_PORT}/　病例记录 API http://localhost:${API_PORT}/api/patients\n`)
