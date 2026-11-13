/**
 * 依脉用方
 *
 * 骨架：讲义 2026-10 p44「依脉用方」图 + p46「附表一 体质分类（依脉拉个性）」治疗列
 * 补充：讲稿 2010 第四讲「五脏疗法图 · 清挡路一~四」、第六讲「双关同治 · 肝心同治」，
 *       以及讲稿的方剂配伍与「三不用」。
 *
 * 关键对应：讲义 p44 图上的编号（一）～（六）＝ 讲稿 2010 第四讲讲的「挡路」序号——
 *   「一、二、三、四有四个挡路，清掉之后就可以入肾了。第五、第六比较不会挡，
 *     一并清掉以后，就可以入肾了。」（讲稿 2010·第四讲）
 * 所以 p44 的六个方框与讲稿的清挡路一～六是同一套东西，两边分别标注出处。
 *
 * 本文件只照抄原文中写明的「脉象 → 治法 → 方剂」，不替读者加减方、不下诊断。
 */

import type { Depth, Hand, Organ } from './types'
import { cellKey } from './types'
import {
  bianMaiCells,
  chiUnbalancedCells,
  chiWeakCell,
  floatingCodes,
  fuDa,
  fuDing,
  fuHongDa,
  fuRuan,
  fuWuOrRuo,
  hasNoForce,
  leftRightMismatch,
  xianCells,
  zhongYouLi,
  type RuleContext,
} from './pulse'
import { PATTERNS } from './pulse-patterns'
import { evaluatePattern } from './pulse-pattern'
import type { PulsePattern } from './pulse-pattern'
import { isDa, strengthOf } from './symbols'
import RULE_DATA from '../content/formula-rules.json'
import LIBRARY_DATA from '../content/library-settings.json'
import { getLibraryState } from './library-store'

export type FormulaKind = '主线' | '挡路' | '加味' | '禁忌'

export interface FormulaRule {
  id: string
  /** 路线：肾虚 / 上盛下虚 / 挡路一 … */
  route: string
  /** 触发条件（原文用语） */
  condition: string
  /** 治法 */
  therapy: string
  /** 方剂 */
  formulas: string[]
  /**
   * **加减药／添加药**（不是方）—— 与 `formulas` 里的方名分开标。
   *
   * 讲稿有几条讲的是「往主方里加什么药」（如「引火归元的添加药：知柏、羌活、柴味归……」），
   * 那些药名**不是方名**，不该去查成方 —— 查了只会撞上名字相近的方（如「知柏」撞「知柏六味桂」）。
   */
  adds?: string[]
  /** 关联 drugs.ts 的方剂 id（组成／服法／加减／禁忌） */
  drugs?: string[]
  /** 出处 */
  source: string
  /** 原文 */
  quote: string
  kind: FormulaKind
  /** 常驻条目（如用药禁忌）：不依赖脉象，始终列出 */
  always?: boolean
  /**
   * **这一条要不要在「用方知识库」里显示**（共享层，全站一致）。
   *
   * ⓘ 这是**内容层**的字段（后台改 → 发布 → 全站生效），不是本机偏好。
   * ⓘ 判读判定**不受它影响** —— `evaluate` 仍按脉象命中，
   *    ②「定疗法」面板的命中结果照旧；只是这一条不出现在知识库列表里。
   */
  visible?: boolean
  /**
   * 本条的**脉象图**（条件示意）—— 讲稿／讲义写明的格位要求。
   *
   * 与 `evaluate` 的方向相反：`evaluate` 是拿已录的脉象去算命中，
   * `pattern` 是反过来声明「这一条要求哪些格是什么」。
   * 两者由 `scripts/e2e/pulse-pattern.mjs` 的不变量断言绑死。
   */
  pattern?: PulsePattern
  /**
   * 本条的**全部**脉象图（一个方剂可对应几种脉象）。
   *
   * 内置数据一条只有一张，加载时由 `pattern` 包成单元素数组；
   * 使用者手填多张时由覆盖层给出。`pattern` 保留作兼容（= `patterns[0]`），
   * 界面一律读 `patterns`。
   */
  patterns?: PulsePattern[]
  /** 命中的单元格；空数组表示未命中 */
  evaluate: (ctx: RuleContext) => string[]
}

export interface FormulaHit extends FormulaRule {
  cells: string[]
}

/* ------------------------------------------------------------------ */
/* 规则数据 → 规则                                                      */
/* ------------------------------------------------------------------ */

/**
 * JSON import 的实际类型 —— 字面量字段（kind）被 TS 放宽成了 `string`。
 * 这里如实描述它，内部再收窄。
 */
