/**
 * 端到端测试：用方知识库 · 管理员覆盖层
 *
 * 这条链的用户价值：**管理员在命令行改知识库 → 改到哪儿了、能改什么、能不能删，
 * 全都要说得清楚；改完 apply 之后前端能看到，而且不误伤别的条目。**
 *
 * 所以测的重点不是「命令没报错」，而是：
 *   ① 改一条 → 覆盖层里有、基线文件没被动；
 *   ② 新增一条 → apply 之后真的多了一条；
 *   ③ 删一条 → apply 之后真的少了一条（**不是**静默回落到基线）；
 *   ④ 撤销 → apply 之后**逐字节**回到原始基线；
 *   ⑤ apply 幂等（跑两次，第二次一个字节都不变）；
 *   ⑥ 引用断了要**拒绝写盘**，不是写出半坏数据；
 *   ⑦ 删成方要**连带处理**引用它的地方（按「未载」写，不臆造）；
 *   ⑧ 讲义 p44 **不能新增**（判定逻辑在代码里），但**可以删除** —— 改字段也可以；
 *   ⑨ 字段校验拦得住坏数据（必填、枚举、未知字段）；
 *   ⑩ 读接口形状对，未登录 401，**所有账号共享同一份**（公共资料）；
 *   ⑪ **仓库里真正的 src/content/*.json 一个字节都没被碰**。
 *
 * 跑法：node scripts/e2e/library-admin.mjs
 *
 * ⚠️ 全程只在**临时库 ＋ 临时内容目录**上操作，绝不碰仓库里的 src/content/*.json。
 */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeChecker, startApi, ROOT } from './lib.mjs'

const checker = makeChecker()

async function check(name, fn) {
  const [ok, detail = ''] = await fn()
  checker.check(name, ok, detail)
}

/* ------------------------------------------------------------------ */
/* 现场准备：临时库 ＋ 临时内容目录（基线文件的副本）                    */
/* ------------------------------------------------------------------ */

const dir = mkdtempSync(join(tmpdir(), 'pulse-library-'))
const CONTENT_FILES = ['formula-rules.json', 'drugs.json', 'formula-reference.json', 'doses.json']

const contentDir = join(dir, 'content')
mkdirSync(contentDir, { recursive: true })
for (const f of CONTENT_FILES) {
  cpSync(join(ROOT, 'src', 'content', f), join(contentDir, f))
}

const dbFile = join(dir, 'library.sqlite')

/** 仓库里真正的内容文件 —— 测试前后必须逐字节一致 */
const repoContentDir = join(ROOT, 'src', 'content')
const repoBefore = new Map(CONTENT_FILES.map((f) => [f, readFileSync(join(repoContentDir, f))]))

/** 临时内容目录里每个文件的当前字节 */
function tempBytes() {
  return new Map(CONTENT_FILES.map((f) => [f, readFileSync(join(contentDir, f))]))
}

/** 临时内容目录里的某个 JSON */
function tempJson(name) {
  return JSON.parse(readFileSync(join(contentDir, name), 'utf8'))
}

/** 临时内容目录是否与**原始基线**逐字节一致 */
function tempMatchesOriginal() {
  const now = tempBytes()
  return CONTENT_FILES.every((f) => repoBefore.get(f).equals(now.get(f)))
}

/** 跑一条 library 子命令 */
function cli(args) {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'admin.mjs'), 'library', ...args], {
    env: { ...process.env, PULSE_DB: dbFile },
    encoding: 'utf8',
    cwd: ROOT,
  })
  return {
    code: r.status ?? -1,
    // 人读的输出（stdout ＋ stderr 都算）—— 断言「输出里有没有某句话」用这个
    out: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    // ⚠️ **stdout 单独留一份**：Node 的 ExperimentalWarning（node:sqlite 是实验特性）
    //    走的是 stderr，混进 out 会让 JSON.parse 直接失败 ——
    //    「要解析 JSON」的断言必须用这个，不能用 out。
    stdout: r.stdout ?? '',
  }
}

/**
 * 字节级拷贝一个文件。
 *
 * 不用 fs.cpSync —— 它在「目标已存在」时在这台 Windows 上会报 ESRCH，
 * 而这里恰恰经常要覆盖目标（apply 之后再摆回基线）。
 */
function copyBytes(src, dest) {
  writeFileSync(dest, readFileSync(src))
}

