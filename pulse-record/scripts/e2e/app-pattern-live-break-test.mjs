#!/usr/bin/env node
/**
 * break-test：证明「图里填完不失焦、直接点保存」那条断言**不是恒绿**
 *
 * ## 背景
 *
 * 2026-11-13 用户实测：在新增条目的「脉象图」页格子里填了值，
 * 直接点「保存」，报「脉象图至少要标一个格子（部位 ＋ 取法）才有判定意义」。
 *
 * 原因：格值原来只在该输入框 **blur** 时才写进图（`commitCell`），
 * 点「保存」时 React 还没把那次 blur 的更新刷进父级草稿 ⇒ 保存拿到空图。
 *
 * 修法：输入（`onChange`）、点符号条（`appendCode`）、清空（`clearFocused`）
 * **都即时**写进图（`writeLive`），不再依赖失焦。
 * 对应断言在 `app-regression.mjs` 的【⑪-补3】段。
 *
 * ## mutation
 *
 * 把 `onChange` 里那行 `writeLive(key, text)` 删掉（回到「只有 blur 才写」）⇒
 * 期望【⑪-补3】那条变红；而同一段里其它断言（按钮、id、弹层）**仍然绿**——
 * 证明它测的确实是「提交时机」这一件事，不是顺带红的。
 *
 * 跑法：node scripts/e2e/app-pattern-live-break-test.mjs
 *
 * 需要本机装了 Google Chrome（用 CHROME_PATH 指定可执行文件）。
 */

import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runBreakMutations } from './lib-break.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 格子输入框 onChange 里那行「即时写进图」 */
const RE_LIVE = /\n\s*writeLive\(key, text\)/

const NAME_NOBLUR = '图里填完不失焦、直接点保存：保存成功（不再报「至少要标一个格子」）'
const NAME_BTN = '「条目 id」旁有「自动生成」按钮'

const ok = runBreakMutations({
  title: '网站端「脉象图格值即时提交」break-test',
  target: join(ROOT, 'src', 'components', 'PatternPanel.tsx'),
  regression: join(ROOT, 'scripts', 'e2e', 'app-regression.mjs'),
  cwd: ROOT,
  mutations: [
    {
      id: 'A',
      title: '去掉 onChange 里的 writeLive（回到「只有 blur 才写」）',
      apply: (src) => src.replace(RE_LIVE, ''),
      expectRed: [NAME_NOBLUR],
      expectGreen: [NAME_BTN],
    },
  ],
})

process.exit(ok ? 0 : 1)
