# 用方知识库 · 管理员手册

> 「整个用方知识库都可以编辑」这件事的**两个写入面**。
>
> | 写入面 | 改完立刻生效吗 | 适合谁 |
> |---|---|---|
> | **网站端 ③「用方知识库」**（2026-11-12 起） | ✅ 立刻（全账号共享同一份） | 日常改一条、删一个方名标签 |
> | **命令行** `npm run admin -- library …` | ❌ 要 `library apply` → 重建 → 部署 | 批量改动、固化进基线、审计与导入导出 |
>
> 两条路改的是**同一份覆盖层**（本机／云端 SQLite 的 `library_items` 表），
> 语义**逐条对齐**（见 §6）⇒ 谁先改都不打架。
>
> 覆盖层之上还有一层「**生效层**」＝ 基线 ⊕ 覆盖层，**在前端算**
> （见 §6.4）—— 界面显示的、② 命中的、导出的，都是这一份。

---

## 1. 两层结构

```
内置基线（只读）                      管理员覆盖层（可写）
src/content/*.json                    本机／云端 SQLite 的 library_items 表
  · Excel 管线的产物                    · 一条目一行，按 (kind, item_id) 整条接管
  · 已经提交进 git                       · 墓碑（deleted=1）＝ 这条被删了
  · 前端编译期内联的就是它                · 所有账号共享同一份（公共资料）
        └──────────► library apply ◄────┘
                        │
                        ▼
              src/content/*.json（合并结果）
```

> **第三层（运行期）**：覆盖层不必 apply 就能生效 ——
> 前端把「基线 ⊕ 覆盖层」算成**生效集**，界面显示的、② 命中的、导出的都是它（§7.4）。
> apply 是**固化**（把改动写进基线），不是「生效」的前提。

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
| `rule` | 讲义 p44 依脉用方（61 条） | `formula-rules.json` → `rules[]` | id / route / condition / therapy / formulas / adds / drugs / source / quote / kind / always | ❌ | ✅ |
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

## 3. 讲义 p44：能改、能删，不能新增（唯一的架构边界）

讲义 p44 依脉用方的**命中判定是代码**，不是数据：

```
src/content/formula-rules.json   ← 数据（每条一个 id）
src/domain/formulas.ts           ← 判定函数（EVALUATORS，id → evaluate）
```

前端装载器（`loadRules`）对这两边的规矩是**刻意不对称**的：

| 方向 | 现在的行为 | 为什么 |
|---|---|---|
| 数据里有、`EVALUATORS` 里没有 | **抛错**（前端起不来） | 那条规则永远不命中，界面却看不出来 —— 这是最坏的一种坏法，宁可载入失败 |
| `EVALUATORS` 里有、数据里没有 | **跳过**（不加载） | 这是**条目被管理员删掉**之后的正常状态：判定函数作为**残留代码**留着 |

所以：

| 操作 | 行不行 | 原因 |
|---|---|---|
| 改 p44 条目的字段 | ✅ 行 | 数据与函数还是一一对应 |
| **删除** p44 条目 | ✅ 行 | 条目没了，残留的判定函数不会被加载、不命中、也不显示 —— 删干净了 |
| **新增** p44 条目 | ❌ 不行 | 要新增就得同时在 `EVALUATORS` 写判定函数 —— 那是代码，命令行补不出来 |

命令行会直接拒绝新增并说明原因，并给出可执行的替代：先把这条作为**讲稿方剂**（`kind=drug`）加进去 —— 那部分是纯数据。

> **删除之后能放回来**：墓碑行里存着**原内容快照**，所以 `library revive <kind> <id>`
> 能把删掉的条目原样放回去，**一行代码都不用改**（判定函数还在，只是没被加载）。
>
> **覆盖层里要是绕过命令行混进了 p44 的新增**（比如手改数据库、导入外部文件），
> `library apply` 也会**拒绝写盘**，`library verify` 会点名报出来 ——
> 后端是拿 `src/domain/formulas.ts` 的 `EVALUATORS` 当白名单的，
> 没有判定函数的 id 一律拦下。

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
| `restore <kind> <id>` | 撤销覆盖层里对这一条的改动（删掉那一行），回到内置基线 |
| `revive <kind> <id>` | 把**删掉的**这一条放回来（撤销「那一次删除」）—— 靠墓碑里的原内容快照 |
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

