# 用方知识库 · 管理员手册

> 「整个用方知识库都可以编辑」这件事的**唯一写入面**。
> 管理员在命令行里改 → 改动落本机 SQLite → `library apply` 合并回内容文件 → 重新构建 → 前端生效。
> **这一轮前端代码一行都没改**（内容是编译期内联的）。

---

## 1. 两层结构

```
内置基线（只读）                      管理员覆盖层（可写）
src/content/*.json                    本机 SQLite 的 library_items 表
  · Excel 管线的产物                    · 一条目一行，按 (kind, item_id) 整条接管
  · 已经提交进 git                       · 墓碑（deleted=1）＝ 这条被删了
  · 前端编译期内联的就是它                · 所有账号共享同一份（公共资料）
        └──────────► library apply ◄────┘
                        │
                        ▼
              src/content/*.json（合并结果）
```

**为什么分两层**：内置基线是**资料**（有出处、有原文、有 Excel 人工编辑层），
不能被随手改坏；覆盖层是**管理员的改动记录**（谁改的、什么时候、为什么，都留着）。
两层分开，改错了能撤销、能审计、能导出到别的机器。

**覆盖层语义**（与 `server/db.mjs` 的 `formula_patterns` 同一套，不发明第二套）：

| 覆盖层里 | 结果 |
|---|---|
| 有行且 `deleted=0` | 用这一行的 payload **整条接管**该基线条目 |
| 有行且 `deleted=1` | **墓碑**：该条目在结果里消失 |
| 没有行 | 保持内置基线 |

⚠️ 为什么要墓碑：覆盖层是「有行就用覆盖层」。若删除只表现为「没有行」，
读回来就等于「没改过」→ 静默回落到基线，管理员刚删掉的条目又冒出来。

---

## 2. 能改哪些东西

| kind | 是什么 | 基线位置 | 可改字段 | 可增 | 可删 |
|---|---|---|---|---|---|
| `rule` | 讲义 p44 依脉用方（61 条） | `formula-rules.json` → `rules[]` | id / route / condition / therapy / formulas / adds / drugs / source / quote / kind / always | ❌ | ❌ |
| `drug` | 讲稿 2010 方剂（30 方） | `drugs.json` → `drugs[]` | id / name / therapy / composition / usage / science / adjustments / indication / contraindication / source / quote | ✅ | ✅ |
| `ref` | 讲义 p42 对照表（28 行） | `formula-reference.json` → `rows[]` | no / name / indication / doseId / doseBasis / draftName / draftNote | ✅ | ✅ |
| `dose` | 同和堂版成方（克）（49 方） | `doses.json` → `doses[]` | id / name / composition / notes / page | ✅ | ✅ |
| `science` | 科中（科学中药比例）（17 条） | `doses.json` → `sciences[]` | id / name / ratio / page | ✅ | ✅ |
| `sciencemap` | 科中 ↔ 成方 映射（15 项） | `doses.json` → `scienceByDoseId{}` | doseId / science | ✅ | ✅ |

**几条硬规矩**（后端强制，改不坏）：

- **方名照录**，不改写成现代教材方名（「天王芪」就还是「天王芪」）。
- **剂量单位不换算**：讲稿的比例制与同和堂版的克是两套，**不互换、不混写**。
- **没写明的就留空**：后端不会替你生成 `source`／`quote`。
- **不许凭空加字段**：注册表里没列的字段，管理员加不进去。
- 必填字段缺了 → 拒绝；枚举值不合法 → 拒绝。

---

## 3. 讲义 p44 为什么不能新增／删除（唯一的架构边界）

讲义 p44 依脉用方的**命中判定是代码**，不是数据：

```
src/content/formula-rules.json   ← 数据（每条一个 id）
src/domain/formulas.ts           ← 判定函数（EVALUATORS，id → evaluate）
```

`loadRules` 对这两边做**双向校验，缺一即抛错**：

- 数据里有、`EVALUATORS` 里没有 → 前端启动就崩（那条规则永远不命中，界面却看不出来）；
- `EVALUATORS` 里有、数据里没有 → 同样崩。

