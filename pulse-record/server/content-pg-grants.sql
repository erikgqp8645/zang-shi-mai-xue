-- 臧氏脉学 · 内容层 —— 授权
--
-- ## 为什么必须显式写授权
--
-- 平台默认只给 **public** schema 授权（实测）：
--
--   anon                       → public 的 8 张业务表（只读）
--   authenticated / service_role → public 全部表（全权限）
--
-- 内容层的表在**新 schema `content`（与 `content_meta`）**里
-- ⇒ 默认授权**不覆盖**它们 ⇒ 不显式授权的后果是：
--
--   · `information_schema` 里**一张都看不见**
--     （所以 `content_check_order` 会报「content schema 里没有表」）
--   · 直接访问报 `permission denied for schema content`
--
-- ## SDK 的 RPC 以哪个角色执行
--
-- 实测（临时探针函数 `content_probe`）：
--
--   current_user  = service_role
--   session_user  = cloudbase_authenticator
--
-- ⇒ 内容层的读写**全部**发生在 `service_role` 下 ⇒ 授权必须覆盖它。
--
-- ## 为什么还要 ALTER DEFAULT PRIVILEGES
--
-- `GRANT ... ON ALL TABLES IN SCHEMA` 只管**现有**的表。
-- 将来 schema 里加了第 18 张表而忘了重跑 setup ⇒ 那张表 RPC 角色又看不见，
-- 又变成一次「看起来该在却不在」的怪事。
--
-- DEFAULT PRIVILEGES 让**以后新建**的表自动带上同样的授权。
-- ⚠️ 它只对「执行这条语句的角色」新建的表生效 ——
--    setup 脚本以 `cloudbase_postgres` 身份跑，而表也正是它建的 ⇒ 正好覆盖。

-- ── schema 用量 ──────────────────────────────────────────────────────
-- 没有 USAGE 就连表都看不见（哪怕有表级权限）。
GRANT USAGE ON SCHEMA content TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA content_meta TO anon, authenticated, service_role;

-- ── 读 ──────────────────────────────────────────────────────────────
-- 内容是**公开知识**（同一份内容就在公开仓库里）⇒ 三个角色都能读。
GRANT SELECT ON ALL TABLES IN SCHEMA content TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA content_meta TO anon, authenticated, service_role;

-- ── 写 ──────────────────────────────────────────────────────────────
-- 只有 service_role 能写：发布命令走 SDK 的 rpc，角色就是它。
-- TRUNCATE 也要给 —— `content_publish` 是「整份覆盖」，靠 TRUNCATE 清表。
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA content TO service_role;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA content_meta TO service_role;

-- ── 序列 ────────────────────────────────────────────────────────────
-- ⚠️ `bigserial` 列自带序列（content_revisions_id_seq / content_audit_id_seq）。
--    没有 USAGE 的话，插入时取不到 nextval ⇒
--    「permission denied for sequence content_revisions_id_seq」
--    （踩过：第一次真发布就是这个错，事务已干净回滚，远端没脏）。
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA content TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA content_meta TO service_role;

-- ── 以后新建的表自动带上同样的授权 ──────────────────────────────────
ALTER DEFAULT PRIVILEGES IN SCHEMA content
  GRANT SELECT ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA content
  GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA content_meta
  GRANT SELECT ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA content_meta
  GRANT INSERT, UPDATE, DELETE ON TABLES TO service_role;

-- 以后新建的序列（bigserial）自动带上授权
ALTER DEFAULT PRIVILEGES IN SCHEMA content
  GRANT USAGE, SELECT ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA content_meta
  GRANT USAGE, SELECT ON SEQUENCES TO service_role;
