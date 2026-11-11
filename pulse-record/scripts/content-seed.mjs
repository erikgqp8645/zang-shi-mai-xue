#!/usr/bin/env node
/**
 * 把 8 个内容 JSON 灌进本地内容库 `local-data/content.sqlite`
 *
 * ## 干什么
 *
 * 内容层的**编辑面**是本地这个 SQLite 库（后台页面连它）。
 * 这个脚本把 `src/content/*.json`（8 个内容文件）灌进去，**一次性**——
 * 之后 JSON 只是发布时生成的**只读快照**，不再往回写。
 *
 * ## 用法
 *
 *     node scripts/content-seed.mjs            # 建库建表 + 灌数据
 *     node scripts/content-seed.mjs --check    # 只校验：schema ↔ 库结构 ↔ 内容是否一致
 *     node scripts/content-seed.mjs --rebuild  # 删表重建（保留外来表，如 directus_*）
 *
 * ## 纪律
 *
 * · 建表 DDL **由 `src/content/schema/*.schema.json` 生成**，本地与远端同一份
 * · 外键 **开着**（`PRAGMA foreign_keys = ON`）—— 灌不进去就是真错，不许糊过去
 * · 只动 `content_*` 表；**不碰** `directus_*` 等外来表
 * · 库文件在 `local-data/`，已被 `.gitignore` 覆盖，天然不入库
 * · 断言在 `scripts/lib/content-checks.mjs`，与破坏测试共用同一份
 */

import { CONTENT_DIR, loadContent } from './lib/content-schema.mjs'
import { createTables, defaultDbPath, openDb, seed } from './lib/content-db.mjs'
import { runChecks } from './lib/content-checks.mjs'

const DB_PATH = defaultDbPath()

const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
const REBUILD = argv.includes('--rebuild')

const db = openDb(DB_PATH)
try {
  if (!CHECK) {
    createTables(db, { rebuild: REBUILD })
    const content = loadContent(CONTENT_DIR)
    const rows = seed(db, content)
    let total = 0
    for (const [t, list] of Object.entries(rows)) {
      total += list.length
      console.log(`  ${t.padEnd(26)} ${String(list.length).padStart(5)} 行`)
    }
    console.log(`\n✅ 灌库完成：${total} 行 → ${DB_PATH}`)
    console.log('   下一步：起本地后台连这个库（见 docs/content-admin-选型.md）')
  } else {
    const content = loadContent(CONTENT_DIR)
    const problems = runChecks(db, content)
    if (problems.length) {
      console.error(`\n❌ 校验没过（${problems.length} 项）：`)
      for (const p of problems) console.error(`   · [${p.id}] ${p.msg}`)
      process.exitCode = 1
    } else {
      console.log('✅ 校验全过：schema ↔ 库结构一致；格位 18 行/图；组号一个编号空间；往返逐字段一致')
    }
  }
} finally {
  db.close()
}
