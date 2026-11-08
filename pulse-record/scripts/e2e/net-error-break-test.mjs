#!/usr/bin/env node
/**
 * 「故意写坏」验证 —— 证明第 30 节「网络失败要说人话」那批断言是**活的**（不是摆设）
 *
 * 背景：维护者 2026-11-08 在真机截图上标注：病例页一片红 —— **「网络请求失败」**。
 *
 * 病根两层：
 *   ① 微信的失败对象字段名是 **`errMsg`**，不是 `message` ——
 *      旧代码只读 `.message` → 永远 undefined → 每次都落到笼统兜底上；
 *   ② **目标地址从没出现在错误里** —— 使用者判断不了自己连的是哪台机器。
 *
 * 光「加断言」不够 —— 得证明断言**真的能抓到**那些坏写法。
 * 做法：把源码真的改坏 → 跑 lint → 要求**对应的断言必须红** → 还原源码。
 *
 * 用法：node scripts/e2e/net-error-break-test.mjs
 *      （**不在默认 npm test 链里** —— 它要把源码改坏再还原）
 *
 * 纪律（同 login-break-test.mjs / sheet-break-test.mjs）：
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
const PLATFORM_REQUEST = join(SRC, 'platform', 'request.ts')
const API = join(SRC, 'utils', 'api.ts')
const NET_ERROR = join(SRC, 'utils', 'net-error.ts')
const CASES = join(SRC, 'pages', 'cases', 'index.tsx')
const LOGIN = join(SRC, 'pages', 'login', 'index.tsx')
const ME = join(SRC, 'pages', 'me', 'index.tsx')
const NET_COMP = join(SRC, 'components', 'net-error', 'index.tsx')

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

/* ========================================================================
 * A~C：平台层 —— 真实原因不许再被丢掉
 * ======================================================================== */

/* A. 把失败分支删掉 —— reject 裸对象，errMsg 又丢了（就是原来的病根） */
step(
  mutate(
    'A platform/request 不接失败分支',
    PLATFORM_REQUEST,
    `  }).then(
    (res) => ({ statusCode: res.statusCode, data: res.data }),
    // ⚠️ **失败分支必须显式接住** —— 不接的话 reject 的是裸对象，
    //    上层读 \`.message\` 读不到（微信给的是 \`errMsg\`）→ 真实原因丢失。
    (err) => {
      throw toRequestError(err, options.url)
    },
  )`,
    `  }).then((res) => ({ statusCode: res.statusCode, data: res.data }))`,
    'platform/request 显式接住失败',
  ),
)

/* B. 失败时不再保留 errMsg（只留 message）—— 微信给的是 errMsg，读不到 */
step(
  mutate(
    'B platform/request 不保留 errMsg',
    PLATFORM_REQUEST,
    '  const raw = String(src.errMsg ?? src.message ?? \'\').trim()',
    "  const raw = String(src.message ?? '').trim()",
    'platform/request 把 errMsg 保留下来',
  ),
)

/* C. api.ts 又读回 .message —— 病根原样复活 */
step(
  mutate(
    'C api.ts 只读 message 不读 errMsg',
    API,
    "    const raw = String((err as { errMsg?: unknown })?.errMsg ?? (err as Error)?.message ?? '')",
    "    const raw = String((err as Error)?.message ?? '')",
    'api.ts 每一个「要出诊断」的 catch 都读了 errMsg',
  ),
)

/* ========================================================================
 * D~F：api.ts —— 错误不许再是裸字符串
 * ======================================================================== */

/* D. 不用诊断层，直接抛一句「网络请求失败」 */
step(
  mutate(
    'D api.ts 退回裸的「网络请求失败」',
    API,
    `    const detail = describeNetFailure({
      raw,
      url,
      transport: 'request',
      release: isRelease(),
    })
    throw new ApiError(formatNetFailure(detail), 0, detail)`,
    `    throw new ApiError('网络请求失败', 0)`,
    'api.ts 用诊断层构造错误',
  ),
)

