# 迁移到 CloudBase —— 前期规划

> 目标：把现在的「服务器上跑 Node + SQLite」搬进 **CloudBase**，
> 网站跑静态托管、API 跑云函数、数据存 **PostgreSQL**、小程序走 `wx.cloud.callFunction`。
>
> **本轮（多用户改造）已经把代码侧的准备做完了**，本文分两部分：
> ① 已经做完什么（照着做就不会重复劳动）② 真要迁移时怎么做（含坑位清单）。

---

## 0. 一句话现状

| 项 | 现状 | 迁 CloudBase 后 |
|---|---|---|
| 数据库 | 本机/服务器上的 SQLite 单文件 | CloudBase **PostgreSQL**（`auth.uid()` 返回 **text**，与我们的 TEXT id 正好对上） |
| API | 自建 Node 进程（`node:http`，零第三方依赖） | CloudBase **云函数**（HTTP 类型） |
| 网站 | 同一 Node 进程托管 `dist/` | CloudBase **静态托管**（`<envId>-<appId>.tcloudbaseapp.com`） |
| 小程序 | `wx.request` → 合法域名 | `wx.cloud.callFunction` → **不走合法域名校验** |
| 同源 | 是（网站与 API 同端口） | **否**（静态托管与云函数不同源）→ 需要 CORS |

---

## 1. 代码侧已经做完的准备（这轮）

这些**不是「以后再说」**，已经落地并有测试覆盖。迁移时**不用再改**：

### 1.1 存储收敛成一层 —— `server/store.mjs`

路由层（`server/index.mjs`）**只认 `store.mjs` 暴露的函数契约**，不直接碰 SQLite。
换后端 = 只改 `store.mjs` 一个文件，路由层／前端／小程序**零改动**。

```
server/index.mjs（路由 · 鉴权 · CORS）
        ↓  只认这一层的函数契约
server/store.mjs（存储实现选择层）   ← 迁 CloudBase 只改这里
        ├── server/db.mjs   （现在的 SQLite 实现）
        └── server/db-pg.mjs（将来新增的 PG 实现）
```

新增一个 PG 实现、让它在 `PULSE_STORE=pg` 时生效，路由层不用动一行。

### 1.2 db / auth 层全部改成 async

SQLite 的 `DatabaseSync` 是同步 API，CloudBase PG（postgREST）全是异步。
本轮把 `server/db.mjs` 与 `server/auth.mjs` 的**全部导出函数改成 `async`**，
**签名先定死**（参数与返回值形状不变）—— 将来换后端时，调用方（路由层）**零改动**。

```js
// 现在的写法（已 async 化）
const patient = await getPatient(db, id, ownerId)
```

### 1.3 事务收拢进 `withTransaction()`

SQLite 用 `BEGIN/COMMIT/ROLLBACK`，PG 用 `BEGIN/COMMIT/ROLLBACK`（语义一致）。
本轮把散在各处的裸事务语句收进了 `server/db.mjs` 的 `withTransaction()` 辅助函数，
PG 实现可以直接复用同一个写法。

### 1.4 去 SQLite 专有语法

| 原来 | 改成 | 为什么 |
|---|---|---|
| `INSERT OR IGNORE` | `ON CONFLICT DO NOTHING` | 两库通用 |
| `db.exec()` 带 `?` | `db.prepare().run()` | `exec()` 不支持占位符（SQLite 专属坑） |
| 依赖 `owner_id` 的索引写在 `schema.sql` | 挪进 `migrate()` | 建表先于 ALTER，会报「no such column」 |

### 1.5 知识常量与存储分离 —— `server/symbol-codes.mjs`

讲义固定符号集（`0 - + ± ++ ±± +++ ++++ ↑ | # TTT DDX X`）从 `db.mjs` 里抽出来了。
换存储实现时这些常量不变，**也不会**被误当成数据库里的数据。

### 1.6 前后端的「换地址」开关

