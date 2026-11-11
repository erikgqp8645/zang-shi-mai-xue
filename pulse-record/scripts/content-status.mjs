#!/usr/bin/env node
/**
 * 内容层 · 看本地与远端的版本差
 *
 * ## 干什么
 *
 * 回答一个问题：**「我改了的东西，有多少还没发到线上？」**
 *
 *   · 远端当前是第几版、谁发的、什么时候发的
 *   · 本地库 vs 远端：新增 N 条 / 修改 M 条 / 删除 K 条（逐表列出）
 *   · 本地快照 vs 本地库：快照是不是已经落后了
 *
 * **只读** —— 不改远端、不改本地、不写盘。
 *
 * ## 用法
 *
 *     node scripts/content-status.mjs
 *
 * ## 凭证
 *
 * 要读远端 ⇒ 需要环境变量里的凭证。
 * 最省事：`node scripts/cb-credentials.mjs -- node scripts/content-status.mjs`
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defaultDbPath, openDb } from './lib/content-db.mjs'
import { compareSnapshot, readAllRows } from './lib/content-snapshot.mjs'
import { diffRows, diffTotals } from './lib/content-diff.mjs'
import { tableDefs } from '../server/content-schema.mjs'
import { rpc } from '../server/pg-client.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

async function main() {
  const dbPath = defaultDbPath()
  const db = openDb(dbPath)
  const localRows = readAllRows(db)

  console.log(`内容库：${dbPath}\n`)

  // ── 远端状态 ──────────────────────────────────────────────────────
  let remote = null
  try {
    const order = tableDefs().map((d) => d.table)
    const res = await rpc('content_read', { p_owner: '', p_args: { order } })
    const state = await rpc('content_state_get', { p_owner: '', p_args: {} })
    remote = { rows: res?.tables ?? {}, state }
    const at = state?.publishedAt ? new Date(Number(state.publishedAt)).toLocaleString('zh-CN') : '—'
    console.log(`远端版本：第 ${state?.version ?? 0} 版`)
    console.log(`  发布人：${state?.publishedBy || '—'}`)
    console.log(`  发布时间：${at}`)
  } catch (err) {
    console.log(`远端版本：读不出来（${String(err?.message ?? err)}）`)
  }

  // ── 本地 vs 远端 ──────────────────────────────────────────────────
  if (remote) {
    console.log('\n本地 vs 远端：')
    const diff = diffRows(localRows, remote.rows)
    const totals = diffTotals(diff)
    if (!totals.total) {
      console.log('  ✓ 完全一致（没有未发布的改动）')
    } else {
      console.log(`  未发布：新增 ${totals.added} 条 / 修改 ${totals.modified} 条 / 删除 ${totals.removed} 条`)
      for (const [table, d] of Object.entries(diff)) {
        if (!d.total) continue
        console.log(`    · ${table}：+${d.added.length} ~${d.modified.length} -${d.removed.length}`)
      }
    }
  }

  // ── 快照 vs 本地库 ───────────────────────────────────────────────
  console.log('\nJSON 快照 vs 本地库：')
  const snap = compareSnapshot(db)
  const stale = snap.filter((s) => !s.same)
  if (!stale.length) {
    console.log('  ✓ 快照是最新的')
  } else {
    console.log(`  ✗ ${stale.length} 个快照落后于本地库：${stale.map((s) => `${s.name}.json`).join('、')}`)
    console.log('    跑 node scripts/content-snapshot.mjs 更新')
  }
}

// ⚠️ 用**路径**比较而不是 URL 比较 —— 仓库路径里有中文。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(String(e?.message ?? e))
    process.exit(1)
  })
}
