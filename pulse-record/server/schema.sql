-- 臧氏脉学 · 脉象记录表生成器 —— 病例记录库（多用户版）
--
-- 两级结构：
--   patients  一位受检者/患者（姓名、体例）
--   visits    该患者的一次就诊记录（日期标签 ＋ 这次的脉象符号）
--
-- 一次记录（visit）的脉象值以 JSON 存一列：
--   {"L|寸|浮": ["+"], "R|寸|沉": ["↑"]}　—— key 形如 `${hand}|${organ}|${depth}`
-- 符号用字沿用讲义原文，不做简化或替换（详见 src/domain/symbols.ts）。
--
-- custom_symbols 是使用者自建的符号（如「涩」记作 S）：
-- 讲义 p33–34 的固定符号集之外另加，与固定符号并列使用，代码不得与固定符号重复。
--
-- medication 是「用药记录」：使用者自己填实际用的是什么方、加减与服法。
-- 一次就诊（visit）可挂多条方（对服、并行、上中下焦分服等）。
-- 表内只是使用者的记录，工具不替使用者加减方、不下诊断。
-- pulse 是对应脉象的**文字**表述；symbols 是对应脉象的**符号**表述
-- （JSON，key 同 visits.pulse_values：`手|部位|取法`，值为符号代码数组）——
-- 两者并存，同一处用药可同时记文字与符号。
--
-- ── 账号与归属（多用户） ────────────────────────────────────────────
-- users / identities / sessions 三张表管账号：
--   users        一个「人」＝一个账号（网站与小程序共用同一行）
--   identities   账号上挂的登录身份：password（登录名）／wechat（openid）／local（单机）
--   sessions     登录态（不透明随机令牌，可吊销）
--
-- owner_id 是**数据归属**：patients / visits / medication / custom_symbols
-- 四张业务表都带 owner_id，指向拥有这些数据的人。
-- 四张表互为父子（patient → visit → medication），owner_id 在父子间保持一致，
-- 启动时会自检这条不变量（见 server/db.mjs 的 migrate()）。
-- 读写的每一处都按 owner_id 过滤；跨用户访问一律当作「不存在」（404，不泄露存在性）。

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  -- 登录名：11 位手机号，或 4~20 位字母/数字/下划线。唯一。
  login_name    TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  -- 手机号（可空）：预留给将来的短信验证码等能力，本期不作登录凭证
  phone         TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS identities (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- password（登录名）／wechat（openid）／local（单机内置账号）
  provider    TEXT NOT NULL,
  -- provider 下的唯一标识：password→login_name；wechat→openid；local→'local'
  external_id TEXT NOT NULL,
  -- 微信 unionid（小程序绑了开放平台才有），可空
  union_id    TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE (provider, external_id)
);

CREATE INDEX IF NOT EXISTS identities_by_user ON identities (user_id, provider);

CREATE TABLE IF NOT EXISTS sessions (
  token        TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent   TEXT
);

CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS patients (
  id         TEXT PRIMARY KEY,
  -- 归属：这条患者记录属于哪个账号
  owner_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  layout     TEXT NOT NULL CHECK (layout IN ('nine', 'seven')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);

-- 依赖 owner_id 的索引在 server/db.mjs 的 migrate() 里建：
-- 老库要先 ALTER TABLE 补上 owner_id 列，才能建这些索引。

CREATE TABLE IF NOT EXISTS visits (
  id         TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  -- 归属：与所属患者一致（启动时自检）
  owner_id   TEXT NOT NULL,
  label      TEXT NOT NULL,
  at         INTEGER NOT NULL,
  pulse_values TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  -- 使用者**自判**的体质（讲义 p47「①判体质」：肾虚／上盛下虚／平和）；NULL＝未判
  constitution TEXT,
  -- 使用者**自选**的疗法（讲义 p47「②定疗法」：三焦疗法／五脏疗法／一体疗法）；NULL＝未定
  therapy     TEXT,
  FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS visits_by_patient ON visits (patient_id, seq);

CREATE TABLE IF NOT EXISTS medication (
  id         TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  visit_id   TEXT NOT NULL REFERENCES visits (id) ON DELETE CASCADE,
  -- 归属：与所属就诊一致（启动时自检）
  owner_id   TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  name       TEXT NOT NULL,
  pulse      TEXT,
  symbols    TEXT,
  adjust     TEXT,
  usage      TEXT,
  note       TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS medication_by_patient ON medication (patient_id, visit_id, seq);

CREATE TABLE IF NOT EXISTS custom_symbols (
  code       TEXT NOT NULL,
  -- 归属：自定义符号是使用者自建的，按人隔离
  owner_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, code),
  FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);

-- 方剂脉象图的**覆盖层**（使用者手填，按人隔离）
--
-- 内置基线在 src/content/pulse-patterns.json（内容层快照，只读）。
-- 这里只存「改过的那些条目」，一条目一行序：按 (owner_id, formula_id) 整条接管 ——
-- 只要这个键下有行，就用这几行；没有，就回落到内置基线。
-- 删除某个条目 ＝ 没有行（DELETE 即回到基线）；删其中一张 ＝ 不写那一行 seq。
CREATE TABLE IF NOT EXISTS formula_patterns (
  owner_id   TEXT NOT NULL,
  -- FormulaRule.id，如 'fx-dl2-zuoguan-fuwu'
  formula_id TEXT NOT NULL,
  -- 同一方剂下第几张（0 起，就是显示顺序）
  seq        INTEGER NOT NULL,
  -- 一张图的完整 JSON：{ title, layout, cells, groups, relations, note, source, origin }
  payload    TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, formula_id, seq),
  FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);

-- 依赖 owner_id 的索引（patients_by_owner / visits_by_owner / medication_by_owner /
-- symbols_by_owner）在 server/db.mjs 的 migrate() 里建：
-- 老库要先 ALTER TABLE 补上 owner_id 列，才能建这些索引。

-- 用方知识库 · 管理员覆盖层（全局共享，不按账号隔离）
--
-- 内置基线在 src/content/*.json（内容层快照，只读）。
-- 这里只存**管理员改过的那些条目**：一条目一行，按 (kind, item_id) 整条接管 ——
--   · 有行且 deleted=0 → 用这一行的 payload 整条替换基线条目
--   · 有行且 deleted=1 → 墓碑：该条目在结果里消失
--   · 没有行           → 保持内置基线
-- 为什么要墓碑：覆盖层是「有行就用覆盖层」，若删除只表现为「没有行」，
-- 读回来就等于「没改过」→ 静默回落到基线，管理员刚删的条目又冒出来。
--
-- ⚠️ 这张表**没有 owner_id**，是 store.mjs「ownerId 必填」硬规则的**有意例外**：
--   用方知识库是**公共资料**不是个人数据 —— 管理员改一次，所有账号看到同一份
--   （用户 2026-11-11 拍板：多人模式下所有账号共享一份）。
CREATE TABLE IF NOT EXISTS library_items (
  -- 种类：rule | drug | ref | dose | science | sciencemap
  -- （注册表见 server/library-schema.mjs 的 LIBRARY_KINDS）
  kind        TEXT    NOT NULL,
  -- 基线条目的主键。ref 用 no 的字符串形式（如 '1'），sciencemap 用成方 id
  item_id     TEXT    NOT NULL,
  -- 该条目的完整 JSON（新增条目的 payload 即其全部内容）
  payload     TEXT    NOT NULL,
  -- 1 = 墓碑（这条被删了，apply 时从结果里消失）
  deleted     INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  -- 谁改的（审计；默认 'cli'）
  updated_by  TEXT    NOT NULL DEFAULT 'cli',
  -- 管理员备注（为什么改这一条）
  note        TEXT,
  PRIMARY KEY (kind, item_id)
);
