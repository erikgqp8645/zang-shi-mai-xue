#!/usr/bin/env node
/**
 * 跨平台调用 Python —— `python3` 这个命令名在 Windows 上**不一定能用**
 *
 * ## 为什么要有这一层
 *
 * 2026-11-11 实测（本机 Windows）：`python3` **存在**，
 * 但它指向 `C:\Users\<用户>\AppData\Local\Microsoft\WindowsApps\python3.exe`
 * —— **Microsoft Store 的空壳别名**，没有真解释器。
 * 直接跑它的退出码是 **9009**（命令找不到）。
 *
 * 于是 `npm run test:e2e:excel` 这类脚本在 Windows 上会**第一段就断** ——
 * 而脚本本身完全正常（用真 `python` 跑，27 项全过）。
 *
 * 真解释器在这台机器上叫 **`python`**（3.11.5）；
 * Unix（Linux/macOS）上一般叫 **`python3`**（也可能叫 `python`）。
 *
 * ⇒ 这里**探测**出能用的那个命令再调，不写死平台。
 *
 * ## 用法
 *
 * ```json
 * "content:json": "node scripts/run-python.mjs scripts/excel_to_json.py",
 * "content:check": "node scripts/run-python.mjs scripts/excel_to_json.py --check"
 * ```
 *
 * 后面的参数原样透传给 Python 脚本。
 *
 * ## 探测怎么做的
 *
 * 候选顺序按平台排（Windows 先 `python`，其余先 `python3`），
 * 每个候选都**真跑一次** `-c "import sys"`：
 * 空壳别名会立刻以 9009 退出 ⇒ 换下一个。
 * 探测结果在进程内缓存 ⇒ 一次 npm 脚本只探测一次。
 *
 * ⚠️ **为什么不能只按 platform 硬选** ——
 *    Windows 上装了「Python Launcher（py.exe）」的人通常只有 `py -3`；
 *    而从 Microsoft Store 装的 Python 反而**只有 `python3`、没有 `python`**。
 *    两种装机方式都真实存在 ⇒ 只能探测，不能假设。
 *
 * ## 顺带修掉：中文 Windows 的默认编码是 GBK
 *
 * 同机实测（2026-11-11）：`python scripts/e2e/excel_exercise_roundtrip.py` 报
 *
 *     UnicodeDecodeError: 'gbk' codec can't decode byte 0x8b in position 50
 *
 * 原因：脚本里 `open(路径)` 没写 `encoding=`，Python 就用**系统默认编码** ——
 * 中文 Windows 是 GBK，而那些 JSON / xlsx 里是 UTF-8。
 * ⇒ 错误信息变成一坨 traceback，连带两条断言失败
 *   （「错误信息点名了 E3」「错误信息说明了这是练习／示范工作簿」）。
 *
 * 修法：**开 Python 的 UTF-8 模式**（`PYTHONUTF8=1`，Python 3.7+）。
 * 它把默认编码改成 UTF-8，**不用改那些 Python 脚本**。
 * 加了之后同一个脚本 **13 项全过**（原来 2/13 失败）。
 *
 * ⚠️ 这个变量**只在本次子进程里生效**（下面 spawn 时传 env），
 *    不污染用户的系统环境。
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 候选命令（按平台排优先级） */
const CANDIDATES = process.platform === 'win32' ? ['python', 'python3', 'py'] : ['python3', 'python']

/** 这个候选能不能真跑 Python？ */
function works(cmd) {
  try {
    const r = spawnSync(cmd, ['-c', 'import sys'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000,
    })
    return r.status === 0
  } catch {
    return false
  }
}

/** 探测一次，缓存住 */
let picked = null
function pickPython() {
  if (picked) return picked
  for (const cmd of CANDIDATES) {
    if (works(cmd)) {
      picked = cmd
      return cmd
    }
  }
  return null
}

const args = process.argv.slice(2)
if (!args.length) {
  console.error('用法：node scripts/run-python.mjs <脚本.py> [参数…]')
  process.exit(2)
}

const py = pickPython()
if (!py) {
  console.error(
    '[run-python] 找不到能用的 Python。\n' +
      `  试过：${CANDIDATES.join('、')}\n` +
      '  Windows 上装 Python 时记得勾「Add python.exe to PATH」。',
  )
  process.exit(9009)
}

// `py` 启动器要带 `-3` 才认版本
const finalArgs = py === 'py' ? ['-3', ...args] : args

const r = spawnSync(py, finalArgs, {
  cwd: ROOT,
  stdio: 'inherit',
  windowsHide: true,
  // ⚠️ **开 UTF-8 模式** —— 中文 Windows 的默认编码是 GBK，
  //    脚本里 `open()` 没写 encoding= 就会按 GBK 读 UTF-8 文件 → UnicodeDecodeError。
  //    只对本次子进程生效，不污染用户环境。
  env: { ...process.env, PYTHONUTF8: '1' },
})
process.exit(r.status === null ? 1 : r.status)
