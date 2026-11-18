# Architecture Overview

## 中文

### 系统组成

NMS 由三层组成：

- 前端：`client/` 下的 React 18 + TypeScript + Vite 单页应用，所有组件使用 TSX，类型定义位于 `client/src/types/index.ts`
- 后端：`server/index.ts`（支持 `server/index.js` 兼容引导）启动的 Express + TypeScript 应用，提供 REST API、WebSocket ticket、静态资源托管与统一错误处理，类型定义位于 `server/types/index.ts`
- 数据层：默认使用 `data/` 下的文件存储，可按配置切换到 PostgreSQL 或文件 / 数据库双写模式

### 请求流

1. 浏览器访问前端页面或已构建的静态资源；生产环境下前端真实入口路径由系统设置里的 `site.accessPath` 控制，未命中时可按 `site.camouflageEnabled` 返回公开伪装首页
2. 前端通过 `/api/*` 调用后端接口
3. 后端经过认证、中间件、路由、服务层与存储层处理请求
4. 需要实时刷新的页面通过 WebSocket ticket 建立安全连接
5. 涉及节点数据时，由服务层调用面板网关或面板客户端转发请求

### 后端分层

- `routes/`: HTTP 接口入口，负责参数校验、权限边界与响应格式（`routes/*.ts`）
- `services/`: 业务编排，例如订阅同步、邮件验证码、用户管理、日志聚合（`services/*.ts`）
- `repositories/` / `store/`: 数据访问与持久化层，适配文件模式与数据库模式（`repositories/*.ts`, `store/*.ts`）
- `lib/`: 通用能力，如健康检查、审计、告警、协议目录、邮件发送（`lib/*.ts`）
- `db/`: PostgreSQL 启动、schema 与运行模式管理（`db/*.ts`）
- `types/`: 核心领域实体与接口契约声明（`types/*.ts`）

### 关键模块

- 认证与安全：`auth`, `middleware/auth.ts`, `services/authSessionService.ts`, `services/emailAuthService.ts`
- 节点与面板：`routes/servers.ts`, `services/panelGateway.ts`, `lib/panelClient.ts`, `lib/serverHealthMonitor.ts`, `lib/serverStatusService.ts`
- 用户与订阅管理：`routes/users.ts`, `routes/clients.ts`, `services/userAdminService.ts`, `lib/clientEntitlements.ts`
- 订阅中心与访问审计：`routes/subscriptions.ts`, `services/subscriptionSyncService.ts`, `services/subscriptionAuditService.ts`, `lib/subscriptionAlias.ts`
- 审计与流量：`routes/audit.ts`, `routes/traffic.ts`, `store/trafficStatsStore.ts`, `lib/auditEventEnrichment.ts`
- 系统设置与邀请码：`routes/system.ts`, `store/systemSettingsStore.ts`, `store/inviteCodeStore.ts`
- Telegram 通知与汇总：`lib/telegramAlertService.ts`, `lib/notifications.ts`, `lib/subscriptionExpiryNotifier.ts`, `lib/alertEngine.ts`
- 安全加固：`lib/securityAudit.ts`（持久化写入流 + 内存环形缓冲）, `lib/batchRiskControl.ts`, `lib/taskQueue.ts`（队列容量上限）, `lib/requestIp.ts`, `lib/ipGeoResolver.ts`, `lib/ipIspResolver.ts`
- 站点伪装：`lib/siteCamouflage.ts`, `middleware/siteCamouflage.ts`, `middleware/searchBotProtection.ts`

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

- Layout：Sidebar + Header + Content + 移动端 Bottom Nav（`viewport-fit=cover` + `scroll-padding-bottom` 安全区适配）
- CSS 分层与现代交互：`theme.css` 统一维护调色板、`accent-color` 与 `scrollbar-color`（传统 WebKit 滚动条封装于 `@supports not (scrollbar-color: auto)` 内）；`identity.css` 提供 Forced-Colors 安全的 `::after` `border-block-end` 活动标签指示、基于 `@supports (animation-timeline: scroll())` 的横向标签边缘渐隐遮罩、`container-type: inline-size` + 吸顶表头的键盘可聚焦 `.table-container`（`role="region"`、`tabIndex={0}`），以及 `prefers-reduced-motion` 约束下的 `scale: 0.98` 按压与 `ease-out` + `linear(...)` 弹窗动效
- JS / TS 运行基线：`client/tsconfig.json` 面向 `ES2023`（采用 `AbortSignal.timeout`、`.toSorted()` 与 `structuredClone()`），通过 `rovingTabs.ts` 为水平标签页提供 WAI-ARIA 键盘导航
- 管理：Dashboard（支持按用户 `localStorage` 定制区块与 UTF-8 BOM CSV 快照导出）、Inbounds、Users、Audit、3x-ui Capabilities、Node Tools
- 运维：Settings（仅 `admin`）、Xray Console（仅 `admin`）、Servers（含 `admin` 专属 API Token 页签与 3x-ui v3 面板功能页签）
- 系统工作台：Settings 内包含对外访问、安全审计、运维通知、数据备份，以及独立的系统状态与 Node Console
- 用户自助：Subscriptions、Downloads（软件下载）、Account（账户中心）

