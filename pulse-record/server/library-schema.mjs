/**
 * 用方知识库 · 内容种类注册表 ＋ 合并规则
 *
 * ## 这份文件是什么
 *
 * 后端唯一的「什么能改、什么不能改」真源。
 *
 * 这一轮前端不改（内容是**编译期内联**的，见 src/domain/*.ts 的 `import x from '../content/x.json'`），
 * 所以 AGENTS.md 里的资料纪律 —— **方名照录不改写、剂量单位不换算、没写明的就留空不臆造** ——
 * 得由这一层兜住：管理员在命令行里改的每一个字，都要先过这里的校验，才允许落进 SQLite。
 *
 * ## 它管三件事
 *
 * 1. **注册表**（`LIBRARY_KINDS`）：每一类内容住在哪个文件、哪个顶层键、主键是什么、
 *    哪些字段能改、能不能新增／删除。
 * 2. **校验**：字段层（必填／类型／枚举）＋ 主键层（空主键／重复主键）＋ 引用层（悬空引用）。
 * 3. **合并**：把「管理员覆盖层」叠加到「内置基线」上，得出最终内容。
 *
 * ## 覆盖层语义（与 server/db.mjs 的 formula_patterns 同一套，不发明第二套）
 *
 *   · 有行且 deleted=0 → 用这一行的 payload **整条接管**该基线条目
 *   · 有行且 deleted=1 → **墓碑**：该条目在结果里消失
 *   · 没有行           → 保持内置基线
 *
 * 为什么要墓碑：覆盖层是「有行就用覆盖层」。若删除只表现为「没有行」，
 * 读回来就等于「没改过」→ 静默回落到基线，管理员刚删掉的条目又冒出来。
 *
 * ## 与 store.mjs「ownerId 必填」的关系
 *
 * 这张表**没有 owner_id** —— 是有意例外：���方知识库是**公共资料**不是个人数据，
 * 管理员改一次，所有账号看到同一份（用户 2026-11-11 拍板：多人模式下所有账号共享一份）。
 * 例外的理由写在 server/store.mjs 的契约表里，这里不再重复。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** pulse-record/ 根目录（与 server/db.mjs 同一个算法） */
export const ROOT = join(here, '..')

/** 内置基线所在目录：src/content/ */
export const DEFAULT_CONTENT_DIR = join(ROOT, 'src', 'content')

/**
 * 「未载」哨兵 —— 某套资料里没有这一项时的标准写法。
 *
 * AGENTS.md 引用纪律第 3 条：「没有写明的就不对照，宁可留空并写『未载』」。
 * 它同时是**引用校验里的合法值**：值等于「未载」表示「原来有、现在没有了」，
 * 不算悬空引用。
 */
export const NOT_CARRIED = '未载'

/* ------------------------------------------------------------------ *
 * 注册表
 * ------------------------------------------------------------------ */

/**
 * 每一类内容的登记信息。
 *
 * · `file`      —— 基线文件名（在 src/content/ 下）
 * · `key`       —— 该类住在那个文件的哪个顶层键
 * · `container` —— 'array'（数组）｜ 'object'（键值映射）
 * · `idField`   —— 主键字段名；container='object' 时指的是**映射的键**
 * · `idType`    —— 'string' ｜ 'number'
 * · `addable` / `deletable` —— 允许新增／删除吗
 * · `fields`    —— 可编辑字段表（**没列的字段不许凭空加**）
 * · `blocked`   —— 不允许时的**人话原因**（直接打给管理员看）
 */
