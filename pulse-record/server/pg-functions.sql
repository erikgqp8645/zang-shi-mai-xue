-- 臧氏脉学 · 脉象记录表生成器 —— PostgreSQL 侧数据访问函数
--
-- ## 为什么把 SQL 下沉到 PG
--
-- 存储层是「换后端只改一处」（见 server/store.mjs）。SQLite 版是
-- `db.prepare(sql).run/get/all` 的**字符串 SQL**，PG 版没法照抄同一套 API
-- （postgREST 的 builder 不支持任意 SQL、没有原生事务）。
--
-- 所以 PG 版把**每个动作写成一个 PG 函数**：
--   · 事务由 PG 保证（一次 RPC ＝ 一个事务，异常自动回滚）→ 「整份覆盖」语义是原子的
--   · JS 侧只发 JSON，不写 SQL → 不会出现方言漂移
--   · 语义与 server/db.mjs **一一对应**，可以逐条比对
--
-- ## 签名约定
--
-- 所有函数统一 `(p_owner text, p_args jsonb)`：
--   · 数据域的 p_owner ＝ 数据归属账号（**只认它**，请求体里的 owner 一律忽略）
--   · 鉴权域用不上 owner，填空串即可
--
-- ## 返回形状（与 SQLite 版一致，前端/小程序直接消费）
--
--   patient     { id, name, layout, at, visits: [ { id, label, at, values, constitution, therapy } ] }
--   listPatients 元素 { id, name, layout, visitCount, at }
--   searchPatients 元素 { id, name, layout, visitCount, at, matchType, matchedVisits: [ { id, label, at } ] }
--   visit       { id, label, at, values, constitution, therapy, patientId }
--   medication  { id, patientId, visitId, name, pulse, symbols, adjust, usage, note, createdAt }
--   symbol      { code, name }
--   user        { id, loginName, displayName, phone, role }
--
-- **两个字段是「JSON 字符串」而不是对象**：`values`（脉象格值）与 `symbols`（用药对应脉象）。
-- 它们的规整逻辑（把小程序视图层压过的 {"0":"X"} 还原成数组）在 JS 侧
-- server/values.mjs —— PG 只负责存取，**不做形状规整**。
--
-- ── 规整在哪儿做 ───────────────────────────────────────────────────
-- SQLite 版：db.mjs 的 normalizeValues() 在**写库前**规整、读出后再规整一次。
-- PG 版：写库前由 JS 侧（db-pg.mjs）用同一份 normalizeValues 规整后发过来；
--         读出时再规整一次（老的脏数据照样读得对）。
-- 两边共用 server/values.mjs，**不会漂移**。

-- ============================================================================
-- 数据域
-- ============================================================================

-- 患者列表（含就诊次数与最近一次记录时间），按最近记录时间倒序
CREATE OR REPLACE FUNCTION pulse_list_patients(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', p.id,
             'name', p.name,
             'layout', p.layout,
             'visitCount', COALESCE(cnt.n, 0),
             'at', COALESCE(cnt.last_at, p.updated_at)
           ) ORDER BY COALESCE(cnt.last_at, p.updated_at) DESC), '[]'::jsonb)
    FROM patients p
    LEFT JOIN (
      SELECT patient_id, count(*) AS n, max(at) AS last_at
      FROM visits WHERE owner_id = p_owner GROUP BY patient_id
    ) cnt ON cnt.patient_id = p.id
    WHERE p.owner_id = p_owner
  );
END $$;

