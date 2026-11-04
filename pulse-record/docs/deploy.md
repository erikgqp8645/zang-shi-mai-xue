# 部署 —— 臧氏脉学 · 脉象记录表生成器

网站端的部署手册。**小程序端不走这条路**（小程序发布见微信公众平台，见本文最后一节）。

- [0. 先看这张表](#0-先看这张表)
- [1. 备案：整条时间线的关键路径](#1-备案整条时间线的关键路径)
- [2. 服务器初始化](#2-服务器初始化)
- [3. 日常运维](#3-日常运维)
- [4. 备份与恢复演练](#4-备份与恢复演练)
- [5. 域名与微信后台配置](#5-域名与微信后台配置)
- [6. 小程序发布清单](#6-小程序发布清单)
- [7. 迁到 CloudBase](#7-迁到-cloudbase)

---

## 0. 先看这张表

| 事项 | 结论 |
|---|---|
| 域名 / ICP 备案 | **全都要，现在就去办**。备案期 7~20 工作日（个别省份约 1 个月），是整条时间线上最长的一段 |
| 服务器 | 国内轻量应用服务器 2 核 4G（个人主体备案要求境内服务器） |
| 运行时 | Node.js ≥ 22（要用内置 `node:sqlite`）；本项目按 24 验证 |
| 反向代理 | Caddy（自动签发/续期 Let's Encrypt，省掉 certbot 运维） |
| 进程管理 | systemd，`Restart=always`，环境变量放 `/etc/pulse-record.env` |
| 数据库 | 单文件 SQLite（WAL 模式），`/var/lib/pulse-record/history.sqlite` |
| 备份 | 每日 03:00 `sqlite3 .backup`，保留 30 天，每月做一次恢复演练 |
| 端口 | 微信的 request 合法域名**不接受端口**，所以对外只暴露 443，由 Caddy 转到 127.0.0.1:5178 |
| 存储实现 | 现在是 SQLite；`server/store.mjs` 已把存储收敛成一层，迁 CloudBase PostgreSQL 只改那一处（见 [§7](#7-迁到-cloudbase) 与 `docs/cloudbase-migration.md`） |

---

## 1. 备案：整条时间线的关键路径

**备案必须在第一天就启动** —— 它不依赖任何开发工作，却是网站上线与小程序上线的共同前置。

### 1.1 域名注册与实名

- 域名后缀 `.cn` 或 `.com` 都可以。
- **实名主体必须与小程序主体一致**：小程序是个人主体 → 域名也要**个人实名**。
  主体不一致会导致 ICP 备案被拒、小程序也加不了 request 合法域名。
- 域名注册当天就能实名，实名审核 1~2 天。

### 1.2 ICP 备案

在域名注册商处提交备案（阿里云/腾讯云等都可以）。

- 初审 1~2 天（检查资料齐全性）→ 管局审核 **7~20 个工作日**。
- **备案期间域名不能解析到国内服务器**（管局要求），所以这段时间网站无法公网访问。
- 需要准备：身份证、域名证书、真实性核验单（个人）。

### 1.3 备案等待期怎么用

不要空转。等待期正好覆盖：

1. 小程序端的全部开发（8 个页面，不依赖任何资质）。
2. 局域网联调：服务器或本机跑服务，手机与电脑同一网段，
   在**微信开发者工具**里勾上「不校验合法域名」即可请求 `http://192.168.x.x:5178`。
3. 数据迁移预演（迁 CloudBase 的准备工作已在本轮完成，见 `docs/cloudbase-migration.md`）。

---

## 2. 服务器初始化

### 2.1 一键脚本

```bash
# 以 root 跑
DOMAIN=mai.example.com bash scripts/deploy/install.sh
```

脚本做的事：建 `pulse` 系统账号与数据目录 → 装 Node 24 → 装依赖并构建前端 →
写 `/etc/pulse-record.env` → 装 systemd 服务并启动 → 装 Caddy 并配好域名 →
装每日 03:00 的备份定时任务并手动跑一次验证。

可覆盖的环境变量：`DOMAIN` `SERVICE_USER` `DATA_DIR` `BACKUP_DIR` `REPO` `NODE_MAJOR`。

### 2.2 手工步骤（脚本挂了时的对照）

```bash
# 1) 服务账号与目录
useradd --system --home /var/lib/pulse-record --shell /usr/sbin/nologin pulse
mkdir -p /var/lib/pulse-record /backup
chown -R pulse:pulse /var/lib/pulse-record && chmod 750 /var/lib/pulse-record

# 2) Node（node:sqlite 需要 >= 22）
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs

# 3) 代码与构建
git clone <仓库> /opt/pulse-record
cd /opt/pulse-record && npm install && npm run build

# 4) 环境变量（密钥只在这台机器上）
install -m 600 /dev/null /etc/pulse-record.env && vi /etc/pulse-record.env
```

`/etc/pulse-record.env` 的内容：

```ini
PULSE_DB=/var/lib/pulse-record/history.sqlite
PULSE_SINGLE_USER=0        # 0＝多用户（要登录）；1＝单机（不用登录，本机自用）
PORT=5178
WX_APPID=wx…               # 微信小程序 AppID
WX_APPSECRET=…             # 微信小程序 AppSecret（**绝不入库、不进仓库**）
PULSE_CORS_ORIGINS=        # 同源部署留空即可；迁 CloudBase 后填静态托管域名
```

### 2.3 systemd

`scripts/deploy/pulse-record.service` 里有完整的安全加固（`ProtectSystem=strict`、
`ReadWritePaths` 只开数据目录、systemd 调用过滤、内存上限）。

```bash
install -m 644 scripts/deploy/pulse-record.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now pulse-record
journalctl -u pulse-record -f
```

> **注意**：Node 24 的 `node:sqlite` 目前仍带 `ExperimentalWarning`，日志里会出现一行
> `SQLite is an experimental feature`。这是**正常噪音**，不影响功能。

### 2.4 Caddy

```bash
sed 's/__DOMAIN__/mai.example.com/g' scripts/deploy/Caddyfile.example > /etc/caddy/Caddyfile
systemctl reload caddy
```

Caddyfile 里做三件事：反代到 `127.0.0.1:5178`（**同源**，所以网站与 API 之间不需要 CORS）、
关掉访问日志里的请求体（病例数据敏感）、加安全响应头。

### 2.5 验收

```bash
curl https://mai.example.com/api/health
# {"ok":true,"db":"/var/lib/pulse-record/history.sqlite","mode":"multi","sessionTtlDays":30}
```

- 浏览器打开 `https://mai.example.com` → 能注册、能登录、能建患者。
- **换浏览器/换设备登录同一账号 → 能看到同一份病例**（数据在服务端，不在浏览器里）。
- `systemctl restart pulse-record` → 服务自动拉起，库还在。
- `sqlite3 /var/lib/pulse-record/history.sqlite 'pragma integrity_check'` → `ok`

---

## 3. 日常运维

| 要做的事 | 命令 |
|---|---|
| 看日志 | `journalctl -u pulse-record -f` |
| 看最近 200 行 | `journalctl -u pulse-record -n 200` |
| 重启 | `systemctl restart pulse-record` |
| 看状态 | `systemctl status pulse-record` |
| 改环境变量 | `vi /etc/pulse-record.env && systemctl restart pulse-record` |
| 发新版本 | `bash scripts/deploy/deploy.sh root@<主机>`（自动备份 → 构建 → 切换 → 失败回滚） |
| 建账号 | `cd /opt/pulse-record && PULSE_DB=… npm run admin -- create <登录名>` |
| 重置某人密码 | `PULSE_DB=… npm run admin -- reset <登录名>` |
| 列出账号 | `PULSE_DB=… npm run admin -- list` |

### 3.1 单机模式还是多用户模式

`PULSE_SINGLE_USER=1` 时不用登录，所有请求算内置单机账号 —— **只适合自己在一台机器上用**。
对外提供服务必须是 `0`。

`/api/health` 的 `mode` 字段会明说是 `single` 还是 `multi`，前端页头也会显示「单机模式／多用户」标识，
避免使用者误判数据是否共享。

### 3.2 性能与容量

SQLite 已开 WAL（多读单写）＋ `busy_timeout=5000`，几十人规模绰绰有余。

**什么时候要换 PostgreSQL**：
持续出现并发写 `SQLITE_BUSY`，或用户数过百，或需要多机部署。
换的时候只改 `server/store.mjs` 一个文件（见 §7）。

---

## 4. 备份与恢复演练

### 4.1 备份

`scripts/deploy/backup.sh`，由 `/etc/cron.d/pulse-record-backup` 每日 03:00 触发，保留 30 天。

用的是 `sqlite3 .backup`（不是 `cp`）—— WAL 模式下直接复制 `.sqlite` 文件可能拿到半截事务。
脚本跑完会立刻做一次 `PRAGMA integrity_check`，不通过就报错。

### 4.2 恢复演练（每月一次）

**备份文件「存在」不等于「能用」。** 演练脚本把备份恢复到临时目录、打开、查完整性、比对行列数 ——
**不动生产库**：

```bash
bash scripts/deploy/restore.sh            # 用最新一份
bash scripts/deploy/restore.sh /backup/history-2026-11-02.sqlite
```

输出会对照「备份里的行数」与「当前生产库的行数」。行数对不上就是有问题。

### 4.3 真要恢复

```bash
systemctl stop pulse-record
cp /backup/history-2026-11-02.sqlite /var/lib/pulse-record/history.sqlite
chown pulse:pulse /var/lib/pulse-record/history.sqlite
systemctl start pulse-record
```

> 本机 `local-data/history.sqlite` 是**开发用**的库，不在版本库里（`.gitignore`），
> 也不需要备份 —— 生产数据只在服务器上。

---

## 5. 域名与微信后台配置

备案通过后按顺序做：

1. **DNS**：域名 A 记录 → 服务器公网 IP，TTL 600。
2. **Caddy**：`systemctl reload caddy`，Caddy 会自动申请证书。
   第一次可能需要把域名解析先指过去、等 DNS 生效（`dig mai.example.com` 确认）。
3. **微信公众平台** → 开发管理 → 开发设置 → 服务器域名 → **request 合法域名** →
   填 `https://mai.example.com`。
   - **不带路径、不带端口**、必须是 HTTPS、域名主体与小程序主体一致、域名已完成 ICP 备案。
   - **修改额度每月只有 50 次** —— 测试环境先配好再切正式，别反复试。

4. **真机预览**：微信开发者工具 → 预览 → 手机扫码。此时**不要**勾「不校验合法域名」，
   能正常请求就说明生产链路通了。

---

## 6. 小程序发布清单

小程序**不走服务器部署**（它跑在微信里），但要和网站共用同一个后端。

### 6.1 开工前

```bash
cd pulse-record
npm run build:core      # 编共享包（小程序的知识库与绘制代码）
```

然后用**微信开发者工具**打开 `pulse-record/miniprogram` 目录。

### 6.2 配置

| 位置 | 改什么 |
|---|---|
| `miniprogram/project.config.json` | `appid` 换成真实的小程序 AppID（个人主体也要先注册） |
| `miniprogram/utils/config.js` | `API_BASE` 换成 `https://mai.example.com`；`TRANSPORT` 保持 `'request'`（迁 CloudBase 后改 `'cloud'`） |
| `miniprogram/project.private.config.json` | 本地配置，**已 gitignore**，不要提交 |

> `AppSecret` **绝不入小程序包** —— 它只放在服务器的 `/etc/pulse-record.env`。
> 小程序只发 `wx.login` 拿到的 `code`，由服务端换 openid。

### 6.3 提审

- 类目选「**工具/效率**」，**不要选医疗**（个人主体做医疗类目过不了）。
- 登录页与首页都有「本工具只做记录，不构成诊断」的声明，**保留它**。
- 隐私保护指引：如实填写收集的信息（微信 openid、账号、病例记录）与用途。
- 小程序内**不提供诊断结论**，不出现「诊断」「治疗建议」这类表述。

### 6.4 类目与个人主体的硬约束（已核实）

| 能力 | 个人主体 |
|---|---|
| `wx.login` → `code2Session` | ✅ 可用（官方文档「适用范围：小程序」不按主体类型限制） |
| `web-view` 嵌网页 | ❌ 不可用（不支持业务域名）→ 必须原生开发 |
| `getPhoneNumber` | ❌ 不可用（需非个人主体＋微信认证＋已认证商户号）→ 账号绑定只走「网站账号＋密码」 |

---

## 7. 迁到 CloudBase

代码侧的准备**已经做完**（存储抽象层、全 async、CORS、`VITE_API_BASE`）。
迁移步骤、数据映射、坑位清单见 **[`docs/cloudbase-migration.md`](./cloudbase-migration.md)**。

一句话版本：把 `server/store.mjs` 换成 PostgreSQL 实现 → 服务端搬进 CloudBase 云函数 →
网站搬进静态托管（`PULSE_CORS_ORIGINS` 填静态域名）→ 小程序把 `TRANSPORT` 改成 `'cloud'`
（`wx.cloud.callFunction` **不走 request 合法域名校验**，备案没下来也能先跑通）。
