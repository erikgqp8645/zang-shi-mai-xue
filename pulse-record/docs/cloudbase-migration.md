# 迁移到 CloudBase —— 已建成（2026-11-06 实测）

> **状态**：迁完了。网站跑 **CloudBase 静态托管**，API 跑 **CloudBase 云函数**，数据存 **CloudBase PostgreSQL**，
> 小程序端已切到 `wx.cloud.callFunction`（代码完成，**未真机验证**）。
>
> 本文分三部分：① **实际架构长什么样** ② **实际怎么做的（含踩过的坑）** ③ **验收清单与还差的事**。
>
> 环境参数（ap-shanghai 体验版 `baas_trial`，到期 2027-05-06）：
>
> | 项 | 值 |
> |---|---|
> | 环境 id | `pulse-1-d0g880ydl8ddc57f6` |
> | AppId | `1257312696` |
> | 网站（静态托管） | `https://pulse-1-d0g880ydl8ddc57f6-1257312696.tcloudbaseapp.com` |
> | API（网关） | `https://pulse-1-d0g880ydl8ddc57f6-1257312696.ap-shanghai.app.tcloudbase.com/pulse-api` |
> | PG 实例 | `postgres-gi7xmyo4`（PostgreSQL 17.11，`TenantType: SHARED`） |
> | 云函数 | `pulse-api`（**Event 类型**，Nodejs20.19，`index.main`，timeout 20s，memory 256MB） |
> | 小程序 appid | `wx3a21eb903a16cbc4` —— **尚未与本环境关联**（见 §5.2） |

---

## 0. 一句话现状

| 项 | 迁之前 | 迁之后 |
|---|---|---|
| 数据库 | 本机/服务器上的 SQLite 单文件 | CloudBase **PostgreSQL**（`owner_id` 用 **text**） |
| API | 自建 Node 进程（`node:http`，零第三方依赖） | CloudBase **云函数**（**Event 类型**，网关指向它） |
| 网站 | 同一 Node 进程托管 `dist/` | CloudBase **静态托管**（`<envId>-<appId>.tcloudbaseapp.com`） |
| 小程序 | `wx.request` → 合法域名 | `wx.cloud.callFunction` → **不走合法域名校验** |
| 同源 | 是 | **否**（静态托管与云函数不同源）→ 服务端 CORS 头 |

> **迁移的真正价值**：**免 ICP 备案**（默认域名直接可用；小程序走 callFunction 更是不受合法域名约束）。
> 不是「避免 IP 变」。

---

## 1. 代码侧：换后端只改一处

### 1.1 存储收敛成一层 —— `server/store.mjs`

路由层（`server/index.mjs`）**只认 `store.mjs` 暴露的函数契约**，不直接碰数据库。
换后端 = 只改 `PULSE_STORE` 环境变量，**路由层／前端／小程序零改动**。

```
server/index.mjs（路由 · 鉴权 · CORS）
        ↓  只认这一层的函数契约
server/store.mjs（存储实现选择层 · PULSE_STORE=sqlite|pg）
        ├── server/db.mjs    ＋ server/auth.mjs      （SQLite 实现）
        └── server/db-pg.mjs ＋ server/auth-pg.mjs   （PostgreSQL 实现）
```

**鉴权层也走了这层** —— 这是迁移时才发现的：`server/auth.mjs` 原本直接用 SQLite 专有的 `db.prepare()`，
不一起分发的话 PG 后端根本没法复用鉴权。现在 `createUser` / `authenticate` / `createSession` 等
全部从 `store.mjs` 转发。

### 1.2 纯逻辑抽出来，两套实现共用

| 文件 | 内容 | 谁在用 |
|---|---|---|
| `server/values.mjs` | `CONSTITUTIONS` / `THERAPIES` / `parseValues` / `normalizeValues` / `pickEnum` | SQLite ＋ PG **共用一份** |
| `server/auth-core.mjs` | `SINGLE_USER` / `SESSION_TTL_MS` / `RESERVED_LOGIN_NAMES` / `hashPassword` / `verifyPassword` / `isValidLoginName` | SQLite ＋ PG **共用一份** |

> 之前 `db.mjs` 与 `db-pg.mjs` 各有一份 `normalizeValues`，改一处忘另一处就会两边行为不一致。
> 现在**规整逻辑只有一份**（`server/values.mjs`）。