export interface RuleDataJson {
  id: string
  route: string
  condition: string
  therapy: string
  formulas: string[]
  adds?: string[]
  drugs?: string[]
  source: string
  quote: string
  kind: string
  always?: boolean
  visible?: boolean
  /**
   * **新建条目自带的脉象图**（网站端「＋ 新增条目」写进来的）。
   *
   * 它就是这条的**判定条件**（画图即条件）—— 详见 `loadRules`。
   * 基线那 61 条没有这个字段（判定在 `EVALUATORS` 里）。
   */
  patterns?: PulsePattern[]
}

/** 合法的类别（讲稿／讲义的四类） */
const FORMULA_KINDS: FormulaKind[] = ['主线', '挡路', '加味', '禁忌']

/**
 * JSON import 会把字面量类型放宽成 `string`（TS 的已知行为），
 * 所以这里做一次**运行时**收窄 —— 不是为了类型好看，
 * 而是为了在数据被改坏时**立刻报错**，而不是让一条坏规则悄悄混进去。
 */
function narrowKind(id: string, kind: string): FormulaKind {
  if ((FORMULA_KINDS as string[]).includes(kind)) return kind as FormulaKind
  throw new Error(
    `formulas.ts：规则「${id}」的类别「${kind}」不合法。` +
      `只能是：${FORMULA_KINDS.join('／')}。`,
  )
}

/**
 * 把 JSON 里的规则数据与 TS 里的判定函数**按 id 合成**成完整规则。
 *
 * ## 两个方向**刻意不对称**
 *
 * · **数据有、判定函数没有 → 抛错**。
 *   那条规则永远不命中，界面上却看不出来 —— 这是最坏的一种坏法，宁可载入失败。
 *   （要新增一条规则，就得同时在 `EVALUATORS` 里写判定逻辑 —— 那是代码，不是数据。）
 *
 * · **判定函数有、数据没有 → 跳过**（不抛错）。
 *   这是**管理员删掉了一条规则**之后的正常状态：条目没了，判定函数作为**残留代码**留着。
 *   删条目是数据层的事（`npm run admin -- library del rule <id>`），
 *   残留的判定函数不加载、不命中、也不显示 —— 删干净了。
 *   而且因为函数还在，`library restore` 把条目放回来时**不用改一行代码**。
 *
 * @param data      规则数据（`src/content/formula-rules.json` 的 rules[]）
 * @param evaluators 判定函数表（id → evaluate）
 * @param patterns  脉象图表（id → 脉象图）
 */
export function loadRules(
  data: RuleDataJson[],
  evaluators: Record<string, (ctx: RuleContext) => string[]>,
  patterns: Record<string, PulsePattern>,
): FormulaRule[] {
  return data.map((r) => {
    // 图的来源有两处，**优先条目自带**：
    //   · `r.patterns` —— 网站端新建的条目把图存在自己身上（画图即条件）；
    //   · `patterns[id]` —— 基线那 61 条的图（`src/content/pulse-patterns.json`）。
    const pattern = (Array.isArray(r.patterns) ? r.patterns[0] : undefined) ?? patterns[r.id]
    // 判定按优先级取：
    //   ① `EVALUATORS` 里的手写判定（基线 61 条，行为一字不变）；
    //   ② 没有手写判定但**有图** ⇒ 用图现场建一个判定（画图即条件）。
    const evaluate =
      evaluators[r.id] ?? (pattern ? (ctx: RuleContext) => evaluatePattern(pattern, ctx) : null)
    if (!evaluate) {
      throw new Error(
        `formulas.ts：规则「${r.id}」既没有判定函数、也没有脉象图。` +
          `新建的条目必须带一张脉象图（那张图就是命中条件）；` +
          `若这条本应是基线条目，请在 EVALUATORS 里补上判定函数。`,
      )
    }
    const rule = { ...r, kind: narrowKind(r.id, r.kind), evaluate }
    // 一张 → 包成数组，界面统一读 `patterns`；`pattern` 留着给老代码与断言
    return pattern ? { ...rule, pattern, patterns: [pattern] } : rule
  })
}

/* ------------------------------------------------------------------ */
/* 判定小工具                                                          */
/* ------------------------------------------------------------------ */

/** 某部位变脉格的力度（0 = 无力，2+ = 有力） */
function bianMaiStrength(ctx: RuleContext, cell: string): number {
  const [hand, organ, depth] = cell.split('|') as [Hand, Organ, Depth]
  return strengthOf(ctx.get(hand, organ, depth))
}

/** 任一部位出现变脉，且力度为「无力」 */
function bianMaiWuli(ctx: RuleContext): string[] {
  const out: string[] = []
  for (const organ of ['寸', '关', '尺'] as Organ[]) {
    for (const hand of ['L', 'R'] as Hand[]) {
      for (const cell of bianMaiCells(ctx, hand, organ)) {
        if (bianMaiStrength(ctx, cell) === 0) out.push(cell)
      }
    }
  }
  return out
}

