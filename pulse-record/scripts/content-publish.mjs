#!/usr/bin/env node
/**
 * 内容层 · 发布命令
 *
 * ## 五步流水线（计划 §5.2）
 *
 * | 步骤 | 做什么 | 失败时 |
 * |---|---|---|
 * | ① **自检**（本地） | schema ↔ 库结构；领域不变量（组号一个编号空间、填用字必填组号、格位固定 18 行、导出无损） | **中止发布**，逐条指出是哪一格 |
 * | ② **对拍** | 本地 vs 远端已发布版 → 新增 N 条 / 修改 M 条 / 删除 K 条 | 远端不可达 → **中止**（不猜） |
 * | ③ **原子发布** | 一次 RPC ＝ 一个事务（整份覆盖） | 事务回滚，远端保持发布前状态，**绝不半套** |
 * | ④ **生成快照** | 本地库 → 8 个 `src/content/*.json` | 快照失败 → 远端已发布但快照未更新 → 明确提示，可单独重跑 |
 * | ⑤ **三方对拍** | 远端 PG == 本地库 == JSON 快照 | 不一致 → 红，**不允许「改一边让它过」** |
 *
 * ## 用法
 *
 *     node scripts/content-publish.mjs --dry-run     # 只跑 ① ②，报告将要发布什么
 *     node scripts/content-publish.mjs                # 真发布
 *     node scripts/content-publish.mjs --actor 某某   # 发布人（默认取 git 用户名）
 *
 * ## 凭证
 *
 * **只从环境变量读**。本地最省事的用法是让 `scripts/cb-credentials.mjs` 注入：
 *
 *     node scripts/cb-credentials.mjs -- node scripts/content-publish.mjs
 *
 * （它调 `tcb secrets get` 拿临时密钥，密钥不落盘、不进终端。）
 *
 * ## ⭐ 发布是**单向**的
 *
 * 本地 → 远端 ＋ 快照。**没有反向同步** ⇒ 不存在「两边都改过、谁覆盖谁」。
 * 远端的内容**不允许手改** —— 要改就回本地后台改、再发布。
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defaultDbPath, openDb } from './lib/content-db.mjs'
import { runPublishChecks } from './lib/content-checks.mjs'
import { buildSnapshot, readAllRows, serialize, SNAPSHOT_FILES, writeSnapshot } from './lib/content-snapshot.mjs'
import { diffRows, diffTotals } from './lib/content-diff.mjs'
import { buildContentFromRows, canonicalJson, CONTENT_DIR, rowsToPayload, tableDefs } from '../server/content-schema.mjs'
import { rpc } from '../server/pg-client.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/* ------------------------------ 参数 ------------------------------ */

function parseArgs(argv) {
  const out = { dryRun: false, actor: '', db: '', help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--dry-run') out.dryRun = true
    else if (a === '--actor') out.actor = String(argv[++i] ?? '')
    else if (a === '--db') out.db = resolve(process.cwd(), String(argv[++i] ?? ''))
    else if (a === '--help' || a === '-h') out.help = true
    else throw new Error(`未知参数：${a}`)
  }
  return out
}

/* ------------------------------ 小工具 ------------------------------ */

/** 发布人：--actor > 环境变量 > git 用户名 > 机器名 */
function resolveActor(explicit) {
  if (explicit) return explicit
  if (process.env.PULSE_PUBLISHER) return process.env.PULSE_PUBLISHER
  try {
    const name = execFileSync('git', ['config', 'user.name'], { encoding: 'utf8', cwd: ROOT }).trim()
    if (name) return name
  } catch {
    // 没有 git 或没有配置 —— 下面兜底
  }
  return process.env.USER || process.env.USERNAME || 'unknown'
}

/** 读远端：当前行 ＋ 版本状态 */
async function readRemote() {
  const order = tableDefs().map((d) => d.table)
  const res = await rpc('content_read', { p_owner: '', p_args: { order } })
  const state = await rpc('content_state_get', { p_owner: '', p_args: {} })
  return { rows: res?.tables ?? {}, total: res?.total ?? 0, state }
}

/** 读盘上的 8 个快照文件 */
function readSnapshotFiles() {
  const out = {}
  for (const name of SNAPSHOT_FILES) {
    out[name] = JSON.parse(readFileSync(join(CONTENT_DIR, `${name}.json`), 'utf8'))
  }
  return out
}

/** 两个内容包是否一致（归一化后比） */
function packsEqual(a, b) {
  for (const name of SNAPSHOT_FILES) {
    const x = JSON.stringify(canonicalJson(a[name]))
    const y = JSON.stringify(canonicalJson(b[name]))
    if (x !== y) return name
  }
  return null
}

