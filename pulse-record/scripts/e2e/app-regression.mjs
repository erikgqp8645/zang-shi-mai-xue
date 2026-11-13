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

  // 紧凑态：落点那一条得**自己就展开** —— 折叠着落进来等于没落
  const ruleOpen = await chrome.ev(
    `(()=>{const el=document.getElementById('rule-fx-dl3-bianmai-wuli');return !!(el&&el.querySelector('.pr-formula-compact.is-open'))})()`,
  )
  c.check('落点那一条自动展开（不用再点一下才看得到脉象图）', ruleOpen === true)

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

  // 讲稿方剂也是紧凑态 —— 落点同样得自己就展开
  const drugOpen = await chrome.ev(
    `(()=>{const el=document.getElementById('drug-zhongjiao');return !!(el&&el.querySelector('.pr-drug-compact.is-open'))})()`,
  )
  c.check('讲稿方剂落点那一条也自动展开', drugOpen === true)

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

  /* ---- ⑧-补 「用方知识库」紧凑态的结构不变量 ---- */
  console.log('\n【⑧-补】「用方知识库」紧凑态：徽章去掉了，条目一条不少')
  const lib = await chrome.ev(
    `(()=>{
      const head=document.querySelector('#pr-flib .pr-flib-count');
      const m=head?head.textContent.match(/(\\d+)\\s*条[\\s\\S]*?(\\d+)\\s*方/):null;
      const inLib=(sel)=>document.querySelectorAll('#pr-flib '+sel).length;
      const all=(sel)=>document.querySelectorAll(sel).length;
      return {
        declaredRules: m?Number(m[1]):-1,
        declaredDrugs: m?Number(m[2]):-1,
        compactRules: inLib('.pr-formula-compact'),
        compactDrugs: inLib('.pr-drug-compact'),
        kindBadgesInLib: inLib('.pr-formula-kind'),
        plainFormulas: all('.pr-formula:not(.pr-formula-compact)'),
        plainFormulasWithBadge: all('.pr-formula:not(.pr-formula-compact) .pr-formula-kind'),
      }
    })()`,
  )
  console.log(`  ${JSON.stringify(lib)}`)
  c.check(
    '紧凑后一条不少（依脉用方 ＋ 讲稿方剂都还在）',
    lib.declaredRules > 0 &&
      lib.declaredDrugs > 0 &&
      lib.compactRules === lib.declaredRules &&
      lib.compactDrugs === lib.declaredDrugs,
    JSON.stringify(lib),
  )
  c.check(
    '知识库里不再出现 kind 徽章（主线／挡路／加味／禁忌）',
    lib.kindBadgesInLib === 0,
    `还有 ${lib.kindBadgesInLib} 个`,
  )
  c.check(
    '② 命中区仍带 kind 徽章（只改知识库，没把命中区一起改掉）',
    lib.plainFormulas === lib.plainFormulasWithBadge,
    `${lib.plainFormulasWithBadge}/${lib.plainFormulas} 条带徽章`,
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

  /* ---- ⑩ 常驻条目（用药禁忌）开关 ---- */
  console.log('\n【⑩】常驻条目（用药禁忌）开关 ＋ ②③ 不再重复渲染讲稿方剂')
  //
  // 这两条（三不用／上盛用白虎汤·下虚用肾气丸）**不依脉象**，默认一直在。
  // 它们会混进「按五行／按左右手」的分组 —— 于是「水·肾 2 条」其实两条全是常驻，
  // 一条命中都没有。读者只能靠开关自己把它们摘掉。
  //
  // ⚠️ 计数口径：chip 上只剩一个数字了 ——「条」＝本组在② 命中区里的条目数。
  //   原来的「· K 方备查」已删（那个「方」是讲稿方剂 30 方的归属数，
  //   而那 30 方原来在② 面板底部又渲染了一遍，与③ 知识库重复）。
  //
  // 筛选 chip 只在「按五行／按左右手」维度下出现 ⇒ 先把② 面板切过去。
  await chrome.ev(
    `(()=>{const b=[...document.querySelectorAll('.pr-dim-btn')].find(b=>!b.closest('#pr-flib')&&b.textContent.trim()==='按五行');b&&b.click();return 1})()`,
  )
  await sleep(700)

  const standingStat = async () =>
    chrome.ev(
      `(()=>{
        const cls=(e)=>[...e.classList].join(' ');
        // ② 面板：常驻条目的出处行写着「常驻条目（不依脉象）」—— 按这个认，别按 kind 认。
        // ⚠️ kind=禁忌 一共 3 条，其中 1 条（寸关浮大…下焦方进不去）是**依脉象**的挡路规则，
        //    它不归这个开关管，也不该被藏掉。
        const inPanel=[...document.querySelectorAll('.pr-formula:not(.pr-formula-compact)')]
          .filter(e=>(e.querySelector('.pr-finding-src')?.textContent||'').includes('常驻条目'));
        // ③ 知识库：kind=禁忌 的紧凑行（紧凑态没有徽章，按 class 认）
        const libJinji=[...document.querySelectorAll('#pr-flib .pr-formula-compact')]
          .filter(e=>cls(e).includes('is-禁忌'));
        const chip=[...document.querySelectorAll('.pr-filter-chip')]
          .find(b=>(b.querySelector('.pr-filter-key')?.textContent||'').includes('水'));
        const note=document.querySelector('.pr-filter-note')?.textContent||'';
        const toggles=[...document.querySelectorAll('.pr-standing-toggle')];
        const panelToggle=toggles.find(b=>!b.closest('#pr-flib'));
        const libToggle=toggles.find(b=>b.closest('#pr-flib'));
        const num=(b)=>(b&&b.querySelector('.pr-filter-num')?.textContent||'').trim();
        const chipText=chip?num(chip):'';
        const m=chipText.match(/(\\d+)\\s*条用方/);
        const head=document.querySelector('#pr-flib .pr-flib-count');
        const hm=head?head.textContent.match(/(\\d+)\\s*条/):null;
        return {
          panel: inPanel.length,
          libJinji: libJinji.length,
          chip: chipText,
          chipRules: m?Number(m[1]):-1,
          libRules: hm?Number(hm[1]):-1,
          note,
          panelToggleOn: panelToggle?panelToggle.classList.contains('is-on'):null,
          panelToggleText: num(panelToggle),
          libToggleOn: libToggle?libToggle.classList.contains('is-on'):null,
          libToggleText: num(libToggle),
          libNote: (document.querySelector('.pr-flib-standing-note')?.textContent||'').trim(),
        };
      })()`,
    )

  const stOn = await standingStat()
  console.log(`  ${JSON.stringify(stOn)}`)
  c.check(
    '默认显示：② 命中区列着 2 条常驻条目',
    stOn.panel === 2,
    `② ${stOn.panel} 条`,
  )
  c.check(
    'chip 写明口径（「条用方」），常驻条数单独标出来',
    stOn.chip.includes('条用方') && stOn.chip.includes('含常驻 2'),
    stOn.chip,
  )
  c.check(
    'chip 上只剩「条用方（含常驻 M）」，没有「· K 方备查」那个数',
    /^\d+ 条用方(（含常驻 \d+）)?$/.test(stOn.chip.trim()),
    stOn.chip,
  )
  c.check(
    'chip 下方有一行口径说明（两个数字各指什么）',
    stOn.note.includes('条') &&
      stOn.note.includes('方') &&
      stOn.note.includes('常驻条目') &&
      stOn.note.length > 20,
    stOn.note,
  )
  c.check(
    '口径说明里没有没渲染的 Markdown（** 直接露在页面上）',
    !stOn.note.includes('**') && stOn.note.includes('不依脉象的常驻条目'),
    stOn.note.includes('**') ? '说明里残留了 ** ' : stOn.note,
  )
  c.check(
    '② ③ 两处都有这个开关，且都处于「显示中」',
    stOn.panelToggleOn === true &&
      stOn.libToggleOn === true &&
      stOn.panelToggleText === '显示中' &&
      stOn.libToggleText === '显示中',
    `② ${stOn.panelToggleText} / ③ ${stOn.libToggleText}`,
  )

  // 关掉开关 —— ② ③ 一起不列常驻条目
  await chrome.ev(
    `(()=>{const b=[...document.querySelectorAll('.pr-standing-toggle')].find(b=>b.closest('#pr-flib'));b&&b.click();return 1})()`,
  )
  await sleep(700)
  const stOff = await standingStat()
  console.log(`  ${JSON.stringify(stOff)}`)
  c.check(
    '关掉后② 命中区不再列常驻条目',
    stOff.panel === 0,
    `还有 ${stOff.panel} 条`,
  )
  c.check(
    '关掉后③ 知识库的常驻条目也没了（同一个开关）',
    stOff.libJinji === stOn.libJinji - 2 && stOff.libRules === stOn.libRules - 2,
    `③ 禁忌 ${stOn.libJinji} → ${stOff.libJinji} 条｜总条数 ${stOn.libRules} → ${stOff.libRules}`,
  )
  c.check(
    '依脉象的禁忌条目不被这个开关藏掉（挡路条件要留着）',
    stOff.libJinji === 1,
    `③ 还剩 ${stOff.libJinji} 条禁忌`,
  )
  c.check(
    '关掉后 chip 的「条」数正好少掉常驻那几条',
    stOff.chip.includes('条用方') &&
      !stOff.chip.includes('含常驻') &&
      stOff.chipRules === stOn.chipRules - 2,
    `${stOn.chip} → ${stOff.chip}`,
  )
  c.check(
    '关掉后开关显示「已隐藏」，③ 头部注明藏了几条',
    stOff.panelToggleText === '已隐藏' &&
      stOff.libToggleText === '已隐藏' &&
      stOff.libNote.includes('已隐藏常驻条目'),
    `开关 ${stOff.panelToggleText} / ③ ${stOff.libNote}`,
  )

  // 再打开 —— 东西得回来
  await chrome.ev(
    `(()=>{const b=[...document.querySelectorAll('.pr-standing-toggle')].find(b=>b.closest('#pr-flib'));b&&b.click();return 1})()`,
  )
  await sleep(700)
  const stBack = await standingStat()
  console.log(`  ${JSON.stringify(stBack)}`)
  c.check(
    '再打开，常驻条目回到② ③（开关没把东西弄丢）',
    stBack.panel === 2 &&
      stBack.libJinji === stOn.libJinji &&
      stBack.libRules === stOn.libRules,
    `② ${stBack.panel} 条 / ③ 禁忌 ${stBack.libJinji} 条｜总条数 ${stBack.libRules}`,
  )

  /* ---- ⑩-补 ②③ 不再重复渲染讲稿方剂 ---- */
  console.log('\n【⑩-补】② 面板不再整份列讲稿方剂（那 30 方与③ 知识库重复）')
  //
  // 2026-11-12 用户问：「判读提示和方药知识库是不是重复显示了？」
  // 实测：**是**，而且重复的是「全量对全量」——
  //   ② 面板底部「方剂备查（讲稿 2010·第二讲 叁、用方）」＝讲稿方剂**全量 30 方**
  //   ③ 用方知识库「讲稿方剂 30 方」＝**同一份数据、同一个全集**
  // （依脉用方那部分**不是**重复：② 只列命中的 35 条，③ 是全量 61 条，是子集⊆全集。）
  //
  // 处置：删掉② 那一节，讲稿方剂一律去③ 查；chip 上的「· K 方备查」也一并删掉。
  // ⚠️ 同和堂版成方**保留** —— ③ 知识库里没有这一份，不重复。
  //
  // ③ 知识库默认是折着的 ⇒ 先把它展开，否则数不到那 30 条。
  await chrome.ev(
    `(()=>{const t=document.querySelector('#pr-flib .pr-flib-toggle');if(t&&!document.getElementById('pr-flib').classList.contains('is-open'))t.click();return 1})()`,
  )
  await sleep(700)
  const dupStat = await chrome.ev(
    `(()=>{
      // ⚠️ 范围要卡在② 判读提示面板里（.pr-findings-row 只此一处用）——
      // 页面上「用药记录」「③开方药清单」里也有 DrugCard，那是「本次用了什么方」，不算重复。
      const panel=document.querySelector('.pr-findings-row');
      const heads=[...panel.querySelectorAll('h3.pr-formula-route')].map(h=>h.textContent.trim());
      // 「讲稿方剂全量」那一节的标题有两种讲法（讲稿原序／按维度）
      const scriptSection=heads.filter(t=>t.includes('讲稿 2010·第二讲 叁、用方')||t.startsWith('方剂备查 ·'));
      // 讲稿方剂卡（DrugCard）的 therapy 是**三个疗法名**之一；
      // 同和堂版成方卡写的是「同和堂版」，同和堂版「科中」行写的是「科中」—— 两者都排除。
      const SCRIPT_THERAPY=['一体疗法','三焦疗法','五脏疗法'];
      const isScript=(e)=>{const t=e.querySelector('.pr-drug-therapy');return t&&SCRIPT_THERAPY.indexOf(t.textContent.trim())>=0};
      const panelScript=[...panel.querySelectorAll('.pr-drug')].filter(isScript);
      const panelTonghe=[...panel.querySelectorAll('.pr-drug')].filter(e=>!isScript(e));
      const libScript=[...document.querySelectorAll('#pr-flib .pr-drug-compact')];
      // ② 里出现的讲稿方剂**去重后**有几个？—— 命中条目内嵌的只是「这次用到的那些」，
      // 不该是全部 30 方（全部 30 方在③ 知识库里）。
      const panelNames=new Set(panelScript.map(e=>{const s=e.querySelector('.pr-drug-head strong');return s?s.textContent.trim():''}));
      return {scriptSection,panelScript:panelScript.length,panelNames:panelNames.size,panelTonghe:panelTonghe.length,libScript:libScript.length};
    })()`,
  )
  console.log(`  ${JSON.stringify(dupStat)}`)
  c.check(
    '② 面板里没有「讲稿方剂全量」那一节了',
    dupStat.scriptSection.length === 0,
    dupStat.scriptSection.join(' ｜ ') || '（没有）',
  )
  c.check(
    '③ 知识库里 30 条讲稿方剂一条不少（没把内容删了，只是换了地方放）',
    dupStat.libScript === 30,
    `③ ${dupStat.libScript} 条`,
  )
  c.check(
    '② 里只出现「这次用到」的讲稿方剂，不是全部 30 方（全部那 30 方在③ 里）',
    dupStat.panelNames > 0 && dupStat.panelNames < 30,
    `② 去重后 ${dupStat.panelNames} 个方名（卡片 ${dupStat.panelScript} 张）`,
  )
  c.check(
    '② 的同和堂版成方保留（③ 知识库里没有这一份，不重复）',
    dupStat.panelTonghe > 0,
    `② 同和堂版 ${dupStat.panelTonghe} 张`,
  )

  /* ---- ⑪ 知识库：共享层的「显示模式」＋「每条是否显示」 ---- */
  console.log('\n【⑪】知识库显示模式 ＋ 每条的「是否显示」（共享层）')
  //
  // 2026-11-12 用户在画布上标了两处（网站端 ③「用方知识库」截图）：
  //   标注1 —— 分组标题行（「叁、用方（第二讲）」）：
  //            「增加一个选项，不显示这些文字，直接显示内容」
  //   标注2 —— 下面每一条条目：「这里每一条都可以单独编辑文字和是否显示」
  //
  // 两处都落在**共享层**（用户拍板：改的是所有人看到的原文，不是本机偏好）：
  //   · 分组标题显不显示 → 内容层 `content_library_settings.hide_group_titles`
  //   · 每条显不显示     → 内容层 `content_formula_rules.visible` / `content_drugs.visible`
  // 编辑面在本地后台（Directus），发布命令把值写进 `src/content/*.json` ⇒ 全站一致。
  //
  // ⚠️ 期望值**从内容 JSON 里算**，不写死数字 ——
  //    写死的话，数据一改这条断言就成了恒绿/恒红的摆设。
  const ruleDoc = JSON.parse(readFileSync(join(ROOT, 'src/content/formula-rules.json'), 'utf8'))
  const drugDoc = JSON.parse(readFileSync(join(ROOT, 'src/content/drugs.json'), 'utf8'))
  const libDoc = JSON.parse(readFileSync(join(ROOT, 'src/content/library-settings.json'), 'utf8'))
  const shown = (x) => x.visible !== false
  const wantRules = ruleDoc.rules.filter(shown)
  const wantDrugs = drugDoc.drugs.filter(shown)
  const wantHideTitles = libDoc.library.hideGroupTitles === true
  /** 讲稿原序下的分组数：依脉用方按 route 分组 ＋ 讲稿方剂按疗法分组 */
  const wantGroups =
    new Set(wantRules.map((r) => r.route)).size + new Set(wantDrugs.map((d) => d.therapy)).size

  // 切回「讲稿原序」维度（前面的段落把 ③ 切到「按五行」了）
  await chrome.ev(
    `(()=>{const b=[...document.querySelectorAll('#pr-flib .pr-dim-btn')].find(b=>b.textContent.trim()==='讲稿原序');b&&b.click();return 1})()`,
  )
  await sleep(600)

  const libStat = async () =>
    chrome.ev(
      `(()=>{
        const lib=document.querySelector('#pr-flib');
        if(!lib) return null;
        const titles=[...lib.querySelectorAll('.pr-drug-group-title')];
        const mode=lib.querySelector('.pr-lib-mode');
        const head=lib.querySelector('.pr-flib-count');
        return {
          rules: lib.querySelectorAll('.pr-formula-compact').length,
          drugs: lib.querySelectorAll('.pr-drug-compact').length,
          titles: titles.length,
          mode: mode?(mode.textContent||'').replace(/\\s+/g,' ').trim():'',
          modeOff: mode?mode.classList.contains('is-off'):null,
          head: head?(head.textContent||'').replace(/\\s+/g,' ').trim():'',
          dim: [...lib.querySelectorAll('.pr-dim-btn')].find(b=>b.classList.contains('is-on'))?.textContent.trim()||'',
        };
      })()`,
    )

  const lib1 = await libStat()
  console.log(`  ${JSON.stringify(lib1)}`)
  c.check('知识库切在「讲稿原序」维度', lib1.dim === '讲稿原序', lib1.dim)
  c.check(
    '知识库里渲染的依脉用方条目数 ＝ 内容层里「该显示」的条数（visible=false 的不列）',
    lib1.rules === wantRules.length,
    `界面 ${lib1.rules} 条 / 应显示 ${wantRules.length} 条`,
  )
  c.check(
    '知识库里渲染的讲稿方剂数 ＝ 内容层里「该显示」的方数',
    lib1.drugs === wantDrugs.length,
    `界面 ${lib1.drugs} 方 / 应显示 ${wantDrugs.length} 方`,
  )
  c.check(
    '知识库头部的计数也跟着走（显示中的条数，不是全量）',
    lib1.head.includes(`${wantRules.length} 条`) && lib1.head.includes(`${wantDrugs.length} 方`),
    lib1.head,
  )

  // 内容层标了 visible=false 的那一条，知识库里确实找不到它
  //
  // ⚠️ 按**锚点 id** 判，不按文字判 ——
  //   「变脉无力」这条内容有两个 id 不同的条目共用同一个标题文字
  //   （`fx-bianmai-wuli` 与 `fx-dl3-bianmai-wuli`）⇒ 按文字判会误报。
  const hiddenIds = [
    ...ruleDoc.rules.filter((r) => r.visible === false).map((r) => `rule-${r.id}`),
    ...drugDoc.drugs.filter((d) => d.visible === false).map((d) => `drug-${d.id}`),
  ]
  const leaked = await chrome.ev(
    `(()=>{const ids=${JSON.stringify(hiddenIds)};const lib=document.querySelector('#pr-flib');if(!lib)return [];return ids.filter(id=>!!document.getElementById(id));})()`,
  )
  c.check(
    '内容层标了 visible=false 的条目，知识库里一条都不出现',
    leaked.length === 0,
    leaked.join('｜') || `（当前标了隐藏的有 ${hiddenIds.length} 条）`,
  )

  c.check(
    '分组标题：共享值是「隐藏」就一个都不渲染，是「显示」就照旧渲染',
    lib1.titles === (wantHideTitles ? 0 : wantGroups),
    `界面 ${lib1.titles} 个 / 期望 ${wantHideTitles ? 0 : wantGroups} 个`,
  )
  c.check(
    '显示模式有回显（共享值：已隐藏／显示中）',
    lib1.mode.includes(wantHideTitles ? '已隐藏' : '显示中') && lib1.modeOff === wantHideTitles,
    lib1.mode,
  )

  // 按五行／按左右手：分组标题是**唯一的分组标识** ⇒ 必须留着
  await chrome.ev(
    `(()=>{const b=[...document.querySelectorAll('#pr-flib .pr-dim-btn')].find(b=>b.textContent.trim()==='按五行');b&&b.click();return 1})()`,
  )
  await sleep(600)
  const libWuxing = await libStat()
  c.check(
    '按五行维度下分组标题仍然保留（那是唯一的分组标识，去了就是一堵墙）',
    libWuxing.dim === '按五行' && libWuxing.titles > 0,
    `维度 ${libWuxing.dim} / ${libWuxing.titles} 个标题`,
  )
  // 切回讲稿原序（后面的段落按这个维度算）
  await chrome.ev(
    `(()=>{const b=[...document.querySelectorAll('#pr-flib .pr-dim-btn')].find(b=>b.textContent.trim()==='讲稿原序');b&&b.click();return 1})()`,
  )
  await sleep(500)

  /* ---- ⑪-补 ③ 知识库：方名 chip 能新增 ---- */
  console.log('\n【⑪-补】③ 知识库：方名 chip 能新增（只追加，不动已有项）')
  const chipEntry = 'rule-fx-dl3-bianmai-wuli'

  /**
   * 读某条目上的「方名 chip」。
   *
   * ⚠️ `count` 是**原始元素个数**（不吃「＋ 添加」那个按钮）——
   *    不能只用文本判断：空白方名渲染出来是个空 chip，文本过滤会把它藏掉，
   *    于是「多出一个空方名」会看着像「什么都没变」（break-test 的 mutation C 抓过这个）。
   */
  const readChips = () =>
    chrome.ev(`(()=>{
      const el=document.getElementById('${chipEntry}');
      if(!el) return null;
      const nodes=[...el.querySelectorAll('.pr-formula-chip:not(.pr-formula-chip-add)')];
      return {
        count: nodes.length,
        texts: nodes
          .map(s=>s.textContent.replace(/[✎✕]/g,'').trim())
          .filter(Boolean),
      };
    })()`)

  // 先确保这一条是「讲稿原序」维度下可见的，并点开
  const before = await readChips()
  const hasAddBtn = await chrome.ev(
    `!!document.querySelector('#${chipEntry} .pr-formula-chip-add')`,
  )
  c.check('管理员在 ③ 里看得到「＋ 添加」按钮', hasAddBtn === true)
  c.check(
    '新增前先有已有的方名（不是空数组）',
    !!before && before.texts.length > 0,
    JSON.stringify(before),
  )

  // 点「＋ 添加」→ 出输入框
  await chrome.ev(`document.querySelector('#${chipEntry} .pr-formula-chip-add')?.click()`)
  await sleep(300)
  const inputShown = await chrome.ev(
    `!!document.querySelector('#${chipEntry} .pr-formula-chip.is-adding input')`,
  )
  c.check('点「＋ 添加」后就地出现输入框（不弹窗）', inputShown === true)

  // 输入并回车 —— React 受控输入要用原生 setter 再派发 input 事件
  await chrome.ev(`(()=>{
    const inp=document.querySelector('#${chipEntry} .pr-formula-chip.is-adding input');
    if(!inp) return 0;
    const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    set.call(inp,'验收新增方');
    inp.dispatchEvent(new Event('input',{bubbles:true}));
    inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    return 1;
  })()`)
  await sleep(900)

  const after = await readChips()
  console.log(`  新增前：${JSON.stringify(before)}\n  新增后：${JSON.stringify(after)}`)
  c.check(
    '回车后新方名真的加进了 chip 列表',
    !!after && after.texts.includes('验收新增方'),
    JSON.stringify(after),
  )
  c.check(
    '新增只追加一项 —— 原有的方名一个不少（不整条覆盖丢项）',
    !!after &&
      !!before &&
      after.count === before.count + 1 &&
      before.texts.every((v) => after.texts.includes(v)),
    `前 ${before?.count} → 后 ${after?.count}`,
  )
  c.check('新增后输入框收起（回到「＋ 添加」状态）', !(await chrome.ev(
    `!!document.querySelector('#${chipEntry} .pr-formula-chip.is-adding input')`,
  )))

  // 空文字不落库：点开 → 直接回车 → 数量不变
  const beforeEmpty = await readChips()
  await chrome.ev(`document.querySelector('#${chipEntry} .pr-formula-chip-add')?.click()`)
  await sleep(250)
  await chrome.ev(`(()=>{
    const inp=document.querySelector('#${chipEntry} .pr-formula-chip.is-adding input');
    if(!inp) return 0;
    const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    set.call(inp,'   ');
    inp.dispatchEvent(new Event('input',{bubbles:true}));
    inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    return 1;
  })()`)
  await sleep(700)
  const afterEmpty = await readChips()
  c.check(
    '空白的输入不落库（chip 数量不变，没多出空方名）',
    !!afterEmpty && !!beforeEmpty && afterEmpty.count === beforeEmpty.count,
    `${beforeEmpty?.count} → ${afterEmpty?.count}`,
  )

  /* ---- ⑪-补2 ③ 知识库：新增整条（画图即条件） ---- */
  console.log('\n【⑪-补2】③ 知识库：能新增一整条（画图即条件）')
  const addEntryBtn = await chrome.ev(
    `(()=>{const b=[...document.querySelectorAll('#pr-flib .pr-flib-add')];return {n:b.length,text:b[0]?.textContent.trim()||''}})()`,
  )
  c.check(
    '管理员在 ③ 里看得到「＋ 新增条目」',
    addEntryBtn.n === 1 && addEntryBtn.text.includes('新增条目'),
    JSON.stringify(addEntryBtn),
  )

  await chrome.ev(`document.querySelector('#pr-flib .pr-flib-add')?.click()`)
  await sleep(600)
  const createDlg = await chrome.ev(`(()=>{
    const h=document.querySelector('.pr-ps-modal-box.is-editor h4');
    if(!h) return null;
    const tabs=[...document.querySelectorAll('.pr-ed-tab')].map(t=>({t:t.textContent.trim(),on:t.getAttribute('aria-selected')==='true'}));
    return {title:h.textContent.trim(),tabs};
  })()`)
  console.log(`  ${JSON.stringify(createDlg)}`)
  c.check('点「＋ 新增条目」弹出新增弹层', createDlg?.title === '新增条目', JSON.stringify(createDlg))
  c.check(
    '新增时默认落在「脉象图」页（那张图就是命中条件）',
    Array.isArray(createDlg?.tabs) && createDlg.tabs.some((t) => t.t.startsWith('脉象图') && t.on),
    JSON.stringify(createDlg?.tabs),
  )

  // 「条目」页签里 id 必须可填（编辑态才只读）
  await chrome.ev(
    `(()=>{const b=[...document.querySelectorAll('.pr-ed-tab')].find(b=>b.textContent.trim()==='条目');b&&b.click();return 1})()`,
  )
  await sleep(400)
  const idField = await chrome.ev(`(()=>{
    const labels=[...document.querySelectorAll('.pr-led-field')];
    for(const l of labels){
      const span=l.querySelector('.pr-led-label');
      if(!span||!span.textContent.includes('条目 id')) continue;
      const inp=l.querySelector('input');
      return inp?{readOnly:inp.readOnly,disabled:inp.disabled,value:inp.value}:null;
    }
    return null;
  })()`)
  c.check(
    '新增时「条目 id」可填写（编辑态才只读）',
    !!idField && idField.readOnly === false && idField.disabled === false,
    JSON.stringify(idField),
  )

  // 「自动生成」：点一下把 id 填进输入框（**只填框，不落库**）
  const genBtn = await chrome.ev(`(()=>{
    const b=document.querySelector('.pr-ps-modal-box.is-editor .pr-led-idgen');
    return b?{text:b.textContent.trim()}:null;
  })()`)
  c.check('「条目 id」旁有「自动生成」按钮', !!genBtn && genBtn.text.includes('自动生成'), JSON.stringify(genBtn))

  await chrome.ev(`document.querySelector('.pr-ps-modal-box.is-editor .pr-led-idgen')?.click()`)
  await sleep(400)
  const generatedId = await chrome.ev(`(()=>{
    const labels=[...document.querySelectorAll('.pr-ps-modal-box.is-editor .pr-led-field')];
    for(const l of labels){
      const span=l.querySelector('.pr-led-label');
      if(!span||!span.textContent.includes('条目 id')) continue;
      return l.querySelector('input')?.value ?? '';
    }
    return '';
  })()`)
  console.log(`  自动生成的 id：${generatedId}`)
  c.check(
    '点「自动生成」后填入了合法 id（u-YYMMDD-xxxx，符合服务端的字符集）',
    /^u-\d{6}-[a-z0-9]{4}$/.test(String(generatedId)),
    String(generatedId),
  )
  c.check(
    '生成之后输入框仍然可改（自动生成只是填一个默认值）',
    (await chrome.ev(`(()=>{
      const labels=[...document.querySelectorAll('.pr-ps-modal-box.is-editor .pr-led-field')];
      for(const l of labels){
        const span=l.querySelector('.pr-led-label');
        if(!span||!span.textContent.includes('条目 id')) continue;
        const i=l.querySelector('input');
        return !!(i && i.readOnly === false && i.disabled === false);
      }
      return false;
    })()`)) === true,
  )

  // 关掉弹层，别影响后面的段落
  await chrome.ev(`document.querySelector('.pr-ps-modal-box.is-editor .pr-ps-close')?.click()`)
  await sleep(400)

  /* ---- ⑪-补3 新增整条：图里打完字**不失焦**直接保存也能成 ---- */
  /*
   ⚠️ 2026-11-13 用户实测踩到：在脉象图格子里填完值、直接点「保存」，
      报「脉象图至少要标一个格子」—— 因为格值原来只在 blur 时才写进图。
      这条断言盯的就是那个回归：**输入后不失焦，保存必须能成**。
  */
  console.log('\n【⑪-补3】新增整条：图里填完不失焦直接保存也能成')
  await chrome.ev(`document.querySelector('#pr-flib .pr-flib-add')?.click()`)
  await sleep(700)

  // 1) 条目页：id（自动生成）+ 必填
  await chrome.ev(`(()=>{const b=[...document.querySelectorAll('.pr-ed-tab')].find(b=>b.textContent.trim()==='条目');b&&b.click();return 1})()`)
  await sleep(400)
  await chrome.ev(`document.querySelector('.pr-ps-modal-box.is-editor .pr-led-idgen')?.click()`)
  await sleep(300)
  const fillField = (label, value) =>
    chrome.ev(`(()=>{
      const box=document.querySelector('.pr-ps-modal-box.is-editor');
      const labels=[...box.querySelectorAll('.pr-led-field')];
      for(const l of labels){
        const s=l.querySelector('.pr-led-label');
        if(!s||!s.textContent.includes(${JSON.stringify(label)})) continue;
        const i=l.querySelector('input,textarea');
        if(!i) return 0;
        const set=Object.getOwnPropertyDescriptor(i.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;
        set.call(i, ${JSON.stringify(value)});
        i.dispatchEvent(new Event('input',{bubbles:true}));
        return 1;
      }
      return 0;
    })()`)
  await fillField('所属讲次／路线', '回归自测')
  await fillField('条件', '回归·不失焦保存')
  await fillField('治法', '回归治法')
  await fillField('出处', '回归自测')
  await fillField('原文', '回归自测：填完格子不失焦直接保存。')
  // 方名（string[]：先加一项再填）
  await chrome.ev(`(()=>{
    const box=document.querySelector('.pr-ps-modal-box.is-editor');
    const f=[...box.querySelectorAll('.pr-led-field')].find(l=>l.querySelector('.pr-led-label')?.textContent.includes('方名'));
    f?.querySelector('.pr-led-add')?.click();
    return 1;
  })()`)
  await sleep(300)
  await fillField('方名', '回归方')

  // 2) 脉象图页：填一格，**不失焦**
  await chrome.ev(`(()=>{const b=[...document.querySelectorAll('.pr-ed-tab')].find(b=>b.textContent.trim().startsWith('脉象图'));b&&b.click();return 1})()`)
  await sleep(500)
  await chrome.ev(`(()=>{
    const box=document.querySelector('.pr-ps-modal-box.is-editor');
    const add=[...box.querySelectorAll('button')].find(b=>b.textContent.includes('新增一张'));
    add?.click();
    return 1;
  })()`)
  await sleep(700)
  await chrome.ev(`(()=>{
    const inp=document.querySelector('.pr-ps-modal-box.is-editor input[aria-label="右关浮"]');
    if(!inp) return 0;
    inp.focus();
    const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    set.call(inp,'++');
    inp.dispatchEvent(new Event('input',{bubbles:true}));
    // ⚠️ 关键：**不 blur**，直接去点保存
    return 1;
  })()`)
  await sleep(300)

  // 3) 直接保存
  await chrome.ev(`(()=>{
    const box=document.querySelector('.pr-ps-modal-box.is-editor');
    const b=[...box.querySelectorAll('.pr-ed-foot button')].find(b=>b.textContent.includes('保存'));
    b?.click();
    return 1;
  })()`)
  await sleep(2500)

  const noBlurSaved = await chrome.ev(`(()=>{
    const modal=document.querySelector('.pr-ps-modal-box.is-editor');
    const err=modal?.querySelector('.pr-ed-error')?.textContent?.trim() || null;
    const hit=[...document.querySelectorAll('#pr-flib .pr-formula-compact')]
      .some(e=>(e.textContent||'').includes('回归·不失焦保存'));
    return {modalOpen:!!modal, error:err, hit};
  })()`)
  console.log(`  ${JSON.stringify(noBlurSaved)}`)
  c.check(
    '图里填完不失焦、直接点保存：保存成功（不再报「至少要标一个格子」）',
    noBlurSaved.modalOpen === false && noBlurSaved.hit === true,
    JSON.stringify(noBlurSaved),
  )
  // 关掉可能残留的弹层
  await chrome.ev(`document.querySelector('.pr-ps-modal-box.is-editor .pr-ps-close')?.click()`)
  await sleep(300)

  /* ---- ⑤ 控制台 ---- */
  console.log('\n【⑤】控制台异常')
  console.log('  ', chrome.errors.length ? chrome.errors : '（无）')
  c.check('控制台无异常', chrome.errors.length === 0, chrome.errors.join(' | '))
} finally {
  await chrome.close()
  await api.stop()
}

if (!c.summary()) process.exit(1)