| 开关 | 位置 | 作用 |
|---|---|---|
| `VITE_API_BASE` | 网站前端构建时环境变量 | 网站与 API 不同源时，指定 API 根地址。默认同源，留空即可 |
| `PULSE_CORS_ORIGINS` | 服务端环境变量 | 逗号分隔的允许来源。**同源部署留空**；迁 CloudBase 后填静态托管域名 |
| `miniprogram/utils/config.js` 的 `TRANSPORT` | 小程序端 | `'request'` → `wx.request`；`'cloud'` → `wx.cloud.callFunction` |

### 1.7 小程序端的传输层封装 —— `miniprogram/utils/api.js`

页面只认一个签名：

```js
request({ method, path, body }) → Promise<data>
```

底下用哪种传输由 `config.js` 的 `TRANSPORT` 决定。**页面代码在两种模式下完全一样**。

### 1.8 会话与鉴权不用改

令牌是**不透明随机 token**，存 `sessions` 表，`Authorization: Bearer` 头传递。
这套与后端无关 —— 换 PG 之后行为一样，**不需要改成 JWT、不需要接 CloudBase 的登录体系**。

> 为什么不接 CloudBase 自带登录？
> 我们要的是「网站账号＋密码」与「微信 openid」**绑到同一个 `users` 行**上，
> 这是一套自定义身份模型，CloudBase 的内置登录给不了。自己做反而更简单、也更可控。

---

## 2. 目标架构（迁完之后）

```
┌────────────────────────┐          ┌────────────────────────┐
│ 网站（React 19 SPA）     │          │ 微信小程序（原生）        │
│ CloudBase 静态托管        │          │ wx.cloud.callFunction   │
│ <envId>-<appId>          │          │ （不走 request 合法域名）  │
│   .tcloudbaseapp.com    │          └───────────┬────────────┘
└───────────┬────────────┘                      │
            │ HTTPS（跨域 → CORS）                │
            └─────────────────┬────────────────────┘
                              ▼
              ┌───────────────────────────────┐
              │ CloudBase 云函数（HTTP 类型）    │
              │  · 路由与鉴权（server/index.mjs）│
              │  · 存储层（server/store.mjs）   │
              │  · 微信 code2Session 代理       │
              └───────────────┬───────────────┘
                              ▼
              ┌───────────────────────────────┐
              │ CloudBase PostgreSQL           │
              │  users / identities / sessions │
              │  patients / visits / medication│
              │  custom_symbols                │
              └───────────────────────────────┘
```

---

## 3. 迁移步骤

### 步骤 0 · 建环境（Day 0，与备案并行）

CloudBase 新建环境时选资源：

- ✅ `function`（云函数）
- ✅ `postgresql`（数据库）
- ✅ `storage`（静态托管 —— 云函数运行时代码包也放这儿）
- ❌ **不要指望 `flexdb`（NoSQL）** —— 新建环境不提供这个资源。
  这也是本轮把存储层设计成「换 PG 只改一处」的原因：**目标后端从一开始就是 PG**。

### 步骤 1 · 建表

把 `server/schema.sql` 的 DDL 改成 PG 语法后在 PG 里执行：

| SQLite | PostgreSQL |
|---|---|
| `INTEGER`（时间戳） | `bigint` |
| `TEXT` | `text` |
| `REAL` | `double precision` |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `text primary key`（我们本来就是自己生成 id） |
| `strftime('%s','now')` | `extract(epoch from now())::bigint` |
| `INSERT OR IGNORE` | `ON CONFLICT DO NOTHING` |

> **`owner_id` 用 `text` 而不是 `uuid`** —— CloudBase PG 的 `auth.uid()` 返回的是 **text**，
> 正好与我们自己的 TEXT id 一致，用 uuid 反而多一层转换。

### 步骤 2 · 写 PG 存储实现

新增 `server/db-pg.mjs`，实现 `server/store.mjs` 的同一套函数契约。
**照抄 `server/db.mjs` 的 SQL 语义**（同样的 WHERE 条件、同样的 404 而非 403 的行为），
只换方言与驱动。

