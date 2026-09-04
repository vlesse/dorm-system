# 部署文档

从零把系统部署到一台 Linux 服务器，配好域名和 HTTPS。全程约 20 分钟。

- [1. 服务器要求](#1-服务器要求)
- [2. 准备服务器](#2-准备服务器)
- [3. 本地构建产物](#3-本地构建产物)
- [4. 上传与初始化](#4-上传与初始化)
- [5. systemd 托管服务](#5-systemd-托管服务)
- [6. nginx 反向代理](#6-nginx-反向代理)
- [7. HTTPS 证书](#7-https-证书)
- [8. 初始化账号与数据](#8-初始化账号与数据)
- [9. 日常更新](#9-日常更新)
- [10. 备份](#10-备份)
- [11. 排障](#11-排障)
- [12. 上生产前必须做的事](#12-上生产前必须做的事)

---

## 1. 服务器要求

| | 最低 | 建议 |
|---|---|---|
| 内存 | 1 GB | 2 GB |
| 磁盘 | 5 GB | 20 GB（含数据库增长与备份） |
| 系统 | Ubuntu 22.04 / Debian 12 / 任何有 systemd 的发行版 | Ubuntu 24.04 |
| Node | ≥ 20 | 22 LTS |

服务本身运行时约占 **140 MB** 内存，SQLite 单文件数据库（三千床位规模约 20 MB）。

> ⚠️ **不要在 1GB 内存的机器上跑 `vite build`** —— 前端构建峰值超过 1 GB，会 OOM，
> 还可能把机器上的其他服务挤掉。**构建在本地做，只上传产物**（见第 3 步）。

需要：一个已解析到该服务器 IP 的域名（本文以 `dorm.example.com` 为例）。

---

## 2. 准备服务器

```bash
apt update && apt install -y nginx curl

# Node 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v      # 应输出 v22.x
```

---

## 3. 本地构建产物

在你的**开发机**上（不是服务器）：

```bash
git clone https://github.com/vlesse/dorm-system.git
cd dorm-system
npm install

npm run build -w web                 # → web/dist        前端静态文件
npx tsc -p server/tsconfig.json      # → server/dist      编译后的服务端

tar -czf /tmp/dorm-web.tgz -C web/dist .
tar -czf /tmp/dorm-srv.tgz -C server/dist .
```

---

## 4. 上传与初始化

```bash
SERVER=root@dorm.example.com

scp /tmp/dorm-web.tgz /tmp/dorm-srv.tgz $SERVER:/tmp/
scp server/prisma/schema.prisma $SERVER:/tmp/
scp package.json server/package.json $SERVER:/tmp/    # 第二个会覆盖，见下

ssh $SERVER
```

在服务器上：

```bash
mkdir -p /opt/dorm-system/{dist,web,prisma,data}
tar -xzf /tmp/dorm-srv.tgz -C /opt/dorm-system/dist
tar -xzf /tmp/dorm-web.tgz -C /opt/dorm-system/web
cp /tmp/schema.prisma /opt/dorm-system/prisma/
chmod -R a+rX /opt/dorm-system/web

cd /opt/dorm-system

# 只装运行时依赖
cat > package.json <<'EOF'
{
  "name": "dorm-system-runtime",
  "private": true,
  "type": "module",
  "dependencies": {
    "@fastify/cors": "^10.0.1",
    "@prisma/client": "^6.1.0",
    "fastify": "^5.2.0",
    "prisma": "^6.1.0"
  }
}
EOF
npm install --omit=dev

# 环境变量
cat > .env <<'EOF'
DATABASE_URL="file:/opt/dorm-system/data/dorm.db"
API_PORT=3101
API_HOST=127.0.0.1
JWT_SECRET=换成你自己的随机串
EOF
chmod 600 .env

# 生成随机 JWT 密钥
sed -i "s|JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env

# 建库
npx prisma db push --skip-generate
npx prisma generate
```

**`API_HOST=127.0.0.1` 很重要**：Node 只监听本机，TLS 由前面的 nginx 终结。
不这么设的话，`http://服务器IP:3101` 会绕过 HTTPS 直连明文 API。

**`JWT_SECRET` 必须换掉**。不设的话代码会用一个内置默认值 ——
那意味着任何人都能伪造管理员 token。

---

## 5. systemd 托管服务

```bash
cat > /etc/systemd/system/dorm-system.service <<'EOF'
[Unit]
Description=Dormitory Management System API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/dorm-system
EnvironmentFile=/opt/dorm-system/.env
ExecStart=/usr/bin/node /opt/dorm-system/dist/index.js
Restart=always
RestartSec=5

# 小内存机器上给个上限，跑飞了也压不垮同机的其他服务
MemoryHigh=256M
MemoryMax=320M
CPUWeight=50

NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now dorm-system
systemctl is-active dorm-system          # active
curl -s localhost:3101/api/health        # {"ok":true,...}
```

---

## 6. nginx 反向代理

```bash
cat > /etc/nginx/sites-available/dorm.example.com <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name dorm.example.com;

    root /opt/dorm-system/web;
    index index.html;

    # 前端是 SPA，所有非 /api 路径都回落到 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 带指纹的静态资源可以长缓存
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3101;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    client_max_body_size 20m;   # 批量导入的文件在前端解析，这里给点余量
}
EOF

ln -sf /etc/nginx/sites-available/dorm.example.com /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

> **`nginx -t` 不要跳过**。如果这台机器上还有别的站点，配置写错会让它们一起 502。

---

## 7. HTTPS 证书

用 Let's Encrypt 免费证书，certbot 会自动改上面的 vhost 并配好自动续期：

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d dorm.example.com --agree-tos -m you@example.com --redirect -n

# 验证自动续期能跑通
certbot renew --dry-run
systemctl status certbot.timer
```

`--redirect` 会自动加上 HTTP → HTTPS 的 301。

---

## 8. 初始化账号与数据

**方式 A：连模拟数据一起灌（用于演示 / 试用）**

需要把 `server/prisma/seed.ts` 和 `seed-platform.ts` 传上去并用 tsx 运行，
或者更简单 —— **在本地跑完 seed，把生成好的 `dorm.db` 直接传上去**：

```bash
# 本地
npm run db:seed
scp server/prisma/dev.db $SERVER:/opt/dorm-system/data/dorm.db
ssh $SERVER 'systemctl restart dorm-system'
```

**方式 B：空库 + 只建管理员（用于真实投用）**

```bash
cd /opt/dorm-system
node -e '
const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");
const p = new PrismaClient();
const pw = process.argv[1];
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
(async () => {
  const role = await p.role.create({ data: { code: "ADMIN", name: "系统管理员", permissions: JSON.stringify(["*"]) } });
  await p.user.create({ data: { username: "admin", passwordHash: `${salt}:${hash}`, displayName: "系统管理员", roleId: role.id, mustChangePassword: true } });
  console.log("admin 已创建");
  await p.$disconnect();
})();
' "$(openssl rand -base64 18)"
```

然后登录后在「设置 → 基础配置」里逐项建国籍、部门、职级、房型，
再用「批量导入」把楼栋房间和人员灌进去（见 [产品功能说明](FEATURES.md#批量导入)）。

---

## 9. 日常更新

在本地仓库根目录：

```bash
SERVER=root@dorm.example.com

# 1. 本地构建
npm run build -w web
npx tsc -p server/tsconfig.json

# 2. 服务端
tar -czf /tmp/srv.tgz -C server/dist .
scp /tmp/srv.tgz $SERVER:/tmp/
ssh $SERVER 'rm -rf /opt/dorm-system/dist && mkdir -p /opt/dorm-system/dist \
  && tar -xzf /tmp/srv.tgz -C /opt/dorm-system/dist \
  && systemctl restart dorm-system && systemctl is-active dorm-system'

# 3. 前端
tar -czf /tmp/web.tgz -C web/dist .
scp /tmp/web.tgz $SERVER:/tmp/
ssh $SERVER 'rm -rf /opt/dorm-system/web && mkdir -p /opt/dorm-system/web \
  && tar -xzf /tmp/web.tgz -C /opt/dorm-system/web \
  && chmod -R a+rX /opt/dorm-system/web && systemctl reload nginx'
```

**改了 `schema.prisma` 的话**，先备份数据库，再迁移：

```bash
ssh $SERVER 'cd /opt/dorm-system \
  && cp data/dorm.db data/dorm.db.bak.$(date +%F) \
  && cp /tmp/schema.prisma prisma/ \
  && npx prisma db push --skip-generate && npx prisma generate \
  && systemctl restart dorm-system'
```

---

## 10. 备份

SQLite **不能直接 `cp` 正在写的库文件**（可能拷到不一致的中间状态），
用 `.backup` 命令做在线热备：

```bash
apt install -y sqlite3

cat > /etc/cron.daily/dorm-backup <<'EOF'
#!/bin/sh
D=/opt/dorm-system/backups
mkdir -p $D
sqlite3 /opt/dorm-system/data/dorm.db ".backup '$D/dorm-$(date +%F).db'"
gzip -f $D/dorm-$(date +%F).db
find $D -name 'dorm-*.db.gz' -mtime +30 -delete
EOF
chmod +x /etc/cron.daily/dorm-backup
```

**本机备份不算备份** —— 至少再往对象存储或另一台机器同步一份。

---

## 11. 排障

```bash
systemctl status dorm-system                          # 服务状态
journalctl -u dorm-system -n 100 --no-pager           # 应用日志
journalctl -u dorm-system -f                          # 跟踪日志
curl -s localhost:3101/api/health                     # 后端是否存活
tail -f /var/log/nginx/error.log                      # nginx 报错
systemctl show dorm-system -p MemoryCurrent --value   # 当前内存占用
ss -ltnp | grep 3101                                  # 确认只监听 127.0.0.1
```

| 症状 | 多半是 |
|---|---|
| 页面白屏，控制台 404 `/assets/*.js` | `/opt/dorm-system/web` 没解压对，或 nginx `root` 写错 |
| 页面能开但接口全 502 | Node 没起来 —— `journalctl -u dorm-system` |
| 刷新子页面 404 | nginx 缺 `try_files ... /index.html` |
| 登录一直 401 | `.env` 的 `JWT_SECRET` 改过而旧 token 还在 —— 清 localStorage 重登 |
| 服务反复重启 | 多半 OOM，看 `journalctl -k | grep -i oom`，调大 `MemoryMax` 或加内存 |
| `PrismaClientInitializationError` | `DATABASE_URL` 路径不对，或 `npx prisma generate` 没跑 |

---

## 12. 上生产前必须做的事

演示环境可以省，**真录入人员信息之前一条都不能省**：

- [ ] **改掉所有默认密码**，并把 `mustChangePassword` 打开
      （`server/prisma/seed-platform.ts` 里的 `DEMO_PASSWORD` 是公开演示用的）
- [ ] **设置独立的 `JWT_SECRET`**，不要用默认值
- [ ] **换 PostgreSQL**。`schema.prisma` 按 PG 兼容写法书写，改 `provider` 重新迁移即可。
      SQLite 单文件没有主从、没有并发写扩展性，几百人同时在线会成为瓶颈
- [ ] **配好自动备份并验证能恢复**（第 10 节，恢复演练比备份本身重要）
- [ ] **加访问限制** —— 内网 / VPN / IP 白名单，或至少上双因子
- [ ] **接监控告警** —— 现在服务挂了只有 systemd 自动重启，没人会知道
- [ ] **检查数据合规** —— 系统会存护照 / KITAS / 宗教信仰等敏感个人信息，
      印尼 PDP 法（UU 27/2022）对这类数据有明确的存储与告知要求，落地前请咨询本地法务
