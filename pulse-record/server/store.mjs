/**
 * 存储实现选择层 —— **数据访问的唯一入口**
 *
 * 路由层（server/index.mjs）、脚本、小程序都不碰 SQL，只调这里导出的函数。
 *
 * ## 契约（两套实现必须同名同签名）
 *
 * | 函数 | 语义 |
 * |---|---|
 * | `openDb()` | 打开／初始化存储，返回一个「db 句柄」 |
 * | `listPatients(db, ownerId)` | 该账号的患者列表（含就诊次数） |
 * | `searchPatients(db, q, ownerId)` | 搜索：姓名／日期标签／脉象符号三口径 |
 * | `getPatient(db, id, ownerId)` | 一位患者 ＋ 其全部就诊记录；不属于该 owner → null |
 * | `getVisit(db, id, ownerId)` | 一次就诊记录；不属于该 owner → null |
 * | `putPatient(db, ownerId, patient)` | **整份覆盖**患者 ＋ 就诊 ＋ 用药；id 属别人 → null |
 * | `putVisit(db, id, ownerId, patch)` | **只写回这一次**；不属于该 owner → null |
 * | `renamePatient(db, id, ownerId, name)` | 改姓名 |
 * | `updatePatientLayout(db, id, ownerId, layout)` | 改体例（7 脉点 / 9 行）；**只改体例，不动格值** |
 * | `deleteVisit(db, id, ownerId)` / `deletePatient(db, id, ownerId)` | 删（级联） |
 * | `listMedication(db, patientId, ownerId)` | 该患者的全部用药 |
 * | `listVisitMedication(db, visitId, ownerId)` | 某次就诊的用药 |
 * | `putMedication(db, patientId, ownerId, rows)` | **整份覆盖**该患者的用药 |
 * | `putVisitMedication(db, visitId, ownerId, rows)` | **只覆盖该次**的用药 |
 * | `deleteMedication(db, id, ownerId)` | 删一条用药 |
 * | `listCustomSymbols(db, ownerId)` | 该账号的自定义符号 |
 * | `putCustomSymbol(db, ownerId, symbol)` | 新增／改名 |
 * | `deleteCustomSymbol(db, code, ownerId)` | 删 |
 * | `getLocalUser(db)` | 内置单机账号 |
 * | `listLibraryItems(db)` | **用方知识库**覆盖层全部条目 |
 * | `putLibraryItem(db, kind, itemId, payload, opts)` | 写入／覆盖一条知识库覆盖 |
 * | `deleteLibraryItem(db, kind, itemId)` | 撤销一条知识库覆盖（回到基线） |
 *
 * **鉴权层也从这里转发**（`createUser` / `authenticate` / `createSession` …）——
 * 它同样按 `PULSE_STORE` 分发（server/auth.mjs ↔ server/auth-pg.mjs），
 * 路由层只认这一个入口。
 *
 * **两条硬规则**：
 * 1. `ownerId` 必填，SQL／查询里必须带归属过滤 —— 跨用户访问当作「不存在」。
 * 2. 全部函数都是 **async**。SQLite 实现内部是同步的（await 一个非 Promise 也没问题），
 *    但 CloudBase PostgreSQL 是异步的（postgREST）—— 签名先定成 async，
 *    将来换后端时调用方一行都不用改。
 *
 * ## ⚠️ 有意例外：用方知识库的三条函数**没有 ownerId**
 *
 * `listLibraryItems` / `putLibraryItem` / `deleteLibraryItem` **不带归属过滤**。
 * 原因：用方知识库是**公共资料**，不是个人数据 —— 管理员改一次，
 * 所有账号看到同一份（用户 2026-11-11 拍板：多人模式下所有账号共享一份）。
 * `library_items` 表也没有 owner_id 列。
 *
 * 这条例外**只此一处**，别顺手扩散到别的表 —— 其余四张业务表
 * （patients / visits / medication / custom_symbols）仍然严格按 owner 隔离。
 *
 * ## 换后端时怎么做
 *
 * 迁 CloudBase 时新增 `server/db-pg.mjs`，按上面的契约实现同名函数，
 * 然后把下面 `PULSE_STORE` 的分支打开即可。**路由层、前端、小程序都不用改。**
 *
 * 表结构映射见 docs/cloudbase-migration.md。
 */

const STORE = process.env.PULSE_STORE ?? 'sqlite'

let impl
if (STORE === 'pg') {
  impl = await import('./db-pg.mjs')
} else {
  impl = await import('./db.mjs')
}

/**
 * 鉴权层也按后端分发 —— 与数据层同一把尺子。
 *
 * 账号相关的**纯逻辑**（密码哈希、登录名规则）在 server/auth-core.mjs，
 * 两套实现共用；只有「怎么存取」不同：
 *   · server/auth.mjs     —— SQLite
 *   · server/auth-pg.mjs  —— PostgreSQL（调 PG 函数）
 */
const authImpl = STORE === 'pg' ? await import('./auth-pg.mjs') : await import('./auth.mjs')

export const {
  createUser,
  getUserById,
  authenticate,
  changePassword,
  resetPassword,
  createSession,
  getSessionUser,
  destroySession,
  destroyUserSessions,
  purgeExpiredSessions,
  findUserByWechat,
  bindWechatIdentity,
  unbindWechatIdentity,
  hasWechatIdentity,
} = authImpl

export const {
  openDb,
  getLocalUser,
  listPatients,
  searchPatients,
  getPatient,
  getVisit,
  putPatient,
  putVisit,
  renamePatient,
  updatePatientLayout,
  deleteVisit,
  deletePatient,
  listMedication,
  listVisitMedication,
  putMedication,
  putVisitMedication,
  deleteMedication,
  listCustomSymbols,
  putCustomSymbol,
  deleteCustomSymbol,
  listFormulaPatterns,
  putFormulaPatterns,
  deleteFormulaPatterns,
  // 用方知识库覆盖层 —— ⚠️ 有意例外：这三个**没有 ownerId**（公共资料，全账号共享一份）
  listLibraryItems,
  putLibraryItem,
  deleteLibraryItem,
} = impl

/**
 * 存储位置的描述（只用于 /api/health 与页面上的提示，不参与业务逻辑）。
 * SQLite 是文件路径；PG 实现里改成「CloudBase PostgreSQL」之类的说明文字。
 */
export const { DB_PATH } = impl

export { RESERVED_SYMBOL_CODES, hasInvisibleChars, symbolInputError } from './symbol-codes.mjs'
