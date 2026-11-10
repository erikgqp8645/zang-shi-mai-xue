/**
 * 方剂资料库 —— 讲稿 2010（民国 99 年）第二讲「叁、用方」原样转录
 *
 * 只照抄讲稿写明的组成、服法、加减、禁忌与适用脉象，不替读者加减方、不下诊断。
 * 出处统一标到讲次；转述部分不加引号，逐字引用才加引号。
 *
 * 讲次对应：
 *   叁、用方（一、一体疗法／二、三焦疗法／三、五脏疗法）→ 讲稿 2010·第二讲
 *   肆、依脉辨证论治 → 讲稿 2010·第二讲
 *   围绝经期综合症「我们的用方」 → 讲稿 2010·第一讲
 */

import { toRecord } from './to-record'
import DRUG_DATA from '../content/drugs.json'

export type Therapy = '一体疗法' | '三焦疗法' | '五脏疗法'

export interface Drug {
  id: string
  /** 讲稿原名，不改写 */
  name: string
  therapy: Therapy
  /** 讲稿原文的组成与剂量 */
  composition?: string
  /** 讲稿原文的服法 */
  usage?: string
  /** 讲稿另列的科学中药比例 */
  science?: string
  /** 讲稿写明的加减 */
  adjustments?: string[]
  /** 讲稿写明的适用脉象 */
  indication?: string
  /** 讲稿写明的禁忌 */
  contraindication?: string
  /** 讲稿出处 */
  source: string
  /** 讲稿原句 */
  quote: string
}

export const DRUGS: Drug[] = DRUG_DATA.drugs as Drug[]

export const DRUG_BY_ID: Record<string, Drug> = toRecord(
  DRUGS.map((d) => [d.id, d] as [string, Drug]),
)

/** 按疗法分组，供「方剂备查」列表使用 */
export const DRUG_GROUPS: { therapy: Therapy; title: string }[] = [
  { therapy: '一体疗法', title: '一体疗法（冷热水）' },
  { therapy: '三焦疗法', title: '三焦疗法（上焦方／中焦方／下焦方）' },
  { therapy: '五脏疗法', title: '五脏疗法（引火归元等 22 方）' },
]
