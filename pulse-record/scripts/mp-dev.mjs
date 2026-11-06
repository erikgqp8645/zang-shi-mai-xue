#!/usr/bin/env node
/**
 * 小程序本机联调 —— 一条命令把「后端 + 共享包 + 该填什么」都准备好
 *
 * 做三件事：
 *   1. 共享包没编译过就自动编译（`npm run build:core`）
 *   2. 起后端（默认单机模式：小程序不用登录，进「病例」就能用）
 *   3. 把开发者工具要填的地址、真机要改的地方、常见卡点一次性打出来
 *
 * 用法：
 *   npm run mp:dev              # 单机模式，端口 5178
 *   npm run mp:dev -- --multi   # 多用户模式（要注册/登录，验证账号隔离用）
 *   npm run mp:dev -- --port 6000
 *
 * 只起后端，不起网站前端（网站要一起看就另开 `npm run dev`）。
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
/**
 * 主线工程 = **Taro**（`taro/`），产物在 `taro/dist/`。
 * `miniprogram/` 是迁移前的原生工程，留作回退，不再是默认联调目标。
 */
const MP = join(ROOT, 'taro')

/* ------------------------------ 命令行参数 ------------------------------ */

const argv = process.argv.slice(2)
const hasFlag = (name) => argv.includes('--' + name)
const flagValue = (name, fallback) => {
  const i = argv.indexOf('--' + name)
  if (i === -1) return fallback
  const v = argv[i + 1]
  return v && !v.startsWith('--') ? v : fallback
}

const PORT = Number(flagValue('port', process.env.PORT ?? 5178))
const MULTI = hasFlag('multi')
const NO_BUILD = hasFlag('no-build')

/* ------------------------------ 小工具 ------------------------------ */

const ok = (s) => '\x1b[32m' + s + '\x1b[0m'
const dim = (s) => '\x1b[2m' + s + '\x1b[0m'
const bold = (s) => '\x1b[1m' + s + '\x1b[0m'

/** 本机局域网 IPv4（真机预览要填这个） */
function lanAddresses() {
  const out = []
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal) out.push({ name, address: item.address })
    }
  }
  // 虚拟网卡（VPN / 虚拟机 / 容器）手机连不上，只作备选、不排第一
  const isVirtual = (n) => /^(utun|bridge|vbox|vmnet|docker|tun|tap|awdl|llw)/i.test(n)
  const rank = (n) => (isVirtual(n) ? 2 : /^(en|eth|wlan|wl|Wi-?Fi)/i.test(n) ? 0 : 1)
  return out.map((x) => ({ ...x, virtual: isVirtual(x.name) })).sort((a, b) => rank(a.name) - rank(b.name))
}

async function waitHealth(base, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(base + '/api/health')
      if (r.ok) return await r.json()
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  return null
}

/**
 * Taro 工程用 alias 直接编译 `../src/domain` 源码，**不需要** `build:core` 的 CommonJS 产物；
 * 但需要 `taro/dist/` —— 开发者工具导入的是产物目录，不是源码目录。
 * 产物缺失时自动跑一次 `taro build --type weapp`。
 */
const DIST = join(MP, 'dist')
const distReady = existsSync(join(DIST, 'app.json')) && existsSync(join(DIST, 'pages/visit/index.js'))

if (!distReady && !NO_BUILD) {
  console.log('小程序产物还没构建，先跑 taro build ……')
  const r = spawn('npm', ['run', 'mp:taro:build'], { cwd: ROOT, stdio: 'inherit' })
  await new Promise((res, rej) => r.on('exit', (code) => (code === 0) ? res() : rej(new Error('mp:taro:build 失败'))))
} else if (!distReady) {
  console.log('⚠️  taro/dist 不存在且指定了 --no-build：开发者工具会白屏，先跑一次 npm run mp:taro:build')
}

/* ------------------------------ 2. 起后端 ------------------------------ */

/**
 * 本地凭据：`.secrets/server.env`（KEY=VALUE，gitignore）
 * 里面是 WX_APPID / WX_APPSECRET —— 微信登录要服务端拿 code 换 openid。
 * 没这份文件也能跑：小程序会退回「账号密码登录」，只是微信免登不能用。
 */
