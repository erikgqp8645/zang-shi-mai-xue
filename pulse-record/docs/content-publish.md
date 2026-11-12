# 内容层 —— 本地后台 → 发布命令 → 远端

> 讲清楚「内容住在哪、怎么改、怎么发布、发布出去是什么形状」。
> 面向维护者与协作者。
>
> ⚠️ 本文说的是**现行**的内容层（2026-11 起）。
> 旧的 Excel 管线**已于 2026-11-12 退役完成**（M4），历史说明留在 `docs/progress.md`。

## 0. 一张图

```
  编辑面                          发布面                        读面
┌────────────────┐   ┌────────────────┐   ┌──────────────────┐  ┌───────────────┐
│ 本地后台        │   │ 发布命令        │   │ 远端 CloudBase PG │  │ 网站端         │
│ Directus       │──▶│ content:publish │──▶│ content schema    │─▶│ GET /api/content│
│ (容器)          │   │ （五步流水线）   │   │ 17 张数据表       │  │               │
└───────┬────────┘   └───────┬────────┘   └──────────────────┘  └───────────────┘
        │                    │                    ▲
        ▼                    │                    │
┌────────────────┐           │              ┌─────┴──────┐
│ local-data/    │           └─────────────▶│ 仓库快照     │
│ content.sqlite │─────────────────────────▶│ src/content/ │
│ （编辑真源）    │              ④生成        │ *.json      │
└────────────────┘                           └────────────┘
                                                ③读（小程序端编译期用）
```

- **编辑真源**＝本地 `local-data/content.sqlite`。只有它能被改。
- **线上真源**＝远端 PG 的 `content` schema。只有发布命令能写。
- **仓库快照**＝`src/content/*.json`。**是产物，不是编辑面** —— 手改会被下一次发布覆盖。
- **发布是单向的**：本地 → 远端 ＋ 快照。**没有反向同步** ⇒ 不存在「两边都改过、谁覆盖谁」。

## 1. 三个真源各管什么

| 位置 | 角色 | 谁能写 |
|---|---|---|
| `local-data/content.sqlite` | **编辑真源**（17 张表 1472 行） | 只有使用者，经本地后台 |
| 远端 PG `content.*`（17 张） | **线上真源** | 只有发布命令（一次事务） |
| 仓库 `src/content/*.json`（8 个） | **可读快照**（派生） | 只有发布命令 |
| 远端 PG `content_meta.*`（3 张） | **发布账本**（版本／留痕／历史） | 只有发布命令 |

> ⚠️ 「改完还没发布」＝**草稿**；远端 PG 里的是**已发布**。
> 两者本来就不一样，这是发布模型的定义，不是双真源。

## 2. 四个命令

```bash
# 看本地与远端差了多少（只读）
npm run content:status

# 正式发布：自检 → 对拍 → 原子发布 → 生成快照 → 三方对拍
npm run content:publish
npm run content:publish -- --dry-run     # 只跑前两步，报告将要发布什么

# 只重新生成快照（不碰远端）
npm run content:snapshot
npm run content:snapshot -- --check      # 只看哪些文件会变

# 回滚到某个历史版本
npm run content:rollback -- --to 3
```

### 发布命令的五步

| 步骤 | 做什么 | 失败时 |
|---|---|---|
| ① **自检** | schema ↔ 库结构；格位固定 18 行；组号一个编号空间；导出无损 | **中止**，逐条指出是哪一格 |
| ② **对拍** | 本地 vs 远端 → 新增 N / 修改 M / 删除 K | 远端不可达 → **中止**（不猜） |
| ③ **原子发布** | 一次 RPC ＝ 一个事务（整份覆盖） | 事务回滚，远端保持发布前状态，**绝不半套** |
| ④ **生成快照** | 本地库 → 8 个 `src/content/*.json` | 远端已发布但快照未更新 → 明确提示，可单独重跑 |
| ⑤ **三方对拍** | 远端 PG == 本地库 == JSON 快照 | 不一致 → 红，**不允许「改一边让它过」** |

## 3. 凭证怎么来

**只从环境变量读**，绝不写进仓库。本地最省事的是让包装器注入：

```bash
node scripts/cb-credentials.mjs -- node scripts/content-publish.mjs
```

它调 `tcb secrets get`（CloudBase CLI 的临时密钥功能），
把密钥**注入子进程的环境变量**后启动命令 ——
密钥不落盘、不进终端、不进 shell 历史。
（前置：`tcb` 已安装且 `tcb login` 已登录。）

手动设置也行：