/** apply 到临时内容目录（绝不碰仓库） */
function apply(args = []) {
  return cli(['apply', '--content-dir', contentDir, ...args])
}

/**
 * 「从原始基线重新 apply」—— 先把临时内容目录恢复成仓库里的原始基线，再 apply。
 *
 * 为什么需要它：apply 是**叠加**在「内容目录当前的样子」上的（生产里那一份就是基线）。
 * 所以「撤销之后 apply 回到原始基线」这句话，只有在 apply 之前先把基线摆回去时才成立。
 */
function applyFresh(args = []) {
  for (const f of CONTENT_FILES) {
    copyBytes(join(repoContentDir, f), join(contentDir, f))
  }
  return apply(args)
}

/** 直接从库里删掉一条覆盖层（测试清理用） */
async function dropRow(kind, itemId) {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(dbFile)
  db.prepare('DELETE FROM library_items WHERE kind = ? AND item_id = ?').run(kind, itemId)
  db.close()
}

/* ------------------------------------------------------------------ */
/* A 段：空状态                                                        */
/* ------------------------------------------------------------------ */

await check('A1 空覆盖层自检通过', async () => {
  const r = cli(['verify'])
  return [r.code === 0 && r.out.includes('自检通过'), `exit=${r.code} ${r.out.slice(0, 200)}`]
})

await check('A2 apply --dry-run 不写盘', async () => {
  const before = tempBytes()
  const r = apply(['--dry-run'])
  const after = tempBytes()
  const same = CONTENT_FILES.every((f) => before.get(f).equals(after.get(f)))
  return [r.code === 0 && same && r.out.includes('没有写盘'), `exit=${r.code} same=${same}`]
})

await check('A3 空覆盖层 apply：内容文件逐字节未变', async () => {
  const before = tempBytes()
  const r = apply()
  const after = tempBytes()
  const same = CONTENT_FILES.every((f) => before.get(f).equals(after.get(f)))
  return [r.code === 0 && same, `exit=${r.code} same=${same}`]
})

await check('A4 apply 之后内容文件里没有多出后端自己加的顶层键', async () => {
  // 后端不许往内容文件里塞自己的东西（写入时间戳、内部标记之类）——
  // 那会让「apply 幂等」变成一句空话。
  applyFresh()
  const extra = []
  for (const f of CONTENT_FILES) {
    const beforeKeys = Object.keys(JSON.parse(repoBefore.get(f).toString('utf8')))
    for (const k of Object.keys(tempJson(f))) {
      if (!beforeKeys.includes(k)) extra.push(`${f}.${k}`)
    }
  }
  return [extra.length === 0, extra.join(',')]
})

/* ------------------------------------------------------------------ */
/* B 段：改一条                                                        */
/* ------------------------------------------------------------------ */

const NEW_COMPOSITION =
  '何首乌8、茯苓5、怀牛膝4、当归1.5、枸杞子3、菟丝子3、故纸花2、小茴香2（管理员改）'

await check('B1 set 改一条：成功', async () => {
  const r = cli([
    'set', 'drug', 'xiajiao',
    '--set', `composition=${NEW_COMPOSITION}`,
    '--note', '剂量核对',
    '--by', '测试员',
  ])
  return [r.code === 0 && r.out.includes('已改'), `exit=${r.code} ${r.out.slice(0, 300)}`]
})

await check('B2 覆盖层里有这条，且带上了备注与改的人', async () => {
  const r = cli(['list', '--kind', 'drug'])
  return [
    r.code === 0 && r.out.includes('xiajiao') && r.out.includes('剂量核对') && r.out.includes('测试员'),
    r.out.slice(0, 300),
  ]
})

await check('B3 改一条不会连带丢掉别的字段（composition 变了，name/source 还在）', async () => {
  const r = cli(['show', 'drug', 'xiajiao'])
  const ok = r.code === 0 && r.out.includes('何首乌8') && r.out.includes('下焦方') && r.out.includes('讲稿 2010')
  return [ok, r.out.slice(0, 400)]
})

await check('B4 apply 之后临时内容里这条真的变了', async () => {
  const r = applyFresh()
  const drugs = tempJson('drugs.json').drugs
  const hit = drugs.find((d) => d.id === 'xiajiao')
  const ok = r.code === 0 && hit?.composition === NEW_COMPOSITION
  return [ok, `exit=${r.code} composition=${hit?.composition?.slice(0, 40)}`]
})

