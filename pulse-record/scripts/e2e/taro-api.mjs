#!/usr/bin/env node
/**
 * 小程序数据层端到端（Taro 版）—— 替代 `mp-api.mjs`
 *
 * ## 它做什么
 *
 * 在 Node 里用 **Taro 垫片**（`taro-shim.mjs`）跑**真实的小程序代码**，连**真实的后端**。
 *
 * 小程序页面只能在微信开发者工具／真机里点，但页面底下那一层
 * （`utils/config.ts` / `utils/api.ts` / `utils/data.ts` / `utils/auth.ts`）
 * 是纯 TS，只依赖 `Taro.request` 与 `Taro.*Storage*`。
 * 垫一个 `Taro` 上去，就能在没有开发者工具的机器上、在 CI 里，把
 * 「登录 → 建患者 → 读回 → 搜索 → 改就诊 → 用药 → 自定义符号 → 令牌失效」
 * 这条链路真跑一遍。
 *
 * ## 怎么跑「真实的代码」
 *
 * 小程序源码是 TS/TSX，Node 直接 import 不了（扩展名解析、TS 语法）。
 * 这里用 **esbuild**（Taro 自带的 vite 依赖里就有）把 `taro/src/utils/index.ts`
 * 打成一份 ESM bundle：
 *   · `@tarojs/taro` → 指向垫片（所以跑的是真源码，只是换了运行时）
 *   · `@domain/*` / `@export/*` → 指向真源码（domain 是纯 TS，Node 侧也能跑）
 *
 * 跑完 import 进来，逐条断言。
 *
 * 不覆盖：WXML/TSX 渲染、事件绑定（那是 `taro-lint.mjs` 的活）、真机上的网络与相册权限。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { build } from '../../taro/node_modules/esbuild/lib/main.js'
import { ROOT, makeChecker, startApi } from './lib.mjs'

const TARO = join(ROOT, 'taro')
const SHARED = join(ROOT, 'src')

/* --------------------------- 打一份可跑的 bundle --------------------------- */

const outDir = mkdtempSync(join(tmpdir(), 'pulse-taro-api-'))
const outFile = join(outDir, 'bundle.mjs')

await build({
  entryPoints: [join(TARO, 'src', 'utils', 'index.ts')],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  logLevel: 'silent',
  alias: {
    '@domain': join(SHARED, 'domain'),
    '@export': join(SHARED, 'export'),
  },
  plugins: [
    {
      // 垫片必须**外部引用**，不能被内联进 bundle ——
      // 否则被测代码与测试脚本各有一份垫片实例，
      // 存储（Storage）与 reLaunch 队列就互不相通，断言会莫名其妙地失败。
      name: 'taro-shim-external',
      setup(b) {
        b.onResolve({ filter: /^@tarojs\/taro$/ }, () => ({
          path: pathToFileURL(join(ROOT, 'scripts', 'e2e', 'taro-shim.mjs')).href,
          external: true,
        }))
      },
    },
  ],
  loader: { '.png': 'dataurl' },
})

/** 垫片里的 Taro（存、取、reLaunch 都要能断言） */
const shim = await import(pathToFileURL(join(ROOT, 'scripts', 'e2e', 'taro-shim.mjs')).href)
const Taro = shim.default
const { relaunched } = shim

/** 真实的小程序数据层 */
const mod = await import(pathToFileURL(outFile).href)
const config = mod.config
const dataApi = mod.data
const authApi = mod.auth

/**
 * 符号校验（`domain/symbols.ts`）单独打一份 —— 它是纯函数，Node 里直接跑。
 *
 * 不并进上面那个 bundle：那边入口是 `utils/index.ts`，塞进去只为测试而加导出，
 * 会把「测试的方便」变成生产代码的负担。单独打一份最干净。
 */
const symbolsOut = join(outDir, 'symbols.mjs')
await build({
  entryPoints: [join(SHARED, 'domain', 'symbols.ts')],
  outfile: symbolsOut,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  logLevel: 'silent',
})
const symbolsApi = await import(pathToFileURL(symbolsOut).href)

/* ------------------------------ 小工具 ------------------------------ */

const c = makeChecker()

/** 期待一次请求失败，返回错误对象（拿不到就返回 null，由 check 判失败） */
async function expectError(fn) {
  try {
    await fn()
    return null
  } catch (e) {
    return e
  }
}

const LOGIN = 'mptest' + Date.now().toString(36).slice(-6)
const PASSWORD = 'test123456'
const VISIT_ID = 'v_mp_e2e_1'

/* ------------------------------ 第一段：多用户 ------------------------------ */

console.log('\n小程序数据层端到端（Taro · 多用户模式）\n')

const multi = await startApi({ single: false })

/* —— 服务器地址：改完立刻生效 —— */
const saved = config.setApiBase(multi.base)
c.check(
  '「我的」页保存地址后，resolveApiBase 立刻用新地址',
  saved.ok && config.resolveApiBase() === multi.base,
  config.resolveApiBase(),
)
c.check('地址落在本地存储的同一个键上', Taro.getStorageSync(config.API_BASE_KEY) === multi.base)

const rejected = config.setApiBase('192.168.1.20:5178')
c.check('不带 http:// 的地址被拒，且不覆盖已保存的值', !rejected.ok && config.resolveApiBase() === multi.base)

/* —— 健康检查 —— */
const health = await dataApi.health()
c.check('健康检查走通，返回多用户模式', health && health.mode === 'multi', JSON.stringify(health))

