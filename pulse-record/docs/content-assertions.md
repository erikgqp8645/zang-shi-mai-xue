# 内容层 · 断言编号对照表

> **这份表是断言编号的唯一来源。**
> 实施计划 §10.2 列了 A1~A19（那是**验收标准**），
> 本表登记每个编号**实际落在哪个脚本、抓什么**，以及计划外怎么续号。

## 编号纪律（别再撞号）

1. **计划 §10.2 的 A1~A19 是内容层与发布链的编号** —— 语义不许偏。
   计划里说 A6 是「发布事务失败 → 远端保持原状」，实现里 A6 就必须是这件事。
2. **计划里没有的断言，从 `A20` 起往后排**，绝不占用计划编号。
3. **别的子系统用别的前缀**：
   覆盖层那条线（命令行 `npm run admin -- library …`）一律 `LA*`（LibraryAdmin）。
   早先它 A 段用裸 `A1`~`A4`，跟内容层的 `A1`~`A4` 撞号 —— 已改成 `LA1`~`LA4`。
4. **`id` 是机器可读的，文案会改、`id` 不会** —— 「故意写坏」脚本靠 `id` 判定
   「是哪条断言抓到了」，不靠 `msg` 匹配。

## 内容层（本地 SQLite · `scripts/lib/content-checks.mjs`）

| id | 抓什么 | 函数 |
|---|---|---|
| **A1** | schema ↔ 库结构一致（表／列／类型／可空／主键／唯一约束） | `checkSchemaVsDb` |
| **A2** | 每张图固定 18 行（9 部位×取法 × 左右）、`seq` 连续 | `checkCells` |
| **A3** | 组号是**一个共用编号空间**（1..N 连续）＋ **同一图里 (部位,取法,左右) 唯一** | `checkCells` |
| **A4** | 填了用字或符号就必须有组号 | `checkCells` |
| **A8** | 内容包／快照 == 本地库（逐字段） | `checkRoundTrip` |
| **A9** | 库 → 内容包 → 库 无损往返（逐字段） | `checkRoundTripLossless` |
| **A20** | 派生代理主键 `id` 与派生规则一致（＝「父键\|序号」） | `checkDerivedIds` |

> **A3 同时并入计划 A19**：计划里 A3 与 A19 讲的是同一件事（都在抓
> 「左右被当成独立编号空间」），合并成一条，不在两处各留一份。
> A19 的实质内容 —— 「一个格位只能属于一个组」—— 是 **A3 里新加的那条**：
> 落库时 `groupOf.set(格位, 组号)` 是**后写覆盖先写**，源 JSON 里同一个格位
> 出现在两个组里会被**静默取最后一个**，组号连续性照样通过 ⇒ 没有这条就抓不到。

## 远端与发布（`scripts/e2e/content-pg.mjs` · 需要 tcb 登录态）

| id | 抓什么 |
|---|---|
| **A5** | API content 包 == 远端 PG |
| **A6** | 发布事务失败 → 远端保持原状（**绝不半套**） |
| **A7** | 发布幂等（连发两次结果一致） |

## 本地后台配置（`scripts/lib/content-admin-checks.mjs`）

| id | 抓什么 |
|---|---|
| **A21** | 每张内容表的列表接口可读（三种请求形态：`?limit=1`／`?fields=*`／显式点名每一列） |
| **A22** | **所有** content 关系的 `meta.one_field` 必须是 null（含计划外的残留关系） |
| **A23** | 关系字段是 M2O 下拉；指向非主键的是普通文本 |
| **A24** | 被引用集合的 `display_template` == schema 声明的显示列 |
| **A25** | schema 声明了 `enum` 的列是下拉，且**选项与 schema 逐个相同**、`allowOther=false` |
| **A26** | schema 里 `notNull` 的列在后台标了必填（`meta.required`） |
| **A27** | 派生代理键在后台是只读（`meta.readonly`） |
| **A28** | 视图预设写在**对的位置**：过滤条件在预设在**顶层 `filter`**，可见列在 **`layout_query.tabular.fields`** |
| **A29** | 每张脉象图都有书签：书签数 == 图数、书签名 == 图名、书签过滤条件 == 那张图的 `pattern_id` |

## 计划 §10.2 的覆盖情况

| 计划 | 状态 | 落在 |
|---|---|---|
| A1 | ✅ | `content-checks.mjs` |
| A2 | ✅ | `content-checks.mjs` |
| A3 | ✅ | `content-checks.mjs`（并入 A19） |
| A4 | ✅ | `content-checks.mjs` |
| A5 | ✅ | `content-pg.mjs`（远端） |
| A6 | ✅ | `content-pg.mjs`（远端） |
| A7 | ✅ | `content-pg.mjs`（远端） |
| A8 | ✅ | `content-checks.mjs` |
| A9 | ✅ | `content-checks.mjs` |
| A10 | ✅ | **方法**，不是断言 —— 两个「故意写坏」脚本 |
| A11 | ✅ | `core-smoke.mjs`（既有） |
| A12 | ⬜ | **还没有** —— `src/api/patterns.ts` 有「不做本地缓存兜底」的纪律，但没有断言盯着 |
| A13 | ✅ | `rule-delete-loader.mjs` ＋ `src/domain/formulas.ts` 的 `loadRules` 双向校验 |
| A14 | ◐ 部分 | `rule-delete-loader.mjs` 查 `patterns` 数组齐备、首项与 `pattern` 一致；「触达集合」的全覆盖还没有 |
| A15 | ⬜ | **还没有** —— 「符号必被该条目接受」 |
| A16 | ◐ 部分 | `library-admin.mjs` F 段（删成方 → 引用按「未载」写）＋ I 段（必填／枚举／未知字段拦得住） |
| A17 | ⬜ | **还没有** —— M5/M6 范围：页面保存路径 == 命令行注入路径 |
| A18 | ⬜ | **还没有** —— 组成拆解预览 → 回写原文串逐字一致 |
| A19 | ✅ | 并入 A3 |

