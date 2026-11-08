#!/usr/bin/env node
/**
 * 「故意写坏」验证 —— 证明「登录页不许自动登录」那几条断言是**活的**（不是摆设）
 *
 * 背景：维护者 2026-11-08 在真机截图上标注：
 *   「点击退出登录后这里微信一键登录会自动登录，这个逻辑是错误的，
 *     需要用户点击才可以登录」。
 *
 * 病根：登录页的 `useEffect` 里直接调了 `tryWechat()` —— 进页面就发起微信登录。
 * 于是点「退出登录」→ 跳回登录页 → 又自动登录 → 又进去了（**等于退不掉**）。
 *
 * 光「加断言」不够 —— 得证明断言**真的能抓到**那个坏写法。
 * 做法：把源码真的改坏 → 跑 lint → 要求**对应的断言必须红** → 还原源码。
 *
 * 用法：node scripts/e2e/login-break-test.mjs
 *      （**不在默认 npm test 链里** —— 它要把源码改坏再还原）
 *
 * 纪律（同 me-release-break-test.mjs / sheet-break-test.mjs）：
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
const LOGIN = join(SRC, 'pages', 'login', 'index.tsx')
const ME = join(SRC, 'pages', 'me', 'index.tsx')
const AUTH_FLOW = join(SRC, 'utils', 'auth-flow.ts')
const TARO_CONFIG = join(ROOT, 'taro', 'config', 'index.ts')

/** 跑一次 lint，返回 { red: [断言名…], total, pass, fail } */
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
  for (const f of [from, from.replace(/\n/g, '\r\n')]) {
    if (src.includes(f)) return src.replace(f, to)
  }
  return src
}

/** 改坏 → 跑 → 还原 */
function mutate(label, file, from, to, expectRed) {
  const before = readFileSync(file, 'utf8')
  const after = findAndReplace(before, from, to)
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

/* A. 把自动登录塞回 useEffect —— 就是那个真凶 */
step(
  mutate(
    'A useEffect 里自动登录',
    LOGIN,
    '      .then((h) => {\n        const body = (h || {}) as HealthBody',
    '      .then((h) => {\n        if (alive) tryWechat()\n        const body = (h || {}) as HealthBody',
    '登录页不在生命周期钩子里自动发起微信登录',
  ),
)

/* B. 换个钩子（useDidShow）自动登录 —— 断言要能抓到「换壳」 */
step(
  mutate(
    'B useDidShow 里自动登录',
    LOGIN,
    '  useEffect(() => {',
    '  useDidShow(() => {\n    tryWechat()\n  }, [])\n\n  useEffect(() => {',
    '登录页不在生命周期钩子里自动发起微信登录',
  ),
)

/* C. 按钮的 onClick 指向空值（点了没反应） */
step(
  mutate(
    'C 按钮 onClick 指向 undefined',
    LOGIN,
    'onClick={onWechatLogin}',
    'onClick={undefined}',
    '「微信一键登录」按钮绑了 onClick',
  ),
)

/* D. onClick 直接调 wechatLogin，绕过 onWechatLogin */
step(
  mutate(
    'D onClick 绕过 onWechatLogin',
    LOGIN,
    '  const onWechatLogin = useCallback(() => {\n    tryWechat()\n  }, [tryWechat])',
    '  const onWechatLogin = useCallback(() => {\n    wechatLogin()\n  }, [])',
    'onClick 的处理器',
  ),
)

/* E. 把「自动进入」塞回 useEffect（单机模式的老路） */
step(
  mutate(
    'E useEffect 里自动进入（单机模式那条老路）',
    LOGIN,
    '        if (alive) setSingleMode(entryKind(mode) === \'single-enter\')',
    "        if (alive) setSingleMode(entryKind(mode) === 'single-enter')\n        if (alive) goCases()",
    '登录页**不许自动进入**',
  ),
)

/* F. tryWechat 另开一个自动入口（藏在别的回调里） */
step(
  mutate(
    'F 另开一个 tryWechat 调用点',
    LOGIN,
    '  const onWechatLogin = useCallback(() => {\n    tryWechat()\n  }, [tryWechat])',
    '  const onWechatLogin = useCallback(() => {\n    tryWechat()\n  }, [tryWechat])\n\n  const autoWechat = useCallback(() => {\n    tryWechat()\n  }, [tryWechat])',
    'tryWechat 只被 onWechatLogin',
  ),
)

/* ========================================================================
 * G~L：2026-11-08 补的「第二条自动进入路径」与「构建标识」
 * ======================================================================== */

/* G. entryKind 认不出单机模式 —— 单机模式会显示「微信一键登录」 */
step(
  mutate(
    'G entryKind 认不出单机模式',
    AUTH_FLOW,
    "  return isSingleMode(mode) ? 'single-enter' : 'wechat-login'",
    "  return mode === 'multi' ? 'wechat-login' : 'wechat-login'",
    "auth-flow 的 entryKind 认得出单机模式",
  ),
)

/* H. 页面不调 entryKind，自己判（规则又散回两处） */
step(
  mutate(
    'H 登录页不调 entryKind，自己判',
    LOGIN,
    "        if (alive) setSingleMode(entryKind(mode) === 'single-enter')",
    "        if (alive) setSingleMode(mode === 'single')",
    '登录页的入口种类走 entryKind',
  ),
)

/* I. 「我的」页退出时忘了记「刚退出过」 */
step(
  mutate(
    'I 退出登录不记「刚退出过」',
    ME,
    "    markLoggedOut()\n    await authLogout()\n    setLoginName('')",
    "    await authLogout()\n    setLoginName('')",
    '「我的」页的退出登录处理器会记「刚退出过」',
  ),
)

/* J. 删掉「进入（单机模式）」按钮 —— 单机模式就进不去了 */
step(
  mutate(
    'J 删掉「进入（单机模式）」按钮',
    LOGIN,
    '            进入（单机模式）\n          </Button>',
    '            进入\n          </Button>',
    '登录页有「进入（单机模式）」按钮',
  ),
)

/* K. 删掉登录页的构建标识 —— 又分不清跑的是新包还是旧包 */
step(
  mutate(
    'K 登录页不显示构建标识',
    LOGIN,
    '      <View className="pr-build">{buildLabel()}</View>',
    '      <View className="pr-build" />',
    '登录页显示构建标识',
  ),
)

/* L. 编译期不注入 PULSE_BUILD_AT —— 产物里就没有版本号 */
step(
  mutate(
    'L 编译期不注入 PULSE_BUILD_AT',
    TARO_CONFIG,
    "      'process.env.PULSE_BUILD_AT': JSON.stringify(\n        String(process.env.PULSE_BUILD_AT || '').trim() || buildStamp(),\n      ),",
    "      'process.env.PULSE_BUILD_AT': JSON.stringify(''),",
    '编译期注入 PULSE_BUILD_AT（构建时间）',
  ),
)

/* M. 把 shouldAutoEnter 复活 —— 「自动进入」这条路必须整条拆掉 */
step(
  mutate(
    'M auth-flow 里复活 shouldAutoEnter',
    AUTH_FLOW,
    "export function entryKind(mode?: string | null): EntryKind {",
    "export function shouldAutoEnter(mode?: string | null): boolean {\n  return isSingleMode(mode)\n}\n\nexport function entryKind(mode?: string | null): EntryKind {",
    'auth-flow 里不许再有 shouldAutoEnter',
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
