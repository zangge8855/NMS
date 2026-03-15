# Deployment Runbook

## English

### Scope

This runbook is for single-host deployments, PM2-managed processes, Docker packaging, and reverse-proxy production environments that need HTTPS and WebSocket support.

### Recommended Production Shape

- Run NMS behind Nginx or Traefik for HTTPS termination and WebSocket forwarding
- Keep `data/` and `logs/` on persistent storage, or connect PostgreSQL when you need DB-backed runtime modes
- Store `.env` outside the repository lifecycle and back it up with the deployment
- Keep `.env`, `data/*.json`, `logs/`, and build output outside Git; only templates and documentation should be committed
- Set `SUB_PUBLIC_BASE_URL` to the real external domain before sharing subscription links
- The UI homepage defaults to `/`; if you later move it to a custom path in `Settings`, keep `/api`, `/ws`, and subscription public routes reachable
- If you enable the camouflage landing page, keep the real UI access path documented internally; only the public-facing fallback page should remain visible on `/` or other non-matching document paths
- Enable SMTP only when you need registration, verification, or password reset mail

### Preflight Checklist

- `.env` exists and all default passwords or secrets have been replaced
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET`, and `CREDENTIALS_SECRET` are set
- The target host has Node.js `20+` or Docker installed
- The reverse proxy is ready to forward `Upgrade` and `Connection` headers
- A backup plan exists for `data/`, `.env`, and any PostgreSQL database used by the deployment

### Option 1: Source Deployment

Build the client:

```bash
cd client
npm ci
npm run build
```

Install server dependencies and start:

```bash
cd ../server
npm ci
NODE_ENV=production node scripts/start_production.js
```

To keep the process supervised:

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

The production startup entry now runs a preflight that fails fast when `.env` is unsafe or `client/dist/index.html` is missing.

### Option 2: Docker Deployment

The root `Dockerfile` already builds the client, installs server production dependencies, and starts the runtime on port `3001`.

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

### Reverse Proxy Requirements

The proxy must handle:

- `/` or your configured homepage path, plus static assets
- `/api/*`
- WebSocket traffic
- `/api/subscriptions/public/*`

Recommended proxy behavior:

- Force HTTPS on the public endpoint
- Forward `X-Forwarded-For` and `X-Forwarded-Proto`
- Preserve `Upgrade` and `Connection` headers
- Keep the public hostname aligned with `SUB_PUBLIC_BASE_URL`
- If you change the homepage path in `Settings`, update bookmarks and proxy rules, but do not rewrite the subscription public API path
- If camouflage is enabled, only unmatched document requests should fall back to the public landing page; `/api`, `/ws`, and subscription routes must keep their normal behavior

### Upgrade Workflow

1. Back up `data/`, `.env`, and the PostgreSQL database if enabled.
2. Pull the new Git revision or new container image.
3. Rebuild the frontend or replace the container image.
4. Restart NMS.
5. Run post-deploy validation before opening traffic broadly.

### Rollback Workflow

1. Stop the current process or container.
2. Switch back to the previous Git revision or previous image tag.
3. Restore `data/`, `.env`, and DB backups if the release changed stored state.
4. Start the previous version and repeat the validation checks.

### Operational Conveniences

NMS is easier to operate in production because it already includes:

- backup export and restore endpoints
- SMTP connectivity diagnostics
- health monitoring and notification stats
- file / dual-write / database runtime modes
- admin-side audit records for sensitive system actions

### Post-Deploy Validation

- `GET /api/auth/check` responds correctly
- Admin login succeeds
- The configured homepage path opens normally
- If camouflage is enabled, `/` or another non-matching document path shows the public landing page while the real UI path still opens normally
- The dashboard loads without frontend errors
- Node health status refreshes correctly
- Subscription links can be generated
- Audit and traffic pages open normally
- WebSocket-driven status areas work behind the proxy

### Quick Troubleshooting

#### Login fails

- Verify `ADMIN_USERNAME` and `ADMIN_PASSWORD`
- Confirm cookies are not blocked by the browser or proxy

#### Blank frontend

- Check that `client/dist` exists in source deployments
- Confirm production mode or `SERVE_CLIENT=true` if you expect the backend to serve the UI

#### Panel requests fail

- Verify panel URL, TLS settings, username, and password
- Check whether private-address restrictions are blocking the target

#### WebSocket does not connect

- Verify proxy upgrade handling
- Check `WS_TICKET_TTL_SECONDS` and host time synchronization

#### Subscription links look wrong

- Verify `SUB_PUBLIC_BASE_URL`
- Check whether the reverse proxy rewrites host or scheme unexpectedly
- Do not expect the homepage access path to change subscription URLs; that setting only affects where the UI is served
- The camouflage landing page also does not change subscription URLs; it is only a public-facing HTML fallback

## 中文

### 适用范围

本 Runbook 适用于单机部署、PM2 常驻进程、Docker 镜像交付，以及需要 HTTPS 和 WebSocket 的反向代理生产环境。

### 推荐生产形态

- 用 Nginx 或 Traefik 放在 NMS 前面处理 HTTPS 和 WebSocket 转发
- 将 `data/`、`logs/` 放到持久化存储；如果需要数据库运行模式，再接 PostgreSQL
- 将 `.env` 放在仓库生命周期之外管理，并和部署一起备份
- `.env`、`data/*.json`、`logs/` 和构建产物不要提交进 Git，仓库里只保留模板和文档
- 在对外发放订阅链接前，先把 `SUB_PUBLIC_BASE_URL` 设置成真实公网域名
- 后台首页默认走 `/`；如果后续在 `系统设置` 里改成自定义路径，也要继续保留 `/api`、`/ws` 和订阅公开地址可访问
- 只有在需要注册、验证邮件或找回密码时才开启 SMTP
- 登录页的“忘记密码”接口默认会隐藏邮箱是否存在的结果；上线前只需要确认 SMTP 可用，不需要额外暴露用户是否已注册

### 上线前检查

- 已创建 `.env`，并替换掉所有默认口令和默认密钥
- 已设置 `ADMIN_USERNAME`、`ADMIN_PASSWORD`、`JWT_SECRET`、`CREDENTIALS_SECRET`
- 目标机器已安装 Node.js `20+` 或 Docker
- 反向代理已经支持 `Upgrade` 与 `Connection` 头
- 已准备 `data/`、`.env` 和 PostgreSQL 的备份方案

### 方式一: 源码部署

先构建前端:

```bash
cd client
npm ci
npm run build
```

再安装后端依赖并启动:

```bash
cd ../server
npm ci
NODE_ENV=production node scripts/start_production.js
```

如需进程托管:

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

新的生产启动入口会先执行 preflight；如果 `.env` 不安全或 `client/dist/index.html` 缺失，会在真正启动前直接失败并输出修复提示。

### 方式二: Docker 部署

仓库根目录的 `Dockerfile` 已经包含前端构建、后端生产依赖安装和运行镜像组装，默认监听 `3001` 端口。

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

### 反向代理要求

代理必须同时处理:

- `/` 或你自定义的首页路径，以及静态资源
- `/api/*`
- WebSocket 请求
- `/api/subscriptions/public/*`

建议配置:

- 公网入口统一强制 HTTPS
- 透传 `X-Forwarded-For` 和 `X-Forwarded-Proto`
- 保留 `Upgrade` 与 `Connection` 头
- 让外部访问域名与 `SUB_PUBLIC_BASE_URL` 保持一致
- 如果你在 `Settings` 里修改了首页访问路径，要同步更新书签和代理规则，但不要去改订阅公开接口路径

### 升级流程

1. 先备份 `data/`、`.env`，如果启用了 PostgreSQL 也一起备份数据库。
2. 拉取新的 Git 提交或新的容器镜像。
3. 重新构建前端或替换容器镜像。
4. 重启 NMS。
5. 在正式放量前先完成上线验证。

### 回滚流程

1. 停止当前进程或容器。
2. 切回上一个 Git 提交或上一个镜像标签。
3. 如果这次发布影响了存储状态，恢复 `data/`、`.env` 和数据库备份。
4. 启动旧版本并重新执行验证。

### 运维上为什么省事

NMS 自带了一些生产环境里很实用的能力:

- 备份导出与恢复
- SMTP 连通性诊断
- 节点健康巡检与通知统计
- 文件 / 双写 / 数据库运行模式
- 关键系统操作的管理员审计记录

### 上线后验证

- `GET /api/auth/check` 响应正常
- 管理员可以成功登录
- 配置过的首页访问路径可以正常打开
- 仪表盘无前端报错
- 节点健康状态可以刷新
- 可以生成订阅链接
- 调整服务器顺序或入站顺序后，订阅内容顺序会变化，但订阅链接地址本身不变
- 审计页和流量页能正常打开
- 经过代理后 WebSocket 相关区域工作正常

### 快速排障

#### 登录失败

- 检查 `ADMIN_USERNAME` 与 `ADMIN_PASSWORD`
- 确认浏览器或代理没有拦截 Cookie

#### 前端空白

- 源码部署时检查 `client/dist` 是否存在
- 确认处于生产模式，或按需设置了 `SERVE_CLIENT=true`

#### 节点请求失败

- 检查面板地址、TLS 参数、用户名和密码
- 检查是否被私网地址限制拦住

#### WebSocket 无法连接

- 检查代理是否正确处理 Upgrade
- 检查 `WS_TICKET_TTL_SECONDS` 和主机时间同步

#### 订阅链接不正确

- 检查 `SUB_PUBLIC_BASE_URL`
- 检查代理是否错误改写了主机名或协议
- 首页访问路径不会改变订阅链接；它只影响后台和登录页从哪里进入
- 调整顺序只会影响订阅内容，不会改变已签发的订阅 URL；如果用户没看到新顺序，先让客户端刷新订阅
