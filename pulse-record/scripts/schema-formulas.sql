-- 方剂库 · 5 张表（2026-11-21）
--
-- 为什么是 5 张而不是 1 张：
--   一个方被多条规则引用、一条规则也命中多个方（61 条规则共 136 次引用），
--   这是多对多。压成一张表就得把方名和组成复制多份，改一处漏三处。
--
-- 表之间的关系：
--   formulas ──< formula_aliases        一个方有多个写法（讲稿/同和堂/p42/p44）
--   formulas ──< rule_formulas >── formula_rules     多对多（带原文写法）
--   formula_rules ──1:1── formula_patterns          脉象图（50 条规则有图）
--
-- 组成一律存**原文串**，不拆味：两套资料单位不同（比例制 / 克），拆了就要换算。

CREATE TABLE IF NOT EXISTS formulas (
  id                TEXT PRIMARY KEY,     -- 稳定 id：优先沿用成方 id / 讲稿 id
  name              TEXT NOT NULL,        -- 规范名
  base_name         TEXT,                 -- 基名（去限定括注）
  qualifier         TEXT,                 -- 限定（如「五脏疗法」「中焦方」）
  relation          TEXT,                 -- 同一方·组成一致 / 同方·别名写法 / 加减方 / 单套
  p42_no            INTEGER,              -- 讲义 p42 行号
  p42_indication    TEXT,                 -- 讲义 p42「对应脉象及加减」
  dose_id           TEXT,                 -- 同和堂成方 id（用于取页码／注，不用于取文字）
  composition_th    TEXT,                 -- 同和堂版 · 克（原文串）
  composition_draft TEXT,                 -- 讲稿 2010 · 比例制（原文串）
  science           TEXT,                 -- 科中（科学中药）比例（原文串）
  usage             TEXT,                 -- 服法（讲稿原文）
  adjustments       TEXT,                 -- 加减（讲稿原文）
  contraindications TEXT,                 -- 禁忌（讲稿原文）
  note              TEXT
);

CREATE TABLE IF NOT EXISTS formula_aliases (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  formula_id TEXT NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
  source     TEXT NOT NULL,               -- 讲义 p42 / 讲稿 2010 / 同和堂版 / 讲义 p44
  name       TEXT NOT NULL,
  UNIQUE (formula_id, source, name)
);

CREATE TABLE IF NOT EXISTS formula_rules (
  id      TEXT PRIMARY KEY,
  route   TEXT,
  condition TEXT,
  therapy TEXT,
  kind    TEXT,                           -- 主线 / 挡路 / 加味 / 禁忌
  wuxing  TEXT,                           -- 五行（挂在**规则**上，不是方上）
  side    TEXT,                           -- 左右手（同上）
  always  INTEGER NOT NULL DEFAULT 0,     -- 常驻条目（不依脉象）
  visible INTEGER NOT NULL DEFAULT 1,     -- 是否在知识库显示
  adds    TEXT,                           -- 添加药（原文）
  drugs   TEXT,                           -- 关联讲稿方剂 id（逗号分隔）
  source  TEXT,
  quote   TEXT
);

CREATE TABLE IF NOT EXISTS rule_formulas (
  rule_id    TEXT NOT NULL REFERENCES formula_rules(id) ON DELETE CASCADE,
  formula_id TEXT REFERENCES formulas(id),  -- 解析不到时留空，writing 照样保留
  writing    TEXT NOT NULL,                 -- 原文里的方名写法
  PRIMARY KEY (rule_id, writing)
);

CREATE TABLE IF NOT EXISTS formula_patterns (
  rule_id   TEXT PRIMARY KEY REFERENCES formula_rules(id) ON DELETE CASCADE,
  title     TEXT,
  cells     TEXT,                          -- JSON：格子（部位/取法/左右/符号）
  relations TEXT,                          -- JSON：关系判定
  source    TEXT
);

CREATE INDEX IF NOT EXISTS idx_alias_name ON formula_aliases(name);
CREATE INDEX IF NOT EXISTS idx_rule_formula ON rule_formulas(formula_id);
