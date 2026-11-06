#!/usr/bin/env node
/**
 * CloudBase 云函数环境变量管理（本地跑，走腾讯云 CAPI）
 *
 * ## 为什么要有它
 *
 * 云函数的 `PULSE_WX_APPSECRET` 必须配好，小程序的 `wx.login → code2Session` 才能换到 openid。
 * 但配环境变量这件事有个**死结**：
 *
 *   · 走 MCP 的 `manageFunctions(action="updateFunctionConfig")` —— 密钥得作为工具参数传进去，
 *     **必然进对话上下文**（模型能看到每一个字）。
 *   · 走 CloudBase CLI 的 `tcb fn env` —— **只有 `pull`，没有 `set`**，写不进去。
 *   · 控制台手点 —— 密钥要粘到网页输入框里。
 *
 * 这个脚本是唯一一条**密钥全程不经过模型**的路：
 *
 * ```
 * .secrets/server.env  ──读──▶  进程内存  ──签名──▶  tcb CAPI
 *                                  │
 *                                  └──▶ 打印时只出「键名 + 指纹」，不出值
 * ```
 *
 * ## 用法
 *
 *     export TCLOUD_SECRET_ID=...
 *     export TCLOUD_SECRET_KEY=...
 *     export TCLOUD_SESSION_TOKEN=...      # 用临时凭证时带上
 *
 *     node scripts/cf-admin.mjs show        # 只列环境变量的键名（值一律打码）
 *     node scripts/cf-admin.mjs set-wx      # 把 .secrets 里的 AppID/secret 合并写进去
 *
 * ## 变量名用 `PULSE_WX_*` 而不是 `WX_*`
 *
 * CloudBase 运行时会用平台自己的值**盖掉** `WX_` 前缀的变量（留给微信云开发的小程序关联信息）。
 * 写进 `WX_APPID` 的值，GetFunction 读得到、运行时读不到 —— 详见 `server/wechat.mjs` 文件头。
 *
 * ## 写的时候是「读-改-写」，不是盲写
 *
 * `UpdateFunctionConfiguration` 的 `Environment.Variables` 是**整组替换**语义。
 * 直接写 `[{WX_APPSECRET}]` 会把 `PULSE_STORE=pg` 这几个**一起冲掉**，云函数当场挂。
 * 所以先 `GetFunction` 读回当前的全组，合并后再整组写回去。
 *
 * ## 密钥纪律
 *
 *   · 密钥只在 `.secrets/server.env`（已 gitignore，权限 600）
 *   · **绝不进对话、绝不进仓库、绝不进云函数代码包**
 *   · 验证配置是否生效用 `invokeFunction`（能看行为），**不要用 `GetFunction` 回读**（会把值打出来）
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { callTcb } from './lib/tcb-capi.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const ENV_ID = process.env.PULSE_ENV_ID || 'ambitious-parrot-d7ehh7x0fd9d680'
const FUNCTION_NAME = process.env.PULSE_FUNCTION_NAME || 'pulse-api'
const SECRETS_FILE = resolve(ROOT, '.secrets', 'server.env')

/* ------------------------------ 小工具 ------------------------------ */

/**
 * 解析 `KEY=VALUE` 格式的 env 文件。
 *
 * 只认 `KEY=VALUE`、忽略空行与 `#` 开头的注释；值两侧的引号会剥掉。
 * **这个函数只在本进程里跑，值不会离开进程。**
 */
