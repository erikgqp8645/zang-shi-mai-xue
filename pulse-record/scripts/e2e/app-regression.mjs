/**
 * 端到端测试：页面功能回归（浏览器）
 *
 * 自己构建、自己起服务（临时库 ＋ 单机模式）、自己起无头 Chrome，跑完几个关键场景：
 *   ① 依脉用方条目带剂量、且不出现「黄芪」撞「黄芪鳖甲」的噪音
 *   ② ③开方药清单（三焦疗法）的组成与出处
 *   ③ p42 对照表的三档来源都逐行有内容
 *   ④ 窄屏 500px 无横向溢出
 *   ⑤ 控制台无异常
 *   ⑥ PNG 导出：真点按钮、落盘、验尺寸（与**共享包**算出的版式一致 → 两端同源）
 *
 * 跑法：node scripts/e2e/app-regression.mjs
 *
 * 需要本机装了 Google Chrome（用 CHROME_PATH 指定可执行文件）。
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { buildApp, launchChrome, makeChecker, runNpm, startApi, sleep } from './lib.mjs'

const require = createRequire(import.meta.url)
const ROOT = join(import.meta.dirname, '..', '..')

/**
 * 载入共享包（小程序端用的同一份编译产物）。
 *
 * 共享包是构建产物、不进版本库 —— 没有就先 `npm run build:core` 编一遍。
 */
function loadCore() {
  const coreDir = join(ROOT, 'miniprogram/utils/core')
  if (!readdirSync(coreDir, { recursive: true }).some((f) => String(f).endsWith('sample.js'))) {
    const r = runNpm('build:core')
    if (r.status !== 0) throw new Error(`共享包编译失败：\n${r.stdout ?? ''}\n${r.stderr ?? ''}`)
  }
  return {
    sampleShaoJuan: require(join(coreDir, 'domain/sample.js')).sampleShaoJuan,
    planTable: require(join(coreDir, 'export/table-painter.js')).planTable,
    withDiagram: require(join(coreDir, 'export/table-painter.js')).withDiagram,
    planDiagram: require(join(coreDir, 'export/diagram.js')).planDiagram,
    IMG_W: require(join(coreDir, 'domain/diagram.js')).IMG_W,
    IMG_H: require(join(coreDir, 'domain/diagram.js')).IMG_H,
  }
}

const c = makeChecker()

console.log('【准备】构建前端…')
buildApp({ force: true })

console.log('【准备】起服务（单机模式 ＋ 临时库）…')
const api = await startApi({ single: true })

const chrome = await launchChrome({ url: api.base, width: 1500, height: 1200 })

