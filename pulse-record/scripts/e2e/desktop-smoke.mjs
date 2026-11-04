#!/usr/bin/env node
/**
 * 桌面端回归 —— **不依赖 Electron、不依赖 Chrome**，只依赖 Node。
 *
 * 验的是「桌面壳底下那条链」：desktop/server-entry.mjs 能起服务、
 * 单机免登录链路通、静态页面托管正常、数据落在指定的库里、导出/导入往返正常。
 * 桌面壳（Electron 主进程／窗口／另存为）另有 `scripts/e2e/electron-probe.mjs`
 * 与人工验收。
 *
 * 用法：node scripts/e2e/desktop-smoke.mjs
 */

import { fork } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = join(import.meta.dirname, '..', '..')
const DIST = join(ROOT, 'dist')

let pass = 0
let fail = 0
const failures = []

function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ' —— ' + detail : ''}`)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ */
/* 起子进程                                                            */
/* ------------------------------------------------------------------ */

const dir = mkdtempSync(join(tmpdir(), 'pulse-desktop-'))
const DB = join(dir, 'history.sqlite')

const child = fork(join(ROOT, 'desktop', 'server-entry.mjs'), [], {
  cwd: ROOT,
  env: {
    ...process.env,
    PULSE_SINGLE_USER: '1',
    PULSE_DB: DB,
    PULSE_DIST: DIST,
  },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
})

const logs = []
child.stdout?.on('data', (d) => logs.push(String(d)))
child.stderr?.on('data', (d) => logs.push(String(d)))

/** 父进程 → 子进程的请求（导出／导入），跟 Electron 主进程用的是同一套协议 */
let reqSeq = 0
const pending = new Map()
function ask(action, payload) {
  const id = `r${++reqSeq}`
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    child.send({ type: 'req', id, action, payload })
  })
}

/** 等子进程报端口 */
function waitListening(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('子进程没在超时内报端口')), timeoutMs)
    child.on('message', (msg) => {
      if (msg?.type === 'listening') {
        clearTimeout(timer)
        resolve(msg.port)
      } else if (msg?.type === 'result') {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          if (msg.ok) p.resolve(msg.data)
          else p.reject(new Error(msg.error ?? '未知错误'))
        }
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`子进程提前退出（code=${code}）：\n${logs.join('')}`))
    })
  })
}

const base = (port, p) => `http://127.0.0.1:${port}${p}`