function loadLocalEnv() {
  const file = join(ROOT, '.secrets/server.env')
  if (!existsSync(file)) return {}
  const out = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

const localEnv = loadLocalEnv()

const env = {
  ...localEnv,
  ...process.env,
  // 统一用 PULSE_WX_*（跟云函数一致 —— `WX_` 前缀在 CloudBase 运行时会被平台盖掉）。
  // 服务端仍然兜底读 WX_*，所以老写法也不会坏。
  PULSE_WX_APPID: process.env.PULSE_WX_APPID || localEnv.WX_APPID || '',
  PULSE_WX_APPSECRET: process.env.PULSE_WX_APPSECRET || localEnv.WX_APPSECRET || '',
  PORT: String(PORT),
  // 真机预览时手机要连电脑的局域网 IP —— 服务必须监听 0.0.0.0，
  // 只听 127.0.0.1 的话手机一定连不上（这是最常见的「本机行、手机不行」）。
  HOST: process.env.HOST ?? '0.0.0.0',
  PULSE_SINGLE_USER: MULTI ? '0' : '1',
}

const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: ROOT,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let serverLog = ''
const pipe = (stream) => {
  stream.setEncoding('utf8')
  stream.on('data', (d) => {
    serverLog += d
    process.stdout.write(dim(d))
  })
}
pipe(server.stdout)
pipe(server.stderr)

const base = 'http://127.0.0.1:' + PORT
const health = await waitHealth(base)
if (!health) {
  console.error('\n后端没能起来。日志：\n' + serverLog)
  server.kill('SIGTERM')
  process.exit(1)
}

/* ------------------------------ 3. 联调清单 ------------------------------ */

const lans = lanAddresses()
// 真机要填的是真实网卡地址；VPN/虚拟网卡的网段手机连不上
const realLans = lans.filter((x) => !x.virtual)
const lanUrl = realLans.length ? 'http://' + realLans[0].address + ':' + PORT : null
const line = (s = '') => process.stdout.write(s + '\n')

line()
line(bold('臧氏脉学 · 小程序本机联调'))
line('─'.repeat(52))
line('后端   ' + ok(base) + '   ' + (MULTI ? '多用户模式（需注册/登录）' : '单机模式（不用登录）'))
line('数据库 ' + (health.db || '(未知)'))
line(
  '微信   ' +
    (env.WX_APPID && env.WX_APPSECRET
      ? '已配置 AppID ' + env.WX_APPID + '（凭据来自 .secrets/server.env，不进版本库）'
      : '未配置 → 小程序里只能用「账号密码」登录（微信免登不可用）'),
)
line('工程   ' + MP + '   （Taro 主线；产物在 taro/dist/）')
line()
line(bold('微信开发者工具'))
line('  1. 导入项目，目录选  ' + ok(join(MP, 'dist')) + '   <- 选 dist，不是 taro/ 根目录')
line('     （project.config.json 里 miniprogramRoot=dist/，选根目录也能跑，但选 dist 更直观）')
line('  2. AppID 填  wx3a21eb903a16cbc4')
line('  3. 详情 → 本地设置 → 勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」')
line('  4. 「我的」页 → 服务器地址填  ' + ok(base) + '  → 保存')
line('     应显示「连接正常（' + (MULTI ? '多用户模式，需要登录' : '单机模式，不用登录') + '）」')
line()
if (lanUrl) {
  line(bold('真机预览（手机）'))
  line('  手机与电脑连同一个 Wi-Fi；「我的」页服务器地址改成：')
  line('    ' + ok(lanUrl))
  for (const { name, address } of realLans.slice(1, 4)) {
    line('    ' + dim('备选 ' + address + '（' + name + '）'))
  }
  line('  电脑防火墙放行 ' + PORT + ' 端口；预览后右上「…」→ 打开调试')
  line('  ' + dim('（后端已监听 0.0.0.0，手机才能连上；只听 127.0.0.1 的话手机一定连不上）'))
} else {
  line(bold('真机预览（手机）'))
  line('  没探测到局域网 IP —— 电脑可能没连 Wi-Fi／网线' + (lans.length ? '（只有虚拟网卡）' : ''))
}
line()
if (MULTI) {
  line('多用户模式：先在登录页「注册」一个账号，再进「病例」。')
} else {
  line('单机模式：不用登录，直接进「病例」建患者、录脉。')
}
line()
line(dim('不依赖开发者工具的自动化验证：'))
line(dim('  npm run test:e2e:mp      静态检查（WXML/事件/require）'))
line(dim('  npm run test:e2e:mp:api  数据层端到端（真跑 utils/*.js 连这个后端）'))
line()
line(dim('按 Ctrl+C 停止后端。'))

/* ------------------------------ 收尾 ------------------------------ */

let closing = false
function shutdown() {
  if (closing) return
  closing = true
  server.kill('SIGTERM')
  setTimeout(() => process.exit(0), 200)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
server.on('exit', (code) => {
  if (!closing) {
    line('\n后端退出了（code ' + code + '）。')
    process.exit(code ?? 0)
  }
})
