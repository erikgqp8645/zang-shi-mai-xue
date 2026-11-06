-- 臧氏脉学 · 一次性数据迁移函数（**搬完就撤**）
--
-- ⚠️ **迁移完成后请把这个函数删掉**：
--    它能绕过 owner 校验批量写表，长期留在生产库等于开了一个后门。
--    删法（两种都行）：
--      node scripts/migrate-sqlite-to-pg.mjs --drop-fn
--      node scripts/pg-admin.mjs exec "DROP FUNCTION IF EXISTS pulse_migrate_import(text, jsonb)"
--
-- 为什么单独一个文件：运行时函数集（server/pg-functions.sql）要保持干净 ——
-- 里面的 35 个函数是**线上业务路径**，这里的东西只在搬数据时用一次。
--
-- 用法：
--   1) 搬数据（脚本会自动检查并部署本文件）：
--        node scripts/migrate-sqlite-to-pg.mjs
--   2) 想单独部署：
--        node scripts/pg-admin.mjs run server/pg-migrate-functions.sql
--
-- ── 设计 ──────────────────────────────────────────────────────────────
-- · **一次 RPC ＝ 一个事务**：函数体整体在一个事务里跑，要么全进要么全不进。
-- · **id 由调用方决定**：SQLite 的 id 原样搬过去（`ON CONFLICT DO NOTHING`
--   兜底），只有「PG 已有同登录名的账号」才由调用方重映射 owner_id。
-- · **顺序按外键依赖**：users → identities → sessions → patients → visits
--   → medication → custom_symbols。FK 在 PG 里永远生效，顺序错了直接报错。
-- · **返回值是 jsonb 对象**：postgREST 对标量返回与 SQL NULL 不给 body，
--   一律包成对象（这是本仓库所有 PG 函数的统一约定）。

