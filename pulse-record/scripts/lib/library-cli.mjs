/**
 * 用方知识库 · 管理员命令行（`npm run admin -- library …`）
 *
 * ## 它是什么
 *
 * 「整个用方知识库都可以编辑」这件事的**唯一写入面**。
 * 直接读写本机 SQLite（不过 HTTP），所以服务器上也能用 —— 能进这台机器的
 * shell，就等于管理员。
 *
 * 这一轮**前端一行都不改**：内容是编译期内联的（src/domain/*.ts 的
 * `import x from '../content/x.json'`），所以管理员改完要用 `library apply`
 * 把覆盖层合并回 `src/content/*.json`（**数据层**），再走既有 Excel 管线
 * 重建人工编辑层、`npm run build` 重出前端。
 *
 * ## 覆盖层语义（与 server/db.mjs 的 formula_patterns 同一套）
 *
 *   · 有行且 deleted=0 → 用这一行的 payload **整条接管**该基线条目
 *   · 有行且 deleted=1 → **墓碑**：该条目在结果里消失
 *   · 没有行           → 保持内置基线
 *
 * ## 几条硬规矩
 *
 *   · **方名照录、剂量单位不换算、没写明的就留空** —— 由 server/library-schema.mjs
 *     的注册表与校验层强制，命令行改不坏。
 *   · **讲义 p44 依脉用方可以改字段、可以删除，但不能新增** ——
 *     新增一条要有对应的命中判定函数，那写在代码里
 *     （src/domain/formulas.ts 的 EVALUATORS），命令行补不出来；
 *     删除不用改代码：条目没了，判定函数作为**残留代码**留着，前端不加载它。
 *   · **不替读者臆造** —— 新增条目必须自己填 source／quote 等必填字段，
 *     后端不会替你生成出处。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_CONTENT_DIR,
  kindNames,
  kindSpec,
  describeKinds,
  readBaseline,
  writeBaseline,
  groupOverrides,
  mergeAll,
  effectiveEntry,
  effectiveEntries,
  validateEntry,
  validatePrimaryKeys,
  checkRuleAddBoundary,
  readEvaluatorIds,
} from '../../server/library-schema.mjs'
import { listLibraryItems, putLibraryItem, deleteLibraryItem } from '../../server/store.mjs'

/** 命令行报错：抛出后由 admin.mjs 统一打印并退出（退出码非 0） */
class CliError extends Error {}

function fail(msg) {
  throw new CliError(msg)
}

/* ------------------------------------------------------------------ *
 * 参数解析
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const opts = {
    kind: null,
    file: null,
    out: null,
    note: null,
    by: null,
    contentDir: null,
    dryRun: false,
    all: false,
    help: false,
    sets: [],
  }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--kind') opts.kind = argv[++i] ?? null
    else if (a === '--file') opts.file = argv[++i] ?? null
    else if (a === '--out') opts.out = argv[++i] ?? null
    else if (a === '--note') opts.note = argv[++i] ?? null
    else if (a === '--by') opts.by = argv[++i] ?? null
    else if (a === '--content-dir') opts.contentDir = argv[++i] ?? null
    else if (a === '--set') opts.sets.push(argv[++i] ?? '')
    else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--all') opts.all = true
    else if (a === '--help' || a === '-h') opts.help = true
    else if (a.startsWith('--')) fail(`不认识的选项「${a}」`)
    else positional.push(a)
  }
  return { opts, positional }
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

/** 内容目录（--content-dir 或默认 src/content） */
function contentDirOf(opts) {
  return opts.contentDir ? String(opts.contentDir) : DEFAULT_CONTENT_DIR
}

/** 读一个 JSON 文件（去 BOM） */
function readJsonFile(path) {
  if (!existsSync(path)) fail(`找不到文件：${path}`)
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
  } catch (e) {
    fail(`这个文件不是合法的 JSON：${path}\n  ${e?.message ?? e}`)
  }
}

