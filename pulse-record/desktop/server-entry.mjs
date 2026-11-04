/**
 * 服务子进程入口 —— 桌面版与普通 Node 共用同一份 server/index.mjs
 *
 * 桌面版（Electron utilityProcess）与 e2e 回归（普通 node fork）都走这里：
 *   1. 起 server/index.mjs 的 startServer()（端口 0 → 操作系统分配，天然免端口冲突）
 *   2. 把端口告诉父进程
 *   3. 响应父进程的数据搬运请求（导出快照 ／ 导入老数据）
 *
 * 为什么单独一个文件：server/index.mjs 是「网页版的入口」，
 * 桌面版要的是「被复用的一段能力」，两者不该互相 import。
 */

import { startServer } from '../server/index.mjs'
import { exportDbSnapshot, importDbInto } from './db-transfer.mjs'

const { db, port } = await startServer({ port: 0, host: '127.0.0.1' })

/** 往父进程发消息：Electron utilityProcess 用 parentPort，普通 node fork 用 process.send */
function toParent(msg) {
  if (process.parentPort) process.parentPort.postMessage(msg)
  else if (process.send) process.send(msg)
}

/** 收父进程的消息：两种模式的载荷形状不一样，分开处理 */
function onParent(handler) {
  if (process.parentPort) process.parentPort.on('message', (e) => handler(e.data))
  else if (process.on) process.on('message', (msg) => handler(msg))
}

async function handle(action, payload) {
  if (action === 'export-db') return exportDbSnapshot(db, payload?.target)
  if (action === 'import-db') return importDbInto(db, payload?.source)
  throw new Error(`未知动作：${action}`)
}

onParent(async (req) => {
  if (!req || req.type !== 'req') return
  try {
    const data = await handle(req.action, req.payload)
    toParent({ type: 'result', id: req.id, ok: true, data })
  } catch (err) {
    toParent({ type: 'result', id: req.id, ok: false, error: String(err?.message ?? err) })
  }
})

toParent({ type: 'listening', port })

// 子进程自己崩了要让人知道（父进程监听 exit）
process.on('uncaughtException', (err) => {
  toParent({ type: 'result', id: 'fatal', ok: false, error: String(err?.message ?? err) })
  console.error('[臧氏脉学] 服务子进程异常：', err)
  process.exit(1)
})
