/**
 * break-test 的**公共骨架**（「故意写坏 → 跑回归 → 断言该红的红、该绿的绿 → 还原」）
 *
 * ## 为什么抽出来
 *
 * 项目里有 8 个 `*break-test.mjs`，每个都在重复同一段：
 * 备份源码 → 写坏 → `spawnSync` 跑回归 → 看输出里是 `✓` 还是 `✗` → 逐字节还原 →
 * 最后再跑一遍基线确认全绿。**这段逻辑一模一样，只有「改哪一行」不同。**
 *
 * 抽出来之后，每个 break-test 只剩下它真正独有的东西：
 *   · 目标文件
 *   · 若干 mutation（`apply(src) => mutated`）
 *   · 每个 mutation 期望哪条断言变红、哪条仍绿
 *
 * ## 不迁就旧脚本
 *
 * 已有的 break-test **保持原样**（它们跑得好好的，改造的收益不抵风险）。
 * 新写的 break-test 用这里；旧的哪天要动，再顺手迁过来。
 *
 * ## 两条硬规矩
 *
 * 1. **无论怎么退出都要还原源码** —— `finally` 里再做一次逐字节核对。
 * 2. **先验证 mutation 真的改动了源码** —— `apply()` 写错（正则不匹配）时，
 *    脚本会「跑了一遍但什么都没改」，回归全绿，看起来像通过了。
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

/** 断言的计数器 + 输出（与 `lib.mjs` 的 makeChecker 同一套观感） */
export function makeBreakChecker() {
  let pass = 0
  let fail = 0
  const failures = []

  function ok(name, cond, detail = '') {
    if (cond) {
      pass++
      console.log(`  ✓ ${name}`)
    } else {
      fail++
      failures.push(`${name}${detail ? ' —— ' + detail : ''}`)
      console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`)
    }
    return cond
  }

  function summary() {
    console.log(`\n=== 通过 ${pass} ｜ 失败 ${fail} ===`)
    if (failures.length) {
      console.log('失败项：')
      for (const f of failures) console.log('  · ' + f)
    }
    return fail === 0
  }

  return { ok, summary, get pass() { return pass }, get fail() { return fail } }
}

/** 跑一个回归脚本，拿回退出码与全部输出 */
export function runRegression(scriptPath, { cwd } = {}) {
  const r = spawnSync(process.execPath, [scriptPath], {
    cwd: cwd ?? process.cwd(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return { code: r.status, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}` }
}

/** 某条断言在回归输出里是红（✗）还是绿（✓） */
export const isRed = (out, name) => out.includes(`✗ ${name}`)
export const isGreen = (out, name) => out.includes(`✓ ${name}`)

/**
 * 跑一整组 mutation。
 *
 * @param {object} opts
 * @param {string} opts.title       标题（打印用）
 * @param {string} opts.target      要写坏的源码文件（绝对路径）
 * @param {string} opts.regression  回归脚本（绝对路径）
 * @param {string} [opts.cwd]       跑回归的工作目录
 * @param {Array<{
 *   id: string,
 *   title: string,
 *   apply: (src: string) => string,
 *   expectRed?: string[],
 *   expectGreen?: string[],
 * }>} opts.mutations
 * @returns {boolean} 全部通过返回 true
 */
export function runBreakMutations({ title, target, regression, cwd, mutations }) {
  const c = makeBreakChecker()
  const original = readFileSync(target, 'utf8')

  console.log(`\n${title}\n`)

  try {
    for (const m of mutations) {
      console.log(`【mutation ${m.id}】${m.title}`)
      const mutated = m.apply(original)

      // ⚠️ 先验证「真的改了」—— 否则跑了一遍回归全绿，看起来像通过
      if (mutated === original) {
        c.ok(`mutation ${m.id} 真的改动了源码`, false, 'apply() 之后文件内容一模一样 —— 规则失效')
        continue
      }
      c.ok(`mutation ${m.id} 真的改动了源码`, true)

      writeFileSync(target, mutated, 'utf8')
      const { code, out } = runRegression(regression, { cwd })
      c.ok(`mutation ${m.id} 跑回归失败（说明写坏了）`, code !== 0, `退出码 ${code}`)

      for (const name of m.expectRed ?? []) {
        c.ok(`mutation ${m.id}｜「${name}」变红`, isRed(out, name), out.slice(-700))
      }
      for (const name of m.expectGreen ?? []) {
        c.ok(`mutation ${m.id}｜「${name}」仍然绿`, isGreen(out, name), out.slice(-700))
      }

      writeFileSync(target, original, 'utf8')
      c.ok(
        `mutation ${m.id} 之后源码已还原（逐字节一致）`,
        readFileSync(target, 'utf8') === original,
      )
      console.log('')
    }

    console.log('【基线】还原之后再跑一遍，必须全绿')
    const { code, out } = runRegression(regression, { cwd })
    c.ok('还原后回归全绿', code === 0, out.slice(-800))
  } finally {
    // 无论怎么退出（包括抛错）都还原
    writeFileSync(target, original, 'utf8')
    c.ok('退出时源码已还原（逐字节一致）', readFileSync(target, 'utf8') === original)
  }

  return c.summary()
}
