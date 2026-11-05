#!/usr/bin/env node
/**
 * 小程序数据层端到端 —— 在 Node 里用 wx 垫片跑**真实的小程序代码**，连**真实的后端**
 *
 * 为什么要有这个：小程序页面只能在微信开发者工具/真机里点，但页面底下那一层
 * （`utils/config.js` / `utils/api.js` / `utils/data.js` / `utils/auth.js`）是纯 JS，
 * 只依赖 `wx.request` 与 `wx.*Storage*`。垫一个 `wx` 上去，就能在没有开发者工具的机器上、
 * 在 CI 里，把「登录 → 建患者 → 读回 → 搜索 → 改就诊 → 用药 → 自定义符号 → 令牌失效」
 * 这条链路真跑一遍。
 *
 * 它验证的是**页面真正会走的那条路**：
 *   - 请求确实从 `config.resolveApiBase()` 取地址（「我的」页改地址能生效）
 *   - 令牌放在 Authorization 头里，401 会清凭证并 reLaunch 到登录页
 *   - `data.js` 每个方法的返回形状与页面用法一致
 *
 * 不覆盖：WXML 渲染、事件绑定（那是 `mp-lint.mjs` 的活）、真机上的网络与相册权限。
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { ROOT, makeChecker, startApi } from './lib.mjs'

const require = createRequire(import.meta.url)
const MP = join(ROOT, 'miniprogram')

/* ------------------------------ wx 垫片 ------------------------------ */

const store = new Map()
const relaunched = []

globalThis.getCurrentPages = () => []

globalThis.wx = {
  request({ url, method = 'GET', data, header = {}, success, fail }) {
    const init = { method, headers: header }
    if (data !== undefined && method !== 'GET') init.body = JSON.stringify(data)
    fetch(url, init)
      .then(async (res) => {
        const text = await res.text()
        let body = {}
        try {
          body = text ? JSON.parse(text) : {}
        } catch {
          body = text
        }
        success({ statusCode: res.status, data: body })
      })
      .catch((e) => fail({ errMsg: 'request:fail ' + e.message }))
  },
  getStorageSync(key) {
    return store.has(key) ? store.get(key) : ''
  },
  setStorageSync(key, value) {
    store.set(key, value)
  },
  removeStorageSync(key) {
    store.delete(key)
  },
  reLaunch({ url }) {
    relaunched.push(url)
  },
  showToast() {},
  showModal() {},
}

/* 注意：必须先装好 globalThis.wx，再 require 小程序模块 */
const config = require(join(MP, 'utils/config.js'))
const dataApi = require(join(MP, 'utils/data.js'))
const authApi = require(join(MP, 'utils/auth.js'))

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

console.log('\n小程序数据层端到端（多用户模式）\n')

const multi = await startApi({ single: false })

/* —— 服务器地址：改完立刻生效 —— */
const saved = config.setApiBase(multi.base)
c.check(
  '「我的」页保存地址后，resolveApiBase 立刻用新地址',
  saved.ok && config.resolveApiBase() === multi.base,
  config.resolveApiBase(),
)
c.check('地址落在本地存储的同一个键上', wx.getStorageSync(config.API_BASE_KEY) === multi.base)

const rejected = config.setApiBase('192.168.1.20:5178')
c.check('不带 http:// 的地址被拒，且不覆盖已保存的值', !rejected.ok && config.resolveApiBase() === multi.base)

/* —— 健康检查 —— */
const health = await dataApi.health()
c.check('健康检查走通，返回多用户模式', health && health.mode === 'multi', JSON.stringify(health))

/* —— 未登录：401 ＋ 回登录页 —— */
relaunched.length = 0
const unauth = await expectError(() => dataApi.listPatients())
c.check('未登录取病例列表 → 401', unauth && unauth.status === 401, unauth && unauth.message)
c.check('401 后自动 reLaunch 到登录页', relaunched[0] === '/pages/login/login', String(relaunched[0]))
c.check('401 后本地令牌被清掉', !wx.getStorageSync('pulse.token'))

