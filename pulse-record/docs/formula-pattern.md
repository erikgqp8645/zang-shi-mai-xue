# 方剂脉象图：显示与手工编辑

> 需求来源：维护者要求「方剂需要附上脉象图，方剂后面加编辑按钮，手动填写，一个方剂可以对应几种脉象」。
> 本页是**规格**，不是进度记录。实施进度见 [`progress.md`](./progress.md)。

---

## 0. 一句话

把已经写好但从未显示的 50 条脉象图**画到方剂条目上**，并给每一条加一个可增删改的编辑器，
一个方剂可挂多张图；手改内容存服务端覆盖层，不写回 `src/content/*.json`。

---

## 1. 现状核实（先看这三条，工作量判断会不一样）

| # | 事实 | 证据 |
|---|---|---|
| 1 | 61 条用方条目里，**50 条已有脉象图数据**（39 条有具体格位，20 条只有关系注记，有重叠） | `src/content/pulse-patterns.json`（34KB） |
| 2 | 编译时已经挂到规则上 | `src/domain/formulas.ts` L154 `const pattern = patterns[r.id]` |
| 3 | **但没有任何组件读过 `hit.pattern`** —— 界面上一张都没画过 | 全仓搜 `PATTERNS`／`syntheticContext`，除 `pulse-pattern.ts` 自身外零命中 |

所以这不是从零做：**第一步「把图显示出来」成本极低、收益最大**。

另外两条会约束设计：

- `FormulaRule.pattern` 是**单数**（`pattern?: PulsePattern`）。要支持「几种脉象」必须变成数组。
- 图的格子里存的是**术语**（`term`，如「浮大」「变脉无力」），术语再展开成一组允许符号
  （`src/content/pulse-terms.json`，18 个用字，实际用到 11 个）。手动填写若直接填符号，
  会与术语层形成两套语义 —— 已决定用「符号为主、术语降级为预设」（见 §2）。

### 1.1 为什么手改不能写回 JSON

`pulse-patterns.json` 是 **Excel 管线的产物**：

```
content/臧氏脉学-用方知识库.xlsx  ──excel_to_json──▶  src/content/*.json  ──import──▶  src/domain/*.ts
        （矩阵 sheet，tab 名 = P序号-图名）
```

`scripts/excel_to_json.py` L360 起从「脉象图矩阵 sheet」还原，`--check` 模式还会逐字段比对。
若界面手改直接写回该 JSON，下次 `npm run content:json` 就会**无声盖掉**；
反过来，界面若能覆盖 Excel 的内容，则管线唯一的真源被破坏。

结论：**两层数据**。内置 JSON 是只读基线，界面编辑写进服务端覆盖层（§3）。

---

## 2. 已定决策

| 决策点 | 结论 |
|---|---|
| 挂载对象 | **用方条目**（`FormulaRule.id`，61 条）。条件是脉象，天然对应；不挂在讲稿方剂卡上 |
| 保存位置 | **服务端**（与病例数据同一套，不用浏览器 localStorage） |
| 格内填写 | **直接填符号**（`0 / - / + / ++ / ↑ / | / X / #`…）；术语作为「一键预设」按钮 |
| 一张 or 多张 | **多张**，每张有 `label`、`layout`、格位、关系注记、备注、出处 |

---

## 3. 数据模型

### 3.1 覆盖层（新增）

```sql
CREATE TABLE IF NOT EXISTS formula_patterns (
  owner_id   TEXT    NOT NULL,
  formula_id TEXT    NOT NULL,      -- FormulaRule.id，如 'fx-dl2-zuoguan-fuwu'
  seq        INTEGER NOT NULL,      -- 0 起的显示顺序
  payload    TEXT    NOT NULL,      -- JSON：见 PatternEntry
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, formula_id, seq),
  FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);
```

### 3.2 合并规则（只有一条，别复杂化）

```
有覆盖 → 只用覆盖层这几张（整条接管，基线不再显示）
无覆盖 → 用内置基线
```

**整条接管**而不是逐张合并，原因：逐张合并说不清「我删掉了基线第 2 张」该怎么表达
（要有墓碑位）。整条接管让删除天然成立（覆盖里不放它），也让「恢复默认」= `DELETE` 一行。

代价（**必须写进界面提示**）：某条目一旦被手改，就不再跟随上游 Excel 的更新。

### 3.3 PatternEntry（`payload` 的形状）

```ts
interface PatternEntry {
  label?: string                 // 「浮大版」「兼尺弱」；空则显示「脉象 1」
  layout?: LayoutMode            // 缺省 'nine'
  cells: CellRequirement[]       // 复用现有类型：{ cell, term?, codes?, note?, flex? }
  groups?: string[][]            // AND 组，组间为「或」
  relations?: PatternRelation[]  // 画不成单格的关系要求
  note?: string
  source?: string
  origin: 'text' | 'manual'      // 来自讲义原文 / 手工补录 —— 界面区分，便于回查
}
```

