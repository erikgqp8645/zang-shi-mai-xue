#!/usr/bin/env node
/**
 * 把已发布的内容快照 `src/content/*.json` 复制到 `dist/content/`。
 *
 * ## 为什么要复制
 *
 * 前端是**编译期内联**这些 JSON 的（`import '../content/xxx.json'`），
 * 但 `/api/content` 要在**运行期**把同一份内容包发给调用方。
 * 服务器上只有 `dist/` 与 `server/`（没有 `src/`），所以运行期要读 `dist/content/`。
 *
 * ## 为什么读快照而不是 PG
 *
 * 京东云那台 PG 上没有内容层的函数（`content_read` 不存在），而网站自己也
 * 从不调用这个接口 —— 继续读 PG 只会得到一个 500。内容层的单一真相源是
 * `src/content/*.json`（发布命令的产物），运行期也读它最不容易分叉。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src', 'content')
const OUT = join(ROOT, 'dist', 'content')

// 只复制顶层 JSON（schema/ 是结构描述，运行期不需要）
const files = readdirSync(SRC).filter((f) => f.endsWith('.json'))
if (!files.length) {
  console.error('[content] src/content 下没有 JSON，跳过')
  process.exit(0)
}
if (!existsSync(join(ROOT, 'dist'))) {
  console.error('[content] 还没有 dist/ —— 先 npm run build')
  process.exit(0)
}
mkdirSync(OUT, { recursive: true })
let n = 0
for (const f of files) {
  const obj = JSON.parse(readFileSync(join(SRC, f), 'utf8'))
  writeFileSync(join(OUT, f), JSON.stringify(obj), 'utf8')
  n++
}
console.log(`[content] 复制 ${n} 个内容文件 → dist/content/`)