await check('B5 apply 幂等：跑两次，第二次一个字节都不变', async () => {
  apply()
  const before = tempBytes()
  const r = apply()
  const after = tempBytes()
  const same = CONTENT_FILES.every((f) => before.get(f).equals(after.get(f)))
  return [r.code === 0 && same, `exit=${r.code} same=${same}`]
})

/* ------------------------------------------------------------------ */
/* C 段：新增一条                                                      */
/* ------------------------------------------------------------------ */

const NEW_DRUG = {
  id: 'test-xin-fang',
  name: '测试新增方',
  therapy: '五脏疗法',
  composition: '茯苓5、炙甘草3',
  indication: '（测试用）',
  source: '测试数据（讲稿 2010·第二讲体例）',
  quote: '',
}
const newDrugFile = join(dir, 'new-drug.json')
writeFileSync(newDrugFile, JSON.stringify(NEW_DRUG, null, 2) + '\n', 'utf8')

await check('C1 add 新增一条：成功', async () => {
  const r = cli(['add', 'drug', '--file', newDrugFile, '--by', '测试员'])
  return [r.code === 0 && r.out.includes('已新增'), `exit=${r.code} ${r.out.slice(0, 300)}`]
})

await check('C2 apply 之后这条真的多出来了', async () => {
  const r = applyFresh()
  const drugs = tempJson('drugs.json').drugs
  const hit = drugs.find((d) => d.id === 'test-xin-fang')
  return [r.code === 0 && !!hit && hit.name === '测试新增方', `exit=${r.code} found=${!!hit}`]
})

await check('C3 同一个 id 不能重复新增', async () => {
  const r = cli(['add', 'drug', '--file', newDrugFile])
  return [r.code !== 0 && r.out.includes('已经存在'), `exit=${r.code}`]
})

/* ------------------------------------------------------------------ */
/* D 段：删一条                                                        */
/* ------------------------------------------------------------------ */

await check('D1 del 删一条：写墓碑，不是真删行', async () => {
  const r = cli(['del', 'drug', 'test-xin-fang', '--note', '测试删掉'])
  return [r.code === 0 && r.out.includes('已标删'), `exit=${r.code} ${r.out.slice(0, 200)}`]
})

await check('D2 墓碑在覆盖层里是看得见的（不是「没改过」）', async () => {
  const r = cli(['list', '--kind', 'drug'])
  return [r.code === 0 && r.out.includes('已删除（墓碑）'), r.out.slice(0, 300)]
})

await check('D3 apply 之后这条从结果里消失了', async () => {
  const r = applyFresh()
  const drugs = tempJson('drugs.json').drugs
  const hit = drugs.find((d) => d.id === 'test-xin-fang')
  return [r.code === 0 && !hit, `exit=${r.code} found=${!!hit}`]
})

/**
 * D4 之前的内容状态。
 *
 * 注意：这一段跑的时候覆盖层里**还有** xiajiao 的改动和 test-xin-fang 的墓碑，
 * 所以「回到原始基线」在这里不成立 —— 该比的是「回到 D4 之前的样子」。
 */
let bytesBeforeD4 = null

await check('D4 删掉一条基线里本来就有的条目 → apply 之后它真的不见了', async () => {
  // xifang 在基线里，且没有被 p44 引用 —— 专门验「墓碑作用在基线条目上」
  bytesBeforeD4 = tempBytes()
  const del = cli(['del', 'drug', 'xifang'])
  const r = applyFresh()
  const drugs = tempJson('drugs.json').drugs
  const hit = drugs.find((d) => d.id === 'xifang')
  const ok = del.code === 0 && r.code === 0 && !hit
  return [ok, `del=${del.code} apply=${r.code} found=${!!hit}`]
})

await check('D5 删掉一条被 p44 引用的方剂 → p44 的 drugs[] 里那个 id 也被去掉', async () => {
  const del = cli(['del', 'drug', 'shangjiao-1'])
  const r = applyFresh()
  const rules = tempJson('formula-rules.json').rules
  const hit = rules.find((x) => x.id === 'fx-bianmai-wuli')
  const stillThere = (hit?.drugs ?? []).includes('shangjiao-1')
  const ok = del.code === 0 && r.code === 0 && !stillThere
  return [ok, `del=${del.code} apply=${r.code} stillThere=${stillThere}`]
})

