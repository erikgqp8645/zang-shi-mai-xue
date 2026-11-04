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
import { buildApp, launchChrome, makeChecker, startApi, sleep } from './lib.mjs'

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
    const r = spawnSync('npm', ['run', 'build:core'], { cwd: ROOT, encoding: 'utf8' })
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

  /* ---- ⑤ 控制台 ---- */
  console.log('\n【⑤】控制台异常')
  console.log('  ', chrome.errors.length ? chrome.errors : '（无）')
  c.check('控制台无异常', chrome.errors.length === 0, chrome.errors.join(' | '))
} finally {
  await chrome.close()
  await api.stop()
}

if (!c.summary()) process.exit(1)