/**
 * 把命令行上的「k=v」转成合适的类型。
 *
 * 按**字段声明的类型**转，不按字面猜 —— 否则「剂量 3」会被当成数字 3，
 * 而 `composition` 必须是原样转录的文字。
 */
function coerceFieldValue(field, raw) {
  const s = String(raw)
  if (field.type === 'string') return s
  if (field.type === 'string[]') {
    const t = s.trim()
    if (t.startsWith('[')) {
      try {
        const parsed = JSON.parse(t)
        if (Array.isArray(parsed)) return parsed
      } catch {
        /* 当作分隔列表 */
      }
    }
    return t
      .split('|')
      .map((x) => x.trim())
      .filter((x) => x !== '')
  }
  if (field.type === 'number' || field.type === 'positiveInt' || field.type === 'page') {
    const n = Number(s)
    if (!Number.isFinite(n)) fail(`字段「${field.key}」要一个数字，收到的是「${s}」`)
    return n
  }
  if (field.type === 'boolean') {
    if (s === 'true') return true
    if (s === 'false') return false
    fail(`字段「${field.key}」只认 true／false，收到的是「${s}」`)
  }
  if (field.type === 'enum') return s
  return s
}

/** 字段级差异（给人看的：到底改了哪几个字段） */
function diffFields(before, after) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  const out = []
  for (const k of keys) {
    const a = before?.[k]
    const b = after?.[k]
    if (stableEq(a, b)) continue
    out.push({ key: k, from: a, to: b })
  }
  return out
}

