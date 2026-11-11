-- 臧氏脉学 · 内容层 —— 版本与留痕（PostgreSQL）
--
-- ## 为什么单独一个文件
--
-- `server/content-schema.mjs` 生成的 17 张 `content_*` **数据表**，
-- DDL 是从 `src/content/schema/*.schema.json` **生成**出来的 ——
-- 不落一份手抄的 SQL 在仓库里（手抄＝第二份真源，schema 一改就漂）。
--
-- 这三张表**不是内容数据**，是发布的**账本**：
-- 「现在线上是第几版」「上一版长什么样」「谁在什么时候发了什么」。
-- 它们没有对应的内容 JSON ⇒ 不可能从 schema 生成 ⇒ 只能手写，
-- 于是单独成文件 —— 每份 DDL 只有一处来源。
--
-- ## ⭐ 它们住在**另一个 schema**（`content_meta`），不是 `content`
--
-- 原因不是洁癖，是**结构上的安全**：
--
-- 发布函数 `content_publish` 要 TRUNCATE 掉数据表（整份覆盖）。
-- 如果账本表跟数据表在同一个 schema，「哪些是数据表」就得靠一张
-- 写死的排除名单来区分 —— 将来加第 4 张账本表而忘了改名单，
-- 它就会被**当成数据表清空**（账本没了，谁发过什么就查不到了）。
--
-- 分开 schema 之后：发布函数**只碰 `content` schema**，
-- 账本表在 `content_meta` ⇒ 结构上就碰不到，不需要任何名单。
--
-- （数据表 schema `content` 里**只有** 17 张数据表 ——
--  发布函数会拿 PG 目录核对表清单，少一张多一张都会报错，见 content-pg-functions.sql。）
--
-- ## 时间戳
--
-- 用 **bigint 毫秒**，与 `server/schema-pg.sql` 的既有约定一致
-- （那边明确写了「时间戳用 bigint 毫秒，不用 timestamptz」——
--  前端 `Number(at)` 直接比较与排序，换成 timestamptz 会把毫秒数变成日期字符串）。

-- 账本 schema。**刻意**与数据表的 schema 分开，理由见上。
CREATE SCHEMA IF NOT EXISTS content_meta;

-- ── 当前版本 ────────────────────────────────────────────────────────
-- 恒定只有一行（id = 1）：内容层是**全局**的一份，不按 owner 分片。
CREATE TABLE IF NOT EXISTS content_meta.content_state (
  id            smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- 已发布到第几版。0 ＝ 还没发过。
  version       bigint  NOT NULL DEFAULT 0,
  -- 最近一次发布时间（毫秒）
  published_at  bigint,
  -- 最近一次发布人
  published_by  text,
  -- 最近一次发布的统计（每张表写进去多少行）
  summary       jsonb
);

INSERT INTO content_meta.content_state (id, version)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

-- ── 历史版本 ────────────────────────────────────────────────────────
-- 整份 payload 存下来 ⇒ 回滚 = 把某一版的 payload 再发一次（走同一条原子管道）。
-- 只保留最近 20 版（发布函数里裁剪）—— payload 约几百 KB，不能无限留。
CREATE TABLE IF NOT EXISTS content_meta.content_revisions (
  id            bigserial PRIMARY KEY,
  version       bigint NOT NULL,
  published_at  bigint NOT NULL,
  published_by  text   NOT NULL,
  -- 当时的完整发布载荷：{ order: [...], tables: { 表: [行] } }
  payload       jsonb  NOT NULL
);

CREATE INDEX IF NOT EXISTS content_revisions_by_version ON content_meta.content_revisions (version DESC);

-- ── 发布留痕 ────────────────────────────────────────────────────────
-- 每次发布/回滚记一行：谁、什么时候、第几版、写了多少行。
CREATE TABLE IF NOT EXISTS content_meta.content_audit (
  id            bigserial PRIMARY KEY,
  version       bigint NOT NULL,
  at            bigint NOT NULL,
  actor         text   NOT NULL,
  -- publish（正常发布）｜ rollback（回滚到某个历史版本）
  action        text   NOT NULL,
  summary       jsonb  NOT NULL
);

CREATE INDEX IF NOT EXISTS content_audit_by_version ON content_meta.content_audit (version DESC);