/** 任一部位出现变脉，且力度为「有力」 */
function bianMaiYouli(ctx: RuleContext): string[] {
  const out: string[] = []
  for (const organ of ['寸', '关', '尺'] as Organ[]) {
    for (const hand of ['L', 'R'] as Hand[]) {
      for (const cell of bianMaiCells(ctx, hand, organ)) {
        if (bianMaiStrength(ctx, cell) >= 2) out.push(cell)
      }
    }
  }
  return out
}

/** 上盛下虚：寸关浮大 + 尺弱或尺不平衡（讲稿 2010·第五讲「寸关浮大尺弱或不平衡」） */
function shangShengXiaXu(ctx: RuleContext): string[] {
  const out: string[] = []
  for (const hand of ['L', 'R'] as Hand[]) {
    const cun = floatingCodes(ctx, hand, '寸')
    const guan = floatingCodes(ctx, hand, '关')
    if (!cun || !guan) continue
    if (!isDa(cun.codes) && !cun.codes.includes('↑')) continue
    if (!isDa(guan.codes)) continue
    const chi = chiWeakCell(ctx, hand)
    if (!chi) continue
    out.push(chi)
  }
  if (out.length === 0) {
    // 尺脉不平衡同样构成「上盛下虚」的路数
    const unbal = chiUnbalancedCells(ctx)
    for (const hand of ['L', 'R'] as Hand[]) {
      const cun = floatingCodes(ctx, hand, '寸')
      const guan = floatingCodes(ctx, hand, '关')
      if (!cun || !guan) continue
      if ((!isDa(cun.codes) && !cun.codes.includes('↑')) || !isDa(guan.codes)) continue
      if (unbal.length > 0) out.push(...unbal)
    }
  }
  return out
}

/** 左关 + 右寸 同时浮大（或顶手） */
function zuoGuanYouCunDa(ctx: RuleContext): string[] {
  const guan = floatingCodes(ctx, 'L', '关')
  const cun = floatingCodes(ctx, 'R', '寸')
  if (!guan || !cun) return []
  const guanHit = isDa(guan.codes) || guan.codes.includes('↑')
  const cunHit = isDa(cun.codes) || cun.codes.includes('↑')
  if (!guanHit || !cunHit) return []
  return [
    `L|关|${guan.depth}`,
    `R|寸|${cun.depth}`,
  ]
}

/** 双关同时浮大 */
function shuangGuanDa(ctx: RuleContext): string[] {
  const l = floatingCodes(ctx, 'L', '关')
  const r = floatingCodes(ctx, 'R', '关')
  if (!l || !r) return []
  if (!isDa(l.codes) || !isDa(r.codes)) return []
  return [`L|关|${l.depth}`, `R|关|${r.depth}`]
}

/** 左手寸关同时浮大（肝心同治） */
function zuoCunGuanDa(ctx: RuleContext): string[] {
  const cun = floatingCodes(ctx, 'L', '寸')
  const guan = floatingCodes(ctx, 'L', '关')
  if (!cun || !guan) return []
  if (!isDa(cun.codes) || !isDa(guan.codes)) return []
  return [`L|寸|${cun.depth}`, `L|关|${guan.depth}`]
}

/** 左寸关都浮（有值即可，不限力度） */
function zuoCunGuanFu(ctx: RuleContext): string[] {
  const cun = floatingCodes(ctx, 'L', '寸')
  const guan = floatingCodes(ctx, 'L', '关')
  if (!cun || !guan) return []
  return [`L|寸|${cun.depth}`, `L|关|${guan.depth}`]
}

/** 双寸皆弱（虚脏） */
function shuangCunRuo(ctx: RuleContext): string[] {
  const l = hasNoForce(ctx, 'L', '寸')
  const r = hasNoForce(ctx, 'R', '寸')
  if (!l || !r) return []
  return [l, r]
}

