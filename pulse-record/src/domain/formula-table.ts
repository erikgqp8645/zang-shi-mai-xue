/**
 * 方剂配伍与剂量 —— 《臧氏脉学方剂汇总统表（同和堂版）》
 *
 * **第三条资料线**（讲义 2026-10、讲稿 2010 之外）：
 * 纸质讲义，同和堂版，共 4 页；2026-11-03 由使用者提供照片，
 * 原图入档于 `data/臧氏脉学方剂汇总统表（同和堂版）/p1.jpg`~`p4.jpg`。
 *
 * 定位：这份表给的是**成方**（药味＋克数）；
 * 讲义 2026-10·p42 给的是**方 ↔ 脉象**，讲稿 2010·第二讲给的是**方 ↔ 组成（比例制）**。
 * 三者是互补视角，**互不取代、互不合并**。
 *
 * 单位：本表用**克**（六神散一行原文即写「粳米 15 克」）；
 * 讲稿 2010 用**比例制**（如「熟地5、茯苓4」）。两套剂量**不可互相换算、不可混用**，
 * 界面上各自标注出处，读者自取所需。
 *
 * 纪律：原样转录 —— 不改写方名、不补写本表没有的药味与克数。
 * 原文写错的字照录（如木香顺气的「茯苓卷12」），并在 `notes` 里说明。
 */

import { toRecord } from './to-record'
import DOSE_DATA from '../content/doses.json'

/** 一条成方条目（汤剂／散剂的原样转录） */
export interface FormulaDose {
  /** 稳定 id */
  id: string
  /** 原名（原文用字，不改写、不换成现代教材方名） */
  name: string
  /** 组成与剂量（原文照录；单位为克） */
  composition: string
  /** 原文随方写明的附注（另包后入／出锅前下／关火前五分钟……） */
  notes?: string[]
  /** 出处：照片页码（1~4） */
  page: number
  /** 是否显示（不填＝显示；`false` 时剂量对照里不列这一条） */
  visible?: boolean
}

/** 「科中」＝科学中药比例表（本表第 4 页）的一行 */
export interface FormulaScience {
  id: string
  /** 原名（原文用字，如「六神」「五异」「双关」） */
  name: string
  /** 比例（原文照录，单位 g） */
  ratio: string
  /** 出处：照片页码 */
  page: number
}

/**
 * 成方条目 —— 按本表原页序照录。
 *
 * 「双关+肝肺」这类组合方，原文用「+」写加法（如「双关+地骨皮9 秦艽9 …」），
 * 这里**照录原文的加法写法**，不替读者把「双关」展开成十几味药。
 */
export const FORMULA_DOSES: FormulaDose[] = DOSE_DATA.doses as FormulaDose[]

/** 「科中」＝科学中药比例表（本表第 4 页）—— 逐行照录 */
export const FORMULA_SCIENCES: FormulaScience[] = DOSE_DATA.sciences as FormulaScience[]

/** 按 id 取成方条目 */
export const FORMULA_DOSE_BY_ID: Record<string, FormulaDose> = toRecord(
  FORMULA_DOSES.map((d) => [d.id, d] as [string, FormulaDose]),
)

/** 按「科中」原名取比例行 */
export const FORMULA_SCIENCE_BY_NAME: Record<string, FormulaScience> = toRecord(
  FORMULA_SCIENCES.map((s) => [s.name, s] as [string, FormulaScience]),
)

/** 成方条目 → 对应的「科中」行（原文第 4 页按方名索引） */
export const DOSE_SCIENCE_NAME: Record<string, string> = DOSE_DATA.scienceByDoseId

/** 出处标记（本表统一用这一句） */
export const FORMULA_TABLE_SOURCE = '《臧氏脉学方剂汇总统表（同和堂版）·第 N 页照片'
