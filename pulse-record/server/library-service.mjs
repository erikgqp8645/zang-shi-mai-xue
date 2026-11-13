/**
 * 用方知识库 · 运行时编辑服务层（网站端 ③ 的「编辑／删除」走这里）
 *
 * ## 这一层是什么
 *
 * 覆盖层（`library_items` 表）一直只有**命令行**能写
 * （`npm run admin -- library set/del/restore/revive`）。
 * 这一层把那三个动词**原样**搬成 HTTP 接口，让管理员在 ③ 知识库里直接改。
 *
 * ⭐ **语义必须与命令行一模一样** —— 两边是同一份数据、同一套校验、同一套合并：
 *   · `set`    → 本层的 `patchLibraryEntry`（字段级改）
 *   · `del`    → 本层的 `deleteLibraryEntry`（写墓碑，带原内容快照）
 *   · `restore`→ 本层的 `restoreLibraryEntry`（删覆盖行 → 回基线）
 *   · `revive` → 本层的 `reviveLibraryEntry`（把删掉的放回来）
 *
 * ⚠️ **不要在这里发明新语义** —— 命令行那边已经定死了（见
 *   `scripts/lib/library-cli.mjs` 的 cmdSet／cmdDel／cmdRestore／cmdRevive 注释）。
 *   两边语义一漂，「网站里删了、命令行 apply 之后又冒出来」这种坑就来了。
 *
 * ## 权限
 *
 * 写操作由 `server/index.mjs` 的 **admin 闸门**把着（`role === 'admin'`）；
 * 这一层只管业务，不管权限。读接口（overrides／kinds）**不设闸门** ——
 * 知识库是公共资料，不同账号看到的必须是同一份。
 *
 * ## 不自动固化
 *
 * 这一层只写覆盖层，**不动 `src/content/*.json`**（仓库里的基线）。
 * 要把改动固化进基线，须人明确执行 `npm run admin -- library apply`。
 */

import { readContent } from './content-store.mjs'
import {
  LIBRARY_KINDS,
  effectiveEntry,
  groupOverrides,
  kindNames,
  kindSpec,
  readBaseline,
  validateEntry,
  validateRulePatterns,
} from './library-schema.mjs'
import { deleteLibraryItem, listLibraryItems, putLibraryItem } from './store.mjs'

/**
 * 本轮开放的种类。
 *
 * 覆盖层注册表里有六类，但网站端 ③ 只碰得着两类：
 *   · `rule` —— 讲义 p44 依脉用方（61 条）
 *   · `drug` —— 讲稿 2010 方剂（30 方）
 *
 * 其余四类（p42 对照表／同和堂版成方／科中／科中↔成方映射）**本轮不做**：
 * 它们不显示在 ③ 里，也没有对应的编辑面 ⇒ 接口明确拒，别让人以为「改了没反应」。
 */
export const RUNTIME_EDITABLE_KINDS = ['rule', 'drug']

