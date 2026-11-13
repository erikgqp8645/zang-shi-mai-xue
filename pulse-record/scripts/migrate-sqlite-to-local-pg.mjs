#!/usr/bin/env node
/**
 * 把 SQLite 病例库搬到**自建／本地 PostgreSQL**（2026-11-13 起）
 *
 * ## 与 `migrate-sqlite-to-pg.mjs` 的关系
 *
 * 那个脚本走 **CloudBase**：用 `pg-admin`（TC3 CAPI）部署迁移函数、用 `rpc()` 搬数据。
 * 这个脚本走 **TCP 直连**（`PULSE_PG_URL`），给「先在自有服务器上用 PG、
 * 之后再整体切到 CloudBase」这条路线用。
 *
 * 两者的**目标表与语义完全一致**；只是传输层不同。
 * 数据本身仍是原 id、原 owner —— PG 是空库，不需要做「同登录名账号重映射」。
 *
 * ## 用法
 *
 * ```bash
 * # 先备份 SQLite（生产库！）
 * sqlite3 /var/lib/pulse-record/history.sqlite ".backup /tmp/history-backup.sqlite"
 *
 * PULSE_PG_URL='postgres://pulse:…@127.0.0.1:5432/pulse_record' \
 *   node scripts/migrate-sqlite-to-local-pg.mjs --sqlite /var/lib/pulse-record/history.sqlite --dry-run
 *
 * # 去掉 --dry-run 真正搬
 * ```
 *
 * ## 安全
 *
 * · **只读**打开 SQLite（`readOnly: true`）—— 搬完源库原样不动，随时能退回。
 * · 目标表用 `ON CONFLICT DO NOTHING` ⇒ 可重复执行，不会翻倍。
 * · `--dry-run` 只打印「每张表要搬多少行」，不写 PG。
 * · 搬完逐表比对行数，对不上就报错（不静默成功）。
 */

import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/* ------------------------------ 参数 ------------------------------ */