> `codes` 是本次新增的可选字段：手填符号直接落在这里；有 `term` 而无 `codes` 的老数据
> 仍按术语展开 —— 这样 50 条基线**一行都不用改**。

### 3.4 接口（照 `custom_symbols` 的写法）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/formula-patterns` | `{ overrides: { [formulaId]: PatternEntry[] } }` |
| PUT | `/api/formula-patterns/:formulaId` | 整条替换该条目的图列表 |
| DELETE | `/api/formula-patterns/:formulaId` | 撤销覆盖，回到基线 |

按 `owner_id` 隔离；跨用户一律 404（与现有约定一致）。PG 侧需同步加表与函数，
**改完要重新部署云函数**才在线上生效。

---

## 4. 界面

### 4.1 卡片上的图（`PatternStrip`）

在 `FormulaItem` 里、方剂 chip 之后渲染：

- 每张图一个**缩略图**（约 132×108），点一下放大到弹层（完整 9 行矩阵）。
- 右上角按钮显示张数：「脉象图 ③」，点开编辑抽屉。
- 关系型条目（20 条没有格位）**不能画成空表** —— 会像坏掉。
  这类画成**注记卡**：显示 `relations[].kind` 与 `text` 的首行，底部署「关系示意」。
- 手填条目（`origin: 'manual'`）加一个小标记，与原文转录区分开。

### 4.2 编辑抽屉（`PatternEditor`）

```
┌───────────────┬──────────────────────────────────┐
│ 该方剂的图列表 │  选中那张的矩阵编辑器              │
│ ① 浮大版    ▲▼ │  部位｜取法｜左｜右                │
│ ② 兼尺弱    ▲▼ │  （点格 → 符号面板 / 键盘 / 双击）  │
│ + 新增        │  备注 / 出处 / 关系注记            │
│               │  [取消] [保存]                     │
└───────────────┴──────────────────────────────────┘
```

- 新增时可「复制当前这张」——一张图 9 行改两格，比从空白开始快。
- 排序用 ▲▼（不做拖拽，拖拽在小屏上容易误触）。
- 编辑期全部在内存里，点「保存」才 PUT；「取消」丢弃。整抽屉一步撤销。
- 矩阵编辑器需要**放大版**：编辑列宽 72／88、行高 44（显示用 54／66／40 太窄，点不准）。
  两套尺寸共用同一份 `groupRows()`，不另画一套体例。

### 4.3 填写

- 点格 → 右侧符号面板（沿用 `SymbolPalette` 的分组 chip），再点一次取消该符号。
- 键盘：`0 - = + u \ x #`，方向键移动，Backspace 清格。
- 术语预设条：一行 chip（无／弱／有／有力／浮大／洪大／顶手／变脉无力…），点一下＝把该术语的
  `codes` 全填进格（多码表示「或」）。填进去仍是符号，**格子里不存术语**。
- 一格里多符号的顺序按 `parseCodes()` 归一化，与录脉一致。

---

## 5. 验收

| # | 断言 | 怎么验 |
|---|---|---|
| 1 | 用方知识库展开后，50 条基线可见图（现在 0 条） | 人工点数 |
| 2 | 给同一方剂挂到 3 张，卡片显示 3 张、顺序可调、刷新后仍在 | 人工 |
| 3 | 删除基线中某张 → 剩几张就显示几张，刷新不回魂 | 人工 |
| 4 | 恢复默认 → 回到基线张数 | 人工 |
| 5 | 跨账号看不到彼此的覆盖（404） | `scripts/e2e/auth-isolation.mjs` 同款 |
| 6 | 手改**不影响**规则命中结果 | `npm run test:e2e:core` 不变 |
| 7 | 关系型条目渲染成注记卡而非空表 | 人工看 20 条中的 2 条 |

---

## 6. 明确不做

- **不改判定**。手填的脉象图只是示意，不参与 `evaluate` 命中，不改 `formulas.ts` 的任何判定函数。
- 不做图片上传、手绘、贴图。
- 不做分享／公开链接。
- 不做「脉象图 → 自动生成条件文字」这类反向推导。
- 不改 `pulse-patterns.json` 的格式（只允许新增可选字段 `codes`）。
- **不接小程序端**。本期只在网站端显示与编辑；小程序「用方」页暂不显示脉象图。
  前端界面「各写一套」是既定路线（`taro-migration.md` §0.1），`PatternSheet` 虽符合下沉条件，
  但没有需求就不提前抽。

---

## 7. 分步实施

