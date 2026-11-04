/**
 * 键值对数组 → 对象。
 *
 * **为什么不用 `Object.fromEntries`**：那是 ES2019 的内建，
 * 共享包要编到小程序里去（`target: ES2017`），而 `target` 只降级**语法**、不补**运行时内建** ——
 * 部分老机型的 JSCore 上 `Object.fromEntries` 不存在，页面会直接白屏。
 * 这里自己写一份，行为一致（后者键顺序按插入序），零依赖。
 *
 * 与服务端 `server/db.mjs` 的做法无关：那边是 SQL，不涉及 JS 内建。
 */
export function toRecord<T>(entries: [string, T][]): Record<string, T> {
  const out: Record<string, T> = {}
  for (const e of entries) out[e[0]] = e[1]
  return out
}