async function api(port, p, options = {}) {
  const res = await fetch(base(port, p), {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* 静态页不是 JSON */
  }
  return { status: res.status, text, json }
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

console.log('\n桌面端回归（不依赖 Electron／Chrome）\n')

let port = 0
try {
  port = await waitListening()

  /* --- 1. 子进程报端口 --- */
  check('子进程回报端口', port > 0, `port=${port}`)

  /* --- 2. 健康检查 --- */
  const health = await api(port, '/api/health')
  check('GET /api/health → 200', health.status === 200, `实际 ${health.status}`)
  check('健康检查 ok=true', health.json?.ok === true)
  check('模式是 single（免登录）', health.json?.mode === 'single', `mode=${health.json?.mode}`)
  check('健康检查里的库路径就是指定的临时库', health.json?.db === DB, `db=${health.json?.db}`)

  /* --- 3. 静态页面托管 --- */
  const home = await api(port, '/')
  check('GET / → 200', home.status === 200, `实际 ${home.status}`)
  check('首页是本工具的页面', home.text.includes('脉象记录表'), 'HTML 里没找到应用标题')
  check('页面引用了构建产物', /<script[^>]+src="[^"]+\.js"/.test(home.text), '没找到 script 标签')

  /* --- 4. 单机免登录链路 --- */
  const created = await api(port, '/api/patients', {
    method: 'POST',
    body: {
      name: '桌面端冒烟',
      layout: 'nine',
      visits: [{ id: 'v-smoke-1', label: '11月4日', at: Date.now(), values: { 'L|寸|浮': ['+'] } }],
    },
  })
  check('POST /api/patients → 200（免登录直接能存）', created.status === 200, `实际 ${created.status}`)
  check('存进去的是刚才那位患者', created.json?.patient?.name === '桌面端冒烟')

  const list = await api(port, '/api/patients')
  check('GET /api/patients → 200', list.status === 200, `实际 ${list.status}`)
  check('列表里能读回那位患者', (list.json?.patients ?? []).some((p) => p.name === '桌面端冒烟'))

  const reg = await api(port, '/api/auth/register', {
    method: 'POST',
    body: { loginName: 'someone', password: 'x'.repeat(8) },
  })
  check('单机模式下注册被拒（409）', reg.status === 409, `实际 ${reg.status}`)

  /* --- 5. 导出快照 --- */
  const snapshot = join(dir, 'snapshot.sqlite')
  const exported = await ask('export-db', { target: snapshot })
  check('导出数据文件成功', exported?.path === snapshot, JSON.stringify(exported))
  check('导出的快照真的落盘了', existsSync(snapshot))
  check('快照是 SQLite 文件（头 16 字节是 SQLite 格式）', readFileSync(snapshot).subarray(0, 15).toString() === 'SQLite format 3')

  /* --- 6. 导入（幂等：同一份再导一次不会翻倍） --- */
  const imported = await ask('import-db', { source: snapshot })
  check('导入数据文件成功', !!imported, JSON.stringify(imported))
  check('重复导入不新增行（幂等）', (imported?.patients?.imported ?? 0) === 0, JSON.stringify(imported?.patients))

  const list2 = await api(port, '/api/patients')
  check('导入后患者数没有翻倍', (list2.json?.patients ?? []).length === (list.json?.patients ?? []).length)

  /* --- 6b. 老数据带入：别的账号名下的数据，导入后要挂到本机账号名下 --- */
  // 这是桌面版最容易踩的坑（docs/desktop-plan.md §5.3）：
  // owner_id 是归属列，桌面版（单机免登录）只认内置 local 账号，
  // 原样拷贝过来的库在桌面端是「一条也看不到」。
  const otherDbPath = join(dir, 'other-account.sqlite')
  process.env.PULSE_DB = otherDbPath
  const { openDb } = await import(pathToFileURL(join(ROOT, 'server/db.mjs')).href + `?t=${Date.now()}`)
  const sdb = openDb()
  try {
    const now = Date.now()
    const otherId = 'u-other-test'
    sdb
      .prepare(
        `INSERT INTO users (id, login_name, display_name, phone, password_hash, password_salt, role, created_at, updated_at)
         VALUES (?, ?, ?, NULL, '', '', 'user', ?, ?)`,
      )
      .run(otherId, 'otherguy', '别的账号', now, now)
    sdb
      .prepare(
        `INSERT INTO patients (id, owner_id, name, layout, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('p-other-1', otherId, '别人的患者', 'nine', now, now)
    sdb
      .prepare(
        `INSERT INTO visits (id, patient_id, owner_id, label, at, pulse_values, seq, constitution, therapy)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .run('v-other-1', 'p-other-1', otherId, '11月3日', now, '{}', 0)
  } finally {
    sdb.close()
  }

  const imported2 = await ask('import-db', { source: otherDbPath })
  check('导入别的账号名下的患者', imported2?.patients?.imported === 1, JSON.stringify(imported2?.patients))
  check('导入别的账号名下的就诊记录', imported2?.visits?.imported === 1, JSON.stringify(imported2?.visits))
  const list3 = await api(port, '/api/patients')
  check(
    '导入的病例在本机账号名下看得见（owner 归属已改挂）',
    (list3.json?.patients ?? []).some((p) => p.name === '别人的患者'),
    JSON.stringify((list3.json?.patients ?? []).map((p) => p.name)),
  )

  /* --- 7. 数据落在临时目录 --- */
  check('库文件落在指定的临时目录', existsSync(DB), DB)
} catch (err) {
  fail++
  failures.push(`整体流程：${err?.message ?? err}`)
  console.error('\n桌面端回归中断：', err)
  console.error('子进程输出：\n' + logs.join(''))
}

child.kill()

await sleep(300)

/* --- 8. 退出后库文件还在 --- */
check('子进程退出后库文件仍在（数据没丢）', existsSync(DB))

console.log(`\n共 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`)
if (failures.length) {
  console.log('失败项：')
  for (const f of failures) console.log('  · ' + f)
}

rmSync(dir, { recursive: true, force: true })
process.exit(fail === 0 ? 0 : 1)