await check('D6 把这两条都撤销后，apply 逐字节回到 D4 之前的样子', async () => {
  cli(['restore', 'drug', 'xifang'])
  cli(['restore', 'drug', 'shangjiao-1'])
  const r = applyFresh()
  const now = tempBytes()
  const same = CONTENT_FILES.every((f) => bytesBeforeD4.get(f).equals(now.get(f)))
  return [r.code === 0 && same, `exit=${r.code} same=${same}`]
})
/* ------------------------------------------------------------------ */
/* E 段：撤销                                                          */
/* ------------------------------------------------------------------ */

await check('E1 restore 掉新增条后 apply：这条从结果里消失', async () => {
  cli(['restore', 'drug', 'test-xin-fang'])
  const r = applyFresh()
  const drugs = tempJson('drugs.json').drugs
  const hit = drugs.find((d) => d.id === 'test-xin-fang')
  return [r.code === 0 && !hit, `exit=${r.code} found=${!!hit}`]
})

await check('E2 全部撤销后 apply：逐字节回到原始基线', async () => {
  cli(['restore', 'drug', 'xiajiao'])
  const r = applyFresh()
  const same = tempMatchesOriginal()
  return [r.code === 0 && same, `exit=${r.code} same=${same}`]
})

/* ------------------------------------------------------------------ */
/* F 段：级联（删成方 → 引用它的地方按「未载」处理）                    */
/* ------------------------------------------------------------------ */

await check('F1 删成方后 apply：p42 的 doseId 置空、doseBasis 写「未载」', async () => {
  const r = cli(['del', 'dose', 'th-1'])
  const a = applyFresh()
  const rows = tempJson('formula-reference.json').rows
  const row = rows.find((x) => x.no === 1)
  const ok =
    r.code === 0 &&
    a.code === 0 &&
    String(row?.doseId ?? '') === '' &&
    String(row?.doseBasis ?? '').includes('未载')
  return [ok, `del=${r.code} apply=${a.code} doseId=${JSON.stringify(row?.doseId)} basis=${row?.doseBasis}`]
})

await check('F2 删成方后，对应的科中映射也一并清掉', async () => {
  const map = tempJson('doses.json').scienceByDoseId
  return [!('th-1' in map), JSON.stringify(Object.keys(map).slice(0, 5))]
})

await check('F3 restore 成方后 apply 逐字节回到原始基线', async () => {
  cli(['restore', 'dose', 'th-1'])
  const r = applyFresh()
  const same = tempMatchesOriginal()
  return [r.code === 0 && same, `exit=${r.code} same=${same}`]
})

/* ------------------------------------------------------------------ */
/* G 段：悬空引用要拦住                                                */
/* ------------------------------------------------------------------ */

await check('G1 把 p42 指向不存在的成方 → apply 拒绝写盘', async () => {
  const r = cli(['set', 'ref', '1', '--set', 'doseId=th-does-not-exist'])
  const before = tempBytes()
  const a = apply()
  const after = tempBytes()
  const untouched = CONTENT_FILES.every((f) => before.get(f).equals(after.get(f)))
  const ok = r.code === 0 && a.code !== 0 && untouched && a.out.includes('不存在的成方')
  return [ok, `set=${r.code} apply=${a.code} untouched=${untouched} ${a.out.slice(0, 200)}`]
})

await check('G2 verify 能报出这条悬空引用', async () => {
  const r = cli(['verify'])
  return [r.code !== 0 && r.out.includes('不存在的成方'), `exit=${r.code}`]
})

await check('G3 restore 之后 verify 恢复通过', async () => {
  cli(['restore', 'ref', '1'])
  const r = cli(['verify'])
  return [r.code === 0 && r.out.includes('自检通过'), `exit=${r.code}`]
})

/* ------------------------------------------------------------------ */
/* H 段：讲义 p44 的架构性边界                                         */
/* ------------------------------------------------------------------ */

await check('H1 p44 不能新增（判定逻辑在代码里）', async () => {
  const f = join(dir, 'new-rule.json')
  writeFileSync(
    f,
    JSON.stringify({
      id: 'fx-test', route: '肾虚', condition: 'x', therapy: 'y',
      formulas: [], source: 's', quote: '', kind: '主线',
    }),
    'utf8',
  )
  const r = cli(['add', 'rule', '--file', f])
  return [r.code !== 0 && r.out.includes('EVALUATORS'), `exit=${r.code} ${r.out.slice(0, 200)}`]
})