export function parseEnvFile(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const i = s.indexOf('=')
    if (i <= 0) continue
    const key = s.slice(0, i).trim()
    let val = s.slice(i + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

/** 值的指纹 —— 用来确认「换没换」，但不泄露内容 */
function fingerprint(v) {
  return createHash('sha256').update(String(v)).digest('hex').slice(0, 8)
}

/* --------------------------- 环境变量读写 --------------------------- */

/**
 * 从 `GetFunction` 的返回里挖出当前的环境变量组。
 *
 * 不同版本返回的字段位置不一样，这里挨个试 —— 但**只取键名与值到进程内存**，
 * 打印时一律打码。
 */
function extractVariables(resp) {
  const candidates = [
    resp?.Environment?.Variables,
    resp?.FunctionInfo?.Environment?.Variables,
    resp?.Variables,
    resp?.FunctionConfiguration?.Environment?.Variables,
  ]
  for (const c of candidates) {
    if (Array.isArray(c)) {
      return c
        .filter((v) => v && typeof v.Key === 'string')
        .map((v) => ({ Key: v.Key, Value: String(v.Value ?? '') }))
    }
  }
  return null
}

/** 读云函数当前的环境变量组；读不到就抛错（**宁可不写，也不能盲写冲掉别的变量**） */
export async function readFunctionEnv(envId = ENV_ID, name = FUNCTION_NAME) {
  const resp = await callTcb('GetFunction', { EnvId: envId, FunctionName: name })
  const vars = extractVariables(resp)
  if (!vars) {
    throw new Error(
      'GetFunction 没返回 Environment.Variables —— 无法确认当前变量组，' +
        '为避免整组覆盖把别的变量冲掉，终止写入。' +
        `（返回的顶层字段：${Object.keys(resp ?? {}).join(', ') || '空'}）`,
    )
  }
  return { vars, resp }
}

/** 整组写回（`Environment.Variables` 是替换语义，必须给全） */
export async function writeFunctionEnv(vars, resp = {}, envId = ENV_ID, name = FUNCTION_NAME) {
  const payload = {
    EnvId: envId,
    FunctionName: name,
    Environment: { Variables: vars.map((v) => ({ Key: v.Key, Value: v.Value })) },
  }
  // **保护性回填** —— 不传就可能被重置成默认值，那会当场把云函数改挂：
  //   · 超时默认 3 秒（我们现在是 20 秒）
  //   · 内存默认 128M（我们现在是 256M）
  //   · Role 丢了就没有 PG 访问权
  // 这些值从刚才读回的 GetFunction 里取，只在确实存在时才带上。
  for (const key of ['Timeout', 'MemorySize', 'Role', 'Description', 'InstallDependency', 'InitTimeout']) {
    if (resp?.[key] !== undefined && resp?.[key] !== null && resp?.[key] !== '') {
      payload[key] = resp[key]
    }
  }
  return callTcb('UpdateFunctionConfiguration', payload)
}

/* ------------------------------ 命令 ------------------------------ */

function printVars(vars) {
  if (!vars.length) {
    console.log('  （当前没有环境变量）')
    return
  }
  for (const v of vars) {
    // 名字里带 SECRET 的**只报长度**，连指纹都不给 —— 指纹再短也是密钥的一部分信息
    if (/SECRET|TOKEN|PASSWORD|KEY/i.test(v.Key)) {
      console.log(`  ${v.Key}  值长 ${v.Value.length}  （敏感值，不出指纹）`)
    } else {
      console.log(`  ${v.Key}  值长 ${v.Value.length}  指纹 ${fingerprint(v.Value)}`)
    }
  }
}

function printConfig(resp) {
  const fields = ['Runtime', 'Handler', 'Type', 'Status', 'Timeout', 'MemorySize', 'Role', 'CodeResult']
  const parts = fields
    .filter((f) => resp?.[f] !== undefined && resp?.[f] !== null && resp?.[f] !== '')
    .map((f) => `${f}=${resp[f]}`)
  console.log('  ' + (parts.join('  ') || '（没读到配置字段）'))
}

async function cmdShow() {
  console.log(`环境 ${ENV_ID} 的云函数 ${FUNCTION_NAME}：`)
  const { vars, resp } = await readFunctionEnv()
  console.log('配置：')
  printConfig(resp)
  console.log('环境变量：')
  printVars(vars)
}

async function cmdSetWx() {
  if (!existsSync(SECRETS_FILE)) {
    throw new Error(`找不到密钥文件：${SECRETS_FILE}`)
  }
  const secrets = parseEnvFile(readFileSync(SECRETS_FILE, 'utf8'))
  const appid = secrets.WX_APPID
  const appsecret = secrets.WX_APPSECRET
  if (!appid || !appsecret) {
    throw new Error(
      `密钥文件里缺 ${!appid && 'WX_APPID'}${!appid && !appsecret ? ' / ' : ''}${!appsecret && 'WX_APPSECRET'}`,
    )
  }

  const { vars, resp } = await readFunctionEnv()
  console.log('写入前的配置：')
  printConfig(resp)
  console.log('写入前的环境变量：')
  printVars(vars)

  // 合并：同名覆盖，其余原样保留（不能丢 PULSE_STORE 等）
  const merged = new Map(vars.map((v) => [v.Key, v.Value]))
  // 用 PULSE_WX_* —— `WX_` 前缀会被 CloudBase 运行时用平台的值覆盖掉（见 server/wechat.mjs 文件头）
  merged.set('PULSE_WX_APPID', appid)
  merged.set('PULSE_WX_APPSECRET', appsecret)
  // 老的 WX_* 在运行时是**无效的**（被平台盖掉），留着只会误导 —— 删掉
  merged.delete('WX_APPID')
  merged.delete('WX_APPSECRET')
  const next = [...merged.entries()].map(([Key, Value]) => ({ Key, Value }))

  await writeFunctionEnv(next, resp)

  console.log('写入后的环境变量（值仍打码）：')
  printVars(next)

  // 写完立刻读回，确认配置没被重置、变量组是全的
  const after = await readFunctionEnv()
  console.log('写入后的配置：')
  printConfig(after.resp)
  console.log('写入后的环境变量（读回）：')
  printVars(after.vars)
  console.log(`✅ 已写入 ${next.length} 个变量到 ${FUNCTION_NAME}（WX_APPSECRET 未回显）`)
}

async function cmdSet(args) {
  if (!args.length) throw new Error('没有给 KEY=VALUE')
  const pairs = []
  for (const a of args) {
    const i = a.indexOf('=')
    if (i <= 0) throw new Error(`格式不对：${a}（要 KEY=VALUE）`)
    pairs.push([a.slice(0, i).trim(), a.slice(i + 1)])
  }
  // 防呆：敏感键名不许走命令行（会进 shell 历史 + 进程列表）—— 那些只走 set-wx
  for (const [k] of pairs) {
    if (/SECRET|TOKEN|PASSWORD|PRIVATE.?KEY/i.test(k)) {
      throw new Error(`${k} 看着像敏感值，别走命令行；用 set-wx 从 .secrets 读`)
    }
  }

  const { vars, resp } = await readFunctionEnv()
  const merged = new Map(vars.map((v) => [v.Key, v.Value]))
  for (const [k, v] of pairs) merged.set(k, v)
  const next = [...merged.entries()].map(([Key, Value]) => ({ Key, Value }))

  await writeFunctionEnv(next, resp)
  console.log('写入后的环境变量：')
  printVars(next)
}

async function main() {
  const cmd = process.argv[2]
  switch (cmd) {
    case 'show':
      await cmdShow()
      break
    case 'set-wx':
      await cmdSetWx()
      break
    case 'set':
      await cmdSet(process.argv.slice(3))
      break
    default:
      console.error('用法：node scripts/cf-admin.mjs show | set-wx | set KEY=VALUE [...]')
      process.exit(1)
  }
}

const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false
if (isMain) {
  main().catch((e) => {
    console.error(String(e?.message ?? e))
    process.exit(1)
  })
}
