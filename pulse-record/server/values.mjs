/**
 * 脉象格值与枚举的**共享规整逻辑**
 *
 * ## 为什么抽出来
 *
 * 存储层有两套实现（SQLite / PostgreSQL），它们对**同一份业务数据**必须给出
 * 同样的形状。规整逻辑（把「每个格＝一个符号数组」还原出来）如果各写一份，
 * 迟早会漂移 —— 一边支持某种脏形状、另一边不支持，症状是「换后端后数据读不出来」。
 *
 * 所以规则只有这一份，两套实现都 import 它。
 *
 * ## normalizeValues 为什么要存在
 *
 * 小程序的自定义组件属性（sessions）会走一圈 **逻辑层 → 视图层 → 逻辑层**，
 * 视图层的数据协议把**嵌套数组**压成了「数字下标的普通对象」：
 * `["X"]` 回来变成 `{"0":"X"}`。
 * 这种形状一旦被存进库，这一格以后就再也读不出来了。
 *
 * 所以两端都兜住：
 *   · 小程序侧（components/record-sheet）读写前先还原成数组
 *   · 服务端侧（本模块）写库前规整、读出来也规整 —— 老的脏数据照样读得对
 */

/** 体质与疗法的合法取值（讲义 p47 图上的用字）；不合规的一律当作未填 */
export const CONSTITUTIONS = ['肾虚', '上盛下虚', '平和']
export const THERAPIES = ['三焦疗法', '五脏疗法', '一体疗法']

/** JSON 文本 → 对象；解析失败或不是对象 → 空对象 */
export function parseValues(json) {
  try {
    const v = JSON.parse(json)
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

/**
 * 把一次就诊的格值规整成「每个格＝一个符号数组」。
 *
 * 入参可以是：
 *   · 正常形状 `{ 'L|寸|浮': ['+'] }`
 *   · 视图层压过的形状 `{ 'L|寸|浮': { 0: 'X' } }` → 还原成 `['X']`
 *   · 非法值 → 该格当作空
 */
export function normalizeValues(values) {
  const out = {}
  if (!values || typeof values !== 'object') return out
  for (const [key, raw] of Object.entries(values)) {
    let arr = raw
    if (!Array.isArray(raw)) {
      if (raw && typeof raw === 'object') {
        arr = Object.keys(raw)
          .filter((k) => /^\d+$/.test(k))
          .sort((a, b) => Number(a) - Number(b))
          .map((k) => raw[k])
      } else {
        arr = []
      }
    }
    if (arr.length) out[key] = arr
  }
  return out
}

/** 取合法枚举值；不在清单里 → null（当作未填） */
export function pickEnum(list, value) {
  return list.includes(value) ? value : null
}
