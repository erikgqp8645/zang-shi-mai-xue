/**
 * 演示数据：往病例库里写入几位患者及其每次就诊记录
 *
 * 用法：
 *   npm run dev            # 另开一个终端，先把服务跑起来
 *   npm run seed:demo      # 写入演示患者（先清掉旧的「演示·」患者，可重复执行）
 *   npm run seed:demo -- --reset   # 连非演示患者一起清空，再写入
 *
 * 说明：
 * - 这些是**演示用**的假数据，不是真实病案；脉象符号照讲义 p33–34 的符号集填。
 * - 演示患者名统一以「演示·」开头，便于一眼分辨、一键清理。
 * - 只写 patients / visits 两张表，不碰其它数据。
 */

import { checkPatientLayout, describeLayoutCheck } from './lib/layout-check.mjs'

const BASE = process.env.PULSE_API ?? 'http://localhost:5178'

/** 一次就诊记录的取法行：部位+取法 → [左手符号, 右手符号] */
const PATTERNS = {
  平和: {
    '寸|浮': ['+', '+'], '寸|中': ['+', '+'], '寸|沉': ['+', '+'],
    '关|浮': ['+', '+'], '关|中': ['+', '+'], '关|沉': ['+', '+'],
    '尺|浮': ['0', '0'], '尺|中': ['0', '0'], '尺|沉': ['+', '+'],
  },
  肝郁: {
    '寸|浮': ['+', '+'], '寸|中': ['++', '++'], '寸|沉': ['++', '↑'],
    '关|浮': ['0', '-'], '关|中': ['-', '↑'], '关|沉': ['++', '↑'],
    '尺|浮': ['0', '0'], '尺|中': ['0', '↑'], '尺|沉': ['++', '↑'],
  },
  上盛: {
    '寸|浮': ['↑', '↑'], '寸|中': ['↑', '↑'], '寸|沉': ['↑', '↑'],
    '关|浮': ['0', '0'], '关|中': ['-', '+'], '关|沉': ['++', '++'],
    '尺|浮': ['0', '0'], '尺|中': ['0', '+'], '尺|沉': ['++', '++'],
  },
  肾虚: {
    '寸|浮': ['-', '++'], '寸|中': ['-', '++'], '寸|沉': ['+', '++'],
    '关|浮': ['-', '↑'], '关|中': ['++', '↑'], '关|沉': ['+', '↑'],
    '尺|浮': ['0', '0'], '尺|中': ['0', '0'], '尺|沉': ['-', '-'],
  },
  顶手: {
    '寸|浮': ['↑', '↑'], '寸|中': ['↑', '↑'], '寸|沉': ['↑', '↑'],
    '关|浮': ['-', '↑'], '关|中': ['++', '↑'], '关|沉': ['+', '↑'],
    '尺|浮': ['0', '↑'], '尺|中': ['+', '↑'], '尺|沉': ['-', '↑'],
  },
  /** 弦：脉位张力大（讲义 p34 符号「|」） */
  肝郁弦: {
    '寸|浮': ['+', '+'], '寸|中': ['++', '|'], '寸|沉': ['++', '|'],
    '关|浮': ['0', '-'], '关|中': ['-|', '|'], '关|沉': ['++', '|'],
    '尺|浮': ['0', '0'], '尺|中': ['0', '|'], '尺|沉': ['++', '|'],
  },
  /** 细：讲义 p34 符号「X」 */
  细脉: {
    '寸|浮': ['X', 'X'], '寸|中': ['X', 'X'], '寸|沉': ['X', 'X'],
    '关|浮': ['X', 'X'], '关|中': ['X', 'X'], '关|沉': ['X', 'X'],
    '尺|浮': ['0', '0'], '尺|中': ['0', '0'], '尺|沉': ['X', 'X'],
  },
  /** 变脉：忽大小「#」／跳调停「TTT」／忽快慢「DDX」（讲义 p33） */
  变脉: {
    '寸|浮': ['#', '#'], '寸|中': ['TTT', 'DDX'], '寸|沉': ['#', '#'],
    '关|浮': ['0', '0'], '关|中': ['-', '+'], '关|沉': ['DDX', 'TTT'],
    '尺|浮': ['0', '0'], '尺|中': ['0', '#'], '尺|沉': ['#', '#'],
  },
}

/** 讲义 p34 的全部符号码（长码优先，用于把手工符号串拆成数组） */
const CODE_LIST = ['++++', '+++', '++', '±±', '±', '+', '0', '-', '↑', '|', '#', 'TTT', 'DDX', 'X']

