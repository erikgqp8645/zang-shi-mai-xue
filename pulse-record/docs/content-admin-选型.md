# 本地后台选型 —— M0 实测结论

> **一句话结论**：**M0-B（本地 SQLite ＋ Directus 容器）成立** ——
> D4＝SQLite、D10＝Directus 不变，按已批准的计划 v8 继续走 M1~M7。
>
> 但实测**推翻了计划里的两个乐观假设**（复合主键能用／WAL 能跨进程共享），
> 两处都已就地修正并写进了代码注释与断言。**没有一条假设被带进下一阶段。**

- 实施计划（canonical）：`~/.minimax/v2/sessions/2026/11/02/03-37-13-904-session_bXZzXzc4YmIxZTViOGJmZTRhNWM4YzQ1YzE3NTkyZTBlYWYy/artifacts/plan.md`
- 本地内容层现状：`docs/content-layer.md`（**该文档仍描述 Excel 时代**，M6 会随新流程重写）
- 实测日期：2026-11-11

---

## 1. 环境与版本

| 项 | 值 |
|---|---|
| 机器 | macOS 24.6.0（x64） |
| Docker Desktop | 4.91.0 ／ 引擎 29.8.0 ／ CLI 29.8.0 |
| Directus | **12.6.1**（`directus/directus:12.6.1`） |
| 镜像 digest | `sha256:e1561b5e526e8e7a2ac19b7bb6eab63611dd84a862a8c45b864118768a2baff4` |
| 镜像体积 | **1.11 GB**（磁盘余量 14 GiB，够用） |
| Node | v24.12.0（内置 `node:sqlite`，**零新增 npm 依赖**） |
| 内容库 | `local-data/content.sqlite`（17 张内容表 ＋ Directus 系统表同库） |

> ⭐ **Docker Desktop 本机已装**（`/Applications/Docker.app`）——计划 v5 估的「一次性安装成本」
> 是错的，M0 的门槛从来只剩「锁能不能用」这一个技术问题。

---

## 2. 六条验收，逐条给结论

| # | 验收项（计划 §6.2） | 结论 | 证据 |
|---|---|---|---|
| ① | 中文界面可用 | ✅ | 登录页已是中文（邮箱／密码／登录／忘记密码）；项目默认语言与用户语言都设为 `zh-CN` |
| ② | introspect 自动列出表并生成表单 | ✅ | **17/17** 张内容表全部被接管，每张都有字段与主键 |
| ③ | M2O 关系字段点选（显示中文用字名） | ✅（配置层） | 11 条外键全部升级成 Directus 关系；`content_pulse_cells.term_id → content_pulse_terms.key`，而用字的 `key` 本身就是中文（「大或顶」「有」…），下拉直接显示中文用字名 |
| ④ | 多值下拉（symbols 多选） | ⚠️ **受限** | `codes` 是 `jsonb` 列，Directus 的多选界面只服务**关系字段**；且实测 **96 个格位里 0 处有值** —— 见 §5.2 |
| ⑤ | 按 `pattern_id` 过滤后只显示 18 行 | ✅（机制层） | `GET /items/content_pulse_cells?filter[pattern_id][_eq]=fx-ssx-qingdanglu` 返回**正好 18 行**（左 9 ＋ 右 9，含用字 6 格）；并已预置「一张图 18 行」的视图预设 |
| ⑥ | 内存占用与首次启动时间 | ✅ | **冷启动 11.6 s** 到可服务；稳态内存 **287 MiB**（本机 7.75 GiB 的 3.7%）；镜像 1.11 GB |

**R-Edit（硬约束）**：全部内容表都在后台里以**表格＋表单**呈现，可直接编辑。
**全程不碰命令行**这条在 §3.2 的踩坑里尤其值钱 —— 那个坑从命令行根本看不出来。

---

## 3. 三个实测出来的硬约束（都已写进代码注释）

### 3.1 ⚠️ Directus **只认单列主键**，复合主键的表会被**整表忽略**

Directus 12.6.1 的 SQLite schema inspector（`packages/schema/src/dialects/sqlite.ts`）：

```js
const primaryKeys = columns.filter((column) => column.pk !== 0);
overview[table] = {
  primary: primaryKeys.length !== 1 ? void 0 : primaryKeys[0].name,   // ← 复合主键 ⇒ undefined
  ...
};
```

而 `get-schema.js` 拿到 `primary === undefined` 就直接跳过整张表：

```
WARN: Collection "content_pulse_cells" doesn't have a primary key column and will be ignored
```

