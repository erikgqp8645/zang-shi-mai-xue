-- 臧氏脉学 · 内容层 —— PostgreSQL 侧发布函数
--
-- ## 为什么单独一个文件
--
-- `server/pg-functions.sql` 是**患者数据域**的函数；内容层是另一个域，
-- 生命周期、写入语义、调用方都不同 ⇒ 分开放，改内容不会碰到患者数据。
--
-- ## 写入语义：**整份覆盖**
--
-- 内容层是**可整体替换**的一份数据：本地后台改完 → 一次发布 → 远端整体换掉。
-- 增量同步要回答「本地删了一行，远端怎么办」；整份覆盖没有这个歧义。
--
-- ## 一次 RPC ＝ 一个事务
--
-- 17 张表要么全换成功、要么全不动 ——
-- 不会出现「方剂换了、格位没换」这种半套状态（这正是断言 A6 要守的）。
--
-- ## ⭐ 为什么用 `jsonb_populate_recordset`（而不是逐表写死 INSERT）
--
-- 写死的 INSERT 需要把 17 张表的列清单**抄第二遍** ——
-- schema 一改，函数就错，而且错得静默（少一列 → 那列永远是 NULL）。
--
-- `jsonb_populate_recordset(NULL::content.<表>, $1)` 直接用**表自己的复合类型**，
-- 列清单来自 PG 目录 ⇒ schema 是唯一真源，函数不用跟着改。
--
-- ## 签名约定（与 server/pg-functions.sql 一致）
--
--     (p_owner text, p_args jsonb) → jsonb
--
-- 内容层是**全局的**，不按 owner 分片 ⇒ `p_owner` 只用于留痕，不参与过滤。
--
-- ⚠️ 计划稿里写的是 `pulse_content_publish(p_payload jsonb, p_actor text)`，
--    与仓库既有约定 `(p_owner, p_args)` 不同。**按仓库约定走**（D16）：
--    同一个 `rpc()` 通道、同一套调用姿势，少一套特殊形状。

-- ============================================================================
-- 表清单核对：载荷的 order 必须与 content schema 的实际表清单**完全一致**
-- ============================================================================
-- ## 为什么要有这个检查
--
-- 「整份覆盖」有两个方向都要卡住：
--
--   ① order 里有 content schema 里不存在的表 → 写不进去（而且多半是拼错了）
--   ② content schema 里有没出现在 order 里的表 → **那张表不会被 TRUNCATE，
--      也不会被灌入 ⇒ 旧数据留在远端** ⇒ 线上是「新版 ＋ 旧版」的混合体
--
-- ②是最阴的：发布**看起来成功了**，实际远端一半是旧的。
-- 所以这里直接报错，让发布脚本在发出去之前就发现。
--
-- ⭐ 目录里的表清单就是「数据表」的定义 ——
--    账本表在另一个 schema（content_meta），天然不在这里，不需要排除名单。
--
-- 返回核对通过的 order 数组（调用方直接用，不用再解一遍）。
CREATE OR REPLACE FUNCTION content_check_order(p_order jsonb)
RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE
  order_arr text[];
  cat_arr text[];
BEGIN
  IF p_order IS NULL OR jsonb_typeof(p_order) <> 'array' THEN
    RAISE EXCEPTION '载荷缺 order 数组 —— 灌入必须按依赖顺序（父表在前）';
  END IF;

  order_arr := ARRAY(SELECT jsonb_array_elements_text(p_order));

  -- content schema 里的**全部**基表 ＝ 数据表清单
  SELECT COALESCE(array_agg(table_name ORDER BY table_name), '{}')
  INTO cat_arr
  FROM information_schema.tables
  WHERE table_schema = 'content' AND table_type = 'BASE TABLE';

  IF cat_arr = '{}' THEN
    RAISE EXCEPTION 'content schema 里没有表 —— 先跑建表脚本（npm run content:pg:setup）';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(order_arr) AS t(name) WHERE NOT (t.name = ANY (cat_arr))) THEN
    RAISE EXCEPTION 'order 里有 content schema 里不存在的表：%',
      (SELECT string_agg(x.name, ', ') FROM unnest(order_arr) AS x(name) WHERE NOT (x.name = ANY (cat_arr)));
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(cat_arr) AS t(name) WHERE NOT (t.name = ANY (order_arr))) THEN
    RAISE EXCEPTION 'content schema 里还有没发布的表：%（整份覆盖不允许缺表 —— 这些表会留着旧数据）',
      (SELECT string_agg(x.name, ', ') FROM unnest(cat_arr) AS x(name) WHERE NOT (x.name = ANY (order_arr)));
  END IF;

  RETURN order_arr;
END $$;

