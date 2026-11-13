/**
 * 用方知识库 · **浏览器侧的生效集合并**（纯函数）
 *
 * ## 是什么
 *
 * 「管理员覆盖层」的改动要显示在网站端 ③ 里，就得有一处把
 * 「前端自己那份基线」与「服务端覆盖层」合成「运行期生效的那一份」。
 * 这一处就是本文件。
 *
 * ⓘ 生效集只有一处 ⇒ 界面显示的、② 命中的、导出的，都是同一份。
 *
 * ## 为什么单独拎出来（而不是写在 React 组件里）
 *
 * · 断言脚本（`scripts/e2e/library-runtime-edit.mjs`）必须能调用**真正的那一份**
 *   合并逻辑 —— 在测试里重写一遍，早晚与实现漂移。
 * · 本文件是纯函数：DOM-free、零 import（除了同目录的 `library-core.mjs`）、
 *   ES2017-safe ⇒ 浏览器、Node、断言脚本三处跑的是同一段代码。
 *
 * ## 与命令行的关系
 *
 * 合并与级联的**底层**（`mergeKind`／`cascadeCleanup`）在 `library-core.mjs`，
 * 浏览器与 `npm run admin -- library apply` 共用 ⇒ 两边算出的结果必然一致。
 * 本文件只负责**浏览器侧多出来的那一步**：把「基线里没有的覆盖行」挡掉
 * （详见 `onlyBaseline`）。
 *
 * ## 小程序端
 *
 * 小程序不设这个 store ⇒ 生效集永远是基线 ⇒ 行为零变化。
 * （网站端改了覆盖层、小程序看不到 —— 这是**已知缺口**，记在 docs/progress.md。）
 */

import { cascadeCleanup, mergeKind } from './library-core.mjs'

/**
 * 只保留**能安全进生效集**的那些覆盖行。
 *
 * ⚠️ 为什么必须滤：覆盖层里若有一条基线没有的 id（命令行手滑造的），
 *   `mergeKind` 会把它**新增**进生效集 ⇒ 前端 `loadRules` 找不到判定函数 ⇒ 抛错 ⇒ 崩。
 *
 * ## 例外：**自带脉象图的新增**（2026-11-12）
 *
 * 管理员在网站上「＋ 新增条目」造的 p44 条目，基线里当然没有 —— 但它
 * **自带 `patterns`（脉象图），图即判定**（`src/domain/pulse-pattern.ts` 的
 * `evaluatePattern`）⇒ 前端载入得动 ⇒ 放行。
 *
 * `drug`（讲稿方剂）是**纯数据**，没有判定函数这回事 ⇒ 陌生 id 一律放行。
 *
 * @param {object} overrides  覆盖层（按种类分组）
 * @param {string} kind       种类（`rule`／`drug`）
 * @param {Set<string>} baselineIds 基线里已有的 id
 * @returns {{ kept: object, stray: string[] }}
 */
export function onlyBaseline(overrides, kind, baselineIds) {
  const kept = {}
  const stray = []
  for (const [id, row] of Object.entries(overrides?.[kind] ?? {})) {
    if (baselineIds.has(id)) {
      kept[id] = row
      continue
    }
    // 基线里没有 ＝ 新增。删掉的（墓碑）不算新增，交给下面的 stray 逻辑。
    const isNew = !row?.deleted
    if (isNew && kind === 'rule') {
      const patterns = row?.payload?.patterns
      if (Array.isArray(patterns) && patterns.length > 0) {
        kept[id] = row // 画图即条件：有图就有判定
        continue
      }
    }
    if (isNew && kind === 'drug') {
      kept[id] = row // 讲稿方剂是纯数据，不需要判定函数
      continue
    }
    stray.push(id)
  }
  return { kept, stray }
}