### 1.3 PG 访问路线 —— 为什么是「PG 函数（RPC）」

三条路都试过，只有一条通：

| 路线 | 结论 |
|---|---|
| TCP 直连（`pg` 驱动） | ❌ 本环境 PG 是 `SHARED` 托管实例，**没有暴露连接地址**；个人版/体验版的 VPC 内网互联与公网直连开关都不可用 |
| 裸 `fetch` 调 PG HTTP 网关 | ❌ 网关要 **access token**，不认 Publishable Key 也不认 API Key（`apikey` 头返回 `MISSING_CREDENTIALS`） |
| **`@cloudbase/node-sdk` 的 `app.rdb().rpc()`** | ✅ **官方主推**：免 VPC、免数据库密码、凭证自动 |

**定下的规矩：所有读写都下沉为 PG 函数（RPC）**，签名统一 `(p_owner text, p_args jsonb)`：

- **一次 RPC ＝ 一个事务** → 「整份覆盖患者＋就诊＋用药」的语义是原子的
- **JS 侧不写 SQL** → 不会出现方言漂移
- 19 个数据域函数 ＋ 15 个鉴权域函数 ＝ **35 个**（定义见 `server/pg-functions.sql`）

### 1.4 PG 函数返回值的硬规矩

**postgREST 对标量返回（boolean／integer）与 SQL NULL 一律不给 body**（会变成 `{}`）。
所以本仓库所有 PG 函数的返回值**统一是 jsonb 对象包裹**：

```sql
RETURN jsonb_build_object('found', ..., 'patient', ...);   -- 不是 RETURN v_row;
RETURN jsonb_build_object('ok', true);                     -- 不是 RETURN true;
```

这条坑是迁移中途才撞出来的，一撞就撞了 28 处返回值。

### 1.5 路由抽 `handleApi(req, res)`

`server/index.mjs` 的路由主体抽成导出函数，自建 Node 服务与云函数**共用同一份路由／鉴权逻辑**：

```
server/index.mjs  →  export async function handleApi(req, res)
                      export async function initDb()          // 冷启动复用
```

云函数侧用伪 `req`/`res` 适配（伪 `req` 实现了 `Symbol.asyncIterator`，供 `readJson` 用）。

---

## 2. 实际架构

```
┌────────────────────────┐          ┌────────────────────────┐
│ 网站（React 19 SPA）     │          │ 微信小程序（Taro）        │
│ CloudBase 静态托管        │          │ wx.cloud.callFunction   │
│ …-1257312696            │          │ （不走 request 合法域名） │
│   .tcloudbaseapp.com    │          └───────────┬────────────┘
└───────────┬────────────┘                      │
            │ HTTPS（跨域 → CORS）                │
            └─────────────────┬────────────────────┘
                              ▼
              ┌───────────────────────────────┐
              │ CloudBase 云函数 pulse-api      │
              │  Type=Event · index.main       │
              │  · handleApi（server/index.mjs）│
              │  · store.mjs → db-pg/auth-pg    │
              │  · 微信 code2Session 代理       │
              └───────────────┬───────────────┘
                              ▼
              ┌───────────────────────────────┐
              │ CloudBase PostgreSQL           │
              │  7 张表 + 35 个 pulse_* 函数    │
              │  users/identities/sessions     │
              │  patients/visits/medication     │
              │  custom_symbols                │
              └───────────────────────────────┘
```

### 2.1 为什么云函数用 **Event** 类型

| 类型 | 能不能喂饱两端 |
|---|---|
| **Event** | ✅ 小程序 `wx.cloud.callFunction` **只能**调 Event 函数；网关 HTTP Access **也**能指向 Event 函数（返回 `{statusCode, headers, body}`，由网关转成 HTTP 响应）→ **一个函数同时喂饱小程序与网站端** |
| HTTP | ❌ 小程序调不了；且必须带 `scf_bootstrap` ＋ `listen 9000`，依赖还要打包 |

**函数类型创建后不可改** —— 迁移时先建成了 HTTP 类型，只能删掉重建。

Event 类型**不需要 `scf_bootstrap`**（HTTP 类型才要）。

### 2.2 网关路由：挂在哪个域名上

