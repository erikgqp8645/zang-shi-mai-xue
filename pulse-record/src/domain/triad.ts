/**
 * 开方三部曲 · 判定树
 *
 * 来源：讲义 2026-10 PDF p47（印刷页码 45）第二张图「臧氏脉学 开方三部曲」。
 *       该页有两张图：img0 是符号对照表，img1 才是本流程图（易漏，务必逐张比对）。
 *
 * 图的结构：
 *   ①判体质 → ②定疗法 → ③开方药，③ 有一条**虚线回路**回到 ①（开完方回头重判）。
 *
 * 判定链（按图）：
 *   摸脉 → 有变脉？
 *     ├ 是 → 肾虚体质 → 三焦疗法 → 1.上焦方 2.中焦方 3.清挡路方 4.下焦方
 *     └ 否 → 尺脉弱？
 *              ├ 否 → 平和体质 → 一体疗法 → 1.清挡路方 2.冷热水
 *              └ 是 → 上盛下虚体质 → 五脏疗法 → 1.清挡路方 2.引火归元
 *
 * 状态的辅助佐证（图中云朵框，供人看，不是脉象判据）：
 *   紧睡静冷、姜黄青黑 → 肾虚；面赤声洪、精力充沛 → 上盛下虚。
 *
 * 红线（与仓库既有约定一致）：
 * - 「变脉」的定义照抄讲义 p33／p47：忽大忽小、忽快忽慢、跳跳停停、分时不同、
 *   不流利（气泡、杂质），两个以上的虚脏。
 * - 本文件只把图上的判定条件与处方**列出来**并标示命中与否，
 *   不替读者加减方、不下诊断、不自动开方。
 * - 图上的方名照抄（「清挡路方」「冷热水」「引火归元」等），不改成现代教材方名。
 */

import type { Hand, Organ } from './types'
import { cellKey } from './types'
import { isBianMai, strengthOf } from './symbols'
import { floatingCodes, type RuleContext } from './pulse'

/* ------------------------------------------------------------------ */
/* 类型                                                                */
/* ------------------------------------------------------------------ */

/** 三部曲的三个阶段 */
export type TriadStage = 'judge' | 'therapy' | 'prescribe'

/** 体质（图上三个蓝字椭圆） */
export type Constituion = '肾虚' | '平和' | '上盛下虚'

/** 疗法（图上青色六边形） */
export type Therapy = '三焦疗法' | '一体疗法' | '五脏疗法'

/** 开方药条目（图上右上角的折角纸片） */
export interface Prescription {
  /** 序号（图上是 1. 2. 3. 4.） */
  no: number
  /** 方名／做法，照图抄 */
  name: string
  /** 该条的出处 */
  source: string
  /** 原文说明 */
  detail?: string
}

/** 一个判定节点 */
export interface TriadNode {
  id: string
  /** 阶段 */
  stage: TriadStage
  /** 节点文字（照图） */
  label: string
  /** 判定说明（图上的云朵／旁注原文） */
  note?: string
  /** 命中该节点时进入的下一节点 */
  next?: string
  /** 该节点对应的体质 */
  constitution?: Constituion
  /** 该节点对应的疗法 */
  therapy?: Therapy
  /** 该节点对应的开方药 */
  prescriptions?: Prescription[]
  /** 出处 */
  source: string
}

/** 阶段标题 */
export const TRIAD_STAGES: { stage: TriadStage; title: string; note: string }[] = [
  { stage: 'judge', title: '①判体质', note: '摸脉 → 判断方式 → 状态' },
  { stage: 'therapy', title: '②定疗法', note: '按体质定疗法' },
  { stage: 'prescribe', title: '③开方药', note: '按疗法列方' },
]

/**
 * 变脉的定义（讲义 p47 图上旁注原文，照抄）
 */
export const BIANMAI_DEFINITION = {
  title: '变脉',
  text: '忽大忽小，忽快忽慢，跳跳停停，分时不同，不流利（气泡、杂质），两个以上的虚脏',
  source: '讲义 2026-10·p47（开方三部曲图旁注）',
}

/**
 * 状态的辅助佐证（图上两个云朵框）——给人看的佐证，不是脉象判据。
 */
export const STATE_HINTS: { constitution: Constituion; text: string; source: string }[] = [
  {
    constitution: '肾虚',
    text: '紧睡静冷、姜黄青黑',
    source: '讲义 2026-10·p47（开方三部曲图·状态云朵）',
  },
  {
    constitution: '上盛下虚',
    text: '面赤声洪、精力充沛',
    source: '讲义 2026-10·p47（开方三部曲图·状态云朵）',
  },
]

