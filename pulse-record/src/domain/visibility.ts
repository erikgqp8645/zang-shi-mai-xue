/**
 * 内容层的「是否显示」标志
 *
 * ## 是什么
 *
 * 内容层（`src/content/*.json`）里的每一条内容都可以带一个 `visible` 布尔：
 * **false＝这一条不展示**。
 *
 * ⓘ 这是**共享层**的字段（后台改 → 发布 → 全站一致），
 *   不是本机偏好、也不是个人覆盖 —— 一个设置只留一处真源。
 *
 * ## 语义：缺省＝显示
 *
 * 判据是 **`=== false`** 而不是「有没有这个键」——
 *   · 老内容（没写这个键）⇒ 显示（不因为加字段就把旧条目全藏了）；
 *   · 后台新加的行没填 ⇒ 显示（`NULL` 还原回来也是显示）。
 *
 * ⚠️ 这条判据写在**这里**一处 —— 条目、方剂、知识库三处都读它，
 *    别在别处再写一遍 `visible !== false`（同一个意思写两遍就会漂）。
 */

/** 带「是否显示」标志的一条内容 */
export interface VisibleFlag {
  visible?: boolean
}

/** 这一条要不要展示（缺省＝展示） */
export function isVisible(item: VisibleFlag): boolean {
  return item.visible !== false
}
