#!/usr/bin/env node
/**
 * 内容层 · 远端 PG 建表 ＋ 装函数
 *
 * ## 干什么
 *
 * 把内容层在 CloudBase PG 上的**结构**装好：
 *
 *   ① 17 张数据表  —— **由 `src/content/schema/*.schema.json` 生成**，
 *                     不手抄（手抄＝第二份真源，schema 一改就漂）
 *   ② 3 张账本表  —— `server/content-pg-meta.sql`（手写，没有对应的内容 JSON）
 *   ③ 5 个函数    —— `server/content-pg-functions.sql`
 *
 * ⭐ 三份 DDL 各有各的唯一来源，本脚本只做**组装与执行**，不新增任何一份描述。
 *
 * ## 幂等
 *
 * 建表用 `CREATE TABLE IF NOT EXISTS`；函数先 `DROP` 同签名旧函数再 `CREATE OR REPLACE`
 * （PG 不允许 `CREATE OR REPLACE` 改返回类型 ⇒ 换签名时必须先 DROP）。
 * 所以这个脚本可以反复跑。
 *
 * ## 用法
 *
 *     export TCLOUD_SECRET_ID=...
 *     export TCLOUD_SECRET_KEY=...
 *     export TCLOUD_SESSION_TOKEN=...      # 用临时凭证时带上
 *     export PULSE_ENV_ID=pulse-1-d0g880ydl8ddc57f6
 *
 *     node scripts/content-pg-setup.mjs            # 建表 ＋ 装函数
 *     node scripts/content-pg-setup.mjs --check    # 只看现状，不动任何东西
 *     node scripts/content-pg-setup.mjs --drop     # 拆掉内容层（连账本表一起）
 *
 * **凭证只从环境变量读**，绝不写进仓库。
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { execSql, splitStatements } from './pg-admin.mjs'
import { createAllSql, dropAllSql, tableDefs } from '../server/content-schema.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const ENV_ID = process.env.PULSE_ENV_ID || 'pulse-1-d0g880ydl8ddc57f6'
const SCHEMA = 'content'

/** 内容层在 PG 里的函数（与 server/content-pg-functions.sql 一一对应） */
const FUNCTIONS = [
  ['content_check_order', 'jsonb'],
  ['content_publish', 'text, jsonb'],
  ['content_read', 'text, jsonb'],
  ['content_state_get', 'text, jsonb'],
  ['content_revisions_list', 'text, jsonb'],
  ['content_rollback', 'text, jsonb'],
]

/* ------------------------------ 参数 ------------------------------ */

