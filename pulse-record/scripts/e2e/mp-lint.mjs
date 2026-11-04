#!/usr/bin/env node
/**
 * 小程序端静态检查
 *
 * 小程序没有编译期检查（WXML 里写错函数名、JS 里 require 路径写错，都要到运行时才炸），
 * 这里把最容易犯的几类错提前抓住：
 *
 *   1. WXML 的 `{{ }}` 里出现函数调用 —— WXML **不支持**调用 JS 函数，
 *      必须在 JS 里预先算好放进 data。
 *   2. WXML 里绑定了事件，但对应页面 JS 里没有这个方法 —— 点了没反应。
 *   3. 页面 JS 里 require 的路径不存在 —— 页面一进就白屏。
 *   4. 共享包没编译、相对 require 少了 .js 后缀 —— 运行时才炸。
 *   5. 用了老机型 JSCore 没有的 ES2019+ 运行时内建 —— 白屏。
 *   6. 出图链路传错底图对象、用了已弃用的 wx.getSystemInfoSync ——
 *      这类是**静默失败**：页面看着像「图还没生成」，不翻 console 发现不了。
 *
 * 用法：node scripts/e2e/mp-lint.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const MP = join(ROOT, 'miniprogram')

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
}

/** 递归找文件 */
function walk(dir, out = [], filter = () => true) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out, filter)
    else if (filter(p)) out.push(p)
  }
  return out
}

/**
 * 路径转成 POSIX 写法（统一用 `/`）。
 *
 * join() 在 Windows 上拼的是 `\`，直接拿路径去判断「在不在 /core/ 目录里」
 * 会失效 —— 本脚本早先按 macOS 写的，换到 Windows 上跑时
 * 「排除共享包」那条规则会失效，把 core/ 里的编译产物当成小程序页面代码来查。
 */
function toPosix(p) {
  return p.replace(/\\/g, '/')
}

const pages = walk(join(MP, 'pages'), [], (p) => p.endsWith('.js'))

console.log('\n小程序端静态检查\n')

/* ---- 1. app.json 里登记的页面都要存在 ---- */
const appJson = JSON.parse(readFileSync(join(MP, 'app.json'), 'utf8'))
const missing = appJson.pages.filter((p) => !existsSync(join(MP, p + '.js')))
ok(`app.json 登记的 ${appJson.pages.length} 个页面都在`, missing.length === 0, missing.join(', '))

