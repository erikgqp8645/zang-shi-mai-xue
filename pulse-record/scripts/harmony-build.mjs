#!/usr/bin/env node
/**
 * 鸿蒙 HAP 构建 —— **一条命令**
 *
 * ## 为什么必须有这个脚本（硬约束：路径里不能有中文）
 *
 * hvigor / DevEco **不接受含中文的工程路径**：
 *
 * ```
 * ERROR: 00306003 Specification Limit Violation
 * Error Message: Invalid project path. Current path does not match: …/臧氏脉学/…
 *   > Please modify the project path to ensure that it only contains letters, digits,
 *     hyphens (-), underscores (_), periods (.), english parentheses (()), spaces, or the @ symbol
 * ```
 *
 * 而本仓库就躺在 `~/AiCoding/臧氏脉学/` 下面 —— **仓库路径本身带中文**。
 * 符号链接也绕不过：`node` 的 `process.cwd()` 会把软链解析成**真实路径**，
 * 报错里仍然是带中文的那条（实测）。
 *
 * → 所以定成：**仓库里的 `harmony/` 是工程的唯一真源**（配置与资源入库），
 * **编译时镜像到一条纯 ASCII 路径**再编。镜像目录默认 `~/AiCoding/harmony-pulse-record`。
 *
 * ## 流程
 *
 *   1. rsync 仓库的 `harmony/` → 镜像目录（**不删**镜像里多出来的文件）
 *   2. 写 `local.properties`（`sdk.dir` 指向 DevEco 自带的 SDK）
 *   3. Taro 构建：`TARO_HARMONY_PROJECT=镜像` → `.ets` 产物写进镜像
 *   4. ArkTS 严格模式补丁（上游模板的坑，见「工具函数」一节）
 *   5. rawfile 资源对齐（tabBar 图标，见「工具函数」一节）
 *   6. `ohpm install`（工程根 ＋ `entry` 模块 —— 依赖在 entry 的 oh-package 里）
 *   7. `devecocli build` —— 官方命令行工具，自己解析 DevEco 的 SDK/hvigor/JBR
 *   8. 打印 HAP 路径
 *
 * ## 为什么用 `devecocli` 而不是自己调 hvigorw
 *
 * 自己调 `hvigorw` 要手工拼三样东西：**hvigor 软链**（`@ohos/hvigor` 不在 npmjs 上）、
 * **`DEVECO_SDK_HOME`**（SDK 根目录，不是版本目录）、**`JAVA_HOME`**（打包要 Java，
 * 本机只有 DevEco 自带的 JBR）。三样缺一样就是一次编译失败。
 *
 * `devecocli build` 自己把这三样都解析好了 —— 实测**把软链移走也能构建成功**。
 * 所以这里只留一条路径，不做「两套都支持」。
 *
 * 前置条件：`npm i -g @deveco/deveco-cli@stable`（外加装了 DevEco Studio）。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/harmony-build.mjs              # 全流程
 * node scripts/harmony-build.mjs --skip-taro  # 只重编（.ets 没变时快很多）
 * ```
 *
 * 环境变量：
 *   · `PULSE_HARMONY_HOME` 镜像目录（默认 `~/AiCoding/harmony-pulse-record`）
 *   · `DEVECOCLI_PATH`     devecocli 可执行文件（默认 `devecocli`，走 PATH）
 */
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  cpSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { patchArkTsStrictMode as patchArkTsStrictModeSource } from './lib/harmony-arkts-patch.mjs'

const ROOT = resolve(join(import.meta.dirname, '..'))
const SRC = join(ROOT, 'harmony')
const DEVECO = process.env.DEVECO_HOME || '/Applications/DevEco-Studio.app'
const MIRROR = resolve(
  process.env.PULSE_HARMONY_HOME || join(homedir(), 'AiCoding', 'harmony-pulse-record'),
)
const SKIP_TARO = process.argv.includes('--skip-taro')

const OHPM = join(DEVECO, 'Contents/tools/ohpm/bin/ohpm')
const SDK_ROOT = join(DEVECO, 'Contents/sdk')
const SDK_DIR = join(SDK_ROOT, 'default')

/** 官方命令行工具（自己解析 DevEco 的 SDK / hvigor / JBR） */
const DEVECOCLI = process.env.DEVECOCLI_PATH || 'devecocli'

