import type { RecordSet } from '../domain/types'
import { cellKey } from '../domain/types'
import { groupRows } from '../domain/layout'
import { formatCodes, buildCustomLegend, collectUsedCodes, type CustomSymbol } from '../domain/symbols'
import { evaluateRules, type RuleContext } from '../domain/rules'
import { evaluateFormulas, STANDING_FORMULA_RULES, CONSTITUTION_TABLE, type FormulaHit } from '../domain/formulas'
import { DRUG_BY_ID, DRUG_GROUPS, DRUGS } from '../domain/drugs'
import { groupByHand, groupByWuxing, DIM_ORDER, groupShortLabel, RULE_OR_DRUG_ATTRIB, STANDING_DISPLAY } from '../domain/grouping'

/** 导出时的分组筛选：按五行／按左右手各打开哪些组（与页面筛选开关同一份状态） */
export interface DimFilters {
  wuxing: string[]
  hand: string[]
}

/** 取某次记录在指定格上的符号文本 */
export function cellText(set: RecordSet, sessionId: string, hand: 'L' | 'R', organ: '寸' | '关' | '尺', depth: '浮' | '中' | '沉'): string {
  const s = set.sessions.find((x) => x.id === sessionId)
  if (!s) return ''
  return formatCodes(s.values[cellKey(hand, organ, depth)] ?? [])
}

/** 同一条规则被多次记录命中时合并为一条，并列出命中的记录 */
function mergeByRule(
  items: { session: string; hit: FormulaHit }[],
): { hit: FormulaHit; sessions: string[] }[] {
  const map = new Map<string, { hit: FormulaHit; sessions: string[] }>()
  for (const it of items) {
    const prev = map.get(it.hit.id)
    if (!prev) {
      map.set(it.hit.id, { hit: it.hit, sessions: [it.session] })
    } else if (!prev.sessions.includes(it.session)) {
      prev.sessions.push(it.session)
    }
  }
  return Array.from(map.values())
}

/** 导出时该维度打开的分组（未指定筛选＝全开） */
function filterKeysFor(dim: 'wuxing' | 'hand', filters?: DimFilters): string[] {
  return filters?.[dim] ?? [...DIM_ORDER[dim]]
}

/** 筛选说明：只在不是全开时写一行，避免默认导出多出废话 */
function filterNote(dim: 'wuxing' | 'hand', keys: string[]): string | null {
  const all = DIM_ORDER[dim]
  if (keys.length === all.length && all.every((k) => keys.includes(k))) return null
  const names = keys.map((k) => groupShortLabel(dim, k))
  return names.length ? `本次导出筛选：${names.join('、')}` : '本次导出筛选：无（该维度未选任何分组）'
}