-- 搜索：姓名包含关键字，或某次就诊的日期标签包含关键字，
--       或该次脉象里出现过该符号（如「↑」「X」）
-- 命中口径与 SQLite 版 searchPatients 一致；matchType：name / visit
CREATE OR REPLACE FUNCTION pulse_search_patients(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_kw   text := trim(coalesce(p_args->>'q', ''));
  v_out  jsonb := '[]'::jsonb;
  r      record;
  v      record;
  v_name_hit boolean;
  v_hits  jsonb;
  v_count bigint;
  v_last  bigint;
BEGIN
  -- 无关键字：列出全部，每项 matchType='all'
  IF v_kw = '' THEN
    FOR r IN
      SELECT p.id, p.name, p.layout, p.updated_at,
             COALESCE(cnt.n, 0) AS n, cnt.last_at
      FROM patients p
      LEFT JOIN (
        SELECT patient_id, count(*) AS n, max(at) AS last_at
        FROM visits WHERE owner_id = p_owner GROUP BY patient_id
      ) cnt ON cnt.patient_id = p.id
      WHERE p.owner_id = p_owner
      ORDER BY COALESCE(cnt.last_at, p.updated_at) DESC
    LOOP
      v_out := v_out || jsonb_build_object(
        'id', r.id, 'name', r.name, 'layout', r.layout,
        'visitCount', r.n, 'at', COALESCE(r.last_at, r.updated_at),
        'matchType', 'all', 'matchedVisits', '[]'::jsonb);
    END LOOP;
    RETURN v_out;
  END IF;

  FOR r IN SELECT id, name, layout, updated_at FROM patients WHERE owner_id = p_owner LOOP
    v_name_hit := position(v_kw in r.name) > 0;
    v_hits := '[]'::jsonb;
    FOR v IN
      SELECT id, label, at, pulse_values FROM visits
      WHERE patient_id = r.id AND owner_id = p_owner ORDER BY seq, at
    LOOP
      IF position(v_kw in v.label) > 0 OR position(v_kw in v.pulse_values) > 0 THEN
        v_hits := v_hits || jsonb_build_object('id', v.id, 'label', v.label, 'at', v.at);
      END IF;
    END LOOP;

    SELECT count(*), max(at) INTO v_count, v_last
    FROM visits WHERE patient_id = r.id AND owner_id = p_owner;

    IF v_name_hit OR jsonb_array_length(v_hits) > 0 THEN
      v_out := v_out || jsonb_build_object(
        'id', r.id, 'name', r.name, 'layout', r.layout,
        'visitCount', v_count,
        'at', COALESCE(v_last, r.updated_at),
        'matchType', CASE WHEN v_name_hit THEN 'name' ELSE 'visit' END,
        'matchedVisits', v_hits);
    END IF;
  END LOOP;

  -- 按最近记录时间倒序
  RETURN (
    SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'at')::bigint DESC), '[]'::jsonb)
    FROM jsonb_array_elements(v_out) AS e
  );
END $$;

-- 一位患者 ＋ 其全部就诊记录（只取该 owner 名下的）；不属于该 owner → null
CREATE OR REPLACE FUNCTION pulse_get_patient(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  SELECT id, name, layout, updated_at INTO r
  FROM patients WHERE id = p_args->>'id' AND owner_id = p_owner;

  IF NOT FOUND THEN RETURN jsonb_build_object('found', false, 'patient', NULL); END IF;

  RETURN jsonb_build_object('found', true, 'patient', jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'layout', r.layout,
    'at', COALESCE(
      (SELECT max(at) FROM visits WHERE patient_id = r.id AND owner_id = p_owner),
      r.updated_at),
    'visits', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id, 'label', v.label, 'at', v.at,
               'values', v.pulse_values,
               'constitution', v.constitution, 'therapy', v.therapy)
             ORDER BY v.seq, v.at)
      FROM visits v WHERE v.patient_id = r.id AND v.owner_id = p_owner
    ), '[]'::jsonb)
  ));
END $$;

