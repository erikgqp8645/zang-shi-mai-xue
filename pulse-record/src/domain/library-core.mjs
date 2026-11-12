/**
 * 用方知识库 · 合并与级联的**纯逻辑** —— 浏览器与 Node 共用**同一份**
 *
 * ## 为什么单独拎出来
 *
 * 「管理员覆盖层」要同时在两处生效，两处必须**算出同一个结果**：
 *
 *   · **浏览器**（网站端 ③ 知识库）：前端拿覆盖层行，合并到**自己那份基线**上，
 *     得出运行期生效的条目 —— 界面显示的、② 命中的、导出的，都是这一份。
 *   · **Node**（服务端 ＋ 命令行 `npm run admin -- library …`）：
 *     命令行把覆盖层合并进基线写盘（apply），自检（verify）也用同一套语义。
 *
 * 两边各写一份 ⇒ 迟早漂移 ⇒ 网站看到的 ≠ `library apply` 写进基线的。
 * ⇒ 合并与级联必须**只有一份代码**。
 *
 * ## 为什么是 `.mjs` 而不是 `.ts`
 *
 * · **云函数**跑 Node 16／18／20 —— **不能 import `.ts`**（本机 Node 24 能剥类型，
 *   云函数不行）。`.mjs` 谁都能跑。
 * · **小程序**那边 `tsconfig.core.json` 只编译 `src/domain` 下的 `.ts` ⇒
 *   这个 `.mjs` 不会进小程序产物 ⇒ 小程序行为零变化。
 * · 类型靠手写的 `library-core.d.mts`；**实现与声明漂移**由 RE10 断言兜住
 *   （同一组 fixture，两条路算出的结果必须一致）。
 *
 * ## 这个文件里不许有 import
 *
 * 云函数打包只带**这一个文件**（`scripts/build-cloudfunction.mjs` 单独拷它），
 * 里面再 import 别人就断链了 ⇒ 一切自包含。
 *
 * ## 覆盖层语义（与 server/db.mjs 的 formula_patterns 同一套，不发明第二套）
 *
 *   · 有行且 deleted=0 → 用这一行的 payload **整条接管**该基线条目
 *   · 有行且 deleted=1 → **墓碑**：该条目在结果里消失
 *   · 没有行           → 保持内置基线
 */

/**
 * 「未载」哨兵 —— 某套资料里没有这一项时的标准写法。
 *
 * AGENTS.md 引用纪律第 3 条：「没有写明的就不对照，宁可留空并写『未载』」。
 * 它同时是**引用校验里的合法值**：值等于「未载」表示「原来有、现在没有了」，
 * 不算悬空引用。
 */
export const NOT_CARRIED = '未载'

/* ------------------------------------------------------------------ *
 * 稳定序列化                                                             *
 * ------------------------------------------------------------------ */

/** 键顺序无关的稳定序列化（用来判断「这条到底改了没有」） */
export function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stableStringify(value[k]))
        .join(',') +
      '}'
    )
  }
  return JSON.stringify(value)
}

/** 两个条目是否「一样」（键顺序不算差别） */
export function sameEntry(a, b) {
  return stableStringify(a) === stableStringify(b)
}

/* ------------------------------------------------------------------ *
 * 合并                                                                   *
 * ------------------------------------------------------------------ */

/**
 * 合并一类：基线容器 ＋ 覆盖层 → 新容器。
 *
 * @param {object} spec                种类登记信息（只需要 container 与 idField）
 * @param {any} container              基线容器（数组｜对象）
 * @param {object} overridesForKind    该类的覆盖层行 `{ [itemId]: { payload, deleted } }`
 * @returns {{ container: any, added: string[], changed: string[], removed: string[], bad: string[] }}
 */
