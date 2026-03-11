# NMS Deployment Runbook / NMS 部署 Runbook

> Updated: 2026-03-11

## 中文

### 1. 适用范围

这份文档面向两类场景：

- 首次部署 NMS
- 升级已有的 NMS 实例

默认约定：

- 代码工作区：`/root/NMS`
- 运行目录：`/opt/nms`
- 服务端口：`3001`
- PM2 应用名：`nms`

### 2. 部署前检查

建议在开始前确认：

- 系统为 `Ubuntu 20.04+` 或 `Debian 11+`
- Node.js 版本为 `18+`，推荐 `20 LTS`
- 目标服务器已放行 `80`、`443`，以及需要时的 `3001`
- 准备好一套强密码和两段独立随机密钥：
  - `JWT_SECRET`
  - `CREDENTIALS_SECRET`
- 如果公网使用订阅链接，准备好最终域名，例如 `https://nms.example.com`

### 3. 源码部署

#### 3.1 安装基础依赖

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo npm install -g pm2
```

#### 3.2 拷贝代码到运行目录

```bash
sudo mkdir -p /opt/nms
sudo cp -r /root/NMS/. /opt/nms/
```

#### 3.3 安装依赖并构建前端

```bash
cd /opt/nms/server && npm install --production
cd /opt/nms/client && npm install && npm run build
```

#### 3.4 配置环境变量

```bash
cd /opt/nms
cp .env.example .env
```

生产环境至少要修改：

- `JWT_SECRET`
- `CREDENTIALS_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

强烈建议同时配置：

- `SUB_PUBLIC_BASE_URL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

数据库模式可选配置：

- `DB_ENABLED=true`
- `DB_URL=postgres://...`
- `STORE_READ_MODE=db`
- `STORE_WRITE_MODE=dual` 或 `db`

#### 3.5 启动服务

```bash
cd /opt/nms
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root
```

默认访问地址：

- `http://服务器IP:3001`

### 4. Docker / GHCR 部署

仓库已提供 `Dockerfile`，也可直接使用 GHCR 镜像：

- `ghcr.io/zangge8855/nms:latest`
- `ghcr.io/zangge8855/nms:<commit_sha>`

示例：

```bash
docker run -d \
  --name nms \
  -p 3001:3001 \
  -v /opt/nms/data:/app/data \
  -v /opt/nms/logs:/app/logs \
  --env-file /opt/nms/.env \
  ghcr.io/zangge8855/nms:latest
```

说明：

- `.env` 仍然由你自己维护
- `data/` 和 `logs/` 要持久化挂载
- 若启用反代，公网建议走 `80/443`，容器端口继续保留 `3001`

### 5. Nginx 反向代理

建议把 NMS 放在标准 HTTPS 站点后面，并同时代理 HTTP 与 WebSocket：

```nginx
server {
    listen 80;
    server_name nms.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name nms.example.com;

    ssl_certificate     /etc/letsencrypt/live/nms.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/nms.example.com/privkey.pem;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://127.0.0.1:3001/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

完成后请把系统设置中的订阅公网地址设为：

- `https://nms.example.com`

### 6. 首次上线后的初始化

建议按这个顺序做：

1. 使用 `.env` 中的管理员账号登录
2. 进入“系统设置”，设置订阅公网地址
3. 配置 SMTP，并执行一次 SMTP 连接测试
4. 在“服务器管理”中添加 3x-ui 节点并验证连通性
5. 在“入站管理”检查节点拉取结果
6. 在“用户管理 / 订阅中心”验证订阅链接可访问
7. 如需承接旧系统地址，为用户设置兼容订阅路径

### 7. 升级现有实例

推荐顺序：

#### 7.1 在工作区构建和测试

```bash
cd /root/NMS/client && npm install && npm run build
cd /root/NMS/client && npm test
cd /root/NMS/server && npm test
```

#### 7.2 同步前端产物

```bash
mkdir -p /opt/nms/client/dist/assets
cp -R /root/NMS/client/dist/assets/. /opt/nms/client/dist/assets/
cp /root/NMS/client/dist/index.html /opt/nms/client/dist/index.html
```

#### 7.3 同步后端和配置文件

```bash
rsync -av --delete /root/NMS/server/ /opt/nms/server/
rsync -av /root/NMS/client/public/ /opt/nms/client/public/
rsync -av /root/NMS/ecosystem.config.cjs /opt/nms/
```

