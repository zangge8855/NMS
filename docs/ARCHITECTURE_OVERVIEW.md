# Architecture Overview

## 中文

### 系统组成

NMS 由三层组成：

- 前端：`client/` 下的 React + Vite 单页应用，负责 Dashboard、Servers、Inbounds、Users、Subscriptions、Audit、System Settings 等页面
- 后端：`server/index.js` 启动的 Express 应用，提供 REST API、WebSocket ticket、静态资源托管与统一错误处理
- 数据层：默认使用 `data/` 下的文件存储，可按配置切换到 PostgreSQL 或文件 / 数据库双写模式

### 请求流

1. 浏览器访问前端页面或已构建的静态资源；生产环境下前端真实入口路径由系统设置里的 `site.accessPath` 控制，未命中时可按 `site.camouflageEnabled` 返回公开伪装首页
2. 前端通过 `/api/*` 调用后端接口
3. 后端经过认证、中间件、路由、服务层与存储层处理请求
4. 需要实时刷新的页面通过 WebSocket ticket 建立安全连接
5. 涉及节点数据时，由服务层调用面板网关或面板客户端转发请求

### 后端分层

- `routes/`: HTTP 接口入口，负责参数校验、权限边界与响应格式
- `services/`: 业务编排，例如订阅同步、邮件验证码、用户管理、日志聚合
- `repositories/` / `store/`: 数据访问层，适配文件模式与数据库模式
- `lib/`: 通用能力，如健康检查、审计、告警、协议目录、邮件发送
- `db/`: PostgreSQL 启动、schema 与运行模式管理

### 关键模块

- 认证与安全：`auth`, `middleware/auth.js`, `services/authSessionService.js`
- 节点与面板：`routes/servers.js`, `services/panelGateway.js`, `lib/panelClient.js`
- 用户与订阅管理：`routes/users.js`, `routes/clients.js`, `services/userAdminService.js`
- 订阅中心与访问审计：`routes/subscriptions.js`, `services/subscriptionSyncService.js`, `services/subscriptionAuditService.js`
- 审计与流量：`routes/audit.js`, `routes/traffic.js`, `store/trafficStatsStore.js`
- 系统设置与邀请码：`routes/system.js`, `store/systemSettingsStore.js`, `store/inviteCodeStore.js`

### 存储模式

| 模式 | 读取 | 写入 | 适用场景 |
| --- | --- | --- | --- |
| `file` | 文件 | 文件 | 默认开发与轻量部署 |
| `dual` | 文件 | 文件 + PostgreSQL | 迁移与灰度阶段 |
| `db` | PostgreSQL | PostgreSQL | 稳定生产环境 |

相关环境变量：

- `DB_ENABLED`
- `DB_URL`
- `STORE_READ_MODE`
- `STORE_WRITE_MODE`
- `DB_MIGRATION_AUTO`
- `DB_BACKFILL_REDACT`

### 前端信息架构

- Layout：Sidebar + Header + Content
- 监控：Dashboard（含快捷运维入口）
- 管理：Inbounds、Users、Audit、3x-ui Capabilities、Node Tools
- 运维：Settings、Servers
- 系统工作台：Settings 内包含系统参数、数据库、备份、监控诊断和 Node Console
- 用户自助：Subscriptions

### 安全边界

- 管理接口统一经过 `authMiddleware` 与 `adminOnly`
- 订阅公开访问通过 token 校验，不复用管理员会话
- 首页访问路径和伪装首页只影响前端页面入口，不改变 `/api/subscriptions/public/*` 的公开订阅地址
- 订阅内容构建时会先按持久化的服务器顺序，再按每台服务器的入站顺序聚合链接；排序变化不会改写已签发的订阅 URL
- 生产环境会强制检查弱口令、弱用户名与弱密钥
- 面板凭据加密使用 `CREDENTIALS_SECRET`
- 反向代理场景启用了可信代理设置，便于审计真实来源 IP

### 实时与后台任务

- WebSocket 用于受控实时能力，连接前先通过 ticket 授权
- `serverHealthMonitor` 在后台持续采样节点状态
- 批量任务与日志、流量统计都具有独立保留策略

### 推荐扩展方式