### 防护与伪装

- `searchBotProtection` 中间件拦截搜索引擎爬虫和常见扫描器的探测请求
- 站点伪装支持三套模板：`corporate`（城市周刊）、`blog`（影像笔记）、`nginx`（周末指南）；公开内容与站内运维、订阅、节点、审计等业务语义保持脱钩
- 伪装模板使用启动时随机化的 CSS class 后缀，避免指纹识别
- 公开订阅端点有独立的轻量限流器（60 次/分钟），与管理 API 限流策略分离

### CI/CD

- GitHub Actions CI（`.github/workflows/ci.yml`）在每次 push/PR 时自动运行服务端测试、客户端 lint + 测试 + 构建
- Docker 工作流（`.github/workflows/docker.yml`）在 CI 通过后自动构建并推送镜像到 GHCR，支持手动触发

### 安全边界

- **四层 RBAC 路由挂载与细粒度守卫**：`server/index.ts` 将 `/api/ws`、`/api/capabilities`、`/api/protocol-schemas`、`/api/audit`、`/api/traffic`、`/api/servers`、`/api/panel`、`/api/batch`、`/api/jobs`、`/api/user-policy`、`/api/user-groups`、`/api/users`、`/api/clients`、`/api/certificates` 与 `/api/system` 挂载在 `authMiddleware + auditorOrAbove` 之下，由各路由内部对写操作进一步要求 `operatorOrAbove`（如批量写操作、策略/分组/令牌修改、用户管理仅限普通 `user` 账号且禁止 `operator` 变更工作人员账号）或 `adminOnly`（如 `/api/xray`、`/api/system/settings`、`/api/system/credentials/rotate`、审计日志删除、全局系统配置与面板多节点/Token 管理）
- **面板代理访问策略（`server/lib/proxyAccessPolicy.ts`）**：所有 `/api/panel/:serverId/*` 请求先做解码和 POSIX 路径规范化后再判定：`admin` 放行；`operator` 禁止访问 `ADMIN_ONLY_PATHS`（面板设置、凭据与 API Token `/panel/api/setting*`、原始数据库导入导出、3x-ui v3 多节点 `/panel/api/nodes*`、s-ui `tokens`/`users`/`sessions`/`settings`/`load`/`getdb`/`importdb`），且 `POST /sui/save` 仅允许写入非管理类对象白名单；`auditor` 仅限 `AUDITOR_GET_PATHS`（含 `clients/list/paged`、`clients/get/subId/*`、`clients/get/tgId/*`、`clients/groups*`、`hosts/*`、`sub-balancers` 等）及显式 `READ_ONLY_POST_PATHS`
- **全局错误处理**：生产环境隐藏 500 堆栈与敏感细节并返回中英双语统一错误提示，对 `413` 请求体过大与 `400` JSON 解析错误返回本地化提示
- 订阅公开访问通过 token 校验，不复用管理员会话
- 首页访问路径和伪装首页只影响前端页面入口，不改变 `/api/subscriptions/public/*` 的公开订阅地址
- 订阅内容构建时会先按持久化的服务器顺序，再按每台服务器的入站顺序聚合链接；排序变化不会改写已签发的订阅 URL
- 生产环境会强制检查弱口令、弱用户名与弱密钥，且 `runtime.env` 不再落盘明文 `ADMIN_PASSWORD`
- **静态加密与统一密钥轮换**：节点凭据、`systemSettingsStore`（Webhook 密钥与 Bark Key）、`certificateStore`（私钥与 Cloudflare API Token）及 `subscriptionTokenStore` 使用 `CREDENTIALS_SECRET` 加密存储，并可通过 `POST /api/system/credentials/rotate`（支持 `dryRun`）统一轮换；本地与 Telegram 备份采用 AES-256-GCM + scrypt v3 格式加密
- 反向代理场景采用受控 `TRUST_PROXY` 与可选 `TRUST_CLOUDFLARE_HEADERS` / Cloudflare Edge IP 校验及从右向左 XFF 解析，防止伪造来源 IP

