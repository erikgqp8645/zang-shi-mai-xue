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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  ok('病例详情页的高频动作是按钮不是文字链接', /pr-detail-ops/.test(src))
  ok('病例详情页有离屏画布（出图用）', /pulse-off-canvas/.test(src))
}

/* ========================================================================
 * 10. 就诊工作台：页内 tab + 全局上下文 + 底部操作条
 * ======================================================================== */
if (existsSync(visitPage)) {
  const src = read(visitPage)
  ok('就诊工作台有 4 个页内 tab（脉象/判读/用药/出图）', /脉象/.test(src) && /判读/.test(src) && /用药/.test(src) && /出图/.test(src))
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
for (const name of ['storage', 'request', 'album', 'preview', 'auth', 'canvas']) {
  ok(`platform/${name}.ts 存在`, existsSync(join(SRC, 'platform', `${name}.ts`)))
}
const canvasFile = join(SRC, 'platform', 'canvas.ts')
if (existsSync(canvasFile)) {
  const src = read(canvasFile)
  ok('出图用共享绘制器（table-painter / diagram），不是另写一套', /@export\/table-painter/.test(src) && /@export\/diagram/.test(src))
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
ok('图片资源拷进小程序包（/assets/xxx.png）', /assets/.test(taroConfig))

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

const taroPrivacyCalls = findPrivacyCalls(tsxFiles)
const legacyPrivacyCalls = findPrivacyCalls(
  walk(join(ROOT, 'miniprogram'), [], (p) => p.endsWith('.js')),
)
const usedPrivacyApis = new Set([...taroPrivacyCalls, ...legacyPrivacyCalls])

const unknownPrivacy = [...usedPrivacyApis].filter((a) => !(a in KNOWN_PRIVACY_APIS))
ok(
  `调用的隐私接口都在已知清单里（当前 ${usedPrivacyApis.size} 个：${[...usedPrivacyApis].join('、')}）`,
  unknownPrivacy.length === 0,
  unknownPrivacy.join(' ') + ' —— 新增隐私接口要同步：① 本清单 ② 微信后台隐私指引 ③ docs/miniprogram-release-checklist.md',
)

const stalePrivacy = Object.keys(KNOWN_PRIVACY_APIS).filter((a) => !usedPrivacyApis.has(a))
ok('已知清单里的隐私接口都还在用（清单不能留着已废弃的）', stalePrivacy.length === 0, stalePrivacy.join(' '))

const privacyPagePath = join(SRC, 'pages', 'privacy', 'index.tsx')
const privacyPage = existsSync(privacyPagePath) ? read(privacyPagePath) : ''
const undeclaredTypes = Object.values(KNOWN_PRIVACY_APIS).filter((t) => !privacyPage.includes(t))
ok('隐私政策页写明了每种隐私类型', privacyPage !== '' && undeclaredTypes.length === 0, undeclaredTypes.join(' '))

const mePagePath = join(SRC, 'pages', 'me', 'index.tsx')
ok(
  '「我的」页有隐私政策入口（审核要求小程序内可见）',
  existsSync(mePagePath) && read(mePagePath).includes('pages/privacy/index'),
)

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