/* —— 未登录：401 ＋ 回登录页 —— */
relaunched.length = 0
const unauth = await expectError(() => dataApi.listPatients())
c.check('未登录取病例列表 → 401', unauth && unauth.status === 401, unauth && unauth.message)
c.check('401 后自动 reLaunch 到登录页', relaunched[0] === '/pages/login/index', String(relaunched[0]))
c.check('401 后本地令牌被清掉', !Taro.getStorageSync('pulse.token'))

/* —— 注册即登录 —— */
const reg = await authApi.register(LOGIN, '小程序联调', PASSWORD)
c.check('注册成功并拿到令牌与用户', !!(reg && reg.token && reg.user), JSON.stringify(reg && reg.user))
c.check('令牌已存本地', Taro.getStorageSync('pulse.token') === reg.token)

const me = await authApi.me()
c.check('/api/auth/me 与注册账号一致', me && me.user && me.user.loginName === LOGIN, JSON.stringify(me && me.user))

/* —— 建患者：脉象值 / 体质 / 疗法原样落库 —— */
const created = await dataApi.savePatient({
  name: '小程序联调·患者',
  layout: 'nine',
  visits: [
    {
      id: VISIT_ID,
      label: '261104',
      at: 1762185600000,
      values: {
        'L|寸|浮': ['++'],
        'L|关|沉': ['X', '↑'],
        'R|关|浮': ['0'],
      },
      constitution: '肾虚',
      therapy: '三焦疗法',
    },
  ],
})
c.check('保存患者成功并返回 id', !!(created && created.id))
const patientId = created && created.id

const back = await dataApi.getPatient(patientId)
const visit = back && back.visits && back.visits[0]
c.check('就诊记录带上了体质与疗法', !!(visit && visit.constitution === '肾虚' && visit.therapy === '三焦疗法'))
c.check('多符号的顺序没乱', !!(visit && JSON.stringify(visit.values['L|关|沉']) === JSON.stringify(['X', '↑'])))

const list = await dataApi.listPatients()
c.check('列表里能看到这位患者，就诊次数为 1', list.some((p) => p.id === patientId && p.visitCount === 1))

/* —— 搜索 —— */
const bySymbol = await dataApi.searchPatients('↑')
c.check('按脉象符号搜「↑」命中', bySymbol.some((p) => p.id === patientId))
const byLabel = await dataApi.searchPatients('261104')
c.check(
  '按日期标签搜「261104」命中并带出命中次记录',
  byLabel.some((p) => p.id === patientId && p.matchedVisits && p.matchedVisits.length),
)
const byName = await dataApi.searchPatients('小程序联调·患者')
c.check('按姓名搜命中', byName.some((p) => p.id === patientId))
const byNone = await dataApi.searchPatients('不存在的名字zzzz')
c.check('搜不到时返回空数组而非报错', Array.isArray(byNone) && byNone.length === 0)

/* —— 改一次就诊 —— */
const patched = await dataApi.updateVisit(VISIT_ID, { label: '261105' })
c.check('改日期标签只动这一次', !!(patched && patched.label === '261105'))

/* —— 用药 —— */
await dataApi.saveVisitMedication(VISIT_ID, [
  { visitId: VISIT_ID, name: '下焦方', pulse: '尺沉+', adjust: '加黄芪3', usage: '水煎服', note: '饭后' },
])
const medBack = await dataApi.listVisitMedication(VISIT_ID)
c.check('该次就诊写入用药记录', medBack.length === 1 && medBack[0].name === '下焦方')
c.check('用药记录读回', !!(medBack[0] && medBack[0].adjust === '加黄芪3' && medBack[0].usage === '水煎服'))
const medByPatient = await dataApi.listMedication(patientId)
c.check('按患者取用药也看得到这一条', medByPatient.some((m) => m.name === '下焦方'))
await dataApi.deleteMedication(medBack[0].id)
const medAfter = await dataApi.listVisitMedication(VISIT_ID)
c.check('删完为空', medAfter.length === 0)

/* —— 自定义符号 —— */
const sym = await dataApi.saveCustomSymbol({ code: 'S', name: '涩' })
c.check('新增自定义符号', !!(sym && sym.code === 'S'))
const syms = await dataApi.listCustomSymbols()
c.check('自定义符号出现在清单里', syms.some((s) => s.code === 'S' && s.name === '涩'))
const dup = await expectError(() => dataApi.saveCustomSymbol({ code: '+', name: '有' }))
c.check('与讲义固定符号重名被拒（400）', !!dup && dup.status === 400, dup && dup.message)
await dataApi.deleteCustomSymbol('S')
const syms2 = await dataApi.listCustomSymbols()
c.check('删完清单里没有了', !syms2.some((s) => s.code === 'S'))

/* ---- 硬性规定：符号不能为空（服务端也要拦，不能只靠前端） ---- */
const emptyCode = await expectError(() => dataApi.saveCustomSymbol({ code: '', name: '空' }))
c.check('服务端拒绝空符号（400）', !!emptyCode && emptyCode.status === 400, emptyCode && emptyCode.message)

const blankCode = await expectError(() => dataApi.saveCustomSymbol({ code: '   ', name: '空格' }))
c.check('服务端拒绝只有空格的符号（400）', !!blankCode && blankCode.status === 400)

const emptyName = await expectError(() => dataApi.saveCustomSymbol({ code: 'Q', name: '' }))
c.check('服务端拒绝空名称（400）', !!emptyName && emptyName.status === 400)