CREATE OR REPLACE FUNCTION pulse_migrate_import(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_row      jsonb;
  v_users    jsonb := COALESCE(p_args->'users',          '[]'::jsonb);
  v_idents   jsonb := COALESCE(p_args->'identities',     '[]'::jsonb);
  v_sessions jsonb := COALESCE(p_args->'sessions',       '[]'::jsonb);
  v_patients jsonb := COALESCE(p_args->'patients',       '[]'::jsonb);
  v_visits   jsonb := COALESCE(p_args->'visits',         '[]'::jsonb);
  v_meds     jsonb := COALESCE(p_args->'medication',     '[]'::jsonb);
  v_symbols  jsonb := COALESCE(p_args->'custom_symbols', '[]'::jsonb);
  -- 调用方给的 id 清单，用来核对「源行数 = 迁后行数」
  v_ids      jsonb := COALESCE(p_args->'ids',            '{}'::jsonb);
BEGIN
  -- ── users ───────────────────────────────────────────────────────────
  FOR v_row IN SELECT jsonb_array_elements(v_users) LOOP
    INSERT INTO users (id, login_name, display_name, phone, password_hash, password_salt,
                       role, created_at, updated_at)
    VALUES (v_row->>'id', v_row->>'login_name', v_row->>'display_name', v_row->>'phone',
            v_row->>'password_hash', v_row->>'password_salt',
            COALESCE(NULLIF(v_row->>'role', ''), 'user'),
            COALESCE((v_row->>'created_at')::bigint, 0),
            COALESCE((v_row->>'updated_at')::bigint, 0))
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- ── identities ──────────────────────────────────────────────────────
  FOR v_row IN SELECT jsonb_array_elements(v_idents) LOOP
    INSERT INTO identities (id, user_id, provider, external_id, union_id, created_at)
    VALUES (v_row->>'id', v_row->>'user_id', v_row->>'provider', v_row->>'external_id',
            v_row->>'union_id', COALESCE((v_row->>'created_at')::bigint, 0))
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- ── sessions ────────────────────────────────────────────────────────
  FOR v_row IN SELECT jsonb_array_elements(v_sessions) LOOP
    INSERT INTO sessions (token, user_id, created_at, expires_at, last_seen_at, user_agent)
    VALUES (v_row->>'token', v_row->>'user_id',
            COALESCE((v_row->>'created_at')::bigint, 0),
            COALESCE((v_row->>'expires_at')::bigint, 0),
            COALESCE((v_row->>'last_seen_at')::bigint, 0),
            v_row->>'user_agent')
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- ── patients ────────────────────────────────────────────────────────
  FOR v_row IN SELECT jsonb_array_elements(v_patients) LOOP
    INSERT INTO patients (id, owner_id, name, layout, created_at, updated_at)
    VALUES (v_row->>'id', v_row->>'owner_id', v_row->>'name', v_row->>'layout',
            COALESCE((v_row->>'created_at')::bigint, 0),
            COALESCE((v_row->>'updated_at')::bigint, 0))
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- ── visits ──────────────────────────────────────────────────────────
  FOR v_row IN SELECT jsonb_array_elements(v_visits) LOOP
    INSERT INTO visits (id, patient_id, owner_id, label, at, pulse_values, seq,
                        constitution, therapy)
    VALUES (v_row->>'id', v_row->>'patient_id', v_row->>'owner_id', v_row->>'label',
            COALESCE((v_row->>'at')::bigint, 0), v_row->>'pulse_values',
            COALESCE((v_row->>'seq')::integer, 0),
            v_row->>'constitution', v_row->>'therapy')
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- ── medication ──────────────────────────────────────────────────────
  FOR v_row IN SELECT jsonb_array_elements(v_meds) LOOP
    INSERT INTO medication (id, patient_id, visit_id, owner_id, seq, name, pulse, symbols,
                            adjust, usage, note, created_at)
    VALUES (v_row->>'id', v_row->>'patient_id', v_row->>'visit_id', v_row->>'owner_id',
            COALESCE((v_row->>'seq')::integer, 0), v_row->>'name', v_row->>'pulse',
            v_row->>'symbols', v_row->>'adjust', v_row->>'usage', v_row->>'note',
            COALESCE((v_row->>'created_at')::bigint, 0))
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- ── custom_symbols（主键是 (owner_id, code)，不是单列 id）────────────
  FOR v_row IN SELECT jsonb_array_elements(v_symbols) LOOP
    INSERT INTO custom_symbols (code, owner_id, name, created_at)
    VALUES (v_row->>'code', v_row->>'owner_id', v_row->>'name',
            COALESCE((v_row->>'created_at')::bigint, 0))
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object(
    -- 源（SQLite 侧读出来的行数）
    'source', jsonb_build_object(
      'users',          jsonb_array_length(v_users),
      'identities',     jsonb_array_length(v_idents),
      'sessions',       jsonb_array_length(v_sessions),
      'patients',       jsonb_array_length(v_patients),
      'visits',         jsonb_array_length(v_visits),
      'medication',     jsonb_array_length(v_meds),
      'custom_symbols', jsonb_array_length(v_symbols)),
    -- 迁后 PG 里「能对上源行的行数」（含本来就有的行）
    --
    -- ⚠️ users / identities 用**自然键**（login_name、provider+external_id）比，
    --    不用 id —— 「PG 已有同登录名的账号」那种情况下，SQLite 那边那个账号
    --    不重复建、id 也对不上，但行确实在（只是换了 id）。
    'migrated', jsonb_build_object(
      'users', (SELECT count(*) FROM users u
                 WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_users) s
                               WHERE s->>'login_name' = u.login_name)),
      'identities', (SELECT count(*) FROM identities i
                 WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_idents) s
                               WHERE s->>'provider' = i.provider
                                 AND s->>'external_id' = i.external_id)),
      'sessions', (SELECT count(*) FROM sessions s
                 WHERE s.token IN (SELECT jsonb_array_elements_text(COALESCE(v_ids->'sessions', '[]'::jsonb)))),
      'patients', (SELECT count(*) FROM patients p
                 WHERE p.id IN (SELECT jsonb_array_elements_text(COALESCE(v_ids->'patients', '[]'::jsonb)))),
      'visits', (SELECT count(*) FROM visits v
                 WHERE v.id IN (SELECT jsonb_array_elements_text(COALESCE(v_ids->'visits', '[]'::jsonb)))),
      'medication', (SELECT count(*) FROM medication m
                 WHERE m.id IN (SELECT jsonb_array_elements_text(COALESCE(v_ids->'medication', '[]'::jsonb)))),
      'custom_symbols', (SELECT count(*) FROM custom_symbols cs
                 WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_symbols) s
                               WHERE s->>'owner_id' = cs.owner_id AND s->>'code' = cs.code))),
    -- PG 里的总行数（含迁之前就有的）
    'totals', jsonb_build_object(
      'users',          (SELECT count(*) FROM users),
      'identities',     (SELECT count(*) FROM identities),
      'sessions',       (SELECT count(*) FROM sessions),
      'patients',       (SELECT count(*) FROM patients),
      'visits',         (SELECT count(*) FROM visits),
      'medication',     (SELECT count(*) FROM medication),
      'custom_symbols', (SELECT count(*) FROM custom_symbols)),
    -- 三条 owner 不变量自检（必须全为 0）
    'invariants', jsonb_build_object(
      'visit_owner_mismatch', (SELECT count(*) FROM visits v
        JOIN patients p ON p.id = v.patient_id WHERE v.owner_id <> p.owner_id),
      'medication_owner_mismatch', (SELECT count(*) FROM medication m
        JOIN visits v ON v.id = m.visit_id WHERE m.owner_id <> v.owner_id),
      'empty_owner', (SELECT count(*) FROM custom_symbols
        WHERE owner_id IS NULL OR owner_id = '')));
END $$;