function fail(msg) {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env || {}) },
    shell: false,
  })
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} 退出码 ${r.status}`)
}

/* ---------- 工具函数：ArkTS 严格模式补丁 ---------- */

/**
 * 给 Taro 生成的 `app.ets` 打 ArkTS 严格模式补丁。
 *
 * 补丁逻辑（连同出处说明）在 `scripts/lib/harmony-arkts-patch.mjs`，
 * 那里是**纯函数**，可以被 `scripts/e2e/harmony-lint.mjs` 直接测。
 * 这里只负责读文件 → 调纯函数 → 写回去。
 */
function patchArkTsStrictMode(mirror) {
  const appEts = join(mirror, 'entry/src/main/ets/app.ets')
  if (!existsSync(appEts)) {
    fail(`找不到 Taro 产物：${appEts}\n  是不是漏了 Taro 构建（别用 --skip-taro）？`)
  }
  const src = readFileSync(appEts, 'utf8')
  let patched
  try {
    patched = patchArkTsStrictModeSource(src)
  } catch (e) {
    fail(`${e.message}\n  文件：${appEts}`)
  }
  if (patched === src) {
    console.log('· app.ets：ArkTS 补丁已在位（跳过）')
    return
  }
  writeFileSync(appEts, patched, 'utf8')
  console.log('· app.ets：已修补 ArkTS 严格模式（levelRes 补初值 0）')
}

/* ---------- 工具函数：rawfile 资源对齐 ---------- */

/**
 * Taro 鸿蒙编译链把 tabBar 图标发射到 **`ets/assets/`**（vite 的产物根），
 * 但 ArkUI 的 `Image('相对路径')` 找的是 **rawfile**（`resources/rawfile/`）。
 *
 * 出处（`@tarojs/vite-runner@4.3.2`）：
 * - `dist/harmony/entry.js:51` —— rawfile 目录＝`resolve(outputRoot, '..')/resources/rawfile`
 *   （`outputRoot`＝`entry/src/main/ets` ⇒ `entry/src/main/resources/rawfile` ✓）
 * - `dist/harmony/entry.js:91-113` —— tabbar 图标 `emitFile({type:'asset'})`，
 *   `fileName`＝`removePathPrefix(iconPath)`＝`assets/tabbar/cases.png`
 *   ⇒ 落在 **vite 产物根**（`ets/assets/tabbar/`），**不是 rawfile**
 *
 * 产物里 `taro_tabbar.ets` 是这样渲染的：
 *
 * ```ts
 * Image(this.tabBarCurrentIndex === index && item.selectedIconPath || item.iconPath)
 * ```
 *
 * `iconPath` 就是 `app.config.ts` 里写的 `assets/tabbar/cases.png` ——
 * 字符串相对路径 ⇒ ArkUI 按 rawfile 解析。
 *
 * 所以：**把 `ets/assets/` 整份拷到 `resources/rawfile/assets/`**，
 * 路径结构原样保留（`assets/tabbar/cases.png` ⇒ `rawfile/assets/tabbar/cases.png`）。
 *
 * 顺带把 `hands-pulse.jpg` 之类的普通资源也带过去 —— 它们同样走相对路径引用。
 *
 * 幂等：每次构建覆盖拷贝，不会残留旧文件。
 */
function syncRawfileAssets(mirror) {
  const src = join(mirror, 'entry/src/main/ets/assets')
  const dst = join(mirror, 'entry/src/main/resources/rawfile/assets')
  if (!existsSync(src)) {
    // 没有 assets 目录 = 没有 tabbar 图标 = 不需要处理（不报错）
    console.log('· ets/assets 不存在，跳过 rawfile 对齐')
    return
  }
  mkdirSync(dst, { recursive: true })
  cpSync(src, dst, { recursive: true, force: true })
  const n = readdirSync(src, { recursive: true }).filter((f) =>
    String(f).endsWith('.png'),
  ).length
  console.log(`· rawfile 资源已对齐（${n} 个 png）`)
}

/* ---------- 0. 前提检查 ---------- */
for (const [label, p] of [
  ['DevEco Studio', DEVECO],
  ['ohpm', OHPM],
  ['SDK', SDK_DIR],
  ['仓库里的鸿蒙工程', SRC],
]) {
  if (!existsSync(p)) fail(`找不到${label}：${p}`)
}
// devecocli 是 npm 全局装的，不在文件系统固定位置 → 用「能不能跑」来查
if (spawnSync(DEVECOCLI, ['--version'], { stdio: 'ignore' }).status !== 0) {
  fail(
    `跑不了 \`${DEVECOCLI}\` —— 先装官方命令行工具：\n` +
      '  npm install -g @deveco/deveco-cli@stable\n' +
      '（它自己解析 DevEco 的 SDK/hvigor/JBR，比手工调 hvigorw 稳）',
  )
}
console.log(`DevEco   ${DEVECO}`)
console.log(`SDK      ${SDK_DIR}`)
console.log(`工程真源 ${SRC}`)
console.log(`镜像目录 ${MIRROR}\n`)

