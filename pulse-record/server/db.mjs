/**
 * 病例记录库（SQLite）—— 永久存储层
 *
 * 存盘位置：pulse-record/local-data/history.sqlite（运行产物，不进版本库）
 * 依赖：Node 22+ 内置 node:sqlite（DatabaseSync），无原生模块、无第三方依赖。
 *
 * 两级结构（表结构见 server/schema.sql）：
 *   patient  一位受检者/患者
 *   visit    该患者的一次就诊记录（日期标签 ＋ 这次的脉象符号）
 * 这里只做读写，不含业务判断。
 *
 * ── 归属（owner）────────────────────────────────────────────────────
 * patients / visits / medication / custom_symbols 四张业务表都带 owner_id，
 * 指向拥有这些数据的人（users 表）。
 *
 * **每个导出函数的 ownerId 都是必填参数**，SQL 里一律带 owner 过滤 ——
 * 这样「忘了加过滤」会在调用点就暴露，而不是变成线上越权。
 * owner_id 只由调用方（鉴权中间件）给出，**绝不接受请求体传入**。
 *
 * 跨用户访问一律当作「不存在」（404），不用 403 —— 403 会泄露「这东西存在」。
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(here, '..')
export const DB_PATH = process.env.PULSE_DB ?? join(ROOT, 'local-data', 'history.sqlite')

/** 内置单机账号的登录名 —— 注册时必须拒绝这个名字 */
export const LOCAL_LOGIN_NAME = 'local'

/** 迁移占位值：老库补 owner_id 列时的默认值，回填后换成真正的用户 id */
const LEGACY_OWNER = '__legacy__'

/** 打开数据库（首次自动建库建表） */
export function openDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true })
  const db = new DatabaseSync(DB_PATH)
  // WAL：多读单写，多用户同时用时才不会撞 SQLITE_BUSY
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA busy_timeout = 5000;')
  db.exec('PRAGMA synchronous = NORMAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'))
  migrate(db)
  return db
}

/* ------------------------------------------------------------------ *
 * 事务
 * ------------------------------------------------------------------ */

/**
 * 事务边界收在一处。
 *
 * SQLite 的 BEGIN/COMMIT/ROLLBACK 是这里写的；迁到 CloudBase PostgreSQL 时，
 * 事务 API 不同，但**只要替换这一个函数的实现**，上层的写入语义（整份覆盖、
 * 级联删、失败回滚）都不用动。
 */
async function withTransaction(db, fn) {
  db.exec('BEGIN')
  try {
    const r = await fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

/* ------------------------------------------------------------------ *
 * 迁移
 * ------------------------------------------------------------------ */

/** 表里有没有某列 */
function hasColumn(db, table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  return cols.some((c) => c.name === column)
}

/** 表是否存在 */
function tableExists(db, table) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)
}

/**
 * 迁移前备份：用 SQLite 自己的 `VACUUM INTO` 拿一份**一致性快照**。
 *
 * 为什么不用 `copyFileSync`：
 *   ① WAL 模式下，最近的写入还在 -wal 里没落回主文件 —— 直接拷主文件是**缺尾巴**的；
 *   ② 更要命的是，为了让拷贝完整而去 `PRAGMA wal_checkpoint(TRUNCATE)` ——
 *      checkpoint 会重置 WAL 的共享状态（wal-index header）。只要**还有别的连接**
 *      开着这个库（比如 dev server 已经在跑、admin 脚本又来连一下），
 *      那个连接就会跟 WAL「分家」：它退出时以为自己是最后一个连接，把 -wal/-shm 删了
 *      —— 而服务端还开着旧 fd，之后所有写入都进了**孤儿 WAL**，进程退出就彻底丢
 *      （真踩过：刚注册好的账号在库里看不见了，重启也没了）。
 *
 * `VACUUM INTO` 没有这些问题：它读的是一致性快照（含 WAL 里的数据），
 * 而且**不碰**现有连接的状态。
 */
function backupDb(db) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  let target = `${DB_PATH}.bak-${stamp}`
  let n = 1
  while (existsSync(target)) target = `${DB_PATH}.bak-${stamp}-${n++}`
  db.prepare('VACUUM INTO ?').run(target)
  return target
}

/**
 * 老库迁移：建表语句里的列是后加的，老库要补上。
 * （CREATE TABLE IF NOT EXISTS 不会给已存在的表补列。）
 *
 * 每一步都幂等 —— 每次开库都跑，重复执行不产生副作用。
 * 首次真正改动老库之前，先在同目录留一份 .bak-<ts> 备份。
 */
