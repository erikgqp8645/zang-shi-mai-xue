#!/usr/bin/env node
/**
 * 小程序端静态检查（Taro 版）—— 替代 `mp-lint.mjs`
 *
 * ## 为什么换一套
 *
 * 原生小程序没有编译期检查（WXML 里写错函数名、JS 里 require 路径写错，都要到运行时才炸），
 * 所以有 `mp-lint.mjs`。迁到 Taro 后源码变成 TSX：
 *   · 类型错误交给 `tsc --noEmit`（`npm run typecheck`）
 *   · 但**约定类**的错 tsc 抓不到 —— 「业务代码里直调 wx.」「记录表自己画了一份骨架」
 *     「改体例没落库」这些，编译器一律不管，只能扫源码。
 *
 * 所以这里扫的是 **TSX 源码文本**，查两类：
 *   ① **平移**：原生版里那些抓得住真 bug 的断言，原样搬过来
 *   ② **新增 TSX 专项**：Taro 化之后才成立的新规矩
 *
 * 用法：node scripts/e2e/taro-lint.mjs
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
// 第 25 节要解码底图 JPEG、跟 PNG 真源逐像素比 —— 这两个只在 devDependencies 里
import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const TARO = join(ROOT, 'taro')
const SRC = join(TARO, 'src')

// 查 TSX 的**结构**（JSX 元素 / 属性 / 调用 / 表达式）—— 全文搜词会被改名的写法骗过。
//
// 用的是 **Taro 工作区里的 TypeScript 5.9**（`taro/package.json` 的 devDependency 之一，
// 经典 AST API：`createSourceFile` / `isJsxElement` / `SyntaxKind`）。
// 根目录那个 `typescript@7` 是新的原生版，AST API 换成了 `unstable/ast`，没有解析入口 —— 用不了。
const requireTaro = createRequire(join(TARO, 'package.json'))
const ts = requireTaro('typescript')

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

/* ========================================================================
 * TSX 结构工具 —— **按 AST 看，不全文搜词**
 *
 * 为什么不能全文搜词（这是被「故意写坏」验过的）：
 *   · 把 `className='pr-single-head'` 改成 `'pr-single-head-off'`
 *     → 搜「pr-single-head」照样搜得到，断言照样过；
 *   · 把 `selectVisit(...)` 改成 `void s`
 *     → 搜「selectVisit」也照样搜得到（import 里还有这个名字）。
 * 这两种「改坏了但搜得到」的写法都会蒙混过关 —— 所以改用编译器 API 看结构。
 * ======================================================================== */

/** 解析 TSX 成 AST */
function parseTsx(file) {
  const src = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  return { src, sf }
}

/** 深度遍历 AST
 *
 * ⚠️ 回调**不能返回值**：`ts.forEachChild` 拿到真值就**中断遍历**。
 *    （写成 `(c) => walkAst(c, out)` 会返回数组 → 只走到第一个子节点就停。） */
function walkAst(node, out = []) {
  out.push(node)
  ts.forEachChild(node, (c) => {
    walkAst(c, out)
  })
  return out
}

