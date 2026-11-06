#!/usr/bin/env node
/**
 * CloudBase PostgreSQL 管理脚本（本地跑，走腾讯云 CAPI）
 *
 * ## 为什么需要它
 *
 * CloudBase MCP 的 PG 工具（`queryPgDatabase` / `managePgDatabase`）在本机有缓存缺陷：
 * 它把**首次**的 PG 就绪探测结果缓存成模块级 Promise —— 首次探测若失败
 * （比如当时 MCP 绑的是另一个环境），失败结果会被**永久缓存**，
 * 之后所有 PG 调用都直接抛同一个错，**不会重新探测**。
 *
 * 这个脚本绕开 MCP，直接用临时凭证签名调 `tcb` 的 `ExecutePGSql` CAPI，
 * **SQL 从文件读**（不用往工具调用里贴一长段文本）。
 *
 * ## 用法
 *
 *     export TCLOUD_SECRET_ID=...
 *     export TCLOUD_SECRET_KEY=...
 *     export TCLOUD_SESSION_TOKEN=...     # 用临时凭证时带上
 *     export PULSE_ENV_ID=ambitious-parrot-d7ehh7x0fd9d680
 *
 *     node scripts/pg-admin.mjs run server/pg-functions.sql
 *     node scripts/pg-admin.mjs exec "SELECT count(*) FROM patients"
 *     node scripts/pg-admin.mjs file server/schema-pg.sql
 *
 * **凭证只从环境变量读**，绝不写进仓库。
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callTcb } from './lib/tcb-capi.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const ACTION = 'ExecutePGSql'

const ENV_ID = process.env.PULSE_ENV_ID || 'ambitious-parrot-d7ehh7x0fd9d680'
const ROLE = process.env.PULSE_PG_ROLE || 'cloudbase_postgres'
const REGION = process.env.TCLOUD_REGION || 'ap-shanghai'

/* ------------------------------ 调用 ------------------------------ */

/** 调一次 ExecutePGSql，返回解析后的结果 */
export async function execSql(sql, { role = ROLE, envId = ENV_ID } = {}) {
  const r = await callTcb(ACTION, { EnvId: envId, Role: role, Sql: sql })
  // Rows 是「JSON 字符串的数组」—— 每行本身还是一个 JSON 字符串，要再 parse 一次
  let rows = r?.Rows ?? []
  if (typeof rows === 'string') {
    try {
      rows = JSON.parse(rows)
    } catch {
      rows = []
    }
  }
  rows = rows.map((row) => {
    if (typeof row !== 'string') return row
    try {
      return JSON.parse(row)
    } catch {
      return row
    }
  })
  return { columns: r?.Columns ?? [], rows, affected: r?.AffectedRows ?? 0, raw: { Response: r } }
}

/* --------------------------- 语句切分 --------------------------- */

/**
 * 把一个 .sql 文件切成若干条语句。
 *
 * 要避开 **函数体里的分号** —— PG 的 `$$ ... $$` 块内部不能按 `;` 切。
 * 这里跟踪 dollar-quote 标签（`$$` 或 `$tag$`）的进出，只在块外认语句结束。
 */
export function splitStatements(text) {
  const out = []
  let buf = ''
  let tag = null // 当前所在的 dollar-quote 标签
  let i = 0

  while (i < text.length) {
    const rest = text.slice(i)

    if (tag) {
      const end = rest.indexOf(tag)
      if (end === -1) {
        buf += rest
        i = text.length
        break
      }
      buf += rest.slice(0, end + tag.length)
      i += end + tag.length
      tag = null
      continue
    }

    // dollar-quote 开始
    const dm = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(rest)
    if (dm) {
      tag = dm[0]
      buf += tag
      i += tag.length
      continue
    }

    // 单引号字符串（'...'，含 '' 转义）
    if (rest[0] === "'") {
      buf += "'"
      i += 1
      while (i < text.length) {
        if (text[i] === "'" && text[i + 1] === "'") {
          buf += "''"
          i += 2
          continue
        }
        if (text[i] === "'") {
          buf += "'"
          i += 1
          break
        }
        buf += text[i]
        i += 1
      }
      continue
    }

    // 行注释
    if (rest.startsWith('--')) {
      const nl = text.indexOf('\n', i)
      const end = nl === -1 ? text.length : nl
      buf += text.slice(i, end)
      i = end
      continue
    }

    if (rest[0] === ';') {
      const stmt = buf.trim()
      if (stmt) out.push(stmt)
      buf = ''
      i += 1
      continue
    }

    buf += rest[0]
    i += 1
  }

  const tail = buf.trim()
  if (tail) out.push(tail)
  return out
}

/* ------------------------------ CLI ------------------------------ */

function printResult(res) {
  if (!res.columns.length) {
    console.log(`  ✓ 影响 ${res.affected} 行`)
    return
  }
  console.log('  ' + res.columns.join(' | '))
  for (const row of res.rows) {
    console.log('  ' + (Array.isArray(row) ? row.map((v) => JSON.stringify(v)).join(' | ') : JSON.stringify(row)))
  }
}

async function main() {
  const [cmd, arg] = process.argv.slice(2)
  if (!cmd) {
    console.error('用法：node scripts/pg-admin.mjs run|file <sql文件> | exec <sql>')
    process.exit(1)
  }

  if (cmd === 'exec') {
    if (!arg) throw new Error('缺少 SQL')
    console.log('执行：', arg.slice(0, 120))
    printResult(await execSql(arg))
    return
  }

  if (cmd === 'run' || cmd === 'file') {
    const file = resolve(ROOT, arg)
    const sql = readFileSync(file, 'utf8')
    const stmts = splitStatements(sql)
    console.log(`${arg}：切成 ${stmts.length} 条语句`)
    let n = 0
    for (const stmt of stmts) {
      n += 1
      const head = stmt.replace(/\s+/g, ' ').slice(0, 90)

      // **PG 的硬规则**：`CREATE OR REPLACE FUNCTION` 不能改函数的返回类型
      // （比如把 boolean 改成 jsonb 会报 "cannot change return type of existing function"）。
      // 所以建函数前先 DROP 掉同签名的旧函数。
      // 语句可能以注释开头，所以这里**不锚定行首**（注释里不会出现这句关键字）
      const fn = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/i.exec(stmt)
      if (fn) {
        const types = fn[2]
          .split(',')
          .map((a) => a.trim().split(/\s+/).pop())
          .filter(Boolean)
          .join(', ')
        const drop = `DROP FUNCTION IF EXISTS ${fn[1]}(${types})`
        try {
          await execSql(drop)
          console.log(`[${n}/${stmts.length}] ↺ ${drop}`)
        } catch (e) {
          console.error(`[${n}/${stmts.length}] ✗ ${drop}\n  ${e.message}`)
          process.exit(1)
        }
      }

      try {
        const res = await execSql(stmt)
        console.log(`[${n}/${stmts.length}] ✓ ${head}`)
        printResult(res)
      } catch (e) {
        console.error(`[${n}/${stmts.length}] ✗ ${head}\n  ${e.message}`)
        console.error('  完整语句：\n' + stmt)
        process.exit(1)
      }
    }
    return
  }

  console.error('未知命令：' + cmd)
  process.exit(1)
}

const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false
if (isMain) {
  main().catch((e) => {
    console.error(String(e?.message ?? e))
    process.exit(1)
  })
}
