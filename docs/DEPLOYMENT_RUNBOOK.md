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
- Set `TRUST_PROXY` only to the reverse-proxy sources that can legitimately send `X-Forwarded-*`; the default trusts `loopback` only
- Leave `SECURITY_HSTS_ENABLED` enabled in HTTPS production deployments; disable it only for plain HTTP or staging domains where HSTS would be unsafe
- The UI homepage defaults to `/`; if you later move it to a custom path in `Settings`, keep `/api`, `/ws`, and subscription public routes reachable
- If you enable the camouflage landing page, keep the real UI access path documented internally; only the public-facing fallback page should remain visible on `/` or other non-matching document paths
- Enable SMTP only when you need registration, verification, or password reset mail

### Preflight Checklist

- Configuration is provided either in `.env` or as real environment variables (Docker `--env-file`, PM2, systemd), and no default password or secret is left in place
- `ADMIN_USERNAME` and `ADMIN_PASSWORD` are set
- `JWT_SECRET` and `CREDENTIALS_SECRET` are either set to two different random values (32+ characters) or left empty so NMS generates them into `${DATA_DIR}/runtime.env` on first start (see [Security Behaviour](#security-behaviour))
- `TRUST_PROXY` matches the deployment topology if NMS sits behind a private reverse proxy
- The target host has Node.js `22` (the version CI and the Docker image use) or Docker installed
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

### Source Install Verification Status

The source deployment path was re-verified on May 6, 2026 with:

```bash
cd client
npm ci
npm run build
npm test

cd ../server
npm ci
npm test
```

Recorded result:

- `client`: install, production build, and full tests passed (`232/232`)
- `server`: install and full tests passed (`313/313`)
- `client`: `npm audit` reports `0` vulnerabilities after refreshing the Vite toolchain and transitive overrides
- `server`: `npm audit` reports `0` vulnerabilities after moving `multer` to `2.x` and pinning `qs`

### Option 1.5: CI/CD Automated Build

The repository includes GitHub Actions workflows:

- **CI** (`.github/workflows/ci.yml`): runs server tests, client lint + tests + build on every push to `main` and every PR
- **Docker** (`.github/workflows/docker.yml`): after CI passes on `main`, automatically builds and pushes a multi-arch Docker image to GHCR (`ghcr.io/<owner>/nms:latest` and `ghcr.io/<owner>/nms:<commit-sha>`); also supports manual dispatch

To use the automated Docker image:

```bash
docker pull ghcr.io/<your-github-user-or-org>/nms:latest
docker run -d \
  --name nms \
  -p 3001:3001 \
  --env-file .env \
  -v /opt/nms/data:/app/data \
  -v /opt/nms/logs:/app/logs \
  ghcr.io/<your-github-user-or-org>/nms:latest
```

### Option 2: Docker Deployment

The root `Dockerfile` already builds the client, installs server production dependencies, and starts the runtime on port `3001` as the non-root `node` user.

Keep `/app/data` and `/app/logs` mounted to named or host volumes. The image declares both paths as volumes, but explicit mounts are still the operationally clear choice. Without a persistent `/app/data` mount, file-backed users, settings, telemetry, audits, invite codes, subscription tokens, backups, and runtime logs can be lost when the container is recreated. Do not set `DATA_DIR` to `/tmp` or `/var/tmp` in production; startup preflight now reports that as volatile storage. The System Settings backup workspace also shows runtime storage health, including `DATA_DIR`, the local backup directory, read/write status, and corrupted JSON counts.

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

The image defines a `HEALTHCHECK` that calls `GET /api/health` every 30 seconds (40-second start period, 3 retries), so `docker ps` and orchestrators report the container as `healthy`/`unhealthy`.

### Security Behaviour

**Secrets and configuration precedence.** Values are read from the process environment first, then `${DATA_DIR}/runtime.env`, then the repository `.env`. When `JWT_SECRET` or `CREDENTIALS_SECRET` is missing, NMS generates a random value on first start and stores it in `${DATA_DIR}/runtime.env`. Back that file up together with `data/`: losing it signs everyone out and makes stored node credentials and encrypted backups unreadable. In production NMS refuses to start if either secret is set to one of the defaults older releases published in the source code; those values are kept only to decrypt data written by older releases so it can be re-encrypted.

**Strict mode.** `ENFORCE_STRICT_SECURITY` defaults to `true` in production and makes startup refuse weak admin credentials and secrets.

**Legacy subscription links.** Pre-token links (`/api/subscriptions/public/<email>/<signature>`) never expire and cannot be revoked per link, so they are disabled unless `SUB_LEGACY_SIGNATURE_ENABLED=true`. Enable it only while migrating old clients.

**PostgreSQL TLS.** `DB_SSL_MODE` accepts `disable` (default), `require` (encrypted, certificate not checked) and `verify-full` (encrypted and verified, recommended). Use `DB_SSL_CA_FILE` for a private CA bundle.

**Node control proxy (`/api/panel/:serverId/...`) by role.**

| Role | Access |
|------|--------|
| admin | Everything |
| operator | Everything except panel settings (including panel API tokens), panel users and sessions, and node database export/import |
| auditor | Read-only allowlist: list/get/status/log queries; any change is refused |
| user / guest | No access |

**Login protection.** Failed password sign-ins are counted per account + IP (20), per account (50) and per IP (100) within 15 minutes; reaching any limit blocks further attempts for 15 minutes. The per-account limit means someone who knows a username can lock that account out for 15 minutes, which is recorded as the `login_account_locked` audit event (critical alert). Counters are in memory, so a restart clears them. TOTP codes are accepted only once per 30-second step.

**Audit storage limits.** `audit_events.json` keeps at most `AUDIT_MAX_EVENTS` records (default 50000) and `subscription_access_logs.json` at most `AUDIT_MAX_SUBSCRIPTION_ACCESS_RECORDS` (default 100000), on top of `AUDIT_RETENTION_DAYS`; the oldest records are dropped first. Writes are batched at most once per second. `security_audit.log` rotates at `AUDIT_LOG_MAX_MB` (default 20) and keeps `AUDIT_LOG_MAX_FILES` old files (default 5).

**Content Security Policy.** The admin page allows scripts from its own origin only (`script-src 'self'`). If you add a reverse-proxy rule that injects inline scripts (analytics, banners), the browser will block them.

### Reverse Proxy Requirements

The proxy must handle:

- `/` or your configured homepage path, plus static assets
- `/api/*`
- WebSocket traffic
- `/api/subscriptions/public/*`

Recommended proxy behavior:

- Force HTTPS on the public endpoint
- Forward `X-Forwarded-For` and `X-Forwarded-Proto`
- Configure `TRUST_PROXY` to the actual proxy hop, CIDR, or built-in trust value; avoid `true` on public direct deployments
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
- database consistency verification with `npm run db:verify`
- admin-side audit records for sensitive system actions
- search bot and scanner protection middleware
- dedicated public subscription rate limiter (60 req/min)
- centralized browser security headers and redacted request logging for public subscription secrets
- persistent audit write stream and in-memory ring buffer for pattern detection
- task queue capacity management with auto-pruning

### Post-Deploy Validation

- `GET /api/auth/check` responds correctly
- Admin login succeeds
- The configured homepage path opens normally
- If camouflage is enabled, `/` or another non-matching document path shows the public landing page while the real UI path still opens normally
- The dashboard loads without frontend errors
- Node health status refreshes correctly
- Subscription links can be generated
- Audit and traffic pages open normally
- `npm run db:verify` reports matching snapshots before switching `STORE_READ_MODE=db`
- Users, notifications, audit traffic, system settings, and server telemetry stay on fresh live data after login instead of jumping back to stale bootstrap previews
- WebSocket-driven status areas work behind the proxy

### Quick Troubleshooting

#### Login fails

- Verify `ADMIN_USERNAME` and `ADMIN_PASSWORD`
- Confirm cookies are not blocked by the browser or proxy
- "Too many sign-in attempts" means a login limit was hit (see [Security Behaviour](#security-behaviour)); wait 15 minutes or restart NMS to clear the in-memory counters
- Everyone was signed out after a redeploy: `${DATA_DIR}/runtime.env` (the generated `JWT_SECRET`) was not persisted; mount `data/` as a volume

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
- 只有在 NMS 确实位于可信反向代理后方时，才按实际来源配置 `TRUST_PROXY`；默认只信任 `loopback`
- HTTPS 生产环境保持 `SECURITY_HSTS_ENABLED` 启用；只有纯 HTTP 或临时测试域名才应关闭
- 后台首页默认走 `/`；如果后续在 `系统设置` 里改成自定义路径，也要继续保留 `/api`、`/ws` 和订阅公开地址可访问
- 只有在需要注册、验证邮件或找回密码时才开启 SMTP
- 登录页的“忘记密码”接口默认会隐藏邮箱是否存在的结果；上线前只需要确认 SMTP 可用，不需要额外暴露用户是否已注册

### 上线前检查

- 配置通过 `.env` 或真实环境变量（Docker `--env-file`、PM2、systemd）提供，且没有保留任何默认口令或默认密钥
- 已设置 `ADMIN_USERNAME`、`ADMIN_PASSWORD`
- `JWT_SECRET` 与 `CREDENTIALS_SECRET` 要么设置为两个不同的随机值（至少 32 位），要么留空，由 NMS 首次启动时生成并写入 `${DATA_DIR}/runtime.env`（见[安全行为](#安全行为)）
- 如果部署在私网反向代理后方，`TRUST_PROXY` 已与真实代理拓扑一致
- 目标机器已安装 Node.js `22`（CI 与 Docker 镜像使用的版本）或 Docker
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

### 源码安装验证状态

已在 2026 年 5 月 6 日重新验证源码部署链路:

```bash
cd client
npm ci
npm run build
npm test

cd ../server
npm ci
npm test
```

记录结果:

- `client`: 依赖安装、生产构建和全量测试均通过（`232/232`）
- `server`: 依赖安装和全量测试均通过（`313/313`）
- `client`: 刷新 Vite 工具链及其传递依赖覆盖后，`npm audit` 为 `0` 告警
- `server`: 升级 `multer` 到 `2.x` 并固定 `qs` 后，`npm audit` 为 `0` 告警

### 方式二: Docker 部署

仓库根目录的 `Dockerfile` 已经包含前端构建、后端生产依赖安装和运行镜像组装，默认监听 `3001` 端口，并使用非 root 的 `node` 用户运行。

请始终把 `/app/data` 和 `/app/logs` 挂载到命名卷或宿主机目录。镜像已声明这两个运行时卷，但显式挂载更利于运维和备份。否则文件模式下的用户、系统设置、遥测、审计、邀请码、订阅 Token、备份和运行日志可能在容器重建后丢失。生产环境不要把 `DATA_DIR` 指向 `/tmp` 或 `/var/tmp`；启动预检会把这类路径报告为易失存储。系统设置的备份工作区也会展示运行存储健康状态，包括 `DATA_DIR`、本机备份目录、读写状态和损坏 JSON 数量。

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

镜像内置 `HEALTHCHECK`：每 30 秒请求一次 `GET /api/health`（启动宽限 40 秒，重试 3 次），`docker ps` 与编排系统会据此显示 `healthy` / `unhealthy`。

### 安全行为

**密钥与配置优先级。** 依次读取进程环境变量、`${DATA_DIR}/runtime.env`、仓库根目录 `.env`。若未设置 `JWT_SECRET` 或 `CREDENTIALS_SECRET`，NMS 会在首次启动时生成随机值并写入 `${DATA_DIR}/runtime.env`。请把这个文件和 `data/` 一起备份：丢失后所有人会被登出，已保存的节点凭据和加密备份也将无法解密。生产环境下，若任一密钥被设置为旧版本源码中公开的默认值，NMS 将拒绝启动；这些默认值只保留用于解密旧版本写入的数据，以便重新加密。

**严格模式。** 生产环境下 `ENFORCE_STRICT_SECURITY` 默认为 `true`，启动时会拒绝弱管理员口令和弱密钥。

**旧版订阅链接。** 旧版无 Token 链接（`/api/subscriptions/public/<email>/<signature>`）永不过期且无法单独吊销，默认关闭；仅在迁移旧客户端期间设置 `SUB_LEGACY_SIGNATURE_ENABLED=true`。

**PostgreSQL TLS。** `DB_SSL_MODE` 可选 `disable`（默认）、`require`（加密但不校验证书）、`verify-full`（加密并校验，推荐）。私有 CA 用 `DB_SSL_CA_FILE` 指定证书文件。

**节点控制代理（`/api/panel/:serverId/...`）角色权限。**

| 角色 | 权限 |
|------|------|
| admin | 全部 |
| operator | 除面板设置（含面板 API Token）、面板用户与会话、节点数据库导出/导入外的全部操作 |
| auditor | 只读白名单：列表、详情、状态与日志查询；任何修改都会被拒绝 |
| user / guest | 无权访问 |

**登录保护。** 15 分钟内，密码登录失败按「账号 + IP」（20 次）、「账号」（50 次）、「IP」（100 次）分别计数，任一达到上限即禁止登录 15 分钟。账号维度的限制意味着知道用户名的人可以让该账号被锁 15 分钟，此时会记录 `login_account_locked` 审计事件（严重告警）。计数保存在内存中，重启即清零。TOTP 验证码在每个 30 秒步长内只能使用一次。

**审计存储上限。** 在 `AUDIT_RETENTION_DAYS` 之外，`audit_events.json` 最多保留 `AUDIT_MAX_EVENTS` 条（默认 50000），`subscription_access_logs.json` 最多保留 `AUDIT_MAX_SUBSCRIPTION_ACCESS_RECORDS` 条（默认 100000），超出时优先丢弃最旧记录；写盘合并为每秒最多一次。`security_audit.log` 达到 `AUDIT_LOG_MAX_MB`（默认 20）后轮转，保留 `AUDIT_LOG_MAX_FILES` 个历史文件（默认 5）。

**内容安全策略（CSP）。** 管理页面只允许加载同源脚本（`script-src 'self'`）。如果在反向代理上注入内联脚本（统计、横幅等），浏览器会将其拦截。

### 反向代理要求

代理必须同时处理:

- `/` 或你自定义的首页路径，以及静态资源
- `/api/*`
- WebSocket 请求
- `/api/subscriptions/public/*`

建议配置:

- 公网入口统一强制 HTTPS
- 透传 `X-Forwarded-For` 和 `X-Forwarded-Proto`
- 将 `TRUST_PROXY` 配成真实代理来源、CIDR 或内置可信值；公网直连部署不要设置为 `true`
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
- 使用 `npm run db:verify` 做数据库一致性校验
- 关键系统操作的管理员审计记录
- 搜索引擎与扫描器探测拦截中间件
- 公开订阅端点独立限流（60 次/分钟）
- 浏览器安全响应头和公开订阅密钥的请求日志脱敏
- 审计日志持久化写入流与内存环形缓冲模式匹配
- 任务队列容量管理与自动清理

### 上线后验证

- `GET /api/auth/check` 响应正常
- 管理员可以成功登录
- 配置过的首页访问路径可以正常打开
- 仪表盘无前端报错
- 节点健康状态可以刷新
- 可以生成订阅链接
- 调整服务器顺序或入站顺序后，订阅内容顺序会变化，但订阅链接地址本身不变
- 审计页和流量页能正常打开
- 切换到 `STORE_READ_MODE=db` 前，`npm run db:verify` 报告文件快照与 DB 快照一致
- 登录后的用户列表、通知、审计流量、系统设置和节点遥测不会再回跳到旧的 bootstrap 首屏数据
- 经过代理后 WebSocket 相关区域工作正常

### 快速排障

#### 登录失败

- 检查 `ADMIN_USERNAME` 与 `ADMIN_PASSWORD`
- 确认浏览器或代理没有拦截 Cookie
- 提示「登录尝试过于频繁」说明触发了登录限制（见[安全行为](#安全行为)）；等待 15 分钟或重启 NMS 清空内存计数
- 重新部署后所有人被登出：`${DATA_DIR}/runtime.env`（自动生成的 `JWT_SECRET`）没有持久化，请把 `data/` 挂载为持久卷

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