function stableEq(a, b) {
  if (a === b) return true
  if (a === undefined || b === undefined || a === null || b === null) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

function fmt(v) {
  if (v === undefined) return '（无）'
  if (typeof v === 'string') return v === '' ? '（空）' : v
  return JSON.stringify(v)
}

function ts(v) {
  if (!v) return '—'
  try {
    return new Date(Number(v)).toLocaleString('zh-CN')
  } catch {
    return String(v)
  }
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

/**
 * 执行一条 library 子命令。
 *
 * @param {string[]} argv  子命令及其参数（不含 'library' 这个词）
 * @param {object} db      数据库句柄（SQLite 版传真实句柄；PG 版传什么都行）
 */
export function runLibrary(argv, db) {
  const { opts, positional } = parseArgs(argv)
  const sub = positional[0]

  if (opts.help || !sub) {
    printHelp()
    return
  }

  switch (sub) {
    case 'list':
      return cmdList(db, opts, positional)
    case 'show':
      return cmdShow(db, opts, positional)
    case 'set':
      return cmdSet(db, opts, positional)
    case 'add':
      return cmdAdd(db, opts, positional)
    case 'del':
    case 'delete':
      return cmdDel(db, opts, positional)
    case 'restore':
      return cmdRestore(db, opts, positional)
    case 'revive':
      return cmdRevive(db, opts, positional)
    case 'export':
      return cmdExport(db, opts, positional)
    case 'import':
      return cmdImport(db, opts, positional)
    case 'apply':
      return cmdApply(db, opts, positional)
    case 'verify':
      return cmdVerify(db, opts, positional)
    default:
      fail(
        `不认识的子命令「${sub}」。\n` +
          `可用：list / show / set / add / del / restore / revive / export / import / apply / verify\n` +
          `（npm run admin -- library --help 看完整用法）`,
      )
  }
}

function printHelp() {
  console.log(`臧氏脉学 · 用方知识库（管理员命令行）

  npm run admin -- library list [--kind K] [--all]
      列出覆盖层（管理员改过的条目）。--all 连基线一起列（看当前有效值）。

  npm run admin -- library show <kind> <id>
      看一条：基线 ＋ 覆盖层 ＋ 当前有效值。

  npm run admin -- library set <kind> <id> [--file f.json | --set k=v …] [--note "…"] [--by 管理员]
      改一条。按字段改 —— 不会连带丢掉别的字段。

  npm run admin -- library add <kind> --file f.json [--note "…"] [--by 管理员]
      新增一条（纯数据的类才行）。

  npm run admin -- library del <kind> <id> [--note "…"] [--by 管理员]
      删一条（写墓碑；apply 之后这条从结果里消失）。

  npm run admin -- library restore <kind> <id>
      撤销覆盖，回到内置基线。

  npm run admin -- library revive <kind> <id>
      把**删掉的**这一条放回来（撤销「那一次删除」）。
      与 restore 的分工：restore 撤「覆盖层这一行」，revive 撤「那一次删除」。
      靠墓碑里存着的原内容快照放回来 —— apply 已经写掉基线了也放得回。

  npm run admin -- library export [--kind K] [--out f.json]
      导出覆盖层（审计／备份／搬到另一台机器）。

  npm run admin -- library import --file f.json
      从导出的 JSON 导入覆盖层。

  npm run admin -- library apply [--dry-run] [--content-dir <目录>]
      把覆盖层合并回 src/content/*.json（**这是前端唯一能看到的出口**）。

  npm run admin -- library verify
      自检：覆盖层合不合规、引用有没有断。

可选的类（kind）：
${describeKinds()}

  提醒：讲义 p44「依脉用方」可以**改字段**、可以**删除**，但**不能新增** ——
        新增一条要有对应的命中判定函数，那写在代码里
        （src/domain/formulas.ts 的 EVALUATORS），命令行补不出来。
        删除不用改代码：条目没了，判定函数作为残留代码留着，前端不加载它。
`)
}

/* ------------------------------------------------------------------ *
 * list
 * ------------------------------------------------------------------ */

async function cmdList(db, opts, positional) {
  const rows = await listLibraryItems(db)
  const overrides = groupOverrides(rows)

  if (opts.all) {
    if (!opts.kind) fail('--all 要配合 --kind 用：npm run admin -- library list --kind drug --all')
    const spec = mustKind(opts.kind)
    const baseline = readBaseline(contentDirOf(opts))
    const { files } = mergeAll(baseline, overrides)
    const entries = effectiveEntries(files, opts.kind)
    console.log(`${spec.label}（当前有效值，共 ${entries.length} 条）`)
    for (const entry of entries) {
      const id = String(entry?.[spec.idField] ?? '')
      const ov = overrides[opts.kind]?.[id]
      const mark = ov ? (ov.deleted ? '［已删］' : '［已改］') : '　　'
      const title = entry?.name ?? entry?.science ?? ''
      console.log(`  ${mark} ${id}\t${title}`)
    }
    return
  }

  const kinds = opts.kind ? [mustKind(opts.kind) && opts.kind] : kindNames()
  let total = 0
  for (const kind of kinds) {
    const rowsOfKind = Object.entries(overrides[kind] ?? {})
    if (rowsOfKind.length === 0) continue
    const spec = kindSpec(kind)
    console.log(`${spec.label}（kind=${kind}，${rowsOfKind.length} 条）`)
    for (const [itemId, ov] of rowsOfKind) {
      total += 1
      const state = ov.deleted ? '已删除（墓碑）' : '已改'
      const note = ov.note ? `  备注：${ov.note}` : ''
      console.log(
        `  ${itemId}\t${state}\t${ts(ov.updatedAt)}\t${ov.updatedBy ?? 'cli'}${note}`,
      )
    }
  }
  if (total === 0) {
    console.log('（覆盖层是空的 —— 知识库还是内置基线，一字未改）')
  } else {
    console.log(`\n合计 ${total} 条改动。改完记得跑 library apply 才会进到前端。`)
  }
}

/* ------------------------------------------------------------------ *
 * show
 * ------------------------------------------------------------------ */

async function cmdShow(db, opts, positional) {
  const [kind, itemId] = positional.slice(1)
  const spec = mustKind(kind)
  if (!itemId) fail(`用法：npm run admin -- library show <kind> <id>`)

  const baseline = readBaseline(contentDirOf(opts))
  const overrides = groupOverrides(await listLibraryItems(db))
  const eff = effectiveEntry(baseline, overrides, kind, itemId)
  const ov = overrides[kind]?.[String(itemId)]

  console.log(`${spec.label}（kind=${kind}）  id=${itemId}`)
  console.log('')
  console.log('── 内置基线 ──')
  const baseEntry = baselineEntryOf(baseline, spec, String(itemId))
  console.log(baseEntry ? JSON.stringify(baseEntry, null, 2) : '（基线里没有这一条）')
  console.log('')
  console.log('── 覆盖层 ──')
  console.log(
    ov
      ? JSON.stringify(
          { deleted: ov.deleted, updatedAt: ts(ov.updatedAt), updatedBy: ov.updatedBy, note: ov.note, payload: ov.payload },
          null,
          2,
        )
      : '（没有覆盖 —— 就是基线本身）',
  )
  console.log('')
  console.log('── 当前有效值 ──')
  if (eff.deleted) console.log('（已被删除，apply 之后这条从结果里消失）')
  else console.log(eff.entry ? JSON.stringify(eff.entry, null, 2) : '（没有这一条）')
}

/* ------------------------------------------------------------------ *
 * set
 * ------------------------------------------------------------------ */

async function cmdSet(db, opts, positional) {
  const [kind, itemId] = positional.slice(1)
  const spec = mustKind(kind)
  if (!itemId) fail(`用法：npm run admin -- library set <kind> <id> [--file f.json | --set k=v …]`)

  const baseline = readBaseline(contentDirOf(opts))
  const overrides = groupOverrides(await listLibraryItems(db))
  const eff = effectiveEntry(baseline, overrides, kind, itemId)
  if (eff.deleted) {
    fail(
      `「${kind} ${itemId}」已经被删掉了，改它之前先 restore：\n` +
        `  npm run admin -- library restore ${kind} ${itemId}`,
    )
  }
  if (!eff.entry) fail(`基线里没有「${kind} ${itemId}」这一条 —— 新增要用 library add`)

  const before = eff.entry
  let next
  if (opts.file) {
    next = readJsonFile(String(opts.file))
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      fail(`${opts.file} 里必须是一个条目对象`)
    }
  } else if (opts.sets.length > 0) {
    next = JSON.parse(JSON.stringify(before))
    for (const pair of opts.sets) {
      const eq = pair.indexOf('=')
      if (eq <= 0) fail(`--set 的写法是「字段=值」，收到的是「${pair}」`)
      const key = pair.slice(0, eq).trim()
      const raw = pair.slice(eq + 1)
      const field = spec.fields.find((f) => f.key === key)
      if (!field) {
        fail(
          `「${key}」不是${spec.label}的可编辑字段。\n` +
            `  能改的字段：${spec.fields.map((f) => f.key).join('、')}`,
        )
      }
      next[key] = coerceFieldValue(field, raw)
    }
  } else {
    fail('要么给 --file（整条新内容），要么给 --set 字段=值（改某几个字段）')
  }

  // 校验：基线里本来就有的、但没登记的字段放行（保留原样）；管理员新加的拒绝
  const knownKeys = new Set(Object.keys(baselineEntryOf(baseline, spec, String(itemId)) ?? {}))
  const errors = validateEntry(kind, next, { knownKeys })
  if (errors.length > 0) {
    fail(`这条改不了：\n  · ${errors.join('\n  · ')}`)
  }

  const ok = await putLibraryItem(db, kind, String(itemId), next, {
    deleted: 0,
    updatedBy: opts.by ?? 'cli',
    note: opts.note ?? null,
  })
  if (!ok) fail('写进数据库失败了')

  console.log(`✓ 已改：${spec.label}「${itemId}」`)
  const diff = diffFields(before, next)
  if (diff.length === 0) console.log('  （内容跟改之前一样）')
  for (const d of diff) {
    console.log(`  ${d.key}：${fmt(d.from)}  →  ${fmt(d.to)}`)
  }
  console.log('  （改动存在覆盖层里，还没进前端 —— 要跑 library apply）')
}

/* ------------------------------------------------------------------ *
 * add
 * ------------------------------------------------------------------ */

async function cmdAdd(db, opts, positional) {
  const kind = positional[1]
  const spec = mustKind(kind)
  if (!spec.addable) fail(spec.blocked?.add ?? `${spec.label}不能新增`)
  if (!opts.file) fail(`用法：npm run admin -- library add ${kind} --file f.json`)

  const entry = readJsonFile(String(opts.file))
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    fail(`${opts.file} 里必须是一个条目对象`)
  }

  const baseline = readBaseline(contentDirOf(opts))
  const overrides = groupOverrides(await listLibraryItems(db))
  const id = String(entry?.[spec.idField] ?? '')
  if (!id) fail(`这一条没有主键「${spec.idField}」`)

  const existing = effectiveEntry(baseline, overrides, kind, id)
  if (existing.entry && !existing.deleted) {
    fail(`「${kind} ${id}」已经存在了（${existing.from === 'override' ? '覆盖层里' : '基线里'}）—— 改它请用 library set`)
  }

  const errors = validateEntry(kind, entry)
  if (errors.length > 0) fail(`这一条不合规：\n  · ${errors.join('\n  · ')}`)

  const ok = await putLibraryItem(db, kind, id, entry, {
    deleted: 0,
    updatedBy: opts.by ?? 'cli',
    note: opts.note ?? null,
  })
  if (!ok) fail('写进数据库失败了')

  console.log(`✓ 已新增：${spec.label}「${id}」`)
  console.log('  （新条目会落在「未归类」兜底组里 —— 五行／左右手的归类依据要另外补）')
  console.log('  （改动存在覆盖层里，还没进前端 —— 要跑 library apply）')
}