### 怎么删一条、怎么放回来

```bash
# 删一条（写墓碑；apply 之后这条从知识库里消失）
npm run admin -- library del rule fx2-yiti-lengreshui --note "这条讲稿没写清，先下线" --by 张三

# 看看现在是什么状态（墓碑会标成「已删除（墓碑）」）
npm run admin -- library list --kind rule

# 删错了 → 放回来（靠墓碑里存着的原内容快照，一字不差）
npm run admin -- library revive rule fx2-yiti-lengreshui
```

三个动作的分工（别搞混）：

| 命令 | 撤的是 | 结果 |
|---|---|---|
| `set` | — | 改内容 |
| `restore` | 覆盖层里**这一行** | 回到内置基线的样子 |
| `revive` | **那一次删除** | 把删掉的条目原样放回来 |

⚠️ `restore` 与 `revive` 的差别只在**删除已经 apply 过去**的时候才看得出：
`apply` 是写进基线的，墓碑一旦 apply 过去，基线里就没有这一条了 ——
这时候光撤墓碑（`restore`）撤不回来，得用 `revive` 把内容放回去。
命令行遇到这种情况会提示你用 `revive`。

---

## 5. 改完怎么让它进前端（顺序别搞反）

> ⚠️ 这一节说的是**命令行**那条路。**网站端 ③ 里改的不用走这套流程** ——
> 那边改完立刻生效（§7.4）；下面这套是「**把改动固化进基线**」的流程，
> 两者不冲突：想固化时才走。

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
- ✅ **2026-11-12 起前端接上了**（见 §6.4 生效层）。

---

## 7. 网站端运行时编辑（③ 里的「编辑／删除」）

2026-11-12 起，网站端 ③「用方知识库」里每一条（讲义 p44 依脉用方 61 条 ＋ 讲稿方剂 30 方）
都有「编辑」「删除」两个按钮；每个**方名标签**（chip）上有「✎ 改」「✕ 删」。

### 7.1 接口清单

| 接口 | 对应命令行 | 干什么 | 权限 |
|---|---|---|---|
| `GET /api/library/kinds` | —— | 「什么能改」的注册表（字段清单、中文标签、可选值、哪些类开放） | 登录即可 |
| `GET /api/library/overrides` | `library list` | 覆盖层原始行（含墓碑） | 登录即可 |
| `PATCH /api/library/entries/:kind/:id` | `library set --set k=v` | **改一条**（字段级；body `{ patch: {...} }`） | **仅 admin** |
| `DELETE /api/library/entries/:kind/:id` | `library del` | **删一条**（写墓碑，带原内容快照） | **仅 admin** |
| `POST /api/library/entries/:kind/:id/restore` | `library restore` | **恢复默认**（撤覆盖层这一行 → 回基线） | **仅 admin** |
| `POST /api/library/entries/:kind/:id/revive` | `library revive` | **撤销删除**（把墓碑里的快照放回来） | **仅 admin** |

⚠️ `DELETE` 是「**删除条目**」，不是「删覆盖行」—— 后者叫 `restore`。
⚠️ `restore` 与 `revive` 的分工与命令行**完全一样**（见 §4 末尾那张表）。

**字段级改**：服务端以「**当前生效的那条**」为底，把传上来的字段盖上去 ⇒
「改一个字段，其余字段一字不丢」。改 `id` 一律 400（改 id ＝ 删了重加，
而 p44 新增要配判定函数 ⇒ 本轮不开放新增）。

### 7.2 权限