// 名称里的空白是允许的 —— 中文输入法的空格常是 U+3000，不能按「看不见」拒掉
const spaced = await dataApi.saveCustomSymbol({ code: 'Q', name: '涩\u3000脉' })
c.check('名称里可以有全角空格（U+3000）', !!(spaced && spaced.name === '涩\u3000脉'), JSON.stringify(spaced))
await dataApi.deleteCustomSymbol('Q')

const zwName = await expectError(() => dataApi.saveCustomSymbol({ code: 'Q', name: '涩\u200b脉' }))
c.check('名称里的零宽空格仍被拒（400）', !!zwName && zwName.status === 400, zwName && zwName.message)

// 零宽空格：trim() 删不掉，肉眼也看不见 —— 只判空字符串会漏掉
const zwCode = await expectError(() => dataApi.saveCustomSymbol({ code: '\u200b', name: '零宽' }))
c.check('服务端拒绝不可见字符（400）', !!zwCode && zwCode.status === 400)

// 黑名单外的「隐形」也必须挡住：软连字符能造出与 S 一模一样的影子符号，
// 盲文空白／韩文填充符是「有字形但字形是空白」，变体选择符单独出现什么都不显示
for (const [label, code] of [
  ['软连字符 U+00AD', '\u00ad'],
  ['盲文空白 U+2800', '\u2800'],
  ['韩文填充符 U+3164', '\u3164'],
  ['变体选择符 U+FE0F', '\ufe0f'],
  ['标签字符 U+E0041', '\u{e0041}'],
]) {
  const r = await expectError(() => dataApi.saveCustomSymbol({ code, name: '隐形' }))
  c.check(`服务端拒绝${label}（400）`, !!r && r.status === 400, r && r.message)
}

// `.` / `..` 建得进去却删不掉（URL 会把它们归一化掉），从源头拒
const dotCode = await expectError(() => dataApi.saveCustomSymbol({ code: '.', name: '点' }))
c.check('服务端拒绝「.」当符号（400）', !!dotCode && dotCode.status === 400, dotCode && dotCode.message)
const dotsCode = await expectError(() => dataApi.saveCustomSymbol({ code: '..', name: '点' }))
c.check('服务端拒绝「..」当符号（400）', !!dotsCode && dotsCode.status === 400)

const afterBad = await dataApi.listCustomSymbols()
c.check('被拒的符号一个都没落库', afterBad.length === 0, JSON.stringify(afterBad))

/* ---- 自定义符号的本地校验（面板在提交前先拦一遍，不等服务端来回） ---- */
const vs = symbolsApi.validateCustomSymbol
c.check('空符号被拦', !!vs('', '涩'))
c.check('空符号的提示说得清「不能为空」', /不能为空/.test(vs('', '涩') || ''), vs('', '涩'))
c.check('只有空格的符号被拦', !!vs('   ', '涩'))
c.check('零宽字符的符号被拦', !!vs('\u200b', '涩'))
for (const bad of ['\u00ad', '\u2800', '\u3164', '\ufe0f', '\u{e0041}']) {
  c.check(`隐形字符 ${JSON.stringify(bad)} 被拦`, !!vs(bad, '涩'))
}
c.check('「.」不能当符号', !!vs('.', '点'))
c.check('「..」不能当符号', !!vs('..', '点'))
c.check('名称不能为空', !!vs('S', ''))
c.check('名称只有零宽字符也被拦', !!vs('S', '\u200b'))
// 名称里的**空白**是允许的（中文输入法打出的空格常常是 U+3000，那是看得见宽度的）
c.check('名称里可以有半角空格', vs('S', '涩 脉') === null, vs('S', '涩 脉'))
c.check('名称里可以有全角空格（U+3000）', vs('S', '涩\u3000脉') === null, vs('S', '涩\u3000脉'))
c.check('名称里可以有细空格（U+2009）', vs('S', '涩\u2009脉') === null, vs('S', '涩\u2009脉'))
c.check('名称里的零宽空格仍被拦', !!vs('S', '涩\u200b脉'))
c.check('与讲义固定符号重复被拦', !!vs('++', '有力'))
c.check('同一代码不能建两次', !!vs('S', '涩', [{ code: 'S', name: '涩' }]))
c.check('超过 3 个字符被拦', !!vs('ABCD', '长'))
c.check('符号里带空格被拦', !!vs('S S', '涩'))
c.check('符号里带「/」被拦', !!vs('S/T', '涩'))
c.check('名称超过 12 字被拦', !!vs('S', '一二三四五六七八九十一二三'))

c.check('正常符号放行（S＝涩）', vs('S', '涩') === null, vs('S', '涩'))
c.check('汉字直接当符号也放行（涩＝涩）', vs('涩', '涩') === null, vs('涩', '涩'))
c.check('三个字符的自定义写法放行（TT2）', vs('TT2', '跳停') === null, vs('TT2', '跳停'))
c.check('自定义符号与别的代码互不影响', vs('H', '滑', [{ code: 'S', name: '涩' }]) === null)

