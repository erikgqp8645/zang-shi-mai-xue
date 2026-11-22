# break-test 迁移清单（2026-11-21）

## 为什么要迁

每个 `*break-test.mjs` 都在重复同一段样板：备份源码 → 写坏 → 跑回归 → 看红绿 →
逐字节还原 → 再跑一遍基线。样板抄多了就会漂移，而漂移是**静默**的。

已证伪的旧说法：「已有的保持原样，它们跑得好好的」。实际情况：

- `lizhong-parent-break-test` 的 `LZM1` 把 JSON 两个键的顺序写反了 ⇒ from 串永远匹配不到，
  这条断言长期没跑；`LZM6`／`LZM8` 的目标代码已改名（`FORMULA_DOSE_BY_ID` → `effectiveDoseById`、
  `view.entries` → `shown`）。
- 同一个脚本把重新编译写死成 `process.env.ComSpec`（Windows 才有）⇒ 在 macOS 上直接抛
  `ERR_INVALID_ARG_TYPE`，**这条 break-test 在 Mac 上从来没真跑过**。

## 现状

| 脚本 | 自带「真的改动了源码」自检 | 已迁 lib-break |
|---|---|---|
| app-nested-button-break-test | —（由 lib-break 提供） | ✅ |
| app-chip-add-break-test | —（lib-break） | ✅ |
| app-pattern-live-break-test | —（lib-break） | ✅ |
| app-library-compact-break-test | ✅ 2 处 | ❌ |
| app-standing-toggle-break-test | ✅ 2 处 | ❌ |
| library-admin-break-test | ✅ 3 处 | ❌ |
| library-runtime-edit-break-test | ✅ 3 处 | ❌ |
| rule-delete-loader-break-test | ✅ 2 处 | ❌ |
| lizhong-parent-break-test | ❌（靠「替换片段对得上」5 条断言，已修复） | ❌ |
| app-library-display-break-test | ❌ | ❌ |
| content-admin-break | ❌ | ❌ |
| content-schema-break | ❌ | ❌ |
| excel-retired-break-test | ❌ | ❌ |
| pattern-groups-break-test | ❌ | ❌ |
| unified-editor-break-test | ❌ | ❌ |

> 注意：「自带自检」的那几条**不是假绿** —— 它们各自写了 `mutated === original` 的判断。
> 真正的缺口是**样板重复 + 锚点漂移没人管**，所以优先迁「没有自检」的六条。

## 迁移配方

```js
import { runBreakMutations } from './lib-break.mjs'
const ok = runBreakMutations({
  title: '…',
  target: join(ROOT, 'src/components/X.tsx'),   // 单文件；多文件见下
  regression: join(ROOT, 'scripts/e2e/app-regression.mjs'),
  cwd: ROOT,
  mutations: [ { id, title, apply, expectRed, expectGreen } ],
})
process.exit(ok ? 0 : 1)
```

- **只搬样板，mutation 原样保留** —— `apply` / `expectRed` / `expectGreen` 一行不改。
- 多文件 mutation（如 `app-standing-toggle`）目前 `runBreakMutations` 只支持单文件；
  迁它之前先给 lib-break 加 `targets: {key: path}` 与 `mutation.file`。
- 迁完必须跑一次：**mutation 要红、基线要绿、退出时源码逐字节一致**。
