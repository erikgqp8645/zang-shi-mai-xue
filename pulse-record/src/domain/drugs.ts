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
import { isVisible } from './visibility'
import { getLibraryState } from './library-store'
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
  /**
   * **这一条要不要在「用方知识库」里显示**（共享层，全站一致）。
   *
   * ⓘ false＝知识库里不列这一条；判读（② 命中区）不受影响。
   * ⓘ 判据统一走 `src/domain/visibility.ts` 的 `isVisible`。
   */
  visible?: boolean
}

export const DRUGS: Drug[] = DRUG_DATA.drugs as Drug[]

/**
 * 知识库里**要显示**的方剂 —— `visible=false` 的不列。
 *
 * ⓘ `DRUGS` 保持**全量**（② 命中区要按 id 查方剂卡，
 *    藏起来的方剂也得能查到组成／禁忌）⇒ 过滤只发生在这一层。
 */
export const VISIBLE_DRUGS: Drug[] = DRUGS.filter(isVisible)

export const DRUG_BY_ID: Record<string, Drug> = toRecord(
  DRUGS.map((d) => [d.id, d] as [string, Drug]),
)

/** 按疗法分组，供「方剂备查」列表使用 */
export const DRUG_GROUPS: { therapy: Therapy; title: string }[] = [
  { therapy: '一体疗法', title: '一体疗法（冷热水）' },
  { therapy: '三焦疗法', title: '三焦疗法（上焦方／中焦方／下焦方）' },
  { therapy: '五脏疗法', title: '五脏疗法（引火归元等 22 方）' },
]

/* ------------------------------------------------------------------ *
 * 运行期生效集（基线 ⊕ 服务端覆盖层）                                   *
 * ------------------------------------------------------------------ */

/**
 * **当前生效的方剂** —— 管理员在 ③ 里改过／删过的那些，都算数。
 *
 * ⓘ `DRUGS` 是**内置基线**（编译期内联的 `src/content/drugs.json`），它不随管理员的改动变。
 * ⓘ 覆盖层没加载时 ⇒ 生效集＝基线 ⇒ 小程序端（不设覆盖层）行为**零变化**。
 */
let effectiveCache: { data: Drug[]; drugs: Drug[]; byId: Record<string, Drug> } | null = null

/** 当前生效的方剂（覆盖层没加载时＝基线） */
export function getEffectiveDrugs(): Drug[] {
  const data = getLibraryState().drugData
  if (!data) return DRUGS
  if (effectiveCache && effectiveCache.data === data) return effectiveCache.drugs
  const drugs = data
  const byId = toRecord(drugs.map((d) => [d.id, d] as [string, Drug]))
  effectiveCache = { data, drugs, byId }
  return drugs
}

/** 当前生效的方剂里**要显示**的那些（`visible=false` 的不列） */
export function getVisibleDrugs(): Drug[] {
  return getEffectiveDrugs().filter(isVisible)
}

/** 按 id 取当前生效的方剂（查不到＝undefined） */
export function getDrugById(id: string): Drug | undefined {
  const data = getLibraryState().drugData
  if (!data) return DRUG_BY_ID[id]
  if (effectiveCache && effectiveCache.data === data) return effectiveCache.byId[id]
  return getEffectiveDrugs().find((d) => d.id === id)
}
