-- 臧氏脉学 · 脉象记录表生成器 —— 病例记录库
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

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS patients (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  layout     TEXT NOT NULL CHECK (layout IN ('nine', 'seven')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS visits (
  id         TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  at         INTEGER NOT NULL,
  pulse_values TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  -- 使用者**自判**的体质（讲义 p47「①判体质」：肾虚／上盛下虚／平和）；NULL＝未判
  constitution TEXT,
  -- 使用者**自选**的疗法（讲义 p47「②定疗法」：三焦疗法／五脏疗法／一体疗法）；NULL＝未定
  therapy     TEXT
);

CREATE INDEX IF NOT EXISTS visits_by_patient ON visits (patient_id, seq);

CREATE TABLE IF NOT EXISTS medication (
  id         TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  visit_id   TEXT NOT NULL REFERENCES visits (id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  name       TEXT NOT NULL,
  pulse      TEXT,
  symbols    TEXT,
  adjust     TEXT,
  usage      TEXT,
  note       TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS medication_by_patient ON medication (patient_id, visit_id, seq);

CREATE TABLE IF NOT EXISTS custom_symbols (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
