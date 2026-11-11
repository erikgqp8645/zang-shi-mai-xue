/**
 * 内容层 · 存储分派（SQLite ↔ PostgreSQL）
 *
 * ## 为什么分派
 *
 * 内容层和患者数据是**两个域**，但「读哪儿」这件事要**一起**决定：
 *
 *   · `PULSE_STORE=pg`（生产） —— 读远端 PG 的**已发布**内容
 *   · `PULSE_STORE=sqlite`（本地）—— 读仓库里**已提交的快照**
 *
 * ⭐ 两条路读到的都是「**已发布**」的那一份：
 *   · PG 模式：远端 `content` schema 的 17 张表（发布命令写进去的）
 *   · SQLite 模式：仓库 `src/content/*.json`（发布命令的另一个产物）
 *
 *   本地编辑库 `local-data/content.sqlite` 是**草稿**，任何模式下都不对外读。
 *
 * ## 跟 store.mjs 一个写法
 *
 * 顶层 `await import()`，按 `PULSE_STORE` 分发 —— 与 `server/store.mjs`
 * 对患者数据的做法一致（同一个开关、同一种姿势）。
 */

const STORE = process.env.PULSE_STORE ?? 'sqlite'

const impl = STORE === 'pg' ? await import('./content-pg.mjs') : await import('./content-local.mjs')

export const { readContent, readContentState } = impl

/** 当前内容层实际读的是哪儿（`/api/content` 会带上这个字段，便于排查） */
export const CONTENT_SOURCE = STORE === 'pg' ? 'pg' : 'snapshot'
