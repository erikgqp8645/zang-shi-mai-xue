/**
 * 内容层 · JSON 快照（本地库 → `src/content/*.json`）
 *
 * ## 干什么
 *
 * 把本地编辑库（`local-data/content.sqlite`）导成 9 个内容 JSON 文件。
 * 这 9 个文件是**发布命令的产物**（不是编辑面）——
 * 手改会被下一次发布覆盖，且 `content:check` 会红。
 *
 * ## 格式必须与现有文件**完全一致**
 *
 * 现有快照是 2 空格缩进 ＋ 末尾换行（`JSON.stringify(x, null, 2) + '\n'`）。
 * 小程序线照旧从编译期 JSON 构造 content 包 ⇒ 格式变了要重新编译，
 * 而且 diff 会满屏是噪声。
 *
 * ## 为什么不是「JSON → 库」
 *
 * 方向是**单向**的：库 → JSON。
 * 反向同步会引出「两边都改过、谁覆盖谁」的问题（发布模型没有这个歧义）。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { CONTENT_DIR, buildContentFromRows, readTable, tableDefs } from './content-schema.mjs'

/** 9 个内容文件名（不含扩展名） */
export const SNAPSHOT_FILES = [
  'doses',
  'drugs',
  'formula-reference',
  'formula-rules',
  'library-settings',
  'pulse-groups',
  'pulse-patterns',
  'pulse-terms',
  'symbols',
]

/**
 * 读库里全部内容表的行。
 *
 * @param {object} db 内容库
 * @returns {Record<string, object[]>} `{ 表名: 行 }`
 */
export function readAllRows(db) {
  const rows = {}
  for (const def of tableDefs()) rows[def.table] = readTable(db, def.table)
  return rows
}

/**
 * 生成快照内容（还没写盘）。
 *
 * @param {object} db 内容库
 * @returns {Record<string, object>} `{ 文件名: 内容 }`
 */
export function buildSnapshot(db) {
  return buildContentFromRows(readAllRows(db))
}

/**
 * 「会删东西」的差异 —— 写盘前的闸门。
 *
 * ## 为什么要有
 *
 * 2026-11-21 差点丢数据：`content-snapshot` 把人工补的 `parentDoseId`、`理中汤` 的 `notes`
 * 整块覆盖掉（库里没有那两个字段，快照里的值就被当成多余的删了），当场 `git checkout` 救回。
 *
 * 库里读不到的字段 / 空值，**不等于**「应该删掉」—— 很可能是「本地库落后于快照」。
 * 所以：新版比旧版少了非空内容时**拒绝写盘**，把差异列出来，让人确认。
 * 确认要删就加 `--force`。
 *
 * 判定（只看「从有到无」）：
 *   · 旧值是**非空字符串**，新值是 undefined／null／'' → 算删除
 *   · 旧值是**非空数组**，新数组更短 → 算删除（列出缺的元素）
 *   · 对象递归
 *
 * @returns {{path: string, before: unknown, after: unknown}[]}
 */
export function destructiveChanges(before, after, path = '') {
  const out = []
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)

  if (typeof before === 'string') {
    if (before.trim() && (after === undefined || after === null || String(after).trim() === '')) {
      out.push({ path, before, after })
    }
    return out
  }

  if (Array.isArray(before)) {
    const next = Array.isArray(after) ? after : []
    // ⚠️ 逐元素比 —— 只比长度会漏掉「同位置上的字段被清空」
    const n = Math.min(before.length, next.length)
    for (let i = 0; i < n; i += 1) {
      out.push(...destructiveChanges(before[i], next[i], `${path}[${i}]`))
    }
    if (next.length < before.length) {
      out.push({ path, before: `[${before.length} 项]`, after: `[${next.length} 项]` })
    }
    return out
  }

  if (isObj(before)) {
    if (after !== undefined && after !== null && !isObj(after)) return out
    for (const k of Object.keys(before)) {
      out.push(...destructiveChanges(before[k], after?.[k], path ? `${path}.${k}` : k))
    }
  }
  return out
}

/** 序列化（2 空格缩进 ＋ 末尾换行，与现有文件完全一致） */
export function serialize(content) {
  return `${JSON.stringify(content, null, 2)}\n`
}

/**
 * 写快照。
 *
 * @param {object} db 内容库
 * @param {object} [opts]
 * @param {string} [opts.dir] 目标目录（默认 `src/content`）
 * @param {boolean} [opts.write] 真的写盘（false = 只报告会不会变）
 * @param {boolean} [opts.force] 允许「从有到无」的覆盖（默认拒绝）
 * @returns {{name: string, file: string, changed: boolean, bytes: number,
 *            blocked: {path: string, before: unknown, after: unknown}[]}[]}
 */
export function writeSnapshot(db, { dir = CONTENT_DIR, write = true, force = false } = {}) {
  const content = buildSnapshot(db)
  const out = []
  for (const name of SNAPSHOT_FILES) {
    const file = join(dir, `${name}.json`)
    const text = serialize(content[name])
    const before = existsSync(file) ? readFileSync(file, 'utf8') : null
    const changed = before !== text

    // ⚠️ 闸门：新版比旧版「少了非空内容」就拒绝写盘（见 destructiveChanges 的注释）
    let blocked = []
    if (changed && before) {
      try {
        blocked = destructiveChanges(JSON.parse(before), content[name])
      } catch {
        blocked = []
      }
    }

    if (changed && write && (!blocked.length || force)) writeFileSync(file, text)
    out.push({ name, file, changed, bytes: Buffer.byteLength(text), blocked })
  }
  return out
}

/**
 * 比对：库里的内容 与 盘上的快照 是否一致。
 *
 * @param {object} db 内容库
 * @param {string} [dir] 快照目录
 * @returns {{name: string, file: string, same: boolean}[]}
 */
export function compareSnapshot(db, dir = CONTENT_DIR) {
  const content = buildSnapshot(db)
  return SNAPSHOT_FILES.map((name) => {
    const file = join(dir, `${name}.json`)
    const text = serialize(content[name])
    const onDisk = existsSync(file) ? readFileSync(file, 'utf8') : null
    return { name, file, same: onDisk === text }
  })
}