/* —— 注册即登录 —— */
const reg = await authApi.register(LOGIN, '小程序联调', PASSWORD)
c.check('注册成功并拿到令牌与用户', !!(reg && reg.token && reg.user), JSON.stringify(reg && reg.user))
c.check('令牌已存本地', wx.getStorageSync('pulse.token') === reg.token)

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
c.check('保存患者成功并返回 id', !!(created && created.id), JSON.stringify(created && created.id))
c.check('就诊记录带上了体质与疗法', created && created.visits && created.visits[0] && created.visits[0].constitution === '肾虚' && created.visits[0].therapy === '三焦疗法')

const patientId = created && created.id

/* —— 读回：符号原样 —— */
const one = await dataApi.getPatient(patientId)
const back = one && one.visits && one.visits[0]
c.check(
  '读回的脉象符号与录入一致（X↑ 这种叠加也保住）',
  back && JSON.stringify(back.values['L|关|沉']) === JSON.stringify(['X', '↑']),
  back && JSON.stringify(back.values),
)

const list = await dataApi.listPatients()
const row = list.find((p) => p.id === patientId)
c.check('列表里能看到这位患者，就诊次数为 1', !!row && row.visitCount === 1, JSON.stringify(row))

/* —— 搜索三种口径 —— */
const bySymbol = await dataApi.searchPatients('↑')
c.check('按脉象符号搜「↑」命中', bySymbol.some((p) => p.id === patientId))
const byDate = await dataApi.searchPatients('261104')
c.check('按日期标签搜「261104」命中并带出命中次记录', byDate.some((p) => p.id === patientId && (p.matchedVisits || []).some((v) => v.id === VISIT_ID)))
const byName = await dataApi.searchPatients('小程序联调')
c.check('按姓名搜命中', byName.some((p) => p.id === patientId))
const miss = await dataApi.searchPatients('绝对不存在的关键字xyz')
c.check('搜不到时返回空数组而非报错', Array.isArray(miss) && miss.length === 0)

/* —— 改一次就诊（单次语义） —— */
const patched = await dataApi.updateVisit(VISIT_ID, { label: '261104-改' })
c.check('改日期标签只动这一次', !!(patched && patched.label === '261104-改'), JSON.stringify(patched && patched.label))

/* —— 格值形状：视图层压过的 {"0":"X"} 要还原成 ["X"] ——
 * 小程序自定义组件的属性会在 逻辑层→视图层→逻辑层 之间转一圈，
 * 数组被压成「数字下标的普通对象」。这种形状存进库，这一格就废了，
 * 所以服务端写库前一律规整、读出来也规整。 */
const shapeFixed = await dataApi.updateVisit(VISIT_ID, { values: { 'L|寸|浮': { 0: 'X' }, 'R|寸|中': { 0: '++', 1: '↑' } } })
const shapeVals = (shapeFixed && shapeFixed.values) || {}
c.check(
  '服务端把 {"0":"X"} 还原成 ["X"]（视图层压过的形状不能存进库）',
  Array.isArray(shapeVals['L|寸|浮']) && shapeVals['L|寸|浮'][0] === 'X',
  JSON.stringify(shapeVals['L|寸|浮']),
)
c.check(
  '多符号的 {"0":"++","1":"↑"} 还原成 ["++","↑"]（顺序不乱）',
  Array.isArray(shapeVals['R|寸|中']) && shapeVals['R|寸|中'].join('') === '++↑',
  JSON.stringify(shapeVals['R|寸|中']),
)
const shapeBack = await dataApi.getPatient(patientId)
const shapeVisit = ((shapeBack && shapeBack.visits) || []).find((v) => v.id === VISIT_ID)
const backVals = (shapeVisit && shapeVisit.values) || {}
c.check(
  '读回来的格值仍是数组（库里没有脏形状）',
  !!shapeVisit &&
    Object.keys(backVals).length > 0 &&
    Object.values(backVals).every((v) => Array.isArray(v)),
  JSON.stringify(backVals),
)