/**
 * 合并：基线 ⊕ 覆盖层 → 生效集（规则 ＋ 方剂）。
 *
 * ⚠️ **级联**：删了讲稿方剂 ⇒ 讲义 p44 里引用它的 `drugs[]` 要去掉那个 id
 *   （否则留下悬空引用）。级联用共享逻辑里的 `cascadeCleanup`。
 *
 * @param {object} kinds         注册表（来自 `GET /api/library/kinds`）
 * @param {object} overrides     覆盖层（来自 `GET /api/library/overrides`）
 * @param {any[]} baselineRules  内置基线里的规则（`src/content/formula-rules.json` 的 rules[]）
 * @param {any[]} baselineDrugs  内置基线里的讲稿方剂（`src/content/drugs.json` 的 drugs[]）
 * @param {any[]} [baselineDoses] 内置基线里的同和堂版成方（`src/content/doses.json` 的 doses[]）
 *   给了才合并 `dose` 这一类（2026-11-13 起：「剂量对照」那几行要能编辑）。
 *   不传 ⇒ `doseData` 为 null，调用方回落到静态基线 —— 老调用点行为不变。
 * @returns {{ ruleData: any[], drugData: any[], doseData: any[]|null, problems: string[] }}
 */
export function mergeLibrary(kinds, overrides, baselineRules, baselineDrugs, baselineDoses) {
  const problems = []

  /**
   * ⚠️ **深拷贝一份再合** —— 否则级联会**就地改掉基线条目**。
   *
   * `cascadeCleanup` 是就地改 `rule.drugs` 的（它拿到的是合并结果里的那批对象，
   * 而未改动的那批**就是基线原对象**）⇒ 不拷贝的话，
   * 「删一个讲稿方剂」会把浏览器的基线 JSON 也改了 ⇒ 刷新前后的知识库不一样。
   *
   * 命令行那边（`mergeAll`）也是先 `JSON.parse(JSON.stringify(...))` 再合 ——
   * 两边做法一致。
   */
  const rules = JSON.parse(JSON.stringify(Array.isArray(baselineRules) ? baselineRules : []))
  const drugs = JSON.parse(JSON.stringify(Array.isArray(baselineDrugs) ? baselineDrugs : []))

  const ruleIds = new Set(rules.map((r) => String(r?.id ?? '')))
  const drugIds = new Set(drugs.map((d) => String(d?.id ?? '')))

  const ruleOv = onlyBaseline(overrides, 'rule', ruleIds)
  const drugOv = onlyBaseline(overrides, 'drug', drugIds)
  for (const id of ruleOv.stray) {
    problems.push(
      `覆盖层里有一条讲义 p44 条目「${id}」不在内置基线里，也没带脉象图 —— 已跳过` +
        `（前端既没有它的判定函数、也没有图可当条件）`,
    )
  }
  for (const id of drugOv.stray) {
    problems.push(`覆盖层里有一条讲稿方剂「${id}」不在内置基线里 —— 已跳过`)
  }

  const ruleSpec = kinds?.rule
  const drugSpec = kinds?.drug
  if (!ruleSpec || !drugSpec) {
    throw new Error('注册表里没有 rule／drug —— 合并不了')
  }

  const mergedRules = mergeKind(ruleSpec, rules, ruleOv.kept)
  const mergedDrugs = mergeKind(drugSpec, drugs, drugOv.kept)

  /*
   dose（同和堂版成方）：只在调用方给了基线、且注册表里有这一类时才合。
   它是**纯数据**（没有判定函数那回事）⇒ 陌生 id 一律放行。
  */
  let mergedDoses = null
  const doseSpec = kinds?.dose
  if (Array.isArray(baselineDoses) && doseSpec) {
    const doses = JSON.parse(JSON.stringify(baselineDoses))
    const doseIds = new Set(doses.map((d) => String(d?.id ?? '')))
    const doseOv = onlyBaseline(overrides, 'dose', doseIds)
    for (const id of doseOv.stray) {
      problems.push(`覆盖层里有一条同和堂版成方「${id}」不在内置基线里 —— 已跳过`)
    }
    mergedDoses = mergeKind(doseSpec, doses, doseOv.kept).container
  }

  // 级联：删掉的方剂 ⇒ p44 的 drugs[] 里去掉那个 id
  const files = {
    'formula-rules.json': { rules: mergedRules.container },
    'drugs.json': { drugs: mergedDrugs.container },
  }
  cascadeCleanup(files, { drug: mergedDrugs.removed })

  return {
    ruleData: files['formula-rules.json'].rules,
    drugData: files['drugs.json'].drugs,
    doseData: mergedDoses,
    problems,
  }
}
