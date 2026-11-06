/**
 * 端到端测试：账号与数据隔离（多用户）
 *
 * 自己起一个后端进程（用临时库，不碰 local-data/history.sqlite），
 * 然后用 fetch 打接口，验「两个账号互不干涉」这条底线。
 *
 * 跑法：node scripts/e2e/auth-isolation.mjs
 *
 * 关键判据：**跨用户访问一律 404**（不是 403）——
 * 403 会泄露「这东西存在」，404 不会。
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------ 起服务 ------------------------------ */

const dir = mkdtempSync(join(tmpdir(), 'pulse-e2e-'))
const DB = join(dir, 'test.sqlite')
const PORT = 5300 + Math.floor(Math.random() * 400)

function startServer(env = {}) {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      PULSE_DB: DB,
      // 这组测试的前提就是「未配微信配置」—— 显式清空四个名字，
      // 别让本机 shell 里 export 过的凭据把前提带偏（老名字 + 云函数用的新名字）。
      WX_APPID: '',
      WX_APPSECRET: '',
      PULSE_WX_APPID: '',
      PULSE_WX_APPSECRET: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.logs = ''
  child.stdout.on('data', (d) => (child.logs += d))
  child.stderr.on('data', (d) => (child.logs += d))
  return child
}

async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/health`)
      if (r.ok) return await r.json()
    } catch {
      /* 还没起来 */
    }
    await sleep(120)
  }
  throw new Error('后端没起来')
}

/* ------------------------------ 断言 ------------------------------ */

let pass = 0
let fail = 0
const failures = []

function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ' —— ' + detail : ''}`)
    console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`)
  }
}

/* ------------------------------ 请求 ------------------------------ */

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* 空体 */
  }
  return { status: res.status, data }
}

/* ------------------------------ 主流程 ------------------------------ */

let server = startServer()
try {
  const health = await waitHealthy()
  console.log(`\n【服务】mode=${health.mode}  db=${health.db}\n`)

  /* --- 0. 未登录 --- */
  console.log('【0】未登录')
  {
    const r = await api('/api/patients')
    check('无令牌访问 /api/patients → 401', r.status === 401, `实际 ${r.status}`)
    const r2 = await api('/api/health')
    check('/api/health 公开可读', r2.status === 200)
    const r3 = await api('/api/auth/login', { method: 'POST', body: { loginName: 'nope', password: 'x' } })
    check('登录名不存在 → 401（不区分「用户不存在」与「密码错」）', r3.status === 401, `实际 ${r3.status}`)
  }

  /* --- 1. 注册两个账号 --- */
  console.log('\n【1】注册两个账号')
  const nameA = `testerA${Date.now().toString(36)}`
  const nameB = `testerB${Date.now().toString(36)}`
  let tokenA, tokenB
  {
    const a = await api('/api/auth/register', {
      method: 'POST',
      body: { loginName: nameA, displayName: '甲', password: 'secret123' },
    })
    check('注册 A → 200 且带令牌', a.status === 200 && !!a.data?.token, `实际 ${a.status}`)
    tokenA = a.data?.token

    const b = await api('/api/auth/register', {
      method: 'POST',
      body: { loginName: nameB, displayName: '乙', password: 'secret123' },
    })
    check('注册 B → 200 且带令牌', b.status === 200 && !!b.data?.token, `实际 ${b.status}`)
    tokenB = b.data?.token

    const dup = await api('/api/auth/register', {
      method: 'POST',
      body: { loginName: nameA, displayName: '丙', password: 'secret123' },
    })
    check('重复登录名注册 → 409', dup.status === 409, `实际 ${dup.status}`)

    const weak = await api('/api/auth/register', {
      method: 'POST',
      body: { loginName: `w${Date.now().toString(36)}`, password: '123' },
    })
    check('弱密码（<6 位）→ 400', weak.status === 400, `实际 ${weak.status}`)

    const badName = await api('/api/auth/register', {
      method: 'POST',
      body: { loginName: '有中文的名字', password: 'secret123' },
    })
    check('非法登录名 → 400', badName.status === 400, `实际 ${badName.status}`)
  }

  /* --- 2. A 建一份完整数据 --- */
  console.log('\n【2】A 建立数据（患者＋就诊＋用药＋自定义符号）')
  const patientId = `ptest${Date.now().toString(36)}`
  const visitId = `vtest${Date.now().toString(36)}`
  let medId
  {
    const r = await api('/api/patients', {
      method: 'POST',
      token: tokenA,
      body: {
        id: patientId,
        name: '甲的患者',
        layout: 'nine',
        visits: [{ id: visitId, label: '261102', at: Date.now(), values: { 'L|寸|浮': ['+'] } }],
        medications: [
          { id: 'mtest1', visitId, name: '六味地黄丸', pulse: '尺脉弱', adjust: '', usage: '', note: '' },
        ],
      },
    })
    check('A 保存患者 → 200', r.status === 200, `实际 ${r.status}`)
    medId = 'mtest1'

    const s = await api('/api/symbols', { method: 'POST', token: tokenA, body: { code: 'S', name: '涩' } })
    check('A 建自定义符号 → 200', s.status === 200, `实际 ${s.status}`)
  }

  /* --- 3. B 越权访问 A 的数据 --- */
  console.log('\n【3】B 越权访问 A 的数据（应全部 404）')
  {
    const g = await api(`/api/patients/${patientId}`, { token: tokenB })
    check('B 读 A 的患者 → 404', g.status === 404, `实际 ${g.status}`)

    const p = await api(`/api/patients/${patientId}`, { method: 'PATCH', token: tokenB, body: { name: '被改了' } })
    check('B 改名 A 的患者 → 404', p.status === 404, `实际 ${p.status}`)

    const pl = await api(`/api/patients/${patientId}`, { method: 'PATCH', token: tokenB, body: { layout: 'seven' } })
    check('B 改 A 的患者体例 → 404', pl.status === 404, `实际 ${pl.status}`)

    const d = await api(`/api/patients/${patientId}`, { method: 'DELETE', token: tokenB })
    check('B 删 A 的患者 → 404', d.status === 404, `实际 ${d.status}`)

    const gv = await api(`/api/visits/${visitId}`, { token: tokenB })
    check('B 读 A 的就诊 → 404', gv.status === 404, `实际 ${gv.status}`)

    const pv = await api(`/api/visits/${visitId}`, {
      method: 'PATCH',
      token: tokenB,
      body: { label: '被改了' },
    })
    check('B 改 A 的就诊 → 404', pv.status === 404, `实际 ${pv.status}`)

    const dv = await api(`/api/visits/${visitId}`, { method: 'DELETE', token: tokenB })
    check('B 删 A 的就诊 → 404', dv.status === 404, `实际 ${dv.status}`)

    const gm = await api(`/api/patients/${patientId}/medication`, { token: tokenB })
    check('B 读 A 的用药 → 404', gm.status === 404, `实际 ${gm.status}`)

    const pm = await api(`/api/patients/${patientId}/medication`, {
      method: 'POST',
      token: tokenB,
      body: { medications: [] },
    })
    check('B 覆盖 A 的用药 → 404', pm.status === 404, `实际 ${pm.status}`)

    const vm = await api(`/api/visits/${visitId}/medication`, { token: tokenB })
    check('B 读 A 那次就诊的用药 → 404', vm.status === 404, `实际 ${vm.status}`)

    const dm = await api(`/api/medication/${medId}`, { method: 'DELETE', token: tokenB })
    check('B 删 A 的用药 → 404', dm.status === 404, `实际 ${dm.status}`)
  }

  /* --- 4. A 的数据没被 B 改动 --- */
  console.log('\n【4】A 的数据完好')
  {
    const g = await api(`/api/patients/${patientId}`, { token: tokenA })
    check('A 仍能读到自己的患者', g.status === 200, `实际 ${g.status}`)
    check('A 的患者姓名未被改', g.data?.patient?.name === '甲的患者', `实际 ${g.data?.patient?.name}`)
    check('A 的就诊记录还在', (g.data?.patient?.visits?.length ?? 0) === 1)
    const m = await api(`/api/patients/${patientId}/medication`, { token: tokenA })
    check('A 的用药记录还在', (m.data?.medication?.length ?? 0) === 1, `实际 ${m.data?.medication?.length}`)
  }

  /* --- 5. 列表与搜索隔离 --- */
  console.log('\n【5】列表与搜索隔离')
  {
    const la = await api('/api/patients', { token: tokenA })
    check('A 的列表里有自己的患者', (la.data?.patients?.length ?? 0) === 1)
    const lb = await api('/api/patients', { token: tokenB })
    check('B 的列表里没有 A 的患者', (lb.data?.patients?.length ?? 0) === 0, `实际 ${lb.data?.patients?.length}`)

    const sa = await api('/api/search?q=甲的患者', { token: tokenA })
    check('A 搜得到自己的患者', (sa.data?.patients?.length ?? 0) === 1)
    const sb = await api('/api/search?q=甲的患者', { token: tokenB })
    check('B 搜不到 A 的患者', (sb.data?.patients?.length ?? 0) === 0, `实际 ${sb.data?.patients?.length}`)
  }

  /* --- 6. 自定义符号隔离 --- */
  console.log('\n【6】自定义符号隔离')
  {
    const la = await api('/api/symbols', { token: tokenA })
    check('A 看得到自己建的符号', (la.data?.symbols?.length ?? 0) === 1)
    const lb = await api('/api/symbols', { token: tokenB })
    check('B 看不到 A 的符号', (lb.data?.symbols?.length ?? 0) === 0, `实际 ${lb.data?.symbols?.length}`)
    const rb = await api('/api/symbols', { method: 'DELETE', token: tokenB })
    check('B 删 A 的符号 → 404', rb.status === 404, `实际 ${rb.status}`)
    const la2 = await api('/api/symbols', { token: tokenA })
    check('A 的符号还在', (la2.data?.symbols?.length ?? 0) === 1)
  }

  /* --- 7. 用别人的 id 存患者：不会覆盖 --- */
  console.log('\n【7】拿别人的患者 id 存：不得覆盖')
  {
    const r = await api('/api/patients', {
      method: 'POST',
      token: tokenB,
      body: { id: patientId, name: 'B 抢注', layout: 'nine', visits: [] },
    })
    check('B 用 A 的患者 id 保存 → 404', r.status === 404, `实际 ${r.status}`)
    const g = await api(`/api/patients/${patientId}`, { token: tokenA })
    check('A 的患者没被 B 抢走', g.status === 200 && g.data?.patient?.name === '甲的患者')
  }

  /* --- 8. 会话生命周期 --- */
  console.log('\n【8】会话生命周期')
  {
    const me = await api('/api/auth/me', { token: tokenA })
    check('/api/auth/me 带令牌 → 200', me.status === 200, `实际 ${me.status}`)
    check('/api/auth/me 返回登录名', me.data?.user?.loginName === nameA)

    const noTok = await api('/api/auth/me')
    check('/api/auth/me 无令牌 → 401', noTok.status === 401, `实际 ${noTok.status}`)

    const bogus = await api('/api/patients', { token: 'not-a-real-token' })
    check('伪造令牌 → 401', bogus.status === 401, `实际 ${bogus.status}`)

    const out = await api('/api/auth/logout', { method: 'POST', token: tokenA })
    check('退出登录 → 200', out.status === 200, `实际 ${out.status}`)
    const afterOut = await api('/api/patients', { token: tokenA })
    check('退出后旧令牌失效 → 401', afterOut.status === 401, `实际 ${afterOut.status}`)

    // 重新登录拿新令牌
    const rel = await api('/api/auth/login', {
      method: 'POST',
      body: { loginName: nameA, password: 'secret123' },
    })
    check('重新登录 → 200', rel.status === 200, `实际 ${rel.status}`)
    tokenA = rel.data?.token
  }

  /* --- 9. 改密码：旧令牌全失效 --- */
  console.log('\n【9】改密码')
  {
    const old = await api('/api/auth/login', {
      method: 'POST',
      body: { loginName: nameB, password: 'secret123' },
    })
    const oldToken = old.data?.token
    const ch = await api('/api/auth/change-password', {
      method: 'POST',
      token: oldToken,
      body: { oldPassword: 'secret123', newPassword: 'newsecret456' },
    })
    check('改密码 → 200', ch.status === 200, `实际 ${ch.status}`)
    const after = await api('/api/patients', { token: oldToken })
    check('改密码后旧令牌失效 → 401', after.status === 401, `实际 ${after.status}`)
    const oldPw = await api('/api/auth/login', {
      method: 'POST',
      body: { loginName: nameB, password: 'secret123' },
    })
    check('旧密码不能再登录 → 401', oldPw.status === 401, `实际 ${oldPw.status}`)
    const newPw = await api('/api/auth/login', {
      method: 'POST',
      body: { loginName: nameB, password: 'newsecret456' },
    })
    check('新密码能登录 → 200', newPw.status === 200, `实际 ${newPw.status}`)
  }

  /* --- 10. 微信绑定（未配微信配置时应给出明确提示，而不是崩） --- */
  console.log('\n【10】微信绑定')
  {
    const r = await api('/api/auth/wechat/login', { method: 'POST', body: { code: 'fake-code' } })
    check('未配微信配置时给出明确中文提示', r.status === 400 && typeof r.data?.error === 'string', `实际 ${r.status} ${r.data?.error ?? ''}`)
    const err = String(r.data?.error ?? '')
    check('提示里说明了原因', err.includes('WX_APPID'), r.data?.error)
    // 提示要**点名具体缺哪个变量** —— 两个都缺时两个都得出现（否则只说了一个，看不出还缺啥）
    check('提示里点名了缺哪些变量', err.includes('PULSE_WX_APPID') && err.includes('PULSE_WX_APPSECRET'), r.data?.error)
    const b = await api('/api/auth/wechat/bind', {
      method: 'POST',
      body: { code: 'fake-code', loginName: nameA, password: 'secret123' },
    })
    check('未配微信配置时绑定也给出明确提示', b.status === 400, `实际 ${b.status}`)
  }

  /* --- 11. 单机模式 --- */
  console.log('\n【11】单机模式')
  {
    server.kill('SIGTERM')
    await sleep(400)
    server = startServer({ PULSE_SINGLE_USER: '1' })
    const h = await waitHealthy()
    check('health.mode = single', h.mode === 'single', `实际 ${h.mode}`)
    const r = await api('/api/patients')
    check('单机模式不用登录即可读病例', r.status === 200, `实际 ${r.status}`)
    const reg = await api('/api/auth/register', {
      method: 'POST',
      body: { loginName: `x${Date.now().toString(36)}`, password: 'secret123' },
    })
    check('单机模式注册 → 409 并说明原因', reg.status === 409, `实际 ${reg.status}`)
  }
} finally {
  server.kill('SIGTERM')
  await sleep(200)
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n=== 通过 ${pass} ｜ 失败 ${fail} ===`)
if (fail > 0) {
  console.log('失败项：')
  for (const f of failures) console.log('  · ' + f)
  process.exit(1)
}
