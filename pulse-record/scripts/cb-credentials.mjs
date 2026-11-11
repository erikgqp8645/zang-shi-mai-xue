#!/usr/bin/env node
/**
 * 拿临时密钥 → 跑一条命令（**密钥全程不落盘、不进终端**）
 *
 * ## 为什么要有它
 *
 * 发布命令要连 CloudBase PG，凭证只能从**环境变量**读（仓库纪律）。
 * 但临时密钥得从某处来 —— 腾讯云控制台复制粘贴容易漏、也容易留在终端历史里。
 *
 * 这个脚本走 `tcb secrets get`（CloudBase CLI 的「临时密钥」功能）：
 *
 *   1. 调 CLI，把密钥**解析进内存**
 *   2. 用这些环境变量**启动子进程**
 *   3. 退出时什么都不留下 —— 密钥没进终端输出、没进文件、没进 shell 历史
 *
 * ⚠️ 子进程的命令行里**只有命令本身**，没有密钥 ——
 *    密钥走的是子进程的**环境变量**，不是 argv。
 *
 * ## 用法
 *
 *     node scripts/cb-credentials.mjs -- node scripts/content-publish.mjs
 *     node scripts/cb-credentials.mjs -- node scripts/e2e/content-pg.mjs
 *
 * ## 前置条件
 *
 * · 装了 CloudBase CLI（`tcb`）并**已登录**（`tcb login`）
 * · 临时密钥有有效期（CLI 会打印过期时间），过期了重跑 `tcb login` 即可
 *
 * ## 失败时
 *
 * CLI 不可用／未登录／解析不出来 ⇒ 明确报错并退出 1，
 * **不静默降级**（降级＝「以为连上了，其实没连」）。
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const ENV_ID = process.env.PULSE_CB_ENV || process.env.PULSE_ENV_ID || 'pulse-1-d0g880ydl8ddc57f6'

/** CLI 里这一列的名字 → 我们要的变量名 */
const FIELDS = {
  secretid: 'PULSE_CB_SECRET_ID',
  secretkey: 'PULSE_CB_SECRET_KEY',
  'token（临时密钥）': 'PULSE_CB_SESSION_TOKEN',
}

/**
 * 从 CLI 的表格输出里抠出字段值。
 *
 * 表格长得像（去 ANSI 之后）：
 *   │     SecretId      │  AKIDxxxx                                     │
 *   │     SecretKey     │  xxxx                                         │
 *   │ Token（临时密钥） │  xxxx                                         │
 *
 * @param {string} raw CLI 的 stdout
 * @returns {Record<string, string>} 字段名（小写）→ 值
 */
export function parseSecretsTable(raw) {
  const clean = raw.replace(/\x1b\[[0-9;]*m/g, '')
  const out = {}
  for (const line of clean.split('\n')) {
    if (!line.includes('│')) continue
    const cells = line.split('│').map((c) => c.trim())
    if (cells.length < 3) continue
    const key = cells[1].toLowerCase()
    const value = cells[2]
    if (!value) continue
    out[key] = value
  }
  return out
}

/** 取临时密钥（调用 CLI） */
export function fetchSecrets() {
  const tcb = process.env.PULSE_TCB_BIN || 'tcb'
  let raw
  try {
    raw = execFileSync(tcb, ['secrets', 'get'], {
      encoding: 'utf8',
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
    })
  } catch (err) {
    const msg = String(err?.stderr ?? err?.message ?? err).trim()
    throw new Error(
      `取临时密钥失败（${tcb} secrets get）：${msg.split('\n').slice(-3).join(' ')}\n` +
        '先确认装了 CloudBase CLI 并且已登录（tcb login）。',
    )
  }

  const table = parseSecretsTable(raw)
  const env = {}
  for (const [name, key] of Object.entries(FIELDS)) {
    if (!table[name]) {
      throw new Error(
        `临时密钥里没找到「${name}」字段 —— CLI 输出格式变了？\n` +
          `看到的字段：${Object.keys(table).join(', ') || '（一个都没有）'}`,
      )
    }
    env[key] = table[name]
  }
  return env
}

/* ------------------------------ 主流程 ------------------------------ */

function main() {
  const argv = process.argv.slice(2)
  const sep = argv.indexOf('--')
  if (sep < 0 || sep === argv.length - 1) {
    console.error(`用法：node scripts/cb-credentials.mjs -- <命令> [参数...]

例：
  node scripts/cb-credentials.mjs -- node scripts/content-publish.mjs
  node scripts/cb-credentials.mjs -- node scripts/e2e/content-pg.mjs

它会调 \`tcb secrets get\` 拿临时密钥，注入子进程的环境变量后启动命令。
ⓘ 密钥不会打印、不会写盘、也不会出现在命令行里。`)
    process.exit(1)
  }

  const cmd = argv.slice(sep + 1)
  const secretEnv = fetchSecrets()

  const env = {
    ...process.env,
    ...secretEnv,
    PULSE_CB_ENV: ENV_ID,
    // pg-admin 那套变量名也补上（同一份凭证换个叫法）
    TCLOUD_SECRET_ID: secretEnv.PULSE_CB_SECRET_ID,
    TCLOUD_SECRET_KEY: secretEnv.PULSE_CB_SECRET_KEY,
    TCLOUD_SESSION_TOKEN: secretEnv.PULSE_CB_SESSION_TOKEN,
  }

  const res = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', env, cwd: ROOT })
  if (res.error) {
    console.error(`启动失败：${res.error.message}`)
    process.exit(1)
  }
  process.exit(res.status ?? 1)
}

// ⚠️ 用**路径**比较而不是 URL 比较 —— 仓库路径里有中文，
//    import.meta.url 会把中文做百分号编码，两边编码规则不一致就永远不相等
//    （踩过：main() 静默不执行，脚本看起来「什么都不干」）。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
