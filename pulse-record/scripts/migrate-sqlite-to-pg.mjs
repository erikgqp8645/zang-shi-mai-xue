#!/usr/bin/env node
/**
 * 一次性数据迁移：本地 SQLite → CloudBase PostgreSQL
 *
 * ## 干什么
 *
 * 把一个 SQLite 库（默认 `local-data/history.sqlite`）里的账号、患者、就诊、
 * 用药、自定义符号搬进 CloudBase PG。**id 原样保留** —— 搬完两端看到的是同一批记录。
 *
 * ## 怎么跑
 *
 *     export TCLOUD_SECRET_ID=...
 *     export TCLOUD_SECRET_KEY=...
 *     export TCLOUD_SESSION_TOKEN=...      # 用临时凭证时带上
 *     export PULSE_ENV_ID=pulse-1-d0g880ydl8ddc57f6
 *
 *     node scripts/migrate-sqlite-to-pg.mjs --dry-run     # 只看计划，不动 PG
 *     node scripts/migrate-sqlite-to-pg.mjs                # 真搬
 *     node scripts/migrate-sqlite-to-pg.mjs --drop-fn      # 撤掉迁移函数（搬完建议做）
 *
 * ## 会自动处理的两件事
 *
 * 1. **部署迁移函数**：`pulse_migrate_import` 不在 PG 里就自动从
 *    `server/pg-migrate-functions.sql` 部署过去（一次 RPC ＝ 一个事务）。
 * 2. **重映射 owner_id**：PG 里已经有同登录名的账号时（例如单机模式的 `local`），
 *    SQLite 那边同登录名的账号**不重复建**，它的数据改挂到 PG 那个账号下 ——
 *    否则外键会指向一个不存在的 user。
 *
 * ## sessions 怎么办
 *
 * 默认**照搬**：令牌与存储无关，搬过去老会话照样能用（见 docs/cloudbase-migration.md §4.3）。
 * 想跳过用 `--no-sessions`。
 *
 * **凭证只从环境变量读**，绝不写进仓库。
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

import { execSql, splitStatements } from './pg-admin.mjs'
import { rpc } from '../server/pg-client.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const require = createRequire(import.meta.url)

const ENV_ID = process.env.PULSE_ENV_ID || 'pulse-1-d0g880ydl8ddc57f6'
const MIGRATE_FN = 'pulse_migrate_import'

/* ------------------------------ 参数 ------------------------------ */

function parseArgs(argv) {
  const out = {
    sqlite: resolve(ROOT, 'local-data', 'history.sqlite'),
    dryRun: false,
    sessions: true,
    dropFn: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--dry-run') out.dryRun = true
    else if (a === '--no-sessions') out.sessions = false
    else if (a === '--drop-fn') out.dropFn = true
    else if (a === '--sqlite') out.sqlite = resolve(process.cwd(), argv[++i])
    else if (a === '--env') process.env.PULSE_ENV_ID = argv[++i]
    else if (a === '--help' || a === '-h') out.help = true
    else throw new Error(`未知参数：${a}`)
  }
  return out
}

/* ------------------------------ 小工具 ------------------------------ */

/** ExecutePGSql 返回的行可能是数组（按列序）或对象 */
function cell(row, index = 0) {
  if (Array.isArray(row)) return row[index]
  if (row && typeof row === 'object') return Object.values(row)[index]
  return row
}

function sqlText(v) {
  if (v === null || v === undefined) return 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}

/* ---------------------------- 读 SQLite ---------------------------- */

function readSqlite(path) {
  if (!existsSync(path)) throw new Error(`找不到 SQLite 文件：${path}`)
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(path, { readOnly: true })
  const all = (sql) => db.prepare(sql).all()
  const out = {
    users: all('SELECT * FROM users'),
    identities: all('SELECT * FROM identities'),
    sessions: all('SELECT * FROM sessions'),
    patients: all('SELECT * FROM patients'),
    visits: all('SELECT * FROM visits'),
    medication: all('SELECT * FROM medication'),
    custom_symbols: all('SELECT * FROM custom_symbols'),
  }
  db.close()
  return out
}

