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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const TARO = join(ROOT, 'taro')
const SRC = join(TARO, 'src')

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
 *   · `components/medication-panel` —— 就诊工作台的「用药」页内 tab，
 *       要选方、要看讲稿比例制与同和堂版克数两套组成（原生 medication 页的核心功能，缺了就是漏功能）
 *   · `components/visit-judge` —— 「判读」分支要查方剂组成
 *
 * 另注：白名单按**路径包含**匹配，不是全等 —— `rel()` 给的是
 * `pulse-record/taro/src/components/.../index.tsx` 这种全路径，
 * 用全等去查永远查不到，例外项会被误判成违规。
 * ======================================================================== */
const KNOWLEDGE = ['formulas', 'drugs', 'formula-table', 'grouping', 'medication', 'dose-lookup', 'sequence']
const knowledgeUsers = []
for (const f of tsxFiles) {
  const src = read(f)
  for (const k of KNOWLEDGE) {
    if (new RegExp(`@domain/${k}`).test(src)) {
      knowledgeUsers.push({ file: rel(f), mod: k })
    }
  }
}
const ALLOWED_ELSEWHERE = {
  'components/medication-panel': ['drugs', 'dose-lookup', 'formula-table', 'medication'],
  'components/visit-judge': ['dose-lookup'],
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
}

/* ========================================================================
 * 8. 两处都用同一个记录表组件
 * ======================================================================== */
const caseDetail = join(SRC, 'pages', 'case-detail', 'index.tsx')
const visitPage = join(SRC, 'pages', 'visit', 'index.tsx')
const visitPulse = join(SRC, 'components', 'visit-pulse', 'index.tsx')

for (const [label, f] of [
  ['病例详情页', caseDetail],
  ['就诊页的脉象分支', visitPulse],
]) {
  ok(`${label} 存在`, existsSync(f))
  if (!existsSync(f)) continue
  const src = read(f)
  ok(`${label} 用的是 record-sheet 组件`, /record-sheet/.test(src))
  ok(`${label} 没有自己画表格骨架`, !/pr-organ/.test(src) && !/<table\b/.test(src))
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
  ok('就诊工作台有 4 个页内 tab（脉象/判读/用药/寸关尺图）', /脉象/.test(src) && /判读/.test(src) && /用药/.test(src) && /寸关尺图/.test(src))
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
  if (!/formulas|visit-judge/.test(rel(f))) continue
  if (!/讲义|讲稿|同和堂版/.test(src)) sourceMiss.push(rel(f))
}
ok('知识页有出处标注（讲义／讲稿／同和堂版）', sourceMiss.length === 0, sourceMiss.join(' '))

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

for (const p of ['pages/case-detail/index.tsx', 'pages/visit/index.tsx']) {
  const src = read(join(SRC, p))
  ok(`${p} 用了 diagram-view（图直接显示，不是按钮弹窗）`, src.includes('diagram-view'))
}

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
 * 汇总
 * ======================================================================== */
console.log(`\n合计：${pass + fail} 项，通过 ${pass}，失败 ${fail}`)
if (fail) {
  console.log('\n失败明细：')
  failures.forEach((f) => console.log(`  · ${f}`))
  process.exit(1)
}
console.log('小程序端静态检查全绿。\n')
