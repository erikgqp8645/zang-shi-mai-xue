/**
 * 脉象图数据 —— 「用方知识库」每条**用方条目**的格位要求
 *
 * ## 数据在 JSON
 *
 * 本文件只做**类型收窄**。数据真源是 `src/content/pulse-patterns.json`
 * （可由 `content/臧氏脉学-用方知识库.xlsx` 编辑）。
 *
 * ## 写它的三条纪律
 *
 * ① **照抄原文用字**，不改写、不合并、不臆造。
 *    讲稿写「浮大」就标「浮大」，不因为代码里有 `fuDa` 就把「顶手 ↑」也算进去。
 *
 * ② **讲稿没说的一律留空** —— 空格在图上显示「·」，
 *    意思是「原文未提及，不作要求」，不是「没关系」。
 *
 * ③ **讲稿没写明的地方，在 `note` 里写明**，
 *    不让读者以为图上标的每一格都是讲稿逐字写过的。
 *
 * ## 与 `evaluate` 的关系
 *
 * `formulas.ts` 里每条规则的 `evaluate` 是**反向**判定
 * （拿已录的脉象去算命中哪几条）。本文件是**正向**声明
 * （给定条目，它要求哪些格）。两者由 `scripts/e2e/pulse-pattern.mjs`
 * 的不变量断言绑死 —— 任一边改了而另一边没改，断言立刻红。
 *
 * ## 与 `condition` 文字的出入
 *
 * `condition` 是**讲义 p44 图上的框位标注**，讲稿原文常常更宽
 * （如「第一个挡路的，浮取无」没分左右）。本文件以**讲稿原文**为准，
 * 出入写在各条的 `note` 里，界面上照写出来。
 */

import type { PulsePattern } from './pulse-pattern'
import PATTERN_DATA from '../content/pulse-patterns.json'

/**
 * 脉象图条目表。
 *
 * ⚠️ JSON import 的类型是「放宽版」—— `layout` 之类可选字段会被推成可选联合。
 *    这里显式收窄成 `PulsePattern`，让类型检查继续兜住数据。
 */
export const PATTERNS: Record<string, PulsePattern> = PATTERN_DATA.patterns as Record<
  string,
  PulsePattern
>