/** 符号串 → 符号数组，如 'X↑' → ['X','↑'] */
function splitCodes(text) {
  const out = []
  let i = 0
  while (i < text.length) {
    const hit = CODE_LIST.find((c) => text.startsWith(c, i))
    if (hit) {
      out.push(hit)
      i += hit.length
    } else {
      i += 1
    }
  }
  return out
}

/** 演示患者清单：姓名 → 体例 + 每次就诊（日期标签 + 取用哪套符号） */
const PATIENTS = [
  {
    name: '演示·王秀兰',
    layout: 'nine',
    visits: [
      { label: '1月8日', pattern: '平和' },
      { label: '1月22日', pattern: '肝郁' },
      { label: '2月19日', pattern: '肝郁' },
      { label: '3月5日', pattern: '平和' },
    ],
  },
  {
    name: '演示·李慧敏',
    layout: 'nine',
    visits: [
      { label: '12月3日', pattern: '上盛' },
      { label: '12月17日', pattern: '顶手' },
      { label: '1月7日', pattern: '上盛' },
      { label: '1月21日', pattern: '肝郁' },
      { label: '2月11日', pattern: '肝郁' },
      { label: '2月25日', pattern: '平和' },
    ],
  },
  {
    name: '演示·陈国栋',
    layout: 'seven',
    visits: [
      { label: '3月12日', pattern: '肾虚' },
      { label: '4月9日', pattern: '肾虚' },
    ],
  },
  {
    name: '演示·赵小满',
    layout: 'nine',
    visits: [{ label: '4月28日', pattern: '顶手' }],
  },

  /* ---- 以下 10 位为扩充的演示患者 ---- */
  {
    name: '演示·孙丽华',
    layout: 'nine',
    visits: [
      { label: '2月18日', pattern: '肝郁' },
      { label: '3月4日', pattern: '肝郁弦' },
      { label: '3月25日', pattern: '肝郁弦' },
      { label: '4月15日', pattern: '平和' },
      { label: '5月6日', pattern: '平和' },
      { label: '5月27日', pattern: '肝郁' },
      { label: '6月17日', pattern: '平和' },
      { label: '7月8日', pattern: '平和' },
    ],
  },
  {
    name: '演示·周德昌',
    layout: 'seven',
    visits: [
      { label: '9月12日', pattern: '肾虚' },
      { label: '10月10日', pattern: '肾虚' },
      { label: '11月7日', pattern: '肾虚' },
    ],
  },
  {
    name: '演示·吴静怡',
    layout: 'nine',
    visits: [
      { label: '4月3日', pattern: '细脉' },
      { label: '4月24日', pattern: '平和' },
      { label: '5月15日', pattern: '变脉' },
      { label: '6月5日', pattern: '平和' },
      { label: '6月26日', pattern: '细脉' },
    ],
  },
  {
    name: '演示·郑淑珍',
    layout: 'nine',
    visits: [
      { label: '7月19日', pattern: '顶手' },
      { label: '8月16日', pattern: '上盛' },
    ],
  },
  {
    name: '演示·黄志远',
    layout: 'seven',
    visits: [
      { label: '8月2日', pattern: '肾虚' },
      { label: '9月13日', pattern: '肾虚' },
      { label: '10月21日', pattern: '变脉' },
      { label: '11月18日', pattern: '肾虚' },
    ],
  },
  {
    name: '演示·林秀英',
    layout: 'nine',
    visits: [
      { label: '1月5日', pattern: '平和' },
      { label: '2月2日', pattern: '平和' },
      { label: '3月6日', pattern: '肝郁' },
      { label: '4月3日', pattern: '平和' },
      { label: '5月8日', pattern: '细脉' },
      { label: '6月5日', pattern: '平和' },
    ],
  },
  {
    name: '演示·徐文彬',
    layout: 'nine',
    visits: [{ label: '9月26日', pattern: '上盛' }],
  },
  {
    name: '演示·马春霞',
    layout: 'seven',
    visits: [
      { label: '11月3日', pattern: '肾虚' },
      { label: '12月1日', pattern: '肾虚' },
      { label: '12月29日', pattern: '变脉' },
    ],
  },
  {
    name: '演示·何文斌',
    layout: 'nine',
    visits: [
      { label: '3月11日', pattern: '上盛' },
      { label: '4月8日', pattern: '顶手' },
      { label: '5月13日', pattern: '上盛' },
      { label: '6月10日', pattern: '肝郁' },
      { label: '7月15日', pattern: '平和' },
      { label: '8月19日', pattern: '变脉' },
      { label: '9月16日', pattern: '平和' },
    ],
  },
  {
    name: '演示·郭丽君',
    layout: 'nine',
    visits: [
      { label: '2月14日', pattern: '肝郁' },
      { label: '3月28日', pattern: '肝郁弦' },
      { label: '5月10日', pattern: '平和' },
      { label: '6月21日', pattern: '细脉' },
    ],
  },
]

