/**
 * P0 探测 —— Electron 内置的 Node 里 `node:sqlite` 到底能不能用
 *
 * 背景（docs/desktop-plan.md §2.1 / 风险 R1）：
 *   `node:sqlite` 是 Node 内置模块 → 打包时**没有 .node 原生文件** → 不用 electron-rebuild、
 *   不用 VS Build Tools。但「Electron 35 对应 Node 22.5+」是第三方结论，
 *   本项目必须自己跑一遍 —— 这个脚本就是那把尺子。
 *
 * 跑法：
 *   node scripts/e2e/electron-probe.mjs
 *
 * 判定：
 *   - 本脚本在**普通 Node** 下跑 → 打印 baseline（对照）
 *   - 用 `ELECTRON_RUN_AS_NODE=1` 起 Electron 再跑 → 打印 electron 结果
 *   两次结果一致 → 架构成立；Electron 侧失败 → 方案 §9 的 R1 触发，退回 better-sqlite3
 *
 * 退出码：0＝通过；1＝探测失败。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 本文件是 ESM，但要用同步的 require 取 node:sqlite（探测要能第一时间抛错） */
const require = createRequire(import.meta.url)

/* ---------- 探针本体：在目标运行时里执行 ---------- */

/**
 * 在当前运行时里真刀真枪跑一遍 SQLite。
 * 返回一段可比较的结果摘要。
 */
function probe() {
  const out = { runtime: process.versions.node, electron: process.versions.electron ?? null }
  try {
    const { DatabaseSync } = require('node:sqlite')
    const { mkdtempSync, rmSync } = require('node:fs')
    const { tmpdir } = require('node:os')
    const { join } = require('node:path')
    // 用**文件库**而不是 :memory: —— 本项目开 WAL，内存库压根不走 WAL，测了等于没测
    const dir = mkdtempSync(join(tmpdir(), 'pulse-probe-'))
    const db = new DatabaseSync(join(dir, 'probe.sqlite'))
    out.sqliteVersion = db.prepare('select sqlite_version() as v').get().v

    // 建表 + 插入 + 查回
    db.exec('create table t(id integer primary key, name text)')
    const ins = db.prepare('insert into t(name) values (?)')
    ins.run('臧氏脉学')
    ins.run('第二行')
    out.rows = db.prepare('select count(*) as c from t').get().c
    out.named = db.prepare('select name from t where id = ?').get(1).name

    // 外键
    db.exec('pragma foreign_keys = ON')
    out.foreignKeys = db.prepare('pragma foreign_keys').get().foreign_keys === 1

    // 事务回滚
    db.exec('create table u(a text)')
    db.exec('begin')
    db.prepare('insert into u values (?)').run('x')
    db.exec('rollback')
    out.rollbackWorks = db.prepare('select count(*) as c from u').get().c === 0

    // WAL 能力（本项目开 WAL）
    db.exec('pragma journal_mode = WAL')
    out.wal = db.prepare('pragma journal_mode').get().journal_mode

    db.close()
    rmSync(dir, { recursive: true, force: true })
    out.ok = true
  } catch (err) {
    out.ok = false
    out.error = String(err?.message ?? err)
  }
  return out
}

/* ---------- 怎么把自己交给另一个运行时 ---------- */

// 探针要能在普通 node 与 ELECTRON_RUN_AS_NODE 两种模式下跑：
//   普通 node  → 直接执行下面的逻辑
//   Electron   → ELECTRON_RUN_AS_NODE=1 electron.exe <本文件> --probe-only
const probeOnly = process.argv.includes('--probe-only')

if (probeOnly) {
  const result = probe()
  console.log(JSON.stringify(result))
  process.exit(result.ok ? 0 : 1)
}

/* ---------- 驱动：先跑普通 node，再跑 Electron ---------- */

const results = { node: null, electron: null }

// 1) baseline：普通 node
results.node = probe()
console.log('[node baseline]', JSON.stringify(results.node))

// 2) Electron：ELECTRON_RUN_AS_NODE=1 时 electron.exe 就是 node
const electronExe = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const electronExeMac = join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
const versionFile = join(ROOT, 'node_modules', 'electron', 'dist', 'version')
const electronVersion = existsSync(versionFile) ? readFileSync(versionFile, 'utf8').trim() : 'unknown'
console.log(`[electron] 版本 ${electronVersion}`)

let exe = null
if (existsSync(electronExe)) exe = electronExe
else if (existsSync(electronExeMac)) exe = electronExeMac

if (!exe) {
  console.log('[electron] 没装 electron（或不是官方布局）→ 跳过 Electron 侧探测')
} else {
  const r = spawnSync(exe, [join(ROOT, 'scripts', 'e2e', 'electron-probe.mjs'), '--probe-only'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
  })
  const line = (r.stdout ?? '').trim().split('\n').filter(Boolean).pop()
  try {
    results.electron = JSON.parse(line)
  } catch {
    results.electron = { ok: false, error: ' Electron 侧没有输出 JSON', stdout: r.stdout, stderr: r.stderr }
  }
  console.log('[electron probe]', JSON.stringify(results.electron))
}

/* ---------- 判定 ---------- */

const e = results.electron
if (!e) {
  console.log('\n结论：Electron 未安装 → 只拿到 node baseline，未完成 P0 探测。')
  process.exit(1)
}
if (!e.ok) {
  console.log(`\n❌ P0 探测失败：${e.error}\n   → 触发方案 §9 风险 R1，需退回 better-sqlite3（或换 Electron 版本）后再继续。`)
  process.exit(1)
}

const n = results.node
const same = e.rows === n.rows && e.named === n.named && e.rollbackWorks === n.rollbackWorks
console.log(
  `\n✅ P0 探测通过：Electron ${electronVersion} 内置 Node ${e.runtime}，` +
    `node:sqlite ${e.sqliteVersion} 可用（${e.rows} 行读回 / 回滚 ${e.rollbackWorks} / WAL ${e.wal} / 外键 ${e.foreignKeys}）` +
    (same ? '，与普通 Node 行为一致。' : '；⚠️ 与普通 Node 行为有差异，需人工确认。'),
)
process.exit(0)