如 `package.json` 或锁文件有变化，再执行：

```bash
cd /opt/nms/server && npm install --production
```

#### 7.4 重启服务

```bash
pm2 restart nms
```

### 8. 备份与回滚建议

至少要备份：

- `/opt/nms/.env`
- `/opt/nms/data/`
- `/opt/nms/logs/`
- 如果启用了数据库模式，还要备份 PostgreSQL 数据库

回滚时建议成组回退：

- 后端代码
- 前端 `client/dist`
- `.env`
- 数据目录或数据库快照

不要只回滚其中一部分，否则容易出现接口和前端 bundle 不匹配。

### 9. 验证清单

服务状态：

```bash
pm2 list
pm2 logs nms --lines 100
```

前端首页：

```bash
curl -sS http://127.0.0.1:3001/
```

接口连通：

```bash
curl -sS http://127.0.0.1:3001/api/auth/check
```

建议人工回归这些页面：

- `/login`
- `/`
- `/servers`
- `/inbounds`
- `/clients`
- `/subscriptions`
- `/audit`
- `/tasks`
- `/logs`
- `/settings`

### 10. 常见问题

#### 10.1 打开页面返回 `503 Frontend build missing`

说明运行目录缺少 `client/dist/index.html`。重新构建并同步前端产物即可。

#### 10.2 登录正常但某些页面是空白

优先检查：

- 前后端是否来自同一版本
- `client/dist/assets` 和 `index.html` 是否同步完整
- 浏览器是否缓存了旧 bundle

#### 10.3 订阅地址里出现 `localhost` 或内网地址

请到系统设置中填写订阅公网地址，或在 `.env` 中设置 `SUB_PUBLIC_BASE_URL`。

#### 10.4 WebSocket 不通，仪表盘实时状态不更新

优先检查：

- Nginx 是否代理了 `/ws`
- 是否保留了 `Upgrade` / `Connection` 头
- HTTPS 和站点域名是否一致

#### 10.5 数据库模式切换后数据不完整

确认：

- `DB_ENABLED=true`
- `DB_URL` 可用
- `STORE_READ_MODE` / `STORE_WRITE_MODE` 正确
- 是否已经执行过回填

### 11. 发布前 Git 检查

发布前确认：

- `.env` 没有入库
- `data/**/*.json` 没有入库
- `client/dist`、`node_modules`、截图、临时脚本没有入库
- 使用说明、部署文档与当前实现一致

---

## English

### 1. Scope

This runbook covers:

- first-time NMS deployment
- upgrading an existing NMS instance

Default assumptions:

- workspace repo: `/root/NMS`
- runtime path: `/opt/nms`
- service port: `3001`
- PM2 app name: `nms`

### 2. Preflight Checklist

Before deployment, confirm:

- the host runs `Ubuntu 20.04+` or `Debian 11+`
- Node.js is `18+`, preferably `20 LTS`
- ports `80`, `443`, and optionally `3001` are available
- you have strong secrets ready for:
  - `JWT_SECRET`
  - `CREDENTIALS_SECRET`
- you know the final public base URL, for example `https://nms.example.com`

### 3. Source Deployment

#### 3.1 Install dependencies

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo npm install -g pm2
```

#### 3.2 Copy the project into the runtime directory

```bash
sudo mkdir -p /opt/nms
sudo cp -r /root/NMS/. /opt/nms/
```

#### 3.3 Install dependencies and build the frontend

```bash
cd /opt/nms/server && npm install --production
cd /opt/nms/client && npm install && npm run build
```

#### 3.4 Create the runtime environment file

```bash
cd /opt/nms
cp .env.example .env
```

At minimum, change:

- `JWT_SECRET`
- `CREDENTIALS_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

Strongly recommended:

- `SUB_PUBLIC_BASE_URL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

Optional DB mode settings:

- `DB_ENABLED=true`
- `DB_URL=postgres://...`
- `STORE_READ_MODE=db`
- `STORE_WRITE_MODE=dual` or `db`

#### 3.5 Start the service

```bash
cd /opt/nms
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root
```

Default access URL:

- `http://SERVER_IP:3001`

### 4. Docker / GHCR Deployment

The repo ships a `Dockerfile`, and GHCR images are also published:

- `ghcr.io/zangge8855/nms:latest`
- `ghcr.io/zangge8855/nms:<commit_sha>`