export const LIBRARY_KINDS = {
  rule: {
    label: '讲义 p44 依脉用方',
    file: 'formula-rules.json',
    key: 'rules',
    container: 'array',
    idField: 'id',
    idType: 'string',
    addable: false,
    deletable: false,
    fields: [
      { key: 'id', type: 'string', required: true },
      { key: 'route', type: 'string', required: true },
      { key: 'condition', type: 'string', required: true },
      { key: 'therapy', type: 'string', required: true },
      { key: 'formulas', type: 'string[]', required: true },
      { key: 'adds', type: 'string[]' },
      { key: 'drugs', type: 'string[]' },
      { key: 'source', type: 'string', required: true },
      { key: 'quote', type: 'string', required: true },
      { key: 'kind', type: 'enum', values: ['主线', '挡路', '加味', '禁忌'], required: true },
      { key: 'always', type: 'boolean' },
    ],
    blocked: {
      add:
        '讲义 p44「依脉用方」不能在这里新增。\n' +
        '  原因：命中判定的逻辑写在代码里（pulse-record/src/domain/formulas.ts 的 EVALUATORS），\n' +
        '        规则数据与判定函数必须一一对应，缺一个前端就起不来。\n' +
        '  这属于前端改动，本轮不做。\n' +
        '  可以做的：先把这条作为「讲稿方剂」（kind=drug）加进来 —— 那部分是纯数据。',
      del:
        '讲义 p44「依脉用方」不能在这里删除。\n' +
        '  原因：判定函数表（src/domain/formulas.ts 的 EVALUATORS）里还留着这一条，\n' +
        '        数据没了而函数还在，前端启动就报错。\n' +
        '  要下线这一条，得同时改那份代码 —— 属于前端改动，本轮不做。',
    },
  },

  drug: {
    label: '讲稿 2010 方剂',
    file: 'drugs.json',
    key: 'drugs',
    container: 'array',
    idField: 'id',
    idType: 'string',
    addable: true,
    deletable: true,
    fields: [
      { key: 'id', type: 'string', required: true },
      { key: 'name', type: 'string', required: true },
      { key: 'therapy', type: 'enum', values: ['一体疗法', '三焦疗法', '五脏疗法'], required: true },
      { key: 'composition', type: 'string' },
      { key: 'usage', type: 'string' },
      { key: 'science', type: 'string' },
      { key: 'adjustments', type: 'string' },
      { key: 'indication', type: 'string' },
      { key: 'contraindication', type: 'string' },
      { key: 'source', type: 'string', required: true },
      { key: 'quote', type: 'string' },
    ],
  },

  ref: {
    label: '讲义 p42 对照表',
    file: 'formula-reference.json',
    key: 'rows',
    container: 'array',
    idField: 'no',
    idType: 'number',
    addable: true,
    deletable: true,
    fields: [
      { key: 'no', type: 'positiveInt', required: true },
      { key: 'name', type: 'string', required: true },
      { key: 'indication', type: 'string', required: true },
      { key: 'doseId', type: 'string' },
      { key: 'doseBasis', type: 'string' },
      { key: 'draftName', type: 'string' },
      { key: 'draftNote', type: 'string' },
    ],
  },

  dose: {
    label: '同和堂版成方（克）',
    file: 'doses.json',
    key: 'doses',
    container: 'array',
    idField: 'id',
    idType: 'string',
    addable: true,
    deletable: true,
    fields: [
      { key: 'id', type: 'string', required: true },
      { key: 'name', type: 'string', required: true },
      { key: 'composition', type: 'string', required: true },
      { key: 'notes', type: 'string' },
      { key: 'page', type: 'page', required: true },
    ],
  },

  science: {
    label: '科中（科学中药比例）',
    file: 'doses.json',
    key: 'sciences',
    container: 'array',
    idField: 'id',
    idType: 'string',
    addable: true,
    deletable: true,
    fields: [
      { key: 'id', type: 'string', required: true },
      { key: 'name', type: 'string', required: true },
      { key: 'ratio', type: 'string', required: true },
      { key: 'page', type: 'page', required: true },
    ],
  },

  sciencemap: {
    label: '科中 ↔ 成方 映射',
    file: 'doses.json',
    key: 'scienceByDoseId',
    container: 'object',
    idField: 'doseId',
    idType: 'string',
    addable: true,
    deletable: true,
    fields: [
      { key: 'doseId', type: 'string', required: true },
      { key: 'science', type: 'string', required: true },
    ],
  },
}