/* —— 体例：唯一真源，改体例不动格值 —— */
const beforeValues = JSON.stringify((await dataApi.getPatient(patientId)).visits[0].values)
const toNine = await dataApi.updatePatientLayout(patientId, 'nine')
c.check('改体例 → nine 生效', !!(toNine && toNine.layout === 'nine'), toNine && toNine.layout)
const readNine = await dataApi.getPatient(patientId)
c.check('体例落库了（重新读还是 nine）', !!(readNine && readNine.layout === 'nine'), readNine && readNine.layout)
c.check(
  '改体例不动格值',
  JSON.stringify(readNine.visits[0].values) === beforeValues,
  JSON.stringify(readNine.visits[0].values),
)
const toSeven = await dataApi.updatePatientLayout(patientId, 'seven')
c.check('改体例 → seven 生效', !!(toSeven && toSeven.layout === 'seven'), toSeven && toSeven.layout)
const badLayout = await expectError(() => dataApi.updatePatientLayout(patientId, 'ten'))
c.check('非法体例被拒（400）', !!badLayout && badLayout.status === 400, badLayout && badLayout.message)

/* —— 改名 ＋ 删除患者 —— */
const renamed = await dataApi.renamePatient(patientId, '小程序联调·改名')
c.check('患者改名', !!(renamed && renamed.name === '小程序联调·改名'))
const del = await dataApi.deletePatient(patientId)
c.check('删患者成功', !!(del && del.ok))
const after = await dataApi.listPatients()
c.check('删完列表里没有了', !after.some((p) => p.id === patientId))

/* —— 令牌失效 —— */
Taro.removeStorageSync('pulse.token')
relaunched.length = 0
const expired = await expectError(() => dataApi.listPatients())
c.check(
  '令牌被清后请求 → 401 并回登录页',
  !!expired && expired.status === 401 && relaunched[0] === '/pages/login/index',
)

await multi.stop()

/* ------------------------------ 第二段：形状规整 ------------------------------ */

console.log('\n形状规整（视图层把嵌套数组压成对象的那一头）\n')

const multi2 = await startApi({ single: false })
config.setApiBase(multi2.base)
await authApi.register(LOGIN + 'b', '形状联调', PASSWORD)

/**
 * 视图层会把嵌套数组压成「数字下标的普通对象」：`["X"]` → `{"0":"X"}`。
 * 组件侧与服务端**都要兜住** —— 组件侧见 `components/record-sheet/index.tsx`
 * 的 `toCodeArray`，服务端见 `server/db.mjs` 的 `normalizeValues`。
 */
const dirty = await dataApi.savePatient({
  name: '形状联调·患者',
  layout: 'nine',
  visits: [
    {
      id: 'v_dirty_1',
      label: '261104',
      at: 1762185600000,
      // 故意用「被压扁」的形状写进去
      values: { 'L|寸|浮': { 0: 'X' }, 'R|关|中': { 0: '++', 1: '↑' } },
    },
  ],
})
c.check('故意写坏的形状也能存进去', !!(dirty && dirty.id))

const dirtyBack = await dataApi.getPatient(dirty.id)
const dirtyVisit = dirtyBack && dirtyBack.visits && dirtyBack.visits[0]
c.check(
  '服务端把 {"0":"X"} 还原成 ["X"]',
  !!(dirtyVisit && Array.isArray(dirtyVisit.values['L|寸|浮'])),
  JSON.stringify(dirtyVisit && dirtyVisit.values['L|寸|浮']),
)
c.check(
  '多符号 {"0":"++","1":"↑"} 顺序不乱',
  !!(dirtyVisit && JSON.stringify(dirtyVisit.values['R|关|中']) === JSON.stringify(['++', '↑'])),
  JSON.stringify(dirtyVisit && dirtyVisit.values['R|关|中']),
)
c.check(
  '读回来没有脏形状（每个格值都是数组）',
  !!(dirtyVisit && Object.values(dirtyVisit.values).every((v) => Array.isArray(v))),
)

await multi2.stop()

/* ------------------------------ 第三段：单机模式 ------------------------------ */

console.log('\n小程序数据层端到端（Taro · 单机模式）\n')

const single = await startApi({ single: true })
Taro.setStorageSync(config.API_BASE_KEY, single.base)
Taro.removeStorageSync('pulse.token')

const h2 = await dataApi.health()
c.check('健康检查返回单机模式', h2 && h2.mode === 'single', JSON.stringify(h2))

const noTokenList = await dataApi.listPatients()
c.check('单机模式不带令牌也能取病例（进页面就能用）', Array.isArray(noTokenList))

const s = await dataApi.savePatient({
  name: '单机·患者',
  layout: 'seven',
  visits: [{ label: '261104', at: 1762185600000, values: { 'R|尺|沉': ['+'] } }],
})
c.check('单机模式能建患者', !!(s && s.id))
const sBack = await dataApi.getPatient(s.id)
c.check('7 脉点体例保住了', !!(sBack && sBack.layout === 'seven'), sBack && sBack.layout)

const regErr = await expectError(() => authApi.register('mptest_single', '不该建号', PASSWORD))
c.check('单机模式注册被拒（409），不会误建账号', !!regErr && regErr.status === 409, regErr && regErr.message)

await single.stop()

/* --------------------- 第四段：云调用不可用 → 自动退回直连 --------------------- */

console.log('\n小程序数据层端到端（Taro · 云调用兜底）\n')

const fallback = await startApi({ single: true })
Taro.setStorageSync(config.API_BASE_KEY, fallback.base)

/**
 * 模拟真实情况：**云初始化不会报错**，错误要到第一次 `callFunction` 才抛。
 *
 * 这正是「小程序还没关联 CloudBase 环境」时的真实表现：
 *     errCode: -501000 | errMsg: Environment not found
 *
 * （曾经只按 `init` 的返回值判断云通道可用 → 兜底从来没生效过，
 *   每个请求都去撞同一堵墙，用户只看到一屏原始报错。）
 */