静态托管域名 `<envId>-<appId>.tcloudbaseapp.com` 是**系统内部域名，不能手动建路由**。
所以 API 挂在 **HTTPSERVICE 默认域名**上：

| 项 | 值 |
|---|---|
| 域名 | `pulse-1-d0g880ydl8ddc57f6-1257312696.ap-shanghai.app.tcloudbase.com` |
| path | `/pulse-api` |
| upstream | `upstreamResourceType=**SCF**`、`targetName=pulse-api` |
| 路径透传 | `enablePathTransmission=**true**` |
| 云函数里的前缀 | 环境变量 `PULSE_API_PREFIX=/pulse-api`（函数侧剥掉前缀） |

> ⚠️ `upstreamResourceType` 必须是 **`SCF`**（Event 函数）。写成 `WEB_SCF`（HTTP 函数）会返回 **400 空 body** —— 这坑踩过。

网站与 API **不同源**，所以服务端要发 CORS 头：

```
PULSE_CORS_ORIGINS=https://pulse-1-d0g880ydl8ddc57f6-1257312696.tcloudbaseapp.com
```

> `PULSE_CORS_ORIGINS` **不接受 `*`**：病例数据敏感，只允许明确列出的来源。

### 2.3 云函数环境变量

```
PULSE_STORE=pg
PULSE_CB_ENV=pulse-1-d0g880ydl8ddc57f6
PULSE_API_PREFIX=/pulse-api
PULSE_CORS_ORIGINS=https://pulse-1-d0g880ydl8ddc57f6-1257312696.tcloudbaseapp.com
PULSE_WX_APPID=wx3a21eb903a16cbc4
PULSE_WX_APPSECRET=……            # 只在 .secrets/server.env，不进仓库
```

`PULSE_CB_ENV` 是给 `server/pg-client.mjs` 用的；**云函数里其实不用配**（平台会注入 `TCB_ENV` / `SCF_NAMESPACE`），
配上只是让本地与线上取值一致。

