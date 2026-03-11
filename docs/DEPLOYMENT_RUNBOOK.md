# Deployment Runbook

## 中文

### 适用范围

本 Runbook 适用于单机部署、PM2 部署、Docker 部署，以及通过反向代理提供 HTTPS 与 WebSocket 的生产环境。

### 上线前检查

- 已修改 `.env` 中所有默认口令和默认密钥
- 已设置 `ADMIN_USERNAME`、`ADMIN_PASSWORD`、`JWT_SECRET`、`CREDENTIALS_SECRET`
- 已确认 `SUB_PUBLIC_BASE_URL` 为真实公网地址
- 已准备数据目录备份方案
- 已确认反向代理支持 WebSocket Upgrade

### 方式一：源码部署

```bash
cd client
npm ci
npm run build

cd ../server
npm ci
NODE_ENV=production node index.js
```

如需常驻运行，可使用仓库根目录的 `ecosystem.config.cjs`：

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

### 方式二：Docker 部署

仓库根目录已提供多阶段 `Dockerfile`，会完成：

- `client/` 依赖安装与构建
- `server/` 生产依赖安装
- 运行镜像拼装

示例：

```bash
docker build -t ghcr.io/<your-github-user-or-org>/nms:latest .
docker run -d \
  --name nms \
  -p 3001:3001 \
  --env-file .env \
  -v /opt/nms/data:/app/data \
  -v /opt/nms/logs:/app/logs \
  ghcr.io/<your-github-user-or-org>/nms:latest
```

### 反向代理

反向代理需要同时处理：

- `/` 与静态资源
- `/api/*`
- WebSocket 相关请求

关键要求：

- 开启 HTTPS
- 透传 `X-Forwarded-For`、`X-Forwarded-Proto`
- 开启 `Upgrade` / `Connection` 头
- 将外部域名写入 `SUB_PUBLIC_BASE_URL`

### 升级流程

1. 备份 `data/` 与 `.env`
2. 拉取新代码或新镜像
3. 重新构建前端或替换容器镜像
4. 重启服务
5. 执行上线验证

### 回滚流程

1. 停止当前服务
2. 切回上一个 Git 提交或上一个镜像标签
3. 恢复 `data/` 与 `.env` 备份
4. 启动服务并重新验证

### 备份建议

- 文件模式：至少备份 `data/`、`.env`、`logs/`
- DB 模式：同时备份 PostgreSQL 数据库与 `data/` 中仍在使用的文件
- 升级前必须做一次冷备份或快照

### 上线验证

- `/api/auth/check` 返回正常
- 管理员可以登录
- Dashboard 正常展示数据
- 节点状态更新正常
- Subscriptions 页面可生成链接
- Audit 与 Traffic 页面可打开
- Modal、Dropdown、Sidebar 无渲染异常

### 快速排障

#### 登录失败

- 检查 `ADMIN_USERNAME` 与 `ADMIN_PASSWORD`
- 检查浏览器与代理是否允许 Cookie

#### 前端空白

- 检查 `client/dist` 是否存在
- 检查是否在生产模式或设置了 `SERVE_CLIENT=true`

#### 节点请求失败

- 检查面板地址、TLS 配置和可达性
- 检查是否错误启用了内网地址限制

#### WebSocket 不可用

- 检查代理的 `Upgrade` 配置
- 检查 `WS_TICKET_TTL_SECONDS` 与系统时间同步

## English

### Scope

This runbook covers single-host deployments, PM2-based setups, Docker deployments, and reverse-proxy production environments with HTTPS and WebSocket support.

### Preflight checklist

- All default passwords and secrets in `.env` have been changed
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET`, and `CREDENTIALS_SECRET` are set
- `SUB_PUBLIC_BASE_URL` points to the real public endpoint
- A backup strategy exists for the data directory
- The reverse proxy supports WebSocket upgrade

### Option 1: source deployment

```bash
cd client
npm ci
npm run build

cd ../server
npm ci
NODE_ENV=production node index.js
```

For process supervision, use `ecosystem.config.cjs`:

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

### Option 2: Docker deployment

The root `Dockerfile` already performs:

- client dependency install and build
- server production dependency install
- final runtime image assembly

Example:

```bash
docker build -t ghcr.io/<your-github-user-or-org>/nms:latest .
docker run -d \
  --name nms \
  -p 3001:3001 \
  --env-file .env \
  -v /opt/nms/data:/app/data \
  -v /opt/nms/logs:/app/logs \
  ghcr.io/<your-github-user-or-org>/nms:latest
```

### Reverse proxy

The proxy must handle:

- `/` and static assets
- `/api/*`
- WebSocket-related traffic

Key requirements:

- enable HTTPS
- forward `X-Forwarded-For` and `X-Forwarded-Proto`
- support `Upgrade` and `Connection` headers
- set the public host in `SUB_PUBLIC_BASE_URL`

### Upgrade workflow

1. Back up `data/` and `.env`
2. Pull the new code or image
3. Rebuild the client or replace the container image
4. Restart the service
5. Run the post-deploy checks

### Rollback workflow

1. Stop the current service
2. Switch back to the previous Git revision or image tag
3. Restore the `data/` and `.env` backups
4. Start the service and validate again

### Backup guidance

- File mode: back up `data/`, `.env`, and `logs/`
- DB mode: back up PostgreSQL and any still-active file-backed artifacts
- Take a cold backup or snapshot before every upgrade

### Post-deploy validation

- `/api/auth/check` responds correctly
- Admin login succeeds
- Dashboard loads real data
- Server health updates work
- Subscription links can be generated
- Audit and Traffic pages open correctly
- Modal, dropdown, and sidebar interactions render without glitches

### Quick troubleshooting

#### Login fails

- Verify `ADMIN_USERNAME` and `ADMIN_PASSWORD`
- Confirm cookies are not blocked by the browser or proxy

#### Blank frontend

- Check that `client/dist` exists
- Confirm production mode or `SERVE_CLIENT=true`

#### Panel calls fail

- Verify panel URL, TLS settings, and network reachability
- Check whether private URL restrictions are blocking the target

#### WebSocket fails

- Verify proxy upgrade handling
- Check `WS_TICKET_TTL_SECONDS` and system time synchronization
