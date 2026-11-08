#!/usr/bin/env node
/**
 * 「故意写坏」验证 —— 证明「正式版隐藏服务器设置」那几条断言是**活的**（不是摆设）
 *
 * 背景：维护者 2026-11-08 要求「我的」页的「服务器」界面与「存储位置」
 * **在正式发布版不显示**。这类规矩最容易被无意改回去
 * （哪天重构页面把三元表达式拆了、或者把 `isRelease()` 写成 `!isRelease()`），
 * 所以光「加断言」不够 —— 得证明断言**真的能抓到**那个坏写法。
 *
 * 做法：把源码真的改坏 → 跑 lint → 要求**对应的断言必须红** → 还原源码。
 *
 * 用法：node scripts/e2e/me-release-break-test.mjs
 *      （**不在默认 npm test 链里** —— 它要把源码改坏再还原，跑起来比一般回归慢）
 *
 * 纪律（同 sheet-break-test.mjs）：
 *   ① mutation 没改动文件时**直接判失败**（不许「什么也没改 → 断言当然不红」被当成「抓到了」）；
 *   ② 结束时**必定还原源码**，不留一个被打坏的工程。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SRC = join(ROOT, 'taro', 'src')

const LINT = join(ROOT, 'scripts', 'e2e', 'taro-lint.mjs')
const ME = join(SRC, 'pages', 'me', 'index.tsx')
const CFG = join(SRC, 'utils', 'config.ts')
const VER = join(SRC, 'platform', 'version.ts')

/** 跑一次 lint，返回 { code, red: [断言名…], total, pass, fail } */
function runLint() {
  const r = spawnSync(process.execPath, [LINT], { cwd: ROOT, encoding: 'utf8' })
  const out = (r.stdout || '') + (r.stderr || '')
  const m = out.match(/合计：(\d+) 项，通过 (\d+)，失败 (\d+)/)
  const total = m ? Number(m[1]) : 0
  const pass = m ? Number(m[2]) : 0
  const fail = m ? Number(m[3]) : 0
  const red = []
  const detailAt = out.indexOf('失败明细：')
  if (detailAt >= 0) {
    for (const line of out.slice(detailAt).split(/\r?\n/)) {
      const mm = line.match(/^\s*·\s*(.+?)\s*(?:——.*)?$/)
      if (mm && mm[1]) red.push(mm[1].trim())
    }
  }
  return { code: r.status, red, total, pass, fail }
}

/** 源码是 CRLF，匹配串按 LF 写 —— 两边都试一遍 */
function findAndReplace(src, from, to) {
  const variants = [from, from.replace(/\n/g, '\r\n')]
  for (const f of variants) {
    if (src.includes(f)) return src.replace(f, to)
  }
  return src
}

/** 改坏 → 跑 → 还原 */
function mutate(label, file, from, to, expectRed, mode = 'replace') {
  const before = readFileSync(file, 'utf8')
  let after = before
  if (mode === 'remove') {
    // 从 from 那个标记起，把整个 JSX 表达式（`{… ? ( … ) : null}`）切掉
    for (const marker of [from, from.replace(/\n/g, '\r\n')]) {
      const at = before.indexOf(marker)
      if (at >= 0) {
        const end = before.indexOf(') : null}', at)
        if (end >= 0) {
          after = before.slice(0, at) + '{null}' + before.slice(end + ') : null}'.length)
          break
        }
      }
    }
  } else {
    after = findAndReplace(before, from, to)
  }
  if (after === before) {
    console.log(`✗ ${label}：源文件里找不到要改的那段（mutation 没生效 → 直接判失败）`)
    return false
  }
  writeFileSync(file, after, 'utf8')
  let res
  try {
    res = runLint()
  } finally {
    writeFileSync(file, before, 'utf8') // ← 必定还原
  }
  const hit = res.red.some((r) => r.includes(expectRed))
  console.log(
    `${hit ? '✓' : '✗'} ${label}：${res.fail} 条红` +
      (res.red.length ? `（${res.red.map((r) => r.slice(0, 34)).join(' / ')}）` : '（无红！断言没抓到）'),
  )
  if (!hit) {
    console.log(`    期望红的那条断言：${expectRed}`)
    return false
  }
  return true
}

let allOk = true
const step = (ok) => {
  allOk = ok && allOk
}

// A. 「服务器」卡片不再判正式版（永远走假分支 → 不渲染）：断言应红在「整张卡片在正式版不渲染」
step(
  mutate(
    'A 服务器卡片改成永远不渲染',
    ME,
    '{!release ? (\n        <View className="pr-card">\n          <View className="pr-card-title">服务器</View>',
    '{false ? (\n        <View className="pr-card">\n          <View className="pr-card-title">服务器</View>',
    '「服务器」整张卡片在正式版不渲染',
  ),
)

// B. 「存储位置」行不再判正式版
step(
  mutate(
    'B 存储位置行改成常显',
    ME,
    '{dbPath && !release ? (',
    '{dbPath ? (',
    '「存储位置」这一行在正式版不渲染',
  ),
)

// C. release 判定被取反（!isRelease()）—— 结构断言查不出，必须靠「严格等于」抓
step(
  mutate(
    'C release 判定取反',
    ME,
    'const release = isRelease()',
    'const release = !isRelease()',
    'release 判定来自 isRelease()',
  ),
)

// D. resolveApiBase 不再在正式版固定地址
step(
  mutate(
    'D resolveApiBase 去掉正式版判断',
    CFG,
    '  if (isRelease()) return API_BASE\n',
    '',
    'resolveApiBase 在正式版忽略本地存的地址',
  ),
)

// E. 版本判定改用内部对象 __wxConfig
step(
  mutate(
    'E 版本判定改用 __wxConfig',
    VER,
    'wx.getAccountInfoSync()?.miniProgram?.envVersion',
    '(globalThis as any).__wxConfig?.envVersion',
    '版本判定用 getAccountInfoSync',
  ),
)

// F. 「服务器」卡片整块删掉（界面不存在了）
//    → 红在「整张卡片在正式版不渲染」那条，细节里写着「没找到「服务器」卡片」
step(
  mutate(
    'F 删掉服务器卡片',
    ME,
    '{!release ? (\n        <View className="pr-card">\n          <View className="pr-card-title">服务器</View>',
    '',
    '「服务器」整张卡片在正式版不渲染',
    'remove',
  ),
)

// G. release 变量被写死（不再是 isRelease() 推出来的）
step(
  mutate(
    'G release 变量换成硬编码 false',
    ME,
    'const release = isRelease()',
    'const release = false',
    'release 判定来自 isRelease()',
  ),
)

// 还原后必须还是全绿
const final = runLint()
console.log(
  `${final.fail === 0 ? '✓' : '✗'} 还原后复跑：${final.pass}/${final.total} 全绿` +
    (final.fail ? `（还有 ${final.fail} 条红）` : ''),
)
if (final.fail !== 0) allOk = false

console.log(allOk ? '\n全部 mutation 都被抓到，且源码已还原。' : '\n有 mutation 没被抓到 —— 防线不成立。')
process.exit(allOk ? 0 : 1)