const cloudCalls = []
globalThis.wx = {
  cloud: {
    init() {
      // 假装初始化成功 —— 真实情况就是初始化不报错
    },
    callFunction(opts) {
      cloudCalls.push(opts)
      opts.fail({
        errMsg:
          'cloud.callFunction:fail Error: errCode: -501000 | errMsg: Environment not found ' +
          '更多错误信息请访问: https://docs.cloudbase.net/error-code/basic/INVALID_ENV ' +
          '(callid: 1793943240389-0.5322720375268667) (trace: 13:34:0 start->13:34:0 system error)',
      })
    },
  },
}

c.check(
  '模拟：云初始化照样「成功」（环境没关联时就是这样）',
  mod.cloud.initCloud(config.CLOUD_ENV_ID) === true,
)
c.check(
  '默认云环境 id 指向当前在用的环境（写死了已销毁的环境 → 云通道怎么都不通）',
  config.CLOUD_ENV_ID === 'pulse-1-d0g880ydl8ddc57f6',
  config.CLOUD_ENV_ID,
)
c.check('一开始云通道是通的', mod.cloud.cloudAvailable() === true)

const fbList = await dataApi.listPatients()
c.check('云调用失败后自动退回直连，仍能取到病例列表', Array.isArray(fbList), JSON.stringify(fbList).slice(0, 120))
c.check('云通道已被关掉（不再每次都去撞同一堵墙）', mod.cloud.cloudAvailable() === false)
c.check(
  '失败原因说人话了（说清是「没关联」，且不甩 callid/trace）',
  mod.cloud.cloudErrorMessage().includes('关联') && !mod.cloud.cloudErrorMessage().includes('callid'),
  mod.cloud.cloudErrorMessage(),
)

const cloudCallsBefore = cloudCalls.length
await dataApi.listPatients()
c.check(
  '后续请求不再去撞云调用',
  cloudCalls.length === cloudCallsBefore,
  `云调用次数 ${cloudCallsBefore} → ${cloudCalls.length}`,
)

delete globalThis.wx
await fallback.stop()

/* --------------------- 第五段：正式发布版 → 固定用打包时的地址 --------------------- */

console.log('\n小程序数据层端到端（Taro · 正式发布版）\n')

/**
 * 维护者 2026-11-08 在真机截图上标注：「服务器」界面与「存储位置」正式版不用显示。
 * 隐藏界面只是表面，真正的行为变化是**地址定死**：
 * 界面藏了，使用者没有入口改地址 —— 若这时还读手机本地存的旧地址，
 * 用户端就会连到一台没人能改的服务器，且没有任何自救入口。
 *
 * 这里验的就是这条：**开发版／体验版用本地存的地址，正式版一律用打包时写进去的**。
 */
const SAVED_BASE = 'http://192.168.99.99:5178'
Taro.setStorageSync(config.API_BASE_KEY, SAVED_BASE)

const setEnv = (envVersion) => {
  globalThis.wx = { getAccountInfoSync: () => ({ miniProgram: { envVersion } }) }
}

// 开发版：真机联调就靠「我的」页改地址，所以必须照旧用本地存的
setEnv('develop')
c.check('开发版：判定为非正式版', config.isRelease() === false, String(config.isRelease()))
c.check(
  '开发版：用手机本地存的地址（真机联调靠它改地址）',
  config.resolveApiBase() === SAVED_BASE,
  config.resolveApiBase(),
)

// 体验版：同理 —— 审核前自测还要能改地址
setEnv('trial')
c.check('体验版：判定为非正式版', config.isRelease() === false, String(config.isRelease()))
c.check(
  '体验版：仍用手机本地存的地址',
  config.resolveApiBase() === SAVED_BASE,
  config.resolveApiBase(),
)

// 正式版：固定用打包时写进去的地址
setEnv('release')
c.check('正式版：判定为正式发布版', config.isRelease() === true, String(config.isRelease()))
c.check(
  '正式版：忽略本地存的地址，固定用打包时的地址',
  config.resolveApiBase() === config.API_BASE,
  `${config.resolveApiBase()}（应为 ${config.API_BASE}）`,
)
c.check(
  '正式版：本地存的地址没被删掉，只是不再被使用（避免副作用）',
  Taro.getStorageSync(config.API_BASE_KEY) === SAVED_BASE,
)

// 读不到版本号（老基础库／非微信环境）→ 当成非正式版，宁可多显示也不要误伤
delete globalThis.wx
c.check('读不到版本号时按非正式版处理', config.isRelease() === false, String(config.isRelease()))
c.check(
  '读不到版本号时仍用本地存的地址',
  config.resolveApiBase() === SAVED_BASE,
  config.resolveApiBase(),
)

Taro.removeStorageSync(config.API_BASE_KEY)

/* --------------------- 第六段：退出登录退得掉 ＋ 构建标识 --------------------- */

console.log('\n小程序数据层端到端（Taro · 退出登录与构建标识）\n')

/**
 * 维护者 2026-11-08 两次拍板，合成一条：
 *   ① 「需要用户点击才可以登录」；
 *   ② 「单机模式也要点一下才进去」。
 *
 * ⇒ **没有自动进入这回事**。曾经有两条自动进入的路：
 *   ① 微信登录被自动发起 —— 由 `taro-lint.mjs` 第 28 节盯源码结构；
 *   ② 单机模式自动进入 —— 它压根不登录，是 `health()` 说「我是单机模式」
 *    → 直接进。只修 ① 修不掉它。
 *
 * ② 的判据收在 `utils/auth-flow.ts` 的 `entryKind(mode)`，是**纯函数** ——
 * 所以这里能真的把它跑起来逐条断言。
 */