/* ---- 2. 每个页面：WXML 不调函数、事件有方法、require 路径存在 ---- */
for (const jsPath of pages) {
  const dir = dirname(jsPath)
  const name = toPosix(jsPath).replace(toPosix(MP) + '/', '')
  const wxmlPath = jsPath.replace(/\.js$/, '.wxml')
  const js = readFileSync(jsPath, 'utf8')

  // --- 2a. WXML 里不得在 {{ }} 中调用函数 ---
  let fnCalls = []
  if (existsSync(wxmlPath)) {
    const wxml = readFileSync(wxmlPath, 'utf8')
    const blocks = wxml.match(/\{\{[\s\S]*?\}\}/g) || []
    for (const b of blocks) {
      // 去掉字符串字面量后再找「标识符(」
      const stripped = b.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
      const m = stripped.match(/\b[A-Za-z_$][\w$]*\s*\(/)
      if (m) fnCalls.push(m[0].trim())
    }
  }
  ok(`${name}：WXML 里没有在 {{ }} 中调用函数`, fnCalls.length === 0, fnCalls.join(', '))

  // --- 2b. 绑定的事件都要有对应方法 ---
  const methods = new Set()
  const re = /^\s{2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/gm
  let m
  while ((m = re.exec(js)) !== null) methods.add(m[1])

  const handlers = new Set()
  if (existsSync(wxmlPath)) {
    const wxml = readFileSync(wxmlPath, 'utf8')
    const hre = /(?:bind|catch)[a-zA-Z]+=["']([A-Za-z_$][\w$]*)["']/g
    let h
    while ((h = hre.exec(wxml)) !== null) handlers.add(h[1])
  }
  const noMethod = [...handlers].filter((h) => !methods.has(h))
  ok(`${name}：绑定的 ${handlers.size} 个事件都有对应方法`, noMethod.length === 0, noMethod.join(', '))

  // --- 2c. require 的路径都得存在 ---
  const reqRe = /require\(['"]([^'"]+)['"]\)/g
  const badReq = []
  let r
  while ((r = reqRe.exec(js)) !== null) {
    const spec = r[1]
    if (!spec.startsWith('.')) continue
    const target = resolve(dir, spec)
    if (!existsSync(target)) badReq.push(spec)
  }
  ok(`${name}：require 的相对路径都存在`, badReq.length === 0, badReq.join(', '))
}

/* ---- 3. 共享包必须已编译 ---- */
const coreDir = join(MP, 'utils/core')
const coreFiles = existsSync(coreDir)
  ? walk(coreDir, [], (p) => p.endsWith('.js'))
  : []
ok('共享包已编译（miniprogram/utils/core）', coreFiles.length > 0, '先跑 npm run build:core')
ok(
  '共享包里有 domain 与 export 两个目录',
  existsSync(join(coreDir, 'domain')) && existsSync(join(coreDir, 'export')),
)

/* ---- 4. 相对 require 都要带 .js 后缀（小程序运行时不做容错） ---- */
const noExt = []
for (const f of coreFiles) {
  const src = readFileSync(f, 'utf8')
  const re = /require\(['"](\.\.?\/[^'"]+)['"]\)/g
  let m2
  while ((m2 = re.exec(src)) !== null) {
    if (!/\.[a-z0-9]+$/i.test(m2[1])) noExt.push(toPosix(f).replace(toPosix(MP) + '/', '') + ' → ' + m2[1])
  }
}
ok('共享包的相对 require 都带 .js 后缀', noExt.length === 0, noExt.slice(0, 3).join(' | '))

/* ---- 5. 页面不得出现 ES2019+ 的运行时内建（老机型 JSCore 会白屏） ---- */
const modern = []
for (const f of walk(MP, [], (p) => p.endsWith('.js') && !toPosix(p).includes('/core/'))) {
  const src = readFileSync(f, 'utf8')
  if (/Object\.fromEntries\(|\.flatMap\(|\.flat\(|\.replaceAll\(|Object\.hasOwn\(/.test(src)) {
    modern.push(toPosix(f).replace(toPosix(MP) + '/', ''))
  }
}
ok('页面代码没有用 ES2019+ 的运行时内建', modern.length === 0, modern.join(', '))

/* ---- 6. 出图链路：底图必须传真图片对象；不得用已弃用的 wx.getSystemInfoSync ---- */
const mpJsFiles = walk(MP, [], (p) => p.endsWith('.js') && !toPosix(p).includes('/core/'))
const placeholderDiagram = []
const deprecatedSysInfo = []
for (const f of mpJsFiles) {
  const src = readFileSync(f, 'utf8')
  const rel = toPosix(f).replace(toPosix(MP) + '/', '')
  // planDiagram 的第一个参数必须是**真图片**（小程序侧 canvas.createImage() 出来的对象）。
  // 传 { width, height } 这种尺寸占位对象，drawImage 会抛 TypeError：
  // 表格和寸关尺图示一个都画不出来，tempFilePath 永远是空的，
  // 而页面只在 console 里留一条异常，业务上看不出来 —— 只当「图还没生成」。
  if (/planDiagram\(\s*\{/.test(src)) placeholderDiagram.push(rel)
  // wx.getSystemInfoSync 已被官方弃用（真机 console 会一直告警），取像素比用 wx.getDeviceInfo。
  if (/wx\.getSystemInfoSync\s*\(/.test(src)) deprecatedSysInfo.push(rel)
}
ok('planDiagram 的底图参数是真图片对象（不是尺寸占位）', placeholderDiagram.length === 0, placeholderDiagram.join(', '))
ok('页面没有用已弃用的 wx.getSystemInfoSync', deprecatedSysInfo.length === 0, deprecatedSysInfo.join(', '))

console.log(`\n共 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`)
if (failures.length) {
  console.log('失败项：')
  for (const f of failures) console.log('  · ' + f)
}
console.log('')
process.exit(fail === 0 ? 0 : 1)
