#!/usr/bin/env node
/**
 * 鸿蒙工程静态检查 —— 守住「能出 HAP」这件事
 *
 * ## 为什么要有这个检查
 *
 * 鸿蒙这条线（`harmony/` ＋ `scripts/harmony-build.mjs`）踩过的坑，
 * **每一个都是「编译期才炸、而且报错信息不指向真正原因」**：
 *
 *   ① `compatibleSdkVersion` 低于 14 → `00306004 Specification Limit Violation`
 *      （taro 的 har 声明了 `compatibleSdkVersion: 14`）
 *   ② 权限字段名写错（`reqPermissions` vs `requestPermissions`）→ schema 校验失败
 *   ③ 没声明 `ohos.permission.INTERNET` → 应用装上了但**发不出任何网络请求**
 *   ④ tabBar 图标不在 rawfile → tabBar 四个 tab 没图标（编译不报错，运行时才发现）
 *   ⑤ `srcEntry` 没指向 `./ets/app.ets` → 起来了但是个空壳
 *   ⑥ ArkTS 补丁失配（上游模板改了）→ 编译失败，报错指向 `app.ets` 而不是补丁
 *
 * 这些不该靠人肉记。所以这里把「出 HAP 之前必须成立的条件」全部写成断言，
 * 挂在 `npm test` 下面 —— 改坏工程配置时，回归立刻红。
 *
 * 用法：node scripts/e2e/harmony-lint.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  LEVEL_RES_ORIGINAL,
  LEVEL_RES_PATCHED,
  patchArkTsStrictMode,
} from '../lib/harmony-arkts-patch.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const HARMONY = join(ROOT, 'harmony')
const TARO = join(ROOT, 'taro')

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
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(title) {
  console.log(`\n${title}`)
}

/** 读一个文件；不存在返回 null */
function readOrNull(p) {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

/** json5 → JSON（去注释、去尾逗号） */
function parseJson5(text) {
  if (text == null) return null
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/,(\s*[}\]])/g, '$1')
  try {
    return JSON.parse(stripped)
  } catch (e) {
    return null
  }
}

/* ========== 1. 工程骨架 ========== */
section('1. 工程骨架')

const REQUIRED_FILES = [
  'build-profile.json5',
  'oh-package.json5',
  'hvigorfile.ts',
  'module.json5.no-such-file', // 占位：下面单独断言工程级 module.json5 不该存在
]

for (const rel of [
  'build-profile.json5',
  'oh-package.json5',
  'hvigorfile.ts',
  'hvigor/hvigor-config.json5',
  'AppScope/app.json5',
  'entry/build-profile.json5',
  'entry/oh-package.json5',
  'entry/hvigorfile.ts',
  'entry/src/main/module.json5',
  'entry/src/main/resources/base/profile/main_pages.json',
  'entry/src/main/resources/base/element/string.json',
]) {
  ok(`工程文件存在：${rel}`, existsSync(join(HARMONY, rel)))
}

/* ========== 2. SDK 版本下限 ========== */
section('2. SDK 版本下限（taro har 要求 ≥ 14）')

const buildProfile = parseJson5(readOrNull(join(HARMONY, 'build-profile.json5')))
ok('build-profile.json5 能解析', !!buildProfile)

// compatibleSdkVersion / targetSdkVersion 在 app.products[0] 里，不在 app 直接下
const product = buildProfile?.app?.products?.[0]
const compatibleSdkVersion = product?.compatibleSdkVersion
const targetSdkVersion = product?.targetSdkVersion
ok('build-profile.json5 能解析', !!buildProfile)
ok(
  'compatibleSdkVersion 存在',
  typeof compatibleSdkVersion === 'string' && compatibleSdkVersion.length > 0,
  `实际：${JSON.stringify(compatibleSdkVersion)}`,
)
ok(
  'targetSdkVersion 存在',
  typeof targetSdkVersion === 'string' && targetSdkVersion.length > 0,
  `实际：${JSON.stringify(targetSdkVersion)}`,
)

// 「5.0.0(12)」→ 12；「6.0.0(20)」→ 20
function sdkMajor(v) {
  if (typeof v !== 'string') return NaN
  const m = v.match(/\((\d+)\)/)
  if (m) return Number(m[1])
  const parts = v.split('.').map(Number)
  return parts[0]
}
const major = sdkMajor(compatibleSdkVersion)
ok(
  'compatibleSdkVersion ≥ 14（taro 的 har 声明 compatibleSdkVersion: 14）',
  Number.isFinite(major) && major >= 14,
  `实际：${compatibleSdkVersion}（${major}）`,
)