| 步 | 内容 | 验收 |
|---|---|---|
| S1 | 只读显示：`PatternSheet`（矩阵）＋ `PatternStrip`（缩略图／注记卡），接进 `FormulaItem` | 验收 1、7 |
| S2 | 多图模型：加载层把单 `pattern` 包成数组（JSON 不动） | 卡片显示张数；类型检查过 |
| S3 | 持久化：表＋3 条 API＋`src/api/patterns.ts`＋合并层 | 验收 2、3、4、5、6 |
| S4 | 编辑抽屉：符号面板＋术语预设＋增删排序＋保存/取消 | 验收 2 |
| S5 | 测试与文档：e2e 覆盖合并与隔离，`content-layer.md` 补「界面覆盖层」一节 | 全绿 |

S1 独立可交付 —— 只做它，也能立刻看到 50 条图。

---

## 8. 实施记录（2026-11-11）

### 8.1 做到哪一步

| 步 | 状态 |
|---|---|
| S1 只读显示（`PatternSheet` / `PatternStrip`） | ✅ 50 条全部能渲染（39 张有格位、11 张关系型） |
| S2 多图模型（`pattern` → `patterns[]`） | ✅ 加载时把单张包成数组，JSON 一行没改 |
| S3 持久化（表 ＋ 3 条 API ＋ 合并层） | ✅ SQLite 全通；✅ 云端 PG 已部署并跑通（见 8.3） |
| S4 编辑抽屉（符号面板／术语预设／增删排序） | ✅ `PatternEditor` |
| S5 测试与文档 | ✅ `npm run test:e2e:patterns`（11 项）＋ 本页 |

### 8.2 与本文档原设计的两处偏差

**① 空列表需要「接管标记行」**

原设计写「删除 = 覆盖里不放它」，漏了一种情况：**把某个方剂的图全部删掉**。
那样覆盖层里一行都不剩，读回来等于「没改过」→ 静默回落到基线，刚删的图又出现。
现在空列表会写一行 `seq = -1`、payload `{"__takeover__":true}` 的标记，
读取时它只负责让这个键「出现过」，返回**空数组**。

**② 编辑器格子用输入框，而不是「点格弹面板」**

`TTT`、`DDX` 这类多字符码用点选很别扭。改成每格一个输入框：点进去直接敲，
下面的符号条只是「追加」的快捷方式。归一（`parseCodes`）放在**失焦与保存**两处 ——
边打边解析会在打到 `T` 时就把 `TTT` 吃掉。

### 8.3 云端 PG 部署（已执行）

2026-11-11 用 CloudBase CLI 在 `pulse-1-d0g880ydl8ddc57f6` 上执行完毕：

| 事项 | 结果 |
|---|---|
| `formula_patterns` 表 ＋ `formula_patterns_by_owner` 索引 | ✅ 5 列（owner_id / formula_id / seq / payload jsonb / updated_at） |
| 3 个 plpgsql 函数 | ✅ `pulse_list/put/delete_formula_patterns`，云端函数总数 35 → **38** |
| SQL 层冒烟 | ✅ 写两张 → 读回 2；清空 → 键仍在、值是 `[]`；撤销 → 键消失 |
| 云函数 `pulse-api` 重新部署 | ✅ Event / Nodejs20.19 / `index.main`，环境变量 5 个一个没丢 |
| 网关 `https://pulse-1-d0g880ydl8ddc57f6-1257312696.ap-shanghai.app.tcloudbase.com/pulse-api` | ✅ `/api/health` 返回 `db: CloudBase PostgreSQL`；`/api/formula-patterns` 未登录 401（不是 404） |
| 真实网关闭环（`scripts/e2e/cloud-smoke.mjs`） | ✅ 10/10 |

执行方式（`tcb db execute` 支持多语句，注意 `$$` 别被 shell 展开）：

```bash
export PATH="$HOME/.workbuddy/binaries/node/cli-connector-packages/bin:$PATH"
SQL=$(cat /tmp/pulse_formula_patterns_pg.sql)     # 建表 ＋ 三函数
tcb db execute -e pulse-1-d0g880ydl8ddc57f6 --sql "$SQL"
```

**部署云函数时的一个坑**：`tcb fn deploy --install-dependency false` 并**不会**上传本地
`node_modules`，函数起来直接 `ERR_MODULE_NOT_FOUND: @cloudbase/node-sdk`。
改成 `--install-dependency true`（Nodejs20.19 支持云端装依赖）才正常。

下面的原始 SQL 保留备查。

**建表**（等价于 `server/schema-pg.sql` 末尾那段）

```sql
CREATE TABLE IF NOT EXISTS formula_patterns (
  owner_id   text    NOT NULL,
  formula_id text    NOT NULL,
  seq        integer NOT NULL,
  payload    jsonb   NOT NULL,
  updated_at bigint  NOT NULL,
  PRIMARY KEY (owner_id, formula_id, seq),
  FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS formula_patterns_by_owner ON formula_patterns (owner_id);
```

