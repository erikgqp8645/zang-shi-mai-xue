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
 *   7. 体例（7 脉点 / 9 行）只能有一个真源 —— 录入页切换体例必须**立刻落库**，
 *      且两处都要把当前体例显示出来，否则同一位患者在「记录表」与「录入记录」
 *      里会显示出不同的行数（这是 2026-11-05 实际发生过的现象）。
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

/* ---- 2d. 自定义组件：同样查「WXML 调函数」「事件没方法」「require 路径不存在」 ----
 * 组件的方法在 methods 里缩进 4 格（页面是 2 格），所以单独用一套正则。 */
const components = walk(join(MP, 'components'), [], (p) => p.endsWith('.js'))
for (const jsPath of components) {
  const dir = dirname(jsPath)
  const name = toPosix(jsPath).replace(toPosix(MP) + '/', '')
  const wxmlPath = jsPath.replace(/\.js$/, '.wxml')
  const js = readFileSync(jsPath, 'utf8')

  if (existsSync(wxmlPath)) {
    const wxml = readFileSync(wxmlPath, 'utf8')
    const blocks = wxml.match(/\{\{[\s\S]*?\}\}/g) || []
    const fnCalls = []
    for (const b of blocks) {
      const stripped = b.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
      const m = stripped.match(/\b[A-Za-z_$][\w$]*\s*\(/)
      if (m) fnCalls.push(m[0].trim())
    }
    ok(`${name}：WXML 里没有在 {{ }} 中调用函数`, fnCalls.length === 0, fnCalls.join(', '))

    // methods 里的方法名（4 格缩进，形如 `    onCellTap(e) {`）
    const methods = new Set()
    const re = /^\s{4}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm
    let m
    while ((m = re.exec(js)) !== null) methods.add(m[1])

    const handlers = new Set()
    const hre = /(?:bind|catch)[a-zA-Z]+=["']([A-Za-z_$][\w$]*)["']/g
    let h
    while ((h = hre.exec(wxml)) !== null) handlers.add(h[1])
    const noMethod = [...handlers].filter((x) => !methods.has(x))
    ok(`${name}：绑定的 ${handlers.size} 个事件都有对应方法`, noMethod.length === 0, noMethod.join(', '))
  }

  const reqRe = /require\(['"]([^'"]+)['"]\)/g
  const badReq = []
  let r
  while ((r = reqRe.exec(js)) !== null) {
    const spec = r[1]
    if (!spec.startsWith('.')) continue
    if (!existsSync(resolve(dir, spec))) badReq.push(spec)
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

/* ---- 7. 体例只有一个真源：切换即落库，两处都显示 ---- */
const recordJs = readFileSync(join(MP, 'pages/record/record.js'), 'utf8')
const recordWxml = readFileSync(join(MP, 'pages/record/record.wxml'), 'utf8')
const detailWxml = readFileSync(join(MP, 'pages/case-detail/case-detail.wxml'), 'utf8')

// 取出 toggleLayout 的函数体
const toggleIdx = recordJs.indexOf('toggleLayout')
const toggleBody = toggleIdx >= 0 ? recordJs.slice(toggleIdx, toggleIdx + 2000) : ''
ok(
  '录入页切换体例会落库（updatePatientLayout），不是只改页面状态',
  /updatePatientLayout\s*\(/.test(toggleBody),
  toggleIdx >= 0 ? '没找到 updatePatientLayout 调用' : '找不到 toggleLayout',
)
ok(
  '录入页的体例按钮写明了是「体例」',
  /体例/.test(recordWxml),
  'record.wxml 里没有「体例」字样',
)
ok(
  '病例详情页的记录表也标出当前体例',
  /体例/.test(detailWxml),
  'case-detail.wxml 里没有「体例」字样',
)

/* ---- 8. 记录表两页必须用**同一个组件** ----
 *
 * 2026-11-05 的病根：病例详情页的「记录表」是 canvas 画的，录入页的「录入记录」是 WXML 画的，
 * 两套各画各的 —— 同一位患者在两个界面长得不一样（canvas 版没有表下「体质／（未判）」两行、也不能编辑）。
 *
 * 修法是把两处都换成 `components/record-sheet`。这里把「结构上只有一份」钉死：
 * 页面里不许再出现自己画的表格骨架；组件改了必须抛 change；病例详情页收到 change 要立刻落库。 */
const sheetDir = join(MP, 'components/record-sheet')
const sheetJsonPath = join(sheetDir, 'record-sheet.json')
ok('record-sheet 组件存在', existsSync(sheetJsonPath), sheetJsonPath)

if (existsSync(sheetJsonPath)) {
  const sheetJson = JSON.parse(readFileSync(sheetJsonPath, 'utf8'))
  ok('record-sheet 是自定义组件（component: true）', sheetJson.component === true)
}

const sheetWxml = existsSync(join(sheetDir, 'record-sheet.wxml'))
  ? readFileSync(join(sheetDir, 'record-sheet.wxml'), 'utf8')
  : ''
const sheetJs = existsSync(join(sheetDir, 'record-sheet.js'))
  ? readFileSync(join(sheetDir, 'record-sheet.js'), 'utf8')
  : ''

// 表格骨架（表头／正文／表下）只能出现在组件里
const TABLE_MARKS = ['pr-thead', 'pr-tbody', 'pr-tfoot', 'pr-table-scroll']
for (const [label, file] of [
  ['录入页', join(MP, 'pages/record/record.wxml')],
  ['病例详情页', join(MP, 'pages/case-detail/case-detail.wxml')],
]) {
  const wxml = readFileSync(file, 'utf8')
  ok(`${label}用的是 <record-sheet> 组件`, /<record-sheet[\s>]/.test(wxml))
  const own = TABLE_MARKS.filter((mk) => wxml.includes(`class="${mk}`))
  ok(`${label}没有自己画表格骨架（版式只在组件里）`, own.length === 0, own.join(', '))

  const jsonPath = file.replace(/\.wxml$/, '.json')
  const json = JSON.parse(readFileSync(jsonPath, 'utf8'))
  const using = (json.usingComponents || {})['record-sheet']
  ok(`${label}的 json 注册了 record-sheet 组件`, typeof using === 'string' && using.length > 0, jsonPath)
}

// 组件里必须真的有那张表（防止组件被掏空、页面变成空白）
ok(
  'record-sheet 里画着那张表（表头／正文／表下都在）',
  TABLE_MARKS.every((mk) => sheetWxml.includes(`class="${mk}`)),
)
// 组件改了要抛事件，页面才知道「哪几格变了」
ok("record-sheet 改了会 triggerEvent('change')", /triggerEvent\(\s*'change'/.test(sheetJs))
// 面板分组不能跟表格分组同名（.pr-grp 撞名会把面板拉成一行、底下多一条黑线）
ok(
  '符号面板的分组用 .pr-pal-*（不与表格的 .pr-grp 撞名）',
  sheetWxml.includes('pr-pal-grp') && !/class="pr-grp"\s+wx:for="\{\{paletteGroups\}\}"/.test(sheetWxml),
)

// 病例详情页没有「保存」按钮 → 收到 change 必须立刻落库
const detailJs = readFileSync(join(MP, 'pages/case-detail/case-detail.js'), 'utf8')
ok(
  '病例详情页改表后立刻落库（updateVisit）',
  /updateVisit\s*\(/.test(detailJs),
  'case-detail.js 里没有 updateVisit 调用',
)
const detailWxmlText = readFileSync(join(MP, 'pages/case-detail/case-detail.wxml'), 'utf8')
ok(
  '病例详情页「记录表」标题行有「录入编辑」按钮',
  /录入编辑/.test(detailWxmlText) && /bindtap="goRecord"/.test(detailWxmlText),
)

console.log(`\n共 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`)
if (failures.length) {
  console.log('失败项：')
  for (const f of failures) console.log('  · ' + f)
}
console.log('')
process.exit(fail === 0 ? 0 : 1)
