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

/**
 * 内容层可以单独指定来源：`PULSE_CONTENT=snapshot|pg`。
 *
 * ⚠️ 为什么需要这个开关：生产是 `PULSE_STORE=pg`（患者数据走 CloudBase PG），
 *    但京东云那台 PG 上并没有内容层的函数（`content_read` 不存在），
 *    而网站本身**从不调用** `/api/content` —— 之前这个接口一直是 500。
 *    内容层的单一真相源是 `src/content/*.json`（发布命令的产物），
 *    所以生产配 `PULSE_CONTENT=snapshot`：患者数据照旧 PG，内容读快照。
 */
const CONTENT = process.env.PULSE_CONTENT ?? STORE

const impl = CONTENT === 'pg' ? await import('./content-pg.mjs') : await import('./content-local.mjs')

export const { readContent, readContentState } = impl

/** 当前内容层实际读的是哪儿（`/api/content` 会带上这个字段，便于排查） */
export const CONTENT_SOURCE = CONTENT === 'pg' ? 'pg' : 'snapshot'
