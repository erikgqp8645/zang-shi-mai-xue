/**
 * e2e 测试的公共件：起服务、起无头浏览器、执行页面脚本
 *
 * 不引第三方依赖 —— Chrome 走 CDP（Node 18+ 自带 WebSocket 与 fetch），
 * 服务端直接 spawn `node server/index.mjs`。
 *
 * 依赖说明：需要本机装了 Google Chrome。找不到就用 CHROME_PATH 指到别的可执行文件；
 * 找不到就跳过浏览器用例（并明确说明「未验证」，不假装通过）。
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const ROOT = join(import.meta.dirname, '..', '..')
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * npm 可执行文件的名字。
 *
 * Windows 上 npm 是 `npm.cmd`（批处理包装），直接 spawn('npm') 会 ENOENT。
 */
export const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'

/**
 * 跑一条 npm 脚本。
 *
 * Windows 上还要再绕一层：Node ≥ 18.20 / 20.12 起，
 * 不带 shell 直接 spawn `.cmd` 会报 EINVAL（安全修复）→ 统一走 cmd.exe /c。
 */
export function runNpm(script, args = []) {
  const argv = ['run', script, ...args]
  if (process.platform === 'win32') {
    return spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'npm', ...argv], {
      cwd: ROOT,
      encoding: 'utf8',
    })
  }
  return spawnSync('npm', argv, { cwd: ROOT, encoding: 'utf8' })
}

/** Chrome 可执行文件（各平台默认路径，可用 CHROME_PATH 覆盖） */
export function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    // Windows
    process.env.PROGRAMFILES
      ? join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    process.env['PROGRAMFILES(X86)']
      ? join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)
  return candidates.find((p) => existsSync(p)) ?? null
}

/* ------------------------------ 起服务 ------------------------------ */

/**
 * 起一个后端进程（用临时库，不碰 local-data/history.sqlite）。
 * single=true → 单机模式（页面不用登录，浏览器回归用这个）
 */
export async function startApi({ single = true, db, port } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pulse-api-'))
  const DB = db ?? join(dir, 'test.sqlite')
  const PORT = port ?? 5300 + Math.floor(Math.random() * 400)
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      PULSE_DB: DB,
      PULSE_SINGLE_USER: single ? '1' : '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.logs = ''
  child.stdout.on('data', (d) => (child.logs += d))
  child.stderr.on('data', (d) => (child.logs += d))

  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/health`)
      if (r.ok) {
        return {
          port: PORT,
          base: `http://127.0.0.1:${PORT}`,
          db: DB,
          dir,
          child,
          async stop() {
            child.kill('SIGTERM')
            await sleep(200)
            rmSync(dir, { recursive: true, force: true })
          },
        }
      }
    } catch {
      /* 还没起来 */
    }
    await sleep(120)
  }
  child.kill('SIGTERM')
  throw new Error(`后端没起来：\n${child.logs}`)
}

/* ---------------------------- 构建前端 ---------------------------- */

/** 构建前端（dist/）；已经是最新的就跳过 */
export function buildApp({ force = false } = {}) {
  const dist = join(ROOT, 'dist', 'index.html')
  if (!force && existsSync(dist)) return { skipped: true }
  const r = runNpm('build')
  if (r.status !== 0) {
    throw new Error(
      `前端构建失败：\n${r.stdout ?? ''}\n${r.stderr ?? ''}\n${r.error?.message ?? ''}`,
    )
  }
  return { skipped: false }
}

/* --------------------------- 起无头浏览器 --------------------------- */

/**
 * 起一个无头 Chrome，用 CDP 连上去。
 * 返回 { ev, errors, close }：ev 在页面里执行表达式并取回值。
 */
export async function launchChrome({ url, width = 1500, height = 1200, port = 9370 } = {}) {
  const exe = chromePath()
  if (!exe) throw new Error('找不到 Chrome（用 CHROME_PATH 指定可执行文件）')
  const dir = mkdtempSync(join(tmpdir(), 'pulse-chrome-'))
  const chrome = spawn(
    exe,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${dir}`,
      `--window-size=${width},${height}`,
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      url,
    ],
    { stdio: 'ignore' },
  )

  let list = null
  for (let i = 0; i < 60; i++) {
    await sleep(200)
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`)
      list = await r.json()
      if (list.find((t) => t.type === 'page')) break
    } catch {
      /* 还没起来 */
    }
  }
  const page = list?.find((t) => t.type === 'page')
  if (!page) {
    chrome.kill()
    rmSync(dir, { recursive: true, force: true })
    throw new Error('Chrome 起来了但拿不到页面')
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails?.exception?.description ?? '')
    }
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  }
  await new Promise((r) => (ws.onopen = r))
  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id
      pending.set(i, res)
      ws.send(JSON.stringify({ id: i, method, params }))
    })

  await send('Page.enable')
  await send('Runtime.enable')
  await sleep(800)

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    return r.result?.result?.value
  }

  /**
   * 改视口尺寸（模拟窄屏）。
   * headless Chrome 里 window.resizeTo 不管用 —— 要用 CDP 的设备指标覆盖。
   */
  const setViewport = async (w, h) => {
    await send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await sleep(300)
  }

  return {
    ev,
    errors,
    setViewport,
    /** 直接发 CDP 指令（下载行为、模拟器等） */
    send,
    async close() {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      chrome.kill()
      await sleep(200)
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/* ------------------------------ 断言 ------------------------------ */

export function makeChecker() {
  const failures = []
  let pass = 0
  let fail = 0
  return {
    check(name, ok, detail = '') {
      if (ok) {
        pass++
        console.log(`  ✓ ${name}`)
      } else {
        fail++
        failures.push(`${name}${detail ? ' —— ' + detail : ''}`)
        console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`)
      }
      return ok
    },
    summary() {
      console.log(`\n=== 通过 ${pass} ｜ 失败 ${fail} ===`)
      if (failures.length) {
        console.log('失败项：')
        for (const f of failures) console.log('  · ' + f)
      }
      return fail === 0
    },
    get fail() {
      return fail
    },
  }
}
