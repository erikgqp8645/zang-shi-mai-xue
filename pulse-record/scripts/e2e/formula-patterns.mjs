/**
 * 端到端测试：方剂脉象图的保存与同步
 *
 * 这条链的用户价值就一句话：**网页上改完保存，别的机器打开就是这一份**。
 * 所以测的重点不是「接口回 200」，而是：
 *   ① 存进去的格值、顺序、张数，重新拉出来一模一样；
 *   ② **进程重启后还在**（＝真的落库了，不是内存里的假象）；
 *   ③ 校验拦住坏数据，且拦下来时原有数据不被破坏；
 *   ④ 「一张都不挂」要留痕 —— 否则会静默回落到内置基线，把刚删的图又显示出来；
 *   ⑤ 账号之间互不可见（B 既读不到 A 的，也删不掉 A 的）；
 *   ⑥ 未登录一律 401。
 *
 * 跑法：node scripts/e2e/formula-patterns.mjs
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeChecker, startApi } from './lib.mjs'

const ID = 'fx-dl2-zuoguan-fuwu'
const P1 = {
  title: '浮大版',
  layout: 'nine',
  cells: [
    { cell: 'L|关|浮', term: '', codes: ['++'] },
    { cell: 'R|寸|浮', term: '', codes: ['++'] },
  ],
  origin: 'manual',
}
const P2 = {
  title: '兼尺弱',
  layout: 'nine',
  cells: [{ cell: 'L|尺|沉', term: '', codes: ['0'] }],
  origin: 'manual',
}

const checker = makeChecker()

/** 每个用例是一段异步逻辑 —— 包一层，让它同样长成 check(名字, 结果) */
async function check(name, fn) {
  const [ok, detail = ''] = await fn()
  checker.check(name, ok, detail)
}

async function call(base, method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* 空响应体 */
  }
  return { status: res.status, data }
}

/* ------------------------------------------------------------------ */
/* 单机模式：保存 / 读取 / 校验 / 重启后仍在                             */
/* ------------------------------------------------------------------ */

const dir = mkdtempSync(join(tmpdir(), 'pulse-patterns-'))
const dbFile = join(dir, 'patterns.sqlite')

let api = await startApi({ single: true, db: dbFile })

await check('基线：一条覆盖都没有', async () => {
  const r = await call(api.base, 'GET', '/api/formula-patterns')
  return [r.status === 200 && Object.keys(r.data.overrides ?? {}).length === 0, `status=${r.status}`]
})

await check('保存两张图', async () => {
  const r = await call(api.base, 'PUT', `/api/formula-patterns/${ID}`, { patterns: [P1, P2] })
  return [r.status === 200 && r.data.formulaId === ID && r.data.patterns.length === 2, `status=${r.status}`]
})

await check('重新拉取：张数、顺序、格值都对', async () => {
  const r = await call(api.base, 'GET', '/api/formula-patterns')
  const list = r.data?.overrides?.[ID]
  const ok =
    Array.isArray(list) &&
    list.length === 2 &&
    list[0].title === '浮大版' &&
    list[1].title === '兼尺弱' &&
    list[0].cells?.[0]?.codes?.[0] === '++' &&
    list[1].cells?.[0]?.cell === 'L|尺|沉'
  return [ok, JSON.stringify(list)]
})

await check('校验：21 张被拒、非数组被拒、缺 cells 被拒', async () => {
  const tooMany = await call(api.base, 'PUT', `/api/formula-patterns/${ID}`, {
    patterns: Array.from({ length: 21 }, () => ({ cells: [] })),
  })
  const notArray = await call(api.base, 'PUT', `/api/formula-patterns/${ID}`, { patterns: 'x' })
  const noCells = await call(api.base, 'PUT', `/api/formula-patterns/${ID}`, { patterns: [{ title: 'x' }] })
  const ok = tooMany.status === 400 && notArray.status === 400 && noCells.status === 400
  return [ok, `${tooMany.status}/${notArray.status}/${noCells.status}`]
})

await check('被拒之后原数据没被破坏', async () => {
  const r = await call(api.base, 'GET', '/api/formula-patterns')
  return [r.data?.overrides?.[ID]?.length === 2, JSON.stringify(r.data?.overrides?.[ID]?.length)]
})

await check('重启进程后数据还在（＝真落库）', async () => {
  await api.stop()
  api = await startApi({ single: true, db: dbFile })
  const r = await call(api.base, 'GET', '/api/formula-patterns')
  const list = r.data?.overrides?.[ID]
  return [Array.isArray(list) && list.length === 2 && list[0].title === '浮大版', JSON.stringify(list)]
})

await check('保存 0 张＝这个方剂不挂图（键在、值为空，不回落基线）', async () => {
  const put = await call(api.base, 'PUT', `/api/formula-patterns/${ID}`, { patterns: [] })
  const r = await call(api.base, 'GET', '/api/formula-patterns')
  const list = r.data?.overrides?.[ID]
  const ok = put.status === 200 && Array.isArray(list) && list.length === 0
  return [ok, JSON.stringify({ put: put.status, list })]
})

await check('恢复默认：删掉覆盖后键消失（＝回落到基线）', async () => {
  const del = await call(api.base, 'DELETE', `/api/formula-patterns/${ID}`)
  const r = await call(api.base, 'GET', '/api/formula-patterns')
  const gone = r.data?.overrides?.[ID] === undefined
  const again = await call(api.base, 'DELETE', `/api/formula-patterns/${ID}`)
  return [del.status === 200 && gone && again.status === 404, `${del.status}/${again.status}`]
})

await check('畸形路径编码回 400（不是 500）', async () => {
  const r = await call(api.base, 'PUT', '/api/formula-patterns/%E0%A4%A', { patterns: [] })
  return [r.status === 400, `status=${r.status}`]
})

await api.stop()

/* ------------------------------------------------------------------ */
/* 多用户模式：隔离与鉴权                                               */
/* ------------------------------------------------------------------ */

const multi = await startApi({ single: false, db: join(dir, 'multi.sqlite') })

await check('账号隔离：B 读不到 A 的、也删不掉 A 的', async () => {
  const a = await call(multi.base, 'POST', '/api/auth/register', {
    loginName: 'alice_pat',
    password: 'pass1234',
  })
  const b = await call(multi.base, 'POST', '/api/auth/register', {
    loginName: 'bob_pat',
    password: 'pass1234',
  })
  if (a.status !== 200 || b.status !== 200) return [false, `注册失败 ${a.status}/${b.status}`]

  const put = await call(multi.base, 'PUT', `/api/formula-patterns/${ID}`, { patterns: [P1] }, a.data.token)
  const ga = await call(multi.base, 'GET', '/api/formula-patterns', undefined, a.data.token)
  const gb = await call(multi.base, 'GET', '/api/formula-patterns', undefined, b.data.token)
  const del = await call(multi.base, 'DELETE', `/api/formula-patterns/${ID}`, undefined, b.data.token)

  const ok =
    put.status === 200 &&
    Object.keys(ga.data.overrides).length === 1 &&
    Object.keys(gb.data.overrides).length === 0 &&
    del.status === 404
  return [ok, `A=${Object.keys(ga.data.overrides).length} B=${Object.keys(gb.data.overrides).length} del=${del.status}`]
})

await check('未登录访问一律 401', async () => {
  const r = await call(multi.base, 'GET', '/api/formula-patterns')
  return [r.status === 401, `status=${r.status}`]
})

await multi.stop()
rmSync(dir, { recursive: true, force: true })
process.exit(checker.summary() ? 0 : 1)
