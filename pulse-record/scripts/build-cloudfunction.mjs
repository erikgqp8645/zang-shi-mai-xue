#!/usr/bin/env node
/**
 * 组装 CloudBase 云函数的部署包
 *
 * ## 为什么要有这个脚本
 *
 * 云函数的代码包必须是一个**自包含的目录**：
 *   index.js      —— 入口（CommonJS，CloudBase 函数框架用 require 加载）
 *   server/*.mjs  —— 服务端代码（ESM）
 *   node_modules/ —— @cloudbase/node-sdk（连 CloudBase PG 用）
 *   package.json  —— 依赖声明
 *
 * 但**真源**在 `server/` 里 —— 不能把 server 代码复制两份进仓库（会漂移）。
 * 所以：真源留在 server/，这个脚本负责**组装**一份部署包到 `.cloudfn/pulse-api/`。
 *
 * ## 用法
 *
 *     node scripts/build-cloudfunction.mjs
 *
 * 产物目录 `.cloudfn/` **不入库**（见 .gitignore）。
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const SERVER = join(ROOT, 'server')
const OUT = join(ROOT, '.cloudfn', 'pulse-api')

/** 云函数名（与小程序端 taro/src/utils/config.ts 的 CLOUD_FUNCTION_NAME 对齐） */
const FUNCTION_NAME = 'pulse-api'

/** SDK 版本：与 pulse-record/package.json 的 dependencies 保持一致 */
function sdkVersion() {
  const pkg = JSON.parse(
    execFileSync(process.execPath, ['-p', "JSON.stringify(require('@cloudbase/node-sdk/package.json').version)"], {
      cwd: ROOT,
      encoding: 'utf8',
    }),
  )
  return pkg
}

function main() {
  console.log(`组装云函数部署包 → ${OUT}`)

  // 1) 清空重建
  rmSync(join(ROOT, '.cloudfn'), { recursive: true, force: true })
  mkdirSync(join(OUT, 'server'), { recursive: true })

  // 2) 拷服务端代码（server 目录下的 .mjs / .sql；**不含** cloudfunction/ 自身）
  const files = readdirSync(SERVER, { withFileTypes: true })
    .filter((d) => d.isFile() && (d.name.endsWith('.mjs') || d.name.endsWith('.sql')))
    .map((d) => d.name)
  for (const name of files) {
    cpSync(join(SERVER, name), join(OUT, 'server', name))
  }
  console.log(`  · server/ 拷了 ${files.length} 个文件`)

  // 3) 入口（CommonJS）
  cpSync(join(SERVER, 'cloudfunction', 'index.js'), join(OUT, 'index.js'))
  console.log('  · index.js（入口）')

  // 3.5) **不生成 scf_bootstrap** —— 我们部署的是 **Event 函数**：
  //      · Event 函数的入口是 `exports.main(event, context)`，平台自带 bootstrap，
  //        **不需要** scf_bootstrap（那是 HTTP 函数才要的）
  //      · HTTP 函数才必须带 scf_bootstrap 且要 listen 9000
  //      我们两个端共用一个 Event 函数：小程序走 wx.cloud.callFunction，
  //      网站走网关路由（网关把返回的 {statusCode, headers, body} 转成 HTTP 响应）。

  // 4) package.json —— 注意 **不能**继承 pulse-record 的 "type": "module"
  //    （入口是 CommonJS；server/*.mjs 是显式 ESM，不受影响）
  const version = sdkVersion()
  writeFileSync(
    join(OUT, 'package.json'),
    JSON.stringify(
      {
        name: FUNCTION_NAME,
        version: '0.1.0',
        private: true,
        type: 'commonjs',
        main: 'index.js',
        dependencies: { '@cloudbase/node-sdk': `^${version}` },
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`  · package.json（@cloudbase/node-sdk ^${version}）`)

  // 5) 装依赖（只装这一个包，别把 react/electron 拖进去）
  console.log('  · npm install（仅生产依赖）…')
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: OUT,
    stdio: 'inherit',
  })

  console.log('✅ 部署包就绪：' + OUT)
}

main()
