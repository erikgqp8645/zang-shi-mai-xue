#!/usr/bin/env node
/**
 * 小程序端静态检查
 *
 * 小程序没有编译期检查（WXML 里写错函数名、JS 里 require 路径写错，都要到运行时才炸），
 * 这里把最容易犯的三类错提前抓住：
 *
 *   1. WXML 的 `{{ }}` 里出现函数调用 —— WXML **不支持**调用 JS 函数，
 *      必须在 JS 里预先算好放进 data。
 *   2. WXML 里绑定了事件，但对应页面 JS 里没有这个方法 —— 点了没反应。
 *   3. 页面 JS 里 require 的路径不存在 —— 页面一进就白屏。
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

const pages = walk(join(MP, 'pages'), [], (p) => p.endsWith('.js'))

console.log('\n小程序端静态检查\n')

/* ---- 1. app.json 里登记的页面都要存在 ---- */
const appJson = JSON.parse(readFileSync(join(MP, 'app.json'), 'utf8'))
const missing = appJson.pages.filter((p) => !existsSync(join(MP, p + '.js')))
ok(`app.json 登记的 ${appJson.pages.length} 个页面都在`, missing.length === 0, missing.join(', '))

/* ---- 2. 每个页面：WXML 不调函数、事件有方法、require 路径存在 ---- */
for (const jsPath of pages) {
  const dir = dirname(jsPath)
  const name = jsPath.replace(MP + '/', '')
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
    if (!/\.[a-z0-9]+$/i.test(m2[1])) noExt.push(f.replace(MP + '/', '') + ' → ' + m2[1])
  }
}
ok('共享包的相对 require 都带 .js 后缀', noExt.length === 0, noExt.slice(0, 3).join(' | '))

/* ---- 5. 页面不得出现 ES2019+ 的运行时内建（老机型 JSCore 会白屏） ---- */
const modern = []
for (const f of walk(MP, [], (p) => p.endsWith('.js') && !p.includes('/core/'))) {
  const src = readFileSync(f, 'utf8')
  if (/Object\.fromEntries\(|\.flatMap\(|\.flat\(|\.replaceAll\(|Object\.hasOwn\(/.test(src)) {
    modern.push(f.replace(MP + '/', ''))
  }
}
ok('页面代码没有用 ES2019+ 的运行时内建', modern.length === 0, modern.join(', '))

console.log(`\n共 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`)
if (failures.length) {
  console.log('失败项：')
  for (const f of failures) console.log('  · ' + f)
}
console.log('')
process.exit(fail === 0 ? 0 : 1)