/* E. 诊断层不再按原始报错分类（永远返回同一句） */
step(
  mutate(
    'E 诊断层不分类了',
    NET_ERROR,
    "  if (/url not in domain list|not in domain list|合法域名/i.test(s)) return 'domain-list'",
    "  if (/zzz-never-matches-zzz/i.test(s)) return 'domain-list'",
    'classify 每一类原始报错都还认得',
  ),
)

/* F. 诊断层不再是纯函数（引了 Taro）—— 回归脚本就没法在 Node 里 import 它 */
step(
  mutate(
    'F 诊断层引了 Taro（不再是纯函数）',
    NET_ERROR,
    "export type NetTransport = 'request' | 'cloud'",
    "import Taro from '@tarojs/taro'\n\nexport type NetTransport = 'request' | 'cloud'",
    '诊断层是纯函数',
  ),
)

/* ========================================================================
 * G~I：三个页面 —— 诊断要显示出来，探活失败不许装作连上了
 * ======================================================================== */

/* G. 病例页不渲染诊断块 */
step(
  mutate(
    'G 病例页不渲染诊断块',
    CASES,
    "      {netError ? <NetError detail={netError} extra='病例列表读取失败' /> : null}",
    '      {null}',
    '病例页渲染网络诊断块',
  ),
)

/* H. 登录页的 health 失败被静默吞掉 —— 回到原来的样子 */
step(
  mutate(
    'H 登录页静默吞掉探活失败',
    LOGIN,
    `      .catch((e) => {
        // 探不到服务端（默认多用户模式）—— 也停在这一步，等用户自己点。
        // 不猜、不自动尝试。
        // ⚠️ 但**不能静默**：把原因说出来（2026-11-08 真机「网络请求失败」的教训）。
        if (!alive) return
        const d = (e as { detail?: NetFailure })?.detail
        if (d) setNetError(d)
      })`,
    `      .catch(() => undefined)`,
    '登录页的 health 失败不再被静默吞掉',
  ),
)

/* I. 「我的」页的 health 失败被静默吞掉 */
step(
  mutate(
    'I 「我的」页静默吞掉探活失败',
    ME,
    `      .catch((e) => {
        // ⚠️ **探不到服务端要说话**（2026-11-08）——
        //    旧代码 \`.catch(() => undefined)\` 静默吞掉，
        //    于是「模式」那一行永远显示默认的「多用户模式（按账号隔离）」，
        //    哪怕根本没连上。
        const d = (e as { detail?: NetFailure })?.detail
        if (d) setNetError(d)
      })`,
    '      .catch(() => undefined)',
    '「我的」页的 health 失败不再被静默吞掉',
  ),
)

/* J. 病例页又无条件宣称「数据存在服务器，按账号隔离」 */
step(
  mutate(
    'J 病例页无条件宣称「按账号隔离」',
    CASES,
    `            {serverOk === false
              ? '连不上服务器 · 下面的红字说明了原因'
              : mode === 'single'
                ? '单机模式 · 数据只在本机'
                : '数据存在服务器，按账号隔离'}`,
    `            {mode === 'single'
              ? '单机模式 · 数据只在本机'
              : '数据存在服务器，按账号隔离'}`,
    '病例页不再无条件宣称「数据存在服务器，按账号隔离」',
  ),
)

/* ========================================================================
 * K：隐私接口 —— 诊断块不许偷偷用 setClipboardData
 *
 * 维护者 2026-11-05 定：上线包**不调用任何隐私接口** → 后台隐私指引一项都不用勾。
 * 「一键复制诊断」会用到 setClipboardData → 被这条规矩挡住。
 * （这条断言在第 21 节，不在第 30 节 —— 但它同样守着这次改动。）
 * ======================================================================== */
step(
  mutate(
    'K 诊断块偷偷用剪切板接口',
    NET_COMP,
    "import { Text, View } from '@tarojs/components'",
    "import { Text, View } from '@tarojs/components'\nimport Taro from '@tarojs/taro'\n\nvoid Taro.setClipboardData",
    '上线包不再调用任何隐私接口',
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