/**
 * 登录令牌。
 *
 * 单机模式（服务端 PULSE_SINGLE_USER=1）不用令牌，直接跑。
 * 多用户模式要带令牌 —— 两种给法：
 *   PULSE_TOKEN=<token>                    直接用现成的令牌
 *   PULSE_LOGIN=<登录名> PULSE_PASSWORD=<密码>   脚本自己去换一个
 */
const TOKEN = await resolveToken()

async function resolveToken() {
  if (process.env.PULSE_TOKEN) return process.env.PULSE_TOKEN
  const login = process.env.PULSE_LOGIN
  const password = process.env.PULSE_PASSWORD
  if (!login || !password) return null
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginName: login, password }),
  })
  if (!res.ok) throw new Error(`登录失败：${res.status}`)
  const data = await res.json()
  return data?.token ?? null
}

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}`)
  return res.json()
}

/** 把「部位|取法 → [左, 右]」展开成 visits 用的 values 结构 */
function toValues(pattern, layout) {
  const values = {}
  for (const [key, [l, r]] of Object.entries(PATTERNS[pattern])) {
    const [organ, depth] = key.split('|')
    // 7 脉点体例只取尺的「沉」
    if (layout === 'seven' && organ === '尺' && depth !== '沉') continue
    values[`L|${organ}|${depth}`] = splitCodes(l)
    values[`R|${organ}|${depth}`] = splitCodes(r)
  }
  return values
}

const reset = process.argv.includes('--reset')

/** 演示数据的基准时刻：固定值 ⇒ 重复执行结果一致（可复现） */
const BASE_AT = Date.parse('2026-10-20T09:30:00+08:00')
const DAY = 86400000

/** 第 pi 位患者的第 i 次就诊时间：越靠后越新 */
function visitAt(pi, i, total) {
  return BASE_AT - (PATIENTS.length - pi) * 3 * DAY - (total - 1 - i) * 14 * DAY
}

try {
  const health = await api('/api/health')
  console.log(`数据库：${health.db}`)

  // 默认只清理「演示·」前缀的患者（可重复执行不会堆积）；--reset 连非演示患者一起清
  const { patients } = await api('/api/patients')
  const stale = reset ? patients : patients.filter((p) => p.name.startsWith('演示·'))
  for (const p of stale) {
    await api(`/api/patients/${encodeURIComponent(p.id)}`, { method: 'DELETE' })
  }
  if (stale.length) {
    console.log(`已清理 ${stale.length} 位${reset ? '' : '演示·'}患者`)
  }

  let pi = 0
  let mismatched = 0
  for (const p of PATIENTS) {
    const { patient } = await api('/api/patients', {
      method: 'POST',
      body: JSON.stringify({
        name: p.name,
        layout: p.layout,
        visits: p.visits.map((v, i) => ({
          label: v.label,
          at: visitAt(pi, i, p.visits.length),
          values: toValues(v.pattern, p.layout),
        })),
      }),
    })
    // 自检：体例与格值必须对得上（seven → 14 格，nine → 18 格）。
    // 对不上说明「体例是 nine、格值却只有 7 脉点那 14 格」这种脏数据混进来了 ——
    // 表格会多出两行空行，看着像数据丢了。
    const check = checkPatientLayout(patient)
    if (!check.ok) mismatched++
    console.log(
      `写入：${patient.name}（${p.layout === 'nine' ? '9 行' : '7 脉点'}）${patient.visits.length} 次` +
        (check.ok ? '' : `　⚠ ${describeLayoutCheck(check)}`),
    )
    pi += 1
  }

  const after = await api('/api/patients')
  console.log(`\n当前共 ${after.patients.length} 位患者：`)
  for (const p of after.patients) console.log(`  ${p.name}　${p.visitCount} 次　${p.layout}`)
  if (mismatched) {
    console.error(`\n✗ 有 ${mismatched} 位患者的体例与格值对不上（详见上面 ⚠ 那几行）`)
    process.exit(1)
  }
} catch (e) {
  console.error(`写入失败：${e.message}`)
  console.error('请先在另一个终端跑 npm run dev（服务默认在 5178 端口）。')
  process.exit(1)
}