/**
 * 判定树的全部节点。
 *
 * 节点 id 约定：
 *   - bianmai / chimai    两个判定菱形
 *   - const-*             三个体质椭圆
 *   - therapy-*           三个疗法六边形
 */
export const TRIAD_NODES: TriadNode[] = [
  /* ---- ①判体质 ---- */
  {
    id: 'bianmai',
    stage: 'judge',
    label: '有变脉？',
    note: BIANMAI_DEFINITION.text,
    next: 'const-shenxu',
    source: '讲义 2026-10·p47（开方三部曲图）',
  },
  {
    id: 'chimai',
    stage: 'judge',
    label: '尺脉弱？',
    next: 'const-shangsheng',
    source: '讲义 2026-10·p47（开方三部曲图）',
  },
  {
    id: 'const-shenxu',
    stage: 'judge',
    label: '肾虚体质',
    note: STATE_HINTS[0].text,
    constitution: '肾虚',
    next: 'therapy-sanjiao',
    source: '讲义 2026-10·p47（开方三部曲图）',
  },
  {
    id: 'const-pinghe',
    stage: 'judge',
    label: '平和体质',
    constitution: '平和',
    next: 'therapy-yiti',
    source: '讲义 2026-10·p47（开方三部曲图）',
  },
  {
    id: 'const-shangsheng',
    stage: 'judge',
    label: '上盛下虚体质',
    note: STATE_HINTS[1].text,
    constitution: '上盛下虚',
    next: 'therapy-wuzang',
    source: '讲义 2026-10·p47（开方三部曲图）',
  },

  /* ---- ②定疗法 ---- */
  {
    id: 'therapy-sanjiao',
    stage: 'therapy',
    label: '三焦疗法',
    therapy: '三焦疗法',
    next: 'rx-sanjiao',
    source: '讲义 2026-10·p47（开方三部曲图）',
  },
  {
    id: 'therapy-yiti',
    stage: 'therapy',
    label: '一体疗法',
    therapy: '一体疗法',
    next: 'rx-yiti',
    source: '讲义 2026-10·p47（开方三部曲图）',
  },
  {
    id: 'therapy-wuzang',
    stage: 'therapy',
    label: '五脏疗法',
    therapy: '五脏疗法',
    next: 'rx-wuzang',
    source: '讲义 2026-10·p47（开方三部曲图）',
  },

  /* ---- ③开方药 ---- */
  {
    id: 'rx-sanjiao',
    stage: 'prescribe',
    label: '三焦疗法 · 开方药',
    prescriptions: [
      { no: 1, name: '上焦方', source: '讲义 2026-10·p47（开方三部曲图）' },
      { no: 2, name: '中焦方', source: '讲义 2026-10·p47（开方三部曲图）' },
      { no: 3, name: '清挡路方', source: '讲义 2026-10·p47（开方三部曲图）' },
      { no: 4, name: '下焦方', source: '讲义 2026-10·p47（开方三部曲图）' },
    ],
    source: '讲义 2026-10·p47（开方三部曲图）',
  },
  {
    id: 'rx-yiti',
    stage: 'prescribe',
    label: '一体疗法 · 开方药',
    prescriptions: [
      { no: 1, name: '清挡路方', source: '讲义 2026-10·p47（开方三部曲图）' },
      { no: 2, name: '冷热水', source: '讲义 2026-10·p47（开方三部曲图）' },
    ],
    source: '讲义 2026-10·p47（开方三部曲图）',
  },
  {
    id: 'rx-wuzang',
    stage: 'prescribe',
    label: '五脏疗法 · 开方药',
    prescriptions: [
      { no: 1, name: '清挡路方', source: '讲义 2026-10·p47（开方三部曲图）' },
      { no: 2, name: '引火归元', source: '讲义 2026-10·p47（开方三部曲图）' },
    ],
    source: '讲义 2026-10·p47（开方三部曲图）',
  },
]

export const TRIAD_NODE_BY_ID = new Map(TRIAD_NODES.map((n) => [n.id, n]))

/* ------------------------------------------------------------------ */
/* 判定                                                                */
/* ------------------------------------------------------------------ */

/** 判定结果的一步 */
export interface TriadHit {
  nodeId: string
  /** 命中的单元格 */
  cells: string[]
}

export interface TriadResult {
  /** 判体质这一步是否命中（有变脉？／尺脉弱？） */
  bianmai: TriadHit | null
  /** 尺脉弱？这一步是否命中（只在无变脉时才问） */
  chimai: TriadHit | null
  /** 尺脉弱？这一步是否被走到（无变脉时才走到这一问） */
  chimaiReached: boolean
  /** 由判定链推出的体质 */
  constitution: Constituion | null
  /** 由体质推出的疗法 */
  therapy: Therapy | null
  /** 由疗法推出的开方药 */
  prescriptions: Prescription[]
  /** 判据取自哪些单元格 */
  cells: string[]
}