-- ============================================================================
-- 内容层发布：把本地内容库整份覆盖到 content schema 的 17 张表
-- ============================================================================
-- ## 载荷形状
--
--     {
--       "order":  ["content_sciences", "content_doses", ...],   ← 拓扑序（父表在前）
--       "tables": { "content_sciences": [ 行对象, ... ], ... }
--     }
--
-- ⭐ **为什么 order 由调用方给**
--
-- 灌入必须按**依赖顺序**（父表在前）：`content_doses.science_id` 指向
-- `content_sciences.id`，父表还没灌就灌子表 ⇒ 外键报错。
--
-- · 函数里算拓扑序 ⇒ 要在 plpgsql 里实现一遍拓扑排序（还得处理环），
--   而且和 `src/content/schema/*.schema.json` 那边的排序**是两份逻辑**；
-- · 调用方给 ⇒ 顺序直接来自 schema 的拓扑排序结果，**唯一真源**。
--
-- 调用方是 `scripts/content-publish.mjs`，它用 `tableDefs()` 的顺序
-- （依赖拓扑序，见 server/content-schema.mjs 的 orderByDependency）。
--
-- ⚠️ 另外：**载荷的键顺序不可依赖** —— PG 的 `jsonb` 会重排键
--    （按长度＋字节序），所以顺序必须**显式**放在 `order` 数组里。
CREATE OR REPLACE FUNCTION content_publish(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  tbl text;
  n bigint;
  total bigint := 0;
  counts jsonb := '{}'::jsonb;
  trunc_list text;
  order_arr text[];
  payload_keys text[];
  new_version bigint;
  now_ms bigint;
  act text;
  rollback_from bigint;
BEGIN
  IF p_args->'tables' IS NULL OR jsonb_typeof(p_args->'tables') <> 'object' THEN
    RAISE EXCEPTION '载荷缺 tables 对象';
  END IF;

  -- ① 表清单核对（少表/多表/拼错都在这里被拦下）
  order_arr := content_check_order(p_args->'order');

  -- ② 载荷的表集合必须与 order 完全一致（整份覆盖，不允许缺表/多表）
  payload_keys := ARRAY(SELECT jsonb_object_keys(p_args->'tables'));
  IF EXISTS (SELECT 1 FROM unnest(order_arr) AS s(tbl) WHERE NOT (p_args->'tables' ? s.tbl))
     OR EXISTS (SELECT 1 FROM unnest(payload_keys) AS k(tbl) WHERE NOT (k.tbl = ANY (order_arr))) THEN
    RAISE EXCEPTION '载荷的表集合与 order 不一致（order % 项，tables % 项）—— 整份覆盖不允许缺表或多表',
      array_length(order_arr, 1), array_length(payload_keys, 1);
  END IF;

  -- ③ 清空：**只清 order 里列出的表**
  --    ⚠️ quote_ident 只给表名加引号，**不带 schema 前缀** ——
  --    少了「content.」就会跑到 search_path（public）里找表 ⇒
  --    "relation content_alias does not exist"。schema 要自己拼。
  --    ⚠️ 账本表在 content_meta schema ⇒ 结构上不可能被这里清掉。
  SELECT string_agg(quote_ident('content') || '.' || quote_ident(s.tbl), ', ' ORDER BY s.tbl)
  INTO trunc_list
  FROM unnest(order_arr) AS s(tbl);

  EXECUTE 'TRUNCATE TABLE ' || trunc_list || ' CASCADE';

  -- ④ 按 order 逐表灌入（父表在前，外键才成立）
  FOREACH tbl IN ARRAY order_arr LOOP
    EXECUTE format(
      'INSERT INTO content.%I SELECT * FROM jsonb_populate_recordset(NULL::content.%I, $1)',
      tbl, tbl
    ) USING p_args->'tables'->tbl;

    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
    counts := counts || jsonb_build_object(tbl, n);
  END LOOP;

  -- ⑤ 版本号 + 留痕
  now_ms := ((extract(epoch from now()) * 1000)::bigint);
  act := COALESCE(p_args->>'action', 'publish');
  rollback_from := (p_args->>'rollbackFrom')::bigint;

  SELECT version + 1 INTO new_version FROM content_meta.content_state WHERE id = 1 FOR UPDATE;
  IF new_version IS NULL THEN
    INSERT INTO content_meta.content_state (id, version, published_at, published_by, summary)
    VALUES (1, 1, now_ms, p_owner, counts)
    RETURNING version INTO new_version;
  ELSE
    UPDATE content_meta.content_state
       SET version = new_version,
           published_at = now_ms,
           published_by = p_owner,
           summary = counts
     WHERE id = 1;
  END IF;

  -- 修订历史：整份 payload 存下来 ⇒ 回滚就是「把这一版再发一次」
  INSERT INTO content_meta.content_revisions (version, published_at, published_by, payload)
  VALUES (new_version, now_ms, p_owner, p_args);

  -- 只留最近 20 版（payload 约几百 KB，不能无限堆）
  DELETE FROM content_meta.content_revisions
   WHERE id NOT IN (
     SELECT id FROM content_meta.content_revisions ORDER BY version DESC LIMIT 20
   );

  INSERT INTO content_meta.content_audit (version, at, actor, action, summary)
  VALUES (new_version, now_ms, p_owner, act,
          counts || jsonb_strip_nulls(jsonb_build_object('rollbackFrom', rollback_from)));

  RETURN jsonb_build_object(
    'version', new_version,
    'tables', counts,
    'total', total,
    'publishedBy', p_owner,
    'publishedAt', now_ms,
    'action', act
  );
END $$;

-- ============================================================================
-- 读：把 content schema 的数据表整份读回来
-- ============================================================================
-- 与 content_publish 互为逆运算：publish 写进去什么，read 就读回什么。
--
-- ## 读哪些表由调用方给（order）
--
-- 与发布同一个约定：表清单来自 schema 的拓扑序（唯一真源），
-- 服务端 `server/content-pg.mjs` 传的是 `tableDefs()` 的顺序。
--
-- ⭐ 走同一套核对（content_check_order）⇒ 账本表不会被读进内容包，
--   远端多出/少掉一张表也会立刻报出来（而不是静默读出一半）。
--
-- ## 行序按**主键**排
--
-- ⇒ 两次读的结果稳定可比（快照不会自己抖动），对拍才有意义。
CREATE OR REPLACE FUNCTION content_read(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  tbl text;
  pk_cols text;
  rows_json jsonb;
  out_json jsonb := '{}'::jsonb;
  total bigint := 0;
  order_arr text[];
BEGIN
  order_arr := content_check_order(p_args->'order');

  FOREACH tbl IN ARRAY order_arr LOOP
    -- 主键列（没有主键的表退化成按整行排 —— 现有 17 张表都有主键）
    SELECT string_agg(quote_ident(kcu.column_name), ', ' ORDER BY kcu.ordinal_position)
    INTO pk_cols
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.constraint_schema = tc.constraint_schema
    WHERE tc.table_schema = 'content'
      AND tc.table_name = tbl
      AND tc.constraint_type = 'PRIMARY KEY';

    EXECUTE format(
      'SELECT COALESCE(jsonb_agg(t ORDER BY %s), ''[]''::jsonb) FROM content.%I t',
      COALESCE(pk_cols, '1'), tbl
    ) INTO rows_json;

    total := total + jsonb_array_length(rows_json);
    out_json := out_json || jsonb_build_object(tbl, rows_json);
  END LOOP;

  RETURN jsonb_build_object('tables', out_json, 'total', total);
END $$;

-- ============================================================================
-- 读：当前版本（网站端判断「有没有新内容」用）
-- ============================================================================
CREATE OR REPLACE FUNCTION content_state_get(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  st content_meta.content_state%ROWTYPE;
BEGIN
  SELECT * INTO st FROM content_meta.content_state WHERE id = 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('version', 0, 'publishedAt', NULL, 'publishedBy', NULL, 'summary', NULL);
  END IF;
  RETURN jsonb_build_object(
    'version', st.version,
    'publishedAt', st.published_at,
    'publishedBy', st.published_by,
    'summary', st.summary
  );
END $$;

-- ============================================================================
-- 读：历史版本列表（回滚前先看有哪些版本可选）
-- ============================================================================
-- 只列元信息，**不带 payload**（payload 几百 KB，列表页用不上）。
CREATE OR REPLACE FUNCTION content_revisions_list(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  lim integer := COALESCE((p_args->>'limit')::integer, 20);
  out_json jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(r) - 'payload' ORDER BY r.version DESC), '[]'::jsonb)
  INTO out_json
  FROM (
    SELECT * FROM content_meta.content_revisions ORDER BY version DESC LIMIT lim
  ) r;

  RETURN jsonb_build_object('revisions', out_json);
END $$;

-- ============================================================================
-- 回滚：把某个历史版本的 payload 再发一次
-- ============================================================================
-- 走**同一条**原子管道（content_publish）⇒ 回滚也会留痕、也会递增版本号。
-- 旧版本不会被「删掉」——它是历史，只是重新变成了当前版。
CREATE OR REPLACE FUNCTION content_rollback(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v bigint := (p_args->>'version')::bigint;
  payload jsonb;
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION '回滚必须指定 version';
  END IF;

  SELECT payload INTO payload FROM content_meta.content_revisions WHERE version = v;
  IF payload IS NULL THEN
    RAISE EXCEPTION '找不到第 % 版的修订记录', v;
  END IF;

  RETURN content_publish(
    p_owner,
    payload || jsonb_build_object('action', 'rollback', 'rollbackFrom', v)
  );
END $$;