/** 一个 JSX 元素的 className 属性拆成的类名 token */
function classTokens(el, sf) {
  const opening = ts.isJsxElement(el) ? el.openingElement : el
  const attr = opening?.attributes?.properties?.find((a) => a.name && a.name.text === 'className')
  if (!attr) return []
  // 把 `${…}` 里的**字面量**也留下（'is-on' 就在那里面），再按空白切开
  const raw = attr.initializer.getText(sf).replace(/[${}`"'?:]/g, ' ')
  return raw.split(/\s+/).filter(Boolean)
}

/** JSX 元素的文字内容 */
function textOf(el) {
  let out = ''
  const visit = (n) => {
    if (ts.isJsxText(n)) out += n.text
    ts.forEachChild(n, visit)
  }
  if (ts.isJsxElement(el)) el.children.forEach(visit)
  return out.replace(/\s+/g, '').trim()
}

/** 全部 JSX 元素（自闭合 + 带子节点的） */
function jsxElements(nodes) {
  return nodes.filter((n) => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n))
}

/** className 里带某个类名的 JSX 元素 */
function elementsByClass(els, sf, cls) {
  return els.filter((el) => classTokens(el, sf).includes(cls))
}

/** 某个元素**里面**的 JSX 元素 */
function insideOf(el) {
  return jsxElements(walkAst(el))
}

/** `a || b || c` 摊平成从左到右的运算数 */
function flattenOr(node, out = []) {
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    flattenOr(node.left, out)
    flattenOr(node.right, out)
    return out
  }
  out.push(node)
  return out
}

/** 变量声明（按名字找） */
function findVarDecl(nodes, sf, name) {
  return nodes.find((n) => ts.isVariableDeclaration(n) && n.name.getText(sf) === name)
}

/** useMemo(() => expr, deps) 里那个箭头函数的表达式体 */
function useMemoBody(decl) {
  const init = decl?.initializer
  if (!init || !ts.isCallExpression(init)) return null
  const arg = init.arguments[0]
  if (!arg || !(ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))) return null
  if (ts.isBlock(arg.body)) return null
  return arg.body
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
 * 去掉注释，只留代码 —— **行号与列位置保持不变**（报错要能指到具体行）
 *
 * ## 为什么不用一行正则
 *
 * 原来的写法是逐行 `replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '')`，有两个洞：
 *
 *   1. `/* ... *\/` 是**跨行**的，`.` 不匹配换行 → 多行块注释里的字漏出来，
 *      于是 `utils/config.ts` 的注释里写了一句「走 `wx.cloud.callFunction`」就被当成直调。
 *   2. `//` 会把 `'http://…'` 里的 `//` 当成注释起点 → **同一行后面的代码被吃掉**，
 *      真正的 `wx.` 调用反而漏检（这是更危险的方向）。
 *
 * 现在：块注释整体换成空格（换行留着），行注释**跳过字符串里的 `//`**。
 */
function stripComments(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  return noBlock
    .split('\n')
    .map((line) => {
      let inSingle = false
      let inDouble = false
      for (let i = 0; i < line.length - 1; i += 1) {
        const c = line[i]
        if (c === '\\') {
          i += 1
          continue
        }
        if (c === "'" && !inDouble) inSingle = !inSingle
        else if (c === '"' && !inSingle) inDouble = !inDouble
        else if (!inSingle && !inDouble && c === '/' && line[i + 1] === '/') return line.slice(0, i)
      }
      return line
    })
    .join('\n')
}

/** 路径转成 POSIX 写法（Windows 上 join() 拼的是 `\`） */
function toPosix(p) {
  return p.replace(/\\/g, '/')
}

function read(p) {
  return readFileSync(p, 'utf8')
}

/** 相对仓库根的短路径，便于报错 */
function rel(p) {
  return toPosix(p).replace(toPosix(ROOT) + '/', '')
}

const tsxFiles = walk(SRC, [], (p) => p.endsWith('.tsx') || p.endsWith('.ts'))
const pageFiles = walk(join(SRC, 'pages'), [], (p) => p.endsWith('.tsx'))
const componentFiles = walk(join(SRC, 'components'), [], (p) => p.endsWith('.tsx'))
const platformFiles = walk(join(SRC, 'platform'), [], (p) => p.endsWith('.ts'))

const appConfigSrc = read(join(SRC, 'app.config.ts'))

console.log('\n小程序端静态检查（Taro）\n')

/* ========================================================================
 * 1. app.config.ts 登记的页面都存在
 * ======================================================================== */
const pageList = [...appConfigSrc.matchAll(/'pages\/[^']+'/g)].map((m) => m[0].replace(/'/g, ''))
ok(`app.config.ts 登记了 ${pageList.length} 个页面`, pageList.length > 0)

for (const p of pageList) {
  const base = p.replace(/^pages\//, '').replace(/\/index$/, '')
  const dir = join(SRC, 'pages', base)
  ok(`${p} 的页面文件存在`, existsSync(join(dir, 'index.tsx')))
  ok(`${p} 注册了页面配置`, existsSync(join(dir, 'index.config.ts')))
}

/* ========================================================================
 * 2. tabBar 恰好 4 项，且是「病例 / 就诊 / 用方 / 我的」
 * ======================================================================== */
const tabSection = appConfigSrc.slice(appConfigSrc.indexOf('tabBar'))
const tabEntries = [...tabSection.matchAll(/pagePath:\s*'([^']+)'[\s\S]*?text:\s*'([^']+)'/g)]
ok(`tabBar 恰有 4 项（现状是 ${tabEntries.length}）`, tabEntries.length === 4)
ok(
  'tabBar 是「病例 / 就诊 / 用方 / 我的」',
  tabEntries.map((m) => m[2]).join('/') === '病例/就诊/用方/我的',
  tabEntries.map((m) => m[2]).join('/'),
)
for (const m of tabEntries) {
  ok(`tabBar 页 ${m[1]} 在 app.config.ts 的 pages 里`, pageList.includes(m[1]))
}

/* ========================================================================
 * 3. 业务代码里不许出现 `wx.`（平台适配层除外）
 * ======================================================================== */
const businessFiles = [...pageFiles, ...componentFiles, ...walk(join(SRC, 'store'), [], (p) => p.endsWith('.ts')), ...walk(join(SRC, 'utils'), [], (p) => p.endsWith('.ts'))]
const wxOffenders = []
for (const f of businessFiles) {
  const src = read(f)
  // 注释里提到 wx. 不算；只看代码行
  stripComments(src).split('\n').forEach((code, i) => {
    if (/\bwx\./.test(code)) wxOffenders.push(`${rel(f)}:${i + 1}`)
  })
}
ok(
  `业务代码里没有直调 wx.（${businessFiles.length} 个文件）`,
  wxOffenders.length === 0,
  wxOffenders.slice(0, 5).join(' '),
)

const platformWxUsers = platformFiles.filter((f) => /\bwx\./.test(read(f)))
ok('platform/ 里允许出现 wx.（云函数调用走 wx.cloud）', platformWxUsers.length >= 0)

/* ========================================================================
 * 4. 没有原生小程序残留
 * ======================================================================== */
const residue = []
for (const f of tsxFiles) {
  const src = read(f)
  if (/\.wxml['"]/.test(src)) residue.push(`${rel(f)} 引用了 .wxml`)
  if (/\.wxss['"]/.test(src)) residue.push(`${rel(f)} 引用了 .wxss`)
  if (/<view\b|<text\b|<block\b|wx:for=|wx:if=|bindtap=|bindinput=|catchtap=/.test(src)) {
    residue.push(`${rel(f)} 有原生 WXML 写法残留`)
  }
}
ok('没有原生 WXML/WXSS 残留', residue.length === 0, residue.slice(0, 5).join(' '))

/* ========================================================================
 * 5. alias 纪律：绝不 import 浏览器专用的 png.ts / download.ts
 * ======================================================================== */
const browserOnly = []
for (const f of tsxFiles) {
  const src = read(f)
  if (/@export\/(png|download)/.test(src)) browserOnly.push(rel(f))
  if (/from\s+'[^']*export\/(png|download)/.test(src)) browserOnly.push(rel(f))
}
ok('没有 import 浏览器专用的 @export/png 或 @export/download', browserOnly.length === 0, browserOnly.join(' '))

/* ========================================================================
 * 6. 知识库 domain 只被「用方」页 与「用药面板」引用（包体纪律）
 *
 * ## 这条纪律现在还剩什么用
 *
 * 原意是「别让用不到知识库的页面把 200KB 知识库拖进来」。
 * 但 **微信 tabBar 页必须在主包**，而「用方」就是 tab 页 ——
 * 知识库**本来就一定在主包里**，「分包省包体」这条路已经不成立。
 * 剩下的价值只有一条：**知识库的入口要收得住**，别散落到各处随手引。
 *
 * 所以白名单是：
 *   · `pages/formulas`      —— 「用方」tab，知识库的主入口
 *   · `components/medication-panel` —— 就诊工作台的「方药」档里那一块，
 *       要选方、要看讲稿比例制与同和堂版克数两套组成（原生 medication 页的核心功能，缺了就是漏功能）
 *   · `components/visit-triad` —— 体质／疗法／方药三档要查方剂组成
 *
 * 另注：白名单按**路径包含**匹配，不是全等 —— `rel()` 给的是
 * `pulse-record/taro/src/components/.../index.tsx` 这种全路径，
 * 用全等去查永远查不到，例外项会被误判成违规。
 *
 * ## 纯类型引用不算「引用」
 *
 * `import type { X } from '@domain/...'` 编译后**一行代码都不留** ——
 * `store/focus.ts` 就是这种（它只要 `FormulaLink` 这个类型）。
 * 所以扫描时要把纯类型的 import 剔掉，否则会把没拖代码进来的文件也算成违规。
 * ======================================================================== */
const KNOWLEDGE = [
  'formulas',
  'drugs',
  'formula-table',
  'grouping',
  'medication',
  'dose-lookup',
  'sequence',
  // 2026-11-06 新增：③ 的方名 → 知识库锚点的解析器（见 §3.16）
  'formula-links',
]

/**
 * 这个文件对某个知识库模块的引用是不是**纯类型**（编译后不留代码）。
 *
 * - `import type { X } from '...'` → 纯类型
 * - `import { type X } from '...'` → 纯类型
 * - `import { X } from '...'` → 值引用（拖代码进包）
 */
function isTypeOnly(src, mod) {
  const re = new RegExp(`import\\s+([^;]*?)\\s+from\\s+'@domain/${mod}'`, 'g')
  let saw = false
  for (const m of src.matchAll(re)) {
    saw = true
    const clause = m[1].trim()
    if (clause.startsWith('type ')) continue
    const inner = clause.match(/\{([\s\S]*)\}/)
    if (!inner) return false
    const specs = inner[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (specs.length && specs.every((s) => s.startsWith('type '))) continue
    return false
  }
  return saw
}

const knowledgeUsers = []
for (const f of tsxFiles) {
  const src = read(f)
  for (const k of KNOWLEDGE) {
    if (new RegExp(`@domain/${k}`).test(src) && !isTypeOnly(src, k)) {
      knowledgeUsers.push({ file: rel(f), mod: k })
    }
  }
}
const ALLOWED_ELSEWHERE = {
  'components/medication-panel': ['drugs', 'dose-lookup', 'formula-table', 'medication'],
  // visit-triad 查方剂组成（dose-lookup）＋ ③ 的方名可点进「用方」（formula-links）
  'components/visit-triad': ['dose-lookup', 'formula-links'],
}
function allowedElsewhere(file, mod) {
  for (const [dir, mods] of Object.entries(ALLOWED_ELSEWHERE)) {
    if (file.includes(dir) && mods.includes(mod)) return true
  }
  return false
}
const nonFormulasKnowledge = knowledgeUsers.filter(
  (u) => !u.file.includes('pages/formulas') && !allowedElsewhere(u.file, u.mod),
)
ok(
  `知识库 domain 只被「用方」页与「用药面板」引用（当前 ${knowledgeUsers.length} 处引用）`,
  nonFormulasKnowledge.length === 0,
  nonFormulasKnowledge.map((u) => `${u.file}→${u.mod}`).join(' '),
)

/* ========================================================================
 * 7. 记录表组件 —— 与原生版同源的规矩
 * ======================================================================== */
const sheetFile = join(SRC, 'components', 'record-sheet', 'index.tsx')
ok('record-sheet 组件存在', existsSync(sheetFile))
ok('record-sheet 有样式文件', existsSync(join(SRC, 'components', 'record-sheet', 'index.scss')))

if (existsSync(sheetFile)) {
  const sheet = read(sheetFile)
  const shapesFile = join(SRC, 'components', 'record-sheet', 'shapes.ts')
  const shapesSrc = existsSync(shapesFile) ? read(shapesFile) : ''
  const sheetScss = existsSync(join(SRC, 'components', 'record-sheet', 'index.scss'))
    ? read(join(SRC, 'components', 'record-sheet', 'index.scss'))
    : ''

  ok('record-sheet 从共享 domain 取行结构（groupRows）', /@domain\/layout/.test(sheet) && /groupRows/.test(sheet))
  ok('record-sheet 从共享 domain 取格键（cellKey）', /@domain\/types/.test(sheet) && /cellKey/.test(sheet))
  ok('record-sheet 改了会抛 onChange（页面拿它落库）', /onChange\?\.\(/.test(sheet))
  ok('record-sheet 有「一次一屏」竖排分支', /view === 'wide'/.test(sheet) && /pr-single-row/.test(sheet))
  ok('record-sheet 竖排与宽表共用同一份 values', /singleRows/.test(sheet) && /sessions/.test(sheet))
  ok(
    'record-sheet 会把嵌套数组规整回数组（形状兜底）',
    // 组件自己要用 toCodeArray（读单格）与 cleanSessions（进出都规整）；
    // cleanValues 是 cleanSessions 内部那一层，住在 shapes.ts 里。
    // 注意 cleanValues 后面要跟词边界 —— 否则 `cleanValuesBroken` 也算过。
    /toCodeArray/.test(sheet) &&
      /cleanSessions/.test(sheet) &&
      /export function cleanValues\b/.test(shapesSrc),
  )

  // 符号面板的分组不能与表格的部位分组撞名（.pr-grp）
  ok('符号面板用 .pr-pal-*（不与表格 .pr-grp 撞名）', /pr-pal-grp/.test(sheet) || /pr-pal-grp/.test(sheetScss))
  ok('表格的部位分组仍叫 .pr-grp', /\.pr-grp\b/.test(sheetScss))

  // 版式取色：讲义 p34 实例表实测值
  ok('部位列取讲义 p34 的橙色 #ffc000', /#ffc000/i.test(sheetScss))
  ok('表底取讲义 p34 的 #cce8cf', /#cce8cf/i.test(sheetScss))

  /* --------------------------------------------------------------------
   * 7b. 列界必须对齐（2026-11-07）
   *
   * 病根：表头「左/右」行原来是「168rpx 容器内塞 84+84 两个子格」。
   * 容器自带 `border-right: 2rpx`，`box-sizing: border-box` 下内容盒只剩 166rpx，
   * 两个 84rpx 的子格**放不下 → 每组溢出 2rpx**，把后面每一组整体推右 2rpx。
   * 列数越多偏得越远（实测 4 次就诊：表头列界比正文右偏 2→4→7→9px）。
   *
   * 修法：表头「左/右」行改成**平铺的 84rpx 格**，与正文的数据格同构。
   *
   * 这里断言的是**列宽不变量**（解析 SCSS 规则块取宽度值再比），
   * 不是全文搜词 —— 搜「84rpx」出现与否，改坏了照样能蒙混过去。
   * 讲义 2026-10 p34 实例表实测：表头「左/右」行与正文的竖线集合完全一致。
   * ------------------------------------------------------------------ */
  const scssRule = (src, selector) => {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = src.match(new RegExp(`(^|[\\s,>])${esc}\\s*\\{([^}]*)\\}`, 'm'))
    return m ? m[2] : ''
  }
  /** 从一条 SCSS 规则里取宽度（rpx） */
  const ruleWidth = (src, selector) => {
    const body = scssRule(src, selector)
    const m = body.match(/width:\s*(\d+(?:\.\d+)?)rpx/)
    return m ? Number(m[1]) : null
  }

  const headHandW = ruleWidth(sheetScss, '.pr-thead-hand')
  const headDateW = ruleWidth(sheetScss, '.pr-thead-date')
  const bodyCellW = ruleWidth(sheetScss, '.pr-cell')
  const footCellW = ruleWidth(sheetScss, '.pr-tfoot-cell')

  ok(
    '表头「左/右」行的格宽与正文数据格一致（列界必然对齐）',
    headHandW !== null && bodyCellW !== null && headHandW === bodyCellW,
    `表头 ${headHandW}rpx / 正文 ${bodyCellW}rpx`,
  )
  /* ⭐ 2026-11-07：日期行从「一个 168rpx 的整格」改成「两个 84rpx 半格」。
   *
   * 实机（微信小程序 iOS 模拟器）逐行量坐标：
   *   · 表头「左/右」行 ＝ 正文数据格 —— 完全一致（都声明 84rpx）
   *   · 只有日期行错：组界实测 323/478/633，期望 321/474/628，每格累积偏 ~2.4rpx
   * 全表出错的格子**恰好只有「显式 width > 84rpx 且带 padding」的那两个**
   * （日期格、表下格）；84rpx 且不带 padding 的格子在真机上一列不差。
   *
   * ⇒ 修法是换写法：日期/表下也用平铺的 84rpx 半格，
   *    「一次就诊占两列」由**数量**决定，而不是由「声明一个 168rpx 的宽」决定。
   *    全表只剩 84rpx 一种数据列宽，列界只由「84rpx × N」决定。
   *
   * ⚠️ 这条在 Chromium 里是「白测」（Chromium 的 168rpx 也准）——
   *    它的作用是**锁住写法**，别让人改回「一个 168rpx 的整格」。 */
  ok(
    '表头日期的**半格**与手格、正文数据格同一个宽度声明（全表只一种数据列宽）',
    headDateW !== null && headDateW === headHandW && headDateW === bodyCellW,
    `日期半格 ${headDateW}rpx / 手格 ${headHandW}rpx / 正文 ${bodyCellW}rpx`,
  )
  ok(
    '表下的**半格**与手格同一个宽度声明',
    footCellW !== null && footCellW === headHandW,
    `表下 ${footCellW}rpx / 手格 ${headHandW}rpx`,
  )
  ok(
    '表内不再有 168rpx 的整格（日期/表下都必须拆成半格）',
    headDateW !== 168 && footCellW !== 168,
    `日期 ${headDateW}rpx / 表下 ${footCellW}rpx`,
  )
  // 带 padding 的格子在真机上宽度会多出来 —— 半格一律不许带 padding
  const paddedCells = ['.pr-thead-date', '.pr-tfoot-cell']
    .map((sel) => [sel, scssRule(sheetScss, sel)])
    .filter(([, body]) => /padding\s*:/.test(body))
    .map(([sel]) => sel)
  ok(
    '日期格 / 表下格不带 padding（padding 会让真机宽度多出来）',
    paddedCells.length === 0,
    paddedCells.join(' / '),
  )
  // 标签文字靠绝对定位横跨两个半格 —— 不能靠「让文字溢出半格」
  const dateTextRule = scssRule(sheetScss, '.pr-thead-date-text')
  const footTextRule = scssRule(sheetScss, '.pr-tfoot-cell-text')
  ok(
    '日期标签 / 表下值用绝对定位横跨两个半格（不靠溢出）',
    /position\s*:\s*absolute/.test(dateTextRule) &&
      /width\s*:\s*168rpx/.test(dateTextRule) &&
      /position\s*:\s*absolute/.test(footTextRule) &&
      /width\s*:\s*168rpx/.test(footTextRule),
    `日期标签 ${dateTextRule.replace(/\s+/g, ' ').slice(0, 80)}`,
  )
  ok(
    '日期 / 表下的左半格是定位基准（position:relative）',
    /position\s*:\s*relative/.test(scssRule(sheetScss, '.pr-thead-date.is-l')) &&
      /position\s*:\s*relative/.test(scssRule(sheetScss, '.pr-tfoot-cell.is-l')),
  )
  // ⭐ 左半格**不许画竖线** —— 讲义 p34：日期横跨「左＋右」两列，中间不画竖线。
  //    拆半格是为了统一列宽算法，但「拆格子」不等于「画两条线」。
  //    （2026-11-07 实机截图：每个日期正中间多出一条竖线，就是 is-l 的右线。）
  const isLRules = [
    ['.pr-thead-date.is-l', scssRule(sheetScss, '.pr-thead-date.is-l')],
    ['.pr-tfoot-cell.is-l', scssRule(sheetScss, '.pr-tfoot-cell.is-l')],
  ]
  const stillLined = isLRules
    .filter(([, body]) => !/box-shadow\s*:\s*none/.test(body))
    .map(([sel]) => sel)
  ok(
    '日期 / 表下的**左半格不画竖线**（讲义 p34：横跨两列，中间不画竖线）',
    stillLined.length === 0,
    stillLined.join(' / '),
  )
  const isRRules = [
    ['.pr-thead-date.is-r', scssRule(sheetScss, '.pr-thead-date.is-r')],
    ['.pr-tfoot-cell.is-r', scssRule(sheetScss, '.pr-tfoot-cell.is-r')],
  ]
  const missingR = isRRules.filter(([, body]) => !/box-shadow\s*:\s*inset/.test(body)).map(([sel]) => sel)
  ok('日期 / 表下的右半格画组界线（inset box-shadow）', missingR.length === 0, missingR.join(' / '))
  // ⭐ 左半格不许裁跨格文字 —— 否则「（未判）」会被截成「（未」（真机截图可见）
  const clipping = [
    ['.pr-thead-date.is-l', scssRule(sheetScss, '.pr-thead-date.is-l')],
    ['.pr-tfoot-cell.is-l', scssRule(sheetScss, '.pr-tfoot-cell.is-l')],
  ]
    .filter(([, body]) => !/overflow\s*:\s*visible/.test(body))
    .map(([sel]) => sel)
  ok(
    '日期 / 表下的左半格**不裁**跨格文字（overflow: visible）',
    clipping.length === 0,
    clipping.join(' / '),
  )
  // 组件侧：日期行必须真的渲染成「两个半格 + 一个跨格标签」
  ok(
    '组件把日期渲染成两个半格（is-l / is-r），标签挂在 is-l 上',
    /pr-thead-date is-l/.test(sheet) &&
      /pr-thead-date is-r/.test(sheet) &&
      /pr-thead-date-text/.test(sheet),
  )
  ok(
    '组件把表下格也渲染成两个半格（is-l / is-r）',
    /pr-tfoot-cell is-l/.test(sheet) && /pr-tfoot-cell is-r/.test(sheet),
  )

  /* --------------------------------------------------------------------
   * 7b-2. 竖线不许用 border —— 必须用 inset box-shadow（2026-11-07 实机错开）
   *
   * 实机（微信小程序 webview）量出来的偏差：
   *   · 正文「部位+取法」两段合计 125.8rpx（应 128rpx）→ 短 2rpx
   *   · 日期格 / 表下格 169.8rpx（应 168rpx）→ 长 2rpx
   *   · 84rpx 的数据格是准的
   * ⇒ **带 border-right 的格子，边框被算进了盒模型**（各引擎对
   *    「width 含不含 border」的处理不一致；Chromium 的 border-box 就正常，
   *    所以本地 Chromium 探针抓不到，只能在真机上暴露）。
   *
   * 修法：竖线一律 `box-shadow: inset -Xrpx 0 0 #000` 画在盒子内侧，
   * **完全不参与盒模型** —— 每个格子的外宽严格等于它声明的 width。
   *
   * ⚠️ 这条断言查的是**每条规则自己的声明**（按选择器解析出规则块再查属性），
   *    不是全文搜词 —— 改个选择器名、把 border 挪到别的规则里都骗不过它。
   * ------------------------------------------------------------------ */
  const verticalLineCells = [
    '.pr-thead-name',
    '.pr-thead-date',
    '.pr-thead-date.is-r',
    '.pr-thead-hand',
    '.pr-thead-hand.is-r',
    '.pr-organ',
    '.pr-depth',
    '.pr-cell',
    '.pr-tfoot-label',
    '.pr-tfoot-cell',
    '.pr-tfoot-cell.is-r',
  ]
  const borderUsers = []
  const shadowUsers = []
  for (const sel of verticalLineCells) {
    const body = scssRule(sheetScss, sel)
    if (!body) {
      borderUsers.push(`${sel}: 找不到规则`)
      continue
    }
    // 只看这一条规则自己的声明（不串到别的规则）
    if (/(^|[\s;{])border-(right|left)\s*:/.test(body)) {
      borderUsers.push(`${sel}: ${body.match(/border-(right|left)\s*:[^;}]*/)[0]}`)
    }
    if (/box-shadow\s*:\s*inset/.test(body)) shadowUsers.push(sel)
  }
  ok(
    '表格格子的竖线一律用 inset box-shadow，不用 border（border 会进盒模型）',
    borderUsers.length === 0,
    borderUsers.join(' / '),
  )
  ok(
    '表格格子的竖线都改用了 inset box-shadow',
    shadowUsers.length === verticalLineCells.length,
    `${shadowUsers.length}/${verticalLineCells.length}：${shadowUsers.join(',')}`,
  )
  // 姓名格必须有「装不下就截、但绝不撑破布局」的双保险
  const nameRule = scssRule(sheetScss, '.pr-thead-name')
  const nameTextRule = scssRule(sheetScss, '.pr-thead-name-text')
  ok(
    '姓名格 overflow:hidden + min-width:0（名字再长也撑不破布局）',
    /overflow\s*:\s*hidden/.test(nameRule) && /min-width\s*:\s*0/.test(nameRule),
    nameRule.replace(/\s+/g, ' ').slice(0, 120),
  )
  ok(
    '姓名文字用 text-overflow:ellipsis（宁可省略号也不硬切半个字）',
    /text-overflow\s*:\s*ellipsis/.test(nameTextRule),
    nameTextRule.replace(/\s+/g, ' ').slice(0, 120),
  )

  /* --------------------------------------------------------------------
   * 7c. 结构断言 —— 表头结构、选中高亮、一次一屏的元信息（2026-11-07）
   *
   * 这一组全部**按 AST 判**（JSX 元素 / 属性 / 调用），
   * 不用全文搜词 —— 改个类名、挪个调用都骗得过搜词，骗不过 AST。
   * ------------------------------------------------------------------ */
  const sheetAst = parseTsx(sheetFile)
  const sheetSf = sheetAst.sf
  const sheetEls = jsxElements(walkAst(sheetSf))
  const sheetCalls = walkAst(sheetSf).filter(ts.isCallExpression)

  // 旧写法（容器内塞两个子格）会留下这两个类名 —— 留着就说明还在用老结构
  ok(
    '表头「左/右」不再用「容器内塞两个子格」的旧结构',
    elementsByClass(sheetEls, sheetSf, 'pr-thead-hand-l').length === 0 &&
      elementsByClass(sheetEls, sheetSf, 'pr-thead-hand-r').length === 0,
  )
  const handsWrap = elementsByClass(sheetEls, sheetSf, 'pr-thead-hands')[0]
  const handEls = handsWrap
    ? insideOf(handsWrap).filter((el) => classTokens(el, sheetSf).includes('pr-thead-hand'))
    : []
  ok(
    '表头「左/右」行平铺两个格（左 + 右）',
    handEls.some((el) => classTokens(el, sheetSf).includes('is-l')) &&
      handEls.some((el) => classTokens(el, sheetSf).includes('is-r')),
  )

  // 选中高亮：要绑在**表头日期 / 数据格 / 表下格**这三处，缺一就不算「整列高亮」
  const onEls = elementsByClass(sheetEls, sheetSf, 'is-on')
  ok(
    '宽表：数据格绑上选中高亮',
    onEls.some((el) => classTokens(el, sheetSf).includes('pr-cell')),
  )
  ok(
    '宽表：表头日期绑上选中高亮',
    onEls.some((el) => classTokens(el, sheetSf).includes('pr-thead-date')),
  )
  ok(
    '表下：格绑上选中高亮',
    onEls.some((el) => classTokens(el, sheetSf).includes('pr-tfoot-cell')),
  )

  // 一次一屏的元信息头
  ok('一次一屏有「这一次」的元信息头', elementsByClass(sheetEls, sheetSf, 'pr-single-head').length === 1)
  ok('一次一屏的元信息里有体质／疗法两项', (() => {
    const ks = elementsByClass(sheetEls, sheetSf, 'pr-single-item-k').map((el) => textOf(el))
    return ks.includes('体质') && ks.includes('疗法')
  })())
  ok('一次一屏有「换一次」的日期 chip', elementsByClass(sheetEls, sheetSf, 'pr-single-chip').length >= 1)
  // 元信息头不许混进宽表的表头分支里
  ok(
    '「这一次」的头只出现在一次一屏分支（不在宽表表头里）',
    (() => {
      const thead = elementsByClass(sheetEls, sheetSf, 'pr-thead')[0]
      if (!thead) return true
      return insideOf(thead).every((el) => !classTokens(el, sheetSf).includes('pr-single-head'))
    })(),
  )
  // 体质／疗法可就地改 —— 看的是**调用点**，不是名字出现过没有
  ok(
    '一次一屏的体质可就地改（调用点带着 activeSession）',
    sheetCalls.some(
      (c) =>
        ts.isIdentifier(c.expression) &&
        c.expression.text === 'onConstitutionTap' &&
        c.arguments.some((a) => a.getText(sheetSf).includes('activeSession')),
    ),
  )
  ok(
    '一次一屏的疗法可就地改（调用点带着 activeSession）',
    sheetCalls.some(
      (c) =>
        ts.isIdentifier(c.expression) &&
        c.expression.text === 'onTherapyTap' &&
        c.arguments.some((a) => a.getText(sheetSf).includes('activeSession')),
    ),
  )

  // 表下两行：标签跟值必须同行 —— 原来 lead 第 2 行是「体质」而值在第 1 行（标签错行）
  ok(
    '表下没有留白格（旧结构）',
    elementsByClass(sheetEls, sheetSf, 'pr-tfoot-blank').length === 0,
  )
  ok(
    '表下的标签是两行：体质 / 疗法',
    (() => {
      const lead = elementsByClass(sheetEls, sheetSf, 'pr-tfoot-lead')[0]
      if (!lead) return false
      const labels = insideOf(lead).filter((el) => classTokens(el, sheetSf).includes('pr-tfoot-label'))
      const texts = labels.map((el) => textOf(el))
      return labels.length === 2 && texts[0] === '体质' && texts[1] === '疗法'
    })(),
  )
  ok(
    '表下的值也是两行（体质值 / 疗法值）',
    (() => {
      const cols = elementsByClass(sheetEls, sheetSf, 'pr-tfoot-cols')[0]
      if (!cols) return false
      return insideOf(cols).filter((el) => classTokens(el, sheetSf).includes('pr-tfoot-row')).length === 2
    })(),
  )
}

/* ========================================================================
 * 8. 两处都用同一个记录表组件
 * ======================================================================== */
const caseDetail = join(SRC, 'pages', 'case-detail', 'index.tsx')
const visitPage = join(SRC, 'pages', 'visit', 'index.tsx')
const visitPulse = join(SRC, 'components', 'visit-pulse', 'index.tsx')

for (const [label, f] of [
  ['病例详情页', caseDetail],
  ['就诊页的摸脉分支', visitPulse],
]) {
  ok(`${label} 存在`, existsSync(f))
  if (!existsSync(f)) continue
  const src = read(f)
  ok(`${label} 用的是 record-sheet 组件`, /record-sheet/.test(src))
  ok(`${label} 没有自己画表格骨架`, !/pr-organ/.test(src) && !/<table\b/.test(src))
}

/* ========================================================================
 * 8b. 「当前那一次」只有一套（2026-11-07）
 *
 * 病根：宽表点日期只改本地的 `activeSessionId`，
 * 而体质／疗法档读的是 `ctx.visitId` —— **两套「当前那一次」各说各话**：
 * 宽表高亮的那次 ≠ 体质／疗法显示的那次 ≠ 关系图标的那次。
 * 修法：点日期时同时 `selectVisit()`，把全局上下文也切过去；
 *      「当前那一次」的推导先认表格里选中的那次。
 * ======================================================================== */
if (existsSync(visitPage)) {
  const visitAst = parseTsx(visitPage)
  const visitSf = visitAst.sf
  const visitNodes = walkAst(visitSf)
  const visitCalls = visitNodes.filter(ts.isCallExpression)

  // 看的是**调用点**，不是「这个名字出现过没有」——
  // import 里就有 selectVisit，搜词会被骗过。
  ok(
    '就诊页点日期会同步全局上下文（selectVisit 真有调用）',
    visitCalls.some((c) => ts.isIdentifier(c.expression) && c.expression.text === 'selectVisit'),
  )

  // 而且那个调用要落在 onSessionTap 里（不是别处）
  const onTapDecl = findVarDecl(visitNodes, visitSf, 'onSessionTap')
  ok(
    '全局上下文的切换就在「点日期」这个回调里',
    !!onTapDecl &&
      walkAst(onTapDecl).some(
        (c) => ts.isCallExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === 'selectVisit',
      ),
  )

  // 结构断言：「当前那一次」的推导里，**先认 activeSessionId、再退到 ctx.visitId**。
  // 比的是 `||` 链里运算数的**先后**，不靠下标 —— 换行、加注释都不影响它。
  const activeDecl = findVarDecl(visitNodes, visitSf, 'activeSession')
  ok('就诊页推导得出「当前那一次」', !!activeDecl)
  if (activeDecl) {
    const body = useMemoBody(activeDecl)
    const operands = body ? flattenOr(body) : []
    const iLocal = operands.findIndex((o) => o.getText(visitSf).includes('activeSessionId'))
    const iCtx = operands.findIndex((o) => o.getText(visitSf).includes('ctx.visitId'))
    ok(
      '「当前那一次」先认表格里选中的那次，再退到上下文那次',
      iLocal >= 0 && iCtx >= 0 && iLocal < iCtx,
      `activeSessionId@${iLocal} ctx.visitId@${iCtx}`,
    )
  }

  // 本地新建、还没落库的那次：体质／疗法只改本地，不去 PATCH（会 404）
  ok('就诊页认得「还没落库」的那几次（体质/疗法只改本地）', /pendingVisitIds/.test(visitAst.src))
}

/* ========================================================================
 * 9. 病例详情页：改完立刻落库 + 有「录入编辑」按钮
 * ======================================================================== */
if (existsSync(caseDetail)) {
  const src = read(caseDetail)
  ok('病例详情页改完立刻落库（updateVisit）', /updateVisit/.test(src))
  ok('病例详情页按「快照 diff」只写回被改动的那一次', /snapshot/.test(src) && /sameValues/.test(src))
  ok('病例详情页标题行有「录入编辑」按钮', /录入编辑/.test(src))
  // 2026-11-05：原来这一排是「寸关尺图示／存到相册／复制 Markdown／复制 CSV」四个按钮，
  // 现在图**直接显示**在页面上（diagram-view），按钮那一排整个去掉。
  ok('病例详情页直接显示寸关尺关系图（diagram-view）', /diagram-view/.test(src))
}

/* ========================================================================
 * 10. 就诊工作台：页内 tab + 全局上下文 + 底部操作条
 * ======================================================================== */
if (existsSync(visitPage)) {
  const src = read(visitPage)
  // 页内 tab 的档位**按 TABS 数组解析**，不全文搜词 ——
  // 否则注释里写一句「这里没有寸关尺图」就被当成「有这一档」。
  const tabsBlock = (src.match(/const TABS = \[[\s\S]*?\]/) || [''])[0]
  const tabLabels = [...tabsBlock.matchAll(/label: '([^']+)'/g)].map((m) => m[1])
  ok(
    '就诊工作台有 4 个页内 tab（摸脉/体质/疗法/方药）',
    tabLabels.length === 4 && tabLabels.join('/') === '摸脉/体质/疗法/方药',
    tabLabels.join('/'),
  )
  // 2026-11-06：原来三档是「脉象/判读/用药」。
  // 「判读」名不副实（里面全是使用者自己点选，工具不代判）→ 拆成「体质/疗法」；
  // 「用药」并进「方药」（依据网站端 TriadFrame：③ 开方药 → 开方药清单 ＋ 用药记录）。
  ok(
    '页内 tab 没有「判读」这一档（工具不代判，档名不能叫判读）',
    !tabLabels.includes('判读'),
    tabLabels.join('/'),
  )
  ok('页内 tab 没有「用药」这一档（已并进「方药」）', !tabLabels.includes('用药'), tabLabels.join('/'))
  ok('摸脉档挂的是 visit-pulse 组件', /VisitPulse/.test(src))
  // 体质/疗法/方药三档共用一个组件，按 section 分档。
  //
  // 「在不在这一档里」必须按**分支正文**判断，不能只比下标：
  // 把 MedicationPanel 挪成独立分支，它照样在 rx 之后、ActionBar 之前 ——
  // 下标法被骗过（已实测：这么改断言不红）。
  // 所以用「从 `tab === 'x'` 到本分支结尾的 `) : null}`」把正文切出来。
  const branchBody = (key) => {
    const m = src.match(new RegExp(`tab === '${key}'[\\s\\S]*?\\)\\s*:\\s*null\\}`))
    return m ? m[0] : ''
  }
  const rxBody = branchBody('rx')
  ok('方药档挂的是 visit-triad 的 section=\'rx\'', /section='rx'/.test(rxBody), rxBody.slice(0, 80))
  ok(
    '用药记录拼在「方药」档里（rx 分支正文里有 <MedicationPanel>）',
    /<MedicationPanel/.test(rxBody),
    rxBody.slice(0, 80),
  )
  ok(
    '体质档挂的是 visit-triad 的 section=\'constitution\'',
    /section='constitution'/.test(branchBody('constitution')),
  )
  ok(
    '疗法档挂的是 visit-triad 的 section=\'therapy\'',
    /section='therapy'/.test(branchBody('therapy')),
  )
  ok('摸脉档挂的是 visit-pulse 组件', /<VisitPulse/.test(branchBody('pulse')))
  ok(
    'visit-judge 组件已经不存在了（改名成 visit-triad）',
    !/VisitJudge/.test(src) && !existsSync(join(SRC, 'components', 'visit-judge')),
  )
  // 2026-11-06：原来这里还有第 4 档「寸关尺图」（外加底部一个「出图」按钮）。
  // 原生回退工程的录入页 `miniprogram/pages/record/record` 里**一个图示入口都没有** ——
  // 关系图属于「看」的页面（病例详情页），不进「录」的页面；而且两处摆着是重复的。
  ok(
    '就诊工作台**没有**「寸关尺图」这一档（录入页不放关系图）',
    !tabLabels.some((l) => l.includes('寸关尺')) && !/DiagramView/.test(src),
    tabLabels.join('/'),
  )
  const actionBarBlock = (src.match(/<ActionBar>[\s\S]*?<\/ActionBar>/) || [''])[0]
  ok(
    '就诊工作台底部没有「出图」按钮',
    !/出图/.test(actionBarBlock),
    actionBarBlock.replace(/\s+/g, ' ').slice(0, 120),
  )
  ok('就诊工作台用了吸顶上下文条', /context-bar/.test(src))
  ok('就诊工作台有底部固定操作条', /action-bar/.test(src))
  ok('就诊工作台切体例立刻落库（updatePatientLayout）', /updatePatientLayout/.test(src))
  ok('就诊工作台有「＋ 记录」加一次就诊', /onAddVisit/.test(src))
}

/* ========================================================================
 * 11. 全局上下文 store：持久化 + 纯函数
 * ======================================================================== */
const ctxStore = join(SRC, 'store', 'context.ts')
const ctxLogic = join(SRC, 'store', 'logic.ts')
ok('全局上下文 store 存在', existsSync(ctxStore))
ok('上下文的纯推导单独放在 logic.ts（可被回归断言）', existsSync(ctxLogic))
if (existsSync(ctxStore)) {
  const src = read(ctxStore)
  const typesSrc = existsSync(join(SRC, 'store', 'types.ts')) ? read(join(SRC, 'store', 'types.ts')) : ''
  ok('上下文会持久化（pulse.context）', /pulse\.context/.test(typesSrc) && /CONTEXT_KEY/.test(src))
  ok('上下文用 useSyncExternalStore 订阅（四个 tab 共用一份）', /useSyncExternalStore/.test(src))
}
if (existsSync(ctxLogic)) {
  const src = read(ctxLogic)
  ok('切患者会自动落到最近一次就诊', /pickLatestVisit/.test(src))
  ok('上下文标签能拼出来', /contextLabel/.test(src))
}

/* ========================================================================
 * 12. 平台适配层齐全
 * ======================================================================== */
// 2026-11-05：不再有「存到相册」→ platform/album.ts 随之删掉；平台适配层清单同步收窄
for (const name of ['storage', 'request', 'preview', 'auth', 'canvas']) {
  ok(`platform/${name}.ts 存在`, existsSync(join(SRC, 'platform', `${name}.ts`)))
}
const canvasFile = join(SRC, 'platform', 'canvas.ts')
if (existsSync(canvasFile)) {
  const src = read(canvasFile)
  ok('出图用共享绘制器（diagram），不是另写一套', /@export\/diagram/.test(src))
  ok('出图底图传的是真图片对象（不是尺寸占位）', /planDiagram\(img/.test(src))
  ok('出图有鸿蒙降级说明', /降级/.test(src))
}

/* ========================================================================
 * 13. 配置：alias / compiler / copy
 * ======================================================================== */
const taroConfig = read(join(TARO, 'config', 'index.ts'))
ok("alias 指向共享 domain（'@domain'）", /@domain/.test(taroConfig))
ok("alias 指向共享绘制器（'@export'）", /@export/.test(taroConfig))
ok('compiler 用 vite（鸿蒙 C-API 只支持 Vite）', /compiler:\s*'vite'/.test(taroConfig))
ok('配置里声明了 copy 规则（规则细节见 §22）', /copy:\s*\{/.test(taroConfig))

const projConfig = JSON.parse(read(join(TARO, 'project.config.json')))
ok('project.config.json 的 miniprogramRoot 指向 dist/', projConfig.miniprogramRoot === 'dist/')
ok('project.config.json 沿用同一个 appid', projConfig.appid === 'wx3a21eb903a16cbc4')

/* ========================================================================
 * 14. Taro 版本对齐
 * ======================================================================== */
const taroPkg = JSON.parse(read(join(TARO, 'package.json')))
const taroPkgs = { ...(taroPkg.dependencies || {}), ...(taroPkg.devDependencies || {}) }
const taroVersions = Object.entries(taroPkgs)
  .filter(([n]) => n.startsWith('@tarojs/'))
  .map(([, v]) => String(v).replace(/^[\^~]/, ''))
const versionSet = [...new Set(taroVersions)]
ok(
  `Taro 全家桶版本一致（${versionSet.join('/')}）`,
  versionSet.length === 1,
  versionSet.join('/'),
)
ok('装了鸿蒙 C-API 插件', '@tarojs/plugin-platform-harmony-cpp' in taroPkgs)
ok('React 与 Taro 的 peer 一致（^18）', /^[\^~]?18\./.test(String(taroPkgs.react || '')))

/* ========================================================================
 * 15. 通用件齐全
 * ======================================================================== */
for (const name of ['record-sheet', 'context-bar', 'sheet', 'sub-tabs', 'action-bar']) {
  ok(`通用件 components/${name} 存在`, existsSync(join(SRC, 'components', name, 'index.tsx')))
}

/* ========================================================================
 * 16. 事件绑定都有对应 handler（简化版：绑定的标识符在文件里出现过）
 * ======================================================================== */
const missingHandlers = []
for (const f of [...pageFiles, ...componentFiles]) {
  const src = read(f)
  const binds = [...src.matchAll(/on(?:Click|Input|Change|Confirm|Blur|Focus|Scroll)\{\(?\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
  for (const b of new Set(binds)) {
    if (!new RegExp(`(function\\s+${b}\\b|const\\s+${b}\\b|let\\s+${b}\\b|${b}\\s*[,)=:])`).test(src)) {
      missingHandlers.push(`${rel(f)}:${b}`)
    }
  }
}
ok('事件绑定的 handler 都有定义', missingHandlers.length === 0, missingHandlers.slice(0, 5).join(' '))

/* ========================================================================
 * 17. useEffect 的依赖不是空数组（除非确实只跑一次）
 * ======================================================================== */
const suspiciousEffects = []
for (const f of [...pageFiles, ...componentFiles]) {
  const src = read(f)
  const effects = [...src.matchAll(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[([^\]]*)\]\)/g)]
  for (const m of effects) {
    const deps = m[1].trim()
    // 依赖为空但 effect 体内用了 state / props —— 可疑
    if (!deps && /\b(set[A-Z]\w*|props\.|ctx\.)\b/.test(m[0])) {
      suspiciousEffects.push(rel(f))
    }
  }
}
ok('useEffect 的依赖数组不是漏写的空数组', suspiciousEffects.length === 0, [...new Set(suspiciousEffects)].slice(0, 5).join(' '))

/* ========================================================================
 * 18. 术语纪律：原文用字不许被改写
 * ======================================================================== */
const FORBIDDEN_TERMS = [
  { bad: '尺脉有力', why: '讲稿原话是「有尺脉」' },
  { bad: '「三法」', why: '三焦疗法／五脏疗法／一体疗法是并列的三种，勿合并为「三法」' },
  { bad: '上盛下虚证', why: '原词是「上盛下虚」' },
]
const termOffenders = []
for (const f of tsxFiles) {
  const src = read(f)
  for (const t of FORBIDDEN_TERMS) {
    if (src.includes(t.bad)) termOffenders.push(`${rel(f)}→${t.bad}`)
  }
}
ok('没有把原文用字改写成别的', termOffenders.length === 0, termOffenders.join(' '))

/* ========================================================================
 * 19. 免责声明
 * ======================================================================== */
const disclaimerMiss = []
for (const f of pageFiles) {
  const relPath = rel(f)
  if (!/visit|case-detail/.test(relPath)) continue
  const src = read(f)
  if (!src.includes('不构成诊断')) disclaimerMiss.push(relPath)
}
ok('就诊页与病例详情页有「不构成诊断」声明', disclaimerMiss.length === 0, disclaimerMiss.join(' '))

/* ========================================================================
 * 20. 出处标注：讲义／讲稿／同和堂版
 * ======================================================================== */
const sourceMiss = []
for (const f of pageFiles) {
  const src = read(f)
  // 这里只扫 `src/pages` —— 页面里的知识页只有「用方」一处。
  // （原来这里还写着 `|visit-judge`，但那是**组件**，永远匹配不上 —— 是个空转的分支。）
  if (!/formulas/.test(rel(f))) continue
  if (!/讲义|讲稿|同和堂版/.test(src)) sourceMiss.push(rel(f))
}
ok('知识页有出处标注（讲义／讲稿／同和堂版）', sourceMiss.length === 0, sourceMiss.join(' '))

/**
 * 组件侧同理 —— **这条以前是空转的**：
 * 原来只扫 `pageFiles`（`src/pages` 下的 .tsx），而 `visit-judge` 是**组件**，
 * 那个过滤条件永远匹配不上 —— 组件里的方剂组成有没有标出处，**根本没人在查**。
 * 2026-11-06 起组件改名 `visit-triad`，这里把范围补上（`medication-panel` 一并查）。
 *
 * ⚠️ 查的是**渲染出来的字**（代码里的字面量），**不是全文搜「讲义」** ——
 * 全文搜区分不出「标签还在不在」：两个文件的注释里到处都写着「讲义／讲稿／同和堂版」，
 * 把标签全删了照样搜得到（实测：故意抹掉出处标注，这条断言照样绿）。
 */
const triadFile = join(SRC, 'components', 'visit-triad', 'index.tsx')
const medFile = join(SRC, 'components', 'medication-panel', 'index.tsx')
for (const [label, f] of [
  ['visit-triad', triadFile],
  ['medication-panel', medFile],
]) {
  if (!existsSync(f)) {
    ok(`${label} 组件存在`, false, f)
    continue
  }
  const src = read(f)
  ok(`${label} 组件存在`, true)
  ok(`${label} 标着「同和堂版（克）」`, /'同和堂版（克）'/.test(src))
  ok(`${label} 标着「讲稿 2010（比例制）」`, /'讲稿 2010（比例制）'/.test(src))
  ok(`${label} 每条都带出处方括号〔…〕`, /〔\{[^}]+\.source\}〕/.test(src))
}

/* ========================================================================
 * 21. 隐私接口清单（微信后台《用户隐私保护指引》必须同步）
 * ======================================================================== */

/**
 * **已知**的隐私接口 —— 这就是「后台该勾哪几项」的唯一真源。
 *
 * 每个接口对应后台要勾的隐私类型（值即类型名）：
 *   saveImageToPhotosAlbum → 「相册（仅写入）」
 *   setClipboardData        → 「剪切板」
 *
 * ⚠️ 微信的隐私接口**没在后台声明就直接 fail**（errno 112），
 * 而且**用户在设置里也打不开** —— 开发者侧配置缺失，用户改不了。
 *
 * ## 上线包 vs 回退工程（2026-11-05）
 *
 * `miniprogram/` 是**原生回退工程**，不上传微信后台；
 * 真正上线的是 `taro/`。所以：
 *   · **后台勾哪些** —— 按**上线包（Taro）**实际调用的算；
 *   · 清单里留着回退工程还在用的那两个 —— 它俩在 Taro 里已经删干净了，
 *     回退工程若改用它上线，才需要重新勾。
 */
const KNOWN_PRIVACY_APIS = {
  saveImageToPhotosAlbum: '相册（仅写入）',
  setClipboardData: '剪切板',
}

/**
 * 候选池 —— 微信隐私接口里**常用的**那些。
 *
 * 为什么要有候选池：光比对「已知清单」永远发现不了**新增**的接口
 * （清单里没有的，扫出来也不会报）。
 * 所以先拿候选池去扫代码，扫到谁，再问「这人是不是在已知清单里」。
 */
const WECHAT_PRIVACY_API_CANDIDATES = [
  // 相册
  'saveImageToPhotosAlbum', 'chooseImage', 'chooseMedia', 'getSavedMediaList',
  // 剪切板
  'setClipboardData', 'getClipboardData',
  // 位置
  'getLocation', 'getFuzzyLocation', 'onLocationChange', 'openLocation', 'chooseLocation',
  // 通讯录
  'chooseContact', 'chooseAddress',
  // 手机号
  'getPhoneNumber',
  // 用户信息
  'getUserProfile', 'getUserInfo', 'chooseAvatar', 'chooseNickName',
  // 摄像头 / 麦克风
  'startRecord', 'camera',
  // 蓝牙
  'getBluetoothAdapterState', 'getBluetoothDevices',
]

/** 扫一批文件里调了哪些隐私接口（去注释，只看代码行） */
function findPrivacyCalls(files) {
  const found = new Set()
  for (const f of files) {
    const src = stripComments(read(f))
    for (const api of WECHAT_PRIVACY_API_CANDIDATES) {
      if (new RegExp(`(?:Taro|wx)\\.${api}\\b`).test(src)) found.add(api)
    }
  }
  return found
}

/** 上线包（Taro）实际调用的隐私接口 —— **后台就按这个勾** */
const taroPrivacyCalls = findPrivacyCalls(tsxFiles)
/** 原生回退工程（不上传）调用的隐私接口 */
const legacyPrivacyCalls = findPrivacyCalls(
  walk(join(ROOT, 'miniprogram'), [], (p) => p.endsWith('.js')),
)
const usedPrivacyApis = new Set([...taroPrivacyCalls, ...legacyPrivacyCalls])

const unknownPrivacy = [...usedPrivacyApis].filter((a) => !(a in KNOWN_PRIVACY_APIS))
ok(
  `调用的隐私接口都在已知清单里（仓库共 ${usedPrivacyApis.size} 个：${[...usedPrivacyApis].join('、') || '无'}）`,
  unknownPrivacy.length === 0,
  unknownPrivacy.join(' ') + ' —— 新增隐私接口要同步：① 本清单 ② 微信后台隐私指引 ③ docs/miniprogram-release-checklist.md',
)

const stalePrivacy = Object.keys(KNOWN_PRIVACY_APIS).filter((a) => !usedPrivacyApis.has(a))
ok('已知清单里的隐私接口都还在用（清单不能留着已废弃的）', stalePrivacy.length === 0, stalePrivacy.join(' '))

const privacyPagePath = join(SRC, 'pages', 'privacy', 'index.tsx')
/** 政策页的**正文**（去掉注释 —— 注释里会解释「以前有、现在没了」，那不是声明） */
const privacyPage = existsSync(privacyPagePath) ? stripComments(read(privacyPagePath)) : ''

/**
 * 隐私政策页要跟**上线包实际调用**对齐，两个方向都要对：
 *   · 上线包用到的类型 → 政策页**必须**写明（漏写＝告知缺失）；
 *   · 上线包没用到的类型 → 政策页**不能**写（写了＝声明了却没用，对不上后台）。
 */
const shippedTypes = [...new Set([...taroPrivacyCalls].map((a) => KNOWN_PRIVACY_APIS[a]))]
const undeclaredTypes = shippedTypes.filter((t) => !privacyPage.includes(t))
ok(
  `隐私政策页写明了上线包用到的每种隐私类型（当前 ${shippedTypes.length} 种：${shippedTypes.join('、') || '无'}）`,
  privacyPage !== '' && undeclaredTypes.length === 0,
  undeclaredTypes.join(' '),
)

const overdeclared = Object.values(KNOWN_PRIVACY_APIS).filter(
  (t) => !shippedTypes.includes(t) && privacyPage.includes(t),
)
ok(
  '隐私政策页没有声明上线包没用到的隐私类型（声明了却没用＝对不上后台）',
  overdeclared.length === 0,
  overdeclared.join(' ') + ' —— 要么把调用删掉，要么把政策页改回来',
)

const mePagePath = join(SRC, 'pages', 'me', 'index.tsx')
ok(
  '「我的」页有隐私政策入口（审核要求小程序内可见）',
  existsSync(mePagePath) && read(mePagePath).includes('pages/privacy/index'),
)

/* ========================================================================
 * 21b. 小程序不再提供导出（2026-11-05 维护者定）
 * ======================================================================== */

/**
 * ## 这条锁的是什么
 *
 * 维护者 2026-11-05 定：**寸关尺关系图直接显示在页面上**，
 * 「存到相册」「复制 Markdown」「复制 CSV」三个导出选项**删掉**。
 *
 * 连带的后果（也要锁住，否则会漂回去）：
 *   · 小程序**不再调用任何隐私接口** → 微信后台《用户隐私保护指引》**一项都不用勾**；
 *   · 不再有「整表 PNG 导出」→ `platform/canvas.ts` 里只出图示这一张；
 *   · 网站端**不受影响**（那边的 PNG 导出在 `src/export/png.ts`，与小程序无关）。
 */
const EXPORT_OPTION_WORDS = ['存到相册', '复制 Markdown', '复制 CSV', '存相册']
// 只查**有过那几个按钮的页面** —— 隐私政策页会提到「不提供存相册这类导出」，那是正文，不是按钮
for (const p of ['pages/case-detail/index.tsx', 'pages/visit/index.tsx']) {
  const src = stripComments(read(join(SRC, p)))
  const hit = EXPORT_OPTION_WORDS.filter((w) => src.includes(w))
  ok(`${p} 里没有导出选项的文案`, hit.length === 0, hit.join(' '))
}

ok(
  '上线包不再调用任何隐私接口（后台隐私指引一项都不用勾）',
  taroPrivacyCalls.size === 0,
  [...taroPrivacyCalls].join(' '),
)

ok(
  'platform/album.ts 与 platform/clipboard.ts 已删掉（没有导出就没有这两个平台模块）',
  !existsSync(join(SRC, 'platform', 'album.ts')) && !existsSync(join(SRC, 'platform', 'clipboard.ts')),
)

const diagramViewPath = join(SRC, 'components', 'diagram-view', 'index.tsx')
ok(
  '寸关尺关系图有专门的展示组件（直接显示在页面上）',
  existsSync(diagramViewPath) && read(diagramViewPath).includes('renderDiagramImage'),
)

// 关系图**只在病例详情页**（「看」的页面）摆着 —— 就诊工作台（「录」的页面）不放。
// 原生回退工程的规矩：`miniprogram/pages/record/record` 里一个图示入口都没有。
ok(
  'pages/case-detail/index.tsx 用了 diagram-view（图直接显示，不是按钮弹窗）',
  read(join(SRC, 'pages/case-detail/index.tsx')).includes('diagram-view'),
)
ok(
  'pages/visit/index.tsx **不用** diagram-view（录入页不放关系图）',
  !read(join(SRC, 'pages/visit/index.tsx')).includes('diagram-view'),
)

/* ========================================================================
 * 22. 出图底图必须真进包（2026-11-05）
 * ======================================================================== */

/**
 * 把 `taro/config/index.ts` **真的跑一遍**，拿 `copy.patterns`。
 *
 * ## 为什么要真跑，不能用正则猜
 *
 * 这一节的规则用正则看不出来，而这两个规则错了**不报错** ——
 * 图只是安安静静地没进包，真机上点「看寸关尺图示」才提示「底图没载入」。
 *
 * ## 两条规则（都是实测踩出来的）
 *
 * 1. **`from` 必须用正斜杠。**
 *    copy 插件底层是 fast-glob，而 fast-glob 里反斜杠是转义符 ——
 *    Windows 上 `path.resolve()` 给的反斜杠绝对路径**一律匹配 0 个，而且不报错**。
 * 2. **`to` 必须带扩展名。**
 *    Taro 的 `convertCopyOptions`：`to` 带扩展名 → `to` 取目录部分、`rename` 取文件名；
 *    `to` 不带扩展名（写成 `assets/`）→ `rename` 被塞成 `'/'`，
 *    而复制器把字符串型 `rename` **直接当目标文件名** → 所有图撞到同一路径 → 只剩最后一张。
 *
 * ## 怎么跑这份配置
 *
 *   · esbuild 打成 **CJS** —— 配置里用了 `__dirname`，ESM 里没这个变量；
 *   · 桩掉 `@tarojs/cli` —— 只需要它的 `defineConfig`（原样返回那个工厂函数）；
 *   · 调一次工厂，拿合并后的配置。
 */
let copyPatterns = []
{
  let esbuildBuild = null
  try {
    const esm = await import(pathToFileURL(join(TARO, 'node_modules', 'esbuild', 'lib', 'main.js')).href)
    esbuildBuild = esm.build
  } catch {
    esbuildBuild = null
  }
  ok('taro 子工程依赖已安装（回归要用 taro/node_modules/esbuild）', !!esbuildBuild, '先跑：npm --prefix taro install')

  if (esbuildBuild) {
    const stubDir = mkdtempSync(join(tmpdir(), 'taro-lint-'))
    try {
      const stubFile = join(stubDir, 'taro-cli-stub.cjs')
      writeFileSync(stubFile, 'exports.defineConfig = (fn) => fn\n', 'utf8')
      const out = await esbuildBuild({
        entryPoints: [join(TARO, 'config', 'index.ts')],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        write: false,
        // 配置靠 __dirname 定位自己（ROOT / SHARED 都是从它算出来的）；
        // bundle 落在临时目录会算错，所以把 __dirname 直接钉成配置真实所在目录。
        define: { __dirname: JSON.stringify(join(TARO, 'config')) },
        plugins: [
          {
            name: 'stub-taro-cli',
            setup(b) {
              b.onResolve({ filter: /^@tarojs\/cli$/ }, () => ({ path: stubFile }))
            },
          },
        ],
      })
      const bundleFile = join(stubDir, 'config.cjs')
      writeFileSync(bundleFile, out.outputFiles[0].text, 'utf8')
      const requireCjs = createRequire(import.meta.url)
      const factory = requireCjs(bundleFile).default
      const merged = await factory((...objs) => Object.assign({}, ...objs))
      copyPatterns = (merged && merged.copy && merged.copy.patterns) || []
    } finally {
      try {
        rmSync(stubDir, { recursive: true, force: true })
      } catch {
        /* 临时目录清不掉不影响结论 */
      }
    }
  }
}

ok('配置里有 copy 规则（出图底图靠它进包）', copyPatterns.length > 0, `当前 ${copyPatterns.length} 条`)

const backslashFrom = copyPatterns.filter((p) => String(p.from).includes('\\'))
ok(
  'copy 的 from 全用正斜杠（fast-glob 不认 Windows 反斜杠，会静默匹配 0 个 → 图没进包）',
  backslashFrom.length === 0,
  backslashFrom.map((p) => String(p.from)).join(' '),
)

const noExtTo = copyPatterns.filter((p) => !extname(String(p.to)))
ok(
  'copy 的 to 都带扩展名（否则 rename 被塞成 "/"，所有图撞到同一路径，只剩最后一张）',
  noExtTo.length === 0,
  noExtTo.map((p) => String(p.to)).join(' '),
)

const missingFrom = copyPatterns.filter((p) => !existsSync(String(p.from)))
ok('copy 的 from 都指向真实存在的文件', missingFrom.length === 0, missingFrom.map((p) => String(p.from)).join(' '))

// 代码里写的包内路径，必须和 copy 规则真能产出的路径对得上
const canvasSrc = read(join(SRC, 'platform', 'canvas.ts'))
const handsMatch = canvasSrc.match(/const HANDS_IMAGE = '([^']+)'/)
ok('canvas.ts 里写死了底图路径', !!handsMatch)
const handsImage = handsMatch ? handsMatch[1] : ''
const copyOutPaths = copyPatterns.map((p) => '/' + String(p.to).replace(/^\/+/, ''))
ok(
  `canvas.ts 的底图路径 ${handsImage} 与 copy 规则能对上`,
  copyOutPaths.includes(handsImage),
  `copy 产出：${copyOutPaths.join(' ') || '(无)'}`,
)

// 产物层（编过才有）—— 逐字节比对，防止图被改坏或路径对不上
const DIST = join(TARO, 'dist')
if (existsSync(DIST)) {
  const { createHash } = await import('node:crypto')
  const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')
  for (const p of copyPatterns) {
    const built = join(DIST, String(p.to))
    ok(`产物里有 ${p.to}`, existsSync(built))
    if (existsSync(built) && existsSync(String(p.from))) {
      ok(`产物 ${basename(String(p.to))} 与真源逐字节一致`, sha(built) === sha(String(p.from)))
    }
  }
}

/* ========================================================================
 * 23. 产物里不许残留 Node 专有全局量（2026-11-05）
 * ======================================================================== */

/**
 * ## 为什么要有这一节
 *
 * 小程序运行时**没有 `process` 这个全局量**（浏览器有，是打包器 polyfill 的）。
 * 源码里写 `process.env.XXX` 只有在 **编译期被 define 替换掉**时才安全。
 *
 * 一旦 define 没生效（比如配置里那段被删了、键名写错、构建器换了），
 * 产物里就会留下 `process.env.XXX` → 小程序**启动就抛**
 * 「ReferenceError: process is not defined」→ 页面全白、元素查不到。
 *
 * ## 这类错为什么容易漏
 *
 * - 构建**不报错**，测试**全绿**（断言查的是源码与产物文件在不在，不查运行时）；
 * - 模拟器截图是**纯白一张**，看着像「截图功能坏了」，其实是**小程序崩了**；
 * - 元素查询（`page.$$()`）会**一直挂着**，看起来像自动化端口的问题。
 *
 * 所以这里直接查**产物**：只要产物里还有 `process.` 残留，就是错的。
 */
if (existsSync(DIST)) {
  const distJs = walk(DIST, [], (p) => p.endsWith('.js'))
  const processOffenders = distJs.filter((f) => /(^|[^.\w$])process\s*\./.test(read(f)))
  ok(
    '产物里没有残留 process.xxx（小程序运行时没有 process 全局量，残留就是启动即崩、整屏白）',
    processOffenders.length === 0,
    processOffenders.slice(0, 5).map((f) => rel(f)).join(' '),
  )

  const defineInConfig = /defineConstants\s*:/.test(read(join(TARO, 'config', 'index.ts')))
  ok('配置里有 defineConstants（编译期注入默认 API 地址靠它）', defineInConfig)
} else {
  ok('还没构建，产物检查跳过（先跑 npm run mp:taro:build）', true)
}

/* ========================================================================
 * 24. 共享绘制代码必须能在「微信式 canvas 2d」上跑通（2026-11-05）
 * ======================================================================== */

/**
 * ## 这一节抓的是什么
 *
 * 真机点「看寸关尺图示」弹过这个错：
 *
 *   Failed to execute 'roundRect' on 'CanvasRenderingContext2D':
 *   The provided value cannot be converted to a sequence.
 *
 * 根因：微信的 canvas 2d 把 `roundRect` 的半径按**序列**收，
 * 而共享绘制代码 `src/export/diagram.ts` 传的是**单个数字** → 整个出图抛错、只弹一个 toast。
 *
 * ## 为什么要「拿假 ctx 真跑一遍」
 *
 * 这类错**编译器抓不到、常规测试也抓不到**：
 *
 *   · `PainterCtx` 是结构类型，`roundRect` 压根不在类型里（用 `as unknown` 转的）→ tsc 无感；
 *   · 浏览器（Chrome/Safari/Firefox）数字与数组**都收** → 网站端跑得好好的；
 *   · 只有真的在小程序的 canvas 2d 上画，才会炸 —— 而小程序侧此前**没有出图链路的回归**。
 *
 * 所以这里照微信的规矩造一个**假 ctx**：
 *   · `roundRect` 的半径不是数组就抛 TypeError（与微信一模一样）；
 *   · 其它方法只记录不画。
 * 再把**真的那份绘制代码**灌进去跑 —— 抛了就说明这条共享代码在小程序上会炸。
 *
 * ## 覆盖三种 ctx
 *
 *   1. **微信式**（半径必须是序列）→ 主场景，必须一次不抛；
 *   2. **roundRect 一直抛**（假想某个基础库版本不收数组）→ 必须靠手写圆角路径兜底；
 *   3. **压根没有 roundRect**（老浏览器／老基础库）→ 同上。
 */
function makeFakeCtx(mode) {
  const calls = {
    roundRect: 0,
    radii: [],
    quadraticCurveTo: 0,
    closePath: 0,
    rect: 0,
    drawImage: 0,
    fillText: 0,
  }
  const ctx = {
    save() {},
    restore() {},
    translate() {},
    scale() {},
    fillRect() {},
    clearRect() {},
    rect() {
      calls.rect += 1
    },
    fillText() {
      calls.fillText += 1
    },
    measureText() {
      return { width: 10 }
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {
      calls.quadraticCurveTo += 1
    },
    closePath() {
      calls.closePath += 1
    },
    stroke() {},
    fill() {},
    setLineDash() {},
    drawImage() {
      calls.drawImage += 1
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
  }
  if (mode !== 'none') {
    ctx.roundRect = function (_x, _y, _w, _h, radii) {
      calls.roundRect += 1
      calls.radii.push(radii)
      if (mode === 'alwaysThrow') {
        throw new TypeError(
          "Failed to execute 'roundRect' on 'CanvasRenderingContext2D': The provided value cannot be converted to a sequence.",
        )
      }
      if (!Array.isArray(radii)) {
        throw new TypeError(
          "Failed to execute 'roundRect' on 'CanvasRenderingContext2D': The provided value cannot be converted to a sequence.",
        )
      }
    }
  }
  return { ctx, calls }
}

/** 把共享绘制代码（src/export/diagram.ts）用 esbuild 打成可执行的 ESM */
let diagramMod = null
{
  let esm = null
  try {
    esm = await import(pathToFileURL(join(TARO, 'node_modules', 'esbuild', 'lib', 'main.js')).href)
  } catch {
    esm = null
  }
  if (esm) {
    const stubDir = mkdtempSync(join(tmpdir(), 'taro-lint-draw-'))
    try {
      const out = await esm.build({
        entryPoints: [join(ROOT, 'src', 'export', 'diagram.ts')],
        bundle: true,
        platform: 'node',
        format: 'esm',
        write: false,
      })
      const file = join(stubDir, 'diagram.mjs')
      writeFileSync(file, out.outputFiles[0].text, 'utf8')
      diagramMod = await import(pathToFileURL(file).href)
    } catch (e) {
      diagramMod = null
      ok('共享绘制代码能编译出来（回归要真跑 src/export/diagram.ts）', false, String(e?.message || e))
    } finally {
      try {
        rmSync(stubDir, { recursive: true, force: true })
      } catch {
        /* 临时目录清不掉不影响结论 */
      }
    }
  }
  ok('共享绘制代码能编译出来（回归要真跑 src/export/diagram.ts）', !!diagramMod)
}

if (diagramMod) {
  const drawSet = {
    name: '回归',
    layout: 'nine',
    sessions: [
      {
        id: 's1',
        label: '1月1日',
        values: { 'L|寸|浮': ['有'], 'R|关|中': ['↑'] },
      },
    ],
  }
  const drawSession = drawSet.sessions[0]
  const drawPlan = { image: { width: 1070, height: 876 }, scale: 1, dx: 0, dy: 0, w: 1070, h: 876 }

  const run = (mode) => {
    const fake = makeFakeCtx(mode)
    let err = null
    try {
      diagramMod.drawDiagram(fake.ctx, drawPlan, drawSet, drawSession)
    } catch (e) {
      err = e
    }
    return { fake, err }
  }

  // 1) 微信式 ctx：半径必须是序列
  const wxRun = run('strict')
  ok(
    '在「微信式 canvas 2d」上画图示不抛错（整个出图不能失败：只弹 toast 用户什么都拿不到）',
    !wxRun.err,
    wxRun.err ? String(wxRun.err?.message || wxRun.err) : '',
  )
  ok(
    '六个标记块的圆角都画了，且半径每次都是数组',
    wxRun.fake.calls.roundRect === 6 && wxRun.fake.calls.radii.every((r) => Array.isArray(r)),
    `实际 ${wxRun.fake.calls.roundRect} 次，首个半径参数 ${JSON.stringify(wxRun.fake.calls.radii[0])}`,
  )
  ok('底图画进去了（drawImage 调过一次）', wxRun.fake.calls.drawImage === 1, `实际 ${wxRun.fake.calls.drawImage} 次`)

  // 2) roundRect 一直抛 → 必须靠手写圆角路径兜底
  const throwRun = run('alwaysThrow')
  ok(
    'roundRect 不可用时仍能画出来（手写圆角路径兜底，不能让出图整个失败）',
    !throwRun.err,
    throwRun.err ? String(throwRun.err?.message || throwRun.err) : '',
  )
  ok(
    '兜底路径真的画了圆角（每块 4 段二次曲线 × 6 块 = 24 段）',
    throwRun.fake.calls.quadraticCurveTo === 24,
    `实际 ${throwRun.fake.calls.quadraticCurveTo} 段`,
  )
  ok('兜底路径用 closePath 收了口', throwRun.fake.calls.closePath === 6, `实际 ${throwRun.fake.calls.closePath} 次`)
  ok('兜底路径没有退化成直角矩形', throwRun.fake.calls.rect === 0, `实际 ${throwRun.fake.calls.rect} 次`)

  // 3) 压根没有 roundRect → 同上
  const noneRun = run('none')
  ok(
    'ctx 没有 roundRect 时仍能画出来',
    !noneRun.err,
    noneRun.err ? String(noneRun.err?.message || noneRun.err) : '',
  )
  ok(
    '没有 roundRect 时靠手写圆角路径（24 段二次曲线）',
    noneRun.fake.calls.quadraticCurveTo === 24,
    `实际 ${noneRun.fake.calls.quadraticCurveTo} 段`,
  )
}

/* ========================================================================
 * 25. 代码质量两条「未通过」不许复现（2026-11-05）
 * ======================================================================== */

/**
 * ## 这一节抓的是什么
 *
 * 微信开发者工具「代码质量」面板里两条 **未通过**：
 *
 *   · **代码压缩 → JS文件：对JS文件进行压缩**（未通过）
 *   · **代码包 → 图片和音频资源大小不应超过 200 K**（未通过）
 *
 * 官方规则原文（微信开放文档「性能扫描 / 代码质量」）：
 *
 *   > 图片和音频资源大小超过 200 K【建议】……建议图片、音频等静态资源体积大小超过 200K 时，
 *   > 将它们上传到 CDN，用 URL 引入会是个更好的选择。
 *   > 未开启JS压缩【必须】在工具「详情」-「本地设置」中开启「上传代码时自动压缩脚本文件」的设置
 *
 * ## 为什么这两条必须进回归
 *
 * 它们**不拦编译、不拦测试、不拦本地运行** —— 只在开发者工具扫代码质量时才报，
 * 而且要等到**上传前**才暴露。等到那时候才发现，返工的是整个包。
 * 更麻烦的是第 2 条：底图是照片类素材，**PNG 无损压不动**（300 KB 地板），
 * 一旦有人把底图换回 PNG，这条立刻复发 —— 而真机上只表现为「图有点糊」，没人会去查体积。
 *
 * ## 断言拆成五块
 *
 *   1. `project.config.json` 的 `minified` 必须为 true（对应「未开启JS压缩」）；
 *   2. 产物里**没有单个 > 200 KB 的图片/音频**（对应「图片和音频资源大小不应超过 200 K」）；
 *   3. 底图**尺寸必须是 1070 × 876**（缩小会让覆盖层标记跑位 —— 见 `src/domain/diagram.ts`）；
 *   3b. 底图 JPEG **内容必须与 PNG 真源一致**（解码回读逐像素比 —— 抓「体积合规但内容是废图」）；
 *   4. `triad-p47.png` **不许进小程序包**（小程序端没人引用它，白带 91.6 KB）。
 */
{
  /* --- 1. JS 压缩开关 --- */
  const projCfg = JSON.parse(read(join(TARO, 'project.config.json')))
  ok(
    'project.config.json 开了 minified（开发者工具「未开启JS压缩」就是这条）',
    projCfg.setting && projCfg.setting.minified === true,
    `当前 setting.minified = ${JSON.stringify(projCfg.setting?.minified)}`,
  )
  ok(
    'project.config.json 开了 minifyWXSS（WXSS 压缩）',
    projCfg.setting && projCfg.setting.minifyWXSS === true,
    `当前 setting.minifyWXSS = ${JSON.stringify(projCfg.setting?.minifyWXSS)}`,
  )
  ok(
    'project.config.json 开了 minifyWXML（WXML 压缩）',
    projCfg.setting && projCfg.setting.minifyWXML === true,
    `当前 setting.minifyWXML = ${JSON.stringify(projCfg.setting?.minifyWXML)}`,
  )

  /* --- 2. 产物里没有超 200 KB 的图片/音频 --- */
  const LIMIT = 200 * 1024
  if (existsSync(DIST)) {
    const mediaExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp3', '.wav', '.m4a', '.mp4'])
    const mediaFiles = walk(DIST, [], (p) => mediaExts.has(extname(p).toLowerCase()))
    const oversize = mediaFiles.filter((f) => statSync(f).size >= LIMIT)
    ok(
      `产物里没有单个 ≥ 200 KB 的图片/音频（开发者工具「图片和音频资源大小不应超过 200 K」）`,
      oversize.length === 0,
      oversize.map((f) => `${rel(f)} ${statSync(f).size}B`).join(' '),
    )
    const totalMedia = mediaFiles.reduce((s, f) => s + statSync(f).size, 0)
    ok(
      `产物里图片/音频总量 ${(totalMedia / 1024).toFixed(1)} KB（提审时整包都要过）`,
      totalMedia < LIMIT * 2,
      `${totalMedia}B`,
    )
  } else {
    ok('还没构建，产物体积检查跳过（先跑 npm run mp:taro:build）', true)
  }

  /* --- 3. 底图尺寸不变 --- */
  const jpgPath = join(ROOT, 'src', 'assets', 'hands-pulse.jpg')
  ok('底图 JPEG 存在（scripts/compress-assets.mjs 生成）', existsSync(jpgPath), rel(jpgPath))
  if (existsSync(jpgPath)) {
    const jpgBytes = statSync(jpgPath).size
    ok(
      `底图 JPEG ${(jpgBytes / 1024).toFixed(1)} KB < 200 KB（超了开发者工具那条就红）`,
      jpgBytes < LIMIT,
      `${jpgBytes}B`,
    )
    // JPEG 的 SOF0 段带尺寸，直接读字节头，不引依赖
    const buf = readFileSync(jpgPath)
    let w = 0
    let h = 0
    for (let i = 0; i < buf.length - 9; i++) {
      if (buf[i] === 0xff && (buf[i + 1] & 0xf0) === 0xc0) {
        h = buf.readUInt16BE(i + 5)
        w = buf.readUInt16BE(i + 7)
        break
      }
    }
    ok(
      '底图 JPEG 尺寸仍是 1070×876（缩小会让覆盖层标记跑位：坐标是按原图像素量的）',
      w === 1070 && h === 876,
      `实际 ${w}×${h}`,
    )

    /* --- 3b. 底图 JPEG 内容必须与 PNG 真源一致 --- */
    // 2026-11-05 踩过的坑：`jpeg-js` 的编码器按 **RGBA（4 字节/像素）** 读 stride，
    // 喂 RGB 会产出**体积合规、尺寸合规、内容却斜切成废图**的 JPEG。
    // 「存在 / <200KB / 1070×876」三条断言全绿 —— 只有把图渲染出来才发现是废图。
    // 所以这里解码回来跟 PNG 真源逐像素比，把这类错钉死在静态这关。
    const pngPath = join(ROOT, 'src', 'assets', 'hands-pulse.png')
    if (existsSync(pngPath)) {
      let cmp = null
      let err = ''
      try {
        const dec = jpeg.decode(readFileSync(jpgPath))
        const png = PNG.sync.read(readFileSync(pngPath))
        if (dec.width !== png.width || dec.height !== png.height) {
          err = `尺寸对不上：JPEG ${dec.width}×${dec.height} vs PNG ${png.width}×${png.height}`
        } else {
          let sumAbs = 0
          let sumSq = 0
          let n = 0
          for (let i = 0; i < dec.data.length; i += 4) {
            for (let c = 0; c < 3; c++) {
              const d = Math.abs(dec.data[i + c] - png.data[i + c])
              sumAbs += d
              sumSq += d * d
              n++
            }
          }
          if (!n) err = '像素数据是空的'
          else {
            const mse = sumSq / n
            cmp = {
              mae: sumAbs / n,
              psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse),
            }
          }
        }
      } catch (e) {
        err = String(e?.message || e)
      }
      ok(
        '底图 JPEG 解码回来与 PNG 真源一致（MAE ≤ 12、PSNR ≥ 15 dB —— 抓「合规但内容是废图」）',
        !err && cmp && cmp.mae <= 12 && cmp.psnr >= 15,
        err || (cmp ? `MAE ${cmp.mae.toFixed(2)} / PSNR ${cmp.psnr.toFixed(2)} dB` : '没比出结果'),
      )
    } else {
      ok('PNG 真源不在（跳过底图内容一致性比对）', true)
    }
  }
  ok(
    'PNG 真源保留（网站端 PNG 导出要无损底图，JPEG 会二次压缩）',
    existsSync(join(ROOT, 'src', 'assets', 'hands-pulse.png')),
  )

  /* --- 4. triad-p47.png 不许进小程序包 --- */
  if (existsSync(DIST)) {
    ok(
      'triad-p47.png 不在小程序包里（小程序端没人引用它，白带 91.6 KB）',
      !existsSync(join(DIST, 'assets', 'triad-p47.png')),
    )
  }
}

/* ========================================================================
 * 26. 三部曲 ③ ↔ 「用方」知识库：方名可点 → 跳过去并定位（2026-11-06）
 *
 * ## 为什么要有这一节
 *
 * ③ 的方名（讲义 p47 图上的「清挡路方」「引火归元」「上焦方」…）与「用方」知识库里的条目
 * **是同一个方在不同资料里的不同写法**。两边曾经是断的：③ 里看得见方名，
 * 却点不进去看组成／服法／禁忌。这一节守住那条链路。
 *
 * ## 断言为什么按结构切，不全文搜词
 *
 * 全文搜词会被注释骗过（「这里应该跳到用方页」写在注释里就算过），
 * 比下标也会被骗（把判断挪个位置，下标法照样绿）。所以：
 *
 *   ① 先 `stripComments` —— 只留**可执行代码**；
 *   ② 再按**大括号配平**（`sliceBraces`）或**顶层声明**（`topLevelChunks`）切出具体那一段；
 *   ③ 在**这一段里**断言 —— 段外的东西一律不算数。
 * ======================================================================== */

/**
 * 从 `from` 下标开始，按**大括号配平**切出一段代码（含首尾大括号）。
 *
 * 跳过：行注释、块注释、单双引号字符串、模板字符串（含 `${}` 里的嵌套）。
 * 配平不上返回 `{ text: '', end: -1 }`。
 */
function sliceBraces(src, from) {
  let depth = 0
  let i = from
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (c === "'" || c === '"') {
      const q = c
      i += 1
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') i += 1
        i += 1
      }
      i += 1
      continue
    }
    if (c === '`') {
      i += 1
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\') {
          i += 2
          continue
        }
        if (src[i] === '$' && src[i + 1] === '{') {
          i = sliceBraces(src, i + 1).end
          continue
        }
        i += 1
      }
      i += 1
      continue
    }
    if (c === '{') {
      depth += 1
      i += 1
      continue
    }
    if (c === '}') {
      depth -= 1
      i += 1
      if (depth === 0) return { text: src.slice(from, i), end: i }
      continue
    }
    i += 1
  }
  return { text: '', end: -1 }
}

/** 切出 `marker` 之后**紧跟的那个大括号块**（marker 本身不含大括号，且以 `=> ` 之类结尾） */
function blockAfter(src, marker) {
  const at = src.indexOf(marker)
  if (at < 0) return ''
  const brace = src.indexOf('{', at + marker.length)
  if (brace < 0) return ''
  return sliceBraces(src, brace).text
}

/**
 * 切出**包着** `marker` 的那个大括号块。
 *
 * 用于 `{cond ? view.xxx.map(...) : null}` 这种形状 ——
 * `marker` 前面隔着条件表达式，`{` 不紧挨着它，得往前找。
 */
function blockAround(src, marker) {
  const at = src.indexOf(marker)
  if (at < 0) return ''
  const brace = src.lastIndexOf('{', at)
  if (brace < 0) return ''
  return sliceBraces(src, brace).text
}

/**
 * 把文件按**顶层声明**切成块 —— 每块从一个顶格的声明开始，到下一个顶格声明为止。
 *
 * 顶层＝第 0 列；组件内部的嵌套声明都有缩进，不会被切开。
 */
function topLevelChunks(src) {
  const lines = src.split('\n')
  const starts = []
  lines.forEach((ln, i) => {
    if (/^(export\s+)?(default\s+)?(function|const|let|var|interface|type|class)\s/.test(ln)) starts.push(i)
  })
  const chunks = []
  for (let i = 0; i < starts.length; i += 1) {
    const to = i + 1 < starts.length ? starts[i + 1] : lines.length
    chunks.push({ name: lines[starts[i]].trim(), text: lines.slice(starts[i], to).join('\n') })
  }
  return chunks
}

/* --- 26.1 domain 层：打真源码，把 ③ 的方名逐个过解析器 --- */
let linkMod = null
let triadMod = null
{
  let esbuildBuild = null
  try {
    const esm = await import(pathToFileURL(join(TARO, 'node_modules', 'esbuild', 'lib', 'main.js')).href)
    esbuildBuild = esm.build
  } catch {
    esbuildBuild = null
  }
  if (!esbuildBuild) {
    ok('taro 子工程依赖已安装（26 节要打真 domain 源码）', false, '先跑：npm --prefix taro install')
  } else {
    const stubDir = mkdtempSync(join(tmpdir(), 'taro-lint-links-'))
    try {
      const requireCjs = createRequire(import.meta.url)
      const buildOne = async (entry, outName) => {
        const out = await esbuildBuild({
          entryPoints: [entry],
          bundle: true,
          platform: 'node',
          format: 'cjs',
          write: false,
        })
        const f = join(stubDir, outName)
        writeFileSync(f, out.outputFiles[0].text, 'utf8')
        return requireCjs(f)
      }
      linkMod = await buildOne(join(ROOT, 'src', 'domain', 'formula-links.ts'), 'links.cjs')
      triadMod = await buildOne(join(ROOT, 'src', 'domain', 'triad.ts'), 'triad.cjs')
    } catch (e) {
      ok('formula-links / triad domain 能被打包加载', false, String(e && e.message))
    } finally {
      try {
        rmSync(stubDir, { recursive: true, force: true })
      } catch {
        /* 临时目录清不掉不影响结论 */
      }
    }
    ok('formula-links domain 能被打包加载（26 节打的是真源码）', !!linkMod)
    ok('triad domain 能被打包加载（要拿 ③ 的真实方名清单）', !!triadMod)

    if (linkMod && triadMod) {
      /** ③ 的全部方名（讲义 p47 图上三个六边形的处方清单，去重） */
      const rxNames = [
        ...new Set(triadMod.THERAPY_OPTIONS.flatMap((o) => o.prescriptions.map((p) => p.name))),
      ]
      ok('③ 的方名清单不为空', rxNames.length > 0, rxNames.join('、'))
      const unresolved = rxNames.filter((n) => !linkMod.resolveFormulaLink(n))
      ok(
        '③ 的每一个方名都能在「用方」知识库里找到对应条目（方名 ↔ 条目必须对得上）',
        unresolved.length === 0,
        unresolved.join('、'),
      )
      const noBasis = rxNames.filter((n) => {
        const l = linkMod.resolveFormulaLink(n)
        return l && !l.basis
      })
      ok('每一个对照都带依据（basis）—— 凭什么认成同一个方，得写出来', noBasis.length === 0, noBasis.join('、'))
      ok(
        '查不到的方名返回 null（不硬凑、不猜）',
        linkMod.resolveFormulaLink('根本不存在的一方') === null,
      )
      ok(
        'formulaAnchor 与 formulaAnchorId 给出同一个锚点（滚动目标与卡片 id 必须对得上）',
        linkMod.formulaAnchor('rule', 'x') === linkMod.formulaAnchorId({ kind: 'rule', id: 'x', label: '', basis: '' }),
      )
    }
  }
}

/* --- 26.2 ③ 档：方名可点 → 记意图 → 切 tab --- */
const triadCompFile = join(SRC, 'components', 'visit-triad', 'index.tsx')
if (existsSync(triadCompFile)) {
  const src = stripComments(read(triadCompFile))
  const rxAt = src.indexOf('{rx.map((r) => {')
  const rxBlock = rxAt >= 0 ? sliceBraces(src, rxAt).text : ''
  ok('③ 的方名渲染块能按结构切出来', rxBlock.length > 0)
  ok('③ 的方名先过 resolveFormulaLink（对照规则只有一处，不各写各的）', /resolveFormulaLink\(r\.name\)/.test(rxBlock))
  ok(
    '对得上的方名**可点**（pr-link + onClick）',
    /className='pr-link'/.test(rxBlock) && /onClick=\{\(\) => openFormula\(link\)\}/.test(rxBlock),
  )
  ok('对不上的方名明说「用方页未载」', /用方页未载/.test(rxBlock))

  const openBlock = blockAfter(src, 'const openFormula = (link: FormulaLink) => ')
  ok('openFormula 能按结构切出来', openBlock.length > 0)
  const iSet = openBlock.indexOf('setFormulaFocus(link)')
  const iSwitch = openBlock.indexOf('Taro.switchTab')
  ok(
    'openFormula 先记跳转意图、再切 tab（顺序反了意图就丢了）',
    iSet >= 0 && iSwitch > iSet,
    `set=${iSet} switch=${iSwitch}`,
  )
  ok(
    "openFormula 切到「用方」页",
    /Taro\.switchTab\(\{\s*url: '\/pages\/formulas\/index'/.test(openBlock),
  )
  ok('切的目标页在 app.config.ts 里登记过', appConfigSrc.includes("'pages/formulas/index'"))
}

/* --- 26.3 跳转意图：内存态，取走即清空 --- */
const focusStoreFile = join(SRC, 'store', 'focus.ts')
ok('跳转意图的 store 存在', existsSync(focusStoreFile))
if (existsSync(focusStoreFile)) {
  const src = stripComments(read(focusStoreFile))
  ok(
    '跳转意图是内存态，不写 storage（不跟用户数据混、也不留到下次）',
    !/StorageSync|setStorage|getStorage|removeStorage/.test(src),
  )
  const take = blockAfter(src, 'export function takeFormulaFocus()')
  const iRead = take.indexOf('const f = pending')
  const iClear = take.indexOf('pending = null')
  ok('takeFormulaFocus 取走即清空（不会「第二次进用方页又滚一遍」）', iRead >= 0 && iClear > iRead)
}

/* --- 26.4 用方页：取意图 → 切维度 → 滚动定位 → 高亮 --- */
const formulasPageFile = join(SRC, 'pages', 'formulas', 'index.tsx')
ok('「用方」页存在', existsSync(formulasPageFile))
if (existsSync(formulasPageFile)) {
  const src = stripComments(read(formulasPageFile))

  const show = blockAfter(src, 'useDidShow(() => ')
  ok('用方页 useDidShow 的回调能按结构切出来', show.length > 0)
  ok('用方页在 useDidShow 里取走跳转意图', /takeFormulaFocus\(\)/.test(show))
  ok('跳转时清空关键词（否则目标可能被筛掉）', /setKw\(''\)/.test(show))
  ok("跳转时切到「讲稿原序」（该维度不受分组筛选影响，目标必然可见）", /setDim\('route'\)/.test(show))
  ok('跳转时记下焦点', /setFocus\(f\)/.test(show))
  const iTake = show.indexOf('takeFormulaFocus()')
  ok('先取意图、再改状态', iTake >= 0 && iTake < show.indexOf('setFocus'))

  const eff = blockAfter(src, 'useEffect(() => ')
  ok('用方页的滚动 effect 能按结构切出来', eff.length > 0)
  ok('用方页用 pageScrollTo 滚到目标条目', /Taro\.pageScrollTo/.test(eff))
  ok('滚动选择器由 formulaAnchorId 生成（不手拼锚点）', /formulaAnchorId\(focus\)/.test(eff))
  ok('没有手写死的锚点前缀（手拼就与卡片 id 对不上了）', !/'#(rule|drug)-/.test(eff))

  /* 卡片上的 id 与滚动目标必须来自同一个函数 */
  const chunks = topLevelChunks(src)
  const fCard = chunks.find((c) => /^function FormulaCard/.test(c.name))
  const dCard = chunks.find((c) => /^function DrugCard/.test(c.name))
  ok('FormulaCard 能按顶层声明切出来', !!fCard)
  ok('DrugCard 能按顶层声明切出来', !!dCard)
  ok(
    'FormulaCard 收 anchorId 属性并挂到根节点',
    !!fCard && /anchorId\?: string/.test(fCard.text) && /id=\{anchorId\}/.test(fCard.text),
  )
  ok('FormulaCard 命中时加高亮 class', !!fCard && /pr-focus/.test(fCard.text))
  ok(
    'DrugCard 收 anchorId 属性并挂到根节点',
    !!dCard && /anchorId\?: string/.test(dCard.text) && /id=\{anchorId\}/.test(dCard.text),
  )
  ok('DrugCard 命中时加高亮 class', !!dCard && /pr-focus/.test(dCard.text))

  /**
   * **锚点 id 必须全局唯一** —— 同一个方既嵌在规则卡里、又在「方剂备查」里独立出现，
   * 两处都挂同一个 id，选择器就撞了（实测 `中焦方` 重复 6 次、`引火归元` 重复 8 次）。
   * 所以：嵌在规则卡里的方剂卡**不挂 id**，只有独立条目挂。
   */
  const nestedDrug = (fCard.text.match(/<DrugCard[^>]*?\/?>/) || [''])[0]
  ok(
    '嵌在规则卡里的方剂卡**不挂锚点 id**（否则同一个 id 挂两遍，选择器会撞）',
    !/anchorId/.test(nestedDrug),
    nestedDrug,
  )

  /* 渲染点：谁挂 id */
  const routeBlock = blockAround(src, 'view.routeGroups.map((group) => (')
  const dimFormulaBlock = blockAround(src, 'view.dimFormulaGroups.map((group) => (')
  const draftBlock = blockAround(src, 'view.draftDrugGroups.map((group) => (')
  const dimDrugBlock = blockAround(src, 'view.dimDrugGroups.map((group) => (')
  ok('「讲稿原序」的用方条目挂 rule 锚点', /anchorId=\{formulaAnchor\('rule', item\.id\)\}/.test(routeBlock))
  ok(
    '「按五行／按左右手」那一组**不挂** rule 锚点（讲稿原序那一组一直渲染，挂两遍就重了）',
    dimFormulaBlock.length > 0 && !/anchorId/.test(dimFormulaBlock),
  )
  ok(
    '「方剂备查」挂 drug 锚点',
    /anchorId=\{formulaAnchor\('drug', d\.id\)\}/.test(draftBlock) &&
      /anchorId=\{formulaAnchor\('drug', d\.id\)\}/.test(dimDrugBlock),
  )
  ok(
    '两处方剂组互斥（同一个 drug 锚点不会同时挂两遍）',
    /dim === 'route'\s*\? view\.draftDrugGroups/.test(src) &&
      /dim !== 'route'\s*\? view\.dimDrugGroups/.test(src),
  )

  /* 横幅：把「对照依据」摆出来 */
  const barAt = src.indexOf('{focus ? (')
  const bar = barAt >= 0 ? sliceBraces(src, barAt).text : ''
  ok('定位横幅能按结构切出来', bar.length > 0)
  ok('横幅写出对照依据（凭什么认成同一个方，让读者自己判断）', /focus\.basis/.test(bar) && /对照依据/.test(bar))
}

/* --- 26.5 样式：高亮与横幅 --- */
const formulasScssFile = join(SRC, 'pages', 'formulas', 'index.scss')
if (existsSync(formulasScssFile)) {
  const css = read(formulasScssFile)
  ok('用方页有定位高亮样式 .pr-focus', /\.pr-focus\s*\{/.test(css))
  ok('用方页有定位横幅样式 .pr-focus-bar', /\.pr-focus-bar\s*\{/.test(css))
  // 同特异度下后写的才生效 —— .pr-focus 必须排在 .pr-formula 之后
  //
  // 定位要看的是 **`.pr-focus {` 这条规则**，不是裸子串 `.pr-focus` ——
  // 裸子串会把横幅的 `.pr-focus-bar {` 也算进来，规则挪到前面照样绿（已实测）。
  const focusRulePos = css.lastIndexOf('.pr-focus {')
  const formulaRulePos = css.indexOf('.pr-formula {')
  ok(
    '.pr-focus 写在 .pr-formula 之后（同特异度，靠后写的才生效）',
    focusRulePos > formulaRulePos && formulaRulePos >= 0,
    `focus=${focusRulePos} formula=${formulaRulePos}`,
  )
}

/* ========================================================================
 * 汇总
 * ======================================================================== */
console.log(`\n合计：${pass + fail} 项，通过 ${pass}，失败 ${fail}`)
if (fail) {
  console.log('\n失败明细：')
  failures.forEach((f) => console.log(`  · ${f}`))
  process.exit(1)
}
console.log('小程序端静态检查全绿。\n')