const flow = mod.authFlow

c.check(
  '多用户模式：显示「微信一键登录」（等用户点）',
  flow.entryKind('multi') === 'wechat-login',
  String(flow.entryKind('multi')),
)
c.check(
  '单机模式：显示「进入（单机模式）」（等用户点，不自动进）',
  flow.entryKind('single') === 'single-enter',
  String(flow.entryKind('single')),
)
c.check(
  '探不到服务端（mode 为空）→ 按多用户处理（显示登录入口）',
  flow.entryKind('') === 'wechat-login' && flow.entryKind(undefined) === 'wechat-login',
)
c.check(
  'isSingleMode 只认 single',
  flow.isSingleMode('single') === true &&
    flow.isSingleMode('multi') === false &&
    flow.isSingleMode('') === false,
)

/* 「刚退出过」标记：写进去 → 读得到 → 清掉 → 读不到 */
const storageMod = mod.storage
storageMod.clearLoggedOutMark()
c.check('「刚退出过」标记默认是空的', storageMod.wasLoggedOut() === false)
storageMod.markLoggedOut()
c.check('记一笔之后读得到', storageMod.wasLoggedOut() === true)
storageMod.clearLoggedOutMark()
c.check('清掉之后读不到', storageMod.wasLoggedOut() === false)

/* 清凭证**不能**把「刚退出过」一起清掉 —— 否则登出流程等于没写标记 */
storageMod.markLoggedOut()
storageMod.clearAuth()
c.check(
  'clearAuth 不影响「刚退出过」标记（标记归标记，凭证归凭证）',
  storageMod.wasLoggedOut() === true,
)
storageMod.clearLoggedOutMark()

/* 构建标识：模块能导出、标签非空 */
c.check(
  '构建标识模块导出 buildLabel',
  typeof mod.build.buildLabel === 'function',
)
c.check(
  'buildLabel 返回一行版本标识',
  typeof mod.build.buildLabel() === 'string' && mod.build.buildLabel().length > 0,
  mod.build.buildLabel(),
)

/* --------------------- 第七段：网络失败的诊断 --------------------- */

console.log('\n小程序数据层端到端（Taro · 网络失败诊断）\n')

/**
 * 维护者 2026-11-08 在真机上看到病例页一片红：**「网络请求失败」**。
 *
 * 病根（两层）：
 *   ① 微信的失败对象字段名是 **`errMsg`**（`request:fail url not in domain list`），
 *      **不是 `message`** —— 旧代码只读 `.message` → 永远 undefined
 *      → 每次都落到那句笼统的兜底上，**真实原因被吞掉**；
 *   ② **目标地址从没出现在错误里** —— 手机上 `127.0.0.1` 指手机自己，
 *      不把地址亮出来，使用者判断不了自己连的是哪台机器。
 *
 * 修法：诊断层 `utils/net-error.ts`（**纯函数** → 这里能真的跑起来逐条断言）。
 */
const net = mod.netError

c.check('诊断层导出 describeNetFailure', typeof net.describeNetFailure === 'function')
c.check('诊断层导出 formatNetFailure', typeof net.formatNetFailure === 'function')

/* ---- ① 微信的真实原因要被认出来，而不是被吞掉 ---- */
const domainFail = net.describeNetFailure({
  raw: 'request:fail url not in domain list',
  url: 'https://mai.example.com/api/patients',
  transport: 'request',
  release: true,
})
c.check(
  '「url not in domain list」→ 结论点明是合法域名没配',
  domainFail.summary.includes('合法域名'),
  domainFail.summary,
)
c.check(
  '「url not in domain list」→ 真实原因保留原文',
  domainFail.reason.includes('url not in domain list'),
  domainFail.reason,
)
c.check(
  '「url not in domain list」→ 建议里给出「去哪儿配」',
  domainFail.hints.some((h) => h.includes('request 合法域名') && h.includes('mp.weixin.qq.com')),
  JSON.stringify(domainFail.hints),
)
c.check(
  '诊断里带上了目标地址（使用者得知道连的是哪台机器）',
  domainFail.target === 'https://mai.example.com/api/patients',
  domainFail.target,
)

/* ---- ② 手机上 127.0.0.1 指手机自己 —— 这条最容易踩 ---- */
const loopFail = net.describeNetFailure({
  raw: 'request:fail url not in domain list',
  url: 'http://127.0.0.1:5178/api/patients',
  transport: 'request',
  release: false,
})
c.check(
  '地址是回环地址 → 结论点明「手机上指手机自己」',
  loopFail.summary.includes('手机自己'),
  loopFail.summary,
)
c.check(
  '地址是回环地址 → 建议里给出该改成什么',
  loopFail.hints.some((h) => h.includes('局域网 IP')),
  JSON.stringify(loopFail.hints),
)

/* ---- ③ 其它常见失败各有各的说法 ---- */
c.check(
  '超时 → 结论说超时',
  net.describeNetFailure({ raw: 'request:fail timeout', url: 'https://mai.example.com/api/health' })
    .summary.includes('超时'),
)
c.check(
  '连接被拒 → 结论说服务器没在监听',
  net.describeNetFailure({ raw: 'ECONNREFUSED', url: 'https://mai.example.com/api/health' }).summary.includes(
    '拒绝',
  ),
)
c.check(
  'DNS 解析失败 → 结论说解析不出来',
  net.describeNetFailure({ raw: 'getaddrinfo ENOTFOUND mai.example.com' }).summary.includes('解析'),
)
c.check(
  '云环境不可用 → 结论说云环境',
  net.describeNetFailure({ raw: 'errCode: -501000 | errMsg: Environment not found' }).summary.includes(
    '云环境',
  ),
)
c.check(
  '认不出来的原因 → 也得有结论（不能空着）',
  net.describeNetFailure({ raw: 'something weird' }).summary.length > 0,
)