/** 寸关浮大 + 尺弱或不平衡（头痛的第二种脉象） */
function cunGuanDaChiRuo(ctx: RuleContext): string[] {
  const out: string[] = []
  for (const hand of ['L', 'R'] as Hand[]) {
    const cun = floatingCodes(ctx, hand, '寸')
    const guan = floatingCodes(ctx, hand, '关')
    if (!cun || !guan) continue
    if (!isDa(cun.codes) && !cun.codes.includes('↑')) continue
    if (!isDa(guan.codes)) continue
    const chi = chiWeakCell(ctx, hand)
    if (chi) {
      out.push(chi)
      continue
    }
    const unbal = chiUnbalancedCells(ctx)
    if (unbal.length > 0) out.push(...unbal)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 讲稿 2010·第二讲「叁、用方」「肆、依脉辨证论治」用到的判定            */
/* ------------------------------------------------------------------ */

/** 尺脉状态：正常（有力）／无能量（弱或无）／无尺脉（未录入） */
export type ChiState = 'normal' | 'no-force' | 'none'

function chiState(ctx: RuleContext): ChiState {
  let any = false
  for (const d of ctx.depths('尺')) {
    for (const hand of ['L', 'R'] as Hand[]) {
      const codes = ctx.get(hand, '尺', d)
      if (codes.length === 0) continue
      any = true
      if (strengthOf(codes) >= 1) return 'normal'
    }
  }
  return any ? 'no-force' : 'none'
}

/** 左寸顶手或比较浮大 */
function zuoCunDingOrDa(ctx: RuleContext): string[] {
  const f = floatingCodes(ctx, 'L', '寸')
  if (!f) return []
  if (!isDa(f.codes) && !f.codes.includes('↑')) return []
  return [cellKey('L', '寸', f.depth)]
}

/** 双寸同时浮大 */
function shuangCunDa(ctx: RuleContext): string[] {
  const l = floatingCodes(ctx, 'L', '寸')
  const r = floatingCodes(ctx, 'R', '寸')
  if (!l || !r) return []
  if (!isDa(l.codes) || !isDa(r.codes)) return []
  return [cellKey('L', '寸', l.depth), cellKey('R', '寸', r.depth)]
}

/** 右关浮取力度大（含洪大、顶手） */
function youGuanDa(ctx: RuleContext): string[] {
  const f = floatingCodes(ctx, 'R', '关')
  if (!f || strengthOf(f.codes) < 2) return []
  return [cellKey('R', '关', f.depth)]
}

/** 尺脉不平衡或过大 */
function chiUnbalancedOrBig(ctx: RuleContext): string[] {
  const unbal = chiUnbalancedCells(ctx)
  if (unbal.length > 0) return unbal
  const out: string[] = []
  for (const hand of ['L', 'R'] as Hand[]) {
    const f = floatingCodes(ctx, hand, '尺')
    if (f && strengthOf(f.codes) >= 2) out.push(cellKey(hand, '尺', f.depth))
  }
  return out
}

/** 六脉弦细数：寸关尺已录入的脉点全部为弦或细 */
function liuMaiXianXi(ctx: RuleContext): string[] {
  const out: string[] = []
  for (const organ of ['寸', '关', '尺'] as Organ[]) {
    for (const hand of ['L', 'R'] as Hand[]) {
      for (const d of ctx.depths(organ)) {
        const codes = ctx.get(hand, organ, d)
        if (codes.length === 0) continue
        if (!codes.includes('|') && !codes.includes('X')) return []
        out.push(cellKey(hand, organ, d))
      }
    }
  }
  return out.length > 0 ? out : []
}

/** 六脉浮洪大弦：寸关尺已录入的浮取脉点全部为洪大／顶手或弦 */
function liuMaiFuHongDaXian(ctx: RuleContext): string[] {
  const out: string[] = []
  for (const organ of ['寸', '关', '尺'] as Organ[]) {
    for (const hand of ['L', 'R'] as Hand[]) {
      const f = floatingCodes(ctx, hand, organ)
      if (!f) continue
      const big = f.codes.includes('↑') || strengthOf(f.codes) >= 3
      if (!big && !f.codes.includes('|')) return []
      out.push(cellKey(hand, organ, f.depth))
    }
  }
  return out.length > 0 ? out : []
}

/** 寸关浮大（含顶手）—— 讲稿「上盛」的判法 */
function cunGuanDa(ctx: RuleContext): string[] {
  const out: string[] = []
  for (const hand of ['L', 'R'] as Hand[]) {
    const cun = floatingCodes(ctx, hand, '寸')
    const guan = floatingCodes(ctx, hand, '关')
    if (!cun || !guan) continue
    if (!isDa(cun.codes) && !cun.codes.includes('↑')) continue
    if (!isDa(guan.codes)) continue
    out.push(cellKey(hand, '寸', cun.depth), cellKey(hand, '关', guan.depth))
  }
  return out
}

/**
 * 右关尺浮大顶手 —— 讲稿第二讲五脏疗法（十四）「右关尺（浮大顶手）」用木香顺气。
 * 「右关尺」指右手的关与尺：两处浮取皆大，且其中至少一处为顶手。
 */
function youGuanChiFuDaDingShou(ctx: RuleContext): string[] {
  const guan = floatingCodes(ctx, 'R', '关')
  const chi = floatingCodes(ctx, 'R', '尺')
  if (!guan || !chi) return []
  if (strengthOf(guan.codes) < 2) return []
  if (strengthOf(chi.codes) < 2) return []
  const ding = guan.codes.includes('↑') || chi.codes.includes('↑')
  if (!ding) return []
  return [cellKey('R', '关', guan.depth), cellKey('R', '尺', chi.depth)]
}

/**
 * 右关尺左关浮大 —— 讲稿第二讲五脏疗法（十五）「右关尺左关（浮大）」用搜风顺气。
 * 右手关、右手尺、左手关三处浮取皆大。
 */
function youGuanChiZuoGuanFuDa(ctx: RuleContext): string[] {
  const rg = floatingCodes(ctx, 'R', '关')
  const rc = floatingCodes(ctx, 'R', '尺')
  const lg = floatingCodes(ctx, 'L', '关')
  if (!rg || !rc || !lg) return []
  if (strengthOf(rg.codes) < 2) return []
  if (strengthOf(rc.codes) < 2) return []
  if (strengthOf(lg.codes) < 2) return []
  return [cellKey('R', '关', rg.depth), cellKey('R', '尺', rc.depth), cellKey('L', '关', lg.depth)]
}

/* ------------------------------------------------------------------ */
/* 规则集                                                              */
/* ------------------------------------------------------------------ */

/** 规则集（原始定义，尚未挂上脉象图） */
/**
 * 判定函数表 —— `id` → `evaluate`
 *
 * ⚠️ **函数留在 TS，数据在 JSON**。
 *    规则的数据（条件文字、治法、方剂、出处、原文）现在住在
 *    `src/content/formula-rules.json`（内容层快照，可由本地后台／命令行编辑）；
 *    这里只保留**判定逻辑** —— 那是代码，不是数据。
 *
 * 对应关系（见 `loadRules`）：
 *   · JSON 里有、这里没有 → **载入报错**（那条规则永远不命中，界面却看不出来）；
 *   · 这里有、JSON 里没有 → **跳过**（条目已被管理员删除，函数是残留代码）。
 *
 * ⚠️ 残留代码是**允许的、有意的**：删条目是数据层的事，
 *    函数留着不影响结果，`library restore` 放回来时还能直接用。
 */
export const EVALUATORS: Record<string, (ctx: RuleContext) => string[]> = {
  'fx-bianmai-wuli': (ctx) => bianMaiWuli(ctx),
  'fx-bianmai-youli': (ctx) => bianMaiYouli(ctx),
  'fx-shenyong-mubiao': (ctx) => [...bianMaiWuli(ctx), ...bianMaiYouli(ctx)],
  'fx-ssx-qingdanglu': (ctx) => shangShengXiaXu(ctx),
  'fx-ssx-yinhuo': (ctx) => shangShengXiaXu(ctx),
  'fx-dl1-jiawei-sijun': (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = fuWuOrRuo(ctx, hand, '关')
        if (c) out.push(c)
      }
      return out
    },
  'fx-dl1-yinyang': (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const fu = fuWuOrRuo(ctx, hand, '关')
        const zhong = zhongYouLi(ctx, hand, '关')
        if (fu && zhong) out.push(fu, zhong)
      }
      return out
    },
  'fx-dl1-liushen': (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = fuRuan(ctx, hand, '关')
        if (c) out.push(c)
      }
      return out
    },
  'fx-dl1-zengye': (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = fuDa(ctx, hand, '关')
        if (c) out.push(c)
      }
      return out
    },
  'fx-dl1-hongda-huhang': (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = fuHongDa(ctx, hand, '关')
        if (c) out.push(c)
      }
      return out
    },
  'fx-dl1-guanjian': (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = floatingCodes(ctx, hand, '关')
        if (c) out.push(cellKey(hand, '关', c.depth))
      }
      return out
    },
  'fx-dl2-youcun-da': (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = fuDa(ctx, hand, '寸')
        if (c) out.push(c)
      }
      return out
    },
  'fx-dl2-youcun-hongda': (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = fuHongDa(ctx, hand, '寸')
        if (c) out.push(c)
      }
      return out
    },
  'fx-dl2-zuoguan-hongxian': (ctx) => {
      const out: string[] = []
      const hong = fuHongDa(ctx, 'L', '关')
      if (hong) out.push(hong)
      for (const cell of xianCells(ctx, 'L', '关')) out.push(cell)
      return out
    },
  'fx-dl2-zuoguan-zhongyouli': (ctx) => {
      const out: string[] = []
      const zhong = zhongYouLi(ctx, 'L', '关')
      if (zhong) out.push(zhong)
      const fu = fuWuOrRuo(ctx, 'L', '关')
      if (fu) out.push(fu)
      return out
    },
  'fx-dl2-zuoguan-youcun-da': (ctx) => zuoGuanYouCunDa(ctx),
  'fx-dl2-zuoguan-fuwu': (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = fuWuOrRuo(ctx, hand, '关')
        if (c) out.push(c)
      }
      return out
    },
  'fx-dl2-zuoguan-xuzang-ladun': (ctx) => {
      const out: string[] = []
      const weak = hasNoForce(ctx, 'L', '关')
      if (weak) out.push(weak)
      for (const cell of bianMaiCells(ctx, 'L', '关')) out.push(cell)
      return out
    },
  'fx-dl2-zuocun-guan-fu': (ctx) => zuoCunGuanFu(ctx),
  'fx-dl2-shuangguan-youcun-da': (ctx) => {
      const out: string[] = []
      const l = fuDa(ctx, 'L', '关')
      const r = fuDa(ctx, 'R', '关')
      const youCun = fuDa(ctx, 'R', '寸')
      if (l && r && youCun) out.push(l, r, youCun)
      return out
    },
  'fx-dl3-zuocun-da': (ctx) => {
      const c = fuDa(ctx, 'L', '寸')
      return c ? [c] : []
    },
  'fx-dl3-zuocun-ding': (ctx) => {
      const c = fuDing(ctx, 'L', '寸')
      return c ? [c] : []
    },
  'fx-dl3-bianmai-wuli': (ctx) => bianMaiWuli(ctx),
  'fx-dl4-chi-bupingheng': (ctx) => chiUnbalancedCells(ctx),
  'fx-dl4-chi-da-ding': (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = fuDa(ctx, hand, '尺')
        if (c) out.push(c)
        const d = fuDing(ctx, hand, '尺')
        if (d) out.push(d)
        const w = chiWeakCell(ctx, hand)
        if (w) out.push(w)
      }
      return out
    },
  'fx-dl5-shuangguan': (ctx) => shuangGuanDa(ctx),
  'fx-dl6-ganxin': (ctx) => zuoCunGuanDa(ctx),
  'fx-toutou-bianmai': (ctx) => {
      const out: string[] = []
      for (const organ of ['寸', '关', '尺'] as Organ[]) {
        for (const hand of ['L', 'R'] as Hand[]) {
          for (const cell of bianMaiCells(ctx, hand, organ)) out.push(cell)
        }
      }
      return out
    },
  'fx-toutou-cunguan': (ctx) => cunGuanDaChiRuo(ctx),
  'fx-toutou-shuangguan': (ctx) => {
      const out = shuangGuanDa(ctx)
      const weak = shuangCunRuo(ctx)
      if (weak.length > 0) return weak
      return out
    },
  'fx-yao-yangxu': (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = hasNoForce(ctx, hand, '关')
        if (c) out.push(c)
      }
      return out
    },
  'fx-yao-yinxu': (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = chiWeakCell(ctx, hand)
        if (c) out.push(c)
      }
      return out
    },
  'fx-yao-jiawei-sijun-peifang': (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = fuWuOrRuo(ctx, hand, '关')
        if (c) out.push(c)
      }
      return out
    },
  'fx-yao-liushen-peifang': (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = fuRuan(ctx, hand, '关')
        if (c) out.push(c)
      }
      return out
    },
  'fx-yao-xiaoyao': (ctx) => {
      const out: string[] = []
      const cun = fuDing(ctx, 'L', '寸')
      if (cun) out.push(cun)
      const guan = fuDa(ctx, 'L', '关')
      if (guan) out.push(guan)
      return out
    },
  'fx-yao-huangqi-biejia': (ctx) => {
      const out: string[] = []
      const l = fuDa(ctx, 'L', '关')
      const r = fuDa(ctx, 'R', '关')
      const youCun = fuDa(ctx, 'R', '寸')
      if (l && r && youCun) out.push(l, r, youCun)
      return out
    },
  'fx-yao-bianbian': (ctx) => {
      const out: string[] = []
      const unbal = chiUnbalancedCells(ctx)
      for (const hand of ['L', 'R'] as Hand[]) {
        const chi = chiWeakCell(ctx, hand)
        if (chi) out.push(chi)
      }
      if (out.length === 0) out.push(...unbal)
      return out
    },
  'fx2-yiti-lengreshui': (ctx) => {
      if (chiState(ctx) === 'none') return []
      const out: string[] = []
      for (const d of ctx.depths('尺')) {
        for (const hand of ['L', 'R'] as Hand[]) {
          const codes = ctx.get(hand, '尺', d)
          if (codes.length > 0 && strengthOf(codes) >= 1) out.push(cellKey(hand, '尺', d))
        }
      }
      return out
    },
  'fx2-sanjiao-wuli': (ctx) => bianMaiWuli(ctx),
  'fx2-jianban-sanjiao': (ctx) => bianMaiYouli(ctx),
  'fx2-yinhuo-guiyuan': (ctx) => shangShengXiaXu(ctx),
  'fx2-xiajiao-rukemen': (ctx) => cunGuanDa(ctx),
  'fx2-yinhuo-jiazi': (ctx) => {
      const out: string[] = []
      out.push(...chiUnbalancedCells(ctx))
      const lg = fuDa(ctx, 'L', '关')
      if (lg) out.push(lg)
      const rc = fuDa(ctx, 'R', '寸')
      if (rc) out.push(rc)
      return out
    },
  'fx2-youguanchi-fuda-ding-muxiang': (ctx) => youGuanChiFuDaDingShou(ctx),
  'fx2-youguanchi-zuoguan-fuda-soufeng': (ctx) => youGuanChiZuoGuanFuDa(ctx),
  'fx2-ssx-yinhuo': (ctx) => shangShengXiaXu(ctx),
  'fx2-zuocun-ding-tianwang': (ctx) => zuoCunDingOrDa(ctx),
  'fx2-zuocunguan-ganyan': (ctx) => zuoCunGuanDa(ctx),
  'fx2-shuangcun-fuda': (ctx) => shuangCunDa(ctx),
  'fx2-youguan-fuda-zengye': (ctx) => youGuanDa(ctx),
  'fx2-youguan-xuzang-lizhong': (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = hasNoForce(ctx, hand, '关')
        if (c) out.push(c)
      }
      return out
    },
  'fx2-zuoguan-youcun-huangqi': (ctx) => zuoGuanYouCunDa(ctx),
  'fx2-zuoguan-fuda-longdan': (ctx) => {
      const out: string[] = []
      const lg = fuDa(ctx, 'L', '关')
      const rc = fuDa(ctx, 'R', '寸')
      if (lg) out.push(lg)
      if (rc) out.push(rc)
      return out
    },
  'fx2-shuangguan-fuda-buzhong': (ctx) => shuangGuanDa(ctx),
  'fx2-chi-bupingheng-zhibai': (ctx) => chiUnbalancedOrBig(ctx),
  'fx2-liumai-xianxi': (ctx) => liuMaiXianXi(ctx),
  'fx2-liumai-fuhongdaxian': (ctx) => liuMaiFuHongDaXian(ctx),
  'fx2-zuoyou-bupingheng-renshen': (ctx) => leftRightMismatch(ctx),
  'fx2-zuoguan-xuzang-zishen': (ctx) => {
      const cell = hasNoForce(ctx, 'L', '关')
      return cell ? [cell] : []
    },
  'fx-jinji-sanyong': () => [],
  'fx-jinji-baihu-shenqi': () => [],
}