export function mergeKind(spec, container, overridesForKind) {
  const added = []
  const changed = []
  const removed = []
  const bad = []

  if (spec.container === 'object') {
    const map = new Map(Object.entries(container ?? {}))
    for (const [itemId, ov] of Object.entries(overridesForKind ?? {})) {
      if (ov.deleted) {
        map.delete(itemId)
        removed.push(itemId)
        continue
      }
      if (!ov.payload || typeof ov.payload !== 'object') {
        bad.push(itemId)
        continue
      }
      const before = map.get(itemId)
      const value = String(ov.payload.science ?? '')
      if (before === undefined) added.push(itemId)
      else if (before !== value) changed.push(itemId)
      map.set(itemId, value)
    }
    // ⚠ 手写展开，不用 Object.fromEntries —— 老机型 JSCore 缺 ES2019 的部分内建。
    const out = {}
    for (const [k, v] of map) out[k] = v
    return { container: out, added, changed, removed, bad }
  }

  const map = new Map()
  for (const entry of Array.isArray(container) ? container : []) {
    const id = String(entry?.[spec.idField] ?? '')
    map.set(id, entry)
  }
  for (const [itemId, ov] of Object.entries(overridesForKind ?? {})) {
    if (ov.deleted) {
      map.delete(itemId)
      removed.push(itemId)
      continue
    }
    if (!ov.payload || typeof ov.payload !== 'object' || Array.isArray(ov.payload)) {
      bad.push(itemId)
      continue
    }
    const before = map.get(itemId)
    if (before === undefined) added.push(itemId)
    else if (!sameEntry(before, ov.payload)) changed.push(itemId)
    map.set(itemId, ov.payload)
  }
  return { container: [...map.values()], added, changed, removed, bad }
}

/* ------------------------------------------------------------------ *
 * 级联清理                                                               *
 * ------------------------------------------------------------------ */

/**
 * 级联清理：删掉一个东西，引用它的那些怎么办。
 *
 * 全部按 AGENTS.md 的规矩来 —— **宁可留空并写「未载」，不臆造**：
 *   · 删了讲稿方剂 → 讲义 p44 里引用它的 drugs[] 移除该 id
 *   · 删了成方     → 讲义 p42 的 doseId 置空、doseBasis 标「未载」；科中映射里那一项删掉
 *   · 删了科中     → 科中映射里的值写成「未载」
 *
 * @param {object} files     合并后的文件内容（就地改）
 * @param {object} removed   `{ [kind]: string[] }`
 * @returns {string[]} 这次级联做了什么（给人看的说明）
 */
export function cascadeCleanup(files, removed) {
  const notes = []
  const rules = files['formula-rules.json']?.rules ?? []
  const rows = files['formula-reference.json']?.rows ?? []
  const dosesFile = files['doses.json'] ?? {}
  const scienceMap = dosesFile.scienceByDoseId ?? {}

  // 删了讲稿方剂 → p44 的 drugs[] 里去掉这个 id
  for (const drugId of removed.drug ?? []) {
    for (const rule of rules) {
      if (!Array.isArray(rule.drugs)) continue
      const before = rule.drugs.length
      rule.drugs = rule.drugs.filter((d) => String(d) !== String(drugId))
      if (rule.drugs.length !== before) {
        notes.push(`讲义 p44「${rule.id}」的 drugs[] 去掉了已被删除的讲稿方剂「${drugId}」`)
      }
    }
  }

  // 删了成方 → p42 的 doseId 置空并标「未载」；科中映射里那一项删掉
  for (const doseId of removed.dose ?? []) {
    for (const row of rows) {
      if (String(row.doseId ?? '') !== String(doseId)) continue
      row.doseId = ''
      const mark = `未载（原 doseId=${doseId} 已删除）`
      row.doseBasis = row.doseBasis ? `${mark}；${row.doseBasis}` : mark
      notes.push(`讲义 p42 第 ${row.no} 行的 doseId 已置空并标「未载」（成方「${doseId}」被删除）`)
    }
    if (Object.prototype.hasOwnProperty.call(scienceMap, doseId)) {
      delete scienceMap[doseId]
      notes.push(`科中映射里的「${doseId}」已删除（成方被删除）`)
    }
  }

  // 删了科中 → 科中映射里的值写成「未载」
  for (const scienceName of removed.science ?? []) {
    for (const [doseId, value] of Object.entries(scienceMap)) {
      if (String(value) !== String(scienceName)) continue
      scienceMap[doseId] = NOT_CARRIED
      notes.push(`科中映射「${doseId}」的科中名已写成「未载」（科中「${scienceName}」被删除）`)
    }
  }

  return notes
}
