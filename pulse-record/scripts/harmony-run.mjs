#!/usr/bin/env node
/**
 * 鸿蒙部署 —— 把 HAP 装到设备（模拟器或真机）上，并截图
 *
 * ## 与 `harmony-build.mjs` 的分工
 *
 *   · `harmony-build.mjs` —— **出包**（Taro 构建 → 补丁 → ohpm → devecocli build）
 *   · `harmony-run.mjs`    —— **部署**（签名 → 起模拟器 → 装机 → 截图）
 *
 * 拆成两个是因为**签名要登录**：出包不需要账号，部署需要。
 *
 * ## 前置（两条都要）
 *
 *   1. `npm i -g @deveco/deveco-cli@stable` —— 官方命令行工具
 *   2. `devecocli auth login` —— **必须登录**：签名材料是向华为服务器申请的，
 *      模拟器的设备身份（SN）也要登录后才签发。
 *      没登录时 `devecocli signature generate` 直接报
 *      `Failed to automatically generate signatures.Run devecocli auth login to sign in.`
 *
 * ## 用法
 *
 * ```bash
 * node scripts/harmony-run.mjs doctor     # 只体检：登录状态 / 镜像 / 实例 / 设备
 * node scripts/harmony-run.mjs emulator   # 确保镜像与实例就位，并启动模拟器
 * node scripts/harmony-run.mjs deploy     # 签名 → 构建 → 装机 → 截图
 * node scripts/harmony-run.mjs            # 全流程（doctor → emulator → deploy）
 * ```
 *
 * ## 一条命令跑完
 *
 * ```bash
 * node scripts/harmony-run.mjs --download   # 顺便把模拟器镜像下了（几个 G）
 * ```
 *
 * 环境变量：
 *   · `PULSE_HARMONY_HOME` 镜像目录（默认 `~/AiCoding/harmony-pulse-record`）
 *   · `PULSE_EMULATOR_NAME` 模拟器实例名（默认 `pulse_phone`）
 *   · `PULSE_OS_VERSION`    模拟器系统版本（默认 `HarmonyOS 7.0.0(26.0.0)`）
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(join(import.meta.dirname, '..'))
const MIRROR = resolve(
  process.env.PULSE_HARMONY_HOME || join(homedir(), 'AiCoding', 'harmony-pulse-record'),
)
const EMU_NAME = process.env.PULSE_EMULATOR_NAME || 'pulse_phone'
const OS_VERSION = process.env.PULSE_OS_VERSION || 'HarmonyOS 7.0.0(26.0.0)'
const DEVICE_TYPE = 'phone'

const DEVECOCLI = process.env.DEVECOCLI_PATH || 'devecocli'
const SHOT_DIR = process.env.PULSE_SHOT_DIR || '/tmp/harmony-shots'

const argv = process.argv.slice(2)
const WANT_DOWNLOAD = argv.includes('--download')
const MODE =
  argv.find((a) => !a.startsWith('-')) || 'all'

function fail(msg) {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

/** 跑 devecocli，返回 stdout（失败时返回 null） */
function cli(args, opts = {}) {
  const r = spawnSync(DEVECOCLI, args, {
    cwd: opts.cwd || MIRROR,
    encoding: 'utf8',
    shell: false,
  })
  const out = `${r.stdout || ''}${r.stderr || ''}`
  if (r.status !== 0 && !opts.allowFail) {
    fail(`\`${DEVECOCLI} ${args.join(' ')}\` 失败：\n${out.trim()}`)
  }
  return { ok: r.status === 0, out }
}

/**
 * 从 `devecocli device list` 的输出里抠出在线设备的 serial。
 *
 * 之前用 `/^\S+\s+\S+/m` 判断，结果**匹配到了那行提示文字**
 * （「Connect a USB device with debugging enabled, or start an emulator with …」
 * —— 它当然也是「两个词以上」）→ 没设备也报「在线 ✓」。
 * 现在只认 serial 格式：`127.0.0.1:<port>` / `emulator-xxxx` / `localhost:<port>`。
 */
