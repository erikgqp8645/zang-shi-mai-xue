/**
 * 内容层 schema 模块的**转发壳**
 *
 * ## 为什么有这一层
 *
 * 真源在 **`server/content-schema.mjs`** —— 不在 `scripts/lib/`。
 *
 * 原因有两条，都很硬：
 *
 * 1. **云函数包只拷 `server/`**（见 `scripts/build-cloudfunction.mjs`：
 *    只拷 `server/` 顶层的 `.mjs`／`.sql`）。内容层的读取层要在**云端**跑
 *    （`GET /api/content`），它需要同一份 schema 描述 ——
 *    模块放在 `scripts/lib/` 的话，云函数包里根本没有这个文件，
 *    `server/` 里的代码 import 就会在部署后炸。
 * 2. **两边路径要一致**。`server/content-schema.mjs` 用
 *    `join(HERE, '..', '..')` 定位仓库根 ⇒ 仓库里是 `pulse-record/`，
 *    云函数包里是 `.cloudfn/pulse-api/`，而构建脚本会把
 *    `src/content/schema/` 原样拷到包里的同一个相对位置 ⇒
 *    **同一份代码在两处都能找到 schema**，不需要任何路径分支。
 *
 * ## 本文件不写任何逻辑
 *
 * 只做 re-export —— 逻辑只有一份（`server/content-schema.mjs`）。
 * ⭐ 铁律：能合成一个来源的，绝不留在两处。
 *
 * 保留这个壳是为了**不动既有调用方**：`scripts/` 侧的脚本
 * （content-seed / content-checks / content-db / e2e）仍然
 * `import ... from './lib/content-schema.mjs'`，路径与语义都不变。
 */

export * from '../../server/content-schema.mjs'
