/**
 * 自定义符号的**知识常量与共用校验**。
 *
 * 与 `src/domain/symbols.ts` 保持一致（那边是前端 TS，这边是服务端 .mjs，无法互相 import）——
 * **改一处要一起改**。放这里是因为它跟存储实现无关：换 SQLite／PG 都不变。
 */

export const RESERVED_SYMBOL_CODES = [
  '0', '-', '+', '±', '++', '±±', '+++', '++++', '↑', '|', '#', 'TTT', 'DDX', 'X',
]

/**
 * 不能当符号代码的两个值。
 *
 * `.` / `..` 是 URL 里的「当前目录 / 上一级」，任何 HTTP 客户端都会先把它们归一化掉：
 * `DELETE /api/symbols/..` 到服务端时路径已经变成 `/api/`，
 * 于是**建得进去、永远删不掉**（只能进数据库手删）。所以从源头拒掉。
 */
export const UNUSABLE_SYMBOL_CODES = ['.', '..']

/**
 * 「看不见」的字符 —— 不止零宽空格一种。
 *
 * 只列零宽空格（U+200B）是不够的，实测这一批都能绕过「非空」检查，
 * 而且存进去之后**肉眼与正常符号完全一样**（软连字符甚至能造出 `S` 的影子符号）：
 *
 *   · 软连字符 U+00AD、阿拉伯字母标记 U+061C —— 只是「格式字符」，`trim()` 删不掉
 *   · 盲文空白 U+2800、韩文填充符 U+3164／U+115F／U+FFA0 —— 有字形，但字形是空白
 *   · 变体选择符 U+FE00–FE0F、组合用附加符 U+0300–036F —— 单独出现时什么都不显示
 *   · 标签字符 U+E0020–E007F、BOM U+FEFF、方向控制符 U+202A–202E
 *
 * ⚠️ 这个集合**含各种空白**（U+2000–200A、U+202F、U+205F、U+3000），
 * 只用于**符号代码**（代码本来也不许有空格）。名称用的是下面那个宽松版。
 */
const INVISIBLE_CODE =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u0300-\u036f\u0483-\u0489\u0600-\u0605\u061c\u06dd\u070f\u115f\u1160\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u2066-\u206f\u20d0-\u20f0\u2800\u3000\u3164\ufe00-\ufe0f\ufe20-\ufe2f\ufeff\uffa0\ufff9-\ufffb\u1ab0-\u1aff\u1dc0-\u1dff\u{1d173}-\u{1d17a}\u{e0001}\u{e0020}-\u{e007f}]/u

/**
 * 名称用的宽松版：**空白是看得见宽度的，名称里允许**。
 *
 * 中文输入法在中文标点模式下打空格，产出的常常是 U+3000（全角空格）——
 * 如果按「看不见」拒掉，用户会莫名其妙：「涩　脉」和「涩 脉」凭什么一个能存一个不能。
 * 所以名称只拦「没有任何字形」的字符（零宽、软连字符、组合符、标签字符、盲文空白……），
 * 各种宽度的空格一律放行。
 */
const INVISIBLE_NAME =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u0300-\u036f\u0483-\u0489\u0600-\u0605\u061c\u06dd\u070f\u115f\u1160\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\u20d0-\u20f0\u2800\u3164\ufe00-\ufe0f\ufe20-\ufe2f\ufeff\uffa0\ufff9-\ufffb\u1ab0-\u1aff\u1dc0-\u1dff\u{1d173}-\u{1d17a}\u{e0001}\u{e0020}-\u{e007f}]/u

/** 文本里有不可见字符（按**符号代码**的严判） */
export function hasInvisibleChars(text) {
  return INVISIBLE_CODE.test(String(text ?? ''))
}

/**
 * 自定义符号的完整校验 —— 返回错误信息，通过则 null。
 *
 * **路由、两套存储实现都调这一个函数**，不各写一份：
 * 以前路由校验 6 项、存储层只校验 3 项，直调存储（脚本、云函数、未来新路由）
 * 就能写进 `ABCD`、`S S`、13 字名称。现在「三层」真的是同一套规则。
 *
 * 前端 `src/domain/symbols.ts` 的 `validateCustomSymbol()` 是同一套规则的另一份
 * （TS 与 .mjs 无法互相 import），文案可以不同，判定要一致。
 *
 * **唯一的例外**：前端还会拦「同一人重复代码」（提示「代码 S 已经有了」），
 * 服务端不拦 —— 它按 `(owner_id, code)` upsert，同一个代码再存就是**改名**。
 * 网页端与小程序面板都用前端的口径，所以从界面进不去「改名」，只能删了再建。
 */
export function symbolInputError(code, name) {
  const c = String(code ?? '').trim()
  const n = String(name ?? '').trim()

  // 硬性规定：符号不能为空 —— 一格脉象总得写出一个看得见的符号或字母
  if (!c || !n) return '符号不能为空 —— 代码与名称都要填（如 S＝涩）'
  if (INVISIBLE_CODE.test(c)) return '符号里有看不见的字符，换一个能看见的'
  if (INVISIBLE_NAME.test(n)) return '名称里有看不见的字符，换一个能看见的'
  if (c.length > 3) return '符号代码最多 3 个字符'
  if (/\s/.test(c) || c.includes('/')) return '符号代码里不能有空格或「/」'
  if (UNUSABLE_SYMBOL_CODES.includes(c)) return '不能把「.」或「..」当符号（这种地址删不掉）'
  if (n.length > 12) return '符号名称最多 12 个字符'
  if (RESERVED_SYMBOL_CODES.includes(c)) return `代码「${c}」与讲义固定符号重复，换一个`
  return null
}