/* —— 用药记录 —— */
const meds = await dataApi.saveVisitMedication(VISIT_ID, [
  { name: '引火归元', pulse: '右关 沉 ++', adjust: '', usage: '冷水服', note: '联调用' },
])
c.check('该次就诊写入用药记录', Array.isArray(meds) && meds.length === 1 && meds[0].name === '引火归元', JSON.stringify(meds))
const medsBack = await dataApi.listVisitMedication(VISIT_ID)
c.check('用药记录读回', medsBack.length === 1 && medsBack[0].usage === '冷水服', JSON.stringify(medsBack))
const medsPatient = await dataApi.listMedication(patientId)
c.check('按患者取用药也看得到这一条', medsPatient.length === 1)
const medGone = await dataApi.deleteMedication(medsBack[0].id)
c.check('删一条用药记录', !!(medGone && medGone.ok))
const medsEmpty = await dataApi.listVisitMedication(VISIT_ID)
c.check('删完为空', medsEmpty.length === 0)

/* —— 自定义符号 —— */
const sym = await dataApi.saveCustomSymbol({ code: 'Z', name: '联调符号' })
c.check('新增自定义符号', !!(sym && sym.code === 'Z'), JSON.stringify(sym))
const syms = await dataApi.listCustomSymbols()
c.check('自定义符号出现在清单里', syms.some((s) => s.code === 'Z'))
const reserved = await expectError(() => dataApi.saveCustomSymbol({ code: 'X', name: '细' }))
c.check('与讲义固定符号重名被拒（400）', !!reserved && reserved.status === 400, reserved && reserved.message)
const symDel = await dataApi.deleteCustomSymbol('Z')
c.check('删除自定义符号', !!(symDel && symDel.ok))
const symsAfter = await dataApi.listCustomSymbols()
c.check('删完清单里没有了', !symsAfter.some((s) => s.code === 'Z'))

/* —— 改体例（7 脉点 / 9 行）：只改体例，不动格值 —— */
const before = await dataApi.getPatient(patientId)
const beforeValues = JSON.stringify(before.visits[0].values)
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
wx.removeStorageSync('pulse.token')
relaunched.length = 0
const expired = await expectError(() => dataApi.listPatients())
c.check('令牌被清后请求 → 401 并回登录页', !!expired && expired.status === 401 && relaunched[0] === '/pages/login/login')

await multi.stop()

/* ------------------------------ 第二段：单机模式 ------------------------------ */

console.log('\n小程序数据层端到端（单机模式）\n')

const single = await startApi({ single: true })
wx.setStorageSync(config.API_BASE_KEY, single.base)
store.delete('pulse.token')

const h2 = await dataApi.health()
c.check('健康检查返回单机模式', h2 && h2.mode === 'single', JSON.stringify(h2))

const noTokenList = await dataApi.listPatients()
c.check('单机模式不带令牌也能取病例（进页面就能用）', Array.isArray(noTokenList))

const s = await dataApi.savePatient({ name: '单机·患者', layout: 'seven', visits: [{ label: '261104', at: 1762185600000, values: { 'R|尺|沉': ['+'] } }] })
c.check('单机模式能建患者', !!(s && s.id))
const sBack = await dataApi.getPatient(s.id)
c.check('7 脉点体例保住了', !!(sBack && sBack.layout === 'seven'), sBack && sBack.layout)

const regErr = await expectError(() => authApi.register('mptest_single', '不该建号', PASSWORD))
c.check('单机模式注册被拒（409），不会误建账号', !!regErr && regErr.status === 409, regErr && regErr.message)

await single.stop()

/* ------------------------------ 汇总 ------------------------------ */

const pass = c.summary()
console.log(pass ? '\n小程序数据层端到端：全部通过\n' : '\n小程序数据层端到端：有失败项\n')
process.exit(pass ? 0 : 1)