/** 任一部位出现变脉 */
function bianMaiCells(ctx: RuleContext): string[] {
  const out: string[] = []
  for (const organ of ['寸', '关', '尺'] as Organ[]) {
    for (const depth of ctx.depths(organ)) {
      for (const hand of ['L', 'R'] as Hand[]) {
        const codes = ctx.get(hand, organ, depth)
        if (isBianMai(codes)) out.push(cellKey(hand, organ, depth))
      }
    }
  }
  return out
}

/** 尺脉弱：任一侧尺的沉取无力（弱／无） */
function chiWeakCells(ctx: RuleContext): string[] {
  const out: string[] = []
  for (const hand of ['L', 'R'] as Hand[]) {
    for (const depth of ctx.depths('尺')) {
      const codes = ctx.get(hand, '尺', depth)
      if (codes.length === 0) continue
      // 尺脉只取沉；力度 0 ＝ 无力
      if (strengthOf(codes) === 0) out.push(cellKey(hand, '尺', depth))
    }
  }
  return out
}

/**
 * 走一遍判定链。
 *
 * 注意本函数只做「有变脉？」「尺脉弱？」这两个**图上明写**的判据，
 * 不做讲稿里其他条件式判断，也不输出诊断结论。
 *
 * 判定链的次序（讲义 p47 图）：
 *   有变脉？是 → 直接是肾虚体质，**不再问尺脉弱**；
 *   无变脉 → 才问尺脉弱？是 → 上盛下虚体质，否 → 平和体质。
 */
export function judgeTriad(ctx: RuleContext): TriadResult {
  const bian = bianMaiCells(ctx)
  const chi = chiWeakCells(ctx)

  const bianmai: TriadHit | null = bian.length > 0 ? { nodeId: 'bianmai', cells: bian } : null

  let constitution: Constituion | null = null
  let cells: string[] = []
  let chimai: TriadHit | null = null
  /** 有变脉时这一步根本不会被问到 */
  const chimaiReached = !bianmai

  if (bianmai) {
    // 有变脉 → 肾虚体质
    constitution = '肾虚'
    cells = bianmai.cells
  } else {
    // 无变脉 → 问尺脉弱
    if (chi.length > 0) {
      chimai = { nodeId: 'chimai', cells: chi }
      constitution = '上盛下虚'
      cells = chimai.cells
    } else {
      // 无变脉、尺脉不弱 → 平和体质
      constitution = '平和'
      cells = []
    }
  }

  const therapyNode =
    constitution === '肾虚'
      ? TRIAD_NODE_BY_ID.get('therapy-sanjiao')
      : constitution === '平和'
        ? TRIAD_NODE_BY_ID.get('therapy-yiti')
        : TRIAD_NODE_BY_ID.get('therapy-wuzang')

  const rxNode = therapyNode?.next ? TRIAD_NODE_BY_ID.get(therapyNode.next) : undefined

  return {
    bianmai,
    chimai,
    chimaiReached,
    constitution,
    therapy: therapyNode?.therapy ?? null,
    prescriptions: rxNode?.prescriptions ?? [],
    cells,
  }
}

/**
 * 平和体质的对照：尺脉左右稳定且有力（讲稿 2010·第十四讲「阴阳和平的体质」）。
 * 只作对照参考，不参与判定链。
 */
export function chiStableCells(ctx: RuleContext): string[] {
  const out: string[] = []
  for (const depth of ctx.depths('尺')) {
    const l = ctx.get('L', '尺', depth)
    const r = ctx.get('R', '尺', depth)
    if (l.length === 0 || r.length === 0) continue
    if (l.join('') !== r.join('')) continue
    if (strengthOf(l) >= 2) out.push(cellKey('L', '尺', depth), cellKey('R', '尺', depth))
  }
  return out
}

/** 浮取位置（供「寸关浮大」类参考判据使用） */
export function floating(ctx: RuleContext, hand: Hand, organ: Organ) {
  return floatingCodes(ctx, hand, organ)
}

/** 该图上「变脉」判据的深度说明（讲义 p33 力度分级） */
export const BIANMAI_SOURCE = {
  p33: '讲义 2026-10·p33「③ 标准脉象」',
  p47: '讲义 2026-10·p47（开方三部曲图旁注）',
  depthNote: '一、二层取感觉明显的皮肤至脉管上壁为心脉；脉管压至中间为脾脉；压至骨面略微上抬不碰到骨为肝脉；彻底压到骨、手指贴骨面来回搓动并轻微抬起为肾脉。',
  depthSource: '讲义 2026-10·p30–p31「① 六部脉」',
}