## 「故意写坏」在哪

| 脚本 | 抓什么坏 | 项数 |
|---|---|---|
| `scripts/e2e/content-schema-break.mjs` | 内容层的坏数据（往**临时副本**里注入） | 17 |
| `scripts/e2e/content-admin-break.mjs` | 后台的坏配置（**真的改**本地后台，跑完恢复） | 18 |

**前端／界面那条线**（不在 A 编号里 —— 那些是内容层的断言）：

| 脚本 | 抓什么坏 | 项数 |
|---|---|---|
| `scripts/e2e/app-nested-button-break-test.mjs` | ② 定疗法里的**嵌套 button** 与**点击冒泡** | 12 |
| `scripts/e2e/app-library-compact-break-test.mjs` | 「用方知识库紧凑态」：kind 徽章没去掉／落点不自动展开／**焦点后到**那个坑 | 18 |
| `scripts/e2e/app-standing-toggle-break-test.mjs` | 「常驻条目开关 ＋ 筛选分组计数口径」：②③ 各自忽略开关／chip 退回旧口径／说明里露出没渲染的 `**` | 28 |
| `scripts/e2e/library-admin-break-test.mjs` | 管理员覆盖层的九种坏法 | 9 |
| `scripts/e2e/rule-delete-loader-break-test.mjs` | 装载器静默降级 | 2 |
| `scripts/e2e/excel_roundtrip_break.py` | Excel 往返丢数据 | — |

两条铁律：
- **新增/修改断言必须先「故意写坏」验证能抓到**，才允许合并。
- 「故意写坏」脚本要自带**反向检查**（好数据必须一条都不报）**和恢复检查**
  （改坏 → 恢复 → 必须重新全绿），防假绿与「改坏了回不来」。

## 撞号史（为什么改）

| 撞号 | 曾经的含义 | 现在 |
|---|---|---|
| `A5` | 内容层「派生代理主键」 ＋ 远端「API 包 == 远端 PG」 | 前者 → **A20**；后者仍是 **A5** |
| `A6` | 远端「发布事务失败」 ＋ 后台「列表接口可读」 | 后者 → **A21** |
| `A7` | 远端「发布幂等」 ＋ 后台「`one_field` 为 null」 | 后者 → **A22** |
| `A8` | 计划「JSON 快照 == 本地库」 ＋ 后台「字段界面」 | 后者 → **A23** |
| `A9` | 计划「库→JSON→读回」 ＋ 后台「显示模板」 | 后者 → **A24** |
| `RT`／`RTL` | 内容层的两条往返检查（跟计划对不上号） | → **A8**／**A9** |
| `A1`~`A4` | 内容层 ＋ 覆盖层线（`library-admin.mjs`） | 覆盖层线 → **LA1**~**LA4** |

撞号的代价不是「难看」，是**读代码的人会把两件事当成一件事** ——
比如按计划 A8 去代码里找「快照 == 库」，却先撞上后台的「字段界面」。

## 记下的 Directus 12 坑位

| 坑 | 现象 | 处置 |
|---|---|---|
| `meta.options` 必须是**对象** | 存成数组时界面读不到 `choices`，下拉是空的 | A25 断言 `options.choices` 是数组（在对象里） |
| `meta.one_field` 双向匹配 | 填了 →「被引用方」集合的列表接口整个 500 | 一律 null，A22 全量盯着 |
| `DELETE /relations` 删不掉内省关系的 meta | 删完 GET 还在 | 只能 PATCH 置 null（A22 也查残留） |
| Directus 只认单列主键 | 复合主键的表被整表忽略 | schema 派生代理键 `id`（A20）＋ 后台只读（A27） |
| **预设的过滤条件要写在顶层 `filter`** | 写进 `layout_query.filter` ⇒ 预设建得出来、API 全 200，**界面却照样显示 900 行**（前端请求不带 filter） | 顶层与 `layout_query.filter` **两处都写**（Directus 自己也两处都写），A28 盯着顶层那处 |
| **可见列在 `layout_query.tabular.fields`** | `layout_options.fields` 那个键 Directus **根本不读**（界面自己建的书签里它是 `null`） | 可见列写进 `layout_query.tabular.fields`，A28 盯着 |
| **书签 URL 用的是预设 id，不是名字** | `?bookmark=清挡路` ⇒「书签不存在」；`?bookmark=67` ⇒ 正常 | 切图走 `?bookmark=<预设 id>`；书签名只给人看 |
| **关系下拉只按主键搜** | 过滤器的 `Pattern ID` 是纯文本框，填图名（「清挡路」）搜不到、零结果 | 切图靠书签（图清单里显示 `id` 列做对照） |
| **Directus 12 的 tabular 没有行内编辑** | 点格子直接跳到项目编辑页 | 改格位＝点格子 → 项目页 → 改 → 保存 → 返回 |