function parseArgs(argv) {
  const out = { check: false, drop: false }
  for (const a of argv) {
    if (a === '--check') out.check = true
    else if (a === '--drop') out.drop = true
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

/** 跑一条 SQL，返回 rows */
async function run(sql) {
  const r = await execSql(sql)
  return r.rows
}

/**
 * 执行一个 .sql 文件（按 `$$` 块切语句）。
 *
 * @param {string} file 文件路径
 * @param {object} [opts]
 * @param {boolean} [opts.dropFirst] 先 DROP 同签名旧函数再装
 *                    （PG 不允许 CREATE OR REPLACE 改返回类型 ⇒ 换签名必须先 DROP）
 */
async function applySqlFile(file, { dropFirst = false } = {}) {
  for (const stmt of splitStatements(readFileSync(file, 'utf8'))) {
    const head = stmt.replace(/\s+/g, ' ').trim()
    if (!head) continue
    if (dropFirst) {
      const fn = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/i.exec(stmt)
      if (fn) {
        const types = FUNCTIONS.find(([n]) => n === fn[1])?.[1]
        if (types) await run(`DROP FUNCTION IF EXISTS ${fn[1]}(${types})`)
      }
    }
    await run(stmt)
  }
}

/* ------------------------------ 检查 ------------------------------ */

/** 远端现状：数据表 / 账本表 / 函数 */
async function inspect() {
  const tables = await run(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = '${SCHEMA}' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  )
  const fns = await run(
    `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'content\\_%'
      ORDER BY p.proname`,
  )
  return {
    tables: tables.map((r) => String(cell(r, 0))),
    functions: fns.map((r) => String(cell(r, 0))),
  }
}

/* ------------------------------ 主流程 ------------------------------ */

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`用法：node scripts/content-pg-setup.mjs [选项]

  --check    只看远端现状，不动任何东西
  --drop     拆掉内容层（数据表 ＋ 账本表 ＋ 函数）
  --env <id> 目标环境（默认 ${ENV_ID}）
`)
    return
  }

  process.env.PULSE_ENV_ID = ENV_ID
  const defs = tableDefs()
  const dataTables = defs.map((d) => d.table)

  console.log(`目标环境：${ENV_ID}`)
  console.log(`内容 schema：${SCHEMA}`)
  console.log(`数据表：${dataTables.length} 张（由 schema 生成）\n`)

  if (args.check) {
    const now = await inspect()
    const missingTables = dataTables.filter((t) => !now.tables.includes(t))
    const metaTables = ['content_state', 'content_revisions', 'content_audit']
    const missingMeta = metaTables.filter((t) => !now.tables.includes(t))
    const missingFns = FUNCTIONS.map(([n]) => n).filter((n) => !now.functions.includes(n))

    console.log('远端现状：')
    console.log(`  · 数据表 ${dataTables.length - missingTables.length}/${dataTables.length}`)
    console.log(`  · 账本表 ${metaTables.length - missingMeta.length}/${metaTables.length}`)
    console.log(`  · 函数   ${FUNCTIONS.length - missingFns.length}/${FUNCTIONS.length}`)
    if (missingTables.length) console.log(`  ✗ 缺数据表：${missingTables.join(', ')}`)
    if (missingMeta.length) console.log(`  ✗ 缺账本表：${missingMeta.join(', ')}`)
    if (missingFns.length) console.log(`  ✗ 缺函数：${missingFns.join(', ')}`)
    const ok = !missingTables.length && !missingMeta.length && !missingFns.length
    console.log(ok ? '\n✓ 内容层结构齐全' : '\n✗ 结构不齐 —— 跑一次 setup')
    process.exitCode = ok ? 0 : 1
    return
  }

  if (args.drop) {
    console.log('拆掉内容层…')
    // 函数先拆（函数体里引用表，拆表会报错）
    for (const [name, types] of FUNCTIONS) {
      await run(`DROP FUNCTION IF EXISTS ${name}(${types})`)
      console.log(`  · 拆函数 ${name}`)
    }
    // 账本表 ＋ 数据表（数据表有外键 ⇒ 用 CASCADE）
    await run(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
    console.log(`  · 拆 schema ${SCHEMA}（含数据表 ＋ 账本表）`)
    console.log('\n✓ 已拆干净。')
    return
  }

  // ── ① 数据表（生成）────────────────────────────────────────────────
  console.log('建数据表（schema 生成）…')
  const ddl = `CREATE SCHEMA IF NOT EXISTS ${SCHEMA};\n\n` + createAllSql('pg', { schema: SCHEMA })
  await run(ddl)
  console.log(`  · ${dataTables.length} 张表就位`)

  // ── ② 账本表（手写文件）───────────────────────────────────────────
  console.log('建账本表…')
  await applySqlFile(resolve(ROOT, 'server', 'content-pg-meta.sql'))
  console.log('  · content_state / content_revisions / content_audit 就位')

  // ── ②.5 授权（手写文件）────────────────────────────────────────────
  // 平台默认只给 public schema 授权；内容层在 content / content_meta 两个
  // 新 schema 里 ⇒ 不显式授权的话，SDK 的 rpc（角色 service_role）
  // 既看不见表也读不了数据。
  console.log('授权…')
  await applySqlFile(resolve(ROOT, 'server', 'content-pg-grants.sql'))
  console.log('  · anon / authenticated / service_role 就位')

  // ── ③ 函数（手写文件）─────────────────────────────────────────────
  console.log('装函数…')
  await applySqlFile(resolve(ROOT, 'server', 'content-pg-functions.sql'), { dropFirst: true })
  for (const [name] of FUNCTIONS) console.log(`  · ${name} 就位`)

  const now = await inspect()
  console.log('\n远端现状：')
  console.log(`  · 表 ${now.tables.length} 张（数据 ${dataTables.length} ＋ 账本 3）`)
  console.log(`  · 函数 ${now.functions.length} 个：${now.functions.join(', ')}`)
  console.log('\n✓ 内容层结构就绪。')
}

main().catch((e) => {
  console.error(String(e?.message ?? e))
  process.exit(1)
})