- 新增接口时，优先补充 route -> service -> repository 的完整链路
- 存储逻辑不要直接写死在 route 中，统一通过 store 或 repository 抽象
- 涉及 UI 组件层级、浮层、表格和弹窗时，复用现有 Layout 与样式 token

## English

### System shape

NMS is built from three layers:

- Frontend: a React + Vite SPA under `client/`, covering Dashboard, Servers, Inbounds, Users, Subscriptions, Audit, and System Settings
- Backend: an Express app started by `server/index.js`, exposing REST APIs, WebSocket ticket endpoints, static asset hosting, and global error handling
- Data layer: file-backed stores under `data/` by default, with optional PostgreSQL or dual-write runtime modes

### Request flow

1. The browser loads the SPA or the built static assets; in production the real UI entry is controlled by `site.accessPath`, while non-matching document requests can render a public camouflage landing page when `site.camouflageEnabled` is enabled
2. The frontend calls backend endpoints under `/api/*`
3. The backend processes requests through auth, middleware, routes, services, and stores
4. Real-time pages obtain a secure WebSocket ticket before connecting
5. Panel-related actions are forwarded through the panel gateway and panel client services

### Backend layers

- `routes/`: HTTP entry points, response shape, and permission boundaries
- `services/`: business orchestration for subscriptions, email auth, user admin, and log aggregation
- `repositories/` / `store/`: persistence adapters for file and database modes
- `lib/`: shared utilities such as health monitoring, auditing, alerts, protocol catalog, and mail delivery
- `db/`: PostgreSQL bootstrap, schema management, and runtime mode control

### Key modules

- Auth and security: `auth`, `middleware/auth.js`, `services/authSessionService.js`
- Servers and panel access: `routes/servers.js`, `services/panelGateway.js`, `lib/panelClient.js`
- Users and subscription administration: `routes/users.js`, `routes/clients.js`, `services/userAdminService.js`
- Subscription center and access audit: `routes/subscriptions.js`, `services/subscriptionSyncService.js`, `services/subscriptionAuditService.js`
- Audit and traffic: `routes/audit.js`, `routes/traffic.js`, `store/trafficStatsStore.js`
- System settings and invite codes: `routes/system.js`, `store/systemSettingsStore.js`, `store/inviteCodeStore.js`

### Storage modes

| Mode | Read path | Write path | Recommended use |
| --- | --- | --- | --- |
| `file` | file | file | default development and small installs |
| `dual` | file | file + PostgreSQL | migrations and staged rollout |
| `db` | PostgreSQL | PostgreSQL | stable production |

Related environment variables:

- `DB_ENABLED`
- `DB_URL`
- `STORE_READ_MODE`
- `STORE_WRITE_MODE`
- `DB_MIGRATION_AUTO`
- `DB_BACKFILL_REDACT`

### Frontend information architecture

- Layout: Sidebar + Header + Content
- Monitor: Dashboard with quick operations
- Manage: Inbounds, Users, Audit, 3x-ui Capabilities, Node Tools
- Operate: Settings, Servers
- System workbench: `Settings` includes basic system parameters, database, backup, diagnostics, and the embedded Node Console
- End-user self-service: Subscriptions

### Security boundaries

- Admin routes are protected by `authMiddleware` and `adminOnly`
- Public subscription access uses token validation, not admin sessions
- The configurable homepage access path and camouflage landing page only change how the UI entry is served; they do not rewrite `/api/subscriptions/public/*`
- Subscription payloads are merged by persisted server order first and inbound order second; changing sort order does not rewrite issued subscription URLs
- Production mode enforces checks against weak usernames, passwords, and secrets
- Panel credentials are encrypted with `CREDENTIALS_SECRET`
- Trusted proxy settings allow audit logs to record the correct client IP behind reverse proxies

### Real-time and background work

- WebSocket features use ticket-based authorization
- `serverHealthMonitor` samples server health in the background
- Batch jobs, audit records, and traffic stats each have dedicated retention controls

### Preferred extension pattern

- For new features, keep the route -> service -> repository chain explicit
- Avoid embedding storage writes directly inside routes
- Reuse existing layout patterns and UI tokens for floating panels, tables, and modal behavior
