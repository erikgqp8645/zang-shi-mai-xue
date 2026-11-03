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
 *
 * 两套东西要分清：
 * - **手动选择**（CONSTITUTION_OPTIONS / THERAPY_OPTIONS）：①判体质、②定疗法
 *   由使用者自己判断后点选，工具只记录、不代判。选体质会按图上的配对带出疗法，
 *   疗法仍可改。
 * - **参考判据**（readTriadReference）：图上「有变脉？」「尺脉弱？」两条问句，
 *   由已录的符号自动标出命中位置，供使用者自己判断时参考，**不决定体质**。
 */

import type { Constitution, Hand, Organ, Therapy } from './types'
import { cellKey } from './types'
import { isBianMai, strengthOf } from './symbols'
import { floatingCodes, type RuleContext } from './pulse'

/* ------------------------------------------------------------------ */
/* 类型                                                                */
/* ------------------------------------------------------------------ */

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
export const STATE_HINTS: { constitution: Constitution; text: string; source: string }[] = [
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

/* ------------------------------------------------------------------ */
/* ①判体质 · 手动选择                                                  */
/* ------------------------------------------------------------------ */

/** 一个体质选项（图上那个蓝字椭圆） */
export interface ConstitutionOption {
  id: Constitution
  /** 图上椭圆的文字 */
  label: string
  /** 图上怎么走到这一支（照图抄的判定链） */
  path: string
  /** 图上的状态佐证（云朵框）；平和体质图上没有云朵 */
  stateHint?: string
  /** 图上这一支对应的疗法（选体质时带出，仍可改） */
  therapy: Therapy
  source: string
}

/**
 * 图上三个体质椭圆（讲义 2026-10·p47）。
 *
 * 取值与配对全部照图：肾虚体质↔三焦疗法、上盛下虚体质↔五脏疗法、平和体质↔一体疗法。
 * 「平和体质」在图上没有状态云朵，故 stateHint 为空。
 */
export const CONSTITUTION_OPTIONS: ConstitutionOption[] = [
  {
    id: '肾虚',
    label: '肾虚体质',
    path: '有变脉？是 → 三焦疗法 → 肾虚体质',
    stateHint: STATE_HINTS[0].text,
    therapy: '三焦疗法',
    source: '讲义 2026-10·p47（开方三部曲图）',
  },
  {
    id: '上盛下虚',
    label: '上盛下虚体质',
    path: '尺脉弱？是 → 五脏疗法 → 上盛下虚体质',
    stateHint: STATE_HINTS[1].text,
    therapy: '五脏疗法',
    source: '讲义 2026-10·p47（开方三部曲图）',
  },
  {
    id: '平和',
    label: '平和体质',
    path: '尺脉弱？否 → 一体疗法 → 平和体质',
    therapy: '一体疗法',
    source: '讲义 2026-10·p47（开方三部曲图）',
  },
]

/* ------------------------------------------------------------------ */
/* ②定疗法 · 手动选择                                                  */
/* ------------------------------------------------------------------ */

/** 一个疗法选项（图上那个青色六边形） */
export interface TherapyOption {
  id: Therapy
  /** 图上六边形的文字 */
  label: string
  /** 图上该疗法对应的开方药（照图抄的方名与次序） */
  prescriptions: Prescription[]
  source: string
}

/** 图上三个疗法六边形（讲义 2026-10·p47） */
export const THERAPY_OPTIONS: TherapyOption[] = [
  {
    id: '三焦疗法',
    label: '三焦疗法',
    prescriptions: [
      { no: 1, name: '上焦方', source: '讲义 2026-10·p47（开方三部曲图）' },
      { no: 2, name: '中焦方', source: '讲义 2026-10·p47（开方三部曲图）' },
      { no: 3, name: '清挡路方', source: '讲义 2026-10·p47（开方三部曲图）' },
      { no: 4, name: '下焦方', source: '讲义 2026-10·p47（开方三部曲图）' },
    ],
    source: '讲义 2026-10·p47（开方三部曲图）',
  },
  {
    id: '五脏疗法',
    label: '五脏疗法',
    prescriptions: [
      { no: 1, name: '清挡路方', source: '讲义 2026-10·p47（开方三部曲图）' },
      { no: 2, name: '引火归元', source: '讲义 2026-10·p47（开方三部曲图）' },
    ],
    source: '讲义 2026-10·p47（开方三部曲图）',
  },
  {
    id: '一体疗法',
    label: '一体疗法',
    prescriptions: [
      { no: 1, name: '清挡路方', source: '讲义 2026-10·p47（开方三部曲图）' },
      { no: 2, name: '冷热水', source: '讲义 2026-10·p47（开方三部曲图）' },
    ],
    source: '讲义 2026-10·p47（开方三部曲图）',
  },
]

/** 体质 → 疗法（照图配对） */
export function therapyOf(constitution: Constitution): Therapy {
  return CONSTITUTION_OPTIONS.find((o) => o.id === constitution)?.therapy ?? '一体疗法'
}

/** 疗法 → 图上那一支的开方药 */
export function prescriptionsOf(therapy: Therapy): Prescription[] {
  return THERAPY_OPTIONS.find((o) => o.id === therapy)?.prescriptions ?? []
}

/* ------------------------------------------------------------------ */
/* 判定                                                                */
/* ------------------------------------------------------------------ */

/** 判定结果的一步 */
export interface TriadHit {
  nodeId: string
  /** 命中的单元格 */
  cells: string[]
}

/**
 * 图上两条问句的**参考判据**。
 *
 * 注意：这是「标出命中位置」，不是「判定结果」——
 * 体质与疗法由使用者在 ① ② 里自己选，这里只作参考。
 */
export interface TriadReference {
  /** 本次有没有录到脉象（没录则无从判读） */
  recorded: boolean
  /** 有变脉？——命中位置 */
  bianmai: TriadHit | null
  /** 尺脉弱？——命中位置（只在无变脉时才问） */
  chimai: TriadHit | null
  /** 尺脉弱？这一步是否被问到（无变脉时才问） */
  chimaiReached: boolean
  /** 按图上判据**推得**的体质（仅供参考，不替使用者决定） */
  suggested: Constitution | null
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
 * 走一遍图上那两条问句，标出命中位置。
 *
 * 判定链的次序（讲义 p47 图）：
 *   有变脉？是 → 肾虚体质，**不再问尺脉弱**；
 *   无变脉 → 才问尺脉弱？是 → 上盛下虚体质，否 → 平和体质。
 *
 * 出来的 suggested 只是「按图会落到哪一支」，**不写进记录**——
 * ①判体质由使用者手动选（见 CONSTITUTION_OPTIONS）。
 */
export function readTriadReference(ctx: RuleContext): TriadReference {
  const bian = bianMaiCells(ctx)
  const chi = chiWeakCells(ctx)

  /** 本次有没有录到脉象（一个符号都没有＝还没摸脉） */
  const recorded =
    ctx.depths('寸').length > 0 &&
    (['L', 'R'] as Hand[]).some((h) =>
      ctx.depths('寸').some((d) => ctx.get(h, '寸', d).length > 0) ||
      ctx.depths('关').some((d) => ctx.get(h, '关', d).length > 0) ||
      ctx.depths('尺').some((d) => ctx.get(h, '尺', d).length > 0),
    )

  const bianmai: TriadHit | null = bian.length > 0 ? { nodeId: 'bianmai', cells: bian } : null

  let suggested: Constitution | null = null
  let cells: string[] = []
  let chimai: TriadHit | null = null
  /** 有变脉时这一步根本不会被问到；没录脉象时也走不到 */
  const chimaiReached = recorded && !bianmai

  if (bianmai) {
    suggested = '肾虚'
    cells = bianmai.cells
  } else if (!recorded) {
    // **还没摸脉**：图上的判定链无从走起
    suggested = null
    cells = []
  } else if (chi.length > 0) {
    chimai = { nodeId: 'chimai', cells: chi }
    suggested = '上盛下虚'
    cells = chimai.cells
  } else {
    // 无变脉、尺脉不弱
    suggested = '平和'
    cells = []
  }

  return { recorded, bianmai, chimai, chimaiReached, suggested, cells }
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
