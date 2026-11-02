/**
 * 判读规则引擎
 *
 * 每条规则都对应讲稿中的一句原文，出处标注到讲次。
 * 讲稿 2010（民国99年）＝ 14 讲文字讲稿；第十三讲＝全身性疾病 / 妇科；
 * 第十四讲＝心得分享二 / 体质配对 / 结论。
 *
 * 规则不替读者下诊断，只标出讲稿明确点名的脉象组合及其原文表述。
 */

import type { Depth, Hand, Organ } from './types'
import { cellKey } from './types'
import { isBianMai, isDa, isDing, strengthOf } from './symbols'
import {
  chiUnbalancedCells,
  chiWeakCell,
  floatingCodes,
  hasNoForce,
  leftRightMismatch,
  type RuleContext,
} from './pulse'

export type { RuleContext } from './pulse'

export type Severity = 'high' | 'warn' | 'info'

export interface Rule {
  id: string
  title: string
  severity: Severity
  /** 讲稿出处 */
  source: string
  /** 讲稿原文要点 */
  detail: string
  /** 返回命中的单元格 key；空数组表示未命中 */
  evaluate: (ctx: RuleContext) => string[]
}

export interface RuleHit extends Rule {
  cells: string[]
}

/* ------------------------------------------------------------------ */
/* 规则集                                                              */
/* ------------------------------------------------------------------ */