**后果**：M1 设计的 6 张复合主键表（`content_pulse_cells`／`content_rule_formulas`／
`content_rule_drugs`／`content_group_positions`／`content_term_codes`／`content_term_also`）
**全部被忽略** —— 其中 `content_pulse_cells` 正是整个编辑面的核心（18 格矩阵）。
（PG 那套 inspector 也一样：它把复合主键压成单列，主键会认错。）

**处置**：给这 6 张表各加一个**派生的单列代理键 `id`**（＝「父键｜序号」），
原复合列降为普通列。规则写在 schema 的 `x-tables.derivedId` 里（**唯一来源**），
落库时生成、导出时丢弃（它不是内容），并新增断言 **A5** 核对「`id` 与派生规则是否一致」。

| 表 | `id` 取值 |
|---|---|
| `content_pulse_cells` | `pattern_id｜seq`（如 `fx-ssx-qingdanglu｜0`） |
| `content_rule_formulas` / `content_rule_drugs` | `rule_id｜seq` |
| `content_group_positions` | `group_id｜seq` |
| `content_term_codes` / `content_term_also` | `term_key｜seq` |

> 这是关系型建模里的标准做法（复合键 → 代理键）。
> **本地 SQLite 与远端 PG 由同一份 schema 生成 DDL，两边照样同名同列同语义**，
> 发布脚本仍是「同构 → 同构」的直接搬运。

### 3.2 ⚠️ WAL 模式下**两个 SQLite 实例共享同一个库文件会互相毁掉对方的 WAL**

**这是 M0 最险的一个坑，症状极具迷惑性**：

- 宿主机脚本与容器里的 Directus 是**两个独立的 SQLite 实例**，共享同一个 `content.sqlite`。
- WAL 模式靠 `-wal`／`-shm` 两个**常驻文件**共享数据。
- 宿主机连接一关闭，SQLite 会 checkpoint 并 **unlink** 这两个文件；
  容器里的 Directus 仍握着**已删除 inode** 的 fd ⇒ **它的写入全部凭空消失**。

实测症状：

```
API 说：  {"data":{"id":"fx-bianmai-wuli","title":"写坏测试标题", ...}}   ← 200，看起来成功
宿主机读： "三焦疗法·肾虚"                                                ← 纹丝不动
容器内读： "三焦疗法·肾虚"                                                ← 连容器自己都读不到
/proc/44 -> /data/content.sqlite-shm (deleted)
/proc/44 -> /data/content.sqlite-wal (deleted)
```

**处置**：内容库统一 `PRAGMA journal_mode = DELETE`
（写在 `scripts/lib/content-db.mjs` 的 `openDb()` 里，附完整说明）。
DELETE 模式没有那个常驻共享文件 ⇒ 两个进程可以安全地先后访问同一个文件。
内容库是单人编辑、并发需求为零，**WAL 的收益本来就用不上**。

> ⚠️ **业务库（`server/db.mjs`）仍用 WAL** —— 那是另一份库、另一种访问模式，**别照抄**。

### 3.3 ⚠️ bind-mount 不能挂在 `/directus`

镜像里 Directus 的应用本体就装在 `/directus`，挂到那儿会把应用目录整个盖掉：

```
Error: Cannot find module '/directus/docker-entrypoint.cjs'
```

**处置**：挂到 `/data`，`DB_FILENAME=/data/content.sqlite`。

---

## 4. 对计划的修正（逐条）

| 计划里写的 | 实测 | 处置 |
|---|---|---|
| 「16 张内容表」 | **17 张** | 计划自身的计数笔误（它的表清单本身就是 17 行）—— 以清单为准 |
| 复合主键的连接表／格位表 | Directus **整表忽略** | 6 张表加派生代理键 `id`（§3.1）＋ 新增断言 A5 |
| 本地库沿用 `server/db.mjs` 的 WAL 写法 | 双实例共享会**丢写入** | 内容库改 DELETE 模式（§3.2），业务库不动 |
| 外键关系需要人工在后台配 | Directus 12 **自动内省**出 11 条关系（`meta` 为 `null`） | 用 `PATCH /relations/{集合}/{字段}` 补 `meta`（含 `one_field`），并把关系字段的界面设成 `select-dropdown-m2o`；全部由 `scripts/content-admin-init.mjs` **从 schema 的 `fk` 声明自动推导**，可重复执行 |
| 「M0-A：本地 PG 容器兜底」 | **不需要** | M0-B 全程成立，未启用 M0-A ⇒ **未新增 `pg` 依赖** |
| 「M0-C：桌面 GUI」 | 已排除 | 不满足 R-Edit，未测 |