/* ------------------------------------------------------------------ *
 * del
 * ------------------------------------------------------------------ */

async function cmdDel(db, opts, positional) {
  const [kind, itemId] = positional.slice(1)
  const spec = mustKind(kind)
  if (!spec.deletable) fail(spec.blocked?.del ?? `${spec.label}不能删除`)
  if (!itemId) fail(`用法：npm run admin -- library del <kind> <id>`)

  const baseline = readBaseline(contentDirOf(opts))
  const overrides = groupOverrides(await listLibraryItems(db))
  const eff = effectiveEntry(baseline, overrides, kind, itemId)
  const ov = overrides[kind]?.[String(itemId)]
  if (!eff.entry && !eff.deleted) fail(`没有「${kind} ${itemId}」这一条`)

  /**
   * **原条目快照** —— 墓碑行里带着它，恢复时才有东西可放回去。
   *
   * 取哪个版本：
   *   · 基线里还在 → 取基线那份（那才是「原条目」；覆盖层里改过的版本不算）
   *   · 基线里已经没有了（apply 已经跑过）→ 取覆盖层里存着的那份
   *   · 都没有 → 空对象（这一条恢复不了，只能手工加回去）
   */
  const snapshot = baselineEntryOf(baseline, spec, String(itemId)) ?? ov?.payload ?? eff.entry ?? {}

  const ok = await putLibraryItem(db, kind, String(itemId), snapshot, {
    deleted: 1,
    updatedBy: opts.by ?? 'cli',
    note: opts.note ?? null,
  })
  if (!ok) fail('写进数据库失败了')

  console.log(`✓ 已标删：${spec.label}「${itemId}」`)
  console.log('  （apply 之后这条从结果里消失；引用它的地方会按「未载」处理）')
  if (Object.keys(snapshot).length === 0) {
    console.log('  ⚠ 这一条没存下原内容快照 —— apply 之后就恢复不回来了（只能手工加回去）')
  } else {
    console.log('  （原内容已随墓碑存下，restore 可以把它放回去）')
  }
  console.log('  （改动存在覆盖层里，还没进前端 —— 要跑 library apply）')
}