/* ========== 3. 权限 ========== */
section('3. 权限（不声明 INTERNET = 应用没有任何网络能力）')

const moduleJson5 = readOrNull(join(HARMONY, 'entry/src/main/module.json5'))
const moduleJson = parseJson5(moduleJson5)
ok('entry/src/main/module.json5 能解析', !!moduleJson)

// 字段名：API 20+ 的 schema 用 `requestPermissions`；写 `reqPermissions` 会被 schema 校验拦下
ok(
  '权限字段用 requestPermissions（reqPermissions 会被 schema 校验拦下）',
  Array.isArray(moduleJson?.module?.requestPermissions),
  '实际字段：' +
    JSON.stringify(
      Object.keys(moduleJson?.module || {}).filter((k) => /[Pp]ermission/.test(k)),
    ),
)

const perms = moduleJson?.module?.requestPermissions || []
ok(
  '声明了 ohos.permission.INTERNET',
  perms.some((p) => p?.name === 'ohos.permission.INTERNET'),
  '实际：' + JSON.stringify(perms.map((p) => p?.name)),
)

const internet = perms.find((p) => p?.name === 'ohos.permission.INTERNET')
ok(
  'INTERNET 权限带 reason（申请时要给用户看）',
  typeof internet?.reason === 'string' && internet.reason.length > 0,
  `实际：${JSON.stringify(internet?.reason)}`,
)

/* ========== 4. 明文 HTTP ========== */
section('4. 明文 HTTP（后端是局域网 http://）')

const metadata = moduleJson?.module?.metadata || []
const cleartext = metadata.find((m) => m?.name === 'ohos.net.http.cleartextTraffic')
ok(
  'module.metadata 里开了 ohos.net.http.cleartextTraffic',
  String(cleartext?.value) === 'true',
  `实际：${JSON.stringify(cleartext)}`,
)

/* ========== 5. 入口与路由 ========== */
section('5. 入口与路由（Taro 产物接管 EntryAbility）')

const ability = moduleJson?.module?.abilities?.[0]
ok('abilities[0] 存在', !!ability)
ok(
  'srcEntry 指向 ./ets/app.ets（Taro 生成的 app.ets 就是 EntryAbility）',
  ability?.srcEntry === './ets/app.ets',
  `实际：${ability?.srcEntry}`,
)
ok('mainElement 与 ability name 一致', moduleJson?.module?.mainElement === ability?.name)

const mainPagesText = readOrNull(
  join(HARMONY, 'entry/src/main/resources/base/profile/main_pages.json'),
)
let mainPages = []
try {
  // main_pages.json 的结构是 `{ "src": [...], "window": {...} }`
  mainPages = JSON.parse(mainPagesText)?.src
  if (!Array.isArray(mainPages)) mainPages = []
} catch {
  /* 下面断言会红 */
}
ok('main_pages.json 能解析出 src 数组', Array.isArray(mainPages) && mainPages.length > 0)
ok(
  'main_pages.json 含 taro_tabbar（tabBar 首页）',
  mainPages.includes('taro_tabbar'),
  `实际：${JSON.stringify(mainPages)}`,
)
for (const p of ['pages/case-detail/index', 'pages/login/index', 'pages/privacy/index']) {
  ok(`main_pages.json 含 ${p}`, mainPages.includes(p), `实际：${JSON.stringify(mainPages)}`)
}

/* ========== 6. har 依赖 ========== */
section('6. har 依赖（@taro-oh/library）')

const entryOhPackage = parseJson5(readOrNull(join(HARMONY, 'entry/oh-package.json5')))
const dep = entryOhPackage?.dependencies?.['@taro-oh/library']
ok('entry/oh-package.json5 声明了 @taro-oh/library', typeof dep === 'string', `实际：${dep}`)
ok(
  '依赖指向 static/@taro-oh/library-*.har',
  typeof dep === 'string' && dep.includes('library-') && dep.endsWith('.har'),
  `实际：${dep}`,
)

/* ========== 7. tabBar 图标 ↔ rawfile ========== */
section('7. tabBar 图标（ArkUI 的相对路径 Image 取 rawfile，不是 ets/assets）')

const appConfigText = readOrNull(join(TARO, 'src/app.config.ts'))
ok('taro/src/app.config.ts 存在', !!appConfigText)

