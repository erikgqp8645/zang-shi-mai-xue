/**
 * 内容层 · 本地读取（SQLite 模式）
 *
 * ## 读的是什么
 *
 * 读**仓库里已提交的快照** `src/content/*.json` —— 也就是**上一次发布**的结果。
 *
 * ⭐ 不是本地编辑库 `local-data/content.sqlite`：
 *   · 编辑库 ＝ **草稿**（可能改了还没发，里面可能有没通过自检的内容）
 *   · 快照    ＝ **已发布**（发布命令的产物，每次发布后随 Git 一起被评审）
 *
 * 网站端要展示的是「已发布的知识库」，不是「某人正在改的草稿」⇒ 读快照。
 * 发布完快照会变 ⇒ 前端刷新即见新内容（不需要额外缓存失效逻辑）。
 *
 * ## 为什么不走 PG
 *
 * 本地跑服务时通常没有 CloudBase 凭证（**凭证只从环境变量读**），
 * 而且本地也不该为了看一眼知识库去连线上库。
 * 生产环境是 `PULSE_STORE=pg`，走 `content-pg.mjs`。
 */

import { CONTENT_DIR, loadContent } from './content-schema.mjs'

/**
 * 读已发布内容包。
 *
 * @returns {{ content: object, version: null, source: 'snapshot', path: string }}
 */
export function readContent() {
  return {
    content: loadContent(),
    // 本地快照不带版本号（版本号是远端发布时递增的，见 content_meta.content_state）
    version: null,
    source: 'snapshot',
    path: CONTENT_DIR,
  }
}

/**
 * 本地没有「发布状态」概念 —— 快照本身就是已发布的那一份。
 *
 * @returns {{ version: null, publishedAt: null, publishedBy: null, source: 'snapshot' }}
 */
export function readContentState() {
  return { version: null, publishedAt: null, publishedBy: null, source: 'snapshot' }
}
