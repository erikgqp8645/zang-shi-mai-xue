/**
 * 内容编辑库（本地 SQLite）的开库 / 建表 / 灌数
 *
 * ## 为什么要单独一个模块
 *
 * ① `scripts/content-seed.mjs` 要用它（建库灌数 + `--check`）；
 * ② `scripts/e2e/content-schema-break.mjs` 要在**临时目录**里造一份「好库」，
 *    再往副本里注入坏数据。
 *
 * 两边共用这一份 ⇒ 不会出现「测试用的建库逻辑跟真库不一样」这种假绿。
 * ⭐ 铁律：能合成一个来源的，绝不留在两处。
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { ROOT, buildRows, createAllSql, dropAllSql, qi, tableDefs } from './content-schema.mjs'

/** 内容编辑库的默认路径（可用 `PULSE_CONTENT_DB` 覆盖） */
export function defaultDbPath() {
  return process.env.PULSE_CONTENT_DB || join(ROOT, 'local-data', 'content.sqlite')
}

/**
 * 打开（必要时建库）
 *
 * ⭐⭐ **journal_mode 必须用 DELETE，不能用 WAL**（实测踩过的坑）
 *
 * 内容库会被**两个进程同时访问**：
 *   ① 宿主机：`content-seed.mjs` / `content-checks` / 发布脚本
 *   ② 容器里：Directus（bind-mount 同一个文件）
 *
 * WAL 模式下，两个 SQLite 实例共享同一个库文件会**互相毁掉对方的 WAL**：
 * 宿主机连接关闭时会把 `-wal`／`-shm` checkpoint ＋ unlink，
 * 而容器里的 Directus 仍握着已删除 inode 的 fd ⇒ **它的写入全部凭空消失**
 * （API 返回成功，文件却纹丝不动）。
 *
 * DELETE 模式没有这个共享的常驻文件 ⇒ 两个进程可以安全地先后访问同一个文件。
 * 内容库是单人编辑、并发需求为零，WAL 的收益本来就用不上。
 *
 * ⚠️ 业务库（`server/db.mjs`）仍用 WAL —— 那是另一份库、另一种访问模式，别照抄。
 */
export function openDb(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = DELETE;')
  db.exec('PRAGMA busy_timeout = 5000;')
  db.exec('PRAGMA foreign_keys = ON;')
  return db
}

/** 建表（`rebuild` 时先删表重建；**只动 `content_*`，不碰 `directus_*` 等外来表**） */
export function createTables(db, { rebuild = false } = {}) {
  if (rebuild) db.exec(dropAllSql('sqlite'))
  db.exec(createAllSql('sqlite'))
}

/** 灌数据（一个事务） */
export function seed(db, content) {
  const rows = buildRows(content)
  const defs = tableDefs()
  db.exec('BEGIN')
  try {
    for (const def of defs) {
      const list = rows[def.table] || []
      const cols = def.columns.map((c) => c.name)
      const stmt = db.prepare(
        `INSERT INTO ${qi(def.table)} (${cols.map(qi).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      )
      for (const row of list) stmt.run(...cols.map((c) => row[c] ?? null))
    }
    db.exec('COMMIT')
    return rows
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/** 建一份全新的空内容库并灌满数据，返回 `{ db, path, rows }` */
export function buildFreshDb(dbPath, content) {
  const db = openDb(dbPath)
  createTables(db)
  const rows = seed(db, content)
  return { db, path: dbPath, rows }
}
