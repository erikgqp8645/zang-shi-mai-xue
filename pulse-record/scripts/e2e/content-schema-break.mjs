#!/usr/bin/env node
/**
 * 内容层 schema / 库结构 —— 「故意写坏」验证
 *
 * 用法：
 *
 *     node scripts/e2e/content-schema-break.mjs
 *
 * ## 为什么要有这个
 *
 * `scripts/content-seed.mjs --check` 只证明「好数据能过检查」。
 * 它**不能**证明「坏数据会被拦住」—— 因为检查函数和落库函数读的是同一份 schema，
 * 两者一起错的时候，��查永远是绿的。
 *
 * 所以这里往**临时目录里的副本**注入坏数据，断言对应编号的检查**必须报错**。
 * 每条坏数据对应一个「会悄悄吞掉错误」的缺陷：
 * 没有这些用例，坏数据可能一路流到远端 PG、变成线上脏内容 —— 那比直接报错更糟。
 *
 * ## 注入的坏数据
 *
 * A1（schema ↔ 库结构）
 *   ① 缺表            → 内容表整个不见了
 *   ② 缺列            → 列被删了，schema 还写着
 *   ③ 类型不符        → TEXT 变 INTEGER
 *   ④ 可空性不符      → 该 NOT NULL 的可空
 *   ⑤ 主键不符        → 主键被摘掉
 *   ⑥ 多出的列        → 库里多一列，schema 没有
 *   ⑦ 库里多出内容表  → 冒出 schema 不认识的内容表
 * A2（格位）
 *   ⑧ 格位少一行      → 一张图不是 18 行
 *   ⑨ seq 不连续      → seq 跳号
 * A3（组号）
 *   ⑩ 组号跳号        → 组号不是一个编号空间（1,3 缺 2）
 * A4（用字 ↔ 组号）
 *   ⑪ 有用字没组号    → 这一格被悄悄丢出任何组，图上还留着用字
 * RT（往返）
 *   ⑫ 库里内容被改了  → 库 ≠ 源 JSON，导出即漂移
 *
 * ⑬ 反向：没改坏时必须**一条都不报**（防假绿）。
 *
 * ⭐ 注入点**按结构定位**（找列、按内容找行），
 *    不靠硬编码行号/列号 —— 表结构一变就会失效。
 */

import { rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CONTENT_DIR, createTableSql, loadContent, qi, tableDefs } from '../lib/content-schema.mjs'
import { buildFreshDb } from '../lib/content-db.mjs'
import { runChecks } from '../lib/content-checks.mjs'

let failures = 0
let checks = 0

function ok(cond, msg) {
  checks++
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures++
    console.log(`  ✗ ${msg}`)
  }
}

/* ------------------------------------------------------------------ *
 * 注入工具
 * ------------------------------------------------------------------ */

/** 按表名取 schema 里的表定义 */
function defOf(table) {
  const def = tableDefs().find((d) => d.table === table)
  if (!def) throw new Error(`schema 里没有表 ${table}`)
  return def
}

/**
 * 用改过的表定义重建一张表（并把原数据搬过去）。
 *
 * 改结构不能只靠 `ALTER TABLE`（SQLite 的 DROP COLUMN 限制多），
 * 所以走「改名 → 按新定义建表 → 搬数据 → 删旧表」。
 *
 * ⚠️ 重建期间**必须关掉外键强制**：
 *   ① `ALTER TABLE RENAME` 在外键开着时会去改别的表里的 REFERENCES 子句，
 *      改成指向临时名，删临时表时就会被外键拦下来；
 *   ② 关掉外键后 RENAME 不改 REFERENCES，子句始终指向原表名 ——
 *      重建完原表名又回来了，正好自洽。
 */
function recreate(db, table, mutate) {
  const def = structuredClone(defOf(table))
  mutate(def)
  const cols = def.columns.map((c) => c.name)
  const colList = cols.map(qi).join(', ')
  db.exec('PRAGMA foreign_keys = OFF;')
  try {
    db.exec(`ALTER TABLE ${qi(table)} RENAME TO ${qi(`${table}__old`)}`)
    db.exec(createTableSql(def, 'sqlite'))
    db.exec(`INSERT INTO ${qi(table)} (${colList}) SELECT ${colList} FROM ${qi(`${table}__old`)}`)
    db.exec(`DROP TABLE ${qi(`${table}__old`)}`)
  } finally {
    db.exec('PRAGMA foreign_keys = ON;')
  }
}