/* ---- ④ 微信的规矩：只收 https + 域名 + 不收 IP / 端口 ---- */
c.check(
  'http 地址 → 提示里说清正式版只允许 https',
  net
    .describeNetFailure({ raw: 'fail', url: 'http://mai.example.com/api/health', release: true })
    .hints.some((h) => h.includes('https')),
)
c.check(
  'IP 地址 → 提示里说 request 合法域名不收 IP',
  net
    .describeNetFailure({ raw: 'fail', url: 'https://203.0.113.9/api/health' })
    .hints.some((h) => h.includes('不收 IP')),
)
c.check(
  '带端口 → 提示里说 request 合法域名不收端口',
  net
    .describeNetFailure({ raw: 'fail', url: 'https://mai.example.com:8443/api/health' })
    .hints.some((h) => h.includes('不收端口')),
)
c.check(
  '局域网地址 → 提示里说手机与电脑要同一个 Wi-Fi',
  net
    .describeNetFailure({ raw: 'fail', url: 'http://192.168.1.20:5178/api/health' })
    .hints.some((h) => h.includes('Wi-Fi')),
)

/* ---- ⑤ 传输方式要出现在诊断里（使用者得知道走的是哪条路） ---- */
c.check(
  'request 传输 → 诊断里说明受合法域名校验',
  net
    .describeNetFailure({ raw: 'fail', url: 'https://mai.example.com/api/health', transport: 'request' })
    .hints.some((h) => h.includes('合法域名')),
)
c.check(
  'cloud 传输 → 诊断里说明不受合法域名限制',
  net
    .describeNetFailure({ raw: 'fail', url: 'https://mai.example.com/api/health', transport: 'cloud' })
    .hints.some((h) => h.includes('云函数')),
)

/* ---- ⑥ 一行版（给 ApiError 的 message 用）也要带地址 ---- */
const oneLine = net.formatNetFailure(domainFail)
c.check(
  '一行版包含结论、原因与地址',
  oneLine.includes('合法域名') && oneLine.includes('mai.example.com'),
  oneLine,
)

/* ---- ⑦ 助手函数 ---- */
c.check('hostOf 取 host 不带端口', net.hostOf('https://mai.example.com:8443/api/x') === 'mai.example.com')
c.check('hostOf 认出回环地址', net.isLoopbackHost('127.0.0.1') && net.isLoopbackHost('localhost'))
c.check('hostOf 认出局域网地址', net.isPrivateHost('192.168.1.20') && net.isPrivateHost('10.0.0.5'))
c.check('hostOf 认出裸 IP', net.isIpHost('203.0.113.9') && !net.isIpHost('mai.example.com'))
c.check('briefReason 截掉 callid', !net.briefReason('boom (callid: 1793943240389-abc)').includes('callid'))

/* ---------------- 第八段：构建期地址校验（占位域名不许进包） ---------------- */

console.log('\n小程序数据层端到端（Taro · 构建期地址校验）\n')

/**
 * 2026-11-08 的事故：`PULSE_API_BASE=https://mai.example.com npm run mp:taro:build`
 * 产出一份**装上就必然连不上**的包，构建过程一声不响，第二天开发者工具一开满屏红。
 *
 * `example.com` 是 RFC 2606 保留域名，被 IANA 永久保留、**不指向任何服务器** ——
 * 任何环境、任何网络下都不可能通。所以它属于「**确定**不可能通」，构建期就该拦。
 *
 * 这里的断言分两半，两半同等重要：
 *   ① 该拦的**必须拦住**（否则又出一个「构建成功、就是连不上」的包）；
 *   ② 不该拦的**必须放过**（否则正常的联调包/上线包全被挡在门外 —— 那是更大的事故）。
 */
const guard = mod.apiBaseGuard

c.check('地址校验导出 checkApiBase', typeof guard.checkApiBase === 'function')
c.check('地址校验导出 splitUrl', typeof guard.splitUrl === 'function')

/* ---- ① 该拦的：文档示例域名（永不解析） ---- */
const mustBlock = [
  'https://mai.example.com',
  'https://example.com',
  'http://api.example.org:5178',
  'https://example.net',
  'https://my.example',
  'https://foo.invalid',
  'https://example.com:8443/api/x',
  // ↓ 归一化才拦得住的变体（2026-11-08 复核时逐条实测出来的漏网口子）
  'https://example.com.', // 尾点是 root-anchored FQDN，与不带点是同一个名字
  'https://example.com./x',
  'https://EXAMPLE.COM.:8443',
  'https://.example.com', // 前导点，解析结果相同
  'https://a。example.com', // U+3002 句号（NFKC 不管它，得手动换）
  'https://ａｐｉ.example.com', // 全角字母（中文输入法很容易打出来）
  'https://例え.example.com', // IDN 子域
  'https://foo.test', // .test 也是 RFC 6761 保留顶级域
  'https://example.com\\@a.cn', // 反斜杠：WHATWG 当斜杠，真实 host 是 example.com
  'https://example.com\\',
  // ↓ 文档里「换成你的域名」的占位写法，照抄进命令同样是坏包
  'https://<你的备案域名>',
  'https://你的域名',
  'https://<pulse.your-domain.cn>',
]
for (const addr of mustBlock) {
  const r = guard.checkApiBase(addr)
  c.check(`拦下示例域名：${addr}`, r.ok === false && r.level === 'error', r.message.split('\n')[0])
}