/* ------------------------------ 主流程 ------------------------------ */

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`用法：node scripts/content-publish.mjs [选项]

  --dry-run        只跑 ① 自检 ＋ ② 对拍，报告将要发布什么，不动任何东西
  --actor <名字>   发布人（默认取 git 用户名）
  --db <路径>      内容库路径（默认 local-data/content.sqlite）
`)
    return
  }

  const dbPath = args.db || defaultDbPath()
  const actor = resolveActor(args.actor)

  console.log(`内容库：${dbPath}`)
  console.log(`发布人：${actor}`)
  console.log(`目标  ：CloudBase PG ${process.env.PULSE_CB_ENV || '(未设 PULSE_CB_ENV)'}\n`)

  // ── ① 自检 ────────────────────────────────────────────────────────
  console.log('① 自检…')
  const db = openDb(dbPath)
  const problems = runPublishChecks(db)
  if (problems.length) {
    console.error(`✗ 自检没过（${problems.length} 条），发布中止：\n`)
    for (const p of problems) console.error(`  [${p.id}] ${p.msg}\n`)
    process.exitCode = 1
    return
  }
  console.log('   ✓ schema ↔ 库结构一致；格位 18 行/图；组号一个编号空间；导出无损')

  const localRows = readAllRows(db)
  const localPack = buildSnapshot(db)

  // ── ② 对拍 ────────────────────────────────────────────────────────
  console.log('\n② 对拍（本地 vs 远端已发布版）…')
  let remote
  try {
    remote = await readRemote()
  } catch (err) {
    console.error(`✗ 远端读不出来：${String(err?.message ?? err)}`)
    console.error('  远端不可达就**中止** —— 不猜、不拿旧数据顶上。')
    process.exitCode = 1
    return
  }
  console.log(`   远端当前版本：${remote.state?.version ?? 0}（发布于 ${remote.state?.publishedAt ?? '—'}）`)

  const diff = diffRows(localRows, remote.rows)
  const totals = diffTotals(diff)
  const changed = Object.entries(diff).filter(([, d]) => d.total > 0)
  if (!changed.length) {
    console.log('   ✓ 本地与远端完全一致（无新增/修改/删除）')
  } else {
    console.log(`   本次会改：新增 ${totals.added} 条 / 修改 ${totals.modified} 条 / 删除 ${totals.removed} 条`)
    for (const [table, d] of changed) {
      console.log(`     · ${table}：+${d.added.length} ~${d.modified.length} -${d.removed.length}`)
    }
  }

  if (args.dryRun) {
    console.log('\n--dry-run：不动远端、也不写快照。去掉它就真发布。')
    return
  }

  // ── ③ 原子发布 ────────────────────────────────────────────────────
  console.log('\n③ 发布（一次 RPC ＝ 一个事务）…')
  const order = tableDefs().map((d) => d.table)
  const payload = { order, tables: rowsToPayload(localRows) }
  let res
  try {
    res = await rpc('content_publish', { p_owner: actor, p_args: payload })
  } catch (err) {
    console.error(`✗ 发布失败：${String(err?.message ?? err)}`)
    console.error('  事务已回滚 —— 远端保持发布前状态，不会半套。')
    process.exitCode = 1
    return
  }
  console.log(`   ✓ 已发布为第 ${res?.version} 版，写入 ${res?.total ?? 0} 行`)

  // ── ④ 生成 JSON 快照 ──────────────────────────────────────────────
  console.log('\n④ 生成 JSON 快照…')
  let written
  try {
    written = writeSnapshot(db)
  } catch (err) {
    console.error(`✗ 快照生成失败：${String(err?.message ?? err)}`)
    console.error('  ⚠️ 远端已经发布，但本地快照没更新 ——')
    console.error('     单独重跑一次即可：node scripts/content-snapshot.mjs')
    process.exitCode = 1
    return
  }
  const changedFiles = written.filter((w) => w.changed)
  if (changedFiles.length) {
    for (const w of changedFiles) console.log(`   · 改了 ${w.name}.json`)
  } else {
    console.log('   · 8 个快照都没变（内容与上一版一致）')
  }

  // ── ⑤ 三方对拍 ────────────────────────────────────────────────────
  console.log('\n⑤ 三方对拍（远端 PG == 本地库 == JSON 快照）…')
  let remote2
  try {
    remote2 = await readRemote()
  } catch (err) {
    console.error(`✗ 复读远端失败：${String(err?.message ?? err)}`)
    process.exitCode = 1
    return
  }
  const remotePack = buildContentFromRows(remote2.rows)
  const diskPack = readSnapshotFiles()

  const bad1 = packsEqual(remotePack, localPack)
  if (bad1) {
    console.error(`✗ 远端 PG 与本地库不一致：${bad1}`)
    process.exitCode = 1
    return
  }
  console.log('   ✓ 远端 PG == 本地库')

  const bad2 = packsEqual(remotePack, diskPack)
  if (bad2) {
    console.error(`✗ 远端 PG 与 JSON 快照不一致：${bad2}`)
    process.exitCode = 1
    return
  }
  console.log('   ✓ 远端 PG == JSON 快照')

  console.log(`\n✓ 发布完成：第 ${res?.version} 版。`)
  console.log(`  改了 ${changedFiles.length} 个快照文件 —— 记得一起提交（代码与文档分开提交）。`)
}

/* ------------------------------ 入口 ------------------------------ */

// ⚠️ 用**路径**比较而不是 URL 比较 —— 仓库路径里有中文，
//    import.meta.url 会做百分号编码，两边规则不一致就永远不相等。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(String(e?.message ?? e))
    process.exit(1)
  })
}