### 实时与后台任务

- **WebSocket 单次 Ticket 与载荷防护**：`/api/ws/ticket` 签发带 `jti` 与 `tokenVersion` 的短时票据；`verifyWsTicket` 维护已消费 `jti` 防重放缓存（上限 10,000），`wsServer.ts` 校验启用状态、`staff` 角色与 `tokenVersion` 并限制单帧载荷 `64 KiB`
- **优雅停机链路**：`setupGracefulShutdown` 收到 `SIGTERM`/`SIGINT` 后停止健康巡检、缓存预热、Telegram 与到期提醒调度，顺序刷新通知队列、审计缓冲区、`securityAudit` 写入流与 DB 快照队列（`flushSnapshotQueue`），随后关闭 WebSocket、HTTP 服务、PostgreSQL 连接池与 SQLite 连接
- `serverHealthMonitor` 在后台持续采样节点状态
- `telegramAlertService` 负责结构化通知投递、可选命令菜单管理、周期摘要与重复事件聚合
- `subscriptionExpiryNotifier` 定期检查订阅到期并触发通知
- `securityAudit` 使用带日志轮转的持久化写入流与内存滑动窗口环形缓冲进行安全模式匹配，避免阻塞事件循环
- `taskQueue` 设有容量上限（1000），超限时自动清理已完成任务
- 批量任务与日志、流量统计都具有独立保留策略

### 前端加载策略

- `Dashboard` 首屏优先使用 WebSocket / 集群状态快照，只有在展开更重的在线明细时才补充跨节点扫描
- `Users` 先渲染基础账号表，再后台同步节点统计，避免整页阻塞在全量面板请求上
- `User Detail` 与 `Users` 共享节点面板缓存，减少同一批节点被重复扫描
- 通知中心首屏只拉轻量预览与未读数，完整列表在用户展开通知面板后再补齐
- `Settings` 按当前工作区分组惰性加载依赖状态，而不是在首次进入时一次性请求全部系统诊断数据

### 推荐扩展方式

- 新增接口时，优先补充 route -> service -> repository 的完整链路
- 存储逻辑不要直接写死在 route 中，统一通过 store 或 repository 抽象
- 涉及 UI 组件层级、浮层、表格和弹窗时，复用现有 Layout 与样式 token

## English

### System shape

NMS is built from three layers:

- Frontend: a React 18 + TypeScript + Vite SPA under `client/`, covering Dashboard, Servers, Inbounds, Users, Subscriptions, Audit, and System Settings with type models in `client/src/types/index.ts`
- Backend: an Express app started by `server/index.ts` (with backward-compatible `server/index.js` loader), exposing REST APIs, WebSocket ticket endpoints, static asset hosting, and global error handling with domain types in `server/types/index.ts`
- Data layer: file-backed stores under `data/` by default, with optional PostgreSQL or dual-write runtime modes

### Request flow

1. The browser loads the SPA or the built static assets; in production the real UI entry is controlled by `site.accessPath`, while non-matching document requests can render a public camouflage landing page when `site.camouflageEnabled` is enabled
2. The frontend calls backend endpoints under `/api/*`
3. The backend processes requests through auth, middleware, routes, services, and stores
4. Real-time pages obtain a secure WebSocket ticket before connecting
5. Panel-related actions are forwarded through the panel gateway and panel client services

### Backend layers

- `routes/`: HTTP entry points, response shape, and permission boundaries (`routes/*.ts`)
- `services/`: business orchestration for subscriptions, email auth, user admin, and log aggregation (`services/*.ts`)
- `repositories/` / `store/`: persistence adapters for file and database modes (`repositories/*.ts`, `store/*.ts`)
- `lib/`: shared utilities such as health monitoring, auditing, alerts, protocol catalog, and mail delivery (`lib/*.ts`)
- `db/`: PostgreSQL bootstrap, schema management, and runtime mode control (`db/*.ts`)
- `types/`: core domain interfaces and API payload types (`types/*.ts`)

