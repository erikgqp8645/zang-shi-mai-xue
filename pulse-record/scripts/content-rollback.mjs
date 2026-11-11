#!/usr/bin/env node
/**
 * 内容层 · 回滚到某个历史版本
 *
 * ## 语义
 *
 * 回滚 ＝ **把那一版的 payload 再发一次**（走同一条原子管道 `content_publish`），
 * 所以：
 *
 *   · 回滚也是一次发布 ⇒ 会**递增版本号**、也会留痕（audit 里 action=rollback）
 *   · 旧版本**不会被删掉** —— 它是历史，只是重新变成了当前版
 *   · 回滚**不动本地编辑库**，也不动 JSON 快照
 *     （本地库是你的稿；回滚是线上操作。快照要不要跟着回滚，由你决定：
 *      通常是「回滚线上，然后重新发布本地稿」）
 *
 * ## 用法
 *
 *     node scripts/content-rollback.mjs                 # 看有哪些版本可选
 *     node scripts/content-rollback.mjs --to 3          # 回滚到第 3 版
 *     node scripts/content-rollback.mjs --to 3 --dry-run
 *
 * ## 凭证
 *
 * 要读远端、要发布 ⇒ 需要环境变量里的凭证。
 * 最省事：`node scripts/cb-credentials.mjs -- node scripts/content-rollback.mjs --to 3`
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { rpc } from '../server/pg-client.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

function parseArgs(argv) {
  const out = { to: null, dryRun: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--to') out.to = Number(argv[++i])
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--help' || a === '-h') out.help = true
    else throw new Error(`未知参数：${a}`)
  }
  return out
}

function stamp(ms) {
  return ms ? new Date(Number(ms)).toLocaleString('zh-CN') : '—'
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`用法：node scripts/content-rollback.mjs [选项]

  --to <版本号>   回滚到第几版
  --dry-run       只看要回滚到哪一版，不真回滚
`)
    return
  }

  const list = await rpc('content_revisions_list', { p_owner: '', p_args: { limit: 20 } })
  const revisions = list?.revisions ?? []

  console.log('可回滚的版本（新的在前）：')
  if (!revisions.length) {
    console.log('  （还没有任何历史版本 —— 发布过一次才有）')
    return
  }
  for (const r of revisions) {
    console.log(`  第 ${r.version} 版　${stamp(r.published_at ?? r.publishedAt)}　${r.published_by ?? r.publishedBy ?? '—'}`)
  }

  if (args.to === null) {
    console.log('\n加 --to <版本号> 就能回滚。')
    return
  }

  const target = revisions.find((r) => Number(r.version) === args.to)
  if (!target) {
    console.error(`✗ 找不到第 ${args.to} 版的修订记录（只保留最近 20 版）。`)
    process.exitCode = 1
    return
  }

  if (args.dryRun) {
    console.log(`\n--dry-run：会回滚到第 ${args.to} 版（${stamp(target.published_at ?? target.publishedAt)}），没动任何东西。`)
    return
  }

  const res = await rpc('content_rollback', {
    p_owner: process.env.PULSE_PUBLISHER || 'rollback',
    p_args: { version: args.to },
  })
  console.log(`\n✓ 已回滚到第 ${args.to} 版的内容（现在是第 ${res?.version} 版，写入 ${res?.total ?? 0} 行）`)
  console.log('  提醒：本地编辑库与 JSON 快照**没有**跟着回滚 ——')
  console.log('        若要线上与本地一致，重新跑一次 node scripts/content-publish.mjs。')
}

// ⚠️ 用**路径**比较而不是 URL 比较 —— 仓库路径里有中文。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(String(e?.message ?? e))
    process.exit(1)
  })
}