/** 所有种类名（固定顺序） */
export function kindNames() {
  return Object.keys(LIBRARY_KINDS)
}

/** 取某一类的登记信息；种类不认识就返回 null */
export function kindSpec(kind) {
  return LIBRARY_KINDS[kind] ?? null
}

/** 一次说清所有种类（给 --help 用） */
export function describeKinds() {
  return kindNames()
    .map((k) => {
      const s = LIBRARY_KINDS[k]
      const caps = []
      caps.push(s.addable ? '可增' : '不可增')
      caps.push(s.deletable ? '可删' : '不可删')
      return `  ${k.padEnd(12)} ${s.label}｜${s.file} → ${s.key}｜${caps.join('，')}`
    })
    .join('\n')
}

/* ------------------------------------------------------------------ *
 * 校验
 * ------------------------------------------------------------------ */

/** 键顺序无关的稳定序列化（用来判断「这条到底改了没有」） */
export function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stableStringify(value[k]))
        .join(',') +
      '}'
    )
  }
  return JSON.stringify(value)
}

/** 两个条目是否「一样」（键顺序不算差别） */
export function sameEntry(a, b) {
  return stableStringify(a) === stableStringify(b)
}

/**
 * 字段层校验。
 *
 * @param {string} kind      种类名
 * @param {object} entry     待校验的条目
 * @param {object} [opts]
 * @param {Set<string>} [opts.knownKeys]  允许出现的**额外**字段名
 *   （基线里本来就有、但不在注册表里的字段 —— 保留原样，不算错；
 *    但管理员**不能凭空新增**这种字段）
 * @returns {string[]} 错误说明（空数组＝通过）
 */
export function validateEntry(kind, entry, opts = {}) {
  const spec = kindSpec(kind)
  const errors = []
  if (!spec) return [`未知的种类「${kind}」（可用：${kindNames().join('／')}）`]
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ['条目必须是一个对象']

  const known = opts.knownKeys instanceof Set ? opts.knownKeys : new Set()

  for (const f of spec.fields) {
    const v = entry[f.key]
    const missing = v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
    if (missing) {
      if (f.required) errors.push(`缺少必填字段「${f.key}」`)
      continue
    }
    switch (f.type) {
      case 'string':
        if (typeof v !== 'string') errors.push(`字段「${f.key}」必须是文字`)
        break
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`字段「${f.key}」必须是数字`)
        break
      case 'positiveInt':
        if (!Number.isInteger(v) || v <= 0) errors.push(`字段「${f.key}」必须是正整数`)
        break
      case 'boolean':
        if (typeof v !== 'boolean') errors.push(`字段「${f.key}」必须是 true／false`)
        break
      case 'string[]':
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
          errors.push(`字段「${f.key}」必须是文字数组`)
        }
        break
      case 'enum':
        if (!f.values.includes(v)) {
          errors.push(`字段「${f.key}」只能是：${f.values.join('／')}（现在是「${v}」）`)
        }
        break
      case 'page':
        if (!Number.isInteger(v) || v < 1 || v > 4) {
          errors.push(`字段「${f.key}」必须是 1~4 的整数（同和堂版共 4 页）`)
        }
        break
      default:
        errors.push(`字段「${f.key}」的类型「${f.type}」没登记 —— 后端自己坏了`)
    }
  }

  // 没登记的字段：基线里本来有的放行，管理员新加的拒绝
  const fieldKeys = new Set(spec.fields.map((f) => f.key))
  for (const k of Object.keys(entry)) {
    if (fieldKeys.has(k)) continue
    if (known.has(k)) continue
    errors.push(`字段「${k}」不在本类的可编辑字段表里 —— 不许凭空加字段`)
  }

  return errors
}