/**
 * 规则集 —— 数据从 JSON 取，判定函数从上面取。
 *
 * 两者按 `id` 关联。**一个 id 只有一处真源**：
 *   · 数据字段 → `src/content/formula-rules.json`（内容层快照，可编辑）
 *   · 判定函数 → 本文件的 `EVALUATORS`
 */
export const FORMULA_RULES: FormulaRule[] = loadRules(RULE_DATA.rules, EVALUATORS, PATTERNS)

/**
 * 「用方知识库」的**显示设置**（共享层，全站一致）。
 *
 * ⓘ 真源是内容层 `src/content/library-settings.json`
 *    （后台「知识库显示」那张表改完，发布命令写进快照 ⇒ 全站生效）。
 * ⓘ 这里只**读**：网站端不提供第二份开关 ——
 *    一个设置有两处真源就等于迟早不一致。
 *
 * · `hideGroupTitles` —— true＝「讲稿原序」维度下**不显示分组标题**，
 *   直接一条条列内容。
 *   ⓘ 只作用于「讲稿原序」：按五行／按左右手时，那个标题是**唯一的分组标识**
 *   （木／火／土…／左手·心肝…），去掉就变成一堵墙。
 */
export const LIBRARY_SETTINGS = {
  hideGroupTitles: LIBRARY_DATA.library.hideGroupTitles === true,
  /**
   * 区块大标题（「讲义 p44「依脉用方」· 全量条目」「讲稿 2010 · 全量方剂」）要不要显示。
   *
   * ⓘ 默认**隐藏**（2026-11-13 用户定）：这些标题信息量低，手机上很占版面。
   * ⓘ 同样是**共享层**设置（内容层 `library-settings.json`），
   *   不做成本机开关 —— 同一个显隐两处真源迟早不一致。
   */
  hideRouteTitles: (LIBRARY_DATA.library as { hideRouteTitles?: boolean }).hideRouteTitles !== false,
}