Example:

```bash
docker run -d \
  --name nms \
  -p 3001:3001 \
  -v /opt/nms/data:/app/data \
  -v /opt/nms/logs:/app/logs \
  --env-file /opt/nms/.env \
  ghcr.io/zangge8855/nms:latest
```

Notes:

- maintain the `.env` file yourself
- persist both `data/` and `logs/`
- for public traffic, put the container behind HTTPS and keep the internal port at `3001`

### 5. Nginx Reverse Proxy

NMS should typically sit behind HTTPS with both HTTP and WebSocket proxying:

```nginx
server {
    listen 80;
    server_name nms.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name nms.example.com;

    ssl_certificate     /etc/letsencrypt/live/nms.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/nms.example.com/privkey.pem;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://127.0.0.1:3001/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

After that, set the subscription public base URL to:

- `https://nms.example.com`

### 6. Initial Post-Deploy Setup

Recommended order:

1. Log in with the admin account from `.env`
2. Open `System Settings` and set the public subscription base URL
3. Configure SMTP and run an SMTP test
4. Add your 3x-ui nodes under `Servers`
5. Confirm inbound sync under `Inbounds`
6. Verify subscription URLs under `Users / Subscriptions`
7. If you are migrating from another system, assign legacy subscription alias paths to users

### 7. Upgrade an Existing Instance

Recommended order:

#### 7.1 Build and test in the workspace

```bash
cd /root/NMS/client && npm install && npm run build
cd /root/NMS/client && npm test
cd /root/NMS/server && npm test
```

#### 7.2 Sync frontend artifacts

```bash
mkdir -p /opt/nms/client/dist/assets
cp -R /root/NMS/client/dist/assets/. /opt/nms/client/dist/assets/
cp /root/NMS/client/dist/index.html /opt/nms/client/dist/index.html
```

#### 7.3 Sync backend files and runtime config

```bash
rsync -av --delete /root/NMS/server/ /opt/nms/server/
rsync -av /root/NMS/client/public/ /opt/nms/client/public/
rsync -av /root/NMS/ecosystem.config.cjs /opt/nms/
```

If dependencies changed, run:

```bash
cd /opt/nms/server && npm install --production
```

#### 7.4 Restart

```bash
pm2 restart nms
```

### 8. Backup and Rollback

At minimum, back up:

- `/opt/nms/.env`
- `/opt/nms/data/`
- `/opt/nms/logs/`
- the PostgreSQL database if DB mode is enabled

Rollback should treat these as one release unit:

- backend code
- frontend `client/dist`
- `.env`
- data directory or DB snapshot

Avoid rolling back only one layer, or the frontend and backend may drift out of sync.

### 9. Validation Checklist

Service state:

```bash
pm2 list
pm2 logs nms --lines 100
```

Frontend root:

```bash
curl -sS http://127.0.0.1:3001/
```

API health:

```bash
curl -sS http://127.0.0.1:3001/api/auth/check
```

Recommended manual checks:

- `/login`
- `/`
- `/servers`
- `/inbounds`
- `/clients`
- `/subscriptions`
- `/audit`
- `/tasks`
- `/logs`
- `/settings`

### 10. Common Issues

#### 10.1 `503 Frontend build missing`

The runtime instance is missing `client/dist/index.html`. Rebuild the frontend and sync the generated artifacts.

#### 10.2 Login works but some pages are blank

Check:

- frontend and backend come from the same release
- both `client/dist/assets` and `index.html` were synced
- the browser is not serving a cached bundle

#### 10.3 Subscription URLs show `localhost` or a private address

Set the public subscription base URL in `System Settings` or via `SUB_PUBLIC_BASE_URL`.

#### 10.4 WebSocket is broken and dashboard live status does not update

Check:

- Nginx proxies `/ws`
- `Upgrade` and `Connection` headers are preserved
- the public protocol and domain are correct

#### 10.5 DB mode does not show the expected data

Confirm:

- `DB_ENABLED=true`
- `DB_URL` is reachable
- `STORE_READ_MODE` and `STORE_WRITE_MODE` are correct
- the backfill step was actually run

### 11. Pre-Push Git Hygiene

Before pushing:

- do not commit `.env`
- do not commit `data/**/*.json`
- do not commit `client/dist`, `node_modules`, screenshots, or temporary scripts
- keep deployment and usage docs aligned with the actual runtime behavior
