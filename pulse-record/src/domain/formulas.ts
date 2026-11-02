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
import { isDa, strengthOf } from './symbols'

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
  /** 关联 drugs.ts 的方剂 id（组成／服法／加减／禁忌） */
  drugs?: string[]
  /** 出处 */
  source: string
  /** 原文 */
  quote: string
  kind: FormulaKind
  /** 常驻条目（如用药禁忌）：不依赖脉象，始终列出 */
  always?: boolean
  /** 命中的单元格；空数组表示未命中 */
  evaluate: (ctx: RuleContext) => string[]
}

export interface FormulaHit extends FormulaRule {
  cells: string[]
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

export const FORMULA_RULES: FormulaRule[] = [
  /* ---- 主线：肾虚 ---- */
  {
    id: 'fx-bianmai-wuli',
    route: '肾虚',
    condition: '变脉无力',
    therapy: '三焦疗法',
    formulas: ['三焦疗法'],
    drugs: ['shangjiao-1', 'shangjiao-2', 'shangjiao-3', 'zhongjiao', 'xiajiao', 'sanjiao-liaocheng'],
    source: '讲义 2026-10·p44（肾虚框 1）／讲稿 2010·第四讲',
    quote:
      '「1. 变脉无力，三焦疗法，如果脉搏跳得没有什么能量，就三焦疗法攻就可以了。」（讲稿 2010·第四讲）',
    kind: '主线',
    evaluate: (ctx) => bianMaiWuli(ctx),
  },
  {
    id: 'fx-bianmai-youli',
    route: '肾虚',
    condition: '变脉有力',
    therapy: '减半三焦疗法（中焦方与下焦方各减一半，另腾时间清挡路）',
    formulas: ['减半三焦疗法', '上中焦方（护航）', '清左寸', '凉右关及尺脉'],
    drugs: ['jianban-sanjiao'],
    source: '讲义 2026-10·p44（肾虚框 2）／讲稿 2010·第四讲',
    quote:
      '「如果说他今天是变脉有力的话，你必须用减半三焦疗法。什么叫做减半三焦疗法呢？就是三焦疗法里面中焦方跟下焦方，本来是一天各吃二次，减半就一天各吃一次。然后另外的时间拿来清左寸、凉右关和尺脉；另外就是用上中焦方护航，来清挡路。」（讲稿 2010·第四讲）',
    kind: '主线',
    evaluate: (ctx) => bianMaiYouli(ctx),
  },
  {
    id: 'fx-shenyong-mubiao',
    route: '肾虚',
    condition: '变脉（清挡路之后）',
    therapy: '目的：下焦方入肾',
    formulas: ['下焦方'],
    drugs: ['xiajiao'],
    source: '讲义 2026-10·p44（肾虚框 3）／讲稿 2010·第四讲',
    quote:
      '「用上中焦护航来清除挡路，目的是要补肾，要下焦方入肾。」（讲稿 2010·第四讲）',
    kind: '主线',
    evaluate: (ctx) => [...bianMaiWuli(ctx), ...bianMaiYouli(ctx)],
  },

  /* ---- 主线：上盛下虚 ---- */
  {
    id: 'fx-ssx-qingdanglu',
    route: '上盛下虚',
    condition: '上盛下虚（寸关浮大，尺弱或不平衡）',
    therapy: '先清挡路',
    formulas: ['清挡路'],
    source: '讲义 2026-10·p44（上盛下虚框 1）',
    quote: '「1. 清挡路，如下图」（讲义 2026-10·p44 上盛下虚框）',
    kind: '主线',
    evaluate: (ctx) => shangShengXiaXu(ctx),
  },
  {
    id: 'fx-ssx-yinhuo',
    route: '上盛下虚',
    condition: '上盛下虚',
    therapy: '引火归元',
    formulas: ['引火归元', '六味桂（入肾）'],
    drugs: ['yinhui-guiyuan'],
    source: '讲义 2026-10·p44（上盛下虚框 2、3）／讲稿 2010·第四讲',
    quote:
      '「我们看旁边这个上盛下虚，主要目的是要引火归元，是让六味桂入肾。我只抓这两个入肾的方，只有两个而已，多了就弄混了，这两个就够你用的。」（讲稿 2010·第四讲）',
    kind: '主线',
    evaluate: (ctx) => shangShengXiaXu(ctx),
  },

  /* ---- 挡路一：右关 ---- */
  {
    id: 'fx-dl1-jiawei-sijun',
    route: '挡路一（右关）',
    condition: '右关浮取无或弱',
    therapy: '加味四君（五昇／理中）',
    formulas: ['加味四君（五昇／理中）'],
    source: '讲义 2026-10·p44（肝肺同治外侧框 ①）／讲稿 2010·第四讲',
    quote:
      '「第一个挡路的，浮取无，浮取没有或者弱，我们就用加味四君。」（讲稿 2010·第四讲·清挡路一）',
    kind: '挡路',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = fuWuOrRuo(ctx, hand, '关')
        if (c) out.push(c)
      }
      return out
    },
  },
  {
    id: 'fx-dl1-yinyang',
    route: '挡路一（右关）',
    condition: '右关浮无、中有力',
    therapy: '阴阳方（中焦方加味四君子，再加麦冬、干姜、黄芪）',
    formulas: ['阴阳方', '加味四君子', '麦冬', '干姜', '黄芪'],
    source: '讲义 2026-10·p44（② 浮无中有力：+麦冬）／讲稿 2010·第四讲',
    quote:
      '「还有一个常碰到的脉象，浮没有，中有力，我们用阴阳方。浮无是表虚，中有力是里实……中焦方（加味四君子）里面再加上麦冬、干姜、黄芪这三味药，很快就缓解下来了。」（讲稿 2010·第四讲）',
    kind: '挡路',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const fu = fuWuOrRuo(ctx, hand, '关')
        const zhong = zhongYouLi(ctx, hand, '关')
        if (fu && zhong) out.push(fu, zhong)
      }
      return out
    },
  },
  {
    id: 'fx-dl1-liushen',
    route: '挡路一（右关）',
    condition: '右关浮软',
    therapy: '六神',
    formulas: ['六神'],
    source: '讲义 2026-10·p44（③ 浮软：六神）／讲稿 2010·第四讲',
    quote:
      '「第二个是浮软的脉，我们用六神。浮软再大一点，就是胃出血的脉，记住，软脉是胃出血的脉。」（讲稿 2010·第四讲）',
    kind: '挡路',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = fuRuan(ctx, hand, '关')
        if (c) out.push(c)
      }
      return out
    },
  },
  {
    id: 'fx-dl1-zengye',
    route: '挡路一（右关）',
    condition: '右关浮大',
    therapy: '增液（安卫）',
    formulas: ['增液（安卫）'],
    source: '讲义 2026-10·p44（④ 浮大：增液（安卫））／讲稿 2010·第四讲',
    quote: '「看下面浮大的脉。我们用增液汤。」（讲稿 2010·第四讲）',
    kind: '挡路',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = fuDa(ctx, hand, '关')
        if (c) out.push(c)
      }
      return out
    },
  },
  {
    id: 'fx-dl1-hongda-huhang',
    route: '挡路一（右关）',
    condition: '右关浮洪大（久病更难）',
    therapy: '三号上焦方护航；早上先吃一点下焦方（以科中为主），护航里面再去散泻',
    formulas: ['三号上焦方（护航）', '下焦方（科中）'],
    source: '讲义 2026-10·p44（① 浮洪大）／讲稿 2010·第四讲',
    quote:
      '「浮洪大，症状和上面一样，只是会更重。千万记住我这句话，如果久病见此脉象，困难度就高了，你要先清上面的虚热，千万要记住一定要用三号的上焦方护航，没有护航药全都进不去，然后早上吃一点下焦方（以科中为主，先把他护住，因为其他吃多了进不去），护航里面再去散泻他。」（讲稿 2010·第四讲）',
    kind: '挡路',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = fuHongDa(ctx, hand, '关')
        if (c) out.push(c)
      }
      return out
    },
  },
  {
    id: 'fx-dl1-guanjian',
    route: '挡路一（右关）',
    condition: '想入肾',
    therapy: '右关是第一关键，右关问题先解决才有办法往下走',
    formulas: [],
    source: '讲义 2026-10·p44（蓝框注）／讲稿 2010·第四讲',
    quote:
      '「想入肾，右关是第一关键，右关的问题先解决，才有办法往下面走。」（讲稿 2010·第四讲）',
    kind: '挡路',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = floatingCodes(ctx, hand, '关')
        if (c) out.push(cellKey(hand, '关', c.depth))
      }
      return out
    },
  },

  /* ---- 挡路二：肝肺同治（左关 + 右寸） ---- */
  {
    id: 'fx-dl2-youcun-da',
    route: '挡路二（肝肺同治）',
    condition: '右寸浮大',
    therapy: '参苏 + 肝肺同治',
    formulas: ['参苏', '肝肺同治'],
    source: '讲义 2026-10·p44（① 浮洪大：参苏加减）／讲稿 2010·第四讲',
    quote:
      '「这个左关右寸，我们先看右寸，右寸如果出现浮大的时候，我们是用参苏跟肝肺同治。」（讲稿 2010·第四讲·清挡路二）',
    kind: '挡路',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = fuDa(ctx, hand, '寸')
        if (c) out.push(c)
      }
      return out
    },
  },
  {
    id: 'fx-dl2-youcun-hongda',
    route: '挡路二（肝肺同治）',
    condition: '右寸浮洪大',
    therapy: '参苏加减 + 肝肺同治（症见胸闷、或热、或喉咙痒）',
    formulas: ['参苏加减', '肝肺同治'],
    source: '讲义 2026-10·p44（① 浮洪大：参苏加减、黄芪鳖甲、易简、增液加减）／讲稿 2010·第四讲',
    quote:
      '「右寸浮洪大，症状一般是胸闷，或热，或喉咙会痒，以这三个症状为主；另外肩颈和头部等等不适之症。」（讲稿 2010·第四讲）',
    kind: '挡路',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = fuHongDa(ctx, hand, '寸')
        if (c) out.push(c)
      }
      return out
    },
  },
  {
    id: 'fx-dl2-zuoguan-hongxian',
    route: '挡路二（肝肺同治）',
    condition: '左关浮洪或弦',
    therapy: '加味龙胆',
    formulas: ['加味龙胆'],
    source: '讲义 2026-10·p44（① 浮洪或弦：加味龙胆）／讲稿 2010·第四讲',
    quote:
      '「我们看左关。左关脉出现浮洪或者弦。洪是更大，我们是用加味龙胆。像病毒来讲的话，没有加味龙胆你不要想。」（讲稿 2010·第四讲·清挡路二）',
    kind: '挡路',
    evaluate: (ctx) => {
      const out: string[] = []
      const hong = fuHongDa(ctx, 'L', '关')
      if (hong) out.push(hong)
      for (const cell of xianCells(ctx, 'L', '关')) out.push(cell)
      return out
    },
  },
  {
    id: 'fx-dl2-zuoguan-zhongyouli',
    route: '挡路二（肝肺同治）',
    condition: '左关中有力（湿热在深层）',
    therapy: '散泻两走：补、泻、补、泻，补中带泻；浮无中有力则俟机散泻',
    formulas: ['散泻两走', '补中带泻'],
    source: '讲义 2026-10·p44（② 中有力：侯机散泻）／讲稿 2010·第四讲',
    quote:
      '「另外中有力，湿热压在比较深层一点。清这个中有力，是一门学问……所以记住，浮无中有力的时候，一定要俟机散泻。」（讲稿 2010·第四讲·清挡路二）',
    kind: '挡路',
    evaluate: (ctx) => {
      const out: string[] = []
      const zhong = zhongYouLi(ctx, 'L', '关')
      if (zhong) out.push(zhong)
      const fu = fuWuOrRuo(ctx, 'L', '关')
      if (fu) out.push(fu)
      return out
    },
  },
  {
    id: 'fx-dl2-zuoguan-youcun-da',
    route: '挡路二（肝肺同治）',
    condition: '左关右寸浮大',
    therapy: '肝肺同治',
    formulas: ['肝肺同治'],
    source: '讲义 2026-10·p44（③ 左关右寸浮大：肝肺同治）',
    quote: '「③ 左关右寸浮大：肝肺同治」（讲义 2026-10·p44 肝肺同治框）',
    kind: '挡路',
    evaluate: (ctx) => zuoGuanYouCunDa(ctx),
  },
  {
    id: 'fx-dl2-zuoguan-fuwu',
    route: '挡路二（肝肺同治）',
    condition: '左关浮无或弱',
    therapy: '滋肾以补肝',
    formulas: ['滋肾以补肝'],
    source: '讲义 2026-10·p44（④ 浮无或弱：滋肾以补肝）／讲稿 2010·第四讲',
    quote:
      '「我们看下面这个浮无或弱，这个很简单，就是滋肾以补肝，他所产生的症状一般烦闷比较多。」（讲稿 2010·第四讲·清挡路二）',
    kind: '挡路',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = fuWuOrRuo(ctx, hand, '关')
        if (c) out.push(c)
      }
      return out
    },
  },
  {
    id: 'fx-dl2-zuoguan-xuzang-ladun',
    route: '挡路二（肝肺同治）',
    condition: '左关虚脏（弱或变脉）',
    therapy: '不可从肝去拉寸；用六味加天冬拉右寸，或单一用参苏拉右寸',
    formulas: ['六味 + 天冬', '参苏'],
    source: '讲稿 2010·第六讲（清左关）',
    quote:
      '「如果左关是虚脏，弱或变脉，就不可从肝去拉寸，只有滋肾以补肝，用六味加天冬去拉右寸，或单一用参苏拉右寸。」（讲稿 2010·第六讲）',
    kind: '挡路',
    evaluate: (ctx) => {
      const out: string[] = []
      const weak = hasNoForce(ctx, 'L', '关')
      if (weak) out.push(weak)
      for (const cell of bianMaiCells(ctx, 'L', '关')) out.push(cell)
      return out
    },
  },
  {
    id: 'fx-dl2-zuocun-guan-fu',
    route: '挡路二（肝肺同治）',
    condition: '左寸关浮',
    therapy: '肝心同治，或双关 + 天王',
    formulas: ['肝心同治', '天王（补心丹）'],
    source: '讲义 2026-10·p44（⑤ 左寸关浮：肝心或双关+天王）／讲稿 2010·第六讲',
    quote: '「⑤ 左寸关浮：肝心或双关+天王」（讲义 2026-10·p44 肝肺同治框）',
    kind: '挡路',
    evaluate: (ctx) => zuoCunGuanFu(ctx),
  },
  {
    id: 'fx-dl2-shuangguan-youcun-da',
    route: '挡路二（肝肺同治）',
    condition: '双关右寸浮大',
    therapy: '黄芪鳖甲',
    formulas: ['黄芪鳖甲'],
    source: '讲义 2026-10·p44（⑥ 双关右寸浮大：黄芪鳖甲）／讲稿 2010·第三讲',
    quote: '「⑥ 双关右寸浮大：黄芪鳖甲」（讲义 2026-10·p44 肝肺同治框）',
    kind: '挡路',
    evaluate: (ctx) => {
      const out: string[] = []
      const l = fuDa(ctx, 'L', '关')
      const r = fuDa(ctx, 'R', '关')
      const youCun = fuDa(ctx, 'R', '寸')
      if (l && r && youCun) out.push(l, r, youCun)
      return out
    },
  },

  /* ---- 挡路三：左寸 ---- */
  {
    id: 'fx-dl3-zuocun-da',
    route: '挡路三（左寸）',
    condition: '左寸浮大',
    therapy: '天王芪（天王补心丹加黄芪）',
    formulas: ['天王芪（天王补心丹 + 黄芪）'],
    source: '讲义 2026-10·p44（① 浮大：天玉+芪）／讲稿 2010·第四讲',
    quote:
      '「我们看左寸脉。出现浮大的时候，很简单，第一个问头，第二个问心脏会不会心悸，第三个问睡眠，这三个跑不掉。左寸浮大，我们是用天王芪。」（讲稿 2010·第四讲·清挡路三）',
    kind: '挡路',
    evaluate: (ctx) => {
      const c = fuDa(ctx, 'L', '寸')
      return c ? [c] : []
    },
  },
  {
    id: 'fx-dl3-zuocun-ding',
    route: '挡路三（左寸）',
    condition: '左寸顶',
    therapy: '天王 + 防风（没有比较高等级的散药，去不了那个顶）',
    formulas: ['天王 + 防风'],
    source: '讲义 2026-10·p44（② 浮顶：天玉+防风）／讲稿 2010·第四讲',
    quote:
      '「左寸顶的，程度就更高，不适之症更严重，我们用天王加防风，没有比较高等级的散药，去不了那个顶。」（讲稿 2010·第四讲·清挡路三）',
    kind: '挡路',
    evaluate: (ctx) => {
      const c = fuDing(ctx, 'L', '寸')
      return c ? [c] : []
    },
  },
  {
    id: 'fx-dl3-bianmai-wuli',
    route: '挡路三（左寸）',
    condition: '变脉无力',
    therapy: '上焦方',
    formulas: ['上焦方'],
    source: '讲义 2026-10·p44（③ 变脉无力：上焦方）／讲稿 2010·第四讲',
    quote: '「再来就是变脉无力，很单纯，用上焦方。」（讲稿 2010·第四讲·清挡路三）',
    kind: '挡路',
    evaluate: (ctx) => bianMaiWuli(ctx),
  },

  /* ---- 挡路四：尺脉 ---- */
  {
    id: 'fx-dl4-chi-bupingheng',
    route: '挡路四（尺脉）',
    condition: '尺脉不平衡',
    therapy: '属万恶元凶，须先清；清完上面一二三个挡路后，知柏六味桂才下得去',
    formulas: ['知柏六味桂'],
    source: '讲义 2026-10·p44（右下框 ① 尺不平衡、尺线「知柏六味桂」）／讲稿 2010·第四、六讲',
    quote:
      '「记住尺脉不平衡是万恶的元凶，很多病症都是因为尺脉不平衡而造成。」（讲稿 2010·第四讲·清挡路四）｜「把上面一二三个挡路清掉后，知柏就可以下去。要知柏下去是把尺脉打到脉衰，才补得进去。」（讲稿 2010·第六讲）',
    kind: '挡路',
    evaluate: (ctx) => chiUnbalancedCells(ctx),
  },
  {
    id: 'fx-dl4-chi-da-ding',
    route: '挡路四（尺脉）',
    condition: '尺浮大或顶手',
    therapy: '属扫障碍，必须清除，肾药才能下行',
    formulas: [],
    source: '讲义 2026-10·p44（右下框 ② 尺浮大或顶手）／讲稿 2010·第五讲',
    quote:
      '「如果左寸顶手、或右寸顶手、双寸顶手、尺弱或不平衡，这些都是扫障碍里面必须要清除的，不清除这些障碍，肾药没办法下行。」（讲稿 2010·第五讲）',
    kind: '挡路',
    evaluate: (ctx) => {
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
  },

  /* ---- 挡路五：双关同治 ---- */
  {
    id: 'fx-dl5-shuangguan',
    route: '挡路五（双关同治）',
    condition: '两个关都浮大',
    therapy: '双关同治',
    formulas: ['双关同治'],
    drugs: ['shuangguan-tongzhi'],
    source: '讲义 2026-10·p44（(五) 双关同治）／讲稿 2010·第六讲',
    quote:
      '「第五个挡路的，就是我们讲的双关同治。双关同治是两个关都有出现浮大，一定用双关同治。」（讲稿 2010·第六讲）',
    kind: '挡路',
    evaluate: (ctx) => shuangGuanDa(ctx),
  },

  /* ---- 挡路六：肝心同治 ---- */
  {
    id: 'fx-dl6-ganxin',
    route: '挡路六（肝心同治）',
    condition: '左手寸关浮大',
    therapy: '肝心同治',
    formulas: ['肝心同治'],
    drugs: ['ganyan-tongzhi'],
    source: '讲义 2026-10·p44（(六) 肝心同治）／讲稿 2010·第六讲',
    quote: '「第六个是肝心同治。左手寸关浮大的时候，用肝心同治。」（讲稿 2010·第六讲）',
    kind: '挡路',
    evaluate: (ctx) => zuoCunGuanDa(ctx),
  },

  /* ---- 头痛三脉（讲稿第五讲） ---- */
  {
    id: 'fx-toutou-bianmai',
    route: '头痛（第五讲）',
    condition: '变脉',
    therapy: '三焦疗法',
    formulas: ['三焦疗法'],
    drugs: ['shangjiao-1', 'shangjiao-2', 'shangjiao-3', 'zhongjiao', 'xiajiao', 'sanjiao-liaocheng'],
    source: '讲稿 2010·第五讲（头痛·脉方证）',
    quote:
      '「第一个，变脉。处方很简单，就是三焦疗法。症状，头会重、痛。不是光痛，头重重的。」（讲稿 2010·第五讲）',
    kind: '主线',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const organ of ['寸', '关', '尺'] as Organ[]) {
        for (const hand of ['L', 'R'] as Hand[]) {
          for (const cell of bianMaiCells(ctx, hand, organ)) out.push(cell)
        }
      }
      return out
    },
  },
  {
    id: 'fx-toutou-cunguan',
    route: '头痛（第五讲）',
    condition: '寸关浮大、尺弱或不平衡',
    therapy: '先清挡路，再引火归元',
    formulas: ['引火归元', '清挡路'],
    source: '讲稿 2010·第五讲（头痛·脉方证）',
    quote:
      '「第二个，寸关浮大尺弱或不平衡。那很简单，寸关浮大就是引火归元，如果有挡路的，必须先清，再引火归元。」（讲稿 2010·第五讲）',
    kind: '主线',
    evaluate: (ctx) => cunGuanDaChiRuo(ctx),
  },
  {
    id: 'fx-toutou-shuangguan',
    route: '头痛（第五讲）',
    condition: '双关浮大（双寸弱则另论）',
    therapy: '双关同治；双寸弱则用上焦方护航护双寸',
    formulas: ['双关同治', '上焦方（护航）'],
    source: '讲稿 2010·第五讲（头痛·脉方证）',
    quote:
      '「第三个，双关浮大。如果双寸弱，治法不一样……我们讲双寸如果没有能量，弱，用上焦方护航就对了。……之后双关浮大，双关同治，也是补中的加减来调理。」（讲稿 2010·第五讲）',
    kind: '主线',
    evaluate: (ctx) => {
      const out = shuangGuanDa(ctx)
      const weak = shuangCunRuo(ctx)
      if (weak.length > 0) return weak
      return out
    },
  },

  /* ---- 讲稿方剂与禁忌 ---- */
  {
    id: 'fx-yao-yangxu',
    route: '讲稿方剂',
    condition: '阳虚（右关脉弱）',
    therapy: '温补之剂：四君子汤加温热药',
    formulas: ['四君子汤 + 温热药'],
    source: '讲稿 2010·第二讲（逍遥散小注）',
    quote:
      '「我们看逍遥散，阳虚以四君子汤加温热药，阴虚以六味地黄加温热药。我再给大家解读，尺脉及左关都是虚脏。」（讲稿 2010·第二讲）',
    kind: '加味',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = hasNoForce(ctx, hand, '关')
        if (c) out.push(c)
      }
      return out
    },
  },
  {
    id: 'fx-yao-yinxu',
    route: '讲稿方剂',
    condition: '阴虚（尺弱）',
    therapy: '温补之剂：六味汤加温热药',
    formulas: ['六味汤 + 温热药'],
    source: '讲稿 2010·第二讲（逍遥散小注）',
    quote:
      '「我们看逍遥散，阳虚以四君子汤加温热药，阴虚以六味地黄加温热药。」（讲稿 2010·第二讲）',
    kind: '加味',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = chiWeakCell(ctx, hand)
        if (c) out.push(c)
      }
      return out
    },
  },
  {
    id: 'fx-yao-jiawei-sijun-peifang',
    route: '讲稿方剂',
    condition: '用加味四君时',
    therapy: '以理中汤易四君子汤，再加白术、葛根',
    formulas: ['理中汤', '四君子汤', '白术', '葛根', '黄芪', '陈皮', '干姜'],
    drugs: ['zhongjiao'],
    source: '讲稿 2010·第二讲（科学中药）',
    quote:
      '「科学中药：理中汤2g、黄芪0.3、陈皮0.2、干姜0.5。（以理中汤易四君子汤，再加白术0.3g、葛根0.3g，可长期服用）。」（讲稿 2010·第二讲）',
    kind: '加味',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = fuWuOrRuo(ctx, hand, '关')
        if (c) out.push(c)
      }
      return out
    },
  },
  {
    id: 'fx-yao-liushen-peifang',
    route: '讲稿方剂',
    condition: '用六神散／四君子汤时',
    therapy: '六神散加陈皮、黄芪；四君子汤一定加黄芪跟陈皮',
    formulas: ['六神散 + 陈皮 + 黄芪', '四君子汤 + 黄芪 + 陈皮'],
    drugs: ['youguan-liushen'],
    source: '讲稿 2010·第三讲（发烧病）',
    quote:
      '「我们用六神散。各位记住，这里说的六神散是加上陈皮和黄芪，以后我们说六神散都是加上陈皮和黄芪，不加黄芪效果出不来；还有四君子汤，一定加黄瓠跟陈皮。」（讲稿 2010·第三讲）',
    kind: '加味',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = fuRuan(ctx, hand, '关')
        if (c) out.push(c)
      }
      return out
    },
  },
  {
    id: 'fx-yao-xiaoyao',
    route: '讲稿方剂',
    condition: '肝郁（木郁则火亦郁）',
    therapy: '逍遥散；脉数对天王补心丹，脉迟对养心汤；顶手者加防风',
    formulas: ['逍遥散', '天王补心丹', '养心汤', '防风'],
    drugs: ['ganyan-tongzhi', 'zuocun-fuda-tianwang', 'zuocun-fuda-yangxin'],
    source: '讲稿 2010·第二、三讲（逍遥散小注）',
    quote:
      '「（2）脉数，逍遥散对天王补心丹。如果脉迟的话，用逍遥散对养心汤。」（讲稿 2010·第二讲）｜「我们用逍遥散加天王补心丹加上防风。各位记一下，他这边是依顶手的程度来加药。」（讲稿 2010·第三讲）',
    kind: '加味',
    evaluate: (ctx) => {
      const out: string[] = []
      const cun = fuDing(ctx, 'L', '寸')
      if (cun) out.push(cun)
      const guan = fuDa(ctx, 'L', '关')
      if (guan) out.push(guan)
      return out
    },
  },
  {
    id: 'fx-yao-huangqi-biejia',
    route: '讲稿方剂',
    condition: '双关右寸浮大、肝火深层',
    therapy: '黄芪鳖甲散：柴鳖骨（柴胡、鳖甲、地骨皮）；加乌梅、青蒿引药入骨；散药加防风、羌活',
    formulas: ['黄芪鳖甲散', '柴鳖骨（柴胡、鳖甲、地骨皮）', '乌梅', '青蒿', '防风', '羌活'],
    drugs: ['zuoguan-youcun-fuda'],
    source: '讲稿 2010·第三讲（黄芪鳖甲）',
    quote:
      '「这个脉我们用黄芪鳖甲散。黄芪鳖甲主要是柴鳖骨（柴胡、鳖甲、地骨皮），这三个入肝的深层……那我加上乌梅跟青蒿，就把缺憾弥补上来了……另外，黄芪鳖甲里面散药不够，我加上了防风跟羌活。」（讲稿 2010·第三讲）',
    kind: '加味',
    evaluate: (ctx) => {
      const out: string[] = []
      const l = fuDa(ctx, 'L', '关')
      const r = fuDa(ctx, 'R', '关')
      const youCun = fuDa(ctx, 'R', '寸')
      if (l && r && youCun) out.push(l, r, youCun)
      return out
    },
  },
  {
    id: 'fx-yao-bianbian',
    route: '讲稿方剂',
    condition: '便秘',
    therapy: '增液汤加减；肾虚者用三焦疗法或下焦方，上盛下虚者用引火归元',
    formulas: ['增液汤（元参、麦冬、生地、当归、大麻仁或郁李仁、秦艽、枳壳、厚朴）', '三焦疗法／下焦方', '引火归元'],
    drugs: ['youguanchi-fuda-zengye', 'xiajiao', 'yinhui-guiyuan'],
    source: '讲稿 2010·第七讲（便秘）',
    quote:
      '「我们用增液汤的加减……肾虚的人，就刚才讲的三焦疗法，或者用下焦方；上盛下虚的人，用引火归元的方治。」（讲稿 2010·第七讲）',
    kind: '加味',
    evaluate: (ctx) => {
      const out: string[] = []
      const unbal = chiUnbalancedCells(ctx)
      for (const hand of ['L', 'R'] as Hand[]) {
        const chi = chiWeakCell(ctx, hand)
        if (chi) out.push(chi)
      }
      if (out.length === 0) out.push(...unbal)
      return out
    },
  },

  /* ---- 讲稿 2010·第二讲「叁、用方」：三种疗法与方剂组成 ---- */
  {
    id: 'fx2-yiti-lengreshui',
    route: '叁、用方（第二讲）',
    condition: '有尺脉',
    therapy: '一体疗法（冷热水疗法）：右关浮大去热，右关无能量加温',
    formulas: ['一体疗法（冷热水）'],
    drugs: ['yiti-leng-re-shui'],
    source: '讲稿 2010·第二讲（叁、用方·一、一体疗法）',
    quote:
      '「那只要是有尺脉的，冷热水疗法马上治下来。……记住，从右关去抓——右关脉如果说没有能量，就是寒证；右关脉很浮大，就是热证。」（讲稿 2010·第二讲）',
    kind: '主线',
    evaluate: (ctx) => {
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
  },
  {
    id: 'fx2-sanjiao-wuli',
    route: '叁、用方（第二讲）',
    condition: '变脉无力（肾虚区块）',
    therapy: '三焦疗法：上焦方（变脉无力用一号／二号）→ 中焦方 → 下焦方',
    formulas: ['上焦方', '中焦方', '下焦方'],
    drugs: ['shangjiao-1', 'shangjiao-2', 'shangjiao-3', 'zhongjiao', 'xiajiao', 'sanjiao-liaocheng'],
    source: '讲稿 2010·第二讲（叁、用方·二、三焦疗法）',
    quote:
      '「三焦疗法是专门治肾虚区块的，有多少种病的源头在这里？」（讲稿 2010·第二讲）',
    kind: '主线',
    evaluate: (ctx) => bianMaiWuli(ctx),
  },
  {
    id: 'fx2-jianban-sanjiao',
    route: '叁、用方（第二讲）',
    condition: '变脉有力',
    therapy: '减半三焦疗法三部曲：清左寸 → 凉右关 → 凉尺脉',
    formulas: ['减半三焦疗法', '二仁茯芪（苓为君）', '六神（苓为君）', '天王补心丹／增液汤／知柏六味地黄'],
    drugs: ['jianban-sanjiao'],
    source: '讲稿 2010·第二讲（叁、用方·二、三焦疗法）',
    quote:
      '「我定了一个变脉有力三部曲，各位记一下，是用减半三焦疗法，第一个是清左寸，第二个是凉右关，第三个是凉尺脉。」（讲稿 2010·第二讲）',
    kind: '主线',
    evaluate: (ctx) => bianMaiYouli(ctx),
  },
  {
    id: 'fx2-yinhuo-guiyuan',
    route: '叁、用方（第二讲）',
    condition: '寸关浮大，尺脉弱或没有',
    therapy: '五脏疗法 · 肾脏疗法（引火归元）：熟地、茯苓、山药、丹皮、泽泻、山茱萸、肉桂',
    formulas: ['引火归元', '六味地黄加桂'],
    drugs: ['yinhui-guiyuan'],
    source: '讲稿 2010·第二讲（叁、用方·三、五脏疗法·（一）肾脏疗法）',
    quote:
      '「使用脉象。各位这个一定要记下来，寸关浮大，尺脉弱或没有。」（讲稿 2010·第二讲）',
    kind: '主线',
    evaluate: (ctx) => shangShengXiaXu(ctx),
  },
  {
    id: 'fx2-xiajiao-rukemen',
    route: '叁、用方（第二讲）',
    condition: '寸关浮大，或有顶手的脉',
    therapy: '下焦方进不去：须先扫除障碍，调到「寸关不浮大」再用',
    formulas: ['下焦方'],
    drugs: ['xiajiao'],
    source: '讲稿 2010·第二讲（叁、用方·二、三焦疗法·（三）下焦方）',
    quote:
      '「下焦方只要寸关不浮大，就可以进得去。寸关浮大进不去，或有顶手的脉，就进不去了。」（讲稿 2010·第二讲）',
    kind: '禁忌',
    evaluate: (ctx) => cunGuanDa(ctx),
  },
  {
    id: 'fx2-yinhuo-jiazi',
    route: '叁、用方（第二讲）',
    condition: '引火归元的添加药',
    therapy: '尺脉不平衡加知柏（顶手加羌活）；左关浮大加柴味归；右寸浮大加天冬、五味子',
    formulas: ['知柏', '羌活', '柴味归（明目地黄）', '天冬', '五味子'],
    drugs: ['yinhui-guiyuan'],
    source: '讲稿 2010·第二讲（叁、用方·三、五脏疗法·（一）肾脏疗法·添加药）',
    quote:
      '「第一个，尺脉不平衡，尺脉一摸，左边比较大右边比较小，就是尺脉不平衡。这个时候我们就六味地黄里面添加知柏（顶手加羌活）。左关浮大，可以添加柴味归，就是明目地黄。右寸浮大的时候，你就可以添加天冬、五味子。」（讲稿 2010·第二讲）',
    kind: '加味',
    evaluate: (ctx) => {
      const out: string[] = []
      out.push(...chiUnbalancedCells(ctx))
      const lg = fuDa(ctx, 'L', '关')
      if (lg) out.push(lg)
      const rc = fuDa(ctx, 'R', '寸')
      if (rc) out.push(rc)
      return out
    },
  },

  {
    id: 'fx2-youguanchi-fuda-ding-muxiang',
    route: '叁、用方（第二讲）',
    condition: '右关尺浮大顶手',
    therapy: '木香顺气治气，尤其肚子胀、下坠很好用；讲稿言已久未使用',
    formulas: ['木香顺气'],
    drugs: ['youguanchi-dingshou-muxiang'],
    source: '讲稿 2010·第二讲（叁、用方·三、五脏疗法·（十四）右关尺（浮大顶手））',
    quote:
      '「右关尺浮大顶手，我用木香顺气，也很久没有用了，但是木香顺气治那个气，尤其是肚子那边胀，下坠很好用。」（讲稿 2010·第二讲）',
    kind: '主线',
    evaluate: (ctx) => youGuanChiFuDaDingShou(ctx),
  },
  {
    id: 'fx2-youguanchi-zuoguan-fuda-soufeng',
    route: '叁、用方（第二讲）',
    condition: '右关尺左关浮大',
    therapy: '搜风顺气；讲稿言已好多年没用，各位作参考',
    formulas: ['搜风顺气'],
    drugs: ['soufeng-shunqi'],
    source: '讲稿 2010·第二讲（叁、用方·三、五脏疗法·（十五）右关尺左关（浮大））',
    quote: '「下面这个搜风顺气，我已经好多年没用了，各位作参考。」（讲稿 2010·第二讲）',
    kind: '主线',
    evaluate: (ctx) => youGuanChiZuoGuanFuDa(ctx),
  },

  /* ---- 讲稿 2010·第二讲「肆、依脉辨证论治」：脉象 → 用方 ---- */
  {
    id: 'fx2-ssx-yinhuo',
    route: '肆、依脉辨证论治（第二讲）',
    condition: '（一）寸关浮大，尺脉弱或无，或不平衡',
    therapy: '上盛下虚：无挡路者直接引火归元；有挡路者先清挡路',
    formulas: ['引火归元'],
    drugs: ['yinhui-guiyuan'],
    source: '讲稿 2010·第二讲（肆、依脉辨证论治·一、上盛下虚）',
    quote:
      '「如果寸关没有弦象，没有软，没有弱，没有浮洪或顶手，这些我们称为挡路的，就直接采引火归元方式，可以缓解症状。」（讲稿 2010·第二讲）',
    kind: '主线',
    evaluate: (ctx) => shangShengXiaXu(ctx),
  },
  {
    id: 'fx2-zuocun-ding-tianwang',
    route: '肆、依脉辨证论治（第二讲）',
    condition: '（二）左寸顶手，或比较浮大',
    therapy: '尺脉正常用天王补心丹加防风；尺脉无能量加黄芪；无尺脉加点干姜。取汗后现解，脉缓时引火归元',
    formulas: ['天王补心丹', '防风', '黄芪', '干姜'],
    drugs: ['zuocun-fuda-tianwang'],
    source: '讲稿 2010·第二讲（肆、依脉辨证论治·一、上盛下虚·（二））',
    quote:
      '「尺脉正常的时候，我们用天王补心丹加防风；尺脉没有什么能量的时候，加黄芪；没有尺脉要加点干姜。服药取汗后，症状可以现解，马上解掉；等他脉缓时，迅速引火归元，这是他的本。」（讲稿 2010·第二讲）',
    kind: '主线',
    evaluate: (ctx) => zuoCunDingOrDa(ctx),
  },
  {
    id: 'fx2-zuocunguan-ganyan',
    route: '肆、依脉辨证论治（第二讲）',
    condition: '（三）左寸关浮大',
    therapy: '肝心同治，并依脉添加滋阴的药：二丹（丹参、丹皮）之外，右寸加天冬、右关加麦冬。睡前温服',
    formulas: ['肝心同治', '丹参', '丹皮', '天冬', '麦冬'],
    drugs: ['ganyan-tongzhi'],
    source: '讲稿 2010·第二讲（肆、依脉辨证论治·一、上盛下虚·（三））',
    quote:
      '「肝心同治，并依脉添加滋阴的药，滋阴的药，除了二丹（丹参跟丹皮）之外，右寸加上天冬，右关加上麦冬。该方以睡前温服较适宜，俟脉缓的时候，再来引火归元。」（讲稿 2010·第二讲）',
    kind: '主线',
    evaluate: (ctx) => zuoCunGuanDa(ctx),
  },
  {
    id: 'fx2-shuangcun-fuda',
    route: '肆、依脉辨证论治（第二讲）',
    condition: '（四）双寸比较浮大',
    therapy: '左寸浮大用天王加芪；右寸浮大用六味桂加天冬，或先服参苏，或先加中温',
    formulas: ['天王补心丹加芪', '六味桂加天冬', '参苏', '加味理中（加中温）'],
    drugs: ['zuocun-fuda-tianwang', 'youcun-fuda-cansu', 'zhongjiao'],
    source: '讲稿 2010·第二讲（肆、依脉辨证论治·一、上盛下虚·（四））',
    quote:
      '「左寸浮大：用天王加芪。右寸浮大：用六味桂加天冬；或先服参苏，把右寸的问题缓解下来；或先加中温。」（讲稿 2010·第二讲）',
    kind: '主线',
    evaluate: (ctx) => shuangCunDa(ctx),
  },
  {
    id: 'fx2-youguan-fuda-zengye',
    route: '肆、依脉辨证论治（第二讲）',
    condition: '（五）右关比较浮大数（内伤虚热）',
    therapy: '增液汤或易简地黄加散药，经取汗后缓解；若单纯的尺弱或右关浮大，可采引火归元加麦、味',
    formulas: ['增液汤', '易简地黄饮子', '引火归元加麦、味（八仙长寿丸）'],
    drugs: ['youguanchi-fuda-zengye', 'youmai-fuda-yijian', 'yinhui-guiyuan'],
    source: '讲稿 2010·第二讲（肆、依脉辨证论治·一、上盛下虚·（五））',
    quote:
      '「增液汤或易简地黄加散药，经取汗后，不适之症会缓解。若单纯的尺弱，或右关浮大，可采引火归元加麦、味，也就是八仙长寿丸。」（讲稿 2010·第二讲）',
    kind: '主线',
    evaluate: (ctx) => youGuanDa(ctx),
  },
  {
    id: 'fx2-youguan-xuzang-lizhong',
    route: '肆、依脉辨证论治（第二讲）',
    condition: '（五）右关比较浮软，偏迟，或弱，或无力，或浮取无（内伤虚寒）',
    therapy: '理中加陈芪，或再加干姜、葛根、当归、小茴香，餐后温服；或用四君子加大白术量',
    formulas: ['理中加陈芪', '四君子加大白术量'],
    drugs: ['youguan-jiawei-lizhong', 'youguan-liushen'],
    source: '讲稿 2010·第二讲（肆、依脉辨证论治·一、上盛下虚·（五））',
    quote:
      '「我们用理中加陈芪，或再加干姜、葛根、当归、小茴香，餐后温服；或用四君子加大白术量。适宜长期服用。」（讲稿 2010·第二讲）',
    kind: '主线',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const c = hasNoForce(ctx, hand, '关')
        if (c) out.push(c)
      }
      return out
    },
  },
  {
    id: 'fx2-zuoguan-youcun-huangqi',
    route: '肆、依脉辨证论治（第二讲）',
    condition: '（六）左关右寸，浮大微洪，或弦、或顶手',
    therapy: '黄芪鳖甲、秦艽扶羸，或逍遥再加上柴胡、鳖甲、地骨皮、乌梅等药，与知柏六味桂对服（服用知柏，一定要护胃）',
    formulas: ['黄芪鳖甲', '秦艽扶羸', '逍遥散加柴胡鳖甲地骨皮乌梅', '知柏六味桂'],
    drugs: ['zuoguan-youcun-fuda', 'zuoguan-youcun-fuhongda'],
    source: '讲稿 2010·第二讲（肆、依脉辨证论治·一、上盛下虚·（六）1）',
    quote:
      '「我们用黄芪鳖甲、秦艽扶羸，或逍遥再加上柴胡、鳖甲、地骨皮、乌梅等药，与知柏六味桂对服（记住，服用知柏，一定要护胃）。」（讲稿 2010·第二讲）',
    kind: '主线',
    evaluate: (ctx) => zuoGuanYouCunDa(ctx),
  },
  {
    id: 'fx2-zuoguan-fuda-longdan',
    route: '肆、依脉辨证论治（第二讲）',
    condition: '（六）左关浮洪大或弦，或右寸浮大',
    therapy: '加味龙胆泻之，并护胃；鼻窦炎加上安右寸浮大之散剂',
    formulas: ['加味龙胆泻肝', '苍耳散'],
    drugs: ['zuoguan-fuhongda-longdan'],
    source: '讲稿 2010·第二讲（肆、依脉辨证论治·一、上盛下虚·（六）2）',
    quote:
      '「加味龙胆泻之，并护胃。糖尿病须先养子母脏；鼻窦炎加上安右寸浮大之散剂。」（讲稿 2010·第二讲）',
    kind: '主线',
    evaluate: (ctx) => {
      const out: string[] = []
      const lg = fuDa(ctx, 'L', '关')
      const rc = fuDa(ctx, 'R', '寸')
      if (lg) out.push(lg)
      if (rc) out.push(rc)
      return out
    },
  },
  {
    id: 'fx2-shuangguan-fuda-buzhong',
    route: '肆、依脉辨证论治（第二讲）',
    condition: '（七）双关比较浮大',
    therapy: '以补中为母方，添加散泻药并取汗；双寸没有能量，用补中时必须用上焦方护航',
    formulas: ['肝脾（双关）同治', '散泻药', '上焦方（护航）'],
    drugs: ['shuangguan-tongzhi'],
    source: '讲稿 2010·第二讲（肆、依脉辨证论治·一、上盛下虚·（七））',
    quote:
      '「以补中为母方，添加散泻药并取汗，痛随之缓解。记住，双寸没有能量，用补中时，必须要用上焦方护航。」（讲稿 2010·第二讲）',
    kind: '主线',
    evaluate: (ctx) => shuangGuanDa(ctx),
  },
  {
    id: 'fx2-chi-bupingheng-zhibai',
    route: '肆、依脉辨证论治（第二讲）',
    condition: '（八）尺脉不平衡或过大',
    therapy: '知柏六味地黄冷服并护胃，药后取汗；寸关问题要先扫除，方能动到它',
    formulas: ['知柏六味地黄'],
    drugs: ['yinhui-guiyuan'],
    source: '讲稿 2010·第二讲（肆、依脉辨证论治·一、上盛下虚·（八））',
    quote:
      '「知柏六味地黄冷服并护胃。药后取汗，药性可快速至下焦。记住，取汗。」（讲稿 2010·第二讲）',
    kind: '主线',
    evaluate: (ctx) => chiUnbalancedOrBig(ctx),
  },
  {
    id: 'fx2-liumai-xianxi',
    route: '肆、依脉辨证论治（第二讲）',
    condition: '（九）六脉弦细数',
    therapy: '按变脉有力的方式来治：天王补心丹加芪、姜，并重加中温及凉尺脉；用三号上焦方护航',
    formulas: ['天王补心丹加芪', '加姜', '重加中温', '凉尺脉', '三号上焦方'],
    drugs: ['zuocun-fuda-tianwang', 'jianban-sanjiao'],
    source: '讲稿 2010·第二讲（肆、依脉辨证论治·一、上盛下虚·（九））',
    quote:
      '「这个病，记住，按变脉有力的方式来治，天王补心丹加芪、姜，并重加中温及凉尺脉。……记住，用三号上焦方护航，不护航，进不去药。」（讲稿 2010·第二讲）',
    kind: '主线',
    evaluate: (ctx) => liuMaiXianXi(ctx),
  },
  {
    id: 'fx2-liumai-fuhongdaxian',
    route: '肆、依脉辨证论治（第二讲）',
    condition: '（十）六脉浮洪大弦',
    therapy: '久病用上、中焦方护航：加味龙胆与防风通圣交互散泻；次用黄芪鳖甲，或肝心同治加滋阴药；易简地黄或增液汤加散药调治。期间都要取汗',
    formulas: ['上焦方', '中焦方', '加味龙胆', '防风通圣', '黄芪鳖甲', '肝心同治', '易简地黄', '增液汤'],
    drugs: ['zuoguan-fuhongda-longdan', 'youguanchi-fuhongda-fangfeng', 'zuoguan-youcun-fuhongda'],
    source: '讲稿 2010·第二讲（肆、依脉辨证论治·一、上盛下虚·（十））',
    quote:
      '「久病，用上、中焦方护航，护航才能动这些药：加味龙胆与防风通圣交互散泻。……次用黄芪鳖甲，或肝心同治加滋阴药，这是左边的问题，易简地黄或增液汤加散药调治，这是右边的问题。期间都要取汗。」（讲稿 2010·第二讲）',
    kind: '主线',
    evaluate: (ctx) => liuMaiFuHongDaXian(ctx),
  },
  {
    id: 'fx2-zuoyou-bupingheng-renshen',
    route: '肆、依脉辨证论治（第二讲）',
    condition: '（十一）左右脉不平衡',
    therapy: '先用人参养荣汤，约1—2剂，再依脉调治',
    formulas: ['人参养荣汤'],
    drugs: ['zuoyou-bupingheng-renshen'],
    source: '讲稿 2010·第二讲（肆、依脉辨证论治·一、上盛下虚·（十一））',
    quote: '「我们先用人参养荣汤，约1—2剂，再依脉调治。」（讲稿 2010·第二讲）',
    kind: '主线',
    evaluate: (ctx) => leftRightMismatch(ctx),
  },
  {
    id: 'fx2-zuoguan-xuzang-zishen',
    route: '肆、依脉辨证论治（第二讲）',
    condition: '（十二）左关虚脏',
    therapy: '滋肾以补肝，可与养胃之药交互，约各二剂；原为弱脉者出现浮大，可采肝心同治或双关同治',
    formulas: ['滋肾以补肝', '养胃之药'],
    drugs: ['zuoguan-xuzang-tongzhi'],
    source: '讲稿 2010·第二讲（肆、依脉辨证论治·一、上盛下虚·（十二））',
    quote:
      '「滋肾以补肝，可与养胃之药交互，约各二剂。滋肾补了肝，原为弱脉者，出现浮大之象，可以采取肝心同治，或双关同治来调不适之症。」（讲稿 2010·第二讲）',
    kind: '主线',
    evaluate: (ctx) => {
      const cell = hasNoForce(ctx, 'L', '关')
      return cell ? [cell] : []
    },
  },

  /* ---- 禁忌（常驻，不依赖脉象） ---- */
  {
    id: 'fx-jinji-sanyong',
    route: '用药禁忌',
    condition: '（常驻）',
    therapy: '三不用：麻黄不用、黄连不用、大黄不用',
    formulas: ['不用麻黄', '不用黄连', '不用大黄'],
    source: '讲稿 2010·第一讲（用药）',
    quote:
      '「所以我有三不用，麻黄不用，黄连不用，大黄不用。」（讲稿 2010·第一讲）｜「大黄害死人……用黄连，剂量很大，黄连那么贵，那么大剂量干什么？」（讲稿 2010·第一讲）',
    kind: '禁忌',
    always: true,
    evaluate: () => [],
  },
  {
    id: 'fx-jinji-baihu-shenqi',
    route: '用药禁忌',
    condition: '（常驻）',
    therapy: '讲稿所批评的时方套用：上盛用白虎汤袪热、下虚用肾气丸，在当代不适用',
    formulas: ['白虎汤', '肾气丸（桂附八味肾气丸）'],
    source: '讲稿 2010·第一讲（讲者批评语）',
    quote:
      '「上盛用白虎汤袪热，下虚用肾气丸……上盛的情况之下，肾脏药想下去是在做梦……所以不吃药还好，越吃药越糟。」（讲稿 2010·第一讲）',
    kind: '禁忌',
    always: true,
    evaluate: () => [],
  },
]

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

/** 对一份记录执行全部依脉用方规则（不含常驻条目） */
export function evaluateFormulas(ctx: RuleContext): FormulaHit[] {
  const hits: FormulaHit[] = []
  for (const rule of FORMULA_RULES) {
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
