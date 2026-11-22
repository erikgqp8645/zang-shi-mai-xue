#!/usr/bin/env node
/**
 * 内容层 · 只生成 JSON 快照（**不发布**）
 *
 * ## 干什么
 *
 * 本地编辑库 → 9 个 `src/content/*.json`。不碰远端。
 *
 * ## 什么时候需要单独跑
 *
 * · 发布时快照失败（远端已发布、快照没更新）⇒ 重跑这个补上
 * · 想在提交前先看看「这次改了什么」⇒ `--check` 只报告差异，不写盘
 *
 * ## 用法
 *
 *     node scripts/content-snapshot.mjs            # 生成快照（会写盘）
 *     node scripts/content-snapshot.mjs --check    # 只看哪些文件会变，不写盘
 *
 * **凭证不需要**（不连远端）。
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defaultDbPath, openDb } from './lib/content-db.mjs'
import { writeSnapshot } from './lib/content-snapshot.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

function parseArgs(argv) {
  const out = { check: false, db: '', force: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--check') out.check = true
    else if (a === '--force') out.force = true
    else if (a === '--db') out.db = resolve(process.cwd(), String(argv[++i] ?? ''))
    else if (a === '--help' || a === '-h') out.help = true
    else throw new Error(`未知参数：${a}`)
  }
  return out
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`用法：node scripts/content-snapshot.mjs [选项]

  --check       只报告哪些文件会变，不写盘
  --force       允许「从有到无」的覆盖（默认拒绝，防把人工补的字段删掉）
  --db <路径>   内容库路径（默认 local-data/content.sqlite）
`)
    return
  }

  const dbPath = args.db || defaultDbPath()
  const db = openDb(dbPath)
  const result = writeSnapshot(db, { write: !args.check, force: args.force })

  console.log(`内容库：${dbPath}\n`)
  let changed = 0
  for (const r of result) {
    if (r.changed) {
      changed += 1
      console.log(`  ${args.check ? '会变' : '已改'}  ${r.name}.json（${r.bytes} 字节）`)
    }
  }
  if (!changed) console.log(`  ${result.length} 个快照都没变`)

  // 闸门：有文件会被「删掉非空内容」时，列出来并退出码 1（除非 --force）
  const blocked = result.filter((r) => r.blocked?.length)
  if (blocked.length) {
    console.log('\n⛔ 以下文件会**删掉已有的非空内容**，已拒绝写入：')
    for (const r of blocked) {
      console.log(`  ${r.name}.json`)
      for (const d of r.blocked.slice(0, 8)) {
        console.log(`     ${d.path}：${JSON.stringify(d.before)} → ${JSON.stringify(d.after)}`)
      }
      if (r.blocked.length > 8) console.log(`     ……另有 ${r.blocked.length - 8} 处`)
    }
    console.log(
      '\n这通常说明本地内容库比快照旧（库里没这些字段/行）。确认要删就加 --force。\n',
    )
    process.exitCode = 1
    return
  }

  console.log(
    args.check
      ? '\n--check：没写盘。去掉它就真写。'
      : `\n✓ 快照已更新（${changed} 个文件有变化）。`,
  )
}

// ⚠️ 用**路径**比较而不是 URL 比较 —— 仓库路径里有中文。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (e) {
    console.error(String(e?.message ?? e))
    process.exit(1)
  }
}
