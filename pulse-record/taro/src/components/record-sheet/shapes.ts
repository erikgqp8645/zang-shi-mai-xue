/**
 * 形状规整 —— **纯函数，没有副作用**
 *
 * ## 为什么单独抽出来
 *
 * 自定义组件的属性（sessions）要经过「逻辑层 → 视图层 → 逻辑层」这一圈，
 * 视图层的数据协议会把**嵌套数组**压成「数字下标的普通对象」：
 * `["X"]` 回来变成 `{"0":"X"}`。
 * 于是 `formatCodes` 里的 `codes.join` 直接抛「codes.join is not a function」——
 * 而且是**静默失败**：表格那一列画不出来，页面上看不出所以然。
 *
 * 更要命的是第二次编辑：格值已经是对象了，再点另一格就会把
 * `{"0":"X"}` 这种形状**存进数据库**，以后这个患者这一格就读不出来了。
 *
 * 所以：**凡是读格值、凡是往外抛 sessions，都先按数字下标还原回数组。**
 * 服务端 `server/db.mjs` 的 `normalizeValues` 做同一件事 —— 两端都兜住。
 *
 * ## 为什么是纯函数
 *
 * Taro 化之后 `miniprogram-automator` 驱动不了页面实例了（页面是 React 组件，
 * 拿不到实例方法），所以这类逻辑必须有**可直接断言的纯函数面** ——
 * 这份文件就是那个面（`scripts/e2e/taro-sim.mjs` 直接打它）。
 */

/** 把「一个格子的符号」还原成数组 */
export function toCodeArray(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[]
  if (v && typeof v === 'object') {
    return Object.keys(v as Record<string, unknown>)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => (v as Record<string, unknown>)[k] as string)
  }
  return []
}

/** 把一次就诊的 values 里每个格值都规整成数组（空的格＝没有这一格） */
export function cleanValues(values: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  const src = (values || {}) as Record<string, unknown>
  Object.keys(src).forEach((k) => {
    const arr = toCodeArray(src[k])
    if (arr.length) out[k] = arr
  })
  return out
}

/** 一次就诊在记录表里的形状（规整前后都长这样） */
export interface SheetSessionLike {
  id: string
  values?: Record<string, string[]>
  constitution?: string | null
  therapy?: string | null
}

/** 把整份 sessions 规整（每个格值都还原成数组） */
export function cleanSessions<T extends SheetSessionLike>(sessions: T[] | undefined): T[] {
  return (sessions || []).map((s) => ({ ...s, values: cleanValues(s.values) }))
}

/** 内容是否一致 —— 用来判断父组件传来的 sessions 是不是「同一份」 */
export function sameSessions(a: SheetSessionLike[], b: SheetSessionLike[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]
    const y = b[i]
    if (x.id !== y.id) return false
    if ((x.constitution || '') !== (y.constitution || '')) return false
    if ((x.therapy || '') !== (y.therapy || '')) return false
    if (JSON.stringify(cleanValues(x.values)) !== JSON.stringify(cleanValues(y.values))) return false
  }
  return true
}
