#!/usr/bin/env bash
# 臧氏脉学 · 脉象记录表生成器 —— 服务器初始化
#
# 一次跑完：建系统用户与目录、装 Node、打好前端、装 systemd 服务与 Caddy、装备份定时任务。
#
# 用法（在一台干净的国内云服务器上，以 root 跑）：
#   bash install.sh
#
# 可用环境变量覆盖：
#   DOMAIN= mai.example.com        公网域名（要先完成 ICP 备案）
#   SERVICE_USER=pulse              服务账号
#   DATA_DIR=/var/lib/pulse-record  数据目录（SQLite 落在这里）
#   BACKUP_DIR=/backup              备份目录
#   REPO=/opt/pulse-record          代码目录
#
# 注意：备案期间域名不能解析到国内服务器 —— 那段时间用局域网 IP 联调，
#       等备案通过后再把 DNS 指过来并启用 Caddy 的 HTTPS。

set -euo pipefail

DOMAIN="${DOMAIN:-}"
SERVICE_USER="${SERVICE_USER:-pulse}"
DATA_DIR="${DATA_DIR:-/var/lib/pulse-record}"
BACKUP_DIR="${BACKUP_DIR:-/backup}"
REPO="${REPO:-/opt/pulse-record}"
NODE_MAJOR="${NODE_MAJOR:-24}"

log() { printf '\033[1;36m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[install]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[install]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "要用 root 跑（sudo bash install.sh）"

# ---------------------------------------------------------------
# 1. 系统用户与目录
# ---------------------------------------------------------------
log "建服务账号与目录"
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$DATA_DIR" "$BACKUP_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"
# 备份目录只有 root 与服务账号可读 —— 病例数据敏感
chown -R root:"$SERVICE_USER" "$BACKUP_DIR"
chmod 750 "$BACKUP_DIR"

# ---------------------------------------------------------------
# 2. Node
# ---------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  log "装 Node.js ${NODE_MAJOR}"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
node -v
# node:sqlite 从 Node 22 起可用（仍带 ExperimentalWarning）—— 必须 >= 22
node -e "require('node:sqlite')" >/dev/null 2>&1 || die "这个 Node 没有 node:sqlite，要换 >= 22 的版本"

# ---------------------------------------------------------------
# 3. 代码与构建
# ---------------------------------------------------------------
log "准备代码目录 $REPO"
if [ -d "$REPO/.git" ]; then
  git -C "$REPO" pull --ff-only || warn "git pull 失败，用现有代码继续"
else
  mkdir -p "$REPO"
  warn "$REPO 里没有 .git —— 请自行把代码放进去（或改 REPO 指向代码目录）"
fi
cd "$REPO"
[ -f package.json ] || die "$REPO 里没有 package.json"

log "装依赖并构建前端"
npm ci --omit=dev || npm install
# 构建需要 devDependencies（vite/tsc），所以先全量装再构建
npm install
npm run build

# ---------------------------------------------------------------
# 4. 环境变量文件
# ---------------------------------------------------------------
if [ ! -f /etc/pulse-record.env ]; then
  log "写 /etc/pulse-record.env（微信 AppSecret 请自己填）"
  cat > /etc/pulse-record.env <<EOF
# 臧氏脉学 · 脉象记录服务
# 密钥只放这台机器，绝不进仓库
PULSE_DB=$DATA_DIR/history.sqlite
PULSE_SINGLE_USER=0
PORT=5178
# 微信小程序凭据（个人主体小程序也要填，用于 wx.login → code2Session）
WX_APPID=
WX_APPSECRET=
# 静态托管迁到 CloudBase 后，网站与 API 不同源时才需要填（逗号分隔）
PULSE_CORS_ORIGINS=
EOF
  chmod 600 /etc/pulse-record.env
  warn "记得编辑 /etc/pulse-record.env 填 WX_APPID / WX_APPSECRET"
else
  log "/etc/pulse-record.env 已存在，保留"
fi

# ---------------------------------------------------------------
# 5. systemd
# ---------------------------------------------------------------
log "装 systemd 服务"
install -m 644 "$(dirname "$0")/pulse-record.service" /etc/systemd/system/pulse-record.service
systemctl daemon-reload
systemctl enable pulse-record.service
systemctl restart pulse-record.service
sleep 1
systemctl --no-pager --lines=5 status pulse-record.service || true

# ---------------------------------------------------------------
# 6. Caddy
# ---------------------------------------------------------------
if [ -n "$DOMAIN" ]; then
  log "装 Caddy 并配置 $DOMAIN"
  if ! command -v caddy >/dev/null 2>&1; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update
    apt-get install -y caddy
  fi
  sed "s/__DOMAIN__/$DOMAIN/g" "$(dirname "$0")/Caddyfile.example" > /etc/caddy/Caddyfile
  systemctl reload caddy || systemctl restart caddy
  log "Caddy 配好：https://$DOMAIN"
else
  warn "没给 DOMAIN，跳过 Caddy。备案通过后补："
  warn "  sed 's/__DOMAIN__/mai.example.com/g' scripts/deploy/Caddyfile.example > /etc/caddy/Caddyfile"
  warn "  systemctl reload caddy"
fi

# ---------------------------------------------------------------
# 7. 备份定时任务
# ---------------------------------------------------------------
log "装每日 03:00 备份"
install -m 755 "$(dirname "$0")/backup.sh" /usr/local/bin/pulse-backup.sh
cat > /etc/cron.d/pulse-record-backup <<EOF
# 臧氏脉学 · 脉象记录 —— 每日 03:00 快照备份，保留 30 天
0 3 * * * root /usr/local/bin/pulse-backup.sh >> /var/log/pulse-record-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/pulse-record-backup

log "备份脚本已装好，手动跑一次验证："
/usr/local/bin/pulse-backup.sh || warn "手动备份失败，请检查上面的提示"

cat <<EOF

────────────────────────────────────────────
装好了。接下来：

  1. 填微信凭据：  vi /etc/pulse-record.env
  2. 看服务日志：  journalctl -u pulse-record -f
  3. 健康检查：    curl http://127.0.0.1:5178/api/health
  4. 首次建账号：  cd $REPO && PULSE_DB=$DATA_DIR/history.sqlite npm run admin -- create <登录名>
  5. 备案通过后：  DNS 指到本机 → 配 Caddy → 微信公众平台加 request 合法域名

细节见 pulse-record/docs/deploy.md
────────────────────────────────────────────
EOF