/* ------------------------------------------------------------------ *
 * restore
 * ------------------------------------------------------------------ */

/**
 * restore —— **撤销覆盖层里对这一条的改动**（删掉那一行）→ 回到基线的样子。
 *
 * ⚠️ 与 `revive` 的分工（别搞混）：
 *   · `restore` 撤的是「覆盖层这一行」；
 *   · `revive`   撤的是「**那一次删除**」，把删掉的条目放回来。
 *
 * 为什么需要 `revive`：apply 是**写进基线**的 —— 墓碑一旦 apply 过去，
 * 基线里就没有这一条了；这时候光删墓碑撤不回来（基线里本来就没有）。
 * `revive` 用墓碑里存着的**原内容快照**把它放回去。
 */
async function cmdRestore(db, opts, positional) {
  const [kind, itemId] = positional.slice(1)
  mustKind(kind)
  if (!itemId) fail(`用法：npm run admin -- library restore <kind> <id>`)

  const overrides = groupOverrides(await listLibraryItems(db))
  const ov = overrides[kind]?.[String(itemId)]
  if (!ov) fail(`「${kind} ${itemId}」本来就没有被改过 —— 不用 restore`)

  const ok = await deleteLibraryItem(db, kind, String(itemId))
  if (!ok) fail('写进数据库失败了')
  console.log(`✓ 已撤销覆盖：${kind} ${itemId}（回到内置基线）`)
  if (ov.deleted) {
    console.log('  ⚠ 这次是撤掉「删除」标记；如果这一条已经被 apply 写掉了，')
    console.log('    撤标记撤不回来 —— 要把它放回来请用：library revive ' + kind + ' ' + itemId)
  }
}