**新增的两个「计划外但必须补」的东西**（都已补，不改方向）：

- `scripts/content-admin.mjs` —— 容器启停（`up`／`down`／`status`／`reset`），
  把上面三条硬约束固化在脚本里，避免下次有人改错。
- `scripts/content-admin-init.mjs` —— 关系 ＋ 字段界面 ＋ 视图预设的初始化，幂等。

---

## 5. 尚未闭环的项

### 5.1 界面里的人眼确认与截图 —— **待补**

自动化已把「配置写对」全部验完（11 条关系、18 行过滤、17/17 接管、中文界面），
但**「点开 `content_pulse_cells` 的一格，`term_id` 是不是一个能点选的下拉框」**
这一条目前只有配置层证据，没有截图。验收项 ④ 也因此只能给「受限」结论。

补法：登录 `http://localhost:8055/admin`（账号见 §6）走一遍，把截图补进本节。

### 5.2 验收项 ④ 的结论：**多值下拉在当前 schema 下做不到，但当前内容也不需要**

- `content_pulse_cells.codes` 是 `jsonb` 列（计划 §3 定的），Directus 的
  `select-multiple-dropdown`／`select-multiple-checkbox` 是**关系界面**，
  值是「关联项主键数组」，**不能直接渲染 JSON 数组**。
- 实测 **`codes` 在 96 个格位里 0 处有值** ⇒ 当前内容**根本用不到**多选。
- 真要在格位上选符号，得把它改成**连接表**（`content_cell_symbols` ＋ M2M 关系），
  即多一张表、多一层 junction 关系。

⇒ **列为待拍板项**（计划 §11.1 一类），默认**保持 `jsonb` 不动**。

### 5.3 派生 `id` 的编辑风险

代理键是**算出来的**。后台里手工新增一行时，人得自己填对 `id`（如 `fx-ssx-qingdanglu｜3`），
否则 `id` 与「父键｜序号」对不上 —— 断言 **A5** 会抓到，发布脚本也会挡住。
风险可控，但**在后台界面上给这 6 张表做「新增行」不太友好**，M6 若做定制页可考虑自动生成。

---

## 6. 怎么复现

```bash
cd pulse-record

# ① 起本地后台（自动拉镜像 1.11 GB、挂载 local-data → /data）
node scripts/content-admin.mjs up
#    → http://localhost:8055/admin
#    → 账号 admin@example.com　密码 PulseLocal2026（本地临时凭据，可改）

# ② 配关系与视图（幂等；从 schema 的 fk 声明自动推导）
node scripts/content-admin-init.mjs

# ③ 灌库（首次）／校验
node scripts/content-seed.mjs
node scripts/content-seed.mjs --check

# ④ 断言的「故意写坏」验证（16/16）
node scripts/e2e/content-schema-break.mjs

# 停
node scripts/content-admin.mjs down
```

**底层等价命令**（脚本只是把它固化下来）：

```bash
docker run -d --name pulse-directus -p 8055:8055 \
  -v "$PWD/local-data:/data" \
  -e DB_CLIENT=sqlite3 -e DB_FILENAME=/data/content.sqlite \
  -e ADMIN_EMAIL=admin@example.com -e ADMIN_PASSWORD=PulseLocal2026 \
  -e KEY=... -e SECRET=... -e TELEMETRY=false -e CACHE_ENABLED=false \
  directus/directus:12.6.1
```

---

## 7. 下一步（按计划 v8）

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | 本地后台选型验证 | ✅ **本轮完成**（截图待补，见 §5.1） |
| M1 | 内容 schema ＋ 本地库建表 | ✅ **本轮完成**（8 份 schema、DDL 生成器、灌库、断言 A1~A5＋往返） |
| M2 | 远端 PG 内容表 ＋ RPC | ⏭ 待做 |
| M3~M7 | 发布管道／前端接内容／后台页／迁移收尾 | ⏭ 待做 |

**待拍板（计划 §11.1）**：

- ② 远端内容表放独立 schema `content` 还是 `public`＋前缀 —— M2 实测
- ③ `docs/填写流程图.html` 退役是否可接受
- ④ `pulse`（NoSQL，2026-12-06 到期）留不留
- ⑤ 本地后台是否常驻
- ＋ **新增**：验收项 ④ 的 `codes` 是否改成连接表（§5.2，默认不动）
