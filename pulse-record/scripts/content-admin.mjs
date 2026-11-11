#!/usr/bin/env node
/**
 * 本地后台（Directus）容器 —— 启停与状态
 *
 * ## 用法
 *
 *     node scripts/content-admin.mjs up       # 起后台（自动拉镜像、挂载内容库）
 *     node scripts/content-admin.mjs down     # 停后台
 *     node scripts/content-admin.mjs status   # 看状态
 *     node scripts/content-admin.mjs reset    # 推倒重来（删容器＋删本地库＋重建）
 *
 * ## 它管什么
 *
 * · **容器**：`pulse-directus`，把 `local-data/` 挂到容器 `/data`
 * · **内容库**：`local-data/content.sqlite`（宿主机上就是编辑面，容器里后台连它）
 *
 * ## ⭐ 两条实测得来的硬约束（别改）
 *
 * ① **挂载点必须是 `/data`，不能是 `/directus`**
 *    镜像里的 Directus 应用本体就装在 `/directus`，
 *    挂到那儿会把应用目录整个盖掉 → 容器起来就报
 *    `Cannot find module '/directus/docker-entrypoint.cjs'`。
 *
 * ② **内容库必须是 DELETE 日志模式，不能是 WAL**
 *    宿主机脚本与容器里的 Directus 是**两个 SQLite 实例**，
 *    WAL 模式下宿主机连接一关就会 checkpoint ＋ unlink 掉 `-wal`／`-shm`，
 *    容器里 Directus 仍握着已删除 inode 的 fd ⇒ **它的写入全部凭空消失**
 *    （API 返回成功，文件却纹丝不动 —— 实测踩过）。
 *    ⇒ 内容库统一用 `journal_mode = DELETE`（见 `scripts/lib/content-db.mjs`）。
 *
 * ⚠️ **业务库（`server/db.mjs`）仍用 WAL** —— 那是另一份库、另一种访问模式，别照抄。
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { ROOT } from './lib/content-schema.mjs'
import { defaultDbPath } from './lib/content-db.mjs'

const CONTAINER = 'pulse-directus'
const IMAGE = 'directus/directus:12.6.1'
const PORT = 8055
const ADMIN_EMAIL = process.env.PULSE_ADMIN_EMAIL || 'admin@example.com'
const ADMIN_PASSWORD = process.env.PULSE_ADMIN_PASSWORD || 'PulseLocal2026'

const CMD = process.argv[2] || 'status'

/* ------------------------------------------------------------------ *
 * docker
 * ------------------------------------------------------------------ */

function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function dockerTry(...args) {
  try {
    return { ok: true, out: docker(...args) }
  } catch (err) {
    return { ok: false, out: `${err.stdout || ''}${err.stderr || ''}` }
  }
}

/** 容器在不在、在跑没有 */
function containerState() {
  const r = dockerTry('ps', '-a', '--filter', `name=^${CONTAINER}$`, '--format', '{{.Status}}')
  if (!r.ok) return 'missing'
  const s = r.out.trim()
  if (!s) return 'missing'
  return s.startsWith('Up') ? 'up' : 'stopped'
}

/* ------------------------------------------------------------------ *
 * 子命令
 * ------------------------------------------------------------------ */

async function up() {
  const state = containerState()
  if (state === 'up') {
    console.log(`✅ ${CONTAINER} 已在跑 → http://localhost:${PORT}/admin`)
    return
  }
  if (state === 'stopped') docker('rm', '-f', CONTAINER)

  const localData = join(ROOT, 'local-data')
  if (!existsSync(join(localData, 'content.sqlite'))) {
    console.log('本地内容库还没有，先灌一份：')
    console.log('  node scripts/content-seed.mjs')
  }

  console.log(`拉镜像 ${IMAGE}（首次约 1 GB）…`)
  docker('pull', IMAGE)

  docker(
    'run',
    '-d',
    '--name',
    CONTAINER,
    '-p',
    `${PORT}:${PORT}`,
    // ⚠️ 挂载点必须是 /data —— 见文件头「硬约束①」
    '-v',
    `${localData}:/data`,
    '-e',
    'DB_CLIENT=sqlite3',
    '-e',
    'DB_FILENAME=/data/content.sqlite',
    '-e',
    `ADMIN_EMAIL=${ADMIN_EMAIL}`,
    '-e',
    `ADMIN_PASSWORD=${ADMIN_PASSWORD}`,
    '-e',
    'KEY=pulse-local-content-key-2026',
    '-e',
    'SECRET=pulse-local-content-secret-2026',
    '-e',
    'TELEMETRY=false',
    '-e',
    'CACHE_ENABLED=false',
    IMAGE,
  )

  console.log('等后台就绪…')
  const started = Date.now()
  for (let i = 0; i < 120; i++) {
    // ⚠️ 判据用 `/server/ping`（公开端点）。
    //    `/server/health` 在 Directus 12 要鉴权，未登录会回 403 ——
    //    用 curl 不加 -f 时 403 也算「退出码 0」，会把 403 误判成「已就绪」。
    try {
      const res = await fetch(`http://localhost:${PORT}/server/ping`)
      if (res.ok && (await res.text()).includes('pong')) {
        console.log(`✅ 就绪（${((Date.now() - started) / 1000).toFixed(1)} s）→ http://localhost:${PORT}/admin`)
        console.log(`   账号：${ADMIN_EMAIL}　密码：${ADMIN_PASSWORD}`)
        console.log('   下一步：node scripts/content-admin-init.mjs   # 配关系与视图')
        return
      }
    } catch {
      /* 还没起来，继续等 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  console.error('❌ 120 秒内没就绪，看日志：docker logs ' + CONTAINER)
  process.exitCode = 1
}

function down() {
  const state = containerState()
  if (state === 'missing') {
    console.log(`${CONTAINER} 本来就没起`)
    return
  }
  docker('rm', '-f', CONTAINER)
  console.log(`✅ ${CONTAINER} 已停`)
}

function status() {
  const state = containerState()
  const db = defaultDbPath()
  console.log(`容器：${CONTAINER} → ${state}`)
  console.log(`内容库：${db}${existsSync(db) ? '' : '（还没有）'}`)
  if (state === 'up') {
    const mem = dockerTry('stats', CONTAINER, '--no-stream', '--format', '{{.MemUsage}}')
    if (mem.ok) console.log(`内存：${mem.out.trim()}`)
    console.log(`后台：http://localhost:${PORT}/admin`)
  }
}

async function reset() {
  down()
  console.log('删掉本地内容库，重新灌…')
  const db = defaultDbPath()
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const p = `${db}${suffix}`
    if (existsSync(p)) {
      execFileSync('/Users/applemima1111/.minimax/bin/mavis-trash', ['--', p], { stdio: 'ignore' })
    }
  }
  execFileSync('node', [join(ROOT, 'scripts', 'content-seed.mjs')], { stdio: 'inherit' })
  await up()
}

const table = { up, down, status, reset }
const fn = table[CMD]
if (!fn) {
  console.error(`用法：node scripts/content-admin.mjs [up|down|status|reset]`)
  process.exit(1)
}
await fn()
