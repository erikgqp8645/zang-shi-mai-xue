/**
 * 内容层 · 远端读取（CloudBase PostgreSQL 模式）
 *
 * ## 走哪条路
 *
 * 走 `server/pg-client.mjs` 的 `rpc()` —— 与患者数据**同一个通道**、
 * **不新增 PG 直连通路**（托管 PG 没有暴露连接地址，SDK 路线不需要 VPC）。
 *
 * ## 读什么
 *
 * `content_read` 返回 17 张表的行（每张表一个 jsonb 数组），
 * 本模块把它**还原成 content 包**（8 个 JSON 文件的形状）——
 * 用的是 `server/content-schema.mjs` 里那个**唯一**的 codec
 * （`buildContentFromRows`），和本地快照导出用的是同一个函数。
 *
 * ⭐ **两边的 JSON 列形状不同**（SQLite 存 TEXT 字符串，PG 是 jsonb 真值），
 *   codec 里的 `parseJsonColumn` 两种都收 ⇒ 边界上规整，里面只认一种形状。
 *
 * ## 表清单从哪来
 *
 * `tableDefs()` —— 也就是 `src/content/schema/*.schema.json` 的拓扑序，
 * 与发布时用的**同一份**。远端函数会拿 PG 目录核对这份清单
 * （少表/多表都报错），所以两端不会各说各话。
 */

import { rpc } from './pg-client.mjs'
import { buildContentFromRows, tableDefs } from './content-schema.mjs'

/** 内容表的读取顺序（schema 的拓扑序，与发布时一致） */
export function contentTableOrder() {
  return tableDefs().map((d) => d.table)
}

/**
 * 读远端已发布内容 → content 包。
 *
 * @returns {Promise<{ content: object, version: number, source: 'pg' }>}
 */
export async function readContent() {
  const res = await rpc('content_read', {
    p_owner: '',
    p_args: { order: contentTableOrder() },
  })
  const tables = res?.tables ?? {}
  return {
    content: buildContentFromRows(tables),
    version: await currentVersion(),
    source: 'pg',
  }
}

/**
 * 读当前发布状态（版本号／发布时间／发布人）。
 *
 * @returns {Promise<{ version: number, publishedAt: number|null, publishedBy: string|null }>}
 */
export async function readContentState() {
  const st = await rpc('content_state_get', { p_owner: '', p_args: {} })
  return {
    version: st?.version ?? 0,
    publishedAt: st?.publishedAt ?? null,
    publishedBy: st?.publishedBy ?? null,
    source: 'pg',
  }
}

/** 当前版本号（读内容包时顺带带回去，前端可以拿它做缓存判断） */
async function currentVersion() {
  const st = await rpc('content_state_get', { p_owner: '', p_args: {} })
  return st?.version ?? 0
}