function onlineSerials(devsOut) {
  const out = []
  const re = /(?:^|[\s(])((?:127\.0\.0\.1|localhost|emulator)[\w.-]*:\d+)/g
  let m
  while ((m = re.exec(devsOut)) !== null) out.push(m[1])
  return [...new Set(out)]
}

/* ---------- doctor ---------- */

function doctor() {
  console.log('=== 体检 ===')

  if (!existsSync(MIRROR)) {
    fail(`镜像工程不存在：${MIRROR}\n  先跑 node scripts/harmony-build.mjs`)
  }
  console.log(`· 镜像工程   ${MIRROR}`)

  if (spawnSync(DEVECOCLI, ['--version'], { stdio: 'ignore' }).status !== 0) {
    fail(`跑不了 \`${DEVECOCLI}\` —— 先装：npm install -g @deveco/deveco-cli@stable`)
  }
  console.log(`· devecocli  ${DEVECOCLI}（${cli(['--version']).out.trim()}）`)

  const auth = cli(['auth', 'status']).out
  const loggedIn = !/Not logged in/i.test(auth)
  console.log(`· 登录       ${loggedIn ? '✓ 已登录' : '✗ 未登录'}`)
  if (!loggedIn) {
    console.log(
      '\n  ⚠️  未登录 —— **签名**和**模拟器设备身份**都要登录后才签发。\n' +
        '     请在自己的终端里跑（它要按 Enter 打开浏览器）：\n\n' +
        '         devecocli auth login\n',
    )
  }

  const images = cli(['emulator', 'image', 'list'], { allowFail: true }).out
  const hasImage = images.includes(OS_VERSION)
  console.log(`· 镜像       ${hasImage ? `✓ ${OS_VERSION}` : `✗ 没下 ${OS_VERSION}`}`)
  if (!hasImage) {
    console.log(
      `     下载：${DEVECOCLI} emulator image download --device-type ${DEVICE_TYPE} --os-version "${OS_VERSION}"\n`,
    )
  }

  const emus = cli(['emulator', 'list'], { allowFail: true }).out
  const hasEmu = new RegExp(`^${EMU_NAME}\\s`, 'm').test(emus)
  console.log(`· 模拟器实例 ${hasEmu ? `✓ ${EMU_NAME}` : `✗ 没有 ${EMU_NAME}`}`)
  if (!hasEmu) {
    console.log(
      `     创建：${DEVECOCLI} emulator create ${EMU_NAME} --device-type ${DEVICE_TYPE} --os-version "${OS_VERSION}"\n`,
    )
  }

  const devices = cli(['device', 'list'], { allowFail: true }).out
  const serials = onlineSerials(devices)
  console.log(`· 在线设备   ${serials.length ? `✓ ${serials.join(', ')}` : '（暂无）'}`)

  return { loggedIn, hasImage, hasEmu, online: serials.length > 0 }
}

/* ---------- emulator ---------- */

function ensureImage() {
  const images = cli(['emulator', 'image', 'list'], { allowFail: true }).out
  if (images.includes(OS_VERSION)) {
    console.log(`· 镜像已就位（${OS_VERSION}）`)
    return
  }
  console.log(`· 下载镜像 ${OS_VERSION}（几个 G，慢慢等）…`)
  cli(['emulator', 'image', 'download', '--device-type', DEVICE_TYPE, '--os-version', OS_VERSION])
  console.log('· 镜像下好了')
}

function ensureInstance() {
  const emus = cli(['emulator', 'list'], { allowFail: true }).out
  if (!new RegExp(`^${EMU_NAME}\\s`, 'm').test(emus)) {
    console.log(`· 创建模拟器实例 ${EMU_NAME}…`)
    cli(['emulator', 'create', EMU_NAME, '--device-type', DEVICE_TYPE, '--os-version', OS_VERSION])
  } else {
    console.log(`· 模拟器实例 ${EMU_NAME} 已存在`)
  }
}

function startEmulator() {
  const devs = cli(['device', 'list'], { allowFail: true }).out
  if (onlineSerials(devs).length) {
    console.log('· 模拟器已经在跑')
    return
  }
  console.log(`· 启动模拟器 ${EMU_NAME}…`)
  const r = cli(['emulator', 'start', EMU_NAME], { allowFail: true })
  if (!r.ok) console.log(`  （${r.out.trim().split('\n').slice(-1)[0]}）`)
  // 等它进 hdc 设备列表
  for (let i = 0; i < 60; i++) {
    const devs = cli(['device', 'list'], { allowFail: true }).out
    if (onlineSerials(devs).length) {
      console.log('· 模拟器已上线')
      return
    }
    spawnSync('sleep', ['3'])
  }
  console.log('· 模拟器启动超时了 —— 看 `devecocli device list` 和实例的 Log/Emulator.log')
}

/* ---------- deploy ---------- */

function sign() {
  console.log('· 生成签名…')
  const r = cli(['signature', 'generate'], { allowFail: true })
  if (!r.ok) {
    if (/auth login/i.test(r.out)) {
      fail(
        '签名要登录。请在自己的终端里跑：\n\n' +
          '    devecocli auth login\n\n' +
          '（它会提示「Press Enter to open browser」—— 按回车，浏览器里确认授权）',
      )
    }
    fail(`签名失败：\n${r.out.trim()}`)
  }
  console.log('· 签名好了')
}

function build() {
  console.log('· 构建（含签名）…')
  const r = spawnSync('node', [join(ROOT, 'scripts/harmony-build.mjs'), '--skip-taro'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
  })
  if (r.status !== 0) fail('构建失败')
}

function deploy() {
  sign()
  build()

  const devs = cli(['device', 'list'], { allowFail: true }).out
  const serial = onlineSerials(devs)[0]
  if (!serial) {
    fail(`没有在线设备 —— 先起模拟器：\n  ${DEVECOCLI} emulator start ${EMU_NAME}`)
  }
  console.log(`· 装机到 ${serial}…`)
  cli(['run', '--device', serial, '--build-mode', 'debug'])
  console.log('· 装好了')
}

function shoot(tag) {
  mkdirSync(SHOT_DIR, { recursive: true })
  const p = join(SHOT_DIR, `${tag}.png`)
  const r = cli(['ui', 'screenshot', '--save', p], { allowFail: true })
  if (!r.ok) {
    console.log(`· 截图失败：${r.out.trim().split('\n').slice(-2).join(' ')}`)
    return null
  }
  console.log(`· 截图 ${p}`)
  return p
}

/* ---------- 主流程 ---------- */

console.log(`模式：${MODE}\n`)

if (MODE === 'doctor') {
  doctor()
} else if (MODE === 'emulator') {
  if (WANT_DOWNLOAD) ensureImage()
  ensureInstance()
  startEmulator()
  shoot('emulator-up')
} else if (MODE === 'deploy') {
  deploy()
  shoot('after-deploy')
} else {
  // all
  const st = doctor()
  if (WANT_DOWNLOAD) ensureImage()
  ensureInstance()
  startEmulator()
  if (!st.loggedIn) {
    console.log(
      '\n✗ 还没登录 —— 部署到此为止。\n' +
        '  在你自己的终端跑：devecocli auth login\n' +
        '  完成后回来跑：node scripts/harmony-run.mjs deploy\n',
    )
    process.exit(1)
  }
  deploy()
  shoot('after-deploy')
}