function migrate(db) {
  const needs = []
  if (!hasColumn(db, 'patients', 'owner_id')) needs.push('patients.owner_id')
  if (!hasColumn(db, 'visits', 'owner_id')) needs.push('visits.owner_id')
  if (!hasColumn(db, 'medication', 'owner_id')) needs.push('medication.owner_id')
  // custom_symbols 的主键从「code」改成「(owner_id, code)」，得整表重建
  if (customSymbolsState(db) !== 'ok') needs.push('custom_symbols.主键')

  // 先备份，再动老库
  if (needs.length > 0 && existsSync(DB_PATH)) {
    try {
      backupDb(db)
    } catch (e) {
      console.error(`[臧氏脉学] 迁移前备份失败（继续迁移，但请自行检查 ${DB_PATH}）：${e?.message ?? e}`)
    }
  }

  // 1) 四张业务表补 owner_id（SQLite 不能加 NOT NULL 且无默认值的列，用默认值占位）
  if (!hasColumn(db, 'patients', 'owner_id')) {
    db.exec(`ALTER TABLE patients ADD COLUMN owner_id TEXT NOT NULL DEFAULT '${LEGACY_OWNER}'`)
  }
  if (!hasColumn(db, 'visits', 'owner_id')) {
    db.exec(`ALTER TABLE visits ADD COLUMN owner_id TEXT NOT NULL DEFAULT '${LEGACY_OWNER}'`)
  }
  if (!hasColumn(db, 'medication', 'owner_id')) {
    db.exec(`ALTER TABLE medication ADD COLUMN owner_id TEXT NOT NULL DEFAULT '${LEGACY_OWNER}'`)
  }

  // 2) custom_symbols 重建：主键由 code 改为 (owner_id, code)
  rebuildCustomSymbols(db)

  // 3) 内置单机账号（承接老数据；不可用密码登录）
  const localUser = ensureLocalUser(db)

  // 3.5) 依赖 owner_id 的索引（老库补完列才建得了）
  db.exec('CREATE INDEX IF NOT EXISTS patients_by_owner ON patients (owner_id, updated_at)')
  db.exec('CREATE INDEX IF NOT EXISTS visits_by_owner ON visits (owner_id, patient_id, seq)')
  db.exec('CREATE INDEX IF NOT EXISTS medication_by_owner ON medication (owner_id, patient_id, visit_id, seq)')
  db.exec('CREATE INDEX IF NOT EXISTS symbols_by_owner ON custom_symbols (owner_id)')

  // 4) 回填：老数据的 owner 一律归到单机账号
  for (const table of ['patients', 'visits', 'medication', 'custom_symbols']) {
    db.prepare(`UPDATE ${table} SET owner_id = ? WHERE owner_id IS NULL OR owner_id = '' OR owner_id = ?`).run(
      localUser.id,
      LEGACY_OWNER,
    )
  }

  // 5) 不变量自检：父子表的 owner 必须一致，且不能为空
  const badVisit = db
    .prepare(
      'SELECT count(*) AS n FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.owner_id IS NULL OR v.owner_id <> p.owner_id',
    )
    .get().n
  const badMed = db
    .prepare(
      'SELECT count(*) AS n FROM medication m JOIN visits v ON v.id = m.visit_id WHERE m.owner_id IS NULL OR m.owner_id <> v.owner_id',
    )
    .get().n
  const emptyOwner = db
    .prepare(
      `SELECT (SELECT count(*) FROM patients WHERE owner_id IS NULL OR owner_id = '')
            + (SELECT count(*) FROM visits WHERE owner_id IS NULL OR owner_id = '')
            + (SELECT count(*) FROM medication WHERE owner_id IS NULL OR owner_id = '')
            + (SELECT count(*) FROM custom_symbols WHERE owner_id IS NULL OR owner_id = '') AS n`,
    )
    .get().n
  if (Number(badVisit) > 0 || Number(badMed) > 0 || Number(emptyOwner) > 0) {
    throw new Error(
      `数据归属自检未通过（就诊错挂 ${badVisit} 条、用药错挂 ${badMed} 条、空归属 ${emptyOwner} 条）。` +
        `请检查 ${DB_PATH}，或从同目录的 .bak-* 备份恢复后再启动。`,
    )
  }
}

/** custom_symbols 是不是旧结构（主键只有 code） */
function customSymbolsNeedsRebuild(db) {
  const cols = db.prepare('PRAGMA table_info(custom_symbols)').all()
  if (cols.length === 0) return false
  if (!cols.some((c) => c.name === 'owner_id')) return true
  // 主键列：pk > 0 的那些
  const pk = cols.filter((c) => Number(c.pk) > 0).map((c) => c.name).sort().join(',')
  return pk !== 'code,owner_id'
}

/**
 * custom_symbols 当前处于哪种状态：
 *   'ok'     —— 已经是新结构（主键 owner_id+code），不用动
 *   'old'    —— 老结构（主键只有 code），数据在 custom_symbols 里，要搬到新表
 *   'orphan' —— custom_symbols 不见了，只剩重建用的中间表 custom_symbols_new
 *   'empty'  —— custom_symbols 是**空**的新结构表 ＋ 残留着中间表
 *
 * 'orphan' / 'empty' 都是上一次迁移中断留下的残局：
 *   · 'orphan'：中断在「老表已 DROP、改名还没做」→ 中间表里是全部数据
 *   · 'empty' ：中断在「老表已 DROP、schema.sql 又建了一张空的同名表」→
 *               openDb 每次都先跑 schema.sql，所以老表会被重新建成空表，
 *               只看「表在不在」是分辨不出来的，得看表里有没有行。
 */