> ⚠️ **微信那两味要用 `PULSE_WX_*`，不能用 `WX_*`** —— `WX_` 前缀会被 CloudBase 运行时用平台的值盖掉，
> 详见 [4.4](#44-云函数环境变量这一块2026-11-06-实测三个坑)。

**怎么设进去**：`scripts/cf-admin.mjs`（密钥全程不经过模型）：

```bash
export TCLOUD_SECRET_ID=... TCLOUD_SECRET_KEY=... TCLOUD_SESSION_TOKEN=...
node scripts/cf-admin.mjs show     # 只列键名（值打码）
node scripts/cf-admin.mjs set-wx   # 从 .secrets/server.env 读 → 合并写进云函数
```

它做的是**读-改-写**（`Environment.Variables` 是整组替换语义，盲写会把 `PULSE_STORE` 一起冲掉），
并且把 `Timeout` / `MemorySize` / `Role` 一并回填（不传就可能被重置成默认值 —— 超时 3 秒、内存 128M，函数当场挂）。

**为什么不用 MCP 的 `manageFunctions(updateFunctionConfig)`**：密钥要作为工具参数传进去，**必然进对话上下文**。

### 2.4 凭证从哪来

| 环境 | 来源 |
|---|---|
| 云函数 | 平台自动注入 `TENCENTCLOUD_SECRETID` / `TENCENTCLOUD_SECRETKEY` / `TENCENTCLOUD_SESSIONTOKEN` —— **不用配** |
| 本地 | `PULSE_CB_SECRET_ID` / `PULSE_CB_SECRET_KEY` / `PULSE_CB_SESSION_TOKEN`（或 `TCLOUD_SECRET_*` / `TENCENTCLOUD_SECRET*`） |

凭证**只从环境变量读**，绝不写进仓库。

---

## 3. 实际怎么做的

### 3.1 建表

`server/schema-pg.sql`（PG 语法 DDL，与 SQLite 版一一对应，只换方言）：

| SQLite | PostgreSQL |
|---|---|
| `INTEGER`（时间戳） | `bigint`（**毫秒**，**不要** `timestamptz` —— 前端 `Number(at)` 的比较与排序会坏） |
| `TEXT` | `text` |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `text primary key`（我们本来就是自己生成 id） |
| `INSERT OR IGNORE` | `ON CONFLICT DO NOTHING` |

三条硬规矩：**`owner_id` 用 `text`**（CloudBase PG 的 `auth.uid()` 也是 text）｜**时间戳 `bigint` 毫秒**｜
**`custom_symbols` 主键是 `(owner_id, code)`**。

7 张表 ＋ 9 个索引。建表用 3 个 `DO $$ … $$` 块（`EXECUTE $ddl$…$ddl$`）一次执行成功。

### 3.2 部署 35 个 PG 函数

```bash
export TCLOUD_SECRET_ID=… TCLOUD_SECRET_KEY=… TCLOUD_SESSION_TOKEN=…
export PULSE_ENV_ID=pulse-1-d0g880ydl8ddc57f6

node scripts/pg-admin.mjs run server/pg-functions.sql
```

`scripts/pg-admin.mjs` 绕开 MCP，直接用临时凭证签名调 `tcb` 的 `ExecutePGSql` CAPI，**SQL 从文件读**。
它会**先 DROP 同签名旧函数再 CREATE** —— 因为 PG 的 `CREATE OR REPLACE FUNCTION` **不能改返回类型**。

### 3.3 搬数据

```bash
node scripts/migrate-sqlite-to-pg.mjs --dry-run   # 只看计划
node scripts/migrate-sqlite-to-pg.mjs              # 真搬
node scripts/migrate-sqlite-to-pg.mjs --drop-fn    # 撤掉迁移函数（搬完建议做）
```

**它做什么**：

1. 读 SQLite 七张表；
2. 建「SQLite user id → PG user id」映射 —— **PG 里已有同登录名的账号就复用它的 id**
   （例如单机模式的 `local`），SQLite 那边那个账号不重复建，**它的数据改挂到 PG 那个账号下**；
   不重映射的话外键会指向一个不存在的 user；
3. 一次 RPC 调 `pulse_migrate_import`（**一次 RPC ＝ 一个事务**）；
4. 核对行数 ＋ 跑三条 owner 不变量自检 ＋ **再独立复核一遍**（直接查 PG，不经迁移函数自报）。

**迁移函数是临时的**：`server/pg-migrate-functions.sql` 里的 `pulse_migrate_import` 能绕过 owner 校验批量写表，
长期留在生产库等于开后门 → **搬完就 `--drop-fn` 撤掉**（脚本每次真跑会重新部署，用的是最新定义）。

**本次实测结果**（源：`local-data/history.sqlite`）：

| 表 | 源库行数 | 本次写入 | 迁后 PG |
|---|---|---|---|
| users | 3 | 2（`local` 复用 PG 已有的） | 3 |
| identities | 3 | 3 | 3 |
| sessions | 12 | 12 | 12 |
| patients | 29 | 29 | 29 |
| visits | 113 | 113 | 113 |
| medication | 1 | 1 | 1 |
| custom_symbols | 0 | 0 | 0 |

`sessions` 默认**照搬**（令牌与存储无关，搬过去老会话照样能用）；想跳过用 `--no-sessions`。

### 3.4 三条 owner 不变量自检（必须全为 0）

```sql
-- 1. visit 与其 patient 的 owner 一致
SELECT count(*) FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.owner_id <> p.owner_id;
-- 2. medication 与其 visit 的 owner 一致
SELECT count(*) FROM medication m JOIN visits v ON v.id = m.visit_id WHERE m.owner_id <> v.owner_id;
-- 3. 没有空的 owner
SELECT count(*) FROM custom_symbols WHERE owner_id IS NULL OR owner_id = '';
```

实测：**0 / 0 / 0**（迁移函数自报 ＋ 独立复核，两遍都是 0）。

### 3.5 云函数打包与部署

```bash
node scripts/build-cloudfunction.mjs     # → .cloudfn/pulse-api/（33 MB，真源仍在 server/）
```

组装 `server/` 的 14 个文件 ＋ `index.js` ＋ 生成的 `package.json`（`type: commonjs` ＋ `@cloudbase/node-sdk`）。
**不生成 `scf_bootstrap`**（Event 函数不需要）。

`server/cloudfunction/index.js` 兼容两套 event 形状：HTTP 触发（`event.httpMethod` / `event.requestContext.http`）
↔ 小程序云调用（`event.method` / `event.token`），并把 `event.token` 补成 `Authorization: Bearer` 头
（与网站端同一套鉴权）。

### 3.6 静态托管与 CORS

```bash
VITE_API_BASE="https://pulse-1-d0g880ydl8ddc57f6-1257312696.ap-shanghai.app.tcloudbase.com/pulse-api" npm run build
# 再把 dist/ 上传静态托管
```

实测：站点首页 200、JS 资源 200（`application/javascript`）、CORS 预检 204 带正确 `allow-origin`、
真实浏览器里跨域 `fetch /api/health` 返回 200。

---

## 4. 坑位清单（都已核实，别重踩）

### 4.1 CloudBase 侧

| # | 坑 | 结论 |
|---|---|---|
| 1 | 新建环境能不能选 NoSQL（flexdb） | **不能**。`resources` 只有 `storage`/`function`/`postgresql` → 目标后端是 PG |
| 2 | PG 的 `auth.uid()` 返回什么类型 | **text**（不是 uuid）→ owner 列用 `text` |
| 3 | PG 能不能 TCP 直连 | **本环境不能**（`SHARED` 托管实例无连接地址；体验版 VPC／公网开关不可用）→ 走 `app.rdb().rpc()` |
| 4 | 裸 fetch 调 PG HTTP 网关行不行 | **不行**（要 access token，不认 API Key／Publishable Key）→ 走 SDK |
| 5 | MCP 的 `queryPgDatabase` / `managePgDatabase` | **本机不可用** —— 它把**首次**的 PG 就绪探测结果缓存成**模块级 Promise**，首次失败后被永久缓存，之后所有调用直接抛同一个错、**不会重新探测**。绕法：`scripts/pg-admin.mjs`（`tcb/ExecutePGSql` CAPI） |
| 6 | `CREATE OR REPLACE FUNCTION` 能改返回类型吗 | **不能**（`cannot change return type of existing function`）→ 建前先 `DROP FUNCTION IF EXISTS <name>(<types>)` |
| 7 | postgREST 对标量返回／SQL NULL | **不给 body**（一律 `{}`）→ 返回值统一 jsonb **对象包裹** |
| 8 | `jsonb_agg(jsonb_build_object(…) ORDER BY …)` | 括号位置要小心：`jsonb_agg(jsonb_build_object(...) ORDER BY ...)` |
| 9 | 云函数类型创建后能改吗 | **不能**。先用 Event：Event 能同时喂小程序 `callFunction` 与网关；HTTP 只能喂网关 |
| 10 | Event 函数要 `scf_bootstrap` 吗 | **不要**（HTTP 类型才要，且要 `listen 9000`） |
| 11 | 网关 HTTP Access 的 `upstreamResourceType` | Event 函数要写 **`SCF`**，写 `WEB_SCF` 返回 400 空 body |
| 12 | 网关要不要开路径透传 | **要**（`enablePathTransmission=true`），并在函数侧用 `PULSE_API_PREFIX` 剥掉前缀 |
| 13 | 静态托管域名能手动建网关路由吗 | **不能**（系统内部域名）→ 挂 HTTPSERVICE 默认域名 |
| 14 | `ExecutePGSql` 会不会回传 `RETURNING` 的行 | **不会**，只看影响行数（`AffectedRows`） |
| 15 | PL/pgSQL 里 `record ->> 'k'` | **不合法** → 循环变量声明成 `jsonb`（`FOR v_row IN SELECT jsonb_array_elements(...)`） |
| 16 | `manageEnv(addSecurityDomain)` 能配安全域名吗 | **体验版不行**（「当前套餐无法执行此操作」）→ 靠**服务端 CORS 头**（已实测 204 ＋ 正确头，浏览器 fetch 可用） |
| 17 | 默认域名会有「访问提示中间页」吗 | **会**。浏览器**直接访问**（`Sec-Fetch-Mode: navigate`）默认域名时，平台按合规要求展示「风险提醒」中间页，点「确定访问」后写 cookie，短期内不再出现。**唯一合规的去除办法是配自定义域名（须 ICP 备案）**。API 的 fetch 请求（`Sec-Fetch-Mode: cors`）**不受影响** |

### 4.2 本仓库已经踩过并修掉的

| # | 坑 | 修法 |
|---|---|---|
| 18 | `server/auth.mjs` 直接用 SQLite 专有的 `db.prepare()` | 鉴权层也纳入 `store.mjs` 分发；纯逻辑抽到 `server/auth-core.mjs` |
| 19 | `db.mjs` 与 `db-pg.mjs` 各有一份 `normalizeValues` | 抽到 `server/values.mjs`，两套实现共用一份 |
| 20 | `values` / `symbols` 在 PG 里是 JSON 字符串，规整得在 JS 侧做 | 沿用 SQLite 版语义，在 `db-pg.mjs` 里用 `values.mjs` 的 `normalizeValues` 还原成数组 |
| 21 | `pulse_migrate_import` 能绕过 owner 校验批量写表 | **一次性函数**，搬完 `--drop-fn` 撤掉（PG 上现在只剩 35 个运行时函数） |
| 22 | 对着真库跑回归会留下测试账号 | `scripts/e2e/pg-store.mjs` 现在**自清理**（用管理员通道删掉两个测试账号，外键级联带走它们的患者／就诊／会话） |

### 4.3 本仓库踩过、改存储实现前务必再读一遍的

| # | 坑 | 修法 |
|---|---|---|
| 23 | `db.exec()` 不支持 `?` 占位符 | 一律用 `db.prepare().run()` |
| 24 | 依赖 `owner_id` 的索引写在 `schema.sql` 里 → 建表先于 ALTER，报「no such column」 | 索引挪进 `migrate()` |
| 25 | `return withTransaction(...)` 让后面的 `return await getPatient(...)` 不可达 | 改成 `await` |
| 26 | `ownerId = user.id` 在静态请求也会执行（user 为 null） | 改 `user?.id` |
| 27 | `export { X } from './y.mjs'` 是重导出，**函数体内拿不到绑定** | import 后再 export |
| 28 | `Object.fromEntries` 是 ES2019 内建，老机型 JSCore 没有 | 自写 `toRecord()`（`src/domain/to-record.ts`） |
| 29 | TS 7 移除了 `moduleResolution=node10` | `tsconfig.core.json` 里**不覆盖** `moduleResolution`，让 `bundler` 继承下去 |

### 4.4 云函数环境变量这一块（2026-11-06 实测，三个坑）

| # | 坑 | 结论 |
|---|---|---|
| 30 | **`WX_` 前缀的环境变量在运行时读不到** | **平台会用它自己的值盖掉 `WX_` 前缀**（留给微信云开发的小程序关联信息）。写进 `WX_APPID`／`WX_APPSECRET` 的值：`GetFunction` 读得到、API 也存着，**但函数运行时 `process.env` 里是空的** → 服务端永远以为「没配 AppID」。<br>判定实验（可复现）：新增 `PULSE_SINGLE_USER` → 立刻生效；更新 `PULSE_CORS_ORIGINS` → 立刻生效；新增 `WX_APPID`／`WX_APPSECRET` → **不生效**。<br>修法：一律用 **`PULSE_` 前缀**（`PULSE_WX_APPID`／`PULSE_WX_APPSECRET`），`WX_*` 只在 `server/wechat.mjs` 里当**兜底**（本地自建服务还用老名字）。 |
| 31 | `UpdateFunctionConfiguration` 的 `Environment.Variables` 是整组替换吗 | **是**。只写 `{WX_APPSECRET}` 会把 `PULSE_STORE=pg` 一起冲掉，云函数当场挂 → 必须**读-改-写**（`scripts/cf-admin.mjs` 就是这么做的） |
| 32 | 不传的字段会被重置成默认值吗 | **会**。`Timeout` 默认 **3 秒**、`MemorySize` 默认 **128M**（我们要 20 秒／256M），`Role` 丢了就没 PG 访问权 → 写的时候**把这几个一并回填** |
| 33 | `tcb fn env` 能设环境变量吗 | **不能** —— 只有 `pull`（拉到本地文件），没有 `set`。`tcb fn code update` 是**交互式**的（非交互要用 MCP 的 `updateFunctionCode`，它自己打包上传）。密钥只能靠脚本直发 CAPI |

**验证方式**：`scripts/cf-admin.mjs` 只打印**键名＋值长＋指纹**（名字里带 `SECRET`/`TOKEN` 的连指纹都不给）。
**不要用 `GetFunction` 回读做验证** —— 那会把密钥明文打进对话上下文。

### 4.5 迁到 `pulse-1` 后踩到的（PG 引擎差异，2026-11-06）

| # | 坑 | 结论 |
|---|---|---|
| 34 | `pulse_write_medication` 报 `function jsonb_set(jsonb, text, jsonb) does not exist` | 本引擎的 `jsonb_set` **只有 4 参签名** `(jsonb, path text[], jsonb, create_if_missing boolean)`，**没有 3 参重载**，而且第二参必须是 **`text[]`** 不是 `text`。<br>错误写法：`jsonb_set(v_map, v_key, val)`；正确写法：`jsonb_set(v_map, ARRAY[v_key]::text[], val, true)`，或直接用 `v_map \|\| jsonb_build_object(v_key, val)`（顶层键合并，语义等价、更少引擎差异，**现在代码里用的是这个**）。<br>**这是唯一一处引擎特有写法**；其余 `jsonb_array_elements … WITH ORDINALITY`、`ON CONFLICT DO UPDATE`、`array_append`、`?` 运算符都已实测可用。 |
| 35 | 上面这个 bug 为什么回归没抓到 | `scripts/e2e/pg-store.mjs` 缺 `PULSE_CB_*` 凭证时**静默 `exit(0)`**，所以 `test:e2e:pg` 一直显示“通过”但**一条断言都没跑**。已改为：若显式 `PULSE_STORE=pg` 或 `PULSE_E2E_REQUIRE=1`，缺凭证即 **exit 1**。<br>教训：**任何“跳过”分支都必须能区分「跳过」和「通过」**，否则等于没有这个测试。 |

> 复现方式（不动真实数据）：用测试账号 `mptest01` 建一个一次性患者，走 `pulse_put_patient` → 读 `medication.seq` 应为 0/1/2，再 `pulse_delete_patient` 清掉。函数级冒烟可一次覆盖 `put_patient`／`put_visit`／`put_visit_medication`／`delete_medication`／`rename_patient`／`update_patient_layout`／`search_patients`／`list_medication`／`put_symbol`／`list_symbols`／`delete_symbol`／`delete_visit`／`delete_patient`。

---

## 5. 验收清单

### 5.1 已过 ✅

- [x] **数据**：迁前迁后四张业务表行数一致（29 患者／113 就诊／1 用药／0 自定义符号）
- [x] **不变量**：三条 owner 自检全为 **0**（迁移函数自报 ＋ 独立复核，两遍）
- [x] **归属**：`local` 账号的「测试 1」已重映射到 PG 的 `u3c825719f3`，其余 28 位患者归属原样
- [x] **登录**：用迁移过去的账号 `mptest01` 走真实网关登录成功（密码哈希原样带过去）
- [x] **读**：网关取患者列表 14 位、患者详情含 4 次就诊、格值 key 形如 `L|寸|浮`、体质／疗法字段正确
- [x] **网站**：静态托管域名打开即用（首页 200、JS/CSS 200）
- [x] **跨域**：CORS 预检 204 ＋ 正确 `allow-origin`；**真实浏览器**里跨域 `fetch /api/health` 返回 200
- [x] **隔离**：PG 存储层回归 49/49（含「跨用户一律 404 不是 403」）
- [x] **微信登录凭据**：`PULSE_WX_APPID`／`PULSE_WX_APPSECRET` 已进云函数；
      用假 code 打 `POST /api/auth/wechat/login` 返回 **40029「登录凭证已失效」** ——
      说明请求**真的到了微信的 `jscode2session`**（AppID／AppSecret 被接受；密钥错会是 40125）
- [x] **SQLite 没破**：全量回归 **499/499** 全绿

### 5.2 还差的事

- [x] **账号级关联：已完成** —— 环境 `pulse-1-d0g880ydl8ddc57f6` 的
      `UserInfo.WxAppId = wx3a21eb903a16cbc4`（`DescribeEnvs` 实测，
      `UserInfo.UpdateTime` = 2026-11-06T07:07:00Z）。
      这一步只能在**微信侧**做：CloudBase 控制台 → 用户名下拉 → 账号信息 → 账号中心 →
      「登录方式」→「微信公众平台」→ 关联 → 扫码 →「去授权」。
      ⚠️ 公开 API 代劳不了（`BindEnv` 不存在；`ModifyEnv` 只收 `EnvId`／`Alias`／`CustomQps`，
      `ModifyEnvExtra` 只收 `EnableOverrun`）。
- [ ] **「环境在微信侧可见」：还没实测** —— 账号级关联 ≠ 小程序侧 `wx.cloud` 一定认这个环境。
      官方路径的第二步是「**环境转换**」（微信开发者工具 → 云开发 → 设置 → 环境名称下拉 →
      管理我的环境 → 侧边栏「**使用已有腾讯云环境**」→ 选本环境 → 确认「环境转换」→ 扫码），
      但 **2026-11-06 实测：入口在（工具版本 36.6.0），列表里能看到 `pulse-1`，
      鼠标悬停却提示「暂不支持选择 PostgreSQL 环境」→ 选不了**（NoSQL 环境才行）。
      官方社区工单 [#1154](https://cnb.cool/tencent/cloud/cloudbase/community/-/issues/1154)
      记录的就是本项目这个场景，最终结论「需后台人工介入」，工单被 stale-bot 自动关闭。
      → **但这不等于「PG 在小程序里用不了」**：官方文档
      <https://docs.cloudbase.net/database/framework-quickstarts/pg/mp>
      明写支持微信小程序访问 CloudBase PostgreSQL，走 `wx.cloud.init` ＋ `rdb()` **直连**，
      **不经过转换**。两处官方文档打架 → **只能实测**（`docs/miniprogram-release-checklist.md` §2.7）。
- [x] **开发期绕开：改走 `TRANSPORT='request'` ＋ 网关地址**（2026-11-06 实测）
      ```bash
      PULSE_TRANSPORT=request \
      PULSE_API_BASE="https://pulse-1-d0g880ydl8ddc57f6-1257312696.ap-shanghai.app.tcloudbase.com/pulse-api" \
      npm --prefix taro run build:weapp
      ```
      产物已验：无 `process.env` 残留、无 `127.0.0.1`、网关地址已注入、云调用代码被 tree-shake 掉。
      网关 curl 实测：`/api/health` → 200（`db: CloudBase PostgreSQL`）、`/api/patients` → 401（路由通）。
      → **现在就能连上云端 PG 真数据继续开发**，不用等关联、不用备案。
      ⚠️ **但只能开发调试**：云开发默认域名未备案，进不了 request 合法域名白名单
      （官方工单 [#1219](https://cnb.cool/tencent/cloud/cloudbase/community/-/issues/1219)），
      体验版／正式版会被微信拦 —— **上线仍必须走 cloud 路线**。
- [x] **双保险构建（2026-11-07 新增）** —— `TRANSPORT=cloud` ＋ 注入网关地址 ＋ 正确的 env id：
      云通道通就走云函数，不通自动退回网关直连。**只会比纯 request 包更好，不会更差**，
      而且**一次编译就能测出云通道通不通**（`docs/miniprogram-release-checklist.md` §2.6.1／§2.7）。
- [ ] **小程序真机验证**（用户已明确「不做真机验证」，改为上线前再验）
- [ ] **自定义域名 ＋ ICP 备案** —— 默认域名**只能用于开发测试**，平台明说「严禁用于正式生产环境或分发给大规模用户」，
      且流量异常可能触发风控关停。去掉「风险提醒中间页」也只有这一条路。
      （**走 cloud 路线时这一项不阻塞小程序上线** —— 云函数走微信内部通道，不受域名白名单约束。）
- [ ] **PG 侧备份策略**（CloudBase 自带快照）确认
- [ ] **回滚预案**：旧 SQLite 服务端仍能起（留一台观察期）

---

## 6. 现在不做、但要留位的事

| # | 事项 | 现在的处理 |
|---|---|---|
| 1 | 实时推送（WebSocket/SSE） | 「刷新即见」＋ 可选轻量轮询。真要做还需另配 socket 合法域名 |
| 2 | 异地备份 / 对象存储 | 备份先放服务器本地 `/backup`，保留 30 天 |
| 3 | 可视化管理后台 | 只做命令行（`scripts/admin.mjs`） |
| 4 | 患者数据共享给同事 | 本期不做；`patients.owner_id` 之后可加 `patient_members` 关联表 |
| 5 | 付费订阅 / 微信支付 | 不在本期范围 |
| 6 | **Windows 桌面端** | **不迁 CloudBase** —— 保持单机、免登录、只在这台电脑上（本地 SQLite） |
