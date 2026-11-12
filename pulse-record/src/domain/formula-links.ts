/**
 * 三部曲 ③ 的方名 → 「用方」知识库条目的**明确对照**
 *
 * ## 要解决的问题
 *
 * 「就诊」工作台的 ③ 开方药档里列的是**讲义 p47「开方三部曲图」上的方名**
 * （清挡路方／引火归元／冷热水…），而「用方」tab 是一套**完整的知识库**
 * （讲义 p44 依脉用方 ＋ 讲稿第二讲方剂 ＋ 同和堂版组成）。
 *
 * 两边是**同一个方在不同资料里的不同写法**，所以要能对上。
 * 现在两边是断的：③ 里看得见方名，却点不进去看组成、服法、禁忌。
 *
 * ## 纪律（与「查组成纪律」一致）
 *
 *   1. **只做明确的同方对照** —— 每条都带依据（`basis`）。
 *   2. **方名后括号不算方名** —— 「引火归元（肾脏疗法）」的方名是「引火归元」。
 *   3. **讲义用名走别名表** —— `FORMULA_ALIAS`（「讲义 p42/p47 用名 → 讲稿条目名」）。
 *   4. **组合方（带「＋」）与单方不作候选** —— 组合方另有其条目，不拿来充数。
 *   5. **查不到就返回 null** —— 界面上明说「用方页未载」，**不硬凑**。
 *
 * ## 为什么优先跳「讲稿方剂」而不是「规则条目」
 *
 * 用户点方名的意图是「这方怎么吃」——
 * 讲稿第二讲的方剂条目有**组成／服法／科学中药／加减／禁忌**，
 * 规则条目只有适用条件与原文引用。所以：
 *
 *   讲稿方剂能对上 → 跳讲稿方剂
 *   对不上 → 再看讲义 p44 的规则条目（清挡路就是这种）
 *   都没有 → 明说未载
 */
import { getEffectiveDrugs } from './drugs'
import { getEffectiveRules } from './formulas'
import { FORMULA_ALIAS } from './medication'

/** 锚点种类：`drug`＝讲稿方剂条目，`rule`＝讲义 p44 依脉用方条目 */
export type FormulaLinkKind = 'drug' | 'rule'

export interface FormulaLink {
  kind: FormulaLinkKind
  /** 目标条目在知识库里的 id（`DRUGS` 的 id 或 `FORMULA_RULES` 的 id） */
  id: string
  /** 目标条目的方名（照录，不改写） */
  label: string
  /** 对照依据 —— 界面上会显示，免得读者以为是我自己认的 */
  basis: string
}

/**
 * 讲义 p47 图上的用名 → 讲义 p44 规则条目的 id。
 *
 * 只有「清挡路方」需要单独对照：**它与 p44 的「清挡路」差一个「方」字**，
 * 而「方名照录、不改写」是硬规矩 —— 不能悄悄把「清挡路方」改成「清挡路」去匹配，
 * 只能在这里**明确声明这是同一个东西**，并写清依据。
 */
const RULE_LINKS: Record<string, { id: string; label: string; basis: string }> = {
  清挡路方: {
    id: 'fx-ssx-qingdanglu',
    label: '清挡路',
    basis:
      '讲义 2026-10·p47 开方三部曲图作「清挡路方」；讲义 2026-10·p44 上盛下虚框 1 作「清挡路」；' +
      '讲稿 2010·第四讲作「清挡路一~四」—— 三处指同一组方',
  },
}

/**
 * 方名主体：**括号后的说明不算方名**。
 *
 * 「引火归元（肾脏疗法）」→ 主体「引火归元」；
 * 「一体疗法（冷热水疗法）」→ 主体「一体疗法」。
 */
function baseName(name: string): string {
  const i = name.indexOf('（')
  return i > 0 ? name.slice(0, i) : name
}

/**
 * 把 ③ 的方名解析成知识库锚点。
 *
 * 解析顺序（先精确后宽松，命中即止）：
 *   1. `RULE_LINKS` —— 明确声明的规则对照（「清挡路方」）
 *   2. 讲稿方剂**完全同名**
 *   3. 讲稿方剂**方名后括号不算方名**（「引火归元」→「引火归元（肾脏疗法）」）
 *   4. 讲义用名走 `FORMULA_ALIAS`（「冷热水」→「一体疗法（冷热水疗法）」）
 *   5. 讲义 p44 规则条目的 `formulas` 里**完全相等**
 *
 * @param name ③ 里的方名（照录，不做预处理）
 * @returns 锚点；查不到返回 `null`（界面明说「用方页未载」）
 */
export function resolveFormulaLink(name: string): FormulaLink | null {
  const q = name.trim()
  if (!q) return null

  // ① 明确声明的规则对照
  //    ⚠️ 管理员可能已经把这条规则删了（`library del rule <id>`）——
  //    那就不能再跳过去：锚点不存在，点了没反应。
  //    这里查一下还在不在，不在就往下走，最后落到「用方页未载」。
  const rl = RULE_LINKS[q]
  if (rl && getEffectiveRules().some((r) => r.id === rl.id)) return { kind: 'rule', ...rl }

  // ②③ 讲稿方剂：完全同名 → 方名后括号不算方名
  const drug =
    getEffectiveDrugs().find((d) => d.name === q) ||
    getEffectiveDrugs().find((d) => baseName(d.name) === q)
  if (drug) {
    return {
      kind: 'drug',
      id: drug.id,
      label: drug.name,
      basis:
        drug.name === q
          ? '讲稿 2010·第二讲「叁、用方」同名条目'
          : `讲稿 2010·第二讲「叁、用方」条目「${drug.name}」（方名后括号不算方名）`,
    }
  }

  // ④ 讲义用名 → 讲稿条目名（别名表里有依据的对照）
  const alias = FORMULA_ALIAS[q]
  if (alias) {
    const d = getEffectiveDrugs().find((x) => x.name === alias)
    if (d) {
      return {
        kind: 'drug',
        id: d.id,
        label: d.name,
        basis: `讲义用名「${q}」→ 讲稿条目「${d.name}」（别名表 ` + '`FORMULA_ALIAS`' + '）',
      }
    }
  }

  // ⑤ 讲义 p44 规则条目：方名完全相等
  const rule = getEffectiveRules().find((r) => r.formulas.includes(q))
  if (rule) {
    return {
      kind: 'rule',
      id: rule.id,
      label: q,
      basis: `${rule.source}（${rule.route} · ${rule.condition}）`,
    }
  }

  // 查不到 —— 不硬凑
  return null
}

/**
 * 锚点在页面上的 DOM id（滚动定位用）。
 *
 * **页面上的 `id` 属性必须与这里一致** —— 卡片渲染时用 `formulaAnchor(kind, id)`，
 * 跳转时用 `formulaAnchorId(link)`；两者走同一个函数，不会走偏。
 */
export function formulaAnchor(kind: FormulaLinkKind, id: string): string {
  return `${kind}-${id}`
}

/** 锚点在页面上的 DOM id（滚动定位用） */
export function formulaAnchorId(link: FormulaLink): string {
  return formulaAnchor(link.kind, link.id)
}