function customSymbolsState(db) {
  const hasNew = tableExists(db, 'custom_symbols_new')
  const hasOld = tableExists(db, 'custom_symbols')
  if (!hasOld) return hasNew ? 'orphan' : 'ok'
  if (customSymbolsNeedsRebuild(db)) return 'old'
  const rows = Number(db.prepare('SELECT count(*) c FROM custom_symbols').get().c)
  if (rows === 0 && hasNew) return 'empty'
  return 'ok'
}

/** 中间表 custom_symbols_new 的结构对不对（列齐全 ＋ 主键是 owner_id+code） */
function customSymbolsNewIsValid(db) {
  const cols = db.prepare('PRAGMA table_info(custom_symbols_new)').all()
  const names = cols.map((c) => c.name)
  if (!['code', 'owner_id', 'name', 'created_at'].every((n) => names.includes(n))) return false
  const pk = cols.filter((c) => Number(c.pk) > 0).map((c) => c.name).sort().join(',')
  return pk === 'code,owner_id'
}

/**
 * 重建 custom_symbols（主键 code → (owner_id, code)）。
 *
 * 整个过程放在**一个事务**里：SQLite 的 DDL 是事务性的，中途被打断（进程被杀、
 * 磁盘满、SQL 报错）会整体回滚，不会留下「老表已 DROP、新表还没改名」的残局。
 *
 * 半途而废的残局也能自愈：
 *   · 残留一个空的/半满的 custom_symbols_new → 直接丢掉重来（数据源是老表，没丢）
 *   · 只剩 custom_symbols_new、老表没了（上次在 DROP 之后中断）→ 结构对就直接改名回来
 */