// 注意大小写：配置里是 `iconPath` 与 `selectedIconPath`（后者大写 I），
// 用 `[^a-zA-Z]` 左边界才不会漏掉 selectedIconPath。
const iconPaths = [
  ...[...(appConfigText || '').matchAll(/(?:^|[^a-zA-Z])iconPath:\s*'([^']+)'/g)].map((m) => m[1]),
  ...[...(appConfigText || '').matchAll(/selectedIconPath:\s*'([^']+)'/g)].map((m) => m[1]),
]
ok(
  'app.config.ts 里配了 8 个 tabBar 图标（4 tab × 普通/选中）',
  iconPaths.length === 8,
  `实际：${iconPaths.length}（${iconPaths.join(', ')}）`,
)

for (const rel of iconPaths) {
  ok(`图标源存在：taro/src/${rel}`, existsSync(join(TARO, 'src', rel)))
}

// 构建脚本里必须有一份「ets/assets → resources/rawfile/assets」的同步。
// 断言查的是**调用点**（`syncRawfileAssets(MIRROR)`）而不是函数名 ——
// 只查函数名的话，把调用删掉也照样通过（这个坑真的踩过一次）。
const buildScript = readOrNull(join(ROOT, 'scripts/harmony-build.mjs')) || ''
ok(
  'harmony-build.mjs 里真的调用了 rawfile 资源对齐',
  buildScript.includes('syncRawfileAssets(MIRROR)'),
)
ok(
  'harmony-build.mjs 的对齐目标在 resources/rawfile/assets',
  buildScript.includes('resources/rawfile/assets'),
)

/* ========== 8. ArkTS 补丁（纯函数，直接测） ========== */
section('8. ArkTS 严格模式补丁')

const UPSTREAM = `export default class EntryAbility extends UIAbility {
  onMemoryLevel(level: AbilityConstant.MemoryLevel) {
    let levelRes: number

    switch (level) {
      case AbilityConstant.MemoryLevel.MEMORY_LEVEL_MODERATE:
        levelRes = 5
        break
    }

    if (levelRes) {
      hooks.call('getMemoryLevel', { level: levelRes })
    }
  }
}
`

const patched = patchArkTsStrictMode(UPSTREAM)
ok('补丁把 levelRes 补上了初值', patched.includes(LEVEL_RES_PATCHED))
ok('补丁后不再有裸声明', !patched.includes('\n    let levelRes: number\n'))
ok('补丁只动 levelRes 一处（switch/case 原样保留）', patched.includes('levelRes = 5'))

ok('补丁是幂等的（再打一次结果不变）', patchArkTsStrictMode(patched) === patched)

let threw = false
try {
  patchArkTsStrictMode('export default class EntryAbility {}')
} catch {
  threw = true
}
ok('模板变了会抛错（不静默放过）', threw)

let threw2 = false
try {
  patchArkTsStrictMode(null)
} catch {
  threw2 = true
}
ok('非字符串入参会抛错', threw2)

ok(
  'harmony-build.mjs 用了这个纯函数（不是自己另写一份）',
  buildScript.includes('harmony-arkts-patch.mjs'),
)

/* ========== 9. 产物不入库 ========== */
section('9. 产物不入库')

const harmonyIgnore = readOrNull(join(HARMONY, '.gitignore')) || ''
for (const rule of ['/entry/src/main/ets', '/entry/oh_modules', '/entry/build', '/build']) {
  ok(`harmony/.gitignore 含 ${rule}`, harmonyIgnore.includes(rule))
}

// 产物目录里确实不该有入库的东西
const etsDir = join(HARMONY, 'entry/src/main/ets')
ok('仓库里没有 entry/src/main/ets（Taro 产物目录不入库）', !existsSync(etsDir))

/* ========== 10. 路径约束（中文路径编译不了） ========== */
section('10. 路径约束（hvigor 拒绝含中文的工程路径）')

ok(
  '仓库根路径确实含中文 —— 这就是必须镜像到 ASCII 路径的原因',
  /[^\x00-\x7F]/.test(ROOT),
  `实际：${ROOT}`,
)

ok(
  'harmony-build.mjs 有 ASCII 镜像目录机制',
  buildScript.includes('PULSE_HARMONY_HOME') && buildScript.includes('rsync'),
)

/* ========== 汇总 ========== */
console.log(`\n${'─'.repeat(50)}`)
console.log(`鸿蒙工程检查：${pass} 通过，${fail} 失败`)
if (fail) {
  console.log('\n失败项：')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log('✓ 全部通过')
