#!/usr/bin/env node
/**
 * 老库迁移回归 —— 最重要的一条：把**旧结构**的库交给新代码，验证数据不丢
 *
 * 为什么单独写这个脚本：
 *   其它 e2e 都是拿**新建的空库**跑 —— 走的是 `schema.sql` 建表的路径，
 *   **完全不经过迁移**。而迁移才是最容易悄悄坏掉的地方
 *   （本次就真出过：`INSERT ... SELECT ... ON CONFLICT` 在 SQLite 里缺 `WHERE` 会报
 *    `near "DO": syntax error`，而新建库根本不触发这段 SQL，所以别的测试全绿、
 *    第一次打开自己的老库时后端直接起不来）。
 *
 * 这个脚本照抄**旧版 schema**（从改造前的 a0f5c10 取的）建一个老库，塞进数据，
 * 再用新代码打开它，逐条断言迁移结果。
 *
 * 用法：node scripts/e2e/migration.mjs
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

let pass = 0
let fail = 0
const failures = []
function ok(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ' —— ' + detail : ''}`)
    console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

/** 旧版 schema（改造前 a0f5c10 的 server/schema.sql，原样照抄） */
const OLD_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS patients (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  layout     TEXT NOT NULL CHECK (layout IN ('nine', 'seven')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS visits (
  id         TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  at         INTEGER NOT NULL,
  pulse_values TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  constitution TEXT,
  therapy     TEXT
);
CREATE INDEX IF NOT EXISTS visits_by_patient ON visits (patient_id, seq);

CREATE TABLE IF NOT EXISTS medication (
  id         TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  visit_id   TEXT NOT NULL REFERENCES visits (id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  name       TEXT NOT NULL,
  pulse      TEXT,
  symbols    TEXT,
  adjust     TEXT,
  usage      TEXT,
  note       TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS medication_by_patient ON medication (patient_id, visit_id, seq);

CREATE TABLE IF NOT EXISTS custom_symbols (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`

/** 造一个旧结构的老库，塞进数据 */
function makeOldDb(path) {
  const db = new DatabaseSync(path)
  db.exec(OLD_SCHEMA)
  const counts = seedData(db)
  db.close()
  return counts
}

/** 往（老结构）库里塞数据，返回各表行数 */
function seedData(db) {
  const now = Date.now()
  const patients = [
    ['p1', '少娟', 'nine', now - 3000, now - 3000],
    ['p2', '演示·平和', 'nine', now - 2000, now - 2000],
    ['p3', '演示·肾虚', 'seven', now - 1000, now - 1000],
  ]
  for (const p of patients) {
    db.prepare('INSERT INTO patients (id,name,layout,created_at,updated_at) VALUES (?,?,?,?,?)').run(...p)
  }
  const visits = [
    ['v1', 'p1', '21日', now - 3000, JSON.stringify({ 'L|寸|浮': ['+'] }), 0, '肾虚', '三焦疗法'],
    ['v2', 'p1', '2月5', now - 2500, JSON.stringify({ 'R|关|中': ['↑'] }), 1, null, null],
    ['v3', 'p2', '261102', now - 2000, JSON.stringify({ 'L|尺|沉': ['-'] }), 0, null, null],
    ['v4', 'p3', '261103', now - 1000, JSON.stringify({ 'L|寸|中': ['++'] }), 0, '上盛下虚', '五脏疗法'],
    ['v5', 'p3', '261104', now - 900, JSON.stringify({ 'R|寸|浮': ['#'] }), 1, null, null],
  ]
  for (const v of visits) {
    db.prepare(
      'INSERT INTO visits (id,patient_id,label,at,pulse_values,seq,constitution,therapy) VALUES (?,?,?,?,?,?,?,?)',
    ).run(...v)
  }
  const meds = [
    ['m1', 'p1', 'v1', 0, '引火归元', '寸关浮大尺脉弱', null, '', '', '', now],
    ['m2', 'p3', 'v4', 0, '下焦方', '尺脉弱', null, '', '', '', now],
  ]
  for (const m of meds) {
    db.prepare(
      'INSERT INTO medication (id,patient_id,visit_id,seq,name,pulse,symbols,adjust,usage,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ).run(...m)
  }
  const syms = [
    ['S', '涩', now],
    ['N', '涩而数', now],
  ]
  for (const s of syms) {
    db.prepare('INSERT INTO custom_symbols (code,name,created_at) VALUES (?,?,?)').run(...s)
  }
  return { patients: patients.length, visits: visits.length, meds: meds.length, syms: syms.length }
}

/** 重建用的中间表（与生产代码里建的那张一模一样） */
const NEW_SYMBOLS_SQL = `
  CREATE TABLE custom_symbols_new (
    code       TEXT NOT NULL,
    owner_id   TEXT NOT NULL,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (owner_id, code)
  );
`

/**
 * 造「半迁移残留」的老库：老表还是旧结构，但重建用的中间表已经被建出来（数据还没搬）。
 * —— 真实世界长这样：上一次迁移在这一步崩了（比如 UPSERT 语法错），库里就留下了这堆残局。
 */
function makeHalfMigratedDb(path) {
  const db = new DatabaseSync(path)
  db.exec(OLD_SCHEMA)
  const counts = seedData(db)
  db.exec(NEW_SYMBOLS_SQL)
  db.close()
  return counts
}

/**
 * 造「DROP 之后中断」的老库：老表已经被删掉，只剩搬完数据的中间表。
 * —— 这是上一版迁移最危险的残局：custom_symbols 表整个不见了。
 */
function makeDroppedOldDb(path) {
  const db = new DatabaseSync(path)
  db.exec(OLD_SCHEMA)
  const counts = seedData(db)
  db.exec(NEW_SYMBOLS_SQL)
  db.exec(
    `INSERT INTO custom_symbols_new (code, owner_id, name, created_at)
     SELECT code, '__legacy__', name, created_at FROM custom_symbols WHERE true;`,
  )
  db.exec('DROP TABLE custom_symbols')
  db.close()
  return counts
}

/** 打开一个库并跑完迁移（走生产代码同一条路径） */
async function openMigrated(path) {
  process.env.PULSE_DB = path
  // 动态导入，确保读到的是此刻的 db.mjs
  const mod = await import(join(ROOT, 'server/db.mjs') + `?t=${Date.now()}`)
  const db = mod.openDb()
  return { db, mod }
}

function q(db, sql) {
  return db.prepare(sql).all()
}

console.log('\n老库迁移回归（旧结构库 → 新代码）\n')

const dir = mkdtempSync(join(tmpdir(), 'pulse-mig-'))
const dbPath = join(dir, 'history.sqlite')

try {
  console.log('【准备】造一个旧结构的库…')
  const seeded = makeOldDb(dbPath)
  console.log(`  patients=${seeded.patients} visits=${seeded.visits} medication=${seeded.meds} symbols=${seeded.syms}`)

  console.log('\n【1】用新代码打开 → 迁移跑起来')
  let opened
  try {
    opened = await openMigrated(dbPath)
    ok('打开老库不报错（迁移不炸）', true)
  } catch (e) {
    ok('打开老库不报错（迁移不炸）', false, e?.message ?? String(e))
    throw e
  }
  const { db } = opened

  console.log('\n【2】数据不丢')
  const counts = {
    patients: q(db, 'SELECT count(*) c FROM patients')[0].c,
    visits: q(db, 'SELECT count(*) c FROM visits')[0].c,
    medication: q(db, 'SELECT count(*) c FROM medication')[0].c,
    custom_symbols: q(db, 'SELECT count(*) c FROM custom_symbols')[0].c,
  }
  ok(`patients 行数不变（${seeded.patients}）`, counts.patients === seeded.patients, `实际 ${counts.patients}`)
  ok(`visits 行数不变（${seeded.visits}）`, counts.visits === seeded.visits, `实际 ${counts.visits}`)
  ok(`medication 行数不变（${seeded.meds}）`, counts.medication === seeded.meds, `实际 ${counts.medication}`)
  ok(`custom_symbols 行数不变（${seeded.syms}）`, counts.custom_symbols === seeded.syms, `实际 ${counts.custom_symbols}`)

  // 内容也要在：不能只看行数
  const p1 = q(db, "SELECT name, layout FROM patients WHERE id='p1'")[0]
  ok('患者内容还在（少娟/nine）', p1 && p1.name === '少娟' && p1.layout === 'nine')
  const v1 = q(db, "SELECT label, constitution, therapy, pulse_values FROM visits WHERE id='v1'")[0]
  ok('就诊内容还在（标签/体质/疗法/脉象值）', v1 && v1.label === '21日' && v1.constitution === '肾虚' && v1.therapy === '三焦疗法')
  const m1 = q(db, "SELECT name FROM medication WHERE id='m1'")[0]
  ok('用药内容还在（引火归元）', m1 && m1.name === '引火归元')
  const syms = q(db, 'SELECT code, name FROM custom_symbols ORDER BY code')
  const symMap = Object.fromEntries(syms.map((s) => [s.code, s.name]))
  ok('自定义符号还在（S=涩、N=涩而数）', symMap['S'] === '涩' && symMap['N'] === '涩而数', JSON.stringify(syms))

  console.log('\n【3】owner 归属与不变量')
  const local = q(db, "SELECT id FROM users WHERE login_name='local'")[0]
  ok('建了内置 local 账号', !!local)
  const owners = q(db, 'SELECT DISTINCT owner_id FROM patients')
  ok('patients 的 owner 全部归 local', owners.length === 1 && owners[0].owner_id === local.id, JSON.stringify(owners))
  for (const t of ['patients', 'visits', 'medication', 'custom_symbols']) {
    const bad = q(db, `SELECT count(*) c FROM ${t} WHERE owner_id IS NULL OR owner_id=''`)[0].c
    ok(`${t} 没有空 owner`, bad === 0, `实际 ${bad}`)
  }
  const inv1 = q(
    db,
    'SELECT count(*) c FROM visits v JOIN patients p ON p.id=v.patient_id WHERE v.owner_id<>p.owner_id',
  )[0].c
  const inv2 = q(
    db,
    'SELECT count(*) c FROM medication m JOIN visits v ON v.id=m.visit_id WHERE m.owner_id<>v.owner_id',
  )[0].c
  const inv3 = q(db, "SELECT count(*) c FROM custom_symbols WHERE owner_id IS NULL OR owner_id=''")[0].c
  ok('不变量1：visit 与 patient 同 owner', inv1 === 0, `实际 ${inv1}`)
  ok('不变量2：medication 与 visit 同 owner', inv2 === 0, `实际 ${inv2}`)
  ok('不变量3：custom_symbols 无空 owner', inv3 === 0, `实际 ${inv3}`)

  console.log('\n【4】表结构与索引')
  const tables = q(db, "SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name)
  for (const t of ['users', 'identities', 'sessions', 'patients', 'visits', 'medication', 'custom_symbols']) {
    ok(`表 ${t} 存在`, tables.includes(t))
  }
  const idx = q(db, "SELECT name FROM sqlite_master WHERE type='index'").map((r) => r.name)
  for (const i of ['patients_by_owner', 'visits_by_owner', 'medication_by_owner', 'symbols_by_owner']) {
    ok(`索引 ${i} 已建`, idx.includes(i))
  }
  const pkCols = q(db, 'PRAGMA table_info(custom_symbols)').filter((r) => r.pk > 0).map((r) => r.name).sort()
  ok('custom_symbols 主键已改为 (owner_id, code)', JSON.stringify(pkCols) === '["code","owner_id"]', JSON.stringify(pkCols))

  console.log('\n【5】WAL 与备份')
  const journal = q(db, 'PRAGMA journal_mode')[0].journal_mode
  ok('已开 WAL', String(journal).toLowerCase() === 'wal', `实际 ${journal}`)
  const backups = readdirSync(dir).filter((f) => f.includes('.bak-'))
  ok('迁移前留了备份', backups.length >= 1, backups.join(', '))
  if (backups.length) {
    const bak = new DatabaseSync(join(dir, backups[0]))
    const c = bak.prepare('SELECT count(*) c FROM patients').get().c
    ok('备份里还是老结构（有数据）', c === seeded.patients, `实际 ${c}`)
    bak.close()
  }

  console.log('\n【6】幂等：再打开一次不应再出错、不应再备份')
  db.close()
  const before = readdirSync(dir).filter((f) => f.includes('.bak-')).length
  let again
  try {
    again = await openMigrated(dbPath)
    ok('第二次打开不报错', true)
  } catch (e) {
    ok('第二次打开不报错', false, e?.message ?? String(e))
    throw e
  }
  const after = readdirSync(dir).filter((f) => f.includes('.bak-')).length
  ok('第二次打开没有多留备份（已是无需迁移的库）', after === before, `${before} → ${after}`)
  const c2 = q(again.db, 'SELECT count(*) c FROM patients')[0].c
  ok('数据仍然完好', c2 === seeded.patients, `实际 ${c2}`)
  again.db.close()
} finally {
  rmSync(dir, { recursive: true, force: true })
}

/**
 * 迁移**中途被打断**留下的两种残局，能不能自愈。
 *
 * 这两种不是假想：迁移那版 UPSERT 语法错，第一次打开自己的老库就炸在搬数据那一步，
 * 库里就留下了「老表 ＋ 空中间表」的残局（= makeHalfMigratedDb 造的那个）。
 * 另一种更险：万一中断发生在「老表已删、新表还没改名」之间，custom_symbols 会整个消失。
 */
async function runInterruptedCase(label, maker) {
  console.log(`\n【${label}】`)
  const d = mkdtempSync(join(tmpdir(), 'pulse-mig-'))
  const p = join(d, 'history.sqlite')
  try {
    const seeded = maker(p)
    let opened
    try {
      opened = await openMigrated(p)
      ok(`${label}：打开不报错（能自愈）`, true)
    } catch (e) {
      ok(`${label}：打开不报错（能自愈）`, false, e?.message ?? String(e))
      return
    }
    const db = opened.db
    const tables = q(db, "SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name)
    ok(`${label}：custom_symbols 表还在`, tables.includes('custom_symbols'))
    ok(`${label}：没有残留 custom_symbols_new`, !tables.includes('custom_symbols_new'), tables.join(', '))
    const syms = q(db, 'SELECT code, name FROM custom_symbols ORDER BY code')
    const symMap = Object.fromEntries(syms.map((s) => [s.code, s.name]))
    ok(`${label}：符号数据还在（S=涩、N=涩而数）`, symMap['S'] === '涩' && symMap['N'] === '涩而数', JSON.stringify(syms))
    const pkCols = q(db, 'PRAGMA table_info(custom_symbols)').filter((r) => r.pk > 0).map((r) => r.name).sort()
    ok(`${label}：主键已是 (owner_id, code)`, JSON.stringify(pkCols) === '["code","owner_id"]', JSON.stringify(pkCols))
    const local = q(db, "SELECT id FROM users WHERE login_name='local'")[0]
    const owners = q(db, 'SELECT DISTINCT owner_id FROM custom_symbols')
    ok(
      `${label}：符号 owner 归 local`,
      !!local && owners.length === 1 && owners[0].owner_id === local.id,
      JSON.stringify(owners),
    )
    const pc = q(db, 'SELECT count(*) c FROM patients')[0].c
    ok(`${label}：患者数据没丢`, pc === seeded.patients, `实际 ${pc}`)
    db.close()
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
}

await runInterruptedCase('7 · 迁移中断：老表 ＋ 空中间表', makeHalfMigratedDb)
await runInterruptedCase('8 · 迁移中断：老表已删、只剩中间表', makeDroppedOldDb)

/**
 * 回归：「迁移的时候还有别的连接开着这个库」→ 迁移之后写入的数据还能不能落盘。
 *
 * 这条踩过一次大坑（症状：刚在网页上注册好的账号，库里查不到，重启也没了）：
 * 迁移前备份原本是 `copyFileSync` ＋ `PRAGMA wal_checkpoint(TRUNCATE)`，
 * 想让拷贝带上 WAL 里的数据。但 checkpoint 会**重置 WAL 的共享状态**
 * （wal-index header）。只要还有别的连接开着这个库（dev server 在跑、
 * admin 脚本又来连一下），那个连接就跟 WAL「分家」了：它退出时以为自己是
 * 最后一个连接，把 -wal/-shm 删了 —— 而服务端还开着旧 fd，
 * 之后所有写入都进了**孤儿 WAL**，进程退出就全丢。
 *
 * 修法：备份改用 SQLite 自己的 `VACUUM INTO`（一致性快照，不碰现有连接）。
 */
console.log('\n【9】迁移时有第二个连接开着 → 之后的写入仍要落盘')
{
  const d = mkdtempSync(join(tmpdir(), 'pulse-mig-'))
  const p = join(d, 'history.sqlite')
  try {
    makeOldDb(p)
    // A：打开库（触发迁移），连接保持不关 —— 扮演服务端
    process.env.PULSE_DB = p
    const mod = await import(join(ROOT, 'server/db.mjs') + `?t=${Date.now()}`)
    const dbA = mod.openDb()

    // B：**另一个进程**连一下就退 —— 扮演 admin 脚本。
    // 必须是另一个进程：同一个进程里的两个连接共享同一份 shm 映射，
    // 不会「分家」，那样测不出这个 bug（第一版就是这么写成假绿的）。
    const b = spawnSync(
      process.execPath,
      [
        '--input-type=commonjs',
        '-e',
        `const { DatabaseSync } = require('node:sqlite')
         const db = new DatabaseSync(process.argv[1])
         db.exec('PRAGMA journal_mode = WAL;')
         db.close()`,
        p,
      ],
      { encoding: 'utf8' },
    )
    if (b.status !== 0) {
      console.log(`  （第二个进程退出码 ${b.status}：${b.stderr ?? ''}）`)
    }

    // A：写入（迁移之后、第二个连接退出之后）
    const localId = dbA.prepare("SELECT id FROM users WHERE login_name='local'").get()?.id
    const now = Date.now()
    dbA
      .prepare('INSERT INTO patients (id,name,layout,created_at,updated_at,owner_id) VALUES (?,?,?,?,?,?)')
      .run('p-after', '迁移后写入', 'nine', now, now, localId)

    // C：第三个连接读 —— 必须看得到，否则就是进了孤儿 WAL
    const dbC = new DatabaseSync(p)
    const seen = dbC.prepare("SELECT name FROM patients WHERE id='p-after'").all()
    ok('第二个连接退出后写入的数据仍落盘（没进孤儿 WAL）', seen.length === 1, JSON.stringify(seen))
    const total = dbC.prepare('SELECT count(*) c FROM patients').get().c
    ok('患者总数正确', total === 4, `实际 ${total}`)

    // 顺带验一下迁移前的备份是完整快照（老数据一条不少）
    const backups = readdirSync(d).filter((f) => f.includes('.bak-'))
    if (backups.length) {
      const bak = new DatabaseSync(join(d, backups[0]), { readOnly: true })
      const c = bak.prepare('SELECT count(*) c FROM patients').get().c
      ok('迁移前的备份是完整快照（患者一条不少）', c === 3, `实际 ${c}`)
      bak.close()
    } else {
      ok('迁移前的备份是完整快照（患者一条不少）', false, '没有留下备份')
    }
    dbC.close()
    dbA.close()
  } catch (e) {
    ok('第二个连接退出后写入的数据仍落盘（没进孤儿 WAL）', false, e?.message ?? String(e))
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
}

console.log(`\n共 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`)
if (failures.length) {
  console.log('失败项：')
  for (const f of failures) console.log('  · ' + f)
}
console.log('')
process.exit(fail === 0 ? 0 : 1)