**三个函数**（`server/pg-functions.sql` 末尾，原样执行）

```sql
CREATE OR REPLACE FUNCTION pulse_list_formula_patterns(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_object_agg(f.formula_id, COALESCE(t.entries, '[]'::jsonb)), '{}'::jsonb)
    FROM (SELECT DISTINCT formula_id FROM formula_patterns WHERE owner_id = p_owner) f
    LEFT JOIN (
      SELECT formula_id, jsonb_agg(payload ORDER BY seq) AS entries
      FROM formula_patterns WHERE owner_id = p_owner AND seq >= 0
      GROUP BY formula_id
    ) t ON t.formula_id = f.formula_id
  );
END $$;

CREATE OR REPLACE FUNCTION pulse_put_formula_patterns(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_formula text  := coalesce(p_args->>'formulaId', '');
  v_entries jsonb := coalesce(p_args->'patterns', '[]'::jsonb);
  v_now     bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
BEGIN
  IF v_formula = '' OR jsonb_typeof(v_entries) <> 'array' THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  IF jsonb_array_length(v_entries) > 20 THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  DELETE FROM formula_patterns WHERE owner_id = p_owner AND formula_id = v_formula;
  IF jsonb_array_length(v_entries) = 0 THEN
    INSERT INTO formula_patterns (owner_id, formula_id, seq, payload, updated_at)
    VALUES (p_owner, v_formula, -1, '{"__takeover__": true}'::jsonb, v_now);
  ELSE
    INSERT INTO formula_patterns (owner_id, formula_id, seq, payload, updated_at)
    SELECT p_owner, v_formula, (t.ord - 1)::integer, t.value, v_now
    FROM jsonb_array_elements(v_entries) WITH ORDINALITY AS t(value, ord);
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION pulse_delete_formula_patterns(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_formula text := coalesce(p_args->>'formulaId', '');
  v_count   integer;
BEGIN
  DELETE FROM formula_patterns WHERE owner_id = p_owner AND formula_id = v_formula;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_count > 0);
END $$;
```

**改完 SQL 之后必须重新部署云函数 `pulse-api`** —— 三条新路由在函数包里，
不重部署的话云端仍是旧代码（`/api/formula-patterns` 返回 404）：

```bash
node scripts/build-cloudfunction.mjs
tcb fn deploy pulse-api --dir .cloudfn/pulse-api --force --install-dependency true -e pulse-1-d0g880ydl8ddc57f6
```

### 8.4 两套编辑面怎么共存

| 改什么 | 在哪改 | 会不会被覆盖 |
|---|---|---|
| 内置的 50 张基线（转录原文） | Excel 矩阵 sheet → `npm run content:json` | — |
| 网页上手动填／改的 | 方剂卡上的「编辑」 | 不会（存 `formula_patterns`，不写 JSON） |

⚠️ 某条目一旦在网页上改过，就**不再跟随** Excel 里这块基线的新内容。
想重新跟随：点「恢复默认」，覆盖层删除，回落基线。

### 8.5 CloudBase CLI 连不上新环境的坑（记一次）

CLI 在 `/Users/applemima1111/.workbuddy/binaries/node/cli-connector-packages/bin/tcb`
（`@cloudbase/cli`）。切换到 `pulse-1-d0g880ydl8ddc57f6` 后，`tcb env list` 仍然报：

```
✖ [DescribeBillingInfo] Env `ambitious-parrot-d7ehh7x0fd9d680` Not Exists
```

改 `.cloudbase/project.json`、加 `-e`、加 `-r ap-shanghai` **都没用**。
真正的原因是**登录凭据里也存了一份 envId**：

```
~/.config/.cloudbase/auth.json   →  credential.envId
```

里面是旧环境 id，CLI 拿它去查计费信息，于是一路 404。改掉这一行就通了
（凭据本身没过期，`credential.expired` 是毫秒时间戳）。同理，若凭据过期，
`tcb login` 会重新走一遍授权。

常用命令备忘：

| 干什么 | 命令 |
|---|---|
| 看环境 | `tcb env list -r ap-shanghai` |
| 跑 SQL（支持多语句） | `tcb db execute -e <envId> --sql "..."` |
| 看函数列表 | `tcb fn list -e <envId>` |
| 直接调函数看报错 | `tcb fn invoke pulse-api -e <envId> --params '{"path":"/api/health","httpMethod":"GET"}' --json` |
| 备份／核对环境变量 | `tcb fn env pull pulse-api -e <envId> --output-file <路径>` |
| 看网关路由 | `tcb routes list -e <envId>` |

⚠️ `tcb fn deploy --force` **不会**冲掉环境变量（实测 5 个变量部署前后完全一致），
但 `--install-dependency false` 也不会把本地 `node_modules` 带上去 —— 见 8.3 那个坑。
