# break-test 迁移与守卫清单（2026-11-21）

## 结论先说：没有「静默通过」的大面积缺口

评审说「13 条 break-test 里 11 条没走 lib-break ⇒ 锚点漂移会静默通过」。
逐条核过之后，这句话**只对一半**：**每条都有自己的「改动真的发生了」的守卫**，
只是写法不同（所以用 grep 找 `lib-break` 或找某一句固定文案都会统计错）。

四类守卫：

| 守卫类型 | 做法 | 脚本 |
|---|---|---|
| **lib-break** | `runBreakMutations` 内建 `mutated === original` | chip-add、pattern-live、nested-button |
| **文件守卫** | 自己比对 `mutated[key] !== originals[key]` 或 `changed.length` | library-compact、standing-toggle、library-display |
| **锚点守卫** | 替换函数失败返回 `null` → 断言「替换片段对得上」 | excel-retired、pattern-groups、unified-editor、lizhong-parent |
| **注入守卫** | 改的是**运行中的后台配置**或**临时库副本**，不碰源码；先断言「找到可注入的目标」 | content-admin（HTTP PATCH）、content-schema（临时 sqlite） |
| lib-break 内建 | 参考实现 | library-admin、library-runtime-edit、rule-delete-loader 也各自带 `真的改动了源码` |

## 真正查出来的两个缺陷（已修）

1. **`lizhong-parent-break-test` 三处锚点漂移**（2026-11-21 修）：
   - LZM1 的 `from` 把 JSON 两个键顺序写反（实际 `parentDoseId` 在前）⇒ **永远匹配不到**，
     而这条脚本当时**没有**锚点守卫（只靠 `from` 能不能命中），所以它静默通过了很久；
   - LZM6／LZM8 目标代码改名（`FORMULA_DOSE_BY_ID` → `effectiveDoseById`、`view.entries` → `shown`）。
   修完 174 项全绿。
2. **Windows-only 的重新编译**：`spawnSync(process.env.ComSpec, ...)` 在 macOS 上是 `undefined`
   ⇒ 直接抛 `ERR_INVALID_ARG_TYPE`，**这条 break-test 在 Mac 上从来没真跑过**。
   已改成按 `process.platform` 选 npm。

> 教训：**没有「替换片段对得上」守卫的脚本，锚点漂移必然静默**。
> 现在 lizhong 已经补上这条断言；以后新增 break-test 一律走 lib-break（它自带守卫）。

## 迁移状态（DRY，非正确性）

| 脚本 | 已迁 lib-break |
|---|---|
| app-nested-button-break-test | ✅（5727 → 2880 字符，12 项仍全绿） |
| app-chip-add-break-test | ✅ |
| app-pattern-live-break-test | ✅ |
| 其余 12 条 | ⬜ 可按需迁移 |

迁移的目的**只是去样板**（每条省 ~150 行重复的备份/还原/跑回归），不是修 bug。
建议：**下次动到哪条就顺手迁哪条**，不要为迁移而迁移（迁移本身要跑完整回归验证）。

## 迁移配方

```js
import { runBreakMutations } from './lib-break.mjs'
const ok = runBreakMutations({
  title: '…',
  target: join(ROOT, 'src/components/X.tsx'),
  regression: join(ROOT, 'scripts/e2e/app-regression.mjs'),
  cwd: ROOT,
  mutations: [{ id, title, apply, expectRed, expectGreen }],
})
process.exit(ok ? 0 : 1)
```

- 只搬样板，`apply` / `expectRed` / `expectGreen` 一行不改。
- 多文件 mutation（如 standing-toggle）目前 lib-break 只支持单文件；
  迁它之前先给 `runBreakMutations` 加 `targets: {key: path}` 与 `mutation.file`。
- 迁完必须跑一次：mutation 要红、基线要绿、退出时源码逐字节一致。