/* ---- 拦下来的话得说清「为什么」和「怎么办」，不能只说「不行」 ---- */
const blocked = guard.checkApiBase('https://mai.example.com')
c.check('拦下时说清了是示例域名', blocked.message.includes('example.com'))
c.check('拦下时给了下一步（不传变量 / 换域名 / 显式放行）',
  blocked.message.includes('PULSE_API_BASE') && blocked.message.includes('PULSE_ALLOW_PLACEHOLDER'))
c.check('拦下时提到了这是 IANA 保留域名', /保留|解析/.test(blocked.message))

/* ---- ② 不该拦的：正常联调与真实域名，一律放过 ---- */
const mustPass = [
  '', // 没注入 = 走源码里的本机默认值
  'http://127.0.0.1:5178', // 开发者工具联调
  'http://localhost:5178', // 同上（localhost 不是保留域名，真能用）
  'http://192.168.1.20:5178', // 真机联调
  'http://10.0.0.5:5178',
  'http://test:5178', // 单标签主机名 —— docker 服务名／hosts 里是真的能连的，不许误伤
  'http://invalid:8080',
  'https://pulse.my-domain.cn',
  'https://api.test.com', // test 只是普通子域，不是保留顶级
  'https://example.cn', // example 只是前缀
  'https://www.example.com.cn', // 末段是 .cn，不是 example.com 系
  'https://臧氏脉学.cn', // 真实中文域名（带点）—— 不能因为非 ASCII 就拦
  'https://pulse-1-xxx.ap-shanghai.app.tcloudbase.com/pulse-api', // 文档里的 CloudBase 网关写法（带路径）
]
for (const addr of mustPass) {
  const r = guard.checkApiBase(addr)
  c.check(`放过正常地址：${addr || '（空串）'}`, r.ok === true, r.message.split('\n')[0])
}

/* ---- http 只警告、不中断（开发者工具勾了「不校验合法域名」时能用） ---- */
const httpRes = guard.checkApiBase('http://192.168.1.20:5178')
c.check('http 地址只警告不中断（联调包要用）', httpRes.ok === true && httpRes.level === 'warn')
c.check('http 的警告说明了正式版只收 https', /https/.test(httpRes.message))

const httpsRes = guard.checkApiBase('https://pulse.my-domain.cn')
c.check('https 真实域名不报警（干净通过）', httpsRes.ok === true && httpsRes.level === 'ok')

/* ---- ③ 放行开关：故意坏包验证「注入链路」时才用 ---- */
const allowed = guard.checkApiBase('https://mai.example.com', true)
c.check(
  'PULSE_ALLOW_PLACEHOLDER 能显式放行（验证注入链路要用）',
  allowed.ok === true && allowed.level === 'warn',
)
c.check('放行时也明确说了「这个包连不上」', /连不上/.test(allowed.message))

/* ---- ④ 根本不是地址的，也得拦 ---- */
for (const addr of ['mai.example.com', 'ftp://x.example.cn', 'https://', '   ']) {
  const r = guard.checkApiBase(addr)
  // 末一个是空串（trim 后）→ 走默认值，属于合法用法
  const expected = addr.trim() === '' ? r.ok === true : r.ok === false
  c.check(`非法地址的处理：${JSON.stringify(addr)}`, expected, r.message.split('\n')[0])
}

/* ---- ⑤ splitUrl / normalizeHost 助手：端口/userinfo/IPv6/尾点都不能把 host 带歪 ---- */
c.check('splitUrl 去端口', guard.splitUrl('https://a.cn:8443/x')?.host === 'a.cn')
c.check('splitUrl 去路径', guard.splitUrl('https://a.cn/x/y?z=1')?.host === 'a.cn')
c.check('splitUrl 去 userinfo', guard.splitUrl('https://u:p@a.cn/x')?.host === 'a.cn')
c.check('splitUrl 认 IPv6', guard.splitUrl('http://[::1]:5178/x')?.host === '[::1]')
c.check('splitUrl 取协议', guard.splitUrl('HTTP://a.cn')?.scheme === 'http')
c.check('splitUrl 没协议返回 null', guard.splitUrl('a.cn:5178') === null)
c.check(
  'splitUrl 把反斜杠当分隔符（WHATWG 语义：https://example.com\\@a.cn 的 host 是 example.com）',
  guard.splitUrl('https://example.com\\@a.cn')?.host === 'example.com',
)

c.check('normalizeHost 去尾点', guard.normalizeHost('example.com.') === 'example.com')
c.check('normalizeHost 全角转半角', guard.normalizeHost('ＡＰＩ.Example.COM') === 'api.example.com')
c.check('normalizeHost 换 U+3002 句号', guard.normalizeHost('a。example.com') === 'a.example.com')
c.check('normalizeHost 小写', guard.normalizeHost('Example.COM') === 'example.com')

/* ------------------------------ 清理 ------------------------------ */
rmSync(outDir, { recursive: true, force: true })

/* ------------------------------ 汇总 ------------------------------ */

const pass = c.summary()
console.log(pass ? '\n小程序数据层端到端：全部通过\n' : '\n小程序数据层端到端：有失败项\n')
process.exit(pass ? 0 : 1)
