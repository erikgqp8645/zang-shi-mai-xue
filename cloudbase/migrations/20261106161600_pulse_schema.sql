-- 臧氏脉学 · 病例记录库（PostgreSQL 版）
-- 时间戳统一 bigint 毫秒；owner_id 用 text

CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,
  login_name    text NOT NULL UNIQUE,
  display_name  text NOT NULL,
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
  provider    text NOT NULL,
  external_id text NOT NULL,
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

CREATE TABLE IF NOT EXISTS patients (
  id         text PRIMARY KEY,
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
  owner_id   text NOT NULL,
  label      text NOT NULL,
  at         bigint NOT NULL,
  pulse_values text NOT NULL,
  seq        integer NOT NULL,
  constitution text,
  therapy     text,
  FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS visits_by_owner ON visits (owner_id, patient_id, seq);
CREATE INDEX IF NOT EXISTS visits_by_patient ON visits (patient_id, seq);

CREATE TABLE IF NOT EXISTS medication (
  id         text PRIMARY KEY,
  patient_id text NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  visit_id   text NOT NULL REFERENCES visits (id) ON DELETE CASCADE,
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
  owner_id   text NOT NULL,
  name       text NOT NULL,
  created_at bigint NOT NULL,
  PRIMARY KEY (owner_id, code),
  FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS symbols_by_owner ON custom_symbols (owner_id);