/** 主键层校验：空主键／重复主键 */
export function validatePrimaryKeys(kind, entries) {
  const spec = kindSpec(kind)
  const errors = []
  const seen = new Set()
  for (const entry of entries) {
    const raw = spec.container === 'object' ? entry?.doseId : entry?.[spec.idField]
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      errors.push('有一条没有主键')
      continue
    }
    const id = String(raw)
    if (seen.has(id)) errors.push(`主键「${id}」重复`)
    seen.add(id)
  }
  return errors
}

/* ------------------------------------------------------------------ *
 * 基线读写
 * ------------------------------------------------------------------ */

/** 读一个 JSON 文件（去掉 BOM） */
function readJsonFile(path) {
  const raw = readFileSync(path, 'utf8')
  return JSON.parse(raw.replace(/^\uFEFF/, ''))
}

/**
 * 读内置基线（src/content/*.json）。
 *
 * @param {string} [contentDir]
 * @returns {object} `{ 'formula-rules.json': {...}, 'drugs.json': {...}, ... }`
 */
export function readBaseline(contentDir = DEFAULT_CONTENT_DIR) {
  const files = {}
  for (const kind of kindNames()) {
    const spec = LIBRARY_KINDS[kind]
    if (spec.file in files) continue
    const path = join(contentDir, spec.file)
    if (!existsSync(path)) {
      throw new Error(`找不到基线文件：${path}`)
    }
    files[spec.file] = readJsonFile(path)
  }
  return files
}

/**
 * 写回基线文件。
 *
 * **行尾跟随原文件**：原来用 CRLF 就写 CRLF，用 LF 就写 LF
 * （仓库里 git 的 autocrlf 会把工作区文件 checkout 成 CRLF，
 *   而 scripts/excel_to_json.py 写出的是 LF —— 两种都得对得上，
 *   否则「空覆盖层 apply 之后逐字节未变」这条验收就过不了）。
 *
 * 序列化格式与 scripts/excel_to_json.py 完全一致
 * （`json.dumps(..., ensure_ascii=False, indent=2)` ＋ 末尾换行）。
 */
export function writeBaseline(contentDir, files) {
  const written = []
  for (const [name, obj] of Object.entries(files)) {
    const path = join(contentDir, name)
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
    const eol = existing.includes('\r\n') ? '\r\n' : existing ? '\n' : '\r\n'
    const text = JSON.stringify(obj, null, 2).split('\n').join(eol) + eol
    writeFileSync(path, text, 'utf8')
    written.push({ name, path, bytes: Buffer.byteLength(text, 'utf8'), eol: eol === '\r\n' ? 'CRLF' : 'LF' })
  }
  return written
}

/* ------------------------------------------------------------------ *
 * 覆盖层
 * ------------------------------------------------------------------ */

/**
 * 把数据库里的覆盖层行按种类分组。
 *
 * @param {Array<object>} rows  `kind | item_id | payload | deleted | updated_at | updated_by | note`
 * @returns {object} `{ [kind]: { [item_id]: { payload, deleted, updatedAt, updatedBy, note } } }`
 */