/* ---------- 1. 同步到 ASCII 路径 ---------- */
mkdirSync(MIRROR, { recursive: true })
// 不加 --delete：镜像里手工加的文件保留（仓库那份才是要改的）
const excludes = [
  '--exclude', 'node_modules/',
  '--exclude', 'oh_modules/',
  '--exclude', 'entry/oh_modules/',
  '--exclude', 'entry/node_modules/',
  '--exclude', 'local.properties',
  '--exclude', '.hvigor/',
  '--exclude', 'build/',
  '--exclude', 'entry/build/',
  '--exclude', '.idea/',
]
run('rsync', ['-a', ...excludes, `${SRC}/`, `${MIRROR}/`])

// 工程级的 module.json5 实测**不生效**（编译后的 module.json 里 deviceConfig 为 null），
// 留着只会让人以为「明文 HTTP 已经配了」—— 删掉，防止它在镜像里长期躺着。
rmSync(join(MIRROR, 'module.json5'), { force: true })

console.log('· 已同步工程配置到镜像\n')

/* ---------- 2. local.properties（SDK 路径） ---------- */
writeFileSync(
  join(MIRROR, 'local.properties'),
  `# 由 scripts/harmony-build.mjs 生成（不入版本库）\nsdk.dir=${SDK_DIR}\n`,
  'utf8',
)

/* ---------- 3. Taro 构建（.ets 产物写进镜像） ---------- */
if (!SKIP_TARO) {
  // 把 ohpm 放进 PATH —— Taro 的鸿蒙插件构建时自己会调一次 `ohpm install`，
  // 找不到它就退回 `~/Library/Huawei/ohpm/bin/ohpm` 然后报错（那只是噪音，
  // 下面第 6 步还会正经装一次；但让它自己装成功更干净）。
  run('npm', ['--prefix', join(ROOT, 'taro'), 'run', 'build:harmony'], {
    cwd: ROOT,
    env: {
      TARO_HARMONY_PROJECT: MIRROR,
      PATH: `${join(DEVECO, 'Contents/tools/ohpm/bin')}:${process.env.PATH}`,
    },
  })
  console.log('\n· Taro 鸿蒙产物已写进镜像\n')
} else {
  console.log('· 跳过 Taro 构建（--skip-taro）\n')
}

/* ---------- 4. ArkTS 严格模式补丁 ---------- */
patchArkTsStrictMode(MIRROR)

/* ---------- 5. rawfile 资源对齐 ---------- */
syncRawfileAssets(MIRROR)

/* ---------- 6. ohpm install ---------- */
run(OHPM, ['install'], { cwd: MIRROR })
run(OHPM, ['install'], { cwd: join(MIRROR, 'entry') })
console.log('\n· ohpm 依赖装好\n')

/* ---------- 7. 出 HAP（devecocli 内部调 hvigor） ---------- */
run(DEVECOCLI, ['build'], { cwd: MIRROR })

/* ---------- 8. 报 HAP 位置 ---------- */
const outDir = join(MIRROR, 'entry/build/default/outputs/default')
let haps = []
try {
  haps = readdirSync(outDir).filter((f) => f.endsWith('.hap'))
} catch {
  /* 目录不在就当没出包 */
}
console.log('\n==============================')
if (haps.length) {
  console.log('✓ HAP 出好了：')
  for (const h of haps) console.log(`  ${join(outDir, h)}`)
} else {
  console.log('· 没找到 .hap —— 看上面的构建日志')
}
console.log('==============================')
