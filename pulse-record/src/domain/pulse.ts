/**
 * 脉象取值原语
 *
 * 判读提示（rules.ts）与依脉用方（formulas.ts）共用的取值判定基础。
 * 术语一律沿用讲稿/讲义原文用字：浮、中、沉、大、洪大、顶手、弦、变脉、虚脏、无力。
 *
 * 讲义 2026-10 p33「③ 标准脉象」力度分级：
 *   小：无、弱　　中：有、浮有　　大：有力、洪大、顶手
 * 因此「洪大／顶手」比「大」更强一档，本文件以 strength 2＝大、strength 3＝洪大／顶手区分。
 */

import type { Depth, Hand, LayoutMode, Organ } from './types'
import { cellKey } from './types'
import { isBianMai, isDing, isXuZang, strengthOf } from './symbols'

/** 判读上下文：一次记录（一个日期）里的取法读取器 */
export interface RuleContext {
  layout: LayoutMode
  get(hand: Hand, organ: Organ, depth: Depth): string[]
  depths(organ: Organ): Depth[]
}

/** 该部位的「浮」取法脉象（浮未录入时回落到该部位第一个已录入的取法） */
export function floatingCodes(
  ctx: RuleContext,
  hand: Hand,
  organ: Organ,
): { depth: Depth; codes: string[] } | null {
  for (const d of ctx.depths(organ)) {
    const codes = ctx.get(hand, organ, d)
    if (codes.length > 0) return { depth: d, codes }
  }
  return null
}

/** 该部位是否「无力量」（虚脏：弱或无）—— 讲稿 2010·第十四讲「虚脏」 */
export function hasNoForce(ctx: RuleContext, hand: Hand, organ: Organ): string | null {
  for (const d of ctx.depths(organ)) {
    const codes = ctx.get(hand, organ, d)
    if (codes.length > 0 && isXuZang(codes)) return cellKey(hand, organ, d)
  }
  return null
}

/** 尺脉弱或没有 */
export function chiWeakCell(ctx: RuleContext, hand: Hand): string | null {
  return hasNoForce(ctx, hand, '尺')
}

/** 尺脉不平衡：左右同名取法上录入值不同（两侧都已录入才比较） */
export function chiUnbalancedCells(ctx: RuleContext): string[] {
  const out: string[] = []
  for (const d of ctx.depths('尺')) {
    const l = ctx.get('L', '尺', d)
    const r = ctx.get('R', '尺', d)
    if (l.length === 0 || r.length === 0) continue
    if (l.join('') !== r.join('')) out.push(cellKey('L', '尺', d), cellKey('R', '尺', d))
  }
  return out
}

/** 左右同一取法值不同（讲义 p48–50「常用脉象 ③ 左右脉不平衡」） */
export function leftRightMismatch(ctx: RuleContext): string[] {
  const out: string[] = []
  for (const organ of ['寸', '关', '尺'] as Organ[]) {
    for (const d of ctx.depths(organ)) {
      const l = ctx.get('L', organ, d)
      const r = ctx.get('R', organ, d)
      if (l.length === 0 || r.length === 0) continue
      if (l.join('') !== r.join('')) out.push(cellKey('L', organ, d), cellKey('R', organ, d))
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 依脉用方用到的取值判定                                              */
/* ------------------------------------------------------------------ */

/** 浮取「无或弱」—— 讲稿第四讲「第一个挡路的，浮取无，浮取没有或者弱」 */
export function fuWuOrRuo(ctx: RuleContext, hand: Hand, organ: Organ): string | null {
  const f = floatingCodes(ctx, hand, organ)
  if (!f) return null
  return isXuZang(f.codes) ? cellKey(hand, organ, f.depth) : null
}

/** 浮取「大」（力度大及以上，含洪大、顶手） */
export function fuDa(ctx: RuleContext, hand: Hand, organ: Organ): string | null {
  const f = floatingCodes(ctx, hand, organ)
  if (!f) return null
  return strengthOf(f.codes) >= 2 ? cellKey(hand, organ, f.depth) : null
}

/** 浮取「洪大」—— 比大还大的一档（+++ / ++++ / ↑） */
export function fuHongDa(ctx: RuleContext, hand: Hand, organ: Organ): string | null {
  const f = floatingCodes(ctx, hand, organ)
  if (!f) return null
  return strengthOf(f.codes) >= 3 ? cellKey(hand, organ, f.depth) : null
}

/** 浮取「顶手」 */
export function fuDing(ctx: RuleContext, hand: Hand, organ: Organ): string | null {
  const f = floatingCodes(ctx, hand, organ)
  if (!f) return null
  return isDing(f.codes) ? cellKey(hand, organ, f.depth) : null
}

/** 浮取「软」—— 有值而力度居中（讲稿：「软脉是胃出血的脉」） */
export function fuRuan(ctx: RuleContext, hand: Hand, organ: Organ): string | null {
  const f = floatingCodes(ctx, hand, organ)
  if (!f) return null
  const s = strengthOf(f.codes)
  return s === 1 ? cellKey(hand, organ, f.depth) : null
}

/** 中取有力 */
export function zhongYouLi(ctx: RuleContext, hand: Hand, organ: Organ): string | null {
  for (const d of ctx.depths(organ)) {
    if (d !== '中') continue
    const codes = ctx.get(hand, organ, d)
    if (codes.length > 0 && strengthOf(codes) >= 2) return cellKey(hand, organ, d)
  }
  return null
}

/** 沉取有力 */
export function chenYouLi(ctx: RuleContext, hand: Hand, organ: Organ): string | null {
  for (const d of ctx.depths(organ)) {
    if (d !== '沉') continue
    const codes = ctx.get(hand, organ, d)
    if (codes.length > 0 && strengthOf(codes) >= 2) return cellKey(hand, organ, d)
  }
  return null
}

/** 该部位任意取法为变脉（# / TTT / DDX） */
export function bianMaiCells(ctx: RuleContext, hand: Hand, organ: Organ): string[] {
  const out: string[] = []
  for (const d of ctx.depths(organ)) {
    const codes = ctx.get(hand, organ, d)
    if (isBianMai(codes)) out.push(cellKey(hand, organ, d))
  }
  return out
}

/** 该部位任意取法含「弦」 */
export function xianCells(ctx: RuleContext, hand: Hand, organ: Organ): string[] {
  const out: string[] = []
  for (const d of ctx.depths(organ)) {
    const codes = ctx.get(hand, organ, d)
    if (codes.includes('|')) out.push(cellKey(hand, organ, d))
  }
  return out
}