export function groupOverrides(rows) {
  const out = {}
  for (const kind of kindNames()) out[kind] = {}
  for (const r of rows ?? []) {
    const kind = String(r.kind ?? '')
    if (!(kind in out)) continue
    let payload = null
    const raw = String(r.payload ?? '')
    if (raw) {
      try {
        payload = JSON.parse(raw)
      } catch {
        payload = null // 坏行：合并时会被当成「这条没改过」，并在 verify 里报出来
      }
    }
    out[kind][String(r.item_id ?? '')] = {
      payload,
      deleted: Number(r.deleted) === 1,
      updatedAt: r.updated_at ?? null,
      updatedBy: r.updated_by ?? null,
      note: r.note ?? null,
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * 合并
 * ------------------------------------------------------------------ */

/**
 * 合并一类：基线容器 ＋ 覆盖层 → 新容器。
 *
 * @returns {{ container: any, added: string[], changed: string[], removed: string[], bad: string[] }}
 */
export function mergeKind(spec, container, overridesForKind) {
  const added = []
  const changed = []
  const removed = []
  const bad = []

  if (spec.container === 'object') {
    const map = new Map(Object.entries(container ?? {}))
    for (const [itemId, ov] of Object.entries(overridesForKind ?? {})) {
      if (ov.deleted) {
        map.delete(itemId)
        removed.push(itemId)
        continue
      }
      if (!ov.payload || typeof ov.payload !== 'object') {
        bad.push(itemId)
        continue
      }
      const before = map.get(itemId)
      const value = String(ov.payload.science ?? '')
      if (before === undefined) added.push(itemId)
      else if (before !== value) changed.push(itemId)
      map.set(itemId, value)
    }
    return { container: Object.fromEntries(map), added, changed, removed, bad }
  }

  const map = new Map()
  for (const entry of Array.isArray(container) ? container : []) {
    const id = String(entry?.[spec.idField] ?? '')
    map.set(id, entry)
  }
  for (const [itemId, ov] of Object.entries(overridesForKind ?? {})) {
    if (ov.deleted) {
      map.delete(itemId)
      removed.push(itemId)
      continue
    }
    if (!ov.payload || typeof ov.payload !== 'object' || Array.isArray(ov.payload)) {
      bad.push(itemId)
      continue
    }
    const before = map.get(itemId)
    if (before === undefined) added.push(itemId)
    else if (!sameEntry(before, ov.payload)) changed.push(itemId)
    map.set(itemId, ov.payload)
  }
  return { container: [...map.values()], added, changed, removed, bad }
}

/**
 * 级联清理：删掉一个东西，引用它的那些怎么办。
 *
 * 全部按 AGENTS.md 的规矩来 —— **宁可留空并写「未载」，不臆造**：
 *   · 删了讲稿方剂 → 讲义 p44 里引用它的 drugs[] 移除该 id
 *   · 删了成方     → 讲义 p42 的 doseId 置空、doseBasis 标「未载」；科中映射里那一项删掉
 *   · 删了科中     → 科中映射里的值写成「未载」
 *
 * @param {object} files     合并后的文件内容（就地改）
 * @param {object} removed   `{ [kind]: string[] }`
 * @returns {string[]} 这次级联做了什么（给人看的说明）
 */
export function cascadeCleanup(files, removed) {
  const notes = []
  const rules = files['formula-rules.json']?.rules ?? []
  const rows = files['formula-reference.json']?.rows ?? []
  const dosesFile = files['doses.json'] ?? {}
  const scienceMap = dosesFile.scienceByDoseId ?? {}

  // 删了讲稿方剂 → p44 的 drugs[] 里去掉这个 id
  for (const drugId of removed.drug ?? []) {
    for (const rule of rules) {
      if (!Array.isArray(rule.drugs)) continue
      const before = rule.drugs.length
      rule.drugs = rule.drugs.filter((d) => String(d) !== String(drugId))
      if (rule.drugs.length !== before) {
        notes.push(`讲义 p44「${rule.id}」的 drugs[] 去掉了已被删除的讲稿方剂「${drugId}」`)
      }
    }
  }

  // 删了成方 → p42 的 doseId 置空并标「未载」；科中映射里那一项删掉
  for (const doseId of removed.dose ?? []) {
    for (const row of rows) {
      if (String(row.doseId ?? '') !== String(doseId)) continue
      row.doseId = ''
      const mark = `未载（原 doseId=${doseId} 已删除）`
      row.doseBasis = row.doseBasis ? `${mark}；${row.doseBasis}` : mark
      notes.push(`讲义 p42 第 ${row.no} 行的 doseId 已置空并标「未载」（成方「${doseId}」被删除）`)
    }
    if (Object.prototype.hasOwnProperty.call(scienceMap, doseId)) {
      delete scienceMap[doseId]
      notes.push(`科中映射里的「${doseId}」已删除（成方被删除）`)
    }
  }

  // 删了科中 → 科中映射里的值写成「未载」
  for (const scienceName of removed.science ?? []) {
    for (const [doseId, value] of Object.entries(scienceMap)) {
      if (String(value) !== String(scienceName)) continue
      scienceMap[doseId] = NOT_CARRIED
      notes.push(`科中映射「${doseId}」的科中名已写成「未载」（科中「${scienceName}」被删除）`)
    }
  }

  return notes
}

/**
 * 引用层校验（悬空引用）。
 *
 * 规则与 scripts/excel_to_json.py 一致：
 *   · p44 的 drugs[] 里每个 id 必须存在于讲稿方剂
 *   · p42 的 doseId 若非空，必须存在于同和堂版成方
 *   · 科中映射的键必须存在于成方；值必须存在于科中（或是「未载」）
 *
 * @returns {string[]} 错误说明（空数组＝通过）
 */
export function checkReferences(files) {
  const errors = []
  const rules = files['formula-rules.json']?.rules ?? []
  const rows = files['formula-reference.json']?.rows ?? []
  // 讲稿方剂在 drugs.json；成方／科中／科中↔成方映射在 doses.json（两个文件别弄混）
  const drugs = files['drugs.json']?.drugs ?? []
  const dosesFile = files['doses.json'] ?? {}
  const doses = dosesFile.doses ?? []
  const sciences = dosesFile.sciences ?? []
  const scienceMap = dosesFile.scienceByDoseId ?? {}

  // p44 的 drugs[] 指的是**讲稿方剂**（drugs.json 的 id）
  const drugIds = new Set(drugs.map((d) => String(d.id)))
  // p42 的 doseId 指的是**同和堂版成方**（doses.json 的 id）
  const doseIds = new Set(doses.map((d) => String(d.id)))
  const scienceNames = new Set(sciences.map((s) => String(s.name)))

  for (const rule of rules) {
    for (const d of rule.drugs ?? []) {
      if (!drugIds.has(String(d))) {
        errors.push(`讲义 p44「${rule.id}」引用了不存在的讲稿方剂「${d}」`)
      }
    }
  }
  for (const row of rows) {
    const doseId = String(row.doseId ?? '').trim()
    if (doseId && !doseIds.has(doseId)) {
      errors.push(`讲义 p42 第 ${row.no} 行指向不存在的成方「${doseId}」`)
    }
  }
  for (const [doseId, value] of Object.entries(scienceMap)) {
    if (!doseIds.has(String(doseId))) {
      errors.push(`科中映射「${doseId}」指向不存在的成方`)
    }
    const sci = String(value ?? '').trim()
    if (sci && sci !== NOT_CARRIED && !scienceNames.has(sci)) {
      errors.push(`科中映射「${doseId}」指向不存在的科中「${sci}」`)
    }
  }
  return errors
}

/**
 * p44 边界检查：覆盖层里**不许**出现讲义 p44 的新增／删除。
 *
 * 为什么：讲义 p44 依脉用方的命中判定是**代码**（src/domain/formulas.ts 的 EVALUATORS），
 * `loadRules` 做 JSON↔函数的双向校验，缺一即抛错 ——
 * 数据多一条而函数没有（或反过来），前端**启动就崩**。
 *
 * 所以：
 *   · 覆盖层里出现「基线没有的 p44 条目」→ 等于新增 → 拒绝
 *   · 覆盖层里把「基线有的 p44 条目」标成删除 → 等于删除 → 拒绝
 * 改字段是允许的（数据与函数一一对应没变）。
 *
 * @param {object} baselineFiles
 * @param {object} overrides
 * @returns {string[]} 错误说明（空数组＝通过）
 */
export function checkRuleBoundary(baselineFiles, overrides) {
  const errors = []
  const baseIds = new Set(
    (baselineFiles['formula-rules.json']?.rules ?? []).map((r) => String(r?.id ?? '')),
  )
  for (const [itemId, ov] of Object.entries(overrides?.rule ?? {})) {
    if (ov.deleted) {
      if (baseIds.has(itemId)) {
        errors.push(
          `覆盖层把讲义 p44 条目「${itemId}」标成了删除 —— ` +
            `判定函数表（src/domain/formulas.ts 的 EVALUATORS）里还留着它，前端会起不来`,
        )
      }
      continue
    }
    if (!baseIds.has(itemId)) {
      errors.push(
        `覆盖层新增了讲义 p44 条目「${itemId}」—— ` +
          `判定函数表里没有它，前端会起不来`,
      )
    }
  }
  return errors
}

/**
 * 全量合并：基线 ＋ 覆盖层 → 最终内容。
 *
 * @param {object} baselineFiles  readBaseline 的结果
 * @param {object} overrides      groupOverrides 的结果
 * @returns {{ files: object, report: object, errors: string[], notes: string[] }}
 */
export function mergeAll(baselineFiles, overrides) {
  // 深拷贝一份，改的是副本（基线对象不能被就地改掉）
  const files = JSON.parse(JSON.stringify(baselineFiles))
  const report = {}
  const removed = {}
  const bad = []

  for (const kind of kindNames()) {
    const spec = LIBRARY_KINDS[kind]
    const file = files[spec.file]
    const merged = mergeKind(spec, file[spec.key], overrides?.[kind] ?? {})
    file[spec.key] = merged.container
    report[kind] = { added: merged.added, changed: merged.changed, removed: merged.removed }
    removed[kind] = merged.removed
    for (const id of merged.bad) {
      bad.push(`${spec.label}：覆盖层里「${id}」这一条读不出来（JSON 坏了），已按「没改过」处理`)
    }
  }

  const notes = cascadeCleanup(files, removed)
  const errors = [...checkRuleBoundary(baselineFiles, overrides), ...checkReferences(files)]
  return { files, report, errors, notes, bad }
}

/* ------------------------------------------------------------------ *
 * 便捷查询
 * ------------------------------------------------------------------ */

/**
 * 取某一条的**当前有效值**（覆盖层优先，没有就用基线）。
 *
 * @param {object} baselineFiles
 * @param {object} overrides
 * @param {string} kind
 * @param {string} itemId
 * @returns {{ entry: object|null, from: 'override'|'baseline'|null, deleted: boolean }}
 */
export function effectiveEntry(baselineFiles, overrides, kind, itemId) {
  const spec = kindSpec(kind)
  if (!spec) return { entry: null, from: null, deleted: false }
  const ov = overrides?.[kind]?.[String(itemId)]
  if (ov) {
    if (ov.deleted) return { entry: null, from: 'override', deleted: true }
    if (ov.payload) return { entry: ov.payload, from: 'override', deleted: false }
  }
  const file = baselineFiles[spec.file]
  const container = file?.[spec.key]
  if (spec.container === 'object') {
    const value = container?.[String(itemId)]
    if (value === undefined) return { entry: null, from: null, deleted: false }
    return { entry: { doseId: String(itemId), science: String(value) }, from: 'baseline', deleted: false }
  }
  const hit = (container ?? []).find((e) => String(e?.[spec.idField] ?? '') === String(itemId))
  if (!hit) return { entry: null, from: null, deleted: false }
  return { entry: hit, from: 'baseline', deleted: false }
}

/** 某一类的全部当前有效条目（合并后的容器） */
export function effectiveEntries(files, kind) {
  const spec = kindSpec(kind)
  if (!spec) return []
  const container = files[spec.file]?.[spec.key]
  if (spec.container === 'object') {
    return Object.entries(container ?? {}).map(([doseId, science]) => ({ doseId, science }))
  }
  return container ?? []
}