- **写接口仅管理员**（`users.role === 'admin'`；单机模式下内置本机账号就是 admin）。
  非管理员**看不到**任何编辑／删除按钮 —— 是「不渲染」，不是「禁用」。
- **读接口不设闸门** —— 知识库是公共资料，不同账号看到的必须是同一份
  （否则一个设置两处真源）。未登录一律 401。

### 7.3 本轮开放的类

只有 `rule`（讲义 p44 依脉用方）与 `drug`（讲稿方剂）两类在网站端开放编辑。
其余四类（p42 对照表／同和堂版成方／科中／科中↔成方映射）接口**明确拒**，
并给出人话原因与命令行路径 —— 别让人以为「改了没反应」。

### 7.4 生效层（在前端算，不在服务端）

```
① 基线层（只读）          ② 覆盖层（可写）           ③ 生效层（运行期）
src/content/*.json        library_items 表            基线 ⊕ 覆盖层
前端编译期内联的就是它      管理员的运行时改动           前端真正显示/判读的那份
```

⭐ **③ 在前端算**（`src/domain/library-merge.mjs`），不是服务端整份下发 ——
命中判定是**代码**（`EVALUATORS`），服务端按已发布内容下发的那份里，
可能有这版代码**没有判定函数**的规则 id ⇒ 前端 `loadRules` 直接抛错 ⇒ 整站崩。
⇒ 生效集必须以「**前端自己那份基线**」为底合并 ⇒ id 永远是基线的子集。

- 合并与级联的**底层**（`mergeKind`／`cascadeCleanup`）在
  `src/domain/library-core.mjs` —— **浏览器与 `library apply` 共用同一份**
  ⇒ 网站里看到的与写进基线的，永远是同一个结果（RE10 断言盯着这件事）。
- 覆盖层里若有**基线没有的 id**（命令行手滑造的），浏览器侧**跳过并报出来**
  （命令行侧由 `library verify` 报出来）⇒ 前端不会因为陌生 id 崩。

### 7.5 不自动固化

网站端的改动**只写覆盖层**，`src/content/*.json`（仓库里的基线）**一个字节都不动**。
要把改动固化进基线，须人明确执行 `npm run admin -- library apply`（+ 重建 + 部署）。

⚠️ **小程序端不同步**：小程序不设覆盖层 store ⇒ 生效集永远是基线 ⇒
网站端改了，小程序看不到。这是**已知缺口**，记在 `docs/progress.md`。

### 7.6 确认走站内确认框（不用 `window.confirm`）

删除条目、恢复默认这两步要问一句 —— 用的是**站内确认框**
（`src/components/ConfirmDialog.tsx`，样式沿用编辑器那套 `pr-ps-modal`／`pr-ed-foot`）。

ⓘ **为什么不用 `window.confirm`**：原生弹窗在 **Electron 桌面端**会把整个渲染进程
**冻住** —— 点了按钮，页面就再也不响应，连刷新都救不回来，只能重启应用。
浏览器里它只是弹个框，但同一份代码要跑两种端 ⇒ 一律用站内的。

ⓘ **一处**：删除条目（`FormulaLibrary.tsx`）、知识库条目恢复默认（`LibraryEditor.tsx`）、
脉象图恢复默认（`PatternEditor.tsx`）三处都 import 它 ⇒ 确认框的样子和措辞只有一个来源。

ⓘ RE14 断言盯着这件事（先剥注释再看代码）：源码里不许再出现 `window.confirm`，
三处都要 import 并渲染 `ConfirmDialog`。

---

## 8. 故障排查