/** 找到第一张有 ≥2 个组的图（组号是 1..N 连续的一个编号空间） */
function patternWithTwoGroups(db) {
  const rows = db
    .prepare(
      `SELECT "pattern_id", "group_no" FROM "content_pulse_cells"
       WHERE "group_no" IS NOT NULL ORDER BY "pattern_id", "group_no"`,
    )
    .all()
  const seen = new Map()
  for (const r of rows) {
    if (!seen.has(r.pattern_id)) seen.set(r.pattern_id, [])
    seen.get(r.pattern_id).push(r.group_no)
  }
  for (const [pid, nos] of seen) {
    if (nos.length >= 2) return pid
  }
  throw new Error('库里找不到有 ≥2 个组的脉象图（注入点失效）')
}

/* ------------------------------------------------------------------ *
 * 用例
 * ------------------------------------------------------------------ */

const CASES = [
  {
    id: 'A1',
    name: '① 缺表（整个内容表不见了）',
    apply: (db) => db.exec('DROP TABLE "content_symbols"'),
  },
  {
    id: 'A1',
    name: '② 缺列（schema 写着 hint，库里没了）',
    apply: (db) => db.exec('ALTER TABLE "content_symbols" DROP COLUMN "hint"'),
  },
  {
    id: 'A1',
    name: '③ 类型不符（hint 应为 TEXT，实际 INTEGER）',
    apply: (db) =>
      recreate(db, 'content_symbols', (d) => {
        d.columns.find((c) => c.name === 'hint').type = 'integer'
      }),
  },
  {
    id: 'A1',
    name: '④ 可空性不符（label 应 NOT NULL，实际可空）',
    apply: (db) =>
      recreate(db, 'content_symbols', (d) => {
        d.columns.find((c) => c.name === 'label').notNull = false
      }),
  },
  {
    id: 'A1',
    name: '⑤ 可空性不符（hint 应可空，实际 NOT NULL）',
    apply: (db) => {
      // 先把空值填上，否则搬数据时 NOT NULL 约束会自己先炸 —— 那就不是「检查抓到」了
      db.exec(`UPDATE "content_symbols" SET "hint" = '占位' WHERE "hint" IS NULL`)
      recreate(db, 'content_symbols', (d) => {
        d.columns.find((c) => c.name === 'hint').notNull = true
      })
    },
  },
  {
    id: 'A1',
    name: '⑥ 主键不符（code 的主键被摘掉）',
    apply: (db) =>
      recreate(db, 'content_symbols', (d) => {
        d.columns.find((c) => c.name === 'code').pk = false
      }),
  },
  {
    id: 'A1',
    name: '⑦ 唯一约束丢失（drugs.name 的唯一索引没了 —— 外键指向它）',
    apply: (db) =>
      recreate(db, 'content_drugs', (d) => {
        d.columns.find((c) => c.name === 'name').unique = false
      }),
  },
  {
    id: 'A1',
    name: '⑧ 多出的列（库里多一列，schema 没有）',
    apply: (db) => db.exec('ALTER TABLE "content_symbols" ADD COLUMN "多余" TEXT'),
  },
  {
    id: 'A1',
    name: '⑨ 库里多出内容表（schema 不认识）',
    apply: (db) => db.exec('CREATE TABLE "content_多出来的" ("id" TEXT)'),
  },
  {
    id: 'A2',
    name: '⑩ 格位少一行（一张图不是 18 行）',
    apply: (db) => {
      const pid = db.prepare('SELECT "id" FROM "content_pulse_patterns" ORDER BY "id" LIMIT 1').get().id
      db.prepare('DELETE FROM "content_pulse_cells" WHERE "pattern_id" = ? AND "seq" = 17').run(pid)
    },
  },
  {
    id: 'A2',
    name: '⑪ seq 不连续（seq 跳号）',
    apply: (db) => {
      const pid = db.prepare('SELECT "id" FROM "content_pulse_patterns" ORDER BY "id" LIMIT 1').get().id
      db.prepare('UPDATE "content_pulse_cells" SET "seq" = 99 WHERE "pattern_id" = ? AND "seq" = 5').run(pid)
    },
  },
  {
    id: 'A3',
    name: '⑫ 组号跳号（1,3 缺 2 —— 组号不是一个编号空间）',
    apply: (db) => {
      const pid = patternWithTwoGroups(db)
      db.prepare(
        'UPDATE "content_pulse_cells" SET "group_no" = 3 WHERE "pattern_id" = ? AND "group_no" = 2',
      ).run(pid)
    },
  },
  {
    id: 'A4',
    name: '⑬ 有用字没组号（这一格被悄悄丢出任何组）',
    apply: (db) => {
      // ⚠️ SQLite 的 UPDATE 默认**不支持 LIMIT**（要 SQLITE_ENABLE_UPDATE_DELETE_LIMIT），
      //    所以先 SELECT 出目标格的主键，再按主键改。
      const row = db
        .prepare(
          `SELECT "pattern_id", "seq" FROM "content_pulse_cells"
           WHERE "term_id" IS NOT NULL AND "group_no" IS NOT NULL
           ORDER BY "pattern_id", "seq" LIMIT 1`,
        )
        .get()
      if (!row) throw new Error('找不到「有用字且有组号」的格位（注入点失效）')
      db.prepare(
        'UPDATE "content_pulse_cells" SET "group_no" = NULL WHERE "pattern_id" = ? AND "seq" = ?',
      ).run(row.pattern_id, row.seq)
    },
  },
  {
    id: 'RT',
    name: '⑭ 库里内容被改了（库 ≠ 源 JSON，导出即漂移）',
    apply: (db) => {
      db.prepare('UPDATE "content_pulse_patterns" SET "title" = ? WHERE "id" = ?').run(
        '被偷偷改过的图名',
        db.prepare('SELECT "id" FROM "content_pulse_patterns" ORDER BY "id" LIMIT 1').get().id,
      )
    },
  },
  {
    id: 'A5',
    name: '⑮ 派生代理主键被手改了（id 与「父键|序号」对不上）',
    apply: (db) => {
      db.prepare(
        'UPDATE "content_pulse_cells" SET "id" = ? WHERE "pattern_id" = ? AND "seq" = 0',
      ).run('手改过的键', db.prepare('SELECT "id" FROM "content_pulse_patterns" ORDER BY "id" LIMIT 1').get().id)
    },
  },
]

