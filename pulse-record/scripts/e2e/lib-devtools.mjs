#!/usr/bin/env node
/**
 * 模拟器回归的公共工具 —— 重启小程序 ＋ 等待端口
 *
 * ## 为什么每次都要重启（实测踩过的坑）
 *
 * 小程序的 JS bundle 在**服务上下文**里是缓存的：
 * `reLaunch` 只换页面，**不重新 require 产物**。
 * 所以改完代码重新构建之后，模拟器里跑的**还是旧产物** ——
 *
 *   · 写坏验证时，故意让出图失败的代码已经进了产物，回归却**全绿**（跑的是旧 bundle）；
 *   · 重跑一次 `cli auto`（＝重启小程序）之后，同一份回归**立刻报红** ✅。
 *
 * → 所以所有模拟器回归都**必须先重启小程序**，否则测的是一个不存在的产物。
 *
 * ## 另一个坑：IDE 服务端口会变
 *
 * 开发者工具的 IDE 服务端口不是固定的（实测 45820 → 23211）。
 * 所以这里调 CLI 时**不带 `--port`** —— 让它自己找当前的 IDE 服务。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(join(import.meta.dirname, '../..'))

/**
 * 找微信开发者工具的 CLI —— **按平台找**。
 *
 * ## 为什么不能只写 Windows 路径
 *
 * 原来这里硬编码 `C:/Program Files (x86)/.../cli.bat`，在 macOS 上
 * `existsSync` 恒为 false → `rearm()` **直接跳过重启** → 模拟器回归
 * 测的是**旧 bundle**（小程序 JS bundle 在服务上下文里是缓存的，`reLaunch` 不重新 require）。
 * 而这个文件自己的注释写着「所有模拟器回归都**必须先重启小程序**，否则测的是一个不存在的产物」——
 * 在 macOS 上那条纪律**根本没生效**，而且是**静默**失效：
 * 故意写坏的代码进了产物，回归照样全绿。
 *
 * → 现在按平台各给一条路径；`MP_SIM_CLI` 环境变量仍可覆盖。
 */
function findCli() {
  if (process.env.MP_SIM_CLI) return process.env.MP_SIM_CLI
  if (process.platform === 'win32') return 'C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat'
  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
      '/Applications/微信开发者工具.app/Contents/MacOS/cli',
    ]
    return candidates.find((c) => existsSync(c)) ?? candidates[0]
  }
  return 'cli'
}

/** 微信开发者工具的 CLI */
export const CLI = findCli()

/** 小程序工程目录（Taro 的 dist 由它当小程序根目录） */
export const TARO = join(ROOT, 'taro')

/**
 * 重新拉起自动化端口 —— **顺带把小程序重启一遍**。
 *
 * @returns {boolean} 是否重启成功（失败不致命，调用方照常往下走）
 */
export function rearm() {
  if (!existsSync(CLI)) {
    console.log(`  · 找不到开发者工具 CLI（${CLI}）—— 跳过重启`)
    return false
  }
  const port = Number((process.env.MP_SIM_WS ?? 'ws://127.0.0.1:9420').split(':').pop()) || 9420
  const args = ['auto', '--project', TARO, '--auto-port', String(port), '--trust-project']
  // Windows 的 CLI 是 .bat，必须经 cmd.exe 跑；macOS/Linux 上那个是可执行文件，直接跑
  const cmd = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : CLI
  const argv =
    process.platform === 'win32' ? ['/d', '/c', CLI, ...args] : args
  const r = spawnSync(cmd, argv, { encoding: 'utf8', timeout: 180000 })
  const good = r.status === 0
  console.log(good ? '  · 已重启小程序（确保跑的是当前产物）' : '  · 重启失败，继续用现有实例')
  if (!good && r.stderr) console.log(String(r.stderr).trim().split('\n').slice(-3).join('\n'))
  return good
}

/** 每步都带超时 —— automator 的调用在环境不满足时会一直挂着 */
export function withTimeout(promise, ms, tag) {
  let timer
  const guard = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${tag} 超时 ${ms}ms`)), ms)
  })
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer))
}

/**
 * 连自动化端口 —— **轮询着连**（刚重启时端口要等一会儿才起来）。
 * 连不上返回 null（调用方按「环境没就绪 → 跳过」处理）。
 */
export async function connect(automator, ws, tries = 12) {
  for (let i = 0; i < tries; i++) {
    try {
      return await withTimeout(automator.connect({ wsEndpoint: ws }), 15000, 'connect')
    } catch {
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
  return null
}