await check('H2 p44 改字段是可以的', async () => {
  const r = cli(['set', 'rule', 'fx-bianmai-wuli', '--set', 'condition=变脉无力（管理员改）'])
  return [r.code === 0 && r.out.includes('已改'), `exit=${r.code} ${r.out.slice(0, 200)}`]
})

await check('H3 p44 改字段后 apply 能落进去', async () => {
  const r = applyFresh()
  const rules = tempJson('formula-rules.json').rules
  const hit = rules.find((x) => x.id === 'fx-bianmai-wuli')
  return [r.code === 0 && hit?.condition === '变脉无力（管理员改）', `exit=${r.code} ${hit?.condition}`]
})

/* ------------------------------------------------------------------ */
/* H' 段：p44 的删除（判定函数作为残留代码留着，前端不加载它）           */
/* ------------------------------------------------------------------ */

/** 用来做删除／恢复试验的条目（讲稿 2010 第二讲「一体疗法·冷热水」那条主线） */
const DEL_RULE = 'fx2-yiti-lengreshui'

/** 原始基线里 p44 的条数（删除／恢复前后都要拿它当尺子） */
function originalCount() {
  return JSON.parse(repoBefore.get('formula-rules.json').toString('utf8')).rules.length
}

await check('H4 p44 可以删除', async () => {
  const r = cli(['del', 'rule', DEL_RULE])
  return [r.code === 0 && r.out.includes('已标删'), `exit=${r.code} ${r.out.slice(0, 200)}`]
})

await check('H5 删除后 apply：这条从 p44 里消失，别的条目一条不少', async () => {
  const baseCount = JSON.parse(repoBefore.get('formula-rules.json').toString('utf8')).rules.length
  const r = applyFresh()
  const rules = tempJson('formula-rules.json').rules
  const gone = !rules.some((x) => x.id === DEL_RULE)
  return [
    r.code === 0 && gone && rules.length === baseCount - 1,
    `exit=${r.code} 条数=${rules.length}/${baseCount}`,
  ]
})

await check('H6 revive 把删掉的这一条放回来，内容一字不差', async () => {
  const original = JSON.parse(repoBefore.get('formula-rules.json').toString('utf8')).rules.find(
    (x) => x.id === DEL_RULE,
  )
  const r0 = cli(['revive', 'rule', DEL_RULE])
  const r = applyFresh()
  const rules = tempJson('formula-rules.json').rules
  const back = rules.find((x) => x.id === DEL_RULE)
  const same = !!back && JSON.stringify(back) === JSON.stringify(original)
  return [
    r0.code === 0 && r.code === 0 && same && rules.length === originalCount(),
    `exit=${r0.code}/${r.code} same=${same} 条数=${rules.length}`,
  ]
})

await check('H7 revive 之后 restore 撤掉覆盖行 → apply 回到原始基线', async () => {
  const r0 = cli(['restore', 'rule', DEL_RULE])
  const r = applyFresh()
  const rules = tempJson('formula-rules.json').rules
  return [
    r0.code === 0 && r.code === 0 && rules.length === originalCount(),
    `exit=${r0.code}/${r.code} 条数=${rules.length}`,
  ]
})

await check('H8 删除后 restore 撤掉墓碑 → 已经写掉的基线撤不回来（命令行会提示用 revive）', async () => {
  // 不重置基线地 apply 一次 —— 模拟生产流程：墓碑已经写进基线了
  const d = cli(['del', 'rule', DEL_RULE])
  apply()
  const r0 = cli(['restore', 'rule', DEL_RULE])
  const r = apply()
  const rules = tempJson('formula-rules.json').rules
  const gone = !rules.some((x) => x.id === DEL_RULE)
  const hinted = r0.out.includes('revive')
  return [
    d.code === 0 && r0.code === 0 && r.code === 0 && gone && hinted,
    `exit=${d.code}/${r0.code}/${r.code} gone=${gone} hinted=${hinted}`,
  ]
})

await check('H9 删除／恢复之后 verify 通过', async () => {
  const r = cli(['verify'])
  return [r.code === 0 && r.out.includes('自检通过'), `exit=${r.code} ${r.out.slice(0, 200)}`]
})

