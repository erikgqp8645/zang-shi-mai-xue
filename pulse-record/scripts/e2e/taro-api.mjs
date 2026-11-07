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

/* ------------------------------ 清理 ------------------------------ */
rmSync(outDir, { recursive: true, force: true })

/* ------------------------------ 汇总 ------------------------------ */

const pass = c.summary()
console.log(pass ? '\n小程序数据层端到端：全部通过\n' : '\n小程序数据层端到端：有失败项\n')
process.exit(pass ? 0 : 1)
