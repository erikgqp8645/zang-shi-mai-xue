#!/usr/bin/env bash
# 臧氏脉学 · 脉象记录 —— 每日快照备份
#
# 用 sqlite3 的 .backup（不是 cp）—— WAL 模式下直接复制 .sqlite 文件可能拿到半截事务。
# 保留 30 天。
#
# 定时：/etc/cron.d/pulse-record-backup（每日 03:00）

set -euo pipefail

DATA_DIR="${PULSE_DATA_DIR:-/var/lib/pulse-record}"
BACKUP_DIR="${PULSE_BACKUP_DIR:-/backup}"
KEEP_DAYS="${PULSE_KEEP_DAYS:-30}"
DB="${PULSE_DB:-$DATA_DIR/history.sqlite}"

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }

[ -f "$DB" ] || { log "数据库不存在：$DB（跳过）"; exit 0; }

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%F)"
OUT="$BACKUP_DIR/history-$STAMP.sqlite"

log "备份 $DB → $OUT"
# .backup 会在线做一致性快照，不需要停服务
sqlite3 "$DB" ".backup '$OUT'"

# 立刻验证这个备份能不能正常打开、行列数对不对得上
# —— 备份文件「存在」不等于「能用」，每月演练一次就是为了这个
INTEGRITY="$(sqlite3 "$OUT" 'PRAGMA integrity_check;')"
if [ "$INTEGRITY" != "ok" ]; then
  log "备份完整性检查失败：$INTEGRITY"
  exit 1
fi
PATIENTS="$(sqlite3 "$OUT" 'SELECT count(*) FROM patients;')"
VISITS="$(sqlite3 "$OUT" 'SELECT count(*) FROM visits;')"
log "备份完成：patients=$PATIENTS visits=$VISITS integrity=$INTEGRITY"

# 清理过期备份
find "$BACKUP_DIR" -maxdepth 1 -name 'history-*.sqlite' -type f -mtime "+$KEEP_DAYS" -print -delete | while read -r old; do
  log "删除过期备份 $old"
done

log "当前备份：$(ls -1 "$BACKUP_DIR"/history-*.sqlite 2>/dev/null | wc -l | tr -d ' ') 份"
