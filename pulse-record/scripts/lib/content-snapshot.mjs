/**
 * 内容层 · JSON 快照（本地库 → `src/content/*.json`）
 *
 * ## 干什么
 *
 * 把本地编辑库（`local-data/content.sqlite`）导成 8 个内容 JSON 文件。
 * 这 8 个文件是**发布命令的产物**（不是编辑面）——
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

/** 8 个内容文件名（不含扩展名） */
export const SNAPSHOT_FILES = [
  'doses',
  'drugs',
  'formula-reference',
  'formula-rules',
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
 * @returns {{name: string, file: string, changed: boolean, bytes: number}[]}
 */
export function writeSnapshot(db, { dir = CONTENT_DIR, write = true } = {}) {
  const content = buildSnapshot(db)
  const out = []
  for (const name of SNAPSHOT_FILES) {
    const file = join(dir, `${name}.json`)
    const text = serialize(content[name])
    const before = existsSync(file) ? readFileSync(file, 'utf8') : null
    const changed = before !== text
    if (changed && write) writeFileSync(file, text)
    out.push({ name, file, changed, bytes: Buffer.byteLength(text) })
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