try {
  // 单机模式也要先过登录页（点「进入」）
  await sleep(1200)
  const onLogin = await chrome.ev(`!!document.querySelector('.pr-login')`)
  if (onLogin) {
    await chrome.ev(
      `[...document.querySelectorAll('.pr-login-submit')].find(b=>b.textContent.includes('进入'))?.click()`,
    )
    await sleep(1200)
  }
  c.check('能进入主界面（单机模式）', !(await chrome.ev(`!!document.querySelector('.pr-login')`)))

  // 载入示例（少娟）
  await chrome.ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('载入示例'))?.click()`)
  await sleep(1800)

  /* ---- ① 依脉用方：带剂量的条目数 ---- */
  console.log('\n【①】依脉用方：条目带剂量')
  await chrome.ev(
    `(()=>{const b=[...document.querySelectorAll('.pr-tab')].find(b=>b.textContent.includes('依脉用方'));b&&b.click();return 1})()`,
  )
  await sleep(900)
  const doseStat = await chrome.ev(
    `(()=>{const all=[...document.querySelectorAll('.pr-formula')];const withDose=all.filter(c=>(c.querySelector('.pr-formula-doses')?.innerText||'').trim());return {total:all.length,withDose:withDose.length}})()`,
  )
  console.log(`  ${doseStat.total} 条中 ${doseStat.withDose} 条带组成`)
  c.check('依脉用方条目带上了组成', doseStat.withDose > 0, `实际 ${doseStat.withDose}`)

  const noise = await chrome.ev(
    `[...document.querySelectorAll('.pr-formula-doses')].filter(d=>d.innerText.includes('黄芪鳖甲')&&d.innerText.includes('同名不同号')).length`,
  )
  c.check('「黄芪」没有撞成「黄芪鳖甲」', noise === 0, `实际 ${noise}`)

  /* ---- ② ③开方药清单（三焦疗法）---- */
  console.log('\n【②】③开方药清单（三焦疗法）')
  await chrome.ev(
    `(()=>{const b=[...document.querySelectorAll('.pr-triad-pick-opt')].find(b=>b.textContent.includes('三焦疗法'));b&&b.click();return 1})()`,
  )
  await sleep(900)
  const rx = await chrome.ev(
    `[...document.querySelectorAll('.pr-triad-rx')].map(d=>d.innerText.replace(/\\n+/g,' ⏎ ').slice(0,150)).join('\\n')`,
  )
  console.log(rx)
  c.check('③开方药清单有内容', String(rx).includes('上焦方'))

  /* ---- ③ p42 对照表：三档来源 ---- */
  console.log('\n【③】p42 对照表：三档来源逐行有内容')
  for (const src of ['同和堂版（克）', '讲稿 2010（比例制）', '两套并列']) {
    await chrome.ev(
      `(()=>{const b=[...document.querySelectorAll('.pr-med-dosebar .pr-chip-btn')].find(b=>b.textContent.trim()==='${src}');b&&b.click();return 1})()`,
    )
    await sleep(500)
    const r = await chrome.ev(
      `(()=>{const rows=[...document.querySelectorAll('.pr-med-reftable tbody tr')];const blank=rows.filter(r=>!(r.children[3]?.innerText||'').trim()).length;const miss=rows.filter(r=>(r.children[3]?.innerText||'').includes('未载')).length;return {rows:rows.length,blank:blank,miss:miss}})()`,
    )
    console.log(`  ${src.padEnd(18)} ${r.rows} 行｜空格 ${r.blank}｜明说未载 ${r.miss}`)
    c.check(`${src}：28 行且无空格`, r.rows === 28 && r.blank === 0, `实际 ${r.rows} 行 / 空格 ${r.blank}`)
  }

  /* ---- ④ 窄屏 500px ---- */
  console.log('\n【④】窄屏 500px 无横向溢出')
  await chrome.setViewport(500, 900)
  const widths = await chrome.ev(`({scroll:document.documentElement.scrollWidth,inner:window.innerWidth})`)
  console.log(`  文档宽 / 视口宽：${widths.scroll}/${widths.inner}`)
  c.check('窄屏无横向溢出', widths.scroll <= widths.inner, `实际 ${widths.scroll}/${widths.inner}`)
  c.check('视口确实是 500px', widths.inner === 500, `实际 ${widths.inner}`)

  /* ---- ⑥ PNG 导出：真点一次按钮，验文件 ---- */
  console.log('\n【⑥】PNG 导出（点按钮 → 落盘 → 验尺寸）')
  const dlDir = mkdtempSync(join(tmpdir(), 'pulse-dl-'))
  await chrome.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: dlDir,
    eventsEnabled: true,
  })
  await chrome.ev(
    `[...document.querySelectorAll('.pr-header-actions button')].find(b=>b.textContent.includes('导出 PNG'))?.click()`,
  )
  let pngFile = null
  for (let i = 0; i < 40; i++) {
    await sleep(300)
    const files = readdirSync(dlDir).filter((f) => f.endsWith('.png'))
    if (files.length > 0) {
      pngFile = join(dlDir, files[0])
      break
    }
  }
  c.check('点「导出 PNG」真的落了一个 .png 文件', !!pngFile, `目录：${dlDir}`)
  if (pngFile) {
    const buf = readFileSync(pngFile)
    c.check('是合法 PNG（签名 + IHDR）', buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a')
    const w = buf.readUInt32BE(16)
    const h = buf.readUInt32BE(20)

    // 期望尺寸由**共享包**（小程序端用的同一份代码）算出 —— 两端版式必须一致
    const core = loadCore()
    const sample = core.sampleShaoJuan()
    const lay = core.planTable(sample, [])
    const dia = core.planDiagram({ width: core.IMG_W, height: core.IMG_H }, lay.tableW)
    const full = core.withDiagram(lay, { w: dia.w, h: dia.h })
    const expW = Math.round(full.canvasW * 2)
    const expH = Math.round(full.height * 2)

    console.log(`  PNG ${w}×${h}｜共享包算出 ${expW}×${expH}｜${(buf.length / 1024).toFixed(0)} KB`)
    c.check('PNG 宽度与共享包算出的版式一致', w === expW, `实际 ${w} / 期望 ${expW}`)
    c.check('PNG 高度与共享包算出的版式一致', Math.abs(h - expH) <= 2, `实际 ${h} / 期望 ${expH}`)
    c.check('拼了寸关尺图示（高度明显大于表格本体）', h > lay.tableH * 2, `实际 ${h}`)
  }
  rmSync(dlDir, { recursive: true, force: true })

  /* ---- ⑦ 体例切换：必须立刻落库 ---- */
  console.log('\n【⑦】体例（7 脉点 / 9 行）切换即落库')
  // 先把示例存成一位患者（存完 editing.patientId 才有值，体例才「有地方可落」）
  await chrome.ev(
    `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('保存为新患者'));b&&b.click();return 1})()`,
  )
  await sleep(1500)
  const saved = await (await fetch(`${api.base}/api/patients`)).json()
  const patient = (saved.patients ?? [])[0]
  c.check('示例已存成患者（拿得到 id）', !!patient && !!patient.id, JSON.stringify(patient))

  const rowsBefore = await chrome.ev(`document.querySelectorAll('.pr-table tbody tr').length`)
  console.log(`  切换前表格行数：${rowsBefore}`)

  // 点「7 脉点（尺只沉）」那个单选
  await chrome.ev(
    `(()=>{const l=[...document.querySelectorAll('.pr-radio label')].find(l=>l.textContent.includes('7 脉点'));l&&l.click();return 1})()`,
  )
  await sleep(1500)

  const rowsAfter = await chrome.ev(`document.querySelectorAll('.pr-table tbody tr').length`)
  console.log(`  切换后表格行数：${rowsAfter}`)
  c.check('切换后表格立刻变成 7 行（少掉尺浮/尺中）', rowsAfter === 7 && rowsBefore === 9, `${rowsBefore} → ${rowsAfter}`)

  if (patient && patient.id) {
    const back = await (await fetch(`${api.base}/api/patients/${patient.id}`)).json()
    const layout = back.patient && back.patient.layout
    c.check('体例已经落库（重新读还是 seven）', layout === 'seven', `库里是 ${layout}`)
  }

  /* ---- ⑧ ③ 的方名 → 点进「用方知识库」（对齐小程序端 §3.16） ---- */
  console.log('\n【⑧】③ 的方名点得进「用方知识库」')
  // 视口在 ④ 收窄成 500px 了 —— 定位要滚，先把视口放回常规宽度
  await chrome.setViewport(1500, 1200)
  await sleep(400)

  const rxLinks = await chrome.ev(
    `[...document.querySelectorAll('.pr-triad-rx .pr-link')].map(b=>b.textContent.trim())`,
  )
  console.log(`  可点的方名：${JSON.stringify(rxLinks)}`)
  c.check(
    '③ 的方名变成可点的（上焦方／中焦方／清挡路方／下焦方都能对上知识库）',
    Array.isArray(rxLinks) && rxLinks.length === 4 && rxLinks.includes('上焦方') && rxLinks.includes('中焦方'),
    JSON.stringify(rxLinks),
  )

  const uncovered = await chrome.ev(
    `[...document.querySelectorAll('.pr-triad-rx')].filter(li=>{const n=li.querySelector('.pr-triad-rx-name');return !n?.querySelector('.pr-link') && !n?.querySelector('.pr-triad-rx-unknown')}).length`,
  )
  c.check(
    '③ 的每个方名要么可点、要么明说「用方页未载」（不硬凑）',
    uncovered === 0,
    `有 ${uncovered} 条既不可点也没说明`,
  )

  // 点「上焦方」→ 它对照的是讲义 p44 的**规则条目**（rule 锚点）
  await chrome.ev(
    `(()=>{const b=[...document.querySelectorAll('.pr-triad-rx .pr-link')].find(b=>b.textContent.trim()==='上焦方');b&&b.click();return 1})()`,
  )
  await sleep(800)
  const ruleHit = await chrome.ev(
    `(()=>{const el=document.getElementById('rule-fx-dl3-bianmai-wuli');return {open:!!document.querySelector('#pr-flib.is-open'),found:!!el,focus:!!(el&&el.classList.contains('is-focus')),dup:document.querySelectorAll('[id="rule-fx-dl3-bianmai-wuli"]').length}})()`,
  )
  console.log(`  ${JSON.stringify(ruleHit)}`)
  c.check('点方名后「用方知识库」自动展开', ruleHit.open === true)
  c.check('定位到了讲义 p44 的规则条目（rule 锚点）', ruleHit.found === true)
  c.check('定位到的那一条高亮了', ruleHit.focus === true)
  c.check('锚点 id 全页唯一（不与别处抢同一个 id）', ruleHit.dup === 1, `实际 ${ruleHit.dup} 个`)

  // 点「中焦方」→ 它对照的是讲稿第二讲的**方剂条目**（drug 锚点）
  await chrome.ev(
    `(()=>{const b=[...document.querySelectorAll('.pr-triad-rx .pr-link')].find(b=>b.textContent.trim()==='中焦方');b&&b.click();return 1})()`,
  )
  await sleep(800)
  const drugHit = await chrome.ev(
    `(()=>{const el=document.getElementById('drug-zhongjiao');return {found:!!el,focus:!!(el&&el.classList.contains('is-focus')),dup:document.querySelectorAll('[id="drug-zhongjiao"]').length,text:(el?el.innerText.replace(/\\n+/g,' ⏎ ').slice(0,60):'')}})()`,
  )
  console.log(`  ${JSON.stringify(drugHit)}`)
  c.check('定位到了讲稿方剂条目（drug 锚点）', drugHit.found === true)
  c.check('讲稿方剂那一条也高亮了', drugHit.focus === true)
  c.check('方剂锚点 id 也唯一', drugHit.dup === 1, `实际 ${drugHit.dup} 个`)

  // 换个分组维度（按五行）后，锚点仍得在 —— 全量视图不因换维度丢条目
  await chrome.ev(
    `(()=>{const b=[...document.querySelectorAll('#pr-flib .pr-dim-btn')].find(b=>b.textContent.trim()==='按五行');b&&b.click();return 1})()`,
  )
  await sleep(600)
  const afterDim = await chrome.ev(
    `(()=>({rule:!!document.getElementById('rule-fx-dl3-bianmai-wuli'),drug:!!document.getElementById('drug-zhongjiao')}))()`,
  )
  c.check(
    '换成「按五行」维度后，锚点仍在（换维度不丢条目）',
    afterDim.rule === true && afterDim.drug === true,
    JSON.stringify(afterDim),
  )

  /* ---- ⑨ ② 定疗法里的方名链接：不得嵌套 button，也不得连带选疗法 ---- */
  console.log('\n【⑨】② 定疗法里的方名链接：不得嵌套 button，也不得连带选疗法')
  // 嵌套 button 有两个后果：
  //   ① HTML 无效 —— button 的内容模型不含 interactive content，浏览器会警告；
  //   ② **点击会冒泡到外层「选疗法」按钮** —— 想查一条方的组成，却顺手把疗法定了。
  // React 自己建 DOM、不会像 HTML 解析器那样自动拆开嵌套 button，
  // 所以 `button button` 这个选择器抓得到源码里的嵌套。
  const nested = await chrome.ev(
    `(()=>{const bad=[...document.querySelectorAll('button button')];return {n:bad.length,sample:bad.slice(0,3).map(b=>b.textContent.trim().replace(/\\n+/g,' ').slice(0,40))}})()`,
  )
  console.log(`  button 套 button：${nested.n} 处 ${JSON.stringify(nested.sample)}`)
  c.check('页面上没有 button 套 button', nested.n === 0, JSON.stringify(nested.sample))

  const linkTags = await chrome.ev(
    `[...document.querySelectorAll('.pr-triad-pick-path .pr-link')].map(e=>e.tagName)`,
  )
  console.log(`  ② 里方名链接的标签：${JSON.stringify(linkTags)}`)
  c.check(
    '② 里的方名链接不是 <button>（外层整张卡已经是 button）',
    Array.isArray(linkTags) && linkTags.length > 0 && linkTags.every((t) => t !== 'BUTTON'),
    JSON.stringify(linkTags),
  )

  // 行为：先把已选的疗法清掉，再点方名链接 —— 点完**不该**有疗法被选中
  await chrome.ev(`(()=>{const b=document.querySelector('.pr-triad-pick-clear');b&&b.click();return 1})()`)
  await sleep(500)
  const selBefore = await chrome.ev(`document.querySelectorAll('.pr-triad-pick-opt.is-on').length`)
  await chrome.ev(
    `(()=>{const e=[...document.querySelectorAll('.pr-triad-pick-path .pr-link')].find(e=>e.textContent.trim()==='上焦方');e&&e.click();return 1})()`,
  )
  await sleep(800)
  const selAfter = await chrome.ev(`document.querySelectorAll('.pr-triad-pick-opt.is-on').length`)
  console.log(`  点「上焦方」前后被选中的疗法卡：${selBefore} → ${selAfter}`)
  c.check(
    '点方名链接不会连带把疗法选了',
    selBefore === 0 && selAfter === 0,
    `点完有 ${selAfter} 张疗法卡被选中`,
  )

  // 改完还得能用：点链接仍然要定位到知识库那一条
  const pickHit = await chrome.ev(
    `(()=>{const el=document.getElementById('rule-fx-dl3-bianmai-wuli');return {open:!!document.querySelector('#pr-flib.is-open'),found:!!el,focus:!!(el&&el.classList.contains('is-focus'))}})()`,
  )
  console.log(`  ${JSON.stringify(pickHit)}`)
  c.check(
    '点「上焦方」链接仍然定位得到知识库那一条（没把功能改坏）',
    pickHit.open === true && pickHit.found === true && pickHit.focus === true,
    JSON.stringify(pickHit),
  )

  /* ---- ⑤ 控制台 ---- */
  console.log('\n【⑤】控制台异常')
  console.log('  ', chrome.errors.length ? chrome.errors : '（无）')
  c.check('控制台无异常', chrome.errors.length === 0, chrome.errors.join(' | '))
} finally {
  await chrome.close()
  await api.stop()
}

if (!c.summary()) process.exit(1)
