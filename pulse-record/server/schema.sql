-- 臧氏脉学 · 脉象记录表生成器 —— 病例记录库
--
-- 两级结构：
--   patients  一位受检者/患者（姓名、体例）
--   visits    该患者的一次就诊记录（日期标签 ＋ 这次的脉象符号）
--
-- 一次记录（visit）的脉象值以 JSON 存一列：
--   {"L|寸|浮": ["+"], "R|寸|沉": ["↑"]}　—— key 形如 `${hand}|${organ}|${depth}`
-- 符号用字沿用讲义原文，不做简化或替换（详见 src/domain/symbols.ts）。

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
  seq        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS visits_by_patient ON visits (patient_id, seq);