/** 带 HTTP 状态码的业务错误（index.mjs 据此回响应） */
export class LibraryError extends Error {
  /**
   * @param {number} status HTTP 状态码
   * @param {string} message 给人看的原因
   */
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/* ------------------------------------------------------------------ *
 * 基线                                                                    *
 * ------------------------------------------------------------------ */

/**
 * 读「内置基线」（文件包形状：`{ 'formula-rules.json': {...}, ... }`）。
 *
 * ⚠️ **两个来源，按环境分派**：
 *   · 本地（仓库里）→ `src/content/*.json` 快照（与前端编译进去的**同一份**）
 *   · 云函数        → 远端 PG 的**已发布**内容（包里不带仓库）
 *
 * 为什么服务端也要有基线：PATCH 要以「**当前生效的那条**」为底合并，
 * 而「当前生效的那条」＝ 基线 ⊕ 现有覆盖 ⇒ 得先有基线。
 *
 * ⚠️ 云函数里 `src/content/*.json` **没有**打进包（`scripts/build-cloudfunction.mjs`
 *   只拷 schema），所以走 PG 那条路。
 *
 * @returns {Promise<object>} `{ 'formula-rules.json': {...}, 'drugs.json': {...}, ... }`
 */
export async function readLibraryBaseline() {
  try {
    return readBaseline()
  } catch {
    // 云函数：仓库里没有基线文件 ⇒ 读远端已发布内容
    const pack = await readContent()
    const files = {}
    for (const [name, obj] of Object.entries(pack?.content ?? {})) {
      // ⚠️ PG 内容包的键不带 `.json`（'formula-rules'），而合并函数按文件名找
      //    （'formula-rules.json'）⇒ 这里补上后缀，两边才对得上。
      files[`${name}.json`] = obj
    }
    if (Object.keys(files).length === 0) {
      throw new Error('内容包是空的')
    }
    return files
  }
}

/* ------------------------------------------------------------------ *
 * 注册表                                                                  *
 * ------------------------------------------------------------------ */

/**
 * 「什么能改」的注册表（给前端做表单用）。
 *
 * ⓘ 前端**不硬编码字段表** —— 表单由这份数据驱动 ⇒ 字段表只有一处真源。
 *
 * @returns {object} `{ [kind]: { label, idField, fields: [...], ... } }`
 */
export function libraryKindsPayload() {
  const out = {}
  for (const kind of kindNames()) {
    const spec = LIBRARY_KINDS[kind]
    out[kind] = {
      label: spec.label,
      idField: spec.idField,
      idType: spec.idType,
      container: spec.container,
      addable: spec.addable,
      deletable: spec.deletable,
      fields: spec.fields,
      blocked: spec.blocked ?? null,
      /** 本轮这个类开不开放网站端编辑 */
      runtimeEditable: RUNTIME_EDITABLE_KINDS.includes(kind),
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * 小工具                                                                  *
 * ------------------------------------------------------------------ */

/** 从基线里取某一条（不管覆盖层） —— 与命令行 `baselineEntryOf` 同款 */
function baselineEntryOf(baseline, spec, itemId) {
  const container = baseline[spec.file]?.[spec.key]
  if (spec.container === 'object') {
    const value = container?.[String(itemId)]
    if (value === undefined) return null
    return { doseId: String(itemId), science: String(value) }
  }
  const hit = (container ?? []).find((e) => String(e?.[spec.idField] ?? '') === String(itemId))
  return hit ?? null
}

/** 取一类（＋id）的登记信息；不认识就抛 400 */
function mustKind(kind) {
  const spec = kindSpec(String(kind ?? ''))
  if (!spec) {
    throw new LibraryError(400, `未知的类「${kind ?? ''}」。\n  可用：${kindNames().join('／')}`)
  }
  if (!RUNTIME_EDITABLE_KINDS.includes(String(kind))) {
    throw new LibraryError(
      400,
      `「${spec.label}」这一类本轮不开放在网站端编辑。\n` +
        `  现在开放的：${RUNTIME_EDITABLE_KINDS.join('／')}\n` +
        `  其余的仍走命令行：npm run admin -- library set ${kind} <id> --set 字段=值`,
    )
  }
  return spec
}

/* ------------------------------------------------------------------ *
 * 四个动作                                                                *
 * ------------------------------------------------------------------ */

/**
 * **新增一条**（网站端「＋ 新增条目」）。
 *
 * ## 为什么 p44 条目以前不能新增，现在还行了
 *
 * 原来：命中判定写死在 `src/domain/formulas.ts` 的 `EVALUATORS` 里，
 * 新建的条目没有判定函数 ⇒ 前端载入直接报错 ⇒ 从根上禁止。
 *
 * 现在：新条目走**「画图即条件」** —— 条目自带 `patterns`（脉象图），
 * 前端 `loadRules` 用这张图现场建判定（`src/domain/pulse-pattern.ts` 的 `evaluatePattern`）。
 * ⇒ 服务端只认**带非空脉象图**的新增；没图的当场拒（那种条目永远不命中）。
 *
 * ## 语义
 *
 * · 与命令行 `library add` 是同一件事：写覆盖层一行（`deleted=0`）。
 * · `id` 不许与基线或现有效果重名（重名 ＝ 编辑，不是新增）。
 * · 字段按注册表校验；`knownKeys` 传空集 —— **新条目不许带没登记的字段**。
 *
 * @param {object} db
 * @param {string} kind  `rule` ｜ `drug`
 * @param {object} entry 完整条目（含 id）
 * @param {string} by    新增的人（登录名）
 * @returns {Promise<{ entry: object }>}
 */
export async function createLibraryEntry(db, kind, entry, by) {
  const spec = mustKind(kind)

  if (!spec.addable) {
    throw new LibraryError(
      400,
      `${spec.label}不支持新增。\n${spec.blocked?.add ?? ''}`,
    )
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new LibraryError(400, '请求体要含条目（对象）')
  }

  const itemId = String(entry[spec.idField] ?? '').trim()
  if (!itemId) throw new LibraryError(400, `缺少${spec.idField}`)
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(itemId)) {
    throw new LibraryError(
      400,
      `${spec.idField}「${itemId}」不合法：只能用字母、数字、下划线、短横线，长度 2~64`,
    )
  }

  const baseline = await readLibraryBaseline()
  const overrides = groupOverrides(await listLibraryItems(db))
  const eff = effectiveEntry(baseline, overrides, kind, itemId)
  if (eff.entry) {
    throw new LibraryError(409, `「${itemId}」已经存在了 —— 要改它请用编辑。`)
  }
  if (eff.deleted) {
    throw new LibraryError(
      409,
      `「${itemId}」是一条被删掉的条目 —— 要放回来请用「撤销删除」，不要当新增重写。`,
    )
  }

  // 「画图即条件」：p44 新条目必须自带**能用**的脉象图
  // ⓘ 校验本身在 `library-schema.mjs` 的 `validateRulePatterns()` ——
  //   命令行 `library add` 用的是同一份，两处不会漂移。
  if (kind === 'rule') {
    const patternErrors = validateRulePatterns(entry.patterns)
    if (patternErrors.length > 0) {
      throw new LibraryError(400, patternErrors.join('\n  · '))
    }
  }

  const next = { ...entry, [spec.idField]: itemId }
  // knownKeys 传空集：**新条目不许带没登记的字段**
  const errors = validateEntry(kind, next)
  if (errors.length > 0) {
    throw new LibraryError(400, `这条加不了：\n  · ${errors.join('\n  · ')}`)
  }

  const ok = await putLibraryItem(db, kind, itemId, next, {
    deleted: 0,
    updatedBy: by,
    note: '网站端新增',
  })
  if (!ok) throw new LibraryError(500, '写进数据库失败了')

  return { entry: next }
}

/**
 * **改一条**（＝ 命令行 `library set --set 字段=值`）。
 *
 * 字段级改：以「**当前生效的那条**」为底，把传上来的字段盖上去，
 * 校验通过后**整条**存成覆盖层的一行。
 *
 * ⚠️ 「整条存」但「按字段改」不是一回事：
 *   存的是合并后的整条（覆盖层语义＝有行就整条接管），
 *   改的是**请求里那几个字段** —— 其余字段一字不动。
 *
 * @param {object} db
 * @param {string} kind  `rule` ｜ `drug`
 * @param {string} id
 * @param {object} patch  要改的字段（只有这几个字段会被改）
 * @param {string} by  改的人（登录名）
 * @returns {Promise<{ entry: object, changed: string[] }>}
 */
export async function patchLibraryEntry(db, kind, id, patch, by) {
  const spec = mustKind(kind)
  const itemId = String(id ?? '').trim()
  if (!itemId) throw new LibraryError(400, '缺少条目 id')

  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new LibraryError(400, '请求体要含 patch（要改的字段）')
  }
  const patchKeys = Object.keys(patch)
  if (patchKeys.length === 0) {
    throw new LibraryError(400, 'patch 是空的 —— 没有要改的字段')
  }

  const baseline = await readLibraryBaseline()
  const overrides = groupOverrides(await listLibraryItems(db))
  const eff = effectiveEntry(baseline, overrides, kind, itemId)

  if (eff.deleted) {
    throw new LibraryError(
      409,
      `「${spec.label}」这一条已经被删掉了，改它之前先撤销删除（restore）。`,
    )
  }
  if (!eff.entry) {
    throw new LibraryError(
      404,
      `基线里没有「${kind} ${itemId}」这一条 —— 本轮不开放新增（p44 新增要配判定函数）。`,
    )
  }

  // 只允许改注册表登记过的字段；`id` 明确不许改（改 id ＝ 删了重加）
  const fieldKeys = new Set(spec.fields.map((f) => f.key))
  for (const k of patchKeys) {
    if (k === spec.idField) {
      throw new LibraryError(
        400,
        `「${spec.idField}」不能改 —— 改它等于删掉这一条再重加一条，本轮不开放新增。`,
      )
    }
    if (!fieldKeys.has(k)) {
      throw new LibraryError(
        400,
        `「${k}」不是${spec.label}的可编辑字段。\n  能改的字段：${spec.fields.map((f) => f.key).join('、')}`,
      )
    }
  }

  const before = eff.entry
  const next = { ...before, ...patch }

  // 校验：基线里本来就有的、但没登记的字段放行（保留原样）；凭空新加的拒绝
  const knownKeys = new Set(Object.keys(baselineEntryOf(baseline, spec, itemId) ?? {}))
  const errors = validateEntry(kind, next, { knownKeys })
  if (errors.length > 0) {
    throw new LibraryError(400, `这条改不了：\n  · ${errors.join('\n  · ')}`)
  }

  const ok = await putLibraryItem(db, kind, itemId, next, {
    deleted: 0,
    updatedBy: by,
    note: '网站端编辑',
  })
  if (!ok) throw new LibraryError(500, '写进数据库失败了')

  const changed = patchKeys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(next[k]))
  return { entry: next, changed }
}

/**
 * **删一条**（＝ 命令行 `library del`）：写墓碑 ＋ 存原内容快照。
 *
 * ⚠️ 墓碑里**必须带原内容快照** —— 否则 `revive` 放不回来
 *   （基线一旦 apply 过去，基线里本来就没有这一条了）。
 *
 * @returns {Promise<{ id: string, kind: string, snapshot: object }>}
 */
export async function deleteLibraryEntry(db, kind, id, by) {
  const spec = mustKind(kind)
  const itemId = String(id ?? '').trim()
  if (!itemId) throw new LibraryError(400, '缺少条目 id')

  const baseline = await readLibraryBaseline()
  const overrides = groupOverrides(await listLibraryItems(db))
  const eff = effectiveEntry(baseline, overrides, kind, itemId)
  const ov = overrides[kind]?.[itemId]
  if (!eff.entry && !eff.deleted) {
    throw new LibraryError(404, `没有「${kind} ${itemId}」这一条`)
  }

  /**
   * **原条目快照** —— 墓碑行里带着它，恢复时才有东西可放回去。
   * 与命令行同款：基线里还在 → 取基线那份；基线已没有 → 取覆盖层存着的那份。
   */
  const snapshot = baselineEntryOf(baseline, spec, itemId) ?? ov?.payload ?? eff.entry ?? {}

  const ok = await putLibraryItem(db, kind, itemId, snapshot, {
    deleted: 1,
    updatedBy: by,
    note: '网站端删除',
  })
  if (!ok) throw new LibraryError(500, '写进数据库失败了')

  return { id: itemId, kind, snapshot, hasSnapshot: Object.keys(snapshot).length > 0 }
}

/**
 * **恢复默认**（＝ 命令行 `library restore`）：删掉覆盖层这一行 → 回到基线。
 *
 * ⚠️ 与 `revive` 的分工（别搞混）：
 *   · `restore` 撤的是「覆盖层这一行」
 *   · `revive`  撤的是「**那一次删除**」，把删掉的条目放回来
 */
export async function restoreLibraryEntry(db, kind, id) {
  mustKind(kind)
  const itemId = String(id ?? '').trim()
  const overrides = groupOverrides(await listLibraryItems(db))
  const ov = overrides[kind]?.[itemId]
  if (!ov) {
    throw new LibraryError(404, `「${kind} ${itemId}」本来就没有被改过 —— 不用恢复默认`)
  }
  const ok = await deleteLibraryItem(db, kind, itemId)
  if (!ok) throw new LibraryError(500, '写进数据库失败了')
  return { id: itemId, kind, wasDeleted: !!ov.deleted }
}

/**
 * **撤销删除**（＝ 命令行 `library revive`）：把墓碑里的快照放回去。
 *
 * 靠墓碑行里存着的**原内容快照**放回来 ⇒ 哪怕 apply 已经把基线写掉了，
 * 快照还在，放回来的内容一字不差。
 */
export async function reviveLibraryEntry(db, kind, id, by) {
  mustKind(kind)
  const itemId = String(id ?? '').trim()
  const overrides = groupOverrides(await listLibraryItems(db))
  const ov = overrides[kind]?.[itemId]
  if (!ov) {
    throw new LibraryError(404, `「${kind} ${itemId}」没有覆盖记录 —— 它没被删过，不用撤销`)
  }
  if (!ov.deleted) {
    throw new LibraryError(
      400,
      `「${kind} ${itemId}」没被删过（只是被改过）—— 那种情况用「恢复默认」。`,
    )
  }
  if (!ov.payload || Object.keys(ov.payload).length === 0) {
    throw new LibraryError(
      400,
      `「${kind} ${itemId}」的墓碑里没有原内容快照，放不回来。\n` +
        `  只能手工加回去：npm run admin -- library add ${kind} --file <条目>.json`,
    )
  }
  const ok = await putLibraryItem(db, kind, itemId, ov.payload, {
    deleted: 0,
    updatedBy: by,
    note: '网站端撤销删除',
  })
  if (!ok) throw new LibraryError(500, '写进数据库失败了')
  return { id: itemId, kind, entry: ov.payload }
}