| 现象 | 多半是 |
|---|---|
| `✗ 合并没有通过检查，**没有写盘**` | 引用断了（悬空引用／p44 越界）。错误信息里点名了是哪一条，照着改或 `restore` 掉 |
| `✗ 讲义 p44「依脉用方」不能在这里新增` | 架构边界，见 §3。想加的话先加成 `kind=drug` |
| `✗ 「xxx」的墓碑里没有原内容快照，放不回来` | 这一条在删之前就没有存下内容（比如老版本留下的墓碑）。只能手工 `add` 回去 |
| `✗ 「xxx」不是…的可编辑字段` | 该字段不在注册表里。注册表在 `server/library-schema.mjs` 的 `LIBRARY_KINDS` |
| `✗ 缺少必填字段「source」` | 新增条目必须自己填出处 —— 后端不替你编 |
| 删了之后 `restore` 撤不回来 | `restore` 撤的是「覆盖层这一行」；已经被 apply 写掉的条目要用 `revive` 放回来 |
| 改了但前端没变 | **命令行**那条路：改了之后**还要** `library apply` → `content:excel` → `npm run build` → 重新部署 |
| 网站端 ③ 改了，刷新后又变回去 | 刷新会重新拉覆盖层 —— 那一条多半被**恢复默认**过（覆盖层里没有它了 ⇒ 回基线） |
| 网站端 ③ 看不到「编辑／删除」按钮 | 当前账号不是管理员（`users.role === 'admin'`）；单机模式下本机账号就是 admin |
| 网站端 ③ 改完报「只有管理员能改」 | 同上 —— 写接口仅 admin，读接口人人可读（知识库是公共资料） |
| 网站端 ③ 里某条不见了 | `npm run admin -- library list --kind rule` —— 它可能被**删掉**了（墓碑），用 `revive` 放回来 |
| `npm run admin -- library list` 是空的 | 覆盖层是空的 —— 知识库还是内置基线，一字未改 |
| 点了「删除／恢复默认」之后整个页面卡死 | 代码里又出现了 `window.confirm` —— 原生弹窗在 Electron 桌面端会冻住整个渲染进程。改用 `ConfirmDialog`（RE14 断言盯着） |

---

## 9. 相关文件

| 文件 | 是什么 |
|---|---|
| `server/library-schema.mjs` | **注册表 ＋ 校验 ＋ 合并规则** —— 后端唯一的「什么能改、什么不能改」真源 |
| `server/library-service.mjs` | **网站端运行时编辑的服务层**（PATCH／DELETE／restore／revive 四个动词） |
| `server/db.mjs` / `server/db-pg.mjs` | 两套同名同签名的存储实现（SQLite ／ CloudBase PG） |
| `server/store.mjs` | 存储分发层；契约表里写明了「知识库三函数没有 ownerId」的例外理由 |
| `server/schema.sql` / `server/schema-pg.sql` | `library_items` 表 |
| `src/domain/library-core.mjs` | **合并与级联的共享纯逻辑**（浏览器与命令行共用同一份） |
| `src/domain/library-merge.mjs` | 浏览器侧的**生效集**合并（基线 ⊕ 覆盖层） |
| `src/domain/library-chips.mjs` | 方名标签（chip）的改／删（纯函数） |
| `src/state/library.tsx` | 前端的装载 ＋ 四个动词（落库成功后才刷新生效集） |
| `src/components/LibraryEditor.tsx` | ③ 里的条目编辑弹层（表单由注册表驱动） |
| `scripts/lib/library-cli.mjs` | 命令行本体 |
| `scripts/admin.mjs` | `library` 子命令的入口 |
| `scripts/e2e/library-admin.mjs` | 端到端测试（61 项） |
| `scripts/e2e/library-admin-break-test.mjs` | break-test（12 条 mutation，逐条证明断言不是恒绿） |
| `scripts/e2e/library-runtime-edit.mjs` | 端到端测试（14 项）：网站端运行时编辑（RE1~RE13） |
| `scripts/e2e/library-runtime-edit-break-test.mjs` | break-test（7 条 mutation）：证明上一条不是恒绿 |
| `scripts/e2e/rule-delete-loader.mjs` | 端到端测试（13 项）：删掉一条 p44 条目之后，前端装载器照样起得来 |
| `scripts/e2e/rule-delete-loader-break-test.mjs` | break-test（2 条 mutation）：证明上一条不是恒绿 |