/* ------------------------------------------------------------------ *
 * revive
 * ------------------------------------------------------------------ */

/**
 * revive —— **把删掉的这一条放回来**（撤销「那一次删除」）。
 *
 * 与 `restore` 的分工见 cmdRestore 的注释。
 *
 * 靠什么放回来：墓碑行里存着**原内容快照**（`del` 当时从基线里取的）——
 * 所以哪怕 apply 已经把基线写掉了，快照还在，放回来的内容一字不差。
 */
async function cmdRevive(db, opts, positional) {
  const [kind, itemId] = positional.slice(1)
  mustKind(kind)
  if (!itemId) fail(`用法：npm run admin -- library revive <kind> <id>`)

  const overrides = groupOverrides(await listLibraryItems(db))
  const ov = overrides[kind]?.[String(itemId)]
  if (!ov) fail(`「${kind} ${itemId}」没有覆盖记录 —— 它没被删过，不用 revive`)
  if (!ov.deleted) fail(`「${kind} ${itemId}」没被删过（只是被改过）—— 那种情况用 restore`)

  if (!ov.payload || Object.keys(ov.payload).length === 0) {
    fail(
      `「${kind} ${itemId}」的墓碑里没有原内容快照，放不回来。\n` +
        `  只能手工加回去：library add ${kind} --file <条目>.json`,
    )
  }

  const ok = await putLibraryItem(db, kind, String(itemId), ov.payload, {
    deleted: 0,
    updatedBy: opts.by ?? 'cli',
    note: opts.note ?? null,
  })
  if (!ok) fail('写进数据库失败了')
  console.log(`✓ 已放回来：${kind} ${itemId}（apply 之后它回到基线）`)
}

/* ------------------------------------------------------------------ *
 * export / import
 * ------------------------------------------------------------------ */

async function cmdExport(db, opts, positional) {
  const rows = await listLibraryItems(db)
  const items = rows
    .filter((r) => (opts.kind ? r.kind === opts.kind : true))
    .map((r) => ({
      kind: r.kind,
      itemId: r.item_id,
      payload: safeParse(r.payload),
      deleted: Number(r.deleted) === 1,
      updatedAt: r.updated_at,
      updatedBy: r.updated_by,
      note: r.note ?? null,
    }))
  const doc = { version: 1, exportedAt: Date.now(), items }
  const text = JSON.stringify(doc, null, 2) + '\n'
  if (opts.out) {
    writeFileSync(String(opts.out), text, 'utf8')
    console.log(`✓ 已导出 ${items.length} 条 → ${opts.out}`)
  } else {
    console.log(text.trimEnd())
  }
}