### Key modules

- Auth and security: `auth`, `middleware/auth.ts`, `services/authSessionService.ts`, `services/emailAuthService.ts`
- Servers and panel access: `routes/servers.ts`, `services/panelGateway.ts`, `lib/panelClient.ts`, `lib/serverHealthMonitor.ts`, `lib/serverStatusService.ts`
- Users and subscription administration: `routes/users.ts`, `routes/clients.ts`, `services/userAdminService.ts`, `lib/clientEntitlements.ts`
- Subscription center and access audit: `routes/subscriptions.ts`, `services/subscriptionSyncService.ts`, `services/subscriptionAuditService.ts`, `lib/subscriptionAlias.ts`
- Audit and traffic: `routes/audit.ts`, `routes/traffic.ts`, `store/trafficStatsStore.ts`, `lib/auditEventEnrichment.ts`
- System settings and invite codes: `routes/system.ts`, `store/systemSettingsStore.ts`, `store/inviteCodeStore.ts`
- Telegram notifications and digests: `lib/telegramAlertService.ts`, `lib/notifications.ts`, `lib/subscriptionExpiryNotifier.ts`, `lib/alertEngine.ts`
- Security hardening: `lib/securityAudit.ts` (persistent write stream + in-memory ring buffer), `lib/batchRiskControl.ts`, `lib/taskQueue.ts` (queue capacity cap), `lib/requestIp.ts`, `lib/ipGeoResolver.ts`, `lib/ipIspResolver.ts`
- Site camouflage: `lib/siteCamouflage.ts`, `middleware/siteCamouflage.ts`, `middleware/searchBotProtection.ts`

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

- Layout: Sidebar + Header + Content + mobile Bottom Nav (`viewport-fit=cover` + `scroll-padding-bottom` safe-area adaptation)
- CSS layers & modern interactions: `theme.css` owns the OKLCH-tuned palette, `accent-color`, and `scrollbar-color` (wrapping legacy `::-webkit-scrollbar` fallbacks inside `@supports not (scrollbar-color: auto)`); `identity.css` adds Forced-Colors-safe `::after` `border-block-end` active tab indicators, `@supports (animation-timeline: scroll())` horizontal edge-fade masks, container-query sticky-header keyboard-scrollable `.table-container` regions (`role="region"`, `tabIndex={0}`), and `prefers-reduced-motion`-guarded `scale: 0.98` press + `ease-out`/`linear(...)` spring popover animations
- JS / TS runtime target: `client/tsconfig.json` targets `ES2023` (`AbortSignal.timeout`, `.toSorted()`, `structuredClone()`), with shared `rovingTabs.ts` WAI-ARIA keyboard navigation across horizontal tablists
- Manage: Dashboard (per-user `localStorage` section visibility + UTF-8 BOM CSV snapshot export), Inbounds, Users, Audit, 3x-ui Capabilities, Node Tools
- Operate: Settings (`admin` only), Xray Console (`admin` only), Servers (with `admin`-only API Tokens tab and 3x-ui v3 Panel Features tab)
- System workbench: `Settings` groups external access, security audit, operations notifications, data backup, plus a separate system-status tab and the embedded Node Console
- End-user self-service: Subscriptions, Downloads, Account

### Protection and camouflage

- `searchBotProtection` middleware blocks search engine crawlers and common scanner probes
- Site camouflage supports three templates: `corporate` (city weekly), `blog` (photo notes), and `nginx` (weekend guide); public content stays detached from internal operations, subscriptions, nodes, audit, and related product language
- Camouflage templates use startup-randomized CSS class suffixes to prevent fingerprinting
- Public subscription endpoints have a dedicated lightweight rate limiter (60 req/min), separated from the admin API rate limiter

### CI/CD

- GitHub Actions CI (`.github/workflows/ci.yml`) runs server tests, client lint + tests + build on every push/PR
- Docker workflow (`.github/workflows/docker.yml`) builds and pushes images to GHCR after CI passes, with manual dispatch support

### Security boundaries

