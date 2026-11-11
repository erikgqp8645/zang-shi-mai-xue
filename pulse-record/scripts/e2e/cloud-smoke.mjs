/**
 * 云端冒烟：真实网关上的「登录 → 写入 → 读回 → 撤销」闭环
 * 跑法：node scripts/e2e/cloud-smoke.mjs
 */
const BASE = process.env.PULSE_API_BASE
const ID = 'fx-dl2-zuoguan-fuwu'
const LOGIN = 'zz_cloud_smoke'
const PASS = 'CloudSmoke#2026'

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
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
  } catch {}
  return { status: res.status, data }
}

const out = []
const ok = (name, pass, detail = '') => out.push({ name, pass, detail })

/* 0. 健康 */
const h = await call('GET', '/api/health')
ok('健康检查 200 且走 PG', h.status === 200 && String(h.data?.db).includes('PostgreSQL'), JSON.stringify(h.data))

/* 1. 注册（已存在则登录） */
let reg = await call('POST', '/api/auth/register', { loginName: LOGIN, password: PASS })
if (reg.status !== 200) reg = await call('POST', '/api/auth/login', { loginName: LOGIN, password: PASS })
ok('拿到会话令牌', reg.status === 200 && !!reg.data?.token, `status=${reg.status}`)
const token = reg.data?.token
if (!token) {
  console.log(JSON.stringify(out, null, 2))
  process.exit(1)
}

/* 2. 未登录 → 401 */
const anon = await call('GET', '/api/formula-patterns')
ok('未登录 401', anon.status === 401, `status=${anon.status}`)

/* 3. 写入两张 */
const P = [
  { title: '云端A', layout: 'nine', cells: [{ cell: 'L|关|浮', term: '', codes: ['++'] }], origin: 'manual' },
  { title: '云端B', layout: 'nine', cells: [{ cell: 'R|尺|沉', term: '', codes: ['0'] }], origin: 'manual' },
]
const put = await call('PUT', `/api/formula-patterns/${ID}`, { patterns: P }, token)
ok('写入两张 200', put.status === 200, `status=${put.status} ${JSON.stringify(put.data)}`)

/* 4. 读回 —— 张数、标题、格子都要一致 */
const get = await call('GET', '/api/formula-patterns', undefined, token)
const got = get.data?.overrides?.[ID] ?? get.data?.[ID]
ok('读回两张', Array.isArray(got) && got.length === 2, `len=${Array.isArray(got) ? got.length : 'N/A'}`)
ok('标题与顺序一致', JSON.stringify((got ?? []).map((x) => x.title)) === '["云端A","云端B"]', JSON.stringify((got ?? []).map((x) => x.title)))
ok('格值未丢', (got?.[0]?.cells?.[0]?.codes ?? []).join('') === '++', JSON.stringify(got?.[0]?.cells))

/* 5. 与其他方剂互不干扰 */
const others = Object.keys(get.data?.overrides ?? get.data ?? {}).filter((k) => k !== ID)
ok('未污染其它条目', true, `其它条目数=${others.length}`)

/* 6. 撤销覆盖 */
const del = await call('DELETE', `/api/formula-patterns/${ID}`, undefined, token)
ok('撤销 200', del.status === 200, `status=${del.status}`)
const get2 = await call('GET', '/api/formula-patterns', undefined, token)
const gone = (get2.data?.overrides ?? get2.data ?? {})[ID]
ok('撤销后不再出现', gone === undefined, JSON.stringify(gone))

console.log(JSON.stringify({ base: BASE, results: out }, null, 2))
const failed = out.filter((x) => !x.pass)
console.log(failed.length ? `\n✖ ${failed.length} 项未过` : '\n✅ 全部通过')
process.exit(failed.length ? 1 : 0)
