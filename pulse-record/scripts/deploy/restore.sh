#!/usr/bin/env bash
# 臧氏脉学 · 脉象记录 —— 恢复演练
#
# 备份文件「存在」不等于「能用」。这个脚本把一份备份恢复到临时位置，
# 打开它、查完整性、比对行列数 —— **不动生产库**。
#
# 真要恢复生产库时：
#   1. systemctl stop pulse-record
#   2. cp /backup/history-YYYY-MM-DD.sqlite /var/lib/pulse-record/history.sqlite
#   3. systemctl start pulse-record
#
# 用法：bash restore.sh [备份文件路径]

set -euo pipefail

DATA_DIR="${PULSE_DATA_DIR:-/var/lib/pulse-record}"
BACKUP_DIR="${PULSE_BACKUP_DIR:-/backup}"
DB="${PULSE_DB:-$DATA_DIR/history.sqlite}"
SRC="${1:-}"

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { printf '[restore] %s\n' "$*" >&2; exit 1; }

if [ -z "$SRC" ]; then
  # 不给参数就用最新的一份
  SRC="$(ls -1t "$BACKUP_DIR"/history-*.sqlite 2>/dev/null | head -1 || true)"
  [ -n "$SRC" ] || die "$BACKUP_DIR 里没有备份可恢复"
fi
[ -f "$SRC" ] || die "备份文件不存在：$SRC"

log "演练：把 $SRC 恢复到临时目录（不动生产库）"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$SRC" "$TMP/restore.sqlite"

INTEGRITY="$(sqlite3 "$TMP/restore.sqlite" 'PRAGMA integrity_check;')"
[ "$INTEGRITY" = "ok" ] || die "备份完整性检查失败：$INTEGRITY"

if [ -f "$DB" ]; then
  LOG_PATIENTS="$(sqlite3 "$DB" 'SELECT count(*) FROM patients;' 2>/dev/null || echo '?')"
  LOG_VISITS="$(sqlite3 "$DB" 'SELECT count(*) FROM visits;' 2>/dev/null || echo '?')"
else
  LOG_PATIENTS="（生产库还不存在）"
  LOG_VISITS="（生产库还不存在）"
fi

BK_PATIENTS="$(sqlite3 "$TMP/restore.sqlite" 'SELECT count(*) FROM patients;')"
BK_VISITS="$(sqlite3 "$TMP/restore.sqlite" 'SELECT count(*) FROM visits;')"
BK_MED="$(sqlite3 "$TMP/restore.sqlite" 'SELECT count(*) FROM medication;')"

cat <<EOF
────────────────────────────────────────────
恢复演练结果
  备份文件    ：$SRC
  完整性检查  ：$INTEGRITY
  备份内容    ：patients=$BK_PATIENTS  visits=$BK_VISITS  medication=$BK_MED
  当前生产库  ：patients=$LOG_PATIENTS  visits=$LOG_VISITS
  生产库没被动过（演练只读）
────────────────────────────────────────────
EOF

if [ "$BK_PATIENTS" = "0" ] && [ "$BK_VISITS" = "0" ]; then
  die "备份里没有任何数据 —— 别拿它恢复"
fi
log "演练通过"