export const RULES: Rule[] = [
  {
    id: 'shangshengxiashu',
    title: '上盛下虚（寸关浮大、尺脉弱或没有）',
    severity: 'warn',
    source: '讲稿 2010·第十四讲',
    detail: '「寸关脉浮大尺脉弱是标准的脉象」；上盛下虚者直接引火归元。',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const cun = floatingCodes(ctx, hand, '寸')
        const guan = floatingCodes(ctx, hand, '关')
        if (!cun || !guan) continue
        if (!isDa(cun.codes) && !isDing(cun.codes)) continue
        if (!isDa(guan.codes)) continue
        const chi = chiWeakCell(ctx, hand)
        if (!chi) continue
        out.push(cellKey(hand, '寸', cun.depth), cellKey(hand, '关', guan.depth), chi)
      }
      return out
    },
  },
  {
    id: 'daolu-yi',
    title: '挡路一：尺脉不平衡 + 左关右寸浮大或顶手',
    severity: 'high',
    source: '讲稿 2010·第十三讲（围绝经期综合症·四个挡路）',
    detail: '「尺脉不平衡，左关右寸浮大或顶手。这就是挡路的，这个挡路一清，之后再引火归元就 OK 了。」',
    evaluate: (ctx) => {
      const unbal = chiUnbalancedCells(ctx)
      if (unbal.length === 0) return []
      const zuoGuan = floatingCodes(ctx, 'L', '关')
      const youCun = floatingCodes(ctx, 'R', '寸')
      if (!zuoGuan || !youCun) return []
      const guanHit = isDa(zuoGuan.codes) || isDing(zuoGuan.codes)
      const cunHit = isDa(youCun.codes) || isDing(youCun.codes)
      if (!guanHit || !cunHit) return []
      return [...unbal, cellKey('L', '关', zuoGuan.depth), cellKey('R', '寸', youCun.depth)]
    },
  },
  {
    id: 'daolu-er',
    title: '挡路二：尺弱 + 左寸顶手 + 右关浮软或弱或浮取无',
    severity: 'high',
    source: '讲稿 2010·第十三讲（围绝经期综合症·四个挡路）',
    detail: '「尺弱，左寸顶手，右关浮软或弱或浮取无。左寸的顶手挡路清掉以后，还有右关的问题一解决，就可以肾药下行了。」',
    evaluate: (ctx) => {
      const chi = chiWeakCell(ctx, 'L') ?? chiWeakCell(ctx, 'R')
      if (!chi) return []
      let zuoCun: { depth: Depth; codes: string[] } | null = null
      for (const d of ctx.depths('寸')) {
        const codes = ctx.get('L', '寸', d)
        if (isDing(codes)) zuoCun = { depth: d, codes }
      }
      if (!zuoCun) return []
      const youGuanWeak = hasNoForce(ctx, 'R', '关')
      if (!youGuanWeak) return []
      return [chi, cellKey('L', '寸', zuoCun.depth), youGuanWeak]
    },
  },
  {
    id: 'gaowei',
    title: '高危：尺脉不平衡 + 左关右寸浮大',
    severity: 'high',
    source: '讲稿 2010·第十四讲（体质配对）',
    detail: '「通常死得最惨的，是尺脉不平衡、左关右寸浮大……会掉到肾虚，出现吼叫；若家人不谅解，走入精神科。」',
    evaluate: (ctx) => {
      const unbal = chiUnbalancedCells(ctx)
      if (unbal.length === 0) return []
      const zuoGuan = floatingCodes(ctx, 'L', '关')
      const youCun = floatingCodes(ctx, 'R', '寸')
      if (!zuoGuan || !youCun) return []
      if (!isDa(zuoGuan.codes) || !isDa(youCun.codes)) return []
      return [...unbal, cellKey('L', '关', zuoGuan.depth), cellKey('R', '寸', youCun.depth)]
    },
  },
  {
    id: 'bianmai',
    title: '变脉 → 肾虚',
    severity: 'warn',
    source: '讲稿 2010·第十三讲',
    detail: '「第四个，变脉是肾虚……会有明显的累、嗜睡跟怕冷等症状。面色会由红赤转到黄、青、黑。」',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const organ of ['寸', '关', '尺'] as Organ[]) {
        for (const d of ctx.depths(organ)) {
          for (const hand of ['L', 'R'] as Hand[]) {
            const codes = ctx.get(hand, organ, d)
            if (isBianMai(codes)) out.push(cellKey(hand, organ, d))
          }
        }
      }
      return out
    },
  },
  {
    id: 'bianmai-wuli',
    title: '变脉无力 → 身心俱疲',
    severity: 'warn',
    source: '讲稿 2010·第十三讲',
    detail: '「变脉无力又很累，身心俱疲」；「肾虚的体质一摸是变脉或很微很沉。」',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const organ of ['寸', '关', '尺'] as Organ[]) {
        for (const d of ctx.depths(organ)) {
          for (const hand of ['L', 'R'] as Hand[]) {
            const codes = ctx.get(hand, organ, d)
            if (isBianMai(codes) && strengthOf(codes) === 0) out.push(cellKey(hand, organ, d))
          }
        }
      }
      return out
    },
  },
  {
    id: 'bianmai-youli',
    title: '变脉有力 → 全身不适之症',
    severity: 'warn',
    source: '讲稿 2010·第十三讲',
    detail: '「全身不适之症都是变脉有力，用减半三焦疗法，然后清左寸，凉右关，凉尺脉，俟机散泻左关。」',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const organ of ['寸', '关', '尺'] as Organ[]) {
        for (const d of ctx.depths(organ)) {
          for (const hand of ['L', 'R'] as Hand[]) {
            const codes = ctx.get(hand, organ, d)
            if (isBianMai(codes) && strengthOf(codes) >= 2) out.push(cellKey(hand, organ, d))
          }
        }
      }
      return out
    },
  },
  {
    id: 'youguan-da',
    title: '右关浮大 → 有正义感、好不平',
    severity: 'info',
    source: '讲稿 2010·第十四讲（体质配对）',
    detail: '「右关脉如果浮大的话，会蛮有正义感，很好事又好不平……如果右关没有力量，就跟上面刚刚讲的相反，动力不足，比较好静。」',
    evaluate: (ctx) => {
      const f = floatingCodes(ctx, 'R', '关')
      if (!f || !isDa(f.codes)) return []
      return [cellKey('R', '关', f.depth)]
    },
  },
  {
    id: 'youguan-mo',
    title: '右关无力量 → 动力不足、偏好静',
    severity: 'warn',
    source: '讲稿 2010·第十四讲（体质配对）',
    detail: '「如果右关没有力量……动力不足，比较好静。」40 岁以后「右关脉是一个关键，如果右关脉没有能量，很多东西就不行了」。',
    evaluate: (ctx) => {
      const cell = hasNoForce(ctx, 'R', '关')
      return cell ? [cell] : []
    },
  },
  {
    id: 'zuoguan-da',
    title: '左关浮大 → 易怒、易烦',
    severity: 'info',
    source: '讲稿 2010·第十四讲（体质配对）',
    detail: '「左关是一个很大的关键，如果左关浮大，就跟他讲『情绪会不会烦？』大部分易怒、易烦。」',
    evaluate: (ctx) => {
      const f = floatingCodes(ctx, 'L', '关')
      if (!f || !isDa(f.codes)) return []
      return [cellKey('L', '关', f.depth)]
    },
  },
  {
    id: 'zuoguan-mo',
    title: '左关无力量 → 烦闷',
    severity: 'info',
    source: '讲稿 2010·第十四讲（体质配对）',
    detail: '「如果左关没有力量的话，大部分是烦闷。」',
    evaluate: (ctx) => {
      const cell = hasNoForce(ctx, 'L', '关')
      return cell ? [cell] : []
    },
  },
  {
    id: 'zuoguan-xuzang',
    title: '左关虚脏 → 不可用逍遥散',
    severity: 'warn',
    source: '讲稿 2010·第十三讲（逍遥散小注）',
    detail: '「就是左关是虚脏的时候，你就不能用逍遥了。」',
    evaluate: (ctx) => {
      const cell = hasNoForce(ctx, 'L', '关')
      return cell ? [cell] : []
    },
  },
  {
    id: 'zuocun-ding',
    title: '左寸顶手 → 头痛',
    severity: 'warn',
    source: '讲稿 2010·第十四讲（体质配对）',
    detail: '「出现顶手，通常都会有头痛的情形。」',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const d of ctx.depths('寸')) {
        if (isDing(ctx.get('L', '寸', d))) out.push(cellKey('L', '寸', d))
      }
      return out
    },
  },
  {
    id: 'zuocun-da',
    title: '左寸浮大 → 睡眠障碍',
    severity: 'warn',
    source: '讲稿 2010·第十四讲（体质配对）',
    detail: '「如果左寸脉大，比较容易高兴；如果浮大，就是更大了，就会有睡眠的障碍。」',
    evaluate: (ctx) => {
      const f = floatingCodes(ctx, 'L', '寸')
      if (!f || !isDa(f.codes)) return []
      return [cellKey('L', '寸', f.depth)]
    },
  },
  {
    id: 'zuocun-guanda',
    title: '左寸关浮大 → 烦',
    severity: 'info',
    source: '讲稿 2010·第十四讲（体质配对）',
    detail: '「左寸关浮大，会出现烦的现象。」',
    evaluate: (ctx) => {
      const cun = floatingCodes(ctx, 'L', '寸')
      const guan = floatingCodes(ctx, 'L', '关')
      if (!cun || !guan) return []
      if (!isDa(cun.codes) || !isDa(guan.codes)) return []
      return [cellKey('L', '寸', cun.depth), cellKey('L', '关', guan.depth)]
    },
  },
  {
    id: 'shuangguan-xuzang',
    title: '双关虚脏 → 痛 + 焦虑',
    severity: 'high',
    source: '讲稿 2010·第十四讲（体质配对）',
    detail: '「双关如果有虚脏的，除了痛之外，会出现焦虑，焦虑目前来讲是很难治的病……常常会有无法控制的冲动。」',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const cell = hasNoForce(ctx, hand, '关')
        if (cell) out.push(cell)
      }
      return out.length >= 1 ? out : []
    },
  },
  {
    id: 'youguan-ruo-youcun-da',
    title: '右关弱 + 右寸浮大 → 胸闷、口渴、咽干痛',
    severity: 'warn',
    source: '讲稿 2010·第十四讲（体质配对）',
    detail: '「如果右关脉弱，右寸浮大，会出现胸闷、口渴、咽干痛。」',
    evaluate: (ctx) => {
      const guan = hasNoForce(ctx, 'R', '关')
      if (!guan) return []
      const cun = floatingCodes(ctx, 'R', '寸')
      if (!cun || !isDa(cun.codes)) return []
      return [guan, cellKey('R', '寸', cun.depth)]
    },
  },
  {
    id: 'youguan-ruo-zuocun-da',
    title: '右关弱 + 左寸浮大 → 眼痒、睡眠障碍',
    severity: 'warn',
    source: '讲稿 2010·第十四讲（体质配对）',
    detail: '「如果说右关弱，左寸浮大，眼睛会痒，还有睡眠障碍。」',
    evaluate: (ctx) => {
      const guan = hasNoForce(ctx, 'R', '关')
      if (!guan) return []
      const cun = floatingCodes(ctx, 'L', '寸')
      if (!cun || !isDa(cun.codes)) return []
      return [guan, cellKey('L', '寸', cun.depth)]
    },
  },
  {
    id: 'chi-wending',
    title: '尺脉左右稳定且有力 → 阴阳和平体质',
    severity: 'info',
    source: '讲稿 2010·第十四讲（体质配对）',
    detail: '「尺脉如果很稳定的，我们就列为阴阳和平的体质，这是梦寐以求的。」',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const d of ctx.depths('尺')) {
        const l = ctx.get('L', '尺', d)
        const r = ctx.get('R', '尺', d)
        if (l.length === 0 || r.length === 0) continue
        if (l.join('') !== r.join('')) return []
        if (strengthOf(l) >= 2) out.push(cellKey('L', '尺', d), cellKey('R', '尺', d))
      }
      return out.length > 0 ? out : []
    },
  },
  {
    id: 'zhuang-bu-zhuang',
    title: '右关与尺脉为「壮不壮」的关键',
    severity: 'info',
    source: '讲稿 2010·第十四讲（生男生女论）',
    detail: '「什么叫壮？不是看体型很粗壮，是看脉象壮不壮，记住，右关跟尺脉是壮不壮的一个关键。」',
    evaluate: (ctx) => {
      const out: string[] = []
      for (const hand of ['L', 'R'] as Hand[]) {
        const guan = hasNoForce(ctx, hand, '关')
        const chi = chiWeakCell(ctx, hand)
        if (guan && chi) out.push(guan, chi)
      }
      return out
    },
  },
  {
    id: 'zuoyou-bupingheng',
    title: '左右脉不平衡',
    severity: 'info',
    source: '讲义 2026-10·p48–50（常用脉象 ③）',
    detail: '「常用脉象 ③ 细、数、迟、左右脉不平衡」——左右同名取法录入值不同处。',
    evaluate: (ctx) => leftRightMismatch(ctx),
  },
]

/** 对一份记录执行全部规则 */
export function evaluateRules(ctx: RuleContext): RuleHit[] {
  const hits: RuleHit[] = []
  for (const rule of RULES) {
    const cells = rule.evaluate(ctx)
    if (cells.length > 0) hits.push({ ...rule, cells })
  }
  const order: Record<Severity, number> = { high: 0, warn: 1, info: 2 }
  return hits.sort((a, b) => order[a.severity] - order[b.severity])
}