/* ------------------------------------------------------------------ *
 * 跑
 * ------------------------------------------------------------------ */

const content = loadContent(CONTENT_DIR)
const tmpRoot = mkdtempSync(join(tmpdir(), 'pulse-content-break-'))

try {
  console.log('⑮ 反向：好库必须一条都不报（防假绿）')
  {
    const { db, path } = buildFreshDb(join(tmpRoot, 'good.sqlite'), content)
    const problems = runChecks(db, content)
    ok(problems.length === 0, `好库无告警（实际 ${problems.length} 条）`)
    if (problems.length) {
      for (const p of problems) console.log(`      · [${p.id}] ${p.msg}`)
    }
    db.close()
    rmSync(path, { force: true })
  }

  console.log('')
  for (const c of CASES) {
    const { db, path } = buildFreshDb(join(tmpRoot, `bad-${c.id}-${checks}.sqlite`), content)
    c.apply(db)
    const problems = runChecks(db, content)
    const hit = problems.filter((p) => p.id === c.id)
    ok(hit.length > 0, `${c.name} → 必须被 [${c.id}] 抓到`)
    if (hit.length === 0) {
      for (const p of problems) console.log(`      · 实际报的是 [${p.id}] ${p.msg}`)
    }
    db.close()
    rmSync(path, { force: true })
  }
} finally {
  rmSync(tmpRoot, { recursive: true, force: true })
}

console.log('')
if (failures) {
  console.log(`[content-break] EXIT=1 —— ${failures}/${checks} 项失败`)
  process.exit(1)
}
console.log(`[content-break] EXIT=0 —— ${checks} 项全过`)
