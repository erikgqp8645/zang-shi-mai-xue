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

/**
 * 合并与级联的**纯逻辑**在 `src/domain/library-core.mjs` —— 浏览器与 Node 共用同一份。
 *
 * ⓘ 为什么不是 `.ts`：云函数跑 Node 16／18／20，**不能 import `.ts`**；
 *   `.mjs` 谁都能跑。小程序那边只编译 `src/domain` 下的 `.ts` ⇒ 它进不了小程序产物。
 *
 * ⓘ 为什么「合并」要共用：网站端 ③ 显示的那一份，与命令行 `library apply`
 *   写进基线的那一份，必须**算出同一个结果** ⇒ 两边各写一份必然漂移。
 */
import {
  NOT_CARRIED,
  stableStringify,
  sameEntry,
  mergeKind,
  cascadeCleanup,
} from '../src/domain/library-core.mjs'

/** 纯逻辑的再导出 —— 既有 import 路径不变（CLI、断言脚本都从这里取） */
export { NOT_CARRIED, stableStringify, sameEntry, mergeKind, cascadeCleanup }

const here = dirname(fileURLToPath(import.meta.url))

/** pulse-record/ 根目录（与 server/db.mjs 同一个算法） */
export const ROOT = join(here, '..')

/** 内置基线所在目录：src/content/ */
export const DEFAULT_CONTENT_DIR = join(ROOT, 'src', 'content')

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
    addable: true,
    deletable: true,
    fields: [
      { key: 'id', label: '条目 id', type: 'string', required: true },
      { key: 'route', label: '所属讲次／路线', type: 'string', required: true },
      { key: 'condition', label: '条件', type: 'string', required: true },
      { key: 'therapy', label: '治法', type: 'string', required: true },
      { key: 'formulas', label: '方名（用哪些方）', type: 'string[]', required: true },
      { key: 'adds', label: '添加药', type: 'string[]' },
      { key: 'drugs', label: '关联的讲稿方剂 id', type: 'string[]' },
      { key: 'source', label: '出处', type: 'string', required: true },
      { key: 'quote', label: '原文', type: 'string', required: true, long: true },
      { key: 'kind', label: '类别', type: 'enum', values: ['主线', '挡路', '加味', '禁忌'], required: true },
      { key: 'always', label: '是否常驻条目', type: 'boolean' },
      // 「这一条要不要在用方知识库里显示」——
      // 2026-11-12 用户标注2：「这里每一条都可以单独编辑文字和是否显示」。
      // true＝显示；false＝知识库列表里不列这一条（**判读命中不受影响**）。
      // 不写＝按显示算（缺省显示），所以它不是必填。
      { key: 'visible', label: '是否在知识库里显示', type: 'boolean' },
      // 「画图即条件」：管理员新建的条目，**脉象图就是它的判定条件**
      // （src/domain/formulas.ts 的 loadRules：EVALUATORS 没有该 id 时，用这里的图建判定）。
      // 基线里的 61 条没有这个字段（判定在 EVALUATORS 里），不受影响。
      { key: 'patterns', label: '脉象图（新建条目的判定条件）', type: 'json' },
    ],
    // 2026-11-12：p44 条目**开放新增**了 —— 但只认「自带脉象图」的新增。
    // 图即判定（`src/domain/pulse-pattern.ts` 的 `evaluatePattern`）：
    //   有图 ⇒ 摸到图上标的格子就命中；
    //   没图 ⇒ 前端载入时会报错（没有判定函数的条目永远不命中），所以服务端先拒。
    blocked: {
      add:
        '新增讲义 p44 条目必须**同时带一张脉象图** —— 这张图就是它的命中条件。\n' +
        '  原因：老条目的判定写在代码里（pulse-record/src/domain/formulas.ts 的 EVALUATORS），\n' +
        '        新建条目走的是「画图即条件」：图上标了哪几格，摸到那几格就命中。\n' +
        '  在网站上新增时，新建弹层会把图一起提交，不必手动拼 JSON。',
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
      { key: 'id', label: '条目 id', type: 'string', required: true },
      { key: 'name', label: '方名（讲稿原名）', type: 'string', required: true },
      { key: 'therapy', label: '所属疗法', type: 'enum', values: ['一体疗法', '三焦疗法', '五脏疗法'], required: true },
      { key: 'composition', label: '组成', type: 'string', long: true },
      { key: 'usage', label: '服法', type: 'string', long: true },
      { key: 'science', label: '科学中药', type: 'string', long: true },
      { key: 'adjustments', label: '加减', type: 'string[]' },
      { key: 'indication', label: '适用脉象', type: 'string', long: true },
      { key: 'contraindication', label: '禁忌', type: 'string', long: true },
      { key: 'source', label: '出处', type: 'string', required: true },
      { key: 'quote', label: '原文', type: 'string' },
      // 「这一方要不要在用方知识库里显示」—— 同 rule 的 visible，语义一样。
      { key: 'visible', label: '是否在知识库里显示', type: 'boolean' },
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
      { key: 'no', label: '序号', type: 'positiveInt', required: true },
      { key: 'name', label: '讲义用名', type: 'string', required: true },
      { key: 'indication', label: '对应条件', type: 'string', required: true },
      { key: 'doseId', label: '同和堂版成方 id', type: 'string' },
      { key: 'doseBasis', label: '对照依据', type: 'string' },
      { key: 'draftName', label: '讲稿方剂名', type: 'string' },
      { key: 'draftNote', label: '对照备注', type: 'string', long: true },
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
      { key: 'id', label: '成方 id', type: 'string', required: true },
      { key: 'name', label: '成方名', type: 'string', required: true },
      { key: 'composition', label: '组成（克）', type: 'string', required: true, long: true },
      { key: 'notes', label: '附注', type: 'string[]', long: true },
      { key: 'page', label: '页码', type: 'page', required: true },
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
      { key: 'id', label: '科中 id', type: 'string', required: true },
      { key: 'name', label: '科中名', type: 'string', required: true },
      { key: 'ratio', label: '比例', type: 'string', required: true },
      { key: 'page', label: '页码', type: 'page', required: true },
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
      { key: 'doseId', label: '成方 id', type: 'string', required: true },
      { key: 'science', label: '科中名', type: 'string', required: true },
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
      case 'json':
        // 结构化字段（如新建条目的脉象图）。只要求是对象或数组 ——
        // 内部形状由各自的编辑器保证，这里不重复描述一遍。
        if (typeof v !== 'object') {
          errors.push(`字段「${f.key}」必须是对象或数组`)
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

/** 格键格式：`L|关|浮`（手｜部位｜取法）—— 与前端 `cellKey()` 同一套 */
const CELL_KEY_RE = /^[LR]\|(寸|关|尺)\|(浮|中|沉)$/

/**
 * 新增 p44 条目时校验**脉象图能不能用**（网站端与命令行共用同一份）。
 *
 * 为什么校验得这么细：新条目的判定**就是这张图**（画图即条件）。
 * 图里有垃圾数据时，前端不会报错 —— 那条条目只是**永远不命中**，
 * 而界面上看起来一切正常。这种「静默失效」必须在写库前就拒掉。
 *
 * 校验三项：
 * ① 至少一张图，每张至少一个格子；
 * ② 格键必须是 `L|关|浮` 这种形状（否则 `ctx.get()` 永远取不到值）；
 * ③ 每格至少写了 `term`（原文用字）或 `codes`（符号），两者都没有 ＝ 这格没有要求。
 *
 * ⓘ **不**核对 `term` 的词表（`PATTERN_TERMS`）：那是前端内容层的表，
 *   云函数环境里不一定读得到。词写错的后果与 ③ 相同（不命中），
 *   由前端编辑器只提供已知术语来保证。
 *
 * ⭐ 放在这一层（不是 `library-service.mjs`）的原因：
 *   **网站端（HTTP）与命令行（`library add`）必须同一套校验** ——
 *   两处各写一份，迟早出现「网站上加得进、命令行加不进」这种漂移。
 *
 * @param {unknown} patterns
 * @returns {string[]} 错误说明（空数组＝通过）
 */
export function validateRulePatterns(patterns) {
  const errors = []
  if (!Array.isArray(patterns) || patterns.length === 0) {
    errors.push(
      '新增的依脉用方条目必须带一张脉象图 —— 这张图就是它的命中条件。' +
        '（没有图的条目永远不会被命中，界面也看不出来。）',
    )
    return errors
  }

  for (const [i, p] of patterns.entries()) {
    if (!p || !Array.isArray(p.cells) || p.cells.length === 0) {
      errors.push(`第 ${i + 1} 张脉象图没有标任何格子 —— 至少要标一格的（部位 ＋ 取法）才有判定意义。`)
      continue
    }
    for (const c of p.cells) {
      const key = String(c?.cell ?? '')
      if (!CELL_KEY_RE.test(key)) {
        errors.push(
          `第 ${i + 1} 张脉象图里的格子「${key}」不合法：要写成「手|部位|取法」，如 L|关|浮、R|尺|沉。`,
        )
        continue
      }
      const hasTerm = typeof c?.term === 'string' && c.term.trim() !== ''
      const hasCodes = Array.isArray(c?.codes) && c.codes.length > 0
      if (!hasTerm && !hasCodes) {
        errors.push(
          `第 ${i + 1} 张脉象图的「${key}」这一格没写用字也没写符号 —— ` +
            '这格等于没有要求，既不会命中也不会提示。请补上（或把它清空删掉）。',
        )
      }
    }
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
 *   而内容层发布管道写出的是 LF —— 两种都得对得上，
 *   否则「空覆盖层 apply 之后逐字节未变」这条验收就过不了）。
 *
 * 序列化格式与内容层发布管道完全一致
 * （`JSON.stringify(x, null, 2)` ＋ 末尾换行）。
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
 * 合并与级联                                                             *
 * ------------------------------------------------------------------ *
 *
 * 这两段（`mergeKind`／`cascadeCleanup`）在 `src/domain/library-core.mjs` ——
 * 浏览器与 Node 共用**同一份**：网站端 ③ 显示的那一份，与命令行
 * `library apply` 写进基线的那一份，必须算出同一个结果。
 *
 * 本文件再导出一次 ⇒ 既有 import 路径不变（CLI、断言脚本都从这里取）。
 */

/**
 * 引用层校验（悬空引用）。
 *
 * 规则与内容层的引用校验一致：
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

/* ------------------------------------------------------------------ *
 * p44 边界：**新增**要「有判定函数」，**删除**放行                          *
 * ------------------------------------------------------------------ */

/** 判定函数表所在文件（前端代码里的 EVALUATORS） */
export const FORMULAS_TS = join(ROOT, 'src', 'domain', 'formulas.ts')

/**
 * 从 `src/domain/formulas.ts` 里读出**有判定函数的规则 id 集合**。
 *
 * 为什么读代码、而不另设一张登记表：
 *   「哪些 id 能被命中」的真源就是那份 `EVALUATORS`。另设一张表，两边必然漂移，
 *   而漂移的后果是「前端载入即报错」。所以这里直接读真源。
 *
 * 读不到就返回 `null`（**不是**空集合）—— 调用方据此退回保守做法：
 * 只认基线里已有的 id，宁可少放行，也不放行错的。
 *
 * @param {string} formulasPath
 * @returns {Set<string>|null} 有判定函数的 id 集合；读不到返回 null
 */
export function readEvaluatorIds(formulasPath = FORMULAS_TS) {
  try {
    const src = readFileSync(formulasPath, 'utf8')
    const start = src.indexOf('const EVALUATORS')
    if (start < 0) return null
    const end = src.indexOf('\n}', start)
    const block = end > start ? src.slice(start, end) : src.slice(start)
    const ids = new Set()
    for (const m of block.matchAll(/'([A-Za-z0-9_-]+)':\s*\(/g)) ids.add(m[1])
    return ids.size > 0 ? ids : null
  } catch {
    return null
  }
}

/**
 * p44 边界检查：**只管新增**。
 *
 * 删一条规则是数据层的事 —— 条目没了，判定函数作为**残留代码**留着，
 * 前端不加载它（见 src/domain/formulas.ts 的 loadRules：判定函数有、数据没有 → 跳过），
 * 所以删得干净；又因为函数还在，`library restore` 放回来时不用改一行代码。
 *
 * ## 新增的两条路（2026-11-12 起）
 *
 * ① **有判定函数**（`EVALUATORS` 里有这个 id）→ 放行。与原来一样。
 * ② **自带脉象图**（`payload.patterns` 是非空数组）→ 放行。**画图即条件**：
 *    前端 `loadRules` 会用这张图现场建一个判定（`pulse-pattern.ts` 的 `evaluatePattern`）。
 *    这条是管理员在网站上「新增整条」走的路径 —— 不用改一行代码。
 *
 * 两条都不满足 ⇒ 拒。那种条目永远不命中，而界面看不出来 —— 宁可当场拒掉。
 *
 * @param {object} baselineFiles
 * @param {object} overrides
 * @param {Set<string>|null} evaluatorIds  readEvaluatorIds() 的结果
 * @returns {string[]} 错误说明（空数组＝通过）
 */
export function checkRuleAddBoundary(baselineFiles, overrides, evaluatorIds = null) {
  const errors = []
  const baseIds = new Set(
    (baselineFiles['formula-rules.json']?.rules ?? []).map((r) => String(r?.id ?? '')),
  )
  const known = evaluatorIds ?? null
  for (const [itemId, ov] of Object.entries(overrides?.rule ?? {})) {
    if (ov.deleted) continue // 删除：放行（判定函数留着当残留代码）
    if (baseIds.has(itemId)) continue // 基线已有的条目：改字段，不是新增
    if (known && known.has(itemId)) continue // ① 代码里有判定函数
    const patterns = ov.payload?.patterns
    if (Array.isArray(patterns) && patterns.length > 0) continue // ② 画图即条件
    errors.push(
      `覆盖层新增了讲义 p44 条目「${itemId}」，但它既没有判定函数、也没有脉象图 —— ` +
        `前端载入时会报错（这种条目永远不命中，界面却看不出来）。\n` +
        `  修法二选一：给这条条目补一张脉象图（「画图即条件」），` +
        `或在 src/domain/formulas.ts 的 EVALUATORS 里补一个判定函数。`,
    )
  }
  return errors
}

/**
 * 全量合并：基线 ＋ 覆盖层 → 最终内容。
 *
 * @param {object} baselineFiles  readBaseline 的结果
 * @param {object} overrides      groupOverrides 的结果
 * @param {object} [opts]
 * @param {Set<string>|null} [opts.evaluatorIds]  readEvaluatorIds() 的结果（默认现读）
 * @returns {{ files: object, report: object, errors: string[], notes: string[] }}
 */
export function mergeAll(baselineFiles, overrides, opts = {}) {
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

  const evaluatorIds = opts.evaluatorIds === undefined ? readEvaluatorIds() : opts.evaluatorIds
  const notes = cascadeCleanup(files, removed)
  const errors = [
    ...checkRuleAddBoundary(baselineFiles, overrides, evaluatorIds),
    ...checkReferences(files),
  ]
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
