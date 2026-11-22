#!/usr/bin/env bash
# 臧氏脉学 · 脉象记录 —— 发布脚本（扁平布局，与 systemd unit 一致）
#
# 用法：
#   bash scripts/deploy/deploy.sh <用户@主机> [远端目录] [选项]
#   bash scripts/deploy/deploy.sh root@1.2.3.4                    # 构建并发布
#   bash scripts/deploy/deploy.sh root@1.2.3.4 --no-build          # 用现有 dist 发布
#   bash scripts/deploy/deploy.sh root@1.2.3.4 --dry-run           # 只看会动哪些文件
#
# ## 为什么改成扁平布局
#
# 原来的脚本把代码推到 `releases/<时间戳>/` 再切 `current` 软链，但
# `pulse-record.service` 是 `WorkingDirectory=/opt/pulse-record`、
# `ExecStart=/usr/bin/node server/index.mjs` —— **服务读的是扁平树**。
# 于是跑完脚本：`systemctl is-active` 通过、`/api/health` 200、还打印「发布完成」，
# 而线上跑的还是老代码。这是最坏的一类故障：**假成功**。
#
# 现在的做法（与 unit 对齐）：
#   1. 本地构建，并把预览页／导出文件一起放进 dist
#   2. 远端先把 dist/ 与 server/ 整份快照到 `.backup/<时间戳>/`
#   3. `rsync --delete` 覆盖到 `/opt/pulse-record/dist`（顺带清掉旧 hash 资源）
#   4. 重启 → 探活 → **核对线上 index.html 指向的 bundle 就是本地这份**
#   5. 任一步失败 → 自动回滚到快照并重启
#
# ## 三条硬规矩
#
# · **不推数据库**：数据库在服务器上，不在仓库里
# · **不删 node_modules**：只有 package.json 变了才 `npm ci --omit=dev`
# · **验证要看到 bundle 哈希**：只探活不够，页面没换也会 200

set -euo pipefail

DO_BUILD=1
DRY_RUN=0
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    --dry-run) DRY_RUN=1 ;;
    -*) echo "未知选项：$arg" >&2; exit 1 ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done
TARGET="${POSITIONAL[0]:-}"
REMOTE_DIR="${POSITIONAL[1]:-/opt/pulse-record}"

LOCAL_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
RSYNC_FLAGS=(-az --delete --itemize-changes)

[ -n "$TARGET" ] || { echo "用法：bash scripts/deploy/deploy.sh <用户@主机> [远端目录] [--no-build|--dry-run]" >&2; exit 1; }

log() { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

command -v rsync >/dev/null 2>&1 || die "本机要装 rsync"

cd "$LOCAL_DIR"

# ---------- 1. 本地构建 ----------
if [ "$DO_BUILD" = 1 ]; then
  log "本地构建：npm run build"
  npm run build >/dev/null

  # 预览页与导出文件不进 git，但跑在 dist 里；build 会清空 dist，所以每次补一次
  if [ -d design-demos ]; then
    mkdir -p dist/design dist/design/c3
    cp design-demos/*.html dist/design/ 2>/dev/null || true
    cp design-demos/c3/*.html dist/design/c3/ 2>/dev/null || true
  fi
  if compgen -G "exports/*.xlsx" >/dev/null; then
    mkdir -p dist/downloads
    # ASCII 文件名：中文名在 URL 里要编码，手机上下载容易出问题
    LATEST_XLSX="$(ls -1t exports/*.xlsx | head -1)"
    cp "$LATEST_XLSX" dist/downloads/formula-master.xlsx
  fi
fi

[ -f dist/index.html ] || die "没有 dist/index.html —— 先 npm run build"

BUNDLE="$(grep -o 'index-[A-Za-z0-9_-]*\.js' dist/index.html | head -1 || true)"
[ -n "$BUNDLE" ] || die "dist/index.html 里找不到 bundle 名"

log "本次要发布的 bundle：$BUNDLE"

if [ "$DRY_RUN" = 1 ]; then
  log "（dry-run）不会改动远端，只列出会同步的内容"
  RSYNC_FLAGS+=(-n)
fi

# ---------- 2. 远端快照 ----------
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$REMOTE_DIR/.backup/$STAMP"

if [ "$DRY_RUN" = 0 ]; then
  log "远端快照：$BACKUP_DIR"
  ssh "$TARGET" "set -e; mkdir -p '$BACKUP_DIR'; \
    [ -d '$REMOTE_DIR/dist' ] && cp -a '$REMOTE_DIR/dist' '$BACKUP_DIR/dist'; \
    [ -d '$REMOTE_DIR/server' ] && cp -a '$REMOTE_DIR/server' '$BACKUP_DIR/server'; \
    true"
fi

# ---------- 3. 同步代码 ----------
log "同步 dist → $TARGET:$REMOTE_DIR/dist"
rsync "${RSYNC_FLAGS[@]}" dist/ "$TARGET:$REMOTE_DIR/dist/"

log "同步 server → $TARGET:$REMOTE_DIR/server"
SERVER_RSYNC=(-az --delete --itemize-changes --exclude '*.bak-*')
[ "$DRY_RUN" = 1 ] && SERVER_RSYNC+=(-n)
rsync "${SERVER_RSYNC[@]}" server/ "$TARGET:$REMOTE_DIR/server/" | sed 's/^/  /' || true

# package.json 变了才装依赖（node_modules 不删）
log "检查依赖是否需要安装"
[ "$DRY_RUN" = 1 ] && { echo "  （dry-run）跳过依赖安装"; } || ssh "$TARGET" "set -e; cd '$REMOTE_DIR'; \
  if [ ! -d node_modules ] || [ ! -f .deps-stamp ] || ! cmp -s package.json .deps-stamp; then \
    echo '  依赖有变化 → npm ci --omit=dev'; \
    npm ci --omit=dev >/dev/null 2>&1 || npm install --omit=dev >/dev/null 2>&1; \
    cp package.json .deps-stamp; \
  else echo '  依赖未变，跳过'; fi" | sed 's/^/  /'

# 内容层来源：患者数据走 PG，内容读快照（那台 PG 上没有 content_read 函数）
# 只补这一行，不打印环境文件内容（里面有密钥）
if [ "$DRY_RUN" = 0 ]; then
  ssh "$TARGET" "set -e; F=/etc/pulse-record.env; \
    if [ -f \"\$F\" ]; then \
      grep -q '^PULSE_CONTENT=' \"\$F\" || echo 'PULSE_CONTENT=snapshot' >> \"\$F\"; \
    fi" || warn "未能写入 PULSE_CONTENT（跳过）"
fi

if [ "$DRY_RUN" = 1 ]; then
  log "（dry-run 结束）"
  exit 0
fi

# ---------- 4. 备份库 + 重启 + 验证 ----------
log "备份数据库 → /backup/"
ssh "$TARGET" "set -e; \
  if [ -f /var/lib/pulse-record/history.sqlite ]; then \
    mkdir -p /backup; \
    sqlite3 /var/lib/pulse-record/history.sqlite \".backup '/backup/history-\$(date +%F).sqlite'\" 2>/dev/null || true; \
  fi" || warn "数据库备份失败（不阻断发布）"

log "重启服务"
ssh "$TARGET" "systemctl restart pulse-record"

sleep 3

FAIL=""
ssh "$TARGET" "systemctl is-active --quiet pulse-record" || FAIL="服务未处于 active"
if [ -z "$FAIL" ]; then
  ssh "$TARGET" "curl -fsS http://127.0.0.1:5178/api/health >/dev/null" || FAIL="/api/health 不通"
fi
if [ -z "$FAIL" ]; then
  # ⚠️ 只探活不够：页面没换也会 200。要核对线上 index.html 指向的 bundle 就是本地这份
  REMOTE_BUNDLE="$(ssh "$TARGET" "grep -o 'index-[A-Za-z0-9_-]*\.js' '$REMOTE_DIR/dist/index.html' | head -1" || true)"
  [ "$REMOTE_BUNDLE" = "$BUNDLE" ] || FAIL="线上 bundle 是 '$REMOTE_BUNDLE'，期望 '$BUNDLE'"
else
  REMOTE_BUNDLE=""
fi

if [ -z "$FAIL" ]; then
  log "发布完成：$BUNDLE 已在线上运行（快照：$BACKUP_DIR）"
  log "清理旧快照（只留最近 5 份）"
  ssh "$TARGET" "ls -1dt '$REMOTE_DIR'/.backup/* 2>/dev/null | tail -n +6 | xargs -r rm -rf" || true
  log "完事。日志：ssh $TARGET 'journalctl -u pulse-record -f'"
  exit 0
fi

# ---------- 5. 失败回滚 ----------
warn "发布失败：$FAIL"
warn "回滚到快照 $BACKUP_DIR"
ssh "$TARGET" "set -e; \
  if [ -d '$BACKUP_DIR/dist' ]; then rm -rf '$REMOTE_DIR/dist' && cp -a '$BACKUP_DIR/dist' '$REMOTE_DIR/dist'; fi; \
  if [ -d '$BACKUP_DIR/server' ]; then rm -rf '$REMOTE_DIR/server' && cp -a '$BACKUP_DIR/server' '$REMOTE_DIR/server'; fi; \
  systemctl restart pulse-record; sleep 2; systemctl is-active pulse-record"
ssh "$TARGET" "journalctl -u pulse-record --no-pager --lines=30" >&2 || true
die "已回滚，线上仍是发布前的版本"