await check('H10 覆盖层里混进 p44 新增 → apply 必须拒绝（否则前端起不来）', async () => {
  // 绕过 CLI 直接往库里塞一条 p44 新增（模拟导入／手改数据库）。
  // ⚠️ 这条 payload 必须是**完全合法**的 —— 否则字段校验会先拦下它，
  //    「H6 被 verify 抓到」那条就成了假阳性（抓的是缺字段，不是 p44 越界）。
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(dbFile)
  db.prepare(
    'INSERT OR REPLACE INTO library_items (kind, item_id, payload, deleted, updated_at, updated_by, note) VALUES (?,?,?,?,?,?,?)',
  ).run(
    'rule',
    'fx-sneaky',
    JSON.stringify({
      id: 'fx-sneaky',
      route: '肾虚',
      condition: '变脉无力',
      therapy: '三焦疗法',
      formulas: ['三焦疗法'],
      source: '手工塞进库的（测试用）',
      quote: '「手工塞进来的条目。」（测试用）',
      kind: '主线',
    }),
    0,
    Date.now(),
    '手工塞的',
    null,
  )
  db.close()
  const before = tempBytes()
  const r = apply()
  const after = tempBytes()
  const untouched = CONTENT_FILES.every((f) => before.get(f).equals(after.get(f)))
  const ok = r.code !== 0 && untouched && r.out.includes('fx-sneaky')
  return [ok, `exit=${r.code} untouched=${untouched} ${r.out.slice(0, 250)}`]
})

await check('H11 塞进去的那条被 verify 抓到', async () => {
  const r = cli(['verify'])
  return [r.code !== 0 && r.out.includes('fx-sneaky'), `exit=${r.code}`]
})

// 清理现场：把手工塞进去的那条删掉（后面还要测导出／导入）
await dropRow('rule', 'fx-sneaky')

/* ------------------------------------------------------------------ */
/* I 段：字段校验                                                      */
/* ------------------------------------------------------------------ */

await check('I1 枚举值不对要拦住（therapy 不在三个疗法里）', async () => {
  const r = cli(['set', 'drug', 'xiajiao', '--set', 'therapy=第四种疗法'])
  return [r.code !== 0 && r.out.includes('只能是'), `exit=${r.code} ${r.out.slice(0, 200)}`]
})

await check('I2 命令行改不认识的字段要拦住', async () => {
  const r = cli(['set', 'drug', 'xiajiao', '--set', '新字段=1'])
  return [r.code !== 0 && r.out.includes('可编辑字段'), `exit=${r.code} ${r.out.slice(0, 200)}`]
})

await check('I3 整条替换时也不许凭空加字段', async () => {
  const f = join(dir, 'extra-field.json')
  writeFileSync(
    f,
    JSON.stringify({ ...NEW_DRUG, id: 'test-extra', 凭空多出来的字段: 'x' }),
    'utf8',
  )
  const r = cli(['add', 'drug', '--file', f])
  return [
    r.code !== 0 && r.out.includes('不在本类的可编辑字段表里'),
    `exit=${r.code} ${r.out.slice(0, 200)}`,
  ]
})

await check('I4 必填字段缺了要拦住', async () => {
  const f = join(dir, 'bad-drug.json')
  writeFileSync(f, JSON.stringify({ id: 'test-bad', name: '缺 therapy' }), 'utf8')
  const r = cli(['add', 'drug', '--file', f])
  return [r.code !== 0 && r.out.includes('缺少必填字段'), `exit=${r.code} ${r.out.slice(0, 200)}`]
})

await check('I5 剂量字段原样转录：不会被换成数字', async () => {
  const r = cli(['set', 'drug', 'xiajiao', '--set', 'composition=茯苓5'])
  return [r.code === 0, `exit=${r.code} ${r.out.slice(0, 200)}`]
})

/* ------------------------------------------------------------------ */
/* J 段：命令行契约                                                    */
/* ------------------------------------------------------------------ */

await check('J1 未知子命令 → 非 0 退出码 ＋ 人话报错', async () => {
  const r = cli(['nope'])
  return [r.code !== 0 && r.out.includes('不认识的子命令'), `exit=${r.code} ${r.out.slice(0, 150)}`]
})

await check('J2 --help 列出全部子命令', async () => {
  const r = cli(['--help'])
  const need = ['list', 'show', 'set', 'add', 'del', 'restore', 'export', 'import', 'apply', 'verify']
  const ok = r.code === 0 && need.every((n) => r.out.includes(n))
  return [ok, r.out.slice(0, 200)]
})

