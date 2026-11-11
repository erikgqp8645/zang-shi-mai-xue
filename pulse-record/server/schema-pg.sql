-- 臧氏脉学 · 脉象记录表生成器 —— 病例记录库（PostgreSQL 版）
--
-- 与 server/schema.sql（SQLite 版）**一一对应**，只换方言：
--
--   SQLite            →  PostgreSQL
--   ------------------    ---------------------
--   INTEGER（时间戳）  →  bigint      （毫秒，**不用 timestamptz**）
--   TEXT              →  text
--   REAL              →  double precision
--   INTEGER PRIMARY KEY AUTOINCREMENT → text primary key
--
-- 三条硬规矩（与 SQLite 版一致）：
--   1. `owner_id` 用 **text**（不是 uuid）—— 我们自己的 id 就是 TEXT，
--      CloudBase PG 的 auth.uid() 也是 text，两边正好对上。
--   2. 时间戳用 **bigint 毫秒** —— 前端 `Number(at)` 直接比较与排序，
--      换成 timestamptz 会把「毫秒数」变成「日期字符串」，排序语义会坏。
--   3. `custom_symbols` 主键是 **(owner_id, code)** —— 自定义符号按人隔离。
--
-- 建表顺序：users → identities → sessions → patients → visits → medication
--           → custom_symbols（外键有依赖，顺序不能乱）。
--
-- 索引与 SQLite 版一致（SQLite 版把它们放在 migrate() 里是因为老库要 ALTER；
-- PG 是全新库，直接建）。

-- ── 账号与归属 ──────────────────────────────────────────────────────
-- users        一个「人」＝一个账号（网站与小程序共用同一行）
-- identities   账号上挂的登录身份：password（登录名）／wechat（openid）／local（单机）
-- sessions     登录态（不透明随机令牌，可吊销）

CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,
  -- 登录名：11 位手机号，或 4~20 位字母/数字/下划线。唯一。
  login_name    text NOT NULL UNIQUE,
  display_name  text NOT NULL,
  -- 手机号（可空）：预留给将来的短信验证码等能力，本期不作登录凭证
  phone         text UNIQUE,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  role          text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    bigint NOT NULL,
  updated_at    bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS identities (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- password（登录名）／wechat（openid）／local（单机内置账号）
  provider    text NOT NULL,
  -- provider 下的唯一标识：password→login_name；wechat→openid；local→'local'
  external_id text NOT NULL,
  -- 微信 unionid（小程序绑了开放平台才有），可空
  union_id    text,
  created_at  bigint NOT NULL,
  UNIQUE (provider, external_id)
);

CREATE INDEX IF NOT EXISTS identities_by_user ON identities (user_id, provider);

CREATE TABLE IF NOT EXISTS sessions (
  token        text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   bigint NOT NULL,
  expires_at   bigint NOT NULL,
  last_seen_at bigint NOT NULL,
  user_agent   text
);

CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions (user_id);

-- ── 业务数据 ────────────────────────────────────────────────────────
-- patients / visits / medication / custom_symbols 四张表都带 owner_id，
-- 指向拥有这些数据的人（users 表）。父子表（patient → visit → medication）
-- 的 owner_id 在父子间保持一致，启动时会自检这条不变量。

CREATE TABLE IF NOT EXISTS patients (
  id         text PRIMARY KEY,
  -- 归属：这条患者记录属于哪个账号
  owner_id   text NOT NULL,
  name       text NOT NULL,
  layout     text NOT NULL CHECK (layout IN ('nine', 'seven')),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS patients_by_owner ON patients (owner_id, updated_at);

CREATE TABLE IF NOT EXISTS visits (
  id         text PRIMARY KEY,
  patient_id text NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  -- 归属：与所属患者一致（启动时自检）
  owner_id   text NOT NULL,
  label      text NOT NULL,
  at         bigint NOT NULL,
  -- 一次记录的脉象值以 JSON 存一列：
  --   {"L|寸|浮": ["+"], "R|寸|沉": ["↑"]}  —— key 形如 `${hand}|${organ}|${depth}`
  -- 符号用字沿用讲义原文，不做简化或替换（详见 src/domain/symbols.ts）。
  pulse_values text NOT NULL,
  seq        integer NOT NULL,
  -- 使用者**自判**的体质（讲义 p47「①判体质」：肾虚／上盛下虚／平和）；NULL＝未判
  constitution text,
  -- 使用者**自选**的疗法（讲义 p47「②定疗法」：三焦疗法／五脏疗法／一体疗法）；NULL＝未定
  therapy     text,
  FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS visits_by_owner ON visits (owner_id, patient_id, seq);
CREATE INDEX IF NOT EXISTS visits_by_patient ON visits (patient_id, seq);

CREATE TABLE IF NOT EXISTS medication (
  id         text PRIMARY KEY,
  patient_id text NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  visit_id   text NOT NULL REFERENCES visits (id) ON DELETE CASCADE,
  -- 归属：与所属就诊一致（启动时自检）
  owner_id   text NOT NULL,
  seq        integer NOT NULL,
  name       text NOT NULL,
  pulse      text,
  symbols    text,
  adjust     text,
  usage      text,
  note       text,
  created_at bigint NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS medication_by_owner ON medication (owner_id, patient_id, visit_id, seq);
CREATE INDEX IF NOT EXISTS medication_by_patient ON medication (patient_id, visit_id, seq);

CREATE TABLE IF NOT EXISTS custom_symbols (
  code       text NOT NULL,
  -- 归属：自定义符号是使用者自建的，按人隔离
  owner_id   text NOT NULL,
  name       text NOT NULL,
  created_at bigint NOT NULL,
  PRIMARY KEY (owner_id, code),
  FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS symbols_by_owner ON custom_symbols (owner_id);

-- ── 方剂脉象图（覆盖层）──────────────────────────────────────────────
-- 内置基线在 src/content/pulse-patterns.json（Excel 管线产出，只读）。
-- 这里只存「使用者手改过的条目」：一条目一行，按 (owner_id, formula_id) 整条接管 ——
-- 该键下有行就用这几行，没有就回落到内置基线。
CREATE TABLE IF NOT EXISTS formula_patterns (
  owner_id   text    NOT NULL,
  -- FormulaRule.id，如 'fx-dl2-zuoguan-fuwu'
  formula_id text    NOT NULL,
  -- 同一方剂下第几张（0 起，就是显示顺序）
  seq        integer NOT NULL,
  -- 一张图的完整 JSON：{ title, layout, cells, groups, relations, note, source, origin }
  payload    jsonb   NOT NULL,
  updated_at bigint  NOT NULL,
  PRIMARY KEY (owner_id, formula_id, seq),
  FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS formula_patterns_by_owner ON formula_patterns (owner_id);