/** 导出 Markdown 表格 —— 可直接进仓库笔记层 */
export function toMarkdown(set: RecordSet, filters?: DimFilters, customSymbols?: CustomSymbol[]): string {
  const groups = groupRows(set.layout)
  const heads = set.sessions.flatMap((s) => [`${s.label} 左`, `${s.label} 右`])
  const lines: string[] = []

  lines.push(`### 脉象记录表 · ${set.name || '（未命名）'}`)
  lines.push('')
  lines.push(
    `> 布局：${set.layout === 'nine' ? '9 行（寸浮中沉 / 关浮中沉 / 尺浮中沉）' : '7 脉点（尺只沉取）'} ｜ 来源：讲义 2026-10 PDF p34「④ 脉象记录」`,
  )
  lines.push('')
  lines.push(`| 部位 | 取法 | ${heads.join(' | ')} |`)
  lines.push(`|---|---|${heads.map(() => '---').join('|')}|`)

  for (const g of groups) {
    for (const row of g.rows) {
      const cells = set.sessions.flatMap((s) =>
        (['L', 'R'] as const).map((h) => {
          const codes = s.values[cellKey(h, row.organ, row.depth)] ?? []
          return formatCodes(codes) || '—'
        }),
      )
      lines.push(`| ${row.organ} | ${row.depth} | ${cells.join(' | ')} |`)
    }
  }

  // 自定义符号图例：读的人要知道格子里那个自造代码是什么意思
  const legend = buildCustomLegend(customSymbols ?? [], collectUsedCodes(set.sessions))
  if (legend.length > 0) {
    lines.push('')
    lines.push(
      `> 自定义符号：${legend.map((s) => `${s.code}＝${s.name}`).join(' ｜ ')}　（使用者自建，不参与讲稿判读与用方比对）`,
    )
  }

  const hits = set.sessions.flatMap((s) => {
    const ctx: RuleContext = {
      layout: set.layout,
      get: (hand, organ, depth) => s.values[cellKey(hand, organ, depth)] ?? [],
      depths: (organ) => groups.find((g) => g.organ === organ)!.rows.map((r) => r.depth),
    }
    return evaluateRules(ctx).map((hit) => ({ session: s.label, hit }))
  })

  if (hits.length > 0) {
    lines.push('')
    lines.push('#### 判读提示')
    lines.push('')
    for (const { session, hit } of hits) {
      lines.push(`- **${hit.title}**（${session}）— ${hit.detail}　〔${hit.source}〕`)
    }
  }

  /* ---- 依脉用方 ---- */
  const formulaHits = set.sessions.flatMap((s) => {
    const ctx: RuleContext = {
      layout: set.layout,
      get: (hand, organ, depth) => s.values[cellKey(hand, organ, depth)] ?? [],
      depths: (organ) => groups.find((g) => g.organ === organ)!.rows.map((r) => r.depth),
    }
    return evaluateFormulas(ctx).map((hit) => ({ session: s.label, hit }))
  })

  lines.push('')
  lines.push('#### 依脉用方')
  lines.push('')
  lines.push(
    '> 骨架据讲义 2026-10 PDF p44「依脉用方」与 p46「附表一 体质分类」治疗列；讲稿第二讲「叁、用方」「肆、依脉辨证论治」与第三~六讲方剂为补充。',
  )
  lines.push('')

  if (formulaHits.length > 0) {
    let route = ''
    for (const { session, hit } of formulaHits) {
      if (hit.route !== route) {
        route = hit.route
        lines.push(`**${route}**`)
        lines.push('')
      }
      const f = hit.formulas.length > 0 ? `　方：${hit.formulas.join('、')}` : ''
      lines.push(`- **${hit.condition}** → ${hit.therapy}${f}　〔${hit.source}〕· 记录 ${session}`)
      if (hit.drugs && hit.drugs.length > 0) {
        for (const id of hit.drugs) {
          const d = DRUG_BY_ID[id]
          if (!d) continue
          lines.push(`  - **${d.name}**（${d.therapy}）`)
          if (d.composition) lines.push(`    - 组成：${d.composition}`)
          if (d.usage) lines.push(`    - 服法：${d.usage}`)
          if (d.science) lines.push(`    - 科学中药：${d.science}`)
          if (d.indication) lines.push(`    - 适用脉象：${d.indication}`)
          if (d.adjustments) for (const a of d.adjustments) lines.push(`    - 加减：${a}`)
          if (d.contraindication) lines.push(`    - 禁忌：${d.contraindication}`)
          lines.push(`    - 〔${d.source}〕`)
        }
      }
    }
    lines.push('')
  }

  /* ---- 依脉用方 · 按五行 / 按左右手 ---- */
  if (formulaHits.length > 0 || STANDING_FORMULA_RULES.length > 0) {
    // 常驻条目（三不用、白虎汤／肾气丸）不依脉象，一并并入维度分组，避免丢失
    const standing = STANDING_FORMULA_RULES.map((rule) => ({
      session: '常驻',
      hit: { ...rule, condition: STANDING_DISPLAY[rule.id] ?? rule.therapy } as FormulaHit,
    }))
    const allHits = [...formulaHits, ...standing]
    for (const dim of ['wuxing', 'hand'] as const) {
      const keys = filterKeysFor(dim, filters)
      const groups = (
        dim === 'wuxing'
          ? groupByWuxing(allHits, (h) => h.hit.id)
          : groupByHand(allHits, (h) => h.hit.id)
      ).filter((g) => g.key === '未归类' || keys.includes(g.key))
      lines.push(`#### 依脉开方 · ${dim === 'wuxing' ? '按五行' : '按左右手'}`)
      lines.push('')
      lines.push(
        dim === 'wuxing'
          ? '> 按讲稿 2010·第一讲「五行归类」木火土金水→肝心脾肺肾重排；脏位对应据讲义 2026-10·p30（木＝左手关、火＝左手寸、土＝右手关、金＝右手寸、水＝尺）。归类依据逐条附后。'
          : '> 按讲义 2026-10·p30 的左右手脏位重排：左手＝寸心关肝（血分）、右手＝寸肺关脾（气分）、尺＝肾；主脉位横跨左右者入「双手相兼」。归类依据逐条附后。',
      )
      const note = filterNote(dim, keys)
      if (note) {
        lines.push('')
        lines.push(`> ${note}`)
      }
      lines.push('')
      for (const g of groups) {
        lines.push(`**${g.label}**`)
        lines.push('')
        lines.push(`> ${g.note}`)
        lines.push('')
        for (const { hit, sessions } of mergeByRule(g.items)) {
          const attr = RULE_OR_DRUG_ATTRIB[hit.id]
          const f = hit.formulas.length > 0 ? `　方：${hit.formulas.join('、')}` : ''
          const also = attr?.also && attr.also.length > 0 ? `　兼涉：${attr.also.join('、')}` : ''
          lines.push(`- **${hit.condition}** → ${hit.therapy}${f}${also}　〔${hit.source}〕`)
          if (attr) lines.push(`  - 归类依据：${attr.basis}`)
          lines.push(
            sessions[0] === '常驻'
              ? '  - 常驻条目（不依脉象）'
              : `  - 命中记录：${sessions.join('、')}`,
          )
        }
        lines.push('')
      }
    }
  }

  if (STANDING_FORMULA_RULES.length > 0) {
    lines.push('**用药禁忌（常驻）**')
    lines.push('')
    for (const rule of STANDING_FORMULA_RULES) {
      const f = rule.formulas.length > 0 ? `　方：${rule.formulas.join('、')}` : ''
      lines.push(`- ${rule.therapy}${f}　〔${rule.source}〕`)
    }
    lines.push('')
  }

  lines.push('**附表一体质用药对照（讲义 p46）**')
  lines.push('')
  lines.push('| 切 | 治疗 | 方 |')
  lines.push('|---|---|---|')
  for (const row of CONSTITUTION_TABLE) {
    lines.push(`| ${row.mark} | ${row.therapy} | ${row.formulas.join('、')} |`)
  }
  lines.push('')

  lines.push('**方剂备查（讲稿 2010·第二讲 叁、用方）**')
  lines.push('')
  for (const g of DRUG_GROUPS) {
    lines.push(`- **${g.title}**`)
    for (const d of DRUGS.filter((x) => x.therapy === g.therapy)) {
      lines.push(`  - **${d.name}**`)
      if (d.composition) lines.push(`    - 组成：${d.composition}`)
      if (d.usage) lines.push(`    - 服法：${d.usage}`)
      if (d.science) lines.push(`    - 科学中药：${d.science}`)
      if (d.indication) lines.push(`    - 适用脉象：${d.indication}`)
      if (d.adjustments) for (const a of d.adjustments) lines.push(`    - 加减：${a}`)
      if (d.contraindication) lines.push(`    - 禁忌：${d.contraindication}`)
      lines.push(`    - 〔${d.source}〕`)
    }
  }
  lines.push('')

  /* ---- 方剂备查 · 按五行 / 按左右手 ---- */
  for (const dim of ['wuxing', 'hand'] as const) {
    const keys = filterKeysFor(dim, filters)
    const groups = (
      dim === 'wuxing' ? groupByWuxing(DRUGS, (d) => d.id) : groupByHand(DRUGS, (d) => d.id)
    ).filter((g) => g.key === '未归类' || keys.includes(g.key))
    lines.push(`#### 方剂备查 · ${dim === 'wuxing' ? '按五行' : '按左右手'}`)
    lines.push('')
    const note = filterNote(dim, keys)
    if (note) {
      lines.push(`> ${note}`)
      lines.push('')
    }
    for (const g of groups) {
      lines.push(`- **${g.label}**`)
      lines.push(`  - ${g.note}`)
      for (const d of g.items) {
        const attr = RULE_OR_DRUG_ATTRIB[d.id]
        lines.push(`  - **${d.name}**（${d.therapy}）`)
        if (d.composition) lines.push(`    - 组成：${d.composition}`)
        if (d.usage) lines.push(`    - 服法：${d.usage}`)
        if (d.science) lines.push(`    - 科学中药：${d.science}`)
        if (d.indication) lines.push(`    - 适用脉象：${d.indication}`)
        if (d.adjustments) for (const a of d.adjustments) lines.push(`    - 加减：${a}`)
        if (d.contraindication) lines.push(`    - 禁忌：${d.contraindication}`)
        if (attr) lines.push(`    - 归类依据：${attr.basis}`)
        lines.push(`    - 〔${d.source}〕`)
      }
    }
    lines.push('')
  }

  lines.push('')
  return lines.join('\n')
}

/** 导出 CSV —— UTF-8 BOM，Excel 可直接打开 */
export function toCsv(set: RecordSet): string {
  const groups = groupRows(set.layout)
  const head: string[] = ['姓名', '部位', '取法']
  for (const s of set.sessions) {
    head.push(`${s.label} 左`, `${s.label} 右`)
  }

  const rows: string[][] = []
  for (const g of groups) {
    for (const row of g.rows) {
      const cells: string[] = [set.name, row.organ, row.depth]
      for (const s of set.sessions) {
        for (const h of ['L', 'R'] as const) {
          const codes = s.values[cellKey(h, row.organ, row.depth)] ?? []
          cells.push(formatCodes(codes))
        }
      }
      rows.push(cells)
    }
  }

  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const body = [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')
  return '﻿' + body
}
