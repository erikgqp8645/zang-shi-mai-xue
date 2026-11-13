#!/usr/bin/env node
/**
 * break-test：证明「③ 知识库 · 方名 chip 能新增」那几条断言**不是恒绿**
 *
 * ## 背景
 *
 * 2026-11-12：③ 用方知识库的方名 chip 原来只能 ✎（改）／✕（删），
 * 管理员加不了新的方名。补了「＋ 添加」入口（`src/components/Findings.tsx`），
 * 走的是同一条覆盖层写库路径（`formulas[]` 整条数组），
 * 对应的断言在 `app-regression.mjs` 的【⑪-补】段。
 *
 * ## 为什么必须有这个 break-test
 *
 * 覆盖层语义是「有行就整条接管」。如果新增实现成「用新值整体替换数组」，
 * 用户只是加一个方名，**实际会把别的方名全冲掉** —— 界面上只少几项，不容易察觉。
 * 「只追加一项、原有项一个不少」这条断言必须能抓到这种写法。
 *
 * ## 两个 mutation（都改**纯函数**，不改组件里的调用）
 *
 * ⚠️ 为什么落在 `library-chips.mjs` 而不是 `Findings.tsx`：
 *    组件里少了 `addChip` 的调用会被 tsc 判「声明未使用」⇒ 回归根本编译不过，
 *    断言全红却没有一条是「被测的那条」。
 *
 *   A —— `addChip` 改成「整体替换」
 *        期望：「只追加一项 —— 原有的方名一个不少」红；
 *              而「新方名真的加进了 chip 列表」**仍然绿**
 *   C —— 去掉空值校验（空白输入也追加成一项）
 *        期望：「空白的输入不落库」红；而「只追加一项」**仍然绿**
 *
 * 跑法：node scripts/e2e/app-chip-add-break-test.mjs
 *
 * 需要本机装了 Google Chrome（用 CHROME_PATH 指定可执行文件）。
 */

import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runBreakMutations } from './lib-break.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 正确写法：只追加（纯函数负责去空／去重） */
const RE_ADD = /return \[\.\.\.arr, value\]/
/** A：整体替换 —— 加一个方名会把别的全冲掉 */
const REPLACE_ALL = 'return [value]'
/** C：不挡空值 —— trim 后的空串也会被当成一个新方名 */
const RE_EMPTY_GUARD = /  if \(!value\) return arr\.slice\(\)\n/

const NAME_ADDED = '回车后新方名真的加进了 chip 列表'
const NAME_KEEP = '新增只追加一项 —— 原有的方名一个不少（不整条覆盖丢项）'
const NAME_EMPTY = '空白的输入不落库（chip 数量不变，没多出空方名）'

const ok = runBreakMutations({
  title: '网站端「方名 chip 新增」break-test',
  target: join(ROOT, 'src', 'domain', 'library-chips.mjs'),
  regression: join(ROOT, 'scripts', 'e2e', 'app-regression.mjs'),
  cwd: ROOT,
  mutations: [
    {
      id: 'A',
      title: '新增实现成「整体替换数组」（会把已有的方名冲掉）',
      apply: (src) => src.replace(RE_ADD, REPLACE_ALL),
      expectRed: [NAME_KEEP],
      expectGreen: [NAME_ADDED],
    },
    {
      id: 'C',
      title: '去掉空值校验（空白输入也追加成一项）',
      apply: (src) => src.replace(RE_EMPTY_GUARD, ''),
      expectRed: [NAME_EMPTY],
      expectGreen: [NAME_KEEP],
    },
  ],
})

process.exit(ok ? 0 : 1)