/* --------------------------- 读 PG 现状 --------------------------- */

async function readPgUsers() {
  const res = await execSql('SELECT id, login_name FROM users ORDER BY login_name')
  return res.rows.map((r) => ({
    id: String(cell(r, 0)),
    login_name: String(cell(r, 1)),
  }))
}

async function functionExists(name) {
  const res = await execSql(
    `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.proname = '${name}' AND n.nspname = 'public'`,
  )
  return Number(cell(res.rows[0], 0)) > 0
}

async function deployMigrateFn() {
  const file = resolve(ROOT, 'server', 'pg-migrate-functions.sql')
  const sql = readFileSync(file, 'utf8')
  const stmts = splitStatements(sql)
  for (const stmt of stmts) {
    const head = stmt.replace(/\s+/g, ' ').trim()
    if (!head) continue
    // PG 的硬规则：CREATE OR REPLACE 不能改返回类型 → 先 DROP 同签名旧函数
    const fn = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/i.exec(stmt)
    if (fn) {
      const types = fn[2].split(',').map((a) => a.trim().split(/\s+/).pop()).filter(Boolean).join(', ')
      await execSql(`DROP FUNCTION IF EXISTS ${fn[1]}(${types})`)
    }
    await execSql(stmt)
  }
  console.log(`  ✓ 已部署迁移函数 ${MIGRATE_FN}（${file.replace(ROOT + '/', '')}）`)
}

/* ------------------------------ 映射 ------------------------------ */

/**
 * 建「SQLite user id → PG user id」映射。
 *
 * PG 里已经有同登录名的账号 → 复用它的 id（SQLite 那边这个账号**不重复建**）。
 * 否则 → 原样用 SQLite 的 id。
 */
function buildIdMap(sqliteUsers, pgUsers) {
  const byLogin = new Map(pgUsers.map((u) => [u.login_name, u.id]))
  const map = new Map()
  const reused = []
  const fresh = []
  for (const u of sqliteUsers) {
    const pgId = byLogin.get(u.login_name)
    if (pgId) {
      map.set(u.id, pgId)
      reused.push({ login: u.login_name, from: u.id, to: pgId })
    } else {
      map.set(u.id, u.id)
      fresh.push({ login: u.login_name, id: u.id })
    }
  }
  return { map, reused, fresh }
}

const remap = (map, id) => (id === null || id === undefined ? id : (map.get(id) ?? id))