/**
 * 按**给定的**规则数据载入规则（判定函数与脉象图仍用本文件的那两份）。
 *
 * 给测试与工具用：管理员删掉一条规则后，前端要能用「少一条」的数据正常载入 ——
 * 这个函数让断言不必去改磁盘上的 JSON。
 */
export function loadRulesFrom(data: RuleDataJson[]): FormulaRule[] {
  return loadRules(data, EVALUATORS, PATTERNS)
}

/* ------------------------------------------------------------------ *
 * 运行期生效集（基线 ⊕ 服务端覆盖层）                                   *
 * ------------------------------------------------------------------ */

/**
 * **运行期生效的规则集** —— 管理员在 ③ 里改过／删过的那些，都算数。
 *
 * ⓘ `FORMULA_RULES` 是**内置基线**（编译期内联的 `src/content/formula-rules.json`），
 *   它**不**随管理员的改动变 —— 改动在服务端的覆盖层里。
 * ⓘ 生效集 = 基线 ⊕ 覆盖层，**在前端合并**：
 *   命中判定是代码（`EVALUATORS`），服务端整份下发的话，
 *   那份内容里可能有这版代码没有判定函数的规则 id ⇒ `loadRules` 抛错 ⇒ 整站崩。
 *   ⇒ 必须以「前端自己那份基线」为底合并 ⇒ id 永远是基线的子集。
 *
 * ⚠️ 合并结果按**数据引用**缓存：覆盖层没变 ⇒ 同一个数组 ⇒ 不重复重建。
 */
