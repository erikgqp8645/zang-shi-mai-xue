/**
 * 开发模式：同时起「前端 Vite」与「本地 SQLite 服务」。
 *
 * 不引第三方依赖（不用 concurrently），直接 spawn 两个子进程并把输出转发到同一个终端。
 * Ctrl+C 时一并退出。
 *
 * 单机模式（默认）：服务端不要求登录，打开就能用 —— 与改造前的用法完全一样。
 *   npm run dev              # 单机
 *   npm run dev:multi        # 多用户（注册／登录后才进）
 *
 * 局域网预览（让另一台设备打开这个页面）：
 *   npm run dev:lan        # 等于 HOST=0.0.0.0 node scripts/dev.mjs
 * 开了之后同一 Wi-Fi 下的手机／别的电脑可以用
 *   http://<本机局域网IP>:<WEB_PORT>/
 * 打开；/api 的请求由 Vite 代理转发到本机后端，病例库不用搬。
 * 默认不开（只监听本机），避免无意间把病例记录服务暴露到局域网。
 *
 * ⚠️ 为什么用 `--lan` / `--multi` 参数，而不是 `HOST=0.0.0.0 node …`：
 * **那是 Unix shell 的语法**，Windows 的 cmd 根本不认
 * （会把 `HOST=0.0.0.0` 当成一个命令名去执行，直接报
 * 「'HOST=0.0.0.0' 不是内部或外部命令」）。
 * 真机联调第一步就是 `npm run dev:lan` —— 它必须在 Windows 上也能跑。
 * 环境变量仍然优先（`PORT=… HOST=… npm run dev` 那套照旧可用）。
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { networkInterfaces } from 'node:os'

const argv = process.argv.slice(2)
const hasFlag = (name) => argv.includes(name)

const API_PORT = process.env.PORT ?? '5178'
const WEB_PORT = process.env.WEB_PORT ?? '5180'
/** 局域网预览用的监听地址；不设＝只听本机 */
const HOST = process.env.HOST ?? (hasFlag('--lan') ? '0.0.0.0' : '')
/** 多用户模式（要登录）；`--multi` 与环境变量等价，环境变量优先 */
const SINGLE_USER = process.env.PULSE_SINGLE_USER ?? (hasFlag('--multi') ? '0' : '1')

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
  // 停旧服务的命令**按平台给** —— 原来的 `lsof -ti | xargs kill` 是 Unix 的，
  // Windows 上根本没有 lsof，照抄会卡在这儿。
  const killHint =
    process.platform === 'win32'
      ? `      先停掉旧的那个：Get-NetTCPConnection -LocalPort ${API_PORT} -State Listen | ` +
        `ForEach-Object { Stop-Process -Id $_.OwningProcess }\n`
      : `      先停掉旧的那个：lsof -ti :${API_PORT} | xargs kill\n`
  process.stderr.write(
    `[dev] 端口 ${API_PORT} 已被占用 —— 可能已有一个病例记录服务在跑。\n` +
      `      要同时用两个：另起一个用 PORT=<别的端口> npm run dev；\n` +
      killHint,
  )
  process.exit(1)
}

const children = []

function run(name, cmd, args) {
  const child = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    // 单机模式默认开着：不设 PULSE_SINGLE_USER 时按单机跑（打开就能用）
    //
    // ⚠️ `HOST` **必须传进子进程的 env** —— 后端 `server/index.mjs` 靠
    // `process.env.HOST` 决定监听地址（默认只听 127.0.0.1，外部访问不到）。
    // 只把它传给 vite 的 `--host` 是不够的：那前端能开，后端仍然只听回环，
    // 手机请求照样超时 —— 正是「本机能跑、手机连不上」那个坑。
    env: {
      ...process.env,
      PULSE_SINGLE_USER: SINGLE_USER,
      ...(HOST ? { HOST } : {}),
    },
  })
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
run('web', process.execPath, [
  'node_modules/vite/bin/vite.js',
  '--port',
  WEB_PORT,
  '--strictPort',
  ...(HOST ? ['--host', HOST] : []),
])

process.stdout.write(`[dev] 前端 http://localhost:${WEB_PORT}/　病例记录 API http://localhost:${API_PORT}/api/patients\n`)

if (HOST) {
  const ips = []
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address)
    }
  }
  if (ips.length === 0) {
    process.stdout.write('[dev] 已开启局域网监听，但这台机器没取到局域网 IP，请用「系统设置 → 网络」里的地址。\n')
  } else {
    for (const ip of ips) {
      process.stdout.write(`[dev] 局域网预览：另一台设备打开 http://${ip}:${WEB_PORT}/\n`)
    }
  }
}