async function cmdImport(db, opts, positional) {
  if (!opts.file) fail('用法：npm run admin -- library import --file f.json')
  const doc = readJsonFile(String(opts.file))
  const items = Array.isArray(doc?.items) ? doc.items : null
  if (!items) fail(`${opts.file} 的格式不对：顶层应该有 items 数组`)

  const baseline = readBaseline(contentDirOf(opts))
  const overrides = groupOverrides(await listLibraryItems(db))
  const problems = []

  for (const item of items) {
    const kind = String(item?.kind ?? '')
    const spec = kindSpec(kind)
    if (!spec) {
      problems.push(`未知的种类「${kind}」`)
      continue
    }
    const id = String(item?.itemId ?? '')
    if (!id) {
      problems.push(`有一条没有 id`)
      continue
    }
    if (item?.deleted) {
      if (!spec.deletable) {
        problems.push(spec.blocked?.del ?? `${spec.label}不能删除`)
        continue
      }
      const eff = effectiveEntry(baseline, overrides, kind, id)
      const ov = overrides[kind]?.[id]
      // 墓碑要带着原内容快照 —— 不然恢复不回来
      const snapshot =
        (item?.payload && Object.keys(item.payload).length > 0 ? item.payload : null) ??
        baselineEntryOf(baseline, spec, id) ??
        ov?.payload ??
        eff.entry ??
        {}
      await putLibraryItem(db, kind, id, snapshot, {
        deleted: 1,
        updatedBy: item?.updatedBy ?? 'import',
        note: item?.note ?? null,
      })
      continue
    }
    // 新增？那一类必须允许新增，且不能撞基线
    // ⚠️ 墓碑不算「新增」—— 那是「恢复」：本来就有过，只是被删了
    const eff = effectiveEntry(baseline, overrides, kind, id)
    const ov = overrides[kind]?.[id]
    const isTombstone = Boolean(ov?.deleted)
    const isNew = (!eff.entry || eff.deleted) && !isTombstone
    if (isNew && !spec.addable) {
      problems.push(spec.blocked?.add ?? `${spec.label}不能新增`)
      continue
    }
    const errors = validateEntry(kind, item?.payload)
    if (errors.length > 0) {
      problems.push(`${kind} ${id}：${errors.join('；')}`)
      continue
    }
    await putLibraryItem(db, kind, id, item.payload, {
      deleted: 0,
      updatedBy: item?.updatedBy ?? 'import',
      note: item?.note ?? null,
    })
  }

  if (problems.length > 0) {
    fail(`有 ${problems.length} 条没导进去：\n  · ${problems.join('\n  · ')}`)
  }
  console.log(`✓ 已导入 ${items.length} 条`)
}

/* ------------------------------------------------------------------ *
 * apply
 * ------------------------------------------------------------------ */

async function cmdApply(db, opts, positional) {
  const dir = contentDirOf(opts)
  const baseline = readBaseline(dir)
  const overrides = groupOverrides(await listLibraryItems(db))
  const { files, report, errors, notes, bad } = mergeAll(baseline, overrides)

  if (errors.length > 0 || bad.length > 0) {
    const lines = [...errors, ...bad]
    fail(
      `合并没有通过检查，**没有写盘**（${lines.length} 条问题）：\n` +
        lines.map((e) => `  · ${e}`).join('\n'),
    )
  }

  // 先报要改什么
  let totalChanged = 0
  for (const kind of kindNames()) {
    const r = report[kind]
    const n = r.added.length + r.changed.length + r.removed.length
    if (n === 0) continue
    totalChanged += n
    const spec = kindSpec(kind)
    console.log(`${spec.label}（kind=${kind}）`)
    if (r.added.length) console.log(`  新增 ${r.added.length} 条：${r.added.join('、')}`)
    if (r.changed.length) console.log(`  修改 ${r.changed.length} 条：${r.changed.join('、')}`)
    if (r.removed.length) console.log(`  删除 ${r.removed.length} 条：${r.removed.join('、')}`)
  }
  if (notes.length > 0) {
    console.log('')
    console.log('连带处理：')
    for (const n of notes) console.log(`  · ${n}`)
  }

  if (opts.dryRun) {
    console.log('')
    console.log('（--dry-run：只是看看，**没有写盘**）')
    return
  }
  if (totalChanged === 0) {
    console.log('')
    console.log('（覆盖层是空的 —— 什么也不用写）')
    return
  }

  const written = writeBaseline(dir, files)
  console.log('')
  for (const w of written) console.log(`✓ 已写出 ${w.path}（${w.bytes} 字节，${w.eol}）`)
  console.log('')
  console.log('接下来：')
  console.log('  npm run content:excel   重建人工编辑层（Excel）')
  console.log('  npm run build           重出前端')
}