let effectiveCache: { data: RuleDataJson[]; rules: FormulaRule[] } | null = null

/** 当前生效的规则集（覆盖层没加载时＝基线） */
export function getEffectiveRules(): FormulaRule[] {
  const data = getLibraryState().ruleData
  if (!data) return FORMULA_RULES
  if (effectiveCache && effectiveCache.data === data) return effectiveCache.rules
  try {
    const rules = loadRulesFrom(data)
    effectiveCache = { data, rules }
    return rules
  } catch (e) {
    // 生效集装不起来（多半是覆盖层里塞了没有判定函数的 id）⇒ 退回基线，**不崩**
    console.error('[臧氏脉学] 生效规则集载入失败，改用内置基线：', e)
    effectiveCache = { data, rules: FORMULA_RULES }
    return FORMULA_RULES
  }
}

/** 当前生效的常驻条目（三不用／白虎汤·肾气丸等，不依脉象） */
export function getStandingRules(rules: FormulaRule[] = getEffectiveRules()): FormulaRule[] {
  return rules.filter((r) => r.always)
}

/* ------------------------------------------------------------------ */
/* 讲义 p46 附表一：体质分类（依脉拉个性）· 治疗列                      */
/* ------------------------------------------------------------------ */

export interface ConstitutionRow {
  /** 附表一第 4 列「切」的标记 */
  mark: string
  /** 附表一第 5 列「治疗」 */
  therapy: string
  formulas: string[]
}

