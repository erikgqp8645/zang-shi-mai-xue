#!/usr/bin/env node
/**
 * break-test：证明「② 定疗法里的方名链接」那几条断言**不是恒绿**
 *
 * ## 背景
 *
 * 2026-11-11：`src/components/TriadFrame.tsx` 的 `TherapyPicker` 里，
 * 整张疗法卡是 `<button>`（点它＝选疗法），卡内的方名又是 `<button>`（点它＝看方剂条目）。
 * button 套 button 是无效 HTML，更要紧的是**点击会冒泡到外层** ——
 * 想查一条方的组成，却顺手把疗法也定了。
 *
 * 修法：内层改成 `<span role="button">` ＋ `e.stopPropagation()`。
 * 对应的断言在 `app-regression.mjs` 的【⑨】段。
 *
 * ## 这个脚本干什么
 *
 * 逐个把源码**故意写坏**，跑一遍网站端浏览器回归，验证：
 *   · 该红的真的红了（写坏必被抓）；
 *   · 不该红的仍然绿（否则就是恒红/恒绿的摆设）。
 *
 * 两个 mutation：
 *   A —— 把内层改回 `<button>` 并去掉 stopPropagation（**完整复现原始 bug**）
 *        期望：嵌套 button 那条红 ＋ 连带选疗法那条红
 *   B —— 保留 `<span>`，只去掉 onClick 里的 stopPropagation（**只剩冒泡这一种坏法**）
 *        期望：连带选疗法那条红，而「没有 button 套 button」**仍然绿**
 *        （B 是关键 —— 它证明「连带选疗法」那条真的在测事件冒泡，
 *          不是靠 A 的嵌套结构顺带变红的）
 *
 * 跑法：node scripts/e2e/app-nested-button-break-test.mjs
 *
 * 需要本机装了 Google Chrome（用 CHROME_PATH 指定可执行文件）。
 */

import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { runBreakMutations } from './lib-break.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TARGET = join(ROOT, 'src', 'components', 'TriadFrame.tsx')
const REGRESSION = join(ROOT, 'scripts', 'e2e', 'app-regression.mjs')

const RE_SPAN_BLOCK =
  /<span\s+role="button"\s+tabIndex=\{0\}\s+className="pr-link pr-link-inline"[\s\S]*?<\/span>/

/** onClick 里的 stopPropagation（第一处；onKeyDown 里那处不在这个模式里） */
const RE_STOP =
  /onClick=\{\(e\) => \{\s*e\.stopPropagation\(\)\s*onOpenFormula\?\.\(link\)\s*\}\}/

/** 改回原始的 button 版（就是修复前的样子） */
const BTN_BLOCK = [
  '<button',
  '                        type="button"',
  '                        className="pr-link"',
  '                        onClick={() => onOpenFormula?.(link)}',
  '                        title={`看「${link.label}」的完整条目　依据：${link.basis}`}',
  '                      >',
  '                        {p.name}',
  '                      </button>',
].join('\n')

/** 去掉 stopPropagation 的 onClick */
const NO_STOP = ['onClick={() => {', '                          onOpenFormula?.(link)', '                        }}'].join(
  '\n',
)

/* ------------------------------ 跑回归 ------------------------------ */

const MUTATIONS = [
  {
    id: 'A',
    title: '内层改回 <button> 并去掉 stopPropagation（完整复现原始 bug）',
    apply(src) {
      const a = src.replace(RE_SPAN_BLOCK, BTN_BLOCK)
      return a.replace(RE_STOP, NO_STOP)
    },
    expectRed: ['页面上没有 button 套 button', '点方名链接不会连带把疗法选了'],
    expectGreen: [],
  },
  {
    id: 'B',
    title: '保留 <span>，只去掉 onClick 里的 stopPropagation（只剩冒泡这一种坏法）',
    apply(src) {
      return src.replace(RE_STOP, NO_STOP)
    },
    expectRed: ['点方名链接不会连带把疗法选了'],
    // 关键：结构没坏，所以「没有 button 套 button」必须仍然绿 ——
    // 否则说明「连带选疗法」那条是靠着嵌套结构顺带变红的假阳性。
    expectGreen: ['页面上没有 button 套 button'],
  },
]

const ok = runBreakMutations({
  title: '网站端「嵌套 button」break-test',
  target: TARGET,
  regression: REGRESSION,
  cwd: ROOT,
  mutations: MUTATIONS,
})
process.exit(ok ? 0 : 1)