function parseArgs(argv) {
  const args = { dryRun: false, sqlite: join(ROOT, 'local-data', 'history.sqlite') }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--sqlite') args.sqlite = resolve(argv[++i] ?? '')
    else if (a === '--help' || a === '-h') {
      console.log(`用法：node scripts/migrate-sqlite-to-local-pg.mjs [选项]

  --sqlite <路径>   SQLite 源库（默认 local-data/history.sqlite）
  --dry-run         只打印计划，不写 PG

环境变量：PULSE_PG_URL（必填），形如 postgres://user:pass@127.0.0.1:5432/pulse_record
`)
      process.exit(0)
    } else {
      console.error(`不认识的参数：${a}`)
      process.exit(2)
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const PG_URL = process.env.PULSE_PG_URL

if (!PG_URL) {
  console.error('缺少 PULSE_PG_URL（如 postgres://pulse:***@127.0.0.1:5432/pulse_record）')
  process.exit(2)
}
if (!existsSync(args.sqlite)) {
  console.error(`找不到 SQLite 文件：${args.sqlite}`)
  process.exit(2)
}

/* --------------------------- 表与列定义 --------------------------- */

/**
 * 搬运顺序**按外键依赖**：users → identities → sessions → patients → visits
 * → medication → custom_symbols → library_items → formula_patterns。
 *
 * `json` 列在 SQLite 里是 TEXT、在 PG 里是 jsonb —— 传字符串，由 ::jsonb 转换。
 */
const TABLES = [
  {
    name: 'users',
    keys: ['id', 'login_name', 'display_name', 'phone', 'password_hash', 'password_salt', 'role', 'created_at', 'updated_at'],
  },
  {
    name: 'identities',
    keys: ['id', 'user_id', 'provider', 'external_id', 'union_id', 'created_at'],
  },
  {
    name: 'sessions',
    keys: ['token', 'user_id', 'created_at', 'expires_at', 'last_seen_at', 'user_agent'],
  },
  {
    name: 'patients',
    keys: ['id', 'owner_id', 'name', 'layout', 'created_at', 'updated_at'],
  },
  {
    name: 'visits',
    keys: ['id', 'patient_id', 'owner_id', 'label', 'at', 'pulse_values', 'seq', 'constitution', 'therapy'],
  },
  {
    name: 'medication',
    keys: ['id', 'patient_id', 'visit_id', 'owner_id', 'seq', 'name', 'pulse', 'symbols', 'adjust', 'usage', 'note', 'created_at'],
  },
  {
    name: 'custom_symbols',
    keys: ['code', 'owner_id', 'name', 'created_at'],
  },
  {
    name: 'library_items',
    keys: ['kind', 'item_id', 'payload', 'deleted', 'updated_at', 'updated_by', 'note'],
    jsonb: ['payload'],
  },
  {
    name: 'formula_patterns',
    keys: ['owner_id', 'formula_id', 'seq', 'payload', 'updated_at'],
    jsonb: ['payload'],
  },
]

/* ----------------------------- 读 SQLite ----------------------------- */

function readSqlite(path) {
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(path, { readOnly: true })
  const out = {}
  for (const t of TABLES) {
    try {
      out[t.name] = db.prepare(`SELECT * FROM ${t.name}`).all()
    } catch (e) {
      // 老库可能还没有某张表（例如 content 相关）—— 跳过并说明
      console.warn(`  ⚠ SQLite 里没有表 ${t.name}：${e?.message ?? e}`)
      out[t.name] = []
    }
  }
  db.close()
  return out
}

/* ------------------------------ 主流程 ------------------------------ */

const src = readSqlite(args.sqlite)

console.log(`源库：${args.sqlite}`)
console.log('计划：')
for (const t of TABLES) console.log(`  ${t.name.padEnd(17)} ${src[t.name].length} 行`)

if (args.dryRun) {
  console.log('\n（--dry-run：没有写 PG）')
  process.exit(0)
}

let pg
try {
  pg = (await import('pg')).default ?? (await import('pg'))
} catch {
  console.error('没装 pg 驱动 —— 请先 npm install pg')
  process.exit(2)
}

const pool = new pg.Pool({ connectionString: PG_URL, max: 4 })

try {
  // 整批搬：一次事务，要么全进要么全不进
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    for (const t of TABLES) {
      const rows = src[t.name]
      if (rows.length === 0) continue

      const jsonSet = new Set(t.jsonb ?? [])
      // 列名来自上面的常量（不是用户输入），直接拼是安全的
      const cols = t.keys.join(', ')
      const placeholders = t.keys
        .map((k, i) => (jsonSet.has(k) ? `$${i + 1}::jsonb` : `$${i + 1}`))
        .join(', ')
      const sql = `INSERT INTO ${t.name} (${cols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`

      for (const row of rows) {
        const values = t.keys.map((k) => {
          const v = row[k]
          if (jsonSet.has(k)) {
            // SQLite 存的是字符串；jsonb 参数要字符串
            return typeof v === 'string' ? v : JSON.stringify(v ?? {})
          }
          return v === undefined ? null : v
        })
        await client.query(sql, values)
      }
      console.log(`  ✓ ${t.name}：${rows.length} 行`)
    }

    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }

  // ---- 行数核对：源 vs 目标 ----
  console.log('\n行数核对：')
  let bad = 0
  for (const t of TABLES) {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${t.name}`)
    const n = rows[0].n
    const same = n === src[t.name].length
    if (!same) bad++
    console.log(`  ${same ? '✓' : '✗'} ${t.name.padEnd(17)} 源 ${src[t.name].length} → PG ${n}`)
  }

  if (bad > 0) {
    console.error(`\n✗ 有 ${bad} 张表行数对不上 —— 请检查后再切换。`)
    process.exit(1)
  }

  console.log('\n✓ 迁移完成，行数全部一致。')
  console.log('  下一步：把 PULSE_STORE=pg 与 PULSE_PG_URL 写进服务环境变量，重启服务。')
  console.log('  ⚠️ SQLite 源库没有被改动，随时可以退回去。')
} finally {
  await pool.end()
}
