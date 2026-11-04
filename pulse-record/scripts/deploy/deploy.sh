#!/usr/bin/env bash
# 臧氏脉学 · 脉象记录 —— 发布（上传代码 → 构建 → 重启 → 验证）
#
# 从本机推到服务器。用法：
#   bash deploy.sh <用户@主机> [路径]
# 例如：
#   bash deploy.sh root@1.2.3.4
#
# 说明：
#   · 只推代码与配置，**不推数据库**（数据库在服务器上，不在仓库里）
#   · 推完在服务器上构建并重启服务，出错自动回滚到上一个 release
#   · 备份在重启前自动做一次

set -euo pipefail

TARGET="${1:-}"
REMOTE_DIR="${2:-/opt/pulse-record}"
LOCAL_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

[ -n "$TARGET" ] || { echo "用法：bash deploy.sh <用户@主机> [远端路径]" >&2; exit 1; }

log() { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

command -v rsync >/dev/null 2>&1 || die "本机要装 rsync"

# 排除本地开发产物与本机数据
EXCLUDES=(
  --exclude '.git/'
  --exclude 'node_modules/'
  --exclude 'dist/'
  --exclude 'local-data/'
  --exclude 'miniprogram/utils/core/'
  --exclude 'miniprogram/assets/'
  --exclude '.DS_Store'
  --exclude '*.log'
)

STAMP="$(date +%Y%m%d-%H%M%S)"
RELEASE="$REMOTE_DIR/releases/$STAMP"

log "推代码到 $TARGET:$RELEASE"
ssh "$TARGET" "mkdir -p '$RELEASE'"
rsync -az --delete "${EXCLUDES[@]}" "$LOCAL_DIR/" "$TARGET:$RELEASE/"

log "服务器上构建并切换"
ssh "$TARGET" <<REMOTE
set -euo pipefail
cd '$RELEASE'
npm ci --omit=dev || npm install
npm install
npm run build

# 切换软链：current 指到当前 release，回滚只要改回去
ln -sfn '$RELEASE' '$REMOTE_DIR/current'

# 切换前先备份一次数据库
if [ -f /var/lib/pulse-record/history.sqlite ]; then
  mkdir -p /backup
  sqlite3 /var/lib/pulse-record/history.sqlite ".backup '/backup/history-\$(date +%F).sqlite'" || true
fi

systemctl restart pulse-record
sleep 2
if ! systemctl is-active --quiet pulse-record; then
  echo "服务起不来，回滚到上一个 release" >&2
  PREV=\$(ls -1dt '$REMOTE_DIR'/releases/* | sed -n 2p)
  if [ -n "\${PREV:-}" ]; then
    ln -sfn "\$PREV" '$REMOTE_DIR/current'
    systemctl restart pulse-record
  fi
  journalctl -u pulse-record --no-pager --lines=40 >&2
  exit 1
fi
curl -fsS http://127.0.0.1:5178/api/health
echo
echo "发布完成：$RELEASE"
REMOTE

log "清理 5 个 release 之前的旧版本"
ssh "$TARGET" "ls -1dt '$REMOTE_DIR'/releases/* | tail -n +6 | xargs -r rm -rf" || true

log "完事。日志：ssh $TARGET 'journalctl -u pulse-record -f'"