- **4-tier RBAC route mounts & granular guards**: `server/index.ts` mounts `/api/ws`, `/api/capabilities`, `/api/protocol-schemas`, `/api/audit`, `/api/traffic`, `/api/servers`, `/api/panel`, `/api/batch`, `/api/jobs`, `/api/user-policy`, `/api/user-groups`, `/api/users`, `/api/clients`, `/api/certificates`, and `/api/system` behind `authMiddleware + auditorOrAbove`, while individual routes enforce `operatorOrAbove` on operational mutations (with staff-account protection preventing `operator` from creating, modifying, disabling, or deleting non-`user` accounts) and `adminOnly` on `/api/xray`, `/api/system/settings`, `/api/system/credentials/rotate`, and audit deletion
- **Panel proxy access policy (`server/lib/proxyAccessPolicy.ts`)**: `/api/panel/:serverId/*` paths are decoded and POSIX-normalized before evaluation: `admin` has full access; `operator` is denied `ADMIN_ONLY_PATHS` (panel settings/credentials/API tokens, raw DB export/import, multi-node `/panel/api/nodes*`, s-ui `tokens`/`users`/`sessions`/`settings`/`load`/`getdb`/`importdb`) and `POST /sui/save` is constrained to an allowlist of non-admin objects; `auditor` is restricted to `AUDITOR_GET_PATHS` (including `clients/list/paged`, `clients/get/subId/*`, `clients/get/tgId/*`, `clients/groups*`, `hosts/*`, `sub-balancers`) and `READ_ONLY_POST_PATHS`
- **Global error handler**: hides internal stacks in production with bilingual 413/400/4xx/500 JSON responses
- Public subscription access uses token validation, not admin sessions
- The configurable homepage access path and camouflage landing page only change how the UI entry is served; they do not rewrite `/api/subscriptions/public/*`
- Subscription payloads are merged by persisted server order first and inbound order second; changing sort order does not rewrite issued subscription URLs
- Production mode enforces checks against weak usernames, passwords, and secrets, and `securityBootstrap` avoids persisting plaintext `ADMIN_PASSWORD` in `${DATA_DIR}/runtime.env`
- **Encryption at rest & unified rotation**: server credentials, `systemSettingsStore` (webhook secrets & Bark keys), `certificateStore` (`privateKey` & `cfApiToken`), and `subscriptionTokenStore` encrypt secrets using `CREDENTIALS_SECRET` and support unified rotation via `POST /api/system/credentials/rotate` (`dryRun` supported); local and Telegram backups use AES-256-GCM + scrypt v3 archives
- Trusted proxy handling supports `TRUST_PROXY`, gated `TRUST_CLOUDFLARE_HEADERS` / Cloudflare edge IP range verification, and right-to-left XFF parsing to prevent client IP spoofing

### Real-time and background work

- **Single-use WebSocket tickets & payload caps**: `/api/ws/ticket` issues short-lived tokens carrying `jti` and `tokenVersion`; `verifyWsTicket` enforces a bounded single-use `jti` replay cache (10,000 max), and `wsServer.ts` validates active staff status, role, `tokenVersion`, and a `64 KiB` `maxPayload` cap
- **Graceful shutdown pipeline**: `setupGracefulShutdown` stops background monitors, warmers, Telegram alerts, and expiry notifiers, flushes pending notifications, audit buffers, the `securityAudit` stream, and `flushSnapshotQueue`, then closes WebSocket, HTTP, PostgreSQL, and SQLite handles cleanly
- `serverHealthMonitor` samples server health in the background
- `telegramAlertService` handles structured Telegram delivery, optional command-menu management, periodic digests, and repeated-event aggregation
- `subscriptionExpiryNotifier` periodically checks subscription expiry and dispatches notifications
- `securityAudit` uses a rotating persistent write stream and an in-memory sliding-window ring buffer for security pattern matching, avoiding event-loop blocking
- `taskQueue` enforces a capacity cap (1000) and auto-prunes completed tasks on overflow
- Batch jobs, audit records, and traffic stats each have dedicated retention controls

### Frontend loading strategy

- `Dashboard` prefers WebSocket or cached cluster snapshots on first paint, and only hydrates heavier online detail when the operator opens it
- `Users` renders the base account table first and then syncs node statistics in the background
- `User Detail` reuses the same server-panel cache path as `Users` to avoid rescanning the same nodes
- The notification center fetches only unread count and a lightweight preview first, and expands into a fuller list only when the bell is opened
- `Settings` lazily loads per-workspace diagnostics instead of fetching every system status block on first open

### Preferred extension pattern

- For new features, keep the route -> service -> repository chain explicit
- Avoid embedding storage writes directly inside routes
- Reuse existing layout patterns and UI tokens for floating panels, tables, and modal behavior