/**
 * 讲义 2026-10 p46「附表一、体质分类（依脉拉个性）」第 5 列「治疗」。
 * 这一列要靠望、问、切多项合参才能定，本工具不据脉象自动判定，仅作对照参考。
 */
export const CONSTITUTION_TABLE: ConstitutionRow[] = [
  { mark: '免', therapy: '一体疗法，清挡路各方', formulas: ['一体疗法', '清挡路各方', '六味平和'] },
  { mark: '狗', therapy: '引火归元', formulas: ['引火归元', '寸尺浮大、变脉'] },
  { mark: '猫', therapy: '三焦疗法', formulas: ['三焦疗法', '变脉'] },
  { mark: '龟', therapy: '三焦疗法，重加中温', formulas: ['三焦疗法', '重加中温', '变脉偏微'] },
  { mark: '蛇', therapy: '减半三焦疗法，清左寸、凉右关及尺脉', formulas: ['减半三焦疗法', '清左寸', '凉右关及尺脉'] },
  {
    mark: '虎',
    therapy: '黄芪鳖甲，知柏六味桂对症；三焦疗法转五脏',
    formulas: ['黄芪鳖甲', '知柏六味桂', '三焦疗法转五脏', '尺脉浮大但压变脉'],
  },
]

/* ------------------------------------------------------------------ */
/* 执行                                                                */
/* ------------------------------------------------------------------ */

/**
 * 对一份记录执行全部依脉用方规则（不含常驻条目）
 *
 * ⚠️ 遍历的是**当前生效**的规则集（基线 ⊕ 覆盖层）——
 *    管理员在 ③ 里删掉一条 ⇒ 这里就不遍历它 ⇒ ② 命中区也不再出现它。
 */
export function evaluateFormulas(ctx: RuleContext, rules: FormulaRule[] = getEffectiveRules()): FormulaHit[] {
  const hits: FormulaHit[] = []
  for (const rule of rules) {
    const cells = rule.evaluate(ctx)
    if (cells.length > 0) hits.push({ ...rule, cells })
  }
  return hits
}

/** 常驻条目：用药禁忌等，不依赖脉象，与记录数无关 */
export const STANDING_FORMULA_RULES: FormulaRule[] = FORMULA_RULES.filter((r) => r.always)

/** 依脉用方的路线顺序（讲稿第四讲「一、二、三、四……第五、第六」；第二讲「叁、用方」「肆、依脉辨证论治」在前） */
export const FORMULA_ROUTE_ORDER = [
  '叁、用方（第二讲）',
  '肆、依脉辨证论治（第二讲）',
  '肾虚',
  '上盛下虚',
  '挡路一（右关）',
  '挡路二（肝肺同治）',
  '挡路三（左寸）',
  '挡路四（尺脉）',
  '挡路五（双关同治）',
  '挡路六（肝心同治）',
  '头痛（第五讲）',
  '讲稿方剂',
  '用药禁忌',
]
