/**
 * 桌面版的数据搬运 —— 导出快照 ／ 导入老数据
 *
 * 这两件事**只在服务子进程里做**（那边握着打开着的 db 句柄），主进程只负责弹对话框。
 *
 * ⚠️ 两条纪律（踩过坑，别改）：
 *
 * 1. **禁止 copyFileSync 直接拷库**。
 *    库里开着 WAL，活跃的 `-wal` / `-shm` 不在主文件里；历史上还出过
 *    `wal_checkpoint(TRUNCATE)` 重置 wal-index header → 后续写入进**孤儿 WAL** →
 *    进程退出全丢的事故。备份一律走 `VACUUM INTO`（一致性快照，含 WAL 里的数据）。
 *
 * 2. **导入不碰账号表**（users / identities / sessions）。
 *    桌面版是单机免登录：所有请求都归到内置 `local` 账号，
 *    所以导入过来的病例**一律改挂到 local 名下**，原库的账号不跟着搬。
 */

import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * 四张业务表：要搬的列（不含 owner_id —— 归属统一改成目标库的 local 账号）。
 *
 * 列名以**目标库**（本机库）为准；源库可能是旧结构，
 * 实际搬的时候只取两边都有的列（见 importDbInto）。
 */
const TABLES = {
  patients: {
    columns: ['id', 'name', 'layout', 'created_at', 'updated_at'],
    // 父表：无
  },
  visits: {
    columns: ['id', 'patient_id', 'label', 'at', 'pulse_values', 'seq', 'constitution', 'therapy'],
    // 父表：patient_id → patients.id
    parents: [['patient_id', 'patients', 'id']],
  },
  medication: {
    columns: [
      'id',
      'patient_id',
      'visit_id',
      'seq',
      'name',
      'pulse',
      'symbols',
      'adjust',
      'usage',
      'note',
      'created_at',
    ],
    parents: [
      ['patient_id', 'patients', 'id'],
      ['visit_id', 'visits', 'id'],
    ],
  },
  custom_symbols: {
    columns: ['code', 'name', 'created_at'],
    // 父表：无（主键是 owner_id + code）
  },
}

/** 内置单机账号的登录名（与 server/db.mjs 的 LOCAL_LOGIN_NAME 一致） */
const LOCAL_LOGIN_NAME = 'local'

/**
 * 导出一份整库快照（一致性快照，含 WAL 里的数据）。
 *
 * @param {import('node:sqlite').DatabaseSync} db   本机打开着的库
 * @param {string} target                            目标文件（用户选定的）
 */
export function exportDbSnapshot(db, target) {
  if (!target) throw new Error('没有指定导出位置')
  const dir = dirname(target)
  // VACUUM INTO 要求目标文件不存在 → 先落到同目录的临时名，再搬到用户选定的路径
  const tmp = join(dir, `.pulse-export-${process.pid}-${Date.now()}.sqlite`)
  try {
    db.prepare('VACUUM INTO ?').run(tmp)
    // 快照已经是自洽的了，搬过去是普通文件复制（会覆盖同名文件 —— 用户在对话框里已确认过）
    copyFileSync(tmp, target)
  } finally {
    rmSync(tmp, { force: true })
  }
  return { path: target }
}

/**
 * 把另一个库里的病例数据并进本机库，**一律挂到内置单机账号名下**。
 *
 * 为什么必须改挂：owner_id 是四张业务表的归属列，读写一律按它过滤。
 * 源库里的数据挂在别的账号名下，桌面版（单机）一条也看不到。
 *
 * 幂等：同 id 已存在就跳过（用 INSERT OR IGNORE），重复导入不会翻倍。
 * 父表缺失的行（源库自己就不一致）会跳过，不让外键把整个事务打掉。
 *
 * @param {import('node:sqlite').DatabaseSync} db   本机打开着的库
 * @param {string} source                            源库文件（用户选定的）
 */
export function importDbInto(db, source) {
  if (!source) throw new Error('没有指定要导入的文件')
  if (!existsSync(source)) throw new Error('找不到这个文件')

  const local = db.prepare('SELECT id FROM users WHERE login_name = ?').get(LOCAL_LOGIN_NAME)
  if (!local) throw new Error('本机库里没有内置单机账号，无法导入')

  const src = new DatabaseSync(source, { readOnly: true })
  const summary = {}
  try {
    db.exec('BEGIN')
    try {
      for (const [table, spec] of Object.entries(TABLES)) {
        const srcCols = new Set(
          src.prepare(`PRAGMA table_info(${table})`).all().map((r) => String(r.name)),
        )
        // 只搬两边都有的列 —— 源库是老结构时不会因为缺列而整批失败
        const cols = spec.columns.filter((c) => srcCols.has(c))
        if (cols.length === 0) {
          summary[table] = { imported: 0, skipped: 0 }
          continue
        }
        if (table === 'custom_symbols') {
          summary[table] = copySymbols(db, src, cols, local.id)
        } else {
          summary[table] = copyRows(db, src, table, cols, spec.parents ?? [], local.id)
        }
      }
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  } finally {
    src.close()
  }
  return summary
}

/** 搬一张带 id 主键的表 */
function copyRows(db, src, table, cols, parents, ownerId) {
  const placeholders = cols.map(() => '?').join(', ')
  const select = `SELECT ${cols.join(', ')} FROM ${table}`
  const insert = `INSERT OR IGNORE INTO ${table} (${cols.join(', ')}, owner_id) VALUES (${placeholders}, ?)`

  const readStmt = src.prepare(select)
  const writeStmt = db.prepare(insert)
  const parentChecks = parents.map(([col, parentTable, parentCol]) => ({
    col,
    stmt: db.prepare(`SELECT 1 AS ok FROM ${parentTable} WHERE ${parentCol} = ?`),
  }))

  let imported = 0
  let skipped = 0
  for (const row of readStmt.all()) {
    // 父表在本机库里没有 → 跳过（外键会拒绝，而且跳过比整批回滚有用）
    let orphan = false
    for (const p of parentChecks) {
      if (!p.stmt.get(row[p.col])) {
        orphan = true
        break
      }
    }
    if (orphan) {
      skipped++
      continue
    }
    const values = cols.map((c) => row[c])
    const r = writeStmt.run(...values, ownerId)
    if (r.changes > 0) imported++
    else skipped++
  }
  return { imported, skipped }
}

/** 搬自定义符号（主键是 owner_id + code，不是单列 id） */
function copySymbols(db, src, cols, ownerId) {
  const placeholders = cols.map(() => '?').join(', ')
  const select = `SELECT ${cols.join(', ')} FROM custom_symbols`
  const insert = `INSERT OR IGNORE INTO custom_symbols (${cols.join(', ')}, owner_id) VALUES (${placeholders}, ?)`

  const readStmt = src.prepare(select)
  const writeStmt = db.prepare(insert)
  let imported = 0
  let skipped = 0
  for (const row of readStmt.all()) {
    const values = cols.map((c) => row[c])
    const r = writeStmt.run(...values, ownerId)
    if (r.changes > 0) imported++
    else skipped++
  }
  return { imported, skipped }
}
