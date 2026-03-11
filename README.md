# NMS

## 中文

NMS 是一个面向 3x-ui / Xray 节点场景的后台管理系统，提供统一的节点接入、用户与订阅管理、审计追踪、批量任务和系统运维能力。项目采用 React + Vite 前端与 Express + WebSocket 后端，默认可直接使用文件存储，也支持逐步接入 PostgreSQL。

### 核心能力

- 多节点统一接入与健康状态监控
- 入站、用户、客户端与订阅集中管理
- 审计日志、流量统计、批量任务记录
- 系统设置、SMTP、注册流程与安全策略
- Review Harness 本地评审环境与假面板联调
- 文件存储 / PostgreSQL 双模式运行

### 仓库结构

```text
client/   React + Vite 管理端
server/   Express API、WebSocket、存储层与服务层
docs/     架构、部署、UI、数据库与评审文档
data/     默认文件存储目录
```

### 快速开始

1. 安装 Node.js 20。
2. 在 `client/` 安装依赖并构建前端。
3. 在 `server/` 安装依赖并启动后端。
4. 复制 `.env.example` 为 `.env`，至少修改 `JWT_SECRET`、`ADMIN_PASSWORD`，生产环境再补充 `ADMIN_USERNAME` 和 `CREDENTIALS_SECRET`。

```bash
cd client
npm ci
npm run build

cd ../server
npm ci
node index.js
```

默认服务地址：

- 前端构建由后端在生产模式下托管
- API: `http://127.0.0.1:3001/api`
- 开发联调时前端默认使用 `http://127.0.0.1:5173`

### 关键环境变量

- `JWT_SECRET`: JWT 密钥，生产环境必须使用 32 位以上随机字符串
- `ADMIN_USERNAME`: 管理员账号，建议不要使用默认值
- `ADMIN_PASSWORD`: 管理员密码，至少满足三类字符复杂度
- `CREDENTIALS_SECRET`: 节点凭据加密密钥，应与 `JWT_SECRET` 分离
- `DATA_DIR`: 文件存储目录
- `DB_ENABLED` / `DB_URL`: PostgreSQL 集成开关与连接串
- `SUB_PUBLIC_BASE_URL`: 订阅公开访问地址
- `SUB_CONVERTER_BASE_URL`: subconverter 地址

### 运行模式

- 文件模式：默认模式，适合本地开发与轻量部署
- 双写模式：文件与 PostgreSQL 同步写入，适合迁移阶段
- 数据库模式：读写都走 PostgreSQL，适合稳定生产环境

### 部署建议

- 单机部署可直接使用 `node server/index.js` 或 `pm2`
- 容器部署可使用仓库根目录的 `Dockerfile`
- 反向代理建议由 Nginx 或 Traefik 处理 HTTPS 与 WebSocket 升级
- 推送镜像到 GHCR 时请使用自己的 GitHub 用户或组织命名空间

### 文档索引

- `docs/ARCHITECTURE_OVERVIEW.md`: 架构与请求流
- `docs/USER_GUIDE.md`: 管理员与普通用户操作指南
- `docs/UI_DESIGN_SYSTEM.md`: 管理端视觉与交互规范
- `docs/DEPLOYMENT_RUNBOOK.md`: 生产部署、升级、回滚与排障
- `docs/DB_INTEGRATION_DEV.md`: PostgreSQL 开发与迁移说明
- `docs/REVIEW_HARNESS.md`: 本地评审环境说明
- `docs/SUBSCRIPTION_CONVERTER_NOTES.md`: 订阅转换器接入说明
- `docs/3XUI_ALIGNMENT_MATRIX.md`: NMS 与 3x-ui 对齐矩阵
- `docs/NMS_FEATURE_UI_AUDIT.md`: 当前功能与 UI 审核结果
- `docs/NMS_GAP_BACKLOG.md`: 后续迭代待办

### 安全说明

- 仓库中的示例地址、邮箱、域名与镜像路径全部为通用占位符
- 不要把真实管理员口令、SMTP 凭据、数据库口令或面板地址提交到仓库
- 生产环境必须启用强口令、独立密钥和 HTTPS

## English

NMS is an admin dashboard for 3x-ui / Xray node operations. It provides a single control plane for server onboarding, user and subscription management, auditing, batch jobs, and system operations. The stack is React + Vite on the client and Express + WebSocket on the server, with file-backed storage by default and optional PostgreSQL support.

### Core capabilities

- Multi-node onboarding with health monitoring
- Centralized inbound, user, client, and subscription management
- Audit logs, traffic analytics, and batch job history
- System settings, SMTP, registration flow, and security controls
- Local review harness with fake panel integrations
- File storage and PostgreSQL runtime modes

### Repository layout

```text
client/   React + Vite admin app
server/   Express API, WebSocket, stores, services
docs/     Architecture, deployment, UI, DB, and review notes
data/     Default file-backed data directory
```

### Quick start

1. Install Node.js 20.
2. Install dependencies and build the client.
3. Install dependencies and start the server.
4. Copy `.env.example` to `.env` and change at least `JWT_SECRET` and `ADMIN_PASSWORD`. In production, also set `ADMIN_USERNAME` and `CREDENTIALS_SECRET`.

```bash
cd client
npm ci
npm run build

cd ../server
npm ci
node index.js
```

Default endpoints:

- The server can host the built client in production mode
- API: `http://127.0.0.1:3001/api`
- Frontend dev server: `http://127.0.0.1:5173`

### Key environment variables

- `JWT_SECRET`: JWT secret, must be a strong random value in production
- `ADMIN_USERNAME`: admin login name, avoid defaults
- `ADMIN_PASSWORD`: strong admin password
- `CREDENTIALS_SECRET`: encryption secret for stored panel credentials
- `DATA_DIR`: file-backed data directory
- `DB_ENABLED` / `DB_URL`: PostgreSQL toggle and connection string
- `SUB_PUBLIC_BASE_URL`: public base URL for subscription links
- `SUB_CONVERTER_BASE_URL`: subconverter endpoint

### Runtime modes

- File mode: default, simple for local development and small deployments
- Dual-write mode: writes to both file and PostgreSQL during migration
- Database mode: reads and writes from PostgreSQL for mature production setups

### Deployment guidance

- Single-host deployments can use `node server/index.js` or `pm2`
- Container deployments can use the root `Dockerfile`
- Put Nginx or Traefik in front for HTTPS termination and WebSocket upgrade
- When publishing to GHCR, use your own GitHub user or organization namespace

### Documentation map

- `docs/ARCHITECTURE_OVERVIEW.md`: architecture and request flow
- `docs/USER_GUIDE.md`: admin and end-user workflows
- `docs/UI_DESIGN_SYSTEM.md`: visual and interaction standards
- `docs/DEPLOYMENT_RUNBOOK.md`: deployment, upgrade, rollback, and troubleshooting
- `docs/DB_INTEGRATION_DEV.md`: PostgreSQL development and migration notes
- `docs/REVIEW_HARNESS.md`: local review harness guide
- `docs/SUBSCRIPTION_CONVERTER_NOTES.md`: subscription converter integration
- `docs/3XUI_ALIGNMENT_MATRIX.md`: NMS to 3x-ui capability alignment
- `docs/NMS_FEATURE_UI_AUDIT.md`: current feature and UI audit
- `docs/NMS_GAP_BACKLOG.md`: prioritized follow-up backlog

### Security notes

- All sample domains, email addresses, image names, and paths in this repository are placeholders
- Never commit real admin passwords, SMTP credentials, database secrets, or panel endpoints
- Production deployments should enforce strong secrets, separate encryption keys, and HTTPS