-- 一次就诊记录；不属于该 owner → null
CREATE OR REPLACE FUNCTION pulse_get_visit(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT id, label, at, pulse_values, constitution, therapy, patient_id INTO r
  FROM visits v WHERE v.id = p_args->>'id' AND v.owner_id = p_owner;

  IF NOT FOUND THEN RETURN jsonb_build_object('found', false, 'visit', NULL); END IF;

  RETURN jsonb_build_object('found', true, 'visit', jsonb_build_object(
    'id', r.id, 'label', r.label, 'at', r.at,
    'values', r.pulse_values,
    'constitution', r.constitution, 'therapy', r.therapy,
    'patientId', r.patient_id));
END $$;

-- 存一位患者及其就诊记录（整份覆盖语义）：
--   · patients 行不存在则新建，存在则更新
--   · 已存在的 visit（同 id）更新；新 visit 插入；本次没有的旧 visit 删除
--   · 已存在但属于别人的 visit —— 不碰
--   · 用药记录整份覆盖（挂在本次的 visits 上）
--   · id 已存在但属于别人 —— 绝不覆盖，当作不存在（返回 null）
CREATE OR REPLACE FUNCTION pulse_put_patient(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_patient jsonb := coalesce(p_args->'patient', p_args);
  v_now    bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_id     text;
  v_layout text;
  v_name   text;
  v_owner_of text;
  v_vid    text;
  v_vowner text;
  v_keep_visits text[] := ARRAY[]::text[];
  v_item   jsonb;
  v_ord    bigint;
BEGIN
  v_id := coalesce(nullif(v_patient->>'id', ''),
                   'p' || substr(md5(random()::text || clock_timestamp()::text), 1, 10));
  v_layout := CASE WHEN v_patient->>'layout' = 'seven' THEN 'seven' ELSE 'nine' END;
  v_name := coalesce(nullif(v_patient->>'name', ''), '未命名');

  -- id 已存在但属于别人 —— 绝不覆盖，当作不存在
  SELECT owner_id INTO v_owner_of FROM patients WHERE id = v_id;
  IF v_owner_of IS NOT NULL AND v_owner_of <> p_owner THEN
    RETURN jsonb_build_object('patient', NULL);
  END IF;

  INSERT INTO patients (id, owner_id, name, layout, created_at, updated_at)
  VALUES (v_id, p_owner, v_name, v_layout, v_now, v_now)
  ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name, layout = EXCLUDED.layout, updated_at = EXCLUDED.updated_at;

  -- 就诊记录（一个循环搞定：生成 id、写入、记 keep、编 seq —— 必须在同一个循环里，
  -- 否则「新 visit」在第二次循环里会拿到**另一个**随机 id，seq 就落空了）
  FOR v_item, v_ord IN
    SELECT value, ord FROM jsonb_array_elements(coalesce(v_patient->'visits', '[]'::jsonb))
    WITH ORDINALITY AS t(value, ord)
  LOOP
    v_vid := coalesce(nullif(v_item->>'id', ''),
                       'v' || substr(md5(random()::text || clock_timestamp()::text), 1, 10));

    -- 已存在但属于别人的 visit —— 不碰
    SELECT owner_id INTO v_vowner FROM visits WHERE id = v_vid;
    IF v_vowner IS NOT NULL AND v_vowner <> p_owner THEN CONTINUE; END IF;

    INSERT INTO visits (id, patient_id, owner_id, label, at, pulse_values, seq, constitution, therapy)
    VALUES (
      v_vid, v_id, p_owner,
      coalesce(v_item->>'label', ''),
      CASE WHEN (v_item->>'at') ~ '^-?[0-9]+$' THEN (v_item->>'at')::bigint ELSE v_now END,
      coalesce(v_item->>'values', '{}'),
      (v_ord - 1),
      v_item->>'constitution',
      v_item->>'therapy'
    )
    ON CONFLICT (id) DO UPDATE SET
      label = EXCLUDED.label, at = EXCLUDED.at,
      pulse_values = EXCLUDED.pulse_values, patient_id = EXCLUDED.patient_id,
      owner_id = EXCLUDED.owner_id, constitution = EXCLUDED.constitution,
      therapy = EXCLUDED.therapy, seq = EXCLUDED.seq;

    v_keep_visits := array_append(v_keep_visits, v_vid);
  END LOOP;

  -- 本次没有的旧记录：删掉（患者级编辑语义）
  DELETE FROM visits
  WHERE patient_id = v_id AND owner_id = p_owner
    AND NOT (id = ANY(v_keep_visits));

  -- 用药记录：整份覆盖（挂在本次的 visits 上；被删掉的 visit 其用药随之级联删除）
  -- 走 pulse_write_medication —— 与 putVisit / putMedication 同一套写入逻辑，不重复实现
  PERFORM pulse_write_medication(p_owner, jsonb_build_object(
    'patientId', v_id,
    'visitId', '',
    'rows', coalesce(v_patient->'medications', '[]'::jsonb)
  ));

  RETURN jsonb_build_object('patient',
    pulse_get_patient(p_owner, jsonb_build_object('id', v_id))->'patient');
END $$;

-- 只改某一次就诊记录（单次编辑语义，不动该患者的其它次）
CREATE OR REPLACE FUNCTION pulse_put_visit(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_cur    jsonb;
  v_patient_id text;
  v_patch  jsonb := coalesce(p_args->'patch', p_args);
  v_label  text;
  v_values text;
  v_at     bigint;
  v_const  text;
  v_therapy text;
  v_has_const boolean;
  v_has_therapy boolean;
  v_now    bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
BEGIN
  v_cur := pulse_get_visit(p_owner, jsonb_build_object('id', p_args->>'id'))->'visit';
  IF v_cur IS NULL THEN RETURN jsonb_build_object('visit', NULL); END IF;
  v_patient_id := v_cur->>'patientId';

  v_label := CASE WHEN v_patch ? 'label' AND jsonb_typeof(v_patch->'label') = 'string'
                  THEN v_patch->>'label' ELSE v_cur->>'label' END;
  -- values：JS 侧发的是**规整后的 JSON 字符串**；也兼容直接发对象
  -- （`->>` 对 jsonb 对象返回它的 JSON 文本，对字符串返回字符串本身）
  v_values := CASE
    WHEN jsonb_typeof(v_patch->'values') = 'string' THEN v_patch->>'values'
    WHEN jsonb_typeof(v_patch->'values') = 'object'  THEN v_patch->>'values'
    ELSE v_cur->>'values'
  END;
  v_at := CASE WHEN (v_patch->>'at') ~ '^-?[0-9]+$'
               THEN (v_patch->>'at')::bigint ELSE (v_cur->>'at')::bigint END;
  -- 体质与疗法：patch 里带了这两个键就按给的写（可以是 null＝清除），没带就保持原值
  v_has_const := v_patch ? 'constitution';
  v_has_therapy := v_patch ? 'therapy';
  v_const := CASE WHEN v_has_const THEN v_patch->>'constitution' ELSE v_cur->>'constitution' END;
  v_therapy := CASE WHEN v_has_therapy THEN v_patch->>'therapy' ELSE v_cur->>'therapy' END;

  UPDATE visits SET label = v_label, pulse_values = v_values, at = v_at,
                    constitution = v_const, therapy = v_therapy
  WHERE id = p_args->>'id' AND owner_id = p_owner;

  UPDATE patients SET updated_at = v_now WHERE id = v_patient_id AND owner_id = p_owner;

  -- 用药：只写回这一次的（该患者其它次的用药不动）
  IF jsonb_typeof(p_args->'medications') = 'array' THEN
    PERFORM pulse_write_medication(p_owner, jsonb_build_object(
      'patientId', v_patient_id,
      'visitId', p_args->>'id',
      'rows', p_args->'medications'
    ));
  END IF;

  RETURN jsonb_build_object('visit',
    pulse_get_visit(p_owner, jsonb_build_object('id', p_args->>'id'))->'visit');
END $$;

-- 只改患者姓名
CREATE OR REPLACE FUNCTION pulse_rename_patient(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_now bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
BEGIN
  UPDATE patients
  SET name = coalesce(nullif(p_args->>'name', ''), '未命名'), updated_at = v_now
  WHERE id = p_args->>'id' AND owner_id = p_owner;
  RETURN jsonb_build_object('patient',
    pulse_get_patient(p_owner, jsonb_build_object('id', p_args->>'id'))->'patient');
END $$;

-- 只改患者的体例（7 脉点 / 9 行）——**只改体例，不动格值**
CREATE OR REPLACE FUNCTION pulse_update_patient_layout(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_now bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
BEGIN
  IF p_args->>'layout' NOT IN ('nine', 'seven') THEN
    RETURN jsonb_build_object('patient', NULL);
  END IF;
  UPDATE patients SET layout = p_args->>'layout', updated_at = v_now
  WHERE id = p_args->>'id' AND owner_id = p_owner;
  RETURN jsonb_build_object('patient',
    pulse_get_patient(p_owner, jsonb_build_object('id', p_args->>'id'))->'patient');
END $$;

-- 删一次就诊记录
CREATE OR REPLACE FUNCTION pulse_delete_visit(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  DELETE FROM visits WHERE id = p_args->>'id' AND owner_id = p_owner;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', n > 0);
END $$;

-- 删一位患者（连带其就诊记录与用药）
CREATE OR REPLACE FUNCTION pulse_delete_patient(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  DELETE FROM patients WHERE id = p_args->>'id' AND owner_id = p_owner;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', n > 0);
END $$;

-- 某位患者的全部用药记录（按就诊顺序、组内顺序）
CREATE OR REPLACE FUNCTION pulse_list_medication(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', m.id, 'patientId', m.patient_id, 'visitId', m.visit_id,
             'name', m.name, 'pulse', coalesce(m.pulse, ''),
             'symbols', coalesce(m.symbols, '{}'),
             'adjust', coalesce(m.adjust, ''), 'usage', coalesce(m.usage, ''),
             'note', coalesce(m.note, ''), 'createdAt', m.created_at)
           ORDER BY m.visit_id, m.seq, m.created_at), '[]'::jsonb)
    FROM medication m
    WHERE m.patient_id = p_args->>'patientId' AND m.owner_id = p_owner
  );
END $$;

-- 某一次就诊的用药记录
CREATE OR REPLACE FUNCTION pulse_list_visit_medication(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', m.id, 'patientId', m.patient_id, 'visitId', m.visit_id,
             'name', m.name, 'pulse', coalesce(m.pulse, ''),
             'symbols', coalesce(m.symbols, '{}'),
             'adjust', coalesce(m.adjust, ''), 'usage', coalesce(m.usage, ''),
             'note', coalesce(m.note, ''), 'createdAt', m.created_at)
           ORDER BY m.seq, m.created_at), '[]'::jsonb)
    FROM medication m
    WHERE m.visit_id = p_args->>'visitId' AND m.owner_id = p_owner
  );
END $$;

-- 写一批用药记录（**由调用方控制事务边界**，见 pulse_write_medication）
--   · 同 id 更新；新 id 插入；库里多出来、本次没有的删除
--   · visitId 传 null 表示整位患者覆盖；传具体 id 表示只覆盖那一次就诊
--   · owner_id 一律由 p_owner 决定
CREATE OR REPLACE FUNCTION pulse_write_medication(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_patient_id text := p_args->>'patientId';
  v_visit_id   text := p_args->>'visitId';   -- 空串表示整位患者覆盖
  v_rows       jsonb := coalesce(p_args->'rows', '[]'::jsonb);
  v_now        bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_row        jsonb;
  v_id         text;
  v_vid        text;
  v_name       text;
  v_pulse      text;
  v_symbols   text;
  v_adjust     text;
  v_usage      text;
  v_note       text;
  v_owner_of   text;
  v_exists     boolean;
  v_seq        integer;
  v_seqmap     jsonb := '{}'::jsonb;
  v_keep       text[] := ARRAY[]::text[];
BEGIN
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_rows) LOOP
    v_id := coalesce(nullif(v_row->>'id', ''),
                      'm' || substr(md5(random()::text || clock_timestamp()::text), 1, 10));
    v_vid := coalesce(nullif(v_row->>'visitId', ''), v_visit_id);
    v_name := trim(coalesce(v_row->>'name', ''));
    v_pulse := trim(coalesce(v_row->>'pulse', ''));
    v_adjust := trim(coalesce(v_row->>'adjust', ''));
    v_usage := trim(coalesce(v_row->>'usage', ''));
    v_note := trim(coalesce(v_row->>'note', ''));
    v_symbols := coalesce(v_row->>'symbols', '{}');

    -- 整行全空才丢（只填了「对应脉象」或只填加减，也是使用者的记录，不能静默消失）
    IF v_name = '' AND v_pulse = '' AND v_adjust = '' AND v_usage = '' AND v_note = ''
       AND v_symbols = '{}' THEN
      CONTINUE;
    END IF;

    -- 外键保护：跳过指向不存在（或不属于该患者）就诊记录的用药
    IF v_visit_id <> '' THEN
      SELECT true INTO v_exists FROM visits WHERE id = v_vid;
    ELSE
      SELECT true INTO v_exists FROM visits
      WHERE id = v_vid AND patient_id = v_patient_id AND owner_id = p_owner;
    END IF;
    IF NOT FOUND THEN CONTINUE; END IF;

    -- 已存在但属于别人的用药记录 —— 不碰
    SELECT owner_id INTO v_owner_of FROM medication WHERE id = v_id;
    IF v_owner_of IS NOT NULL AND v_owner_of <> p_owner THEN CONTINUE; END IF;

    -- 组内序号：同一次就诊内按传入顺序编号
    v_seq := coalesce((v_seqmap->>v_vid)::integer, 0);
    v_seqmap := jsonb_set(v_seqmap, v_vid, to_jsonb(v_seq + 1));

    INSERT INTO medication (id, patient_id, visit_id, owner_id, seq, name, pulse, symbols,
                            adjust, usage, note, created_at)
    VALUES (v_id, v_patient_id, v_vid, p_owner, v_seq, v_name, v_pulse, v_symbols,
            v_adjust, v_usage, v_note, v_now)
    ON CONFLICT (id) DO UPDATE SET
      visit_id = EXCLUDED.visit_id, seq = EXCLUDED.seq, owner_id = EXCLUDED.owner_id,
      name = EXCLUDED.name, pulse = EXCLUDED.pulse, symbols = EXCLUDED.symbols,
      adjust = EXCLUDED.adjust, usage = EXCLUDED.usage, note = EXCLUDED.note;

    v_keep := array_append(v_keep, v_id);
  END LOOP;

  -- 本次没有的旧用药：删掉（整份覆盖语义）
  IF v_visit_id <> '' THEN
    DELETE FROM medication WHERE visit_id = v_visit_id AND owner_id = p_owner
      AND NOT (id = ANY(v_keep));
  ELSE
    DELETE FROM medication WHERE patient_id = v_patient_id AND owner_id = p_owner
      AND NOT (id = ANY(v_keep));
  END IF;

  RETURN jsonb_build_object('kept', to_jsonb(v_keep));
END $$;

-- 写一位患者的用药记录（整份覆盖语义）
CREATE OR REPLACE FUNCTION pulse_put_medication(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pulse_write_medication(p_owner, jsonb_build_object(
    'patientId', p_args->>'patientId',
    'visitId', '',
    'rows', coalesce(p_args->'rows', '[]'::jsonb)
  ));
  RETURN jsonb_build_object('medication',
    pulse_list_medication(p_owner, jsonb_build_object('patientId', p_args->>'patientId')));
END $$;

-- 只改某一次就诊的用药（单次编辑语义，不动该患者的其它次）
CREATE OR REPLACE FUNCTION pulse_put_visit_medication(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_visit jsonb;
BEGIN
  v_visit := pulse_get_visit(p_owner, jsonb_build_object('id', p_args->>'visitId'))->'visit';
  IF v_visit IS NULL THEN RETURN jsonb_build_object('found', false, 'medication', NULL); END IF;

  PERFORM pulse_write_medication(p_owner, jsonb_build_object(
    'patientId', v_visit->>'patientId',
    'visitId', p_args->>'visitId',
    'rows', coalesce(p_args->'rows', '[]'::jsonb)
  ));
  RETURN jsonb_build_object('found', true, 'medication',
    pulse_list_visit_medication(p_owner, jsonb_build_object('visitId', p_args->>'visitId')));
END $$;

-- 删一条用药记录
CREATE OR REPLACE FUNCTION pulse_delete_medication(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  DELETE FROM medication WHERE id = p_args->>'id' AND owner_id = p_owner;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', n > 0);
END $$;

-- 自定义符号清单，按添加顺序（只看该 owner 的）
-- 排序 tiebreaker 用 code —— PG 没有 SQLite 的 rowid（见 docs/cloudbase-migration.md）
CREATE OR REPLACE FUNCTION pulse_list_symbols(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('code', code, 'name', name)
           ORDER BY created_at, code), '[]'::jsonb)
    FROM custom_symbols WHERE owner_id = p_owner
  );
END $$;

-- 新增／改名一个自定义符号（同名同代码则覆盖名称）
CREATE OR REPLACE FUNCTION pulse_put_symbol(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_code text := trim(coalesce(p_args->>'code', ''));
  v_name text := trim(coalesce(p_args->>'name', ''));
  v_now  bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
BEGIN
  IF v_code = '' OR v_name = '' THEN
    RETURN jsonb_build_object('symbol', NULL);
  END IF;
  INSERT INTO custom_symbols (code, owner_id, name, created_at)
  VALUES (v_code, p_owner, v_name, v_now)
  ON CONFLICT (owner_id, code) DO UPDATE SET name = EXCLUDED.name;
  RETURN jsonb_build_object('symbol', jsonb_build_object('code', v_code, 'name', v_name));
END $$;

-- 删掉一个自定义符号（不影响已录入的历史符号）
CREATE OR REPLACE FUNCTION pulse_delete_symbol(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  DELETE FROM custom_symbols WHERE code = p_args->>'code' AND owner_id = p_owner;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', n > 0);
END $$;

-- 内置单机账号（单机模式的登录身份）
CREATE OR REPLACE FUNCTION pulse_local_user(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT id, login_name, display_name, role INTO r FROM users WHERE login_name = 'local';
  IF NOT FOUND THEN RETURN jsonb_build_object('user', NULL); END IF;
  RETURN jsonb_build_object('user', jsonb_build_object(
    'id', r.id, 'login_name', r.login_name, 'display_name', r.display_name, 'role', r.role));
END $$;

-- ============================================================================
-- 鉴权域
--
-- 与 server/auth.mjs 的 SQLite 版一一对应。密码哈希在 JS 侧算
-- （Node 内置 crypto.scrypt，仓库零第三方依赖原则），PG 只存不验。
-- 返回的用户行是**原样行**（snake_case 列名，含 password_hash/salt），
-- 由 auth-pg.mjs 映射成对外形状 —— 与 SQLite 版 rowToUser 的职责划分一致。
-- ============================================================================

-- 注册一个新账号，同时挂上 password 身份。
-- 登录名已存在 → 返回 {error:'login_name_taken'}
CREATE OR REPLACE FUNCTION pulse_auth_register(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_id      text := p_args->>'id';
  v_ident  text := p_args->>'identityId';
  v_login  text := p_args->>'loginName';
  v_disp   text := p_args->>'displayName';
  v_phone  text := p_args->>'phone';
  v_hash   text := p_args->>'passwordHash';
  v_salt   text := p_args->>'passwordSalt';
  v_now    bigint := (p_args->>'now')::bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE login_name = v_login) THEN
    RETURN jsonb_build_object('error', 'login_name_taken');
  END IF;

  INSERT INTO users (id, login_name, display_name, phone, password_hash, password_salt,
                     role, created_at, updated_at)
  VALUES (v_id, v_login, v_disp, v_phone, v_hash, v_salt, 'user', v_now, v_now);

  INSERT INTO identities (id, user_id, provider, external_id, union_id, created_at)
  VALUES (v_ident, v_id, 'password', v_login, NULL, v_now);

  RETURN jsonb_build_object('user', jsonb_build_object(
    'id', v_id, 'login_name', v_login, 'display_name', v_disp,
    'phone', v_phone, 'role', 'user'));
END $$;

-- 按登录名取用户行（含密码哈希与盐 —— 给 authenticate 用）
CREATE OR REPLACE FUNCTION pulse_auth_user_by_login(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT id, login_name, display_name, phone, password_hash, password_salt, role INTO r
  FROM users WHERE login_name = p_args->>'loginName';
  IF NOT FOUND THEN RETURN jsonb_build_object('user', NULL); END IF;
  RETURN jsonb_build_object('user', jsonb_build_object(
    'id', r.id, 'login_name', r.login_name, 'display_name', r.display_name,
    'phone', r.phone, 'password_hash', r.password_hash,
    'password_salt', r.password_salt, 'role', r.role));
END $$;

-- 按 id 取用户行
CREATE OR REPLACE FUNCTION pulse_auth_user_by_id(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT id, login_name, display_name, phone, password_hash, password_salt, role INTO r
  FROM users WHERE id = p_args->>'id';
  IF NOT FOUND THEN RETURN jsonb_build_object('user', NULL); END IF;
  RETURN jsonb_build_object('user', jsonb_build_object(
    'id', r.id, 'login_name', r.login_name, 'display_name', r.display_name,
    'phone', r.phone, 'password_hash', r.password_hash,
    'password_salt', r.password_salt, 'role', r.role));
END $$;

-- 按 openid 找已绑定的账号（对外形状，不含密码哈希）
CREATE OR REPLACE FUNCTION pulse_auth_user_by_wechat(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT u.id, u.login_name, u.display_name, u.phone, u.role INTO r
  FROM identities i JOIN users u ON u.id = i.user_id
  WHERE i.provider = 'wechat' AND i.external_id = p_args->>'openid';
  IF NOT FOUND THEN RETURN jsonb_build_object('user', NULL); END IF;
  RETURN jsonb_build_object('user', jsonb_build_object(
    'id', r.id, 'login_name', r.login_name, 'display_name', r.display_name,
    'phone', r.phone, 'role', r.role));
END $$;

-- 改密码：写新哈希，并把该用户所有会话清掉（别人手上的旧令牌立刻失效）
CREATE OR REPLACE FUNCTION pulse_auth_update_password(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  UPDATE users SET password_hash = p_args->>'passwordHash',
                   password_salt = p_args->>'passwordSalt',
                   updated_at = (p_args->>'now')::bigint
  WHERE id = p_args->>'userId';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN jsonb_build_object('ok', false); END IF;

  DELETE FROM sessions WHERE user_id = p_args->>'userId';
  RETURN jsonb_build_object('ok', true);
END $$;

-- 建一个会话
CREATE OR REPLACE FUNCTION pulse_auth_create_session(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sessions (token, user_id, created_at, expires_at, last_seen_at, user_agent)
  VALUES (p_args->>'token', p_args->>'userId',
          (p_args->>'createdAt')::bigint, (p_args->>'expiresAt')::bigint,
          (p_args->>'createdAt')::bigint, p_args->>'userAgent');
  RETURN jsonb_build_object('ok', true);
END $$;

-- 用令牌取用户（含 expires_at —— JS 侧判过期并顺手删掉）
CREATE OR REPLACE FUNCTION pulse_auth_session_user(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT s.token, s.expires_at, u.id, u.login_name, u.display_name, u.phone, u.role INTO r
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token = p_args->>'token';

  IF NOT FOUND THEN RETURN jsonb_build_object('user', NULL); END IF;

  RETURN jsonb_build_object('user', jsonb_build_object(
    'token', r.token, 'expires_at', r.expires_at,
    'id', r.id, 'login_name', r.login_name, 'display_name', r.display_name,
    'phone', r.phone, 'role', r.role));
END $$;

-- 滑动续期（每 5 分钟才写一次，避免每次请求都落库）
CREATE OR REPLACE FUNCTION pulse_auth_touch_session(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  UPDATE sessions SET last_seen_at = (p_args->>'now')::bigint WHERE token = p_args->>'token';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', n > 0);
END $$;

-- 退出登录：删掉这一个会话
CREATE OR REPLACE FUNCTION pulse_auth_delete_session(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  DELETE FROM sessions WHERE token = p_args->>'token';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', n > 0);
END $$;

-- 清掉某人的全部会话
CREATE OR REPLACE FUNCTION pulse_auth_delete_user_sessions(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  DELETE FROM sessions WHERE user_id = p_args->>'userId';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('n', n);
END $$;

-- 清掉过期会话（启动时跑一次，顺手清理）
CREATE OR REPLACE FUNCTION pulse_auth_purge_expired(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  DELETE FROM sessions WHERE expires_at <= (p_args->>'now')::bigint;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('n', n);
END $$;

-- 把微信身份绑到某个账号上。
-- 该 openid 已绑到别人 → 不覆盖（返回 error:'already_bound'）
CREATE OR REPLACE FUNCTION pulse_auth_bind_wechat(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_user   text := p_args->>'userId';
  v_openid text := p_args->>'openid';
  v_ident  text := p_args->>'identityId';
  v_union  text := p_args->>'unionId';
  v_now    bigint := (p_args->>'now')::bigint;
  v_bound  text;
BEGIN
  SELECT user_id INTO v_bound FROM identities
  WHERE provider = 'wechat' AND external_id = v_openid;

  IF v_bound IS NOT NULL THEN
    IF v_bound = v_user THEN
      RETURN jsonb_build_object('ok', true, 'already', true);
    END IF;
    RETURN jsonb_build_object('error', 'already_bound');
  END IF;

  INSERT INTO identities (id, user_id, provider, external_id, union_id, created_at)
  VALUES (v_ident, v_user, 'wechat', v_openid, v_union, v_now);
  RETURN jsonb_build_object('ok', true, 'already', false);
END $$;

-- 解绑微信身份
CREATE OR REPLACE FUNCTION pulse_auth_unbind_wechat(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  DELETE FROM identities WHERE user_id = p_args->>'userId' AND provider = 'wechat';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', n > 0);
END $$;

-- 该账号是否已绑微信
CREATE OR REPLACE FUNCTION pulse_auth_has_wechat(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  RETURN jsonb_build_object('ok', EXISTS (
    SELECT 1 FROM identities WHERE user_id = p_args->>'userId' AND provider = 'wechat'
  ));
END $$;

-- 内置单机账号：承接老数据、单机模式下当登录身份；没有可用密码
CREATE OR REPLACE FUNCTION pulse_auth_ensure_local_user(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_id    text;
  v_ident text;
  v_now   bigint := (p_args->>'now')::bigint;
BEGIN
  SELECT id INTO v_id FROM users WHERE login_name = 'local';
  IF v_id IS NULL THEN
    v_id := 'u' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);
    INSERT INTO users (id, login_name, display_name, phone, password_hash, password_salt,
                       role, created_at, updated_at)
    VALUES (v_id, 'local', '本机用户', NULL, '', '', 'admin', v_now, v_now);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM identities WHERE provider = 'local' AND external_id = 'local') THEN
    v_ident := 'i' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);
    INSERT INTO identities (id, user_id, provider, external_id, union_id, created_at)
    VALUES (v_ident, v_id, 'local', 'local', NULL, v_now);
  END IF;

  RETURN jsonb_build_object('id', v_id, 'login_name', 'local',
                            'display_name', '本机用户', 'role', 'admin');
END $$;