建议用 CloudBase MCP 的 `queryPgDatabase` / `managePgDatabase` 做迁移与校验。

### 步骤 3 · 搬数据

一次性脚本，从 SQLite 读、往 PG 写：

```
users / identities / sessions    —— 本机库里只有一个 local 账号；正式数据在服务器上，按需搬
patients / visits / medication / custom_symbols
```

搬完必须核对行数（与 `docs/deploy.md` 的恢复演练同一套口径）：

```sql
SELECT (SELECT count(*) FROM patients),
       (SELECT count(*) FROM visits),
       (SELECT count(*) FROM medication),
       (SELECT count(*) FROM custom_symbols);
```

并跑一遍**三条 owner 不变量自检**（`server/db.mjs` 里已有同样的检查，PG 实现也要有）：

```sql
-- 1. visit 与其 patient 的 owner 一致
SELECT count(*) FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.owner_id <> p.owner_id;
-- 2. medication 与其 visit 的 owner 一致
SELECT count(*) FROM medication m JOIN visits v ON v.id = m.visit_id WHERE m.owner_id <> v.owner_id;
-- 3. 没有空的 owner
SELECT count(*) FROM custom_symbols WHERE owner_id IS NULL OR owner_id = '';
```

三条都必须为 **0**。

### 步骤 4 · 云函数

把 `server/index.mjs` 改成 CloudBase HTTP 云函数的入口：

- 路由仍然走**同一张路由表**（`server/index.mjs` 里那套 `if (path === ...)` 判断逻辑可以直接搬）。
- 鉴权：`Authorization` 头在 HTTP 云函数里拿得到，逻辑不用改。
- `code2Session`：`wx.cloud.callFunction` 侧不需要额外配置，但**服务端仍要能出网**调
  `api.weixin.qq.com` —— 云函数默认可以出网 ✓。
- 静态文件不要再由云函数托管 —— 交给静态托管。

**路由表要抽出来**：现在路由逻辑直接写在 `createServer` 的回调里，
搬到云函数时应该抽成 `handleApi(req, res, ctx)`，两边共用。这是一处小重构。

### 步骤 5 · 静态托管与 CORS

网站构建：

```bash
VITE_API_BASE=https://<云函数域名> npm run build
```

服务端：

```ini
PULSE_CORS_ORIGINS=https://<envId>-<appId>.tcloudbaseapp.com
```

**同时**要在 CloudBase 控制台把静态托管域名加进**安全域名（CORS 白名单）**。

> 注意 `PULSE_CORS_ORIGINS` **不接受 `*`**：病例数据敏感，只允许明确列出的来源。

### 步骤 6 · 小程序切传输方式

`miniprogram/utils/config.js`：

```js
const TRANSPORT = 'cloud'   // 从 'request' 改成 'cloud'
```

`wx.cloud.callFunction` 的云函数约定（`miniprogram/utils/api.js` 里已经按这个约定写好了）：

```js
exports.main = async (event) => {
  // event = { path, method, body, token }
  // 返回 { statusCode, body }
  return { statusCode: 200, body: { ok: true } }
}
```

**这一步的价值**：小程序不再受「request 合法域名必须 HTTPS＋已备案」的约束 ——
**备案没下来也能先跑通小程序侧**。

---

## 4. 坑位清单（已核实，别重踩）

### 4.1 CloudBase 侧