所以：

| 操作 | 行不行 | 原因 |
|---|---|---|
| 改 p44 条目的字段 | ✅ 行 | 数据与函数还是一一对应 |
| **新增** p44 条目 | ❌ 不行 | 必须同时在 `EVALUATORS` 加同名判定函数 → **那是前端改动** |
| **删除** p44 条目 | ❌ 不行 | 必须同时删 `EVALUATORS` 里那一项 → 同上 |

命令行会直接拒绝并说明原因，并给出可执行的替代：先把这条作为**讲稿方剂**（`kind=drug`）加进去 —— 那部分是纯数据。

> 覆盖层里要是**绕过命令行**混进了 p44 的新增／删除（比如手改数据库、导入外部文件），
> `library apply` 也会**拒绝写盘**，`library verify` 会点名报出来。

---

## 4. 命令

全部命令都直接读写**本机 SQLite**（不过 HTTP），所以**服务器上也能用** ——
能进这台机器的 shell，就等于管理员。

```
npm run admin -- library --help          # 完整用法
```

| 命令 | 干什么 |
|---|---|
| `list [--kind K] [--all]` | 列出覆盖层（改过的条目）。`--all` 配合 `--kind` 连基线一起列（看当前有效值） |
| `show <kind> <id>` | 看一条：基线 ＋ 覆盖层 ＋ 当前有效值，三块对照 |
| `set <kind> <id> [--file f.json \| --set k=v …] [--note "…"] [--by 管理员]` | **改**一条。按字段改，不会连带丢掉别的字段 |
| `add <kind> --file f.json [--note] [--by]` | **新增**一条（只有纯数据的类才行） |
| `del <kind> <id> [--note] [--by]` | **删**一条（写墓碑；apply 之后从结果里消失） |
| `restore <kind> <id>` | 撤销覆盖，回到内置基线 |
| `export [--kind K] [--out f.json]` | 导出覆盖层（审计／备份／搬到另一台机器） |
| `import --file f.json` | 从导出的 JSON 导入覆盖层 |
| `apply [--dry-run] [--content-dir <目录>]` | 把覆盖层合并回 `src/content/*.json`（**前端唯一能看到的出口**） |
| `verify` | 自检：覆盖层合不合规、引用有没有断、p44 边界有没有被踩到 |

### 怎么改一个字段

```bash
# 改一个字段（其余字段原样保留）
npm run admin -- library set drug xiajiao --set "composition=何首乌8、茯苓5、怀牛膝4"

# 改几个字段，并记下为什么改、谁改的
npm run admin -- library set drug xiajiao \
  --set "composition=何首乌8、茯苓5、怀牛膝4" \
  --set "indication=缓缓调养虚极的肾脏" \
  --note "剂量按讲稿 2010 重新核对" --by 张三

# 整条替换（文件里是一个完整的条目对象）
npm run admin -- library set drug xiajiao --file /tmp/xiajiao.json
```

**`--set` 的值按字段声明的类型转**，不按字面猜：`composition` 是文字，
`3` 就还是文字 `3`，不会被换成数字；`page` 是数字，`3` 就是数字 3。
数组字段用 `|` 分隔（`--set "drugs=shangjiao-1|zhongjiao"`）或直接给 JSON 数组。

### 怎么新增一条

```bash
cat > /tmp/new.json <<'JSON'
{
  "id": "test-xin-fang",
  "name": "（讲稿原名，照录）",
  "therapy": "五脏疗法",
  "composition": "茯苓5、炙甘草3",
  "indication": "（讲稿原话）",
  "source": "讲稿 2010·第N讲（讲稿方剂）",
  "quote": "「讲稿原句」"
}
JSON
npm run admin -- library add drug --file /tmp/new.json --by 张三
```

⚠️ **必填字段（`source`／`quote` 等）必须自己填** —— 后端不会替你编出处。
新条目会落进「未归类」兜底组（不会崩），五行／左右手的归类依据要另外补。

---

## 5. 改完怎么让它进前端（顺序别搞反）