```bash
export PULSE_CB_SECRET_ID=...
export PULSE_CB_SECRET_KEY=...
export PULSE_CB_SESSION_TOKEN=...      # 用临时凭证时带上
export PULSE_CB_ENV=pulse-1-d0g880ydl8ddc57f6
```

## 4. 远端结构

```
content（数据，17 张）        content_meta（账本，3 张）
  content_sciences …             content_state       当前是第几版
  content_doses …                content_revisions   历史版本的完整 payload
  content_pulse_cells …          content_audit       谁在什么时候发了什么
```

> ⭐ **账本表刻意住在另一个 schema**。
> 发布函数要 TRUNCATE 数据表（整份覆盖），若账本表跟数据表同 schema，
> 「哪些是数据表」就得靠写死的排除名单区分 ——
> 将来加第 4 张账本表而忘了改名单，它就会被当成数据表清空。
> 分开 schema 之后，发布函数**只碰 `content`**，结构上就碰不到账本。

### 六个函数（都在 `public` schema）

| 函数 | 干什么 |
|---|---|
| `content_check_order(jsonb)` | 核对载荷的表清单与 `content` schema 的实际表**完全一致**（少表/多表都报错） |
| `content_publish(text, jsonb)` | 整份覆盖 ＋ 递增版本 ＋ 写修订历史 ＋ 写留痕。**一个事务** |
| `content_read(text, jsonb)` | 按主键序读回 17 张表（行序稳定 ⇒ 快照不抖动） |
| `content_state_get(text, jsonb)` | 当前版本／发布时间／发布人 |
| `content_revisions_list(text, jsonb)` | 历史版本列表（不带 payload） |
| `content_rollback(text, jsonb)` | 把某版的 payload 再发一次（走同一条原子管道） |

> ⚠️ 签名是 `(p_owner text, p_args jsonb)`，与仓库既有的患者域函数一致
> （计划稿写的 `pulse_content_publish(p_payload, p_actor)` 没采用 ——
>   同一个 `rpc()` 通道、同一套调用姿势，少一套特殊形状）。

## 5. 本地后台（编辑面）

```bash
npm run content:admin        # 起／停／看状态（容器 pulse-directus，端口 8055）
npm run content:admin:init   # 按 schema 的 fk 声明自动配关系／字段／视图预设（幂等）
```

后台界面全中文；17 张表全部接管；11 条外键升级成关系字段。
选型与实测结论见 [`content-admin-选型.md`](./content-admin-选型.md)。

> ⚠️ 内容库**禁用 WAL**（业务库 `server/db.mjs` 仍用 WAL）。
> 宿主机脚本与容器是两个 SQLite 实例，共享 WAL 会互相毁掉对方的 WAL ——
> 容器里的写入会**凭空消失**（API 返回成功，文件纹丝不动）。

## 6. 故障排查（都是实测踩过的）

| 现象 | 原因 | 怎么办 |
|---|---|---|
| `content schema 里没有表` | 缺授权：`information_schema` 只显示当前角色有权限的表 | 跑 `npm run content:pg:setup`（含授权文件） |
| `permission denied for schema content` | 同上，schema 的 `USAGE` 没给 | 同上 |
| `permission denied for sequence content_revisions_id_seq` | `bigserial` 的序列没授权 | 同上（授权文件已含 `GRANT USAGE ON SEQUENCES`） |
| `content schema 里还有没发布的表：…` | 载荷的 `order` 少了几张表 ⇒ 那几张会留着旧数据 | 补齐 `order`（它来自 schema 的拓扑序） |
| `载荷的表集合与 order 不一致` | `tables` 与 `order` 对不上 | 整份覆盖不允许缺表/多表 |
| 本地后台改了没生效 | 改了**草稿**，没发布 | `npm run content:publish` |
| 容器里改了，文件没变 | WAL 双实例陷阱 | 内容库已是 DELETE 模式；若出现，先确认 `PRAGMA journal_mode` |
| `无有效身份信息，请使用 tcb login 登录` | CLI 登录态过期 | `tcb login`（扫码） |

## 7. 相关断言

| 断言 | 在哪 | 抓什么 |
|---|---|---|
| A1～A5、RT、RTL | `npm run test:e2e:content` | schema↔库结构、18 行/图、组号一个空间、导出无损 |
| A5／A6／A7 | `npm run test:e2e:content:pg` | API 包==远端、失败回滚、发布幂等 |

> ⚠️ 远端断言**不在** `npm test` 链里（要凭证）。
> 缺凭证时它明确打印「跳过」并退出 0 ——
> 「跳过」与「通过」必须区分开（`pg-store.mjs` 以前在这里栽过）。
> 显式点名要跑（`PULSE_E2E_REQUIRE=1`）时缺凭证 ⇒ 退出 1。