| # | 坑 | 结论 |
|---|---|---|
| 1 | 新建环境能不能选 NoSQL（flexdb） | **不能**。`resources` 只有 `storage`/`function`/`postgresql` → 目标后端是 PG |
| 2 | PG 的 `auth.uid()` 返回什么类型 | **text**（不是 uuid）→ owner 列用 `text`/`varchar(64)` |
| 3 | PG 模式的 API 是不是 NoSQL 那套 | **不是**。用 `.match()/.eq()/.order()/.range()`，**不是** `.where()/.orderBy()/.count()/.offset()` |
| 4 | 静态托管与云函数同源吗 | **不同源**（`<envId>-<appId>.tcloudbaseapp.com` vs 云函数域名）→ 必须配 CORS 与安全域名 |
| 5 | `wx.cloud.callFunction` 要不要配 request 合法域名 | **不要** —— 它不走合法域名校验 |
| 6 | `code2Session` 个人主体能不能用 | **能**。官方文档「适用范围：小程序 ✔」不按主体类型限制；但**必须服务端调用**，`session_key` 不下发前端 |

### 4.2 本仓库已经踩过并修掉的

| # | 坑 | 修法 |
|---|---|---|
| 7 | `db.exec()` 不支持 `?` 占位符 | 一律用 `db.prepare().run()` |
| 8 | 依赖 `owner_id` 的索引写在 `schema.sql` 里 → 建表先于 ALTER，报「no such column」 | 索引挪进 `migrate()` |
| 9 | `return withTransaction(...)` 让后面的 `return await getPatient(...)` 不可达 | 改成 `await` |
| 10 | `ownerId = user.id` 在静态请求也会执行（user 为 null） | 改 `user?.id` |
| 11 | `export { X } from './y.mjs'` 是重导出，**函数体内拿不到绑定** | import 后再 export |
| 12 | `Object.fromEntries` 是 ES2019 内建，老机型 JSCore 没有 | 自写 `toRecord()`（`src/domain/to-record.ts`） |
| 13 | TS 7 移除了 `moduleResolution=node10` | `tsconfig.core.json` 里**不覆盖** `moduleResolution`，让 `bundler` 继承下去 |
| 14 | `return withTransaction` 同 9 | 已修 |

### 4.3 迁移时容易漏的

- **`sessions` 表**：SQLite 里存的是旧 token，迁到 PG 后照样能用（token 与存储无关）。
  但如果顺手改了令牌格式，旧 token 全失效 → 用户被登出（可接受，但要知情）。
- **`users` 表的 `local` 账号**：单机模式的兜底账号，迁过去后仍要建。
- **时间戳**：SQLite 里是 `INTEGER` 毫秒，PG 里建议 `bigint` 毫秒（**不要**换成 `timestamptz`，
  否则前端的 `Number(at)` 比较与排序会出问题）。
- **`custom_symbols` 的主键**：本轮已从 `code` 改成 `(owner_id, code)` —— PG 建表要照新的来。

---

## 5. 迁移时的验收清单

- [ ] 账号：网站注册 → 小程序绑定 → 两端看到同一份病例
- [ ] 隔离：A 账号看不到 B 的患者/就诊/用药/自定义符号（跨用户一律 **404**，不是 403）
- [ ] 数据：迁前迁后四张业务表行数一致
- [ ] 不变量：三条 owner 自检全为 0
- [ ] 网站：静态托管域名打开即用，API 跨域正常
- [ ] 小程序：`TRANSPORT='cloud'` 下真机预览能取到数据
- [ ] 令牌：网页端与小程序端的会话互不影响（同一账号，两个端各拿一个 token）
- [ ] 备份：PG 侧的备份策略（CloudBase 自带快照）已确认
- [ ] 回滚：旧 SQLite 服务端仍能起（留一台观察期）

---

## 6. 现在不做、但要留位的事

| # | 事项 | 现在的处理 |
|---|---|---|
| 1 | 实时推送（WebSocket/SSE） | 「刷新即见」＋ 可选轻量轮询。真要做还需另配 socket 合法域名 |
| 2 | 异地备份 / 对象存储 | 备份先放服务器本地 `/backup`，保留 30 天 |
| 3 | 可视化管理后台 | 只做命令行（`scripts/admin.mjs`） |
| 4 | 患者数据共享给同事 | 本期不做；`patients.owner_id` 之后可加 `patient_members` 关联表 |
| 5 | 付费订阅 / 微信支付 | 不在本期范围 |