/* ------------------------------ 主流程 ------------------------------ */

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`用法：node scripts/migrate-sqlite-to-pg.mjs [选项]

  --sqlite <路径>   SQLite 源文件（默认 local-data/history.sqlite）
  --dry-run         只打印计划，不动 PG
  --no-sessions     不搬 sessions（默认照搬）
  --drop-fn         只撤掉迁移函数后退出
  --env <envId>     目标环境（默认 ${ENV_ID}）
`)
    return
  }

  if (args.dropFn) {
    await execSql(`DROP FUNCTION IF EXISTS ${MIGRATE_FN}(text, jsonb)`)
    console.log(`✓ 已撤掉迁移函数 ${MIGRATE_FN}`)
    return
  }

  console.log(`源（SQLite）：${args.sqlite}`)
  console.log(`目标（PG）  ：${ENV_ID}\n`)

  // pg-client 认的是 PULSE_CB_ENV（云函数里平台注入 TCB_ENV / SCF_NAMESPACE）
  process.env.PULSE_CB_ENV = ENV_ID

  // pg-admin 认 TCLOUD_SECRET_*，pg-client 认 TENCENTCLOUD_SECRET* —— 这里补上映射，
  // 让同一份临时凭证两边都能用（凭证仍只来自环境变量，不写进仓库）
  if (!process.env.TENCENTCLOUD_SECRETID && process.env.TCLOUD_SECRET_ID) {
    process.env.TENCENTCLOUD_SECRETID = process.env.TCLOUD_SECRET_ID
    process.env.TENCENTCLOUD_SECRETKEY = process.env.TCLOUD_SECRET_KEY
    if (process.env.TCLOUD_SESSION_TOKEN) {
      process.env.TENCENTCLOUD_SESSIONTOKEN = process.env.TCLOUD_SESSION_TOKEN
    }
  }

  const src = readSqlite(args.sqlite)
  const pgUsers = await readPgUsers()
  const { map, reused, fresh } = buildIdMap(src.users, pgUsers)

  console.log('账号映射：')
  for (const r of reused) console.log(`  · ${r.login}：PG 已有 → 复用 ${r.to}（SQLite 那个 ${r.from} 不重复建）`)
  for (const f of fresh) console.log(`  · ${f.login}：PG 没有 → 新建 ${f.id}`)
  if (!reused.length && !fresh.length) console.log('  （源里没有账号）')

  // ── 组装载荷 ──────────────────────────────────────────────────────
  const users = src.users
    .filter((u) => !reused.some((r) => r.from === u.id))
    .map((u) => ({
      id: u.id,
      login_name: u.login_name,
      display_name: u.display_name,
      phone: u.phone ?? null,
      password_hash: u.password_hash,
      password_salt: u.password_salt,
      role: u.role,
      created_at: u.created_at,
      updated_at: u.updated_at,
    }))

  const identities = src.identities.map((i) => ({
    id: i.id,
    user_id: remap(map, i.user_id),
    provider: i.provider,
    external_id: i.external_id,
    union_id: i.union_id ?? null,
    created_at: i.created_at,
  }))

  const sessions = args.sessions
    ? src.sessions.map((s) => ({
        token: s.token,
        user_id: remap(map, s.user_id),
        created_at: s.created_at,
        expires_at: s.expires_at,
        last_seen_at: s.last_seen_at,
        user_agent: s.user_agent ?? null,
      }))
    : []

  const patients = src.patients.map((p) => ({
    id: p.id,
    owner_id: remap(map, p.owner_id),
    name: p.name,
    layout: p.layout,
    created_at: p.created_at,
    updated_at: p.updated_at,
  }))

  const visits = src.visits.map((v) => ({
    id: v.id,
    patient_id: v.patient_id,
    owner_id: remap(map, v.owner_id),
    label: v.label,
    at: v.at,
    pulse_values: v.pulse_values,
    seq: v.seq,
    constitution: v.constitution ?? null,
    therapy: v.therapy ?? null,
  }))

  const medication = src.medication.map((m) => ({
    id: m.id,
    patient_id: m.patient_id,
    visit_id: m.visit_id,
    owner_id: remap(map, m.owner_id),
    seq: m.seq,
    name: m.name,
    pulse: m.pulse ?? null,
    symbols: m.symbols ?? null,
    adjust: m.adjust ?? null,
    usage: m.usage ?? null,
    note: m.note ?? null,
    created_at: m.created_at,
  }))

  const customSymbols = src.custom_symbols.map((s) => ({
    code: s.code,
    owner_id: remap(map, s.owner_id),
    name: s.name,
    created_at: s.created_at,
  }))

  const payload = {
    users,
    identities,
    sessions,
    patients,
    visits,
    medication,
    custom_symbols: customSymbols,
    ids: {
      users: users.map((u) => u.id),
      identities: identities.map((i) => i.id),
      sessions: sessions.map((s) => s.token),
      patients: patients.map((p) => p.id),
      visits: visits.map((v) => v.id),
      medication: medication.map((m) => m.id),
    },
  }

  console.log('\n计划：')
  const rows = [
    ['users', src.users.length, users.length],
    ['identities', src.identities.length, identities.length],
    ['sessions', src.sessions.length, sessions.length],
    ['patients', src.patients.length, patients.length],
    ['visits', src.visits.length, visits.length],
    ['medication', src.medication.length, medication.length],
    ['custom_symbols', src.custom_symbols.length, customSymbols.length],
  ]
  console.log('  表                 源库行数   本次写入')
  for (const [t, a, b] of rows) {
    const note = a === b ? '' : `   ← 差 ${a - b}：PG 已有同登录名的账号，复用它`
    console.log(`  ${t.padEnd(18)}${String(a).padStart(7)}${String(b).padStart(9)}${note}`)
  }

  if (args.dryRun) {
    console.log('\n--dry-run：不动 PG。去掉它就真搬。')
    return
  }

  // ── 部署迁移函数（每次都重装：drop + create，避免用到 PG 里的旧定义）──
  console.log('')
  await deployMigrateFn()

  // ── 一次 RPC ＝ 一个事务 ─────────────────────────────────────────
  console.log('\n搬数据…')
  const res = await rpc(MIGRATE_FN, { p_owner: '', p_args: payload })

  console.log('\n本次写入行数 vs 迁后 PG 里对得上的行数：')
  for (const [t] of rows) {
    const s = res.source?.[t]
    const m = res.migrated?.[t]
    const ok = s === m ? '✓' : '✗'
    console.log(`  ${ok} ${t.padEnd(18)}写入 ${String(s).padStart(4)}   迁后 ${String(m).padStart(4)}`)
  }

  console.log('\nPG 总行数（含迁之前就有的）：')
  for (const [k, v] of Object.entries(res.totals ?? {})) {
    console.log(`  · ${k.padEnd(18)}${v}`)
  }

  console.log('\n三条 owner 不变量自检（必须全为 0）：')
  let invariantOk = true
  for (const [k, v] of Object.entries(res.invariants ?? {})) {
    if (Number(v) !== 0) invariantOk = false
    console.log(`  ${Number(v) === 0 ? '✓' : '✗'} ${k.padEnd(28)}${v}`)
  }

  if (!invariantOk) {
    console.error('\n✗ 不变量没通过 —— 别急着上线，先查。')
    process.exitCode = 1
    return
  }

  // ── 独立复核（走另一条通道，不靠迁移函数自报）────────────────────
  console.log('\n独立复核（直接查 PG，不经迁移函数）：')
  const checks = [
    ['visit.owner 与 patient.owner 不一致的条数',
      'SELECT count(*) FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.owner_id <> p.owner_id'],
    ['medication.owner 与 visit.owner 不一致的条数',
      'SELECT count(*) FROM medication m JOIN visits v ON v.id = m.visit_id WHERE m.owner_id <> v.owner_id'],
    ['owner 为空的 custom_symbols 条数',
      "SELECT count(*) FROM custom_symbols WHERE owner_id IS NULL OR owner_id = ''"],
    ['owner 指向不存在账号的业务行数',
      'SELECT (SELECT count(*) FROM patients p WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.owner_id))' +
      ' + (SELECT count(*) FROM visits v WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = v.owner_id))' +
      ' + (SELECT count(*) FROM medication m WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = m.owner_id))'],
  ]
  let allOk = true
  for (const [label, sql] of checks) {
    const r = await execSql(sql)
    const n = Number(cell(r.rows[0], 0))
    if (n !== 0) allOk = false
    console.log(`  ${n === 0 ? '✓' : '✗'} ${label.padEnd(40)}${n}`)
  }

  if (!allOk) {
    console.error('\n✗ 复核没通过。')
    process.exitCode = 1
    return
  }

  console.log('\n✓ 迁移完成：不变量全 0。')
  console.log(`  提醒：搬完建议撤掉迁移函数 —— node scripts/migrate-sqlite-to-pg.mjs --drop-fn`)
}

main().catch((e) => {
  console.error(String(e?.message ?? e))
  process.exit(1)
})