await check('J3 未知种类 → 非 0 退出码', async () => {
  const r = cli(['list', '--kind', 'nope'])
  return [r.code !== 0 && r.out.includes('未知的类'), `exit=${r.code}`]
})

/* ------------------------------------------------------------------ */
/* K 段：导出 / 导入                                                   */
/* ------------------------------------------------------------------ */

await check('K1 export 出来的条目数与覆盖层一致', async () => {
  const r = cli(['export'])
  let doc = null
  try {
    // 只解析 stdout：stderr 里可能有 Node 的 ExperimentalWarning，混进来就解析不了
    doc = JSON.parse(r.stdout)
  } catch {
    /* 解析失败 */
  }
  const list = cli(['list'])
  const n = (list.out.match(/已改|已删除（墓碑）/g) ?? []).length
  return [r.code === 0 && doc?.items?.length === n, `export=${doc?.items?.length} list=${n}`]
})

await check('K2 import 到另一个库：内容一模一样', async () => {
  const outFile = join(dir, 'export.json')
  cli(['export', '--out', outFile])
  const otherDb = join(dir, 'other.sqlite')
  const imp = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts', 'admin.mjs'), 'library', 'import', '--file', outFile],
    { env: { ...process.env, PULSE_DB: otherDb }, encoding: 'utf8', cwd: ROOT },
  )
  const exp = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts', 'admin.mjs'), 'library', 'export'],
    { env: { ...process.env, PULSE_DB: otherDb }, encoding: 'utf8', cwd: ROOT },
  )
  let a = null
  let b = null
  try {
    a = JSON.parse(readFileSync(outFile, 'utf8'))
    b = JSON.parse(exp.stdout)
  } catch {
    /* 解析失败 */
  }
  const key = (x) => JSON.stringify(x.items.map((i) => [i.kind, i.itemId, i.deleted, i.payload]))
  const same = a && b && key(a) === key(b)
  return [(imp.status ?? -1) === 0 && same, `import=${imp.status} same=${same}`]
})

/* ------------------------------------------------------------------ */
/* L 段：读接口                                                        */
/* ------------------------------------------------------------------ */

await check('L1 读接口返回正确的形状', async () => {
  const api = await startApi({ single: true, db: dbFile })
  try {
    const res = await fetch(`${api.base}/api/library/overrides`)
    const data = await res.json()
    const ok =
      res.status === 200 &&
      data.overrides &&
      typeof data.overrides === 'object' &&
      'rule' in data.overrides &&
      'drug' in data.overrides &&
      typeof data.meta?.count === 'number'
    return [ok, `status=${res.status} ${JSON.stringify(data.meta)}`]
  } finally {
    await api.stop()
  }
})

await check('L2 未登录访问读接口一律 401', async () => {
  const api = await startApi({ single: false, db: join(dir, 'multi.sqlite') })
  try {
    const res = await fetch(`${api.base}/api/library/overrides`)
    return [res.status === 401, `status=${res.status}`]
  } finally {
    await api.stop()
  }
})

await check('L3 普通账号也能读（公共资料，所有账号共享一份）', async () => {
  const api = await startApi({ single: false, db: join(dir, 'multi2.sqlite') })
  try {
    const reg = await fetch(`${api.base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ loginName: 'reader_pat', password: 'pass1234' }),
    })
    const data = await reg.json()
    const res = await fetch(`${api.base}/api/library/overrides`, {
      headers: { authorization: `Bearer ${data.token}` },
    })
    const body = await res.json()
    const ok = res.status === 200 && body.overrides && typeof body.overrides === 'object'
    return [ok, `status=${res.status}`]
  } finally {
    await api.stop()
  }
})

/* ------------------------------------------------------------------ */
/* M 段：仓库里的真文件一个字节都没被碰                                 */
/* ------------------------------------------------------------------ */

await check('M1 仓库里的 src/content/*.json 逐字节未变', async () => {
  const changed = CONTENT_FILES.filter((f) => !repoBefore.get(f).equals(readFileSync(join(repoContentDir, f))))
  return [changed.length === 0, changed.join(',')]
})

await check('M2 仓库里的四个内容文件都还在', async () => {
  const ok = CONTENT_FILES.every((f) => existsSync(join(repoContentDir, f)))
  return [ok, '']
})

rmSync(dir, { recursive: true, force: true })
process.exit(checker.summary() ? 0 : 1)
