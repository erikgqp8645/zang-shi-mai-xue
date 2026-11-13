#!/usr/bin/env bash
# 臧氏脉学 · 脉象记录 —— PostgreSQL 每日备份
#
# 与 `backup.sh`（SQLite 版）的分工：
#   · `PULSE_STORE=sqlite` → 用 backup.sh（sqlite3 .backup）
#   · `PULSE_STORE=pg`     → 用本脚本（pg_dump custom format）
#
# ⚠️ **切到 PG 之后必须把 cron 换成这个** ——
#    原来的 backup.sh 只会备份那个**已经不再写入**的 history.sqlite，
#    每天「成功」地备份一份死数据，出问题时才发现救不回来。
#
# 定时：/etc/cron.d/pulse-record-backup（每日 03:00）
# 保留：默认 30 天（PULSE_KEEP_DAYS）
#
# 恢复：pg_restore --clean --if-exists -d "$PULSE_PG_URL" /backup/pulse-pg-<日期>.dump

set -euo pipefail

ENV_FILE="${PULSE_ENV_FILE:-/etc/pulse-record.env}"
BACKUP_DIR="${PULSE_BACKUP_DIR:-/backup}"
KEEP_DAYS="${PULSE_KEEP_DAYS:-30}"

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }

# 服务端环境变量在这个文件里（含 PULSE_PG_URL）
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

if [ -z "${PULSE_PG_URL:-}" ]; then
  log "没有 PULSE_PG_URL（不是 PG 后端？）—— 跳过。SQLite 后端请用 pulse-backup.sh"
  exit 0
fi

command -v pg_dump >/dev/null 2>&1 || {
  log "找不到 pg_dump —— 请安装 postgresql-client"
  exit 1
}

mkdir -p "$BACKUP_DIR"
chmod 750 "$BACKUP_DIR" 2>/dev/null || true

STAMP="$(date +%F)"
OUT="$BACKUP_DIR/pulse-pg-$STAMP.dump"

log "备份 → $OUT"
# custom format：比纯 SQL 小、支持并行恢复与选择性恢复
pg_dump "$PULSE_PG_URL" --format=custom --no-owner --file="$OUT"

# 立刻验证：备份「存在」不等于「能用」
if ! pg_restore --list "$OUT" > /dev/null 2>&1; then
  log "✗ 备份文件不可读：$OUT"
  exit 1
fi

SIZE="$(du -h "$OUT" | cut -f1)"
log "✓ 备份完成：$SIZE"

# 清理超过保留期的
find "$BACKUP_DIR" -name 'pulse-pg-*.dump' -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
LEFT="$(find "$BACKUP_DIR" -name 'pulse-pg-*.dump' | wc -l | tr -d ' ')"
log "当前备份：$LEFT 份"