/* ------------------------------------------------------------------ *
 * verify
 * ------------------------------------------------------------------ */

async function cmdVerify(db, opts, positional) {
  const dir = contentDirOf(opts)
  const baseline = readBaseline(dir)
  const rows = await listLibraryItems(db)
  const overrides = groupOverrides(rows)
  const problems = []
  const warnings = []

  // 覆盖层逐条查
  for (const kind of kindNames()) {
    const spec = kindSpec(kind)
    for (const [itemId, ov] of Object.entries(overrides[kind] ?? {})) {
      if (ov.deleted) {
        if (!spec.deletable) problems.push(spec.blocked?.del ?? `${spec.label}不能删除：「${itemId}」`)
        continue
      }
      if (!ov.payload) {
        problems.push(`${spec.label}「${itemId}」的 JSON 读不出来`)
        continue
      }
      const errors = validateEntry(kind, ov.payload)
      if (errors.length > 0) {
        problems.push(`${spec.label}「${itemId}」不合规：${errors.join('；')}`)
      }
      const idInPayload = String(ov.payload?.[spec.idField] ?? '')
      if (spec.container === 'array' && idInPayload !== itemId) {
        problems.push(`${spec.label}「${itemId}」的 payload 里主键是「${idInPayload}」，对不上`)
      }
    }
  }

  // p44 边界（只管「新增」—— 删除放行）
  for (const e of checkRuleAddBoundary(baseline, overrides, readEvaluatorIds())) {
    problems.push(e)
  }

  // 合并后的引用完整性
  const { errors: refErrors, bad } = mergeAll(baseline, overrides)
  for (const e of refErrors) problems.push(e)
  for (const b of bad) problems.push(b)

  // 主键唯一性（合并后的结果）
  for (const kind of kindNames()) {
    const spec = kindSpec(kind)
    const { files } = mergeAll(baseline, overrides)
    const entries = effectiveEntries(files, kind)
    for (const e of validatePrimaryKeys(kind, entries)) {
      problems.push(`${spec.label}：${e}`)
    }
  }

  if (warnings.length > 0) {
    console.log('提醒：')
    for (const w of warnings) console.log(`  · ${w}`)
    console.log('')
  }

  if (problems.length > 0) {
    console.log(`✗ 自检没通过（${problems.length} 条问题）：`)
    for (const p of problems) console.log(`  · ${p}`)
    process.exitCode = 1
    return
  }

  let count = 0
  for (const kind of kindNames()) count += Object.keys(overrides[kind] ?? {}).length
  console.log(`✓ 自检通过：覆盖层 ${count} 条改动，引用完整，p44 边界没被踩到。`)
  if (count > 0) console.log('  （还没进前端 —— 要跑 library apply）')
}

/* ------------------------------------------------------------------ *
 * 小工具（模块内）
 * ------------------------------------------------------------------ */

function mustKind(kind) {
  const spec = kindSpec(String(kind ?? ''))
  if (!spec) {
    fail(
      `未知的类「${kind ?? ''}」。\n` +
        `可用：${kindNames().join('／')}`,
    )
  }
  return spec
}

/** 从基线里取某一条（不管覆盖层） */
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

function safeParse(text) {
  try {
    return JSON.parse(String(text ?? ''))
  } catch {
    return null
  }
}

export { CliError }