```bash
# ①（如果人工在 Excel 里也改了）先把 Excel 的改动拉进 JSON，推进基线
npm run content:json

# ② 把管理员的覆盖层叠加上去 —— 这一步才写 src/content/*.json
npm run admin -- library apply --dry-run    # 先看看要改什么
npm run admin -- library apply

# ③ 重建人工编辑层（Excel），让两边对得上
npm run content:excel

# ④ 重出前端
npm run build
```

⚠️ **顺序反了会把人工还没拉进 JSON 的改动盖掉**。
`apply` 是**叠加**在「内容文件当前的样子」上的 —— 生产里那一份就是基线。

`apply` 的几条性质：

- **幂等**：同样的覆盖层 apply 两次，第二次不产生任何字节变化。
- **行尾跟随原文件**：原来 CRLF 就写 CRLF，LF 就写 LF。
- **不写多余的键**：后端不会往内容文件里塞自己的东西（写入时间戳之类）。
- **引用断了就拒绝写盘**：宁可什么都不写，也不写出半坏数据。

### 连带处理（级联）

删掉一个东西，引用它的地方按 AGENTS.md 的规矩处理 —— **宁可留空并写「未载」，不臆造**：

| 删了什么 | 连带做什么 |
|---|---|
| 讲稿方剂 | 讲义 p44 里引用它的 `drugs[]` 去掉那个 id |
| 同和堂版成方 | 讲义 p42 的 `doseId` 置空、`doseBasis` 标「未载（原 doseId=xxx 已删除）」；科中映射里那一项删掉 |
| 科中 | 科中映射里的值写成「未载」 |

---

## 6. 读接口（为将来的前端同步预留）

```
GET /api/library/overrides
→ 200 { overrides: { rule: {...}, drug: {...}, … }, meta: { count, updatedAt } }
```

- 形状：`{ [kind]: { [item_id]: { payload, deleted, updatedAt, updatedBy, note } } }`
  —— **墓碑项也返回**（`deleted: true`），否则前端合并层表达不了「这条没了」。
- 鉴权：走现有 `/api/` 中间件 → **未登录 401**；**所有登录账号都能读**
  （内容是共享的公共资料）。
- **这一轮前端不接**。它的意义是：将来无论走「重新构建」还是「运行时读接口」，
  后端都已经就位。

---

## 7. 故障排查

| 现象 | 多半是 |
|---|---|
| `✗ 合并没有通过检查，**没有写盘**` | 引用断了（悬空引用／p44 越界）。错误信息里点名了是哪一条，照着改或 `restore` 掉 |
| `✗ 讲义 p44「依脉用方」不能在这里新增／删除` | 架构边界，见 §3。想加的话先加成 `kind=drug` |
| `✗ 「xxx」不是…的可编辑字段` | 该字段不在注册表里。注册表在 `server/library-schema.mjs` 的 `LIBRARY_KINDS` |
| `✗ 缺少必填字段「source」` | 新增条目必须自己填出处 —— 后端不替你编 |
| 改了但前端没变 | 改了之后**还要** `library apply` → `content:excel` → `npm run build` → 重新部署 |
| `npm run admin -- library list` 是空的 | 覆盖层是空的 —— 知识库还是内置基线，一字未改 |

---

## 8. 相关文件

| 文件 | 是什么 |
|---|---|
| `server/library-schema.mjs` | **注册表 ＋ 校验 ＋ 合并规则** —— 后端唯一的「什么能改、什么不能改」真源 |
| `server/db.mjs` / `server/db-pg.mjs` | 两套同名同签名的存储实现（SQLite ／ CloudBase PG） |
| `server/store.mjs` | 存储分发层；契约表里写明了「知识库三函数没有 ownerId」的例外理由 |
| `server/schema.sql` / `server/schema-pg.sql` | `library_items` 表 |
| `scripts/lib/library-cli.mjs` | 命令行本体 |
| `scripts/admin.mjs` | `library` 子命令的入口 |
| `scripts/e2e/library-admin.mjs` | 端到端测试（47 项） |
| `scripts/e2e/library-admin-break-test.mjs` | break-test（7 条 mutation，逐条证明断言不是恒绿） |