function rebuildCustomSymbols(db) {
  const state = customSymbolsState(db)
  if (state === 'ok') {
    // 已经好了，但可能还留着上次中断的中间表 —— 清掉（数据已在 custom_symbols 里）
    if (tableExists(db, 'custom_symbols_new')) {
      db.exec('BEGIN')
      try {
        db.exec('DROP TABLE IF EXISTS custom_symbols_new')
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    }
    return
  }

  const NEW_TABLE_SQL = `
    CREATE TABLE custom_symbols_new (
      code       TEXT NOT NULL,
      owner_id   TEXT NOT NULL,
      name       TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, code)
    );
  `

  db.exec('BEGIN')
  try {
    if (state === 'old') {
      // 老表还在、数据在老表里：残留的中间表一律丢掉，重建时从老表重新搬。
      db.exec('DROP TABLE IF EXISTS custom_symbols_new')
      db.exec(NEW_TABLE_SQL)
      // 注意：`INSERT ... SELECT ... ON CONFLICT` 在 SQLite 里必须带一个 `WHERE`，
      // 否则解析器分不清 `ON` 是 UPSERT 的开头还是 JOIN 的 ON（SQLite 官方文档明写这条歧义）。
      // `WHERE true` 是恒真条件，不改变语义；写成这样 SQL 与 PostgreSQL 都能跑
      // （PostgreSQL 同样接受 `ON CONFLICT DO NOTHING`）。
      //
      // owner 的来源要分两种老库：
      //   · 真·老结构（只有 code）：没有 owner 列，只能归给单机账号
      //   · 中间版本（有 owner_id、但主键只有 code）：**必须原样带过来**，
      //     否则会把几个账号的符号全并到单机账号下 —— 那是一次跨用户数据合并。
      const legacyHasOwner = db
        .prepare('PRAGMA table_info(custom_symbols)')
        .all()
        .some((c) => c.name === 'owner_id')
      const ownerExpr = legacyHasOwner
        ? `COALESCE(NULLIF(owner_id, ''), '${LEGACY_OWNER}')`
        : `'${LEGACY_OWNER}'`
      db.exec(`
        INSERT INTO custom_symbols_new (code, owner_id, name, created_at)
        SELECT code, ${ownerExpr}, name, created_at FROM custom_symbols WHERE true
        ON CONFLICT (owner_id, code) DO NOTHING;
      `)
      db.exec('DROP TABLE IF EXISTS custom_symbols')
      db.exec('ALTER TABLE custom_symbols_new RENAME TO custom_symbols')
    } else {
      // 'orphan' / 'empty'：老表已经不可信（没了、或被 schema.sql 重建成了空表），
      // 数据在中间表里 —— 结构对就直接改名回来。
      db.exec('DROP TABLE IF EXISTS custom_symbols')
      if (customSymbolsNewIsValid(db)) {
        db.exec('ALTER TABLE custom_symbols_new RENAME TO custom_symbols')
      } else {
        // 中间表结构也不对 → 只能重建空表（源数据已经不在任何地方了）
        db.exec('DROP TABLE IF EXISTS custom_symbols_new')
        db.exec(`
          CREATE TABLE custom_symbols (
            code       TEXT NOT NULL,
            owner_id   TEXT NOT NULL,
            name       TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (owner_id, code)
          );
        `)
      }
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

/** 内置单机账号：承接老数据、单机模式下当登录身份；没有可用密码 */
function ensureLocalUser(db) {
  const now = Date.now()
  let row = db.prepare('SELECT id, login_name FROM users WHERE login_name = ?').get(LOCAL_LOGIN_NAME)
  if (!row) {
    const id = `u${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`
    db.prepare(
      `INSERT INTO users (id, login_name, display_name, phone, password_hash, password_salt, role, created_at, updated_at)
       VALUES (?, ?, ?, NULL, '', '', 'admin', ?, ?)`,
    ).run(id, LOCAL_LOGIN_NAME, '本机用户', now, now)
    row = { id, login_name: LOCAL_LOGIN_NAME }
  }
  const hasIdentity = db
    .prepare('SELECT id FROM identities WHERE provider = ? AND external_id = ?')
    .get('local', LOCAL_LOGIN_NAME)
  if (!hasIdentity) {
    db.prepare(
      `INSERT INTO identities (id, user_id, provider, external_id, union_id, created_at)
       VALUES (?, ?, 'local', ?, NULL, ?)`,
    ).run(`i${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, row.id, LOCAL_LOGIN_NAME, now)
  }
  return row
}

/** 取内置单机账号（鉴权中间件在单机模式下用） */
export async function getLocalUser(db) {
  return db.prepare('SELECT id, login_name, display_name, role FROM users WHERE login_name = ?').get(LOCAL_LOGIN_NAME)
}

/**
 * 格值规整与枚举取值 —— **共享模块**（SQLite 与 PostgreSQL 两套实现共用一份，
 * 免得两边对「同一份数据的形状」理解漂移）。见 server/values.mjs。
 */
import { CONSTITUTIONS, THERAPIES, normalizeValues, parseValues, pickEnum } from './values.mjs'


/** 一次就诊记录 */
function rowToVisit(row) {
  return {
    id: row.id,
    label: row.label,
    at: Number(row.at),
    values: normalizeValues(parseValues(row.pulse_values)),
    constitution: pickEnum(CONSTITUTIONS, row.constitution),
    therapy: pickEnum(THERAPIES, row.therapy),
  }
}

/** 一位患者 ＋ 其全部就诊记录（只取该 owner 名下的） */
function rowToPatient(db, row, ownerId) {
  const visits = db
    .prepare(
      `SELECT id, label, at, pulse_values, constitution, therapy
         FROM visits WHERE patient_id = ? AND owner_id = ? ORDER BY seq, at`,
    )
    .all(row.id, ownerId)
    .map(rowToVisit)
  return {
    id: row.id,
    name: row.name,
    layout: row.layout,
    at: visits.length ? visits[visits.length - 1].at : Number(row.updated_at),
    visits,
  }
}

/** 患者列表（含就诊次数与最近一次记录时间），按最近记录时间倒序 */
export async function listPatients(db, ownerId) {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.layout, p.updated_at,
              (SELECT COUNT(*) FROM visits v WHERE v.patient_id = p.id AND v.owner_id = p.owner_id) AS visit_count,
              (SELECT MAX(v.at) FROM visits v WHERE v.patient_id = p.id AND v.owner_id = p.owner_id) AS last_at
         FROM patients p
        WHERE p.owner_id = ?
        ORDER BY COALESCE(last_at, p.updated_at) DESC`,
    )
    .all(ownerId)
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    layout: r.layout,
    visitCount: Number(r.visit_count),
    at: Number(r.last_at ?? r.updated_at),
  }))
}

/**
 * 搜索：按关键字找患者与其就诊记录。
 * 命中口径 —— 患者姓名包含关键字，或某次就诊的日期标签包含关键字，或该次脉象里出现过该符号（如「↑」「X」）。
 * 返回的每个患者带 matchType：all（无关键字，列出全部）／name（姓名命中）／visit（有次记录命中）。
 */
export async function searchPatients(db, q, ownerId) {
  const kw = String(q ?? '').trim()
  if (!kw) {
    return (await listPatients(db, ownerId)).map((p) => ({ ...p, matchType: 'all', matchedVisits: [] }))
  }
  const rows = db.prepare('SELECT id, name, layout, updated_at FROM patients WHERE owner_id = ?').all(ownerId)
  const out = []
  for (const r of rows) {
    const visits = db
      .prepare(
        `SELECT id, label, at, pulse_values, constitution, therapy
           FROM visits WHERE patient_id = ? AND owner_id = ? ORDER BY seq, at`,
      )
      .all(r.id, ownerId)
    const nameHit = r.name.includes(kw)
    const hitVisits = visits.filter((v) => v.label.includes(kw) || String(v.pulse_values).includes(kw))
    if (!nameHit && hitVisits.length === 0) continue
    out.push({
      id: r.id,
      name: r.name,
      layout: r.layout,
      visitCount: visits.length,
      at: visits.length ? Number(visits[visits.length - 1].at) : Number(r.updated_at),
      matchType: nameHit ? 'name' : 'visit',
      matchedVisits: hitVisits.map((v) => ({ id: v.id, label: v.label, at: Number(v.at) })),
    })
  }
  out.sort((a, b) => b.at - a.at)
  return out
}

export async function getPatient(db, id, ownerId) {
  const row = db.prepare('SELECT id, name, layout, updated_at FROM patients WHERE id = ? AND owner_id = ?').get(id, ownerId)
  return row ? rowToPatient(db, row, ownerId) : null
}

export async function getVisit(db, id, ownerId) {
  const row = db
    .prepare(
      `SELECT id, patient_id, label, at, pulse_values, constitution, therapy
         FROM visits WHERE id = ? AND owner_id = ?`,
    )
    .get(id, ownerId)
  if (!row) return null
  return { ...rowToVisit(row), patientId: row.patient_id }
}

/**
 * 存一位患者及其就诊记录（整份覆盖语义）：
 * - 已存在的 visit（同 id）更新；新 visit 插入；库里多出来、本次没有的 visit 删除
 * - patients 行不存在则新建
 * - owner_id 一律由 ownerId 决定，请求体里的 owner 一律忽略
 */
export async function putPatient(db, ownerId, patient) {
  const now = Date.now()
  const id = patient.id || `p${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const layout = patient.layout === 'seven' ? 'seven' : 'nine'
  const visits = Array.isArray(patient.visits) ? patient.visits : []

  // id 已存在但属于别人 —— 绝不覆盖，当作不存在
  const ownerOf = db.prepare('SELECT owner_id FROM patients WHERE id = ?').get(id)
  if (ownerOf && ownerOf.owner_id !== ownerId) return null

  await withTransaction(db, async () => {
    const exists = db.prepare('SELECT id FROM patients WHERE id = ? AND owner_id = ?').get(id, ownerId)
    if (exists) {
      db.prepare('UPDATE patients SET name = ?, layout = ?, updated_at = ? WHERE id = ? AND owner_id = ?').run(
        patient.name || '未命名',
        layout,
        now,
        id,
        ownerId,
      )
    } else {
      db.prepare(
        'INSERT INTO patients (id, owner_id, name, layout, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(id, ownerId, patient.name || '未命名', layout, now, now)
    }

    const keep = new Set()
    const upsert = db.prepare(
      `INSERT INTO visits (id, patient_id, owner_id, label, at, pulse_values, seq, constitution, therapy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET label = excluded.label, at = excluded.at,
         pulse_values = excluded.pulse_values, seq = excluded.seq, patient_id = excluded.patient_id,
         owner_id = excluded.owner_id, constitution = excluded.constitution, therapy = excluded.therapy`,
    )
    // 已存在但属于别人的 visit —— 不碰
    const visitOwner = db.prepare('SELECT owner_id FROM visits WHERE id = ?')
    visits.forEach((v, i) => {
      const vid = v.id || `v${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`
      const own = visitOwner.get(vid)
      if (own && own.owner_id !== ownerId) return
      keep.add(vid)
      upsert.run(
        vid,
        id,
        ownerId,
        v.label || '',
        Number(v.at) || now,
        JSON.stringify(normalizeValues(v.values)),
        i,
        pickEnum(CONSTITUTIONS, v.constitution),
        pickEnum(THERAPIES, v.therapy),
      )
    })

    // 本次没有的旧记录：删掉（患者级编辑语义）
    const olds = db.prepare('SELECT id FROM visits WHERE patient_id = ? AND owner_id = ?').all(id, ownerId)
    const del = db.prepare('DELETE FROM visits WHERE id = ? AND owner_id = ?')
    for (const o of olds) if (!keep.has(o.id)) del.run(o.id, ownerId)

    // 用药记录：整份覆盖（挂在本次的 visits 上；被删掉的 visit 其用药随之级联删除）
    await writeMedicationRows(db, id, ownerId, patient.medications, null)
  })
  return await getPatient(db, id, ownerId)
}

/** 只改某一次就诊记录（单次编辑语义，不动该患者的其它次） */
export async function putVisit(db, id, ownerId, patch) {
  const cur = await getVisit(db, id, ownerId)
  if (!cur) return null
  const label = typeof patch.label === 'string' ? patch.label : cur.label
  // 格值一律规整成「每格一个数组」——客户端可能送来视图层压过的 {"0":"X"} 形状
  const values = normalizeValues(
    patch.values && typeof patch.values === 'object' ? patch.values : cur.values,
  )
  const at = Number(patch.at) || cur.at
  // 体质与疗法：patch 里带了这两个键就按给的写（可以是 null＝清除），没带就保持原值
  const has = (k) => Object.prototype.hasOwnProperty.call(patch, k)
  const constitution = has('constitution') ? pickEnum(CONSTITUTIONS, patch.constitution) : cur.constitution
  const therapy = has('therapy') ? pickEnum(THERAPIES, patch.therapy) : cur.therapy
  await withTransaction(db, async () => {
    db.prepare(
      'UPDATE visits SET label = ?, pulse_values = ?, at = ?, constitution = ?, therapy = ? WHERE id = ? AND owner_id = ?',
    ).run(label, JSON.stringify(values), at, constitution, therapy, id, ownerId)
    db.prepare('UPDATE patients SET updated_at = ? WHERE id = ? AND owner_id = ?').run(Date.now(), cur.patientId, ownerId)
    // 用药：只写回这一次的（该患者其它次的用药不动）
    if (Array.isArray(patch.medications)) {
      await writeMedicationRows(db, cur.patientId, ownerId, patch.medications, id)
    }
  })
  return await getVisit(db, id, ownerId)
}

/** 只改患者姓名 */
export async function renamePatient(db, id, ownerId, name) {
  const cur = await getPatient(db, id, ownerId)
  if (!cur) return null
  db.prepare('UPDATE patients SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ?').run(
    name || '未命名',
    Date.now(),
    id,
    ownerId,
  )
  return await getPatient(db, id, ownerId)
}

/**
 * 只改患者的**体例**（7 脉点 / 9 行）。
 *
 * 体例是**患者级**属性 —— 记录表（canvas / 导出 PNG）与录入记录都必须按同一个值画，
 * 所以它改一下就要立刻落库，不能只留在某个页面的临时状态里，
 * 否则同一位患者在两个页面会显示出不同的行数。
 *
 * 只改体例**不动格值**：7↔9 来回切时，「尺浮/尺中」两行的数据仍原样留在 visits 里，
 * 切回去还在（切到 9 行时那两行没数据，就是空行）。
 */
export async function updatePatientLayout(db, id, ownerId, layout) {
  if (layout !== 'nine' && layout !== 'seven') return null
  const cur = await getPatient(db, id, ownerId)
  if (!cur) return null
  db.prepare('UPDATE patients SET layout = ?, updated_at = ? WHERE id = ? AND owner_id = ?').run(
    layout,
    Date.now(),
    id,
    ownerId,
  )
  return await getPatient(db, id, ownerId)
}

export async function deleteVisit(db, id, ownerId) {
  const info = db.prepare('DELETE FROM visits WHERE id = ? AND owner_id = ?').run(id, ownerId)
  return Number(info.changes) > 0
}

export async function deletePatient(db, id, ownerId) {
  const info = db.prepare('DELETE FROM patients WHERE id = ? AND owner_id = ?').run(id, ownerId)
  return Number(info.changes) > 0
}

/* ---------------- 用药记录（使用者自己填实际用什么方） ---------------- */

/** 一条用药记录 */
function rowToMedication(row) {
  return {
    id: row.id,
    patientId: row.patient_id,
    visitId: row.visit_id,
    name: row.name,
    pulse: row.pulse ?? '',
    symbols: parseValues(row.symbols),
    adjust: row.adjust ?? '',
    usage: row.usage ?? '',
    note: row.note ?? '',
    createdAt: Number(row.created_at),
  }
}

/** 某位患者的全部用药记录（按就诊顺序、组内顺序） */
export async function listMedication(db, patientId, ownerId) {
  return db
    .prepare(
      `SELECT id, patient_id, visit_id, name, pulse, symbols, adjust, usage, note, created_at
         FROM medication WHERE patient_id = ? AND owner_id = ? ORDER BY visit_id, seq, created_at`,
    )
    .all(patientId, ownerId)
    .map(rowToMedication)
}

/** 某一次就诊的用药记录 */
export async function listVisitMedication(db, visitId, ownerId) {
  return db
    .prepare(
      `SELECT id, patient_id, visit_id, name, pulse, symbols, adjust, usage, note, created_at
         FROM medication WHERE visit_id = ? AND owner_id = ? ORDER BY seq, created_at`,
    )
    .all(visitId, ownerId)
    .map(rowToMedication)
}

/**
 * 写一批用药记录（**不开事务**，由调用方控制）。
 * - 同 id 更新；新 id 插入；库里多出来、本次没有的删除
 * - visitId 传 null 表示整位患者覆盖；传具体 id 表示只覆盖那一次就诊
 * - visit_id 必须是该患者已有的就诊记录（外键约束）
 * - owner_id 一律由 ownerId 决定
 */
async function writeMedicationRows(db, patientId, ownerId, rows, visitId = null) {
  const list = Array.isArray(rows) ? rows : []
  const now = Date.now()
  const upsert = db.prepare(
    `INSERT INTO medication (id, patient_id, visit_id, owner_id, seq, name, pulse, symbols, adjust, usage, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET visit_id = excluded.visit_id, seq = excluded.seq,
       owner_id = excluded.owner_id, name = excluded.name, pulse = excluded.pulse, symbols = excluded.symbols,
       adjust = excluded.adjust, usage = excluded.usage, note = excluded.note`,
  )
  const keep = new Set()
  const hasVisitAny = db.prepare('SELECT id FROM visits WHERE id = ?')
  const hasVisitOwn = db.prepare('SELECT id FROM visits WHERE id = ? AND patient_id = ? AND owner_id = ?')
  // 已存在但属于别人的用药记录 —— 不碰
  const medOwner = db.prepare('SELECT owner_id FROM medication WHERE id = ?')
  // 组内序号：同一次就诊内按传入顺序编号
  const seqOf = new Map()
  list.forEach((m) => {
    const id = m.id || `m${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const name = String(m.name ?? '').trim()
    const pulse = String(m.pulse ?? '').trim()
    const adjust = String(m.adjust ?? '').trim()
    const usage = String(m.usage ?? '').trim()
    const note = String(m.note ?? '').trim()
    const symbols = m.symbols && typeof m.symbols === 'object' ? m.symbols : {}
    const hasSymbols = Object.keys(symbols).some((k) => (symbols[k] ?? []).length > 0)
    // 整行全空才丢（只填了「对应脉象」或只填加减，也是使用者的记录，不能静默消失）
    if (!name && !pulse && !adjust && !usage && !note && !hasSymbols) return
    const vid = visitId ?? String(m.visitId ?? '')
    // 外键保护：跳过指向不存在（或不属于该患者）就诊记录的用药，免得整个保存失败
    const exists = visitId ? hasVisitAny.get(vid) : hasVisitOwn.get(vid, patientId, ownerId)
    if (!exists) return
    const own = medOwner.get(id)
    if (own && own.owner_id !== ownerId) return
    keep.add(id)
    const seq = seqOf.get(vid) ?? 0
    seqOf.set(vid, seq + 1)
    upsert.run(
      id,
      patientId,
      vid,
      ownerId,
      seq,
      name,
      pulse,
      JSON.stringify(symbols),
      adjust,
      usage,
      note,
      now,
    )
  })
  // 本次没有的旧用药：删掉（整份覆盖语义）
  const olds = visitId
    ? db.prepare('SELECT id FROM medication WHERE visit_id = ? AND owner_id = ?').all(visitId, ownerId)
    : db.prepare('SELECT id FROM medication WHERE patient_id = ? AND owner_id = ?').all(patientId, ownerId)
  const del = db.prepare('DELETE FROM medication WHERE id = ? AND owner_id = ?')
  for (const o of olds) if (!keep.has(o.id)) del.run(o.id, ownerId)
}

/**
 * 写一位患者的用药记录（整份覆盖语义）。
 */
export async function putMedication(db, patientId, ownerId, rows) {
  await withTransaction(db, async () => {
    await writeMedicationRows(db, patientId, ownerId, rows, null)
  })
  return await listMedication(db, patientId, ownerId)
}

/** 只改某一次就诊的用药（单次编辑语义，不动该患者的其它次） */
export async function putVisitMedication(db, visitId, ownerId, rows) {
  // getVisit 是 async —— 漏 await 会拿到 Promise，cur.patientId 是 undefined，
  // 写库时参数绑不上（Provided value cannot be bound to SQLite parameter），整次保存 500。
  const cur = await getVisit(db, visitId, ownerId)
  if (!cur) return null
  await withTransaction(db, async () => {
    await writeMedicationRows(db, cur.patientId, ownerId, rows, visitId)
  })
  return await listVisitMedication(db, visitId, ownerId)
}

/** 删一条用药记录 */
export async function deleteMedication(db, id, ownerId) {
  const info = db.prepare('DELETE FROM medication WHERE id = ? AND owner_id = ?').run(id, ownerId)
  return Number(info.changes) > 0
}

/* ---------------- 自定义符号（使用者自建，如「涩」记作 S） ---------------- */

/**
 * 讲义 p33–34 的固定符号代码，自定义符号不得占用。
 * 与 src/domain/symbols.ts 的 SYMBOLS 保持一致（那边是前端 TS，这边是服务端 .mjs，无法互相 import）。
 * 常量本体在 server/symbol-codes.mjs —— 它是知识常量，换存储实现时不变。
 */
import { RESERVED_SYMBOL_CODES, symbolInputError } from './symbol-codes.mjs'
export { RESERVED_SYMBOL_CODES }

/** 自定义符号清单，按添加顺序（只看该 owner 的） */
export async function listCustomSymbols(db, ownerId) {
  return db
    .prepare('SELECT code, name FROM custom_symbols WHERE owner_id = ? ORDER BY created_at, rowid')
    .all(ownerId)
    .map((r) => ({ code: r.code, name: r.name }))
}

/** 新增／改名一个自定义符号（同名同代码则覆盖名称） */
export async function putCustomSymbol(db, ownerId, symbol) {
  const code = String(symbol?.code ?? '').trim()
  const name = String(symbol?.name ?? '').trim()
  // 与路由**同一个函数**：空、不可见、长度、空格/斜杠、保留代码、点号，一处判定
  if (symbolInputError(code, name)) return null
  db.prepare(
    `INSERT INTO custom_symbols (code, owner_id, name, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(owner_id, code) DO UPDATE SET name = excluded.name`,
  ).run(code, ownerId, name, Date.now())
  return { code, name }
}

/** 删掉一个自定义符号（不影响已录入的历史符号） */
export async function deleteCustomSymbol(db, code, ownerId) {
  const info = db.prepare('DELETE FROM custom_symbols WHERE code = ? AND owner_id = ?').run(code, ownerId)
  return Number(info.changes) > 0
}

/* ------------------------------------------------------------------ */
/* 方剂脉象图（使用者手填的覆盖层）                                      */
/* ------------------------------------------------------------------ */

/** 一张脉象图最多允许挂 20 张，单张 JSON 超过 32KB 直接拒绝（防止误粘贴整本书） */
const MAX_PATTERNS_PER_FORMULA = 20
const MAX_PATTERN_BYTES = 32 * 1024

/**
 * 「这个方剂已接管，但一张图都不挂」的标记行（`seq = -1`）。
 *
 * 为什么需要它：覆盖层是「有行就用、没行用基线」，
 * 若「删掉全部图」只表现为没有行，就会被读成「没改过」→ 静默回落到基线，
 * 使用者刚删掉的那张又冒出来。所以至少要留一行痕迹表达「我确认这里是空的」。
 */
const TAKEOVER_PAYLOAD = '{"__takeover__":true}'
const TAKEOVER_SEQ = -1

/**
 * 该 owner 手改过的全部脉象图：`{ [formulaId]: entry[] }`。
 *
 * 只返回**覆盖层**，不含内置基线 —— 合并是前端的事（`src/state/patterns.tsx`），
 * 这样「这一条有没有被改过」在数据层面是明确的（有键 = 改过），
 * 界面才能给出「恢复默认」这个动作。被接管且为空的条目回一个**空数组**（不是缺失）。
 */
export async function listFormulaPatterns(db, ownerId) {
  const rows = db
    .prepare('SELECT formula_id, seq, payload FROM formula_patterns WHERE owner_id = ? ORDER BY formula_id, seq')
    .all(ownerId)
  const out = {}
  for (const r of rows) {
    // 先建键：接管标记行也要让这个条目「出现过」
    if (!(r.formula_id in out)) out[r.formula_id] = []
    if (r.seq === TAKEOVER_SEQ) continue
    let entry
    try {
      entry = JSON.parse(r.payload)
    } catch {
      // 坏行不该拖垮整页：跳过它，该条目回落到内置基线（基线总是合法的）
      console.warn(`formula_patterns: ${r.formula_id}#${r.seq} 的 JSON 解析失败，已跳过`)
      continue
    }
    out[r.formula_id].push(entry)
  }
  return out
}

/**
 * 整条替换某方剂的脉象图列表（事务：先删后插，中途失败整体回滚）。
 *
 * @param {string[]} entries 每张图一个对象，顺序即显示顺序
 * @returns {Promise<boolean>} 数据不合规时返回 false（路由层回 400）
 */
export async function putFormulaPatterns(db, ownerId, formulaId, entries) {
  if (typeof formulaId !== 'string' || formulaId.trim() === '') return false
  if (!Array.isArray(entries) || entries.length > MAX_PATTERNS_PER_FORMULA) return false
  const rows = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.cells)) return false
    const payload = JSON.stringify(entry)
    if (payload.length > MAX_PATTERN_BYTES) return false
    rows.push(payload)
  }
  const now = Date.now()
  const del = db.prepare('DELETE FROM formula_patterns WHERE owner_id = ? AND formula_id = ?')
  const ins = db.prepare(
    'INSERT INTO formula_patterns (owner_id, formula_id, seq, payload, updated_at) VALUES (?, ?, ?, ?, ?)',
  )
  db.exec('BEGIN')
  try {
    del.run(ownerId, formulaId)
    if (rows.length === 0) {
      // 「已接管、但一张不挂」—— 留标记行，否则读回来等于没改过（回落到基线）
      ins.run(ownerId, formulaId, TAKEOVER_SEQ, TAKEOVER_PAYLOAD, now)
    } else {
      rows.forEach((payload, seq) => ins.run(ownerId, formulaId, seq, payload, now))
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return true
}

/** 撤销某方剂的覆盖（回到内置基线） */
export async function deleteFormulaPatterns(db, ownerId, formulaId) {
  const info = db
    .prepare('DELETE FROM formula_patterns WHERE owner_id = ? AND formula_id = ?')
    .run(ownerId, formulaId)
  return Number(info.changes) > 0
}
