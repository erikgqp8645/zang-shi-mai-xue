/**
 * 用方知识库 · 方名标签（chip）的改／删 —— 纯函数
 *
 * ## 为什么单独拎出来
 *
 * ③ 知识库里每个方名标签上有「✎（改）／✕（删）」两个按钮。
 * 它们改的是**方名数组**（`formulas[]`），与命令行
 * `npm run admin -- library set rule <id> --set formulas=…` 是同一件事、同一口径。
 *
 * ⚠️ 这两个操作**会写整条数组**（覆盖层语义＝有行就整条接管）⇒
 *   「删掉一个标签」如果实现成「只删那一个、别的照旧」是对的；
 *   如果实现成「数组改写时丢了别的项」⇒ **用户会以为只是删一个标签，
 *   实际上别的方名也没了** —— 而且界面上看不出来。
 *
 * ⇒ 这段逻辑必须是**纯函数**、可被断言直接调用 ⇒ 抽到这里。
 *
 * ⓘ 与服务端 PATCH 的关系：这里只算出「下一个数组」，
 *   落库由上层（`src/state/library.tsx` 的 `saveLibraryPatch`）去做。
 */

/**
 * 改一个标签（✎）。
 *
 * ⓘ 文字为空或与原来一样 ⇒ **原样返回**（不改数组）——
 *   上层据此判断「没改」，不必白跑一趟落库。
 *
 * @param list  现在的方名数组
 * @param index 要改的那一项
 * @param text  新文字
 * @returns 新的数组（**不改动**传进来的那个）
 */
export function setChip(list, index, text) {
  const arr = Array.isArray(list) ? list : []
  const i = Number(index)
  const value = String(text ?? '').trim()
  if (!Number.isInteger(i) || i < 0 || i >= arr.length) return arr.slice()
  if (!value || value === arr[i]) return arr.slice()
  const next = arr.slice()
  next[i] = value
  return next
}

/**
 * 删一个标签（✕）。
 *
 * ⚠️ 只删**那一项**，其余原样保留 —— 少一项、多一项都不行。
 *
 * @param list  现在的方名数组
 * @param index 要删的那一项
 * @returns 新的数组（**不改动**传进来的那个）
 */
export function removeChip(list, index) {
  const arr = Array.isArray(list) ? list : []
  const i = Number(index)
  if (!Number.isInteger(i) || i < 0 || i >= arr.length) return arr.slice()
  return arr.filter((_, j) => j !== i)
}

/**
 * 两个方名数组**内容是否一样**（顺序也算）。
 *
 * ⚠️ 判「有没有变化」必须比**内容**，不能只比长度：
 *   长度相等但内容不同（例如只剩一项、被换成了新名字）也是变化，
 *   当成「没改」会把用户的改动吞掉，而且界面上看不出来。
 *
 * ⓘ 改／删／加三条路径（`setChip`／`removeChip`／`addChip`）都靠它决定
 *   「要不要白跑一趟落库」—— 所以只写这一份。
 *
 * @param a 旧数组
 * @param b 新数组
 */
export function sameChips(a, b) {
  const x = Array.isArray(a) ? a : []
  const y = Array.isArray(b) ? b : []
  if (x.length !== y.length) return false
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) return false
  }
  return true
}

/**
 * 加一个标签（＋）。
 *
 * ⓘ 空文字不算；已经有一样的也不重复加。
 *
 * @param list 现在的方名数组
 * @param text 要加的文字
 */
export function addChip(list, text) {
  const arr = Array.isArray(list) ? list : []
  const value = String(text ?? '').trim()
  if (!value) return arr.slice()
  if (arr.includes(value)) return arr.slice()
  return [...arr, value]
}
