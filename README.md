# NMS

## English

NMS is a bilingual control plane for 3x-ui (Xray) and s-ui (sing-box) operations. It brings server onboarding, inbound changes, user and subscription management, audit trails, backups, and system administration into one dashboard, so teams spend less time jumping between panel tabs, shell scripts, and handwritten runbooks.

It is built for operators who want a practical deployment path: start with file-backed storage, move to PostgreSQL when needed, keep Docker available for packaging, and retain enough auditability to trust day-to-day changes.

### Why NMS

- Centralize multi-node operations in one admin UI instead of logging into each panel separately
- Manage users, clients, subscriptions, and policy changes from the same workflow
- Keep an operational trail through audit logs, traffic views, notifications, and job history
- Use built-in backup, SMTP diagnostics, and runtime storage controls instead of external glue scripts
- Validate locally with the review harness before touching production nodes

### What You Can Do

- Onboard and monitor multiple 3x-ui and s-ui nodes from a single dashboard (see [s-ui Node Support](docs/SUI_SUPPORT.md))
- Manage inbounds, client credentials, traffic limits, expiry, and protocol-specific settings
- Enable invite-only registration, batch-generate invite codes, control per-code usage limits, and define the subscription duration each code grants
- Keep subscription URLs stable while sharing client-ready links for raw, native, Clash, Mihomo, and sing-box style consumption
- Keep issued subscription URLs stable while making delivered node order follow saved server and inbound order
- Manage admin-side subscriptions from `Users`, while keeping a self-service subscription page for end users
- Keep the end-user subscription page focused on four actions: choose a profile, quick import, copy the address, and scan the QR code
- Keep admin and end-user subscription presentation aligned, so `Users -> User Detail -> Subscription` now mirrors the self-service subscription center instead of exposing a separate admin-only layout
- Let invite-code registration activate the account immediately and auto-provision a ready-to-use subscription without manual approval
- Keep selects and dropdown panels on explicit surfaces so Chromium no longer flashes a black native menu before the final theme is applied
- Use structured Telegram digests with clear sections, bold key values, and command-menu discovery for status, security, expiry, and operations summaries
- Use the header command search to jump to pages, users, and nodes, or run common actions such as refresh, create user, and add server
- Open the admin UI faster by rendering user lists before node-wide stats finish syncing, reusing shared node panel caches, and loading only notification previews until the bell is opened
- Open the admin shell with a lightweight bootstrap payload first, then hydrate heavier audit, settings, task, and telemetry data from their own pages
- Keep late bootstrap snapshots from overriding live node choice, users, notifications, audit traffic, system settings, or telemetry after the page has already hydrated fresh data
- Run batch changes with risk controls and verify outcomes through audit records
- Reuse geo and carrier enrichment from subscription audit logs inside user activity views
- Configure a custom homepage access path in `Settings` to hide the UI behind a non-root entry when needed
- Enable an optional bilingual camouflage landing page so non-matching document requests show a public city-magazine homepage instead of the real control plane
- Choose from three city-focused camouflage templates — city guide, weekly notes, or static welcome page — each with startup-randomized CSS classes to reduce fingerprinting
- Search bot and scanner protection middleware automatically blocks common probes and crawlers
- Block search engine indexing by default with robots meta tags and a robots.txt configuration to keep the admin panel secure and hidden from public search probes
- Enjoy dynamic browser tab titles that change automatically on page navigation (e.g. `Users · NMS`), matching the current route and locale
- Public subscription endpoints are rate-limited independently from admin APIs to prevent abuse
- Browser security headers are applied centrally, and request logs redact public subscription tokens and sensitive query values
- Generate a random hidden UI entry path in `Settings` when you want a high-entropy access path without typing one manually
- Test SMTP, export backups, restore snapshots, inspect storage mode state, and use the embedded node console from the system area
- Let end users access a dedicated downloads center and self-service account center separate from the subscription page
- Enforce 4-tier RBAC (`admin`, `operator`, `auditor`, `user`) across API mounts, panel proxy allowlists, operator staff-account protection, and frontend route/action gating
- Align with 3x-ui v3.11 capabilities including Panel API Tokens, Panel Features (`Client Groups`, paged `Client Directory` with exact `SubID` & `TG ID` lookup, `Subscription Hosts`, `Sub Balancers`, `Outbound Subs`, `Panel Nodes`), and per-client HWID device management
- Filter Header notifications by severity (`Critical`, `Warning`, `Info`) and unread status, and jump directly to referenced servers or audit logs
- Customize Dashboard card visibility per user (`localStorage`) with one-click reset and export cluster KPI / traffic / node health snapshots to UTF-8 BOM CSV
- Harden runtime security and resilience with gated Cloudflare/XFF IP resolution, unified AES-256-GCM secret rotation (`POST /api/system/credentials/rotate`), scrypt v3 encrypted backups, single-use WebSocket tickets (`jti` replay protection & graceful HTTP/WS/SQLite shutdown), SQLite/PostgreSQL snapshot queue fixes, SS-2022/Clash/Surge/sing-box/TUIC/Hysteria2 protocol alignment, and a dynamic-port E2E + v3 Review Harness
- Modernize UI and JS to ES2023 (`AbortSignal.timeout`, `.toSorted()`, `structuredClone()`, `0` `modern-web-guidance` legacy-scan findings) with Forced-Colors-safe WAI-ARIA roving tabs, scroll-driven tab edge-fade masks, keyboard-scrollable sticky-header tables, `viewport-fit=cover` + `scroll-padding-bottom` safe-area adaptation, 44px coarse-pointer targets, compositor press/spring popover animations, and `accent-color` + `scrollbar-color` theming

### Deploy In Minutes

Prerequisites:

- Node.js `22`, or Docker if you prefer container delivery
- A local `.env` copied from `.env.example`
- Production values for `JWT_SECRET`, `ADMIN_PASSWORD`, `ADMIN_USERNAME`, and `CREDENTIALS_SECRET`
- The production startup preflight now stops early if `.env` is unsafe or `client/dist` is missing

Source deployment:

```bash
cd client
npm ci
npm run build

cd ../server
npm ci
NODE_ENV=production node scripts/start_production.js
```

Verified source-install path on November 18, 2026:

```bash
cd client
npm ci
npm run build
npm test

cd ../server
npm ci
npm test
```

Current verification result:

- `client`: 100% TypeScript (`client/src/**/*.{ts,tsx}`), `npm run lint` (`eslint . --max-warnings=0 && tsc --noEmit`) passed, `npm run build` passed (`client/dist`, `873` modules), `npx modern-web-guidance legacy-scan client/src --json` reported `0` findings (`38` guides / `52` rules), and `npm test` passed (`442/442` tests across `70` test files)
- `server`: 100% TypeScript (`server/**/*.ts`), `npm run typecheck` (`tsc --noEmit`) clean (`0` errors), and `npm test` passed (`756/756` tests across `71` suites, including `60/60` E2E tests)
- `backward-compat`: 100% compatibility for existing `/data` JSON files, database schemas, password hashes, and startup commands
- `client` and `server` (runtime): `npm audit --omit=dev --audit-level=high` reports `0` vulnerabilities
- Browser review: desktop and mobile admin/user surfaces were checked across Chinese/English and light/dark schemes with no document-level overflow, console errors, or page errors

Process supervision with PM2:

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

Docker deployment:

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

Default runtime endpoints:

- App and static assets are served by the backend in production mode
- API: `http://127.0.0.1:3001/api`
- Frontend dev server: `http://127.0.0.1:5173`
- The app homepage defaults to `/` and can later be changed in `Settings -> Site Access Path`
- `Settings` can also enable a public camouflage homepage for requests that do not match the real UI path
- Changing the homepage access path does not change existing subscription public URLs

### How Teams Use It

1. Add panel nodes in `Servers`.
2. Check health, quick actions, and capability detection from `Dashboard`.
3. Manage users, user subscriptions, and activity details in `Users`.
4. Let end users open `Subscriptions` for self-service links and password changes.
5. Review operational outcomes in `Audit`, notification summaries, user activity logs, and the dashboard.
6. Tune homepage access path, optional camouflage landing page, invite-only registration, SMTP diagnostics, domain-change mail broadcast, backups, security, Telegram delivery, storage runtime modes, and the embedded node console in `Settings`.

### Why It Is Practical

- Less context switching: nodes, subscriptions, user policies, and system settings live in one product
- Safer changes: batch risk controls, audit history, and backup export/restore reduce blind spots
- Easier scaling: file mode works out of the box, while PostgreSQL and Docker are ready when the deployment grows
- Better support handoff: bilingual UI and user-facing subscription flows reduce friction between ops and customer support

### Stack And Layout

```text
client/   React 18 + TypeScript + Vite admin app (src/**/*.tsx, src/**/*.ts)
server/   Express API + TypeScript (tsx), WebSocket, stores, services (server/**/*.ts)
docs/     Deployment, usage, architecture, and review notes
data/     Default file-backed storage (100% backward compatible)
```

### Key Environment Variables

- `JWT_SECRET`: JWT signing secret; use a strong random value, or leave it empty to have one generated into `${DATA_DIR}/runtime.env`
- `ADMIN_USERNAME`: admin login name; avoid defaults
- `ADMIN_PASSWORD`: admin password; production should use a strong multi-class password
- `CREDENTIALS_SECRET`: dedicated encryption secret for stored node credentials; generated into `${DATA_DIR}/runtime.env` when empty
- `ENFORCE_STRICT_SECURITY`: refuse to start with weak admin credentials or secrets; defaults to `true` in production
- `SUB_LEGACY_SIGNATURE_ENABLED`: re-enable old non-expiring `/public/<email>/<signature>` subscription links; defaults to `false`
- `DB_SSL_MODE` / `DB_SSL_CA_FILE`: PostgreSQL TLS (`disable`, `require`, `verify-full`) and an optional CA bundle
- `AUDIT_RETENTION_DAYS`, `AUDIT_MAX_EVENTS`, `AUDIT_MAX_SUBSCRIPTION_ACCESS_RECORDS`, `AUDIT_LOG_MAX_MB`, `AUDIT_LOG_MAX_FILES`: audit storage limits and log rotation
- `TRUST_PROXY`: trusted reverse-proxy sources for `X-Forwarded-*`; defaults to `loopback`
- `SECURITY_HSTS_ENABLED`: controls the `Strict-Transport-Security` header; defaults to enabled in production and disabled elsewhere
- `SECURITY_HSTS_MAX_AGE_SECONDS`: HSTS max-age; defaults to `15552000`
- `DATA_DIR`: file-backed storage directory. Use a persistent path; do not point production at `/tmp` or `/var/tmp`
- `DB_ENABLED` / `DB_URL`: PostgreSQL toggle and connection string
- `SUB_PUBLIC_BASE_URL`: public base URL for subscription links
- `SUB_CONVERTER_BASE_URL`: optional external subscription converter base URL
- `SUB_CONVERTER_CLASH_CONFIG_URL` / `SUB_CONVERTER_SINGBOX_CONFIG_URL` / `SUB_CONVERTER_SURGE_CONFIG_URL`: optional full worker config URLs passed to the converter as `config=...`

### Documentation Map

- [Deployment Runbook](docs/DEPLOYMENT_RUNBOOK.md)
- [Testing](docs/TESTING.md)
- [User Guide](docs/USER_GUIDE.md)
- [Architecture Overview](docs/ARCHITECTURE_OVERVIEW.md)
- [DB Integration Guide](docs/DB_INTEGRATION_DEV.md)
- [Review Harness](docs/REVIEW_HARNESS.md)
- [Subscription Converter Notes](docs/SUBSCRIPTION_CONVERTER_NOTES.md)
- [3x-ui Alignment Matrix](docs/3XUI_ALIGNMENT_MATRIX.md)
- [s-ui Node Support](docs/SUI_SUPPORT.md)
- [UI Design System](docs/UI_DESIGN_SYSTEM.md)
- [UI Audit](docs/NMS_FEATURE_UI_AUDIT.md)
- [Gap Backlog](docs/NMS_GAP_BACKLOG.md)

### Security Notes

- All sample domains, email addresses, and image tags in this repository are placeholders
- Never commit real admin passwords, SMTP credentials, database secrets, or panel endpoints
- Keep `.env`, `data/*.json`, `logs/`, `client/dist/`, and `server/dist/` out of Git; only examples and `.gitkeep` belong in the repository
- Production deployments should use HTTPS, strong secrets, and regular backups
- Back up `${DATA_DIR}/runtime.env` together with `data/`; it holds any generated secrets, and losing it makes stored node credentials and encrypted backups unreadable
- Configuration precedence is: process environment, then `${DATA_DIR}/runtime.env`, then `.env`
- Repeated failed sign-ins temporarily block an account, an IP, or the pair for 15 minutes; node-control proxy access is limited by role (see the [runbook](docs/DEPLOYMENT_RUNBOOK.md#security-behaviour))

## 中文

NMS 是一套面向 3x-ui（Xray）与 s-ui（sing-box）运维场景的双语管理后台。它把节点接入、入站维护、用户与订阅管理、审计追踪、备份恢复和系统设置集中到一个界面里，减少在多个面板、脚本和临时文档之间来回切换的成本。

它的定位很务实: 先用文件存储快速上线，规模上来后再接 PostgreSQL；既能直接源码部署，也能走 Docker；既能覆盖日常运维，也保留足够的审计和恢复能力，方便团队长期使用。

### 为什么用 NMS

- 多节点统一管理，不用逐台登录 3x-ui / s-ui 面板处理日常操作
- 用户、客户端、订阅链接和策略调整放在同一条工作流里
- 审计日志、流量视图、通知和任务记录帮助团队复盘每次变更
- 内置备份、SMTP 诊断和运行模式控制，减少依赖外部脚本拼装
- Review Harness 方便本地演示、回归检查和上线前预演

### 你可以用它做什么

- 从一个后台接入并监控多个 3x-ui 和 s-ui 节点（见 [s-ui 节点支持](docs/SUI_SUPPORT.md)）
- 统一维护入站、客户端凭据、流量额度、到期时间和协议参数
- 开启邀请制注册，批量生成邀请码，限制每个邀请码可使用次数，并设置每个邀请码自动开通的订阅时长
- 在登录页通过邮箱验证码找回密码，并且对外统一返回结果，不暴露邮箱是否已注册
- 在保持订阅网址稳定的前提下，输出适合原始链接、原生导入、Clash、Mihomo、sing-box 等场景的订阅地址
- 在不改变已发订阅网址的前提下，让用户收到的节点顺序跟随服务器顺序和入站顺序
- 管理员在 `Users` 中统一处理订阅资料，普通用户仍可在 `Subscriptions` 中自助使用
- 管理员在 `Users -> 用户详情 -> 订阅` 中看到的导入区与普通用户订阅中心保持同一套结构，减少两套入口并行导致的认知差异
- 邀请码注册成功后可直接登录，后台会自动开通可用订阅，不再依赖人工审核
- 对批量变更做风险控制，并用审计记录确认执行结果
- 在用户活动日志中复用订阅访问审计的归属地与运营商信息
- Telegram 通知采用结构化摘要排版，重点数值加粗，并支持状态、安全、到期和运维汇总命令
- 使用顶部命令搜索快速跳转页面、用户和节点，也可以直接执行刷新当前页、添加账号、添加服务器等常用动作
- 后台首屏优先显示基础数据，再后台补节点统计；同时复用共享节点缓存并延迟加载通知详情，减少登录后的首屏等待感
- 登录后先加载轻量后台外壳，再由审计、设置、任务和遥测等页面按需加载重数据
- 登录后的晚到 bootstrap 快照不会再把当前节点、用户列表、通知、审计流量、系统设置或节点遥测回写成旧首屏数据
- 在 `Settings` 里设置自定义首页访问路径，需要时把后台藏到非根路径
- 在 `Settings` 里设置真实入口路径、生成随机入口，并在需要时开启对外的中英双语城市杂志伪装首页
- 伪装首页提供三套城市主题模板——城市指南、周末札记、静态欢迎页——每套模板的 CSS class 后缀在启动时随机化，降低指纹识别风险
- 内置搜索引擎与扫描器探测拦截中间件，自动拦截常见爬虫和探测请求
- 默认配置 robots meta 标签与 robots.txt 屏蔽搜索引擎抓取与索引，确保管理面板的隐私与安全性
- 浏览器标签页标题随路由导航和语言环境动态更新（如 `用户管理 · NMS`），提供高品质的导航体验
- 公开订阅端点独立限流，与管理 API 限流策略分离，防止滥用
- 后端统一下发浏览器安全响应头，并在请求日志中脱敏公开订阅 Token 与敏感查询参数
- 在系统页测试 SMTP、导出备份、恢复快照、查看存储模式状态，并直接打开内嵌节点控制台
- 普通用户可以使用独立的软件下载中心和自助账户中心，与订阅页分开
- 为下拉菜单和筛选框提供稳定的主题表面，避免 Chromium 点击时先闪一层黑色原生菜单
- 通过四层 RBAC 角色体系（`admin`、`operator`、`auditor`、`user`）隔离接口挂载、面板代理白名单、运维人员越权修改工作人员账号保护与前端只读/管理菜单权限
- 全面对齐 3x-ui v3.11 面板能力，包括 Panel API Token、面板功能页签（客户端分组、支持 `SubID`/`TG ID` 精确查询的分页客户端目录、订阅 Hosts、订阅均衡器、Xray 出站订阅、面板多节点）以及客户端 HWID 设备管理
- 在顶部通知铃铛中按严重级别（`严重`、`警告`、`信息`）与`仅未读`筛选告警，并一键跳转至对应节点详情或审计中心
- 按用户偏好在 `localStorage` 中定制仪表盘卡片显示与恢复默认，并支持导出含集群 KPI、流量周期和节点健康状态的 UTF-8 BOM CSV 快照
- 强化全栈安全与存储弹性，涵盖受控 Cloudflare/XFF IP 解析、多存储统一密钥轮换（`POST /api/system/credentials/rotate`）、AES-256-GCM scrypt v3 加密备份、单次 WebSocket Ticket 防重放与优雅停机、SQLite/PostgreSQL 快照队列修复、SS-2022/Clash/Surge/sing-box/TUIC/Hysteria2 协议对齐及动态端口 E2E 与 v3 Review Harness
- 落地 `modern-web-guidance` ES2023 JS 现代化（`AbortSignal.timeout`、`.toSorted()`、`structuredClone()`，遗留扫描 `0` 项告警）、Forced-Colors 安全的 WAI-ARIA Roving Tabs 与横向标签滚动渐隐遮罩、键盘可聚焦吸顶表头表格、移动端 `viewport-fit=cover` 与 `scroll-padding-bottom` 安全区适配、44px 粗指针触控区、合成层按压与弹簧弹窗动效及 `accent-color` + `scrollbar-color` 主题体系

普通用户看到的订阅页面会尽量保持简单:

- 只强调 `选类型 -> 复制地址 -> 导入客户端`
- 快捷导入、复制地址、二维码和重置链接会集中在同一个主导入区
- 当切换不同订阅配置类型时，二维码和快捷导入按钮会同步切到当前类型
- 设备区只保留下载链接和推荐类型，不重复堆导入说明

### 几分钟完成部署

前置要求:

- Node.js `22`，或者使用 Docker
- 基于 `.env.example` 复制出本地 `.env`
- 在生产环境中配置好 `JWT_SECRET`、`ADMIN_PASSWORD`、`ADMIN_USERNAME`、`CREDENTIALS_SECRET`
- 生产启动前会先做 preflight；如果 `.env` 不安全或 `client/dist` 缺失，会直接给出明确报错

源码部署:

```bash
cd client
npm ci
npm run build

cd ../server
npm ci
NODE_ENV=production node scripts/start_production.js
```

已在 2026 年 11 月 18 日完成全栈更新与全量测试验证:

```bash
cd client
npm ci
npm run build
npm test

cd ../server
npm ci
npm test
```

当前验证结果:

- `client`: 100% TypeScript (`client/src/**/*.{ts,tsx}`)，`npm run lint`（`eslint . --max-warnings=0 && tsc --noEmit`）通过，`npm run build` 生产构建成功（`client/dist`，`873` 模块），`npx modern-web-guidance legacy-scan client/src --json` 报告 `0` 项告警（`38` 项指南 / `52` 条规则），`npm test` 全部通过（`70` 测试文件 / `442/442` 测试）
- `server`: 100% TypeScript (`server/**/*.ts`)，`npm run typecheck`（`tsc --noEmit`）严格类型检查通过（`0` 错误），`npm test` 全部通过（`71` 套件 / `756/756` 测试，含 `60/60` 端到端测试）
- `平滑升级兼容性`: 现存 `/data` JSON 文件存储、PostgreSQL 数据库、密码哈希与启动命令 100% 向下兼容
- `client` 与 `server`（生产依赖）: `npm audit --omit=dev --audit-level=high` 报告 `0` 漏洞
- 浏览器验收：桌面端与移动端的管理员 / 普通用户界面已覆盖中英双语和明暗主题，无文档级横向溢出、控制台错误或页面错误

如需常驻运行，可配合 PM2:

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

Docker 部署:

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

The image declares `/app/data` and `/app/logs` as runtime volumes, but you should still mount named or host volumes explicitly. Without a persistent `/app/data` mount, file-backed users, settings, audit logs, telemetry, invite codes, subscriptions, and backups can disappear when the container is recreated.

默认运行地址:

- 生产模式下由后端直接托管前端构建产物
- API: `http://127.0.0.1:3001/api`
- 前端开发服务: `http://127.0.0.1:5173`
- 首页默认从 `/` 打开，后续可以在 `系统设置 -> 首页访问路径` 里改掉
- 可以在 `系统设置` 中直接生成随机入口路径，并按需开启公开伪装首页
- 修改首页访问路径不会改变已有订阅公开链接

### 团队通常怎么用

1. 在 `Servers` 里录入节点。
2. 在 `Dashboard` 里检查节点健康状态、快捷入口和能力探测结果。
3. 在 `Users` 里维护用户、订阅资料和活动详情。
4. 让普通用户在 `Subscriptions` 中自助查看链接和修改密码。
5. 在 `Audit`、通知中心、用户活动日志和仪表盘里确认变更效果。
6. 在 `Settings` 里配置首页访问路径、邀请注册、SMTP 诊断、网址变更通知、备份、安全策略、Telegram 与节点控制台。

### 为什么它更省事

- 少切页: 节点、订阅、用户策略和系统配置都在同一个产品里
- 更稳: 批量风险控制、审计历史和备份恢复降低误操作成本
- 更容易扩展: 默认文件模式开箱即用，需要时再切 PostgreSQL 或 Docker
- 更方便协作: 双语界面和用户侧订阅流程，适合运维、管理员和支持团队共同使用

### 技术栈与目录

```text
client/   React 18 + TypeScript + Vite 管理端 (src/**/*.tsx, src/**/*.ts)
server/   Express API + TypeScript (tsx)、WebSocket、存储层与服务层 (server/**/*.ts)
docs/     部署、使用、架构与评审文档
data/     默认文件存储目录 (100% 向下兼容)
```

### 关键环境变量

- `JWT_SECRET`: JWT 签名密钥，必须使用足够强的随机值；留空时自动生成并写入 `${DATA_DIR}/runtime.env`
- `ADMIN_USERNAME`: 管理员账号，建议不要使用默认值
- `ADMIN_PASSWORD`: 管理员密码，生产环境应满足多类字符复杂度
- `CREDENTIALS_SECRET`: 节点凭据加密密钥，必须与 JWT 密钥分离；留空时自动生成并写入 `${DATA_DIR}/runtime.env`
- `ENFORCE_STRICT_SECURITY`: 管理员口令或密钥过弱时拒绝启动；生产环境默认 `true`
- `SUB_LEGACY_SIGNATURE_ENABLED`: 重新启用旧版永不过期的 `/public/<email>/<signature>` 订阅链接；默认 `false`
- `DB_SSL_MODE` / `DB_SSL_CA_FILE`: PostgreSQL TLS 模式（`disable`、`require`、`verify-full`）与可选 CA 证书文件
- `AUDIT_RETENTION_DAYS`、`AUDIT_MAX_EVENTS`、`AUDIT_MAX_SUBSCRIPTION_ACCESS_RECORDS`、`AUDIT_LOG_MAX_MB`、`AUDIT_LOG_MAX_FILES`: 审计存储上限与日志轮转
- `TRUST_PROXY`: 可信反向代理来源，用于接收 `X-Forwarded-*`；默认只信任 `loopback`
- `SECURITY_HSTS_ENABLED`: 控制 `Strict-Transport-Security` 响应头；默认生产环境启用，其他环境关闭
- `SECURITY_HSTS_MAX_AGE_SECONDS`: HSTS max-age，默认 `15552000`
- `DATA_DIR`: 文件存储目录。生产环境必须使用持久化路径，不要指向 `/tmp` 或 `/var/tmp`
- `DB_ENABLED` / `DB_URL`: PostgreSQL 开关与连接串
- `SUB_PUBLIC_BASE_URL`: 对外订阅基址
- `SUB_CONVERTER_BASE_URL`: 可选的外部订阅转换器基址
- `SUB_CONVERTER_CLASH_CONFIG_URL` / `SUB_CONVERTER_SINGBOX_CONFIG_URL` / `SUB_CONVERTER_SURGE_CONFIG_URL`: 可选的完整规则配置地址, 会作为转换器的 `config=...` 参数传入

### 文档索引

- [部署 Runbook](docs/DEPLOYMENT_RUNBOOK.md)
- [测试说明](docs/TESTING.md)
- [使用说明](docs/USER_GUIDE.md)
- [架构总览](docs/ARCHITECTURE_OVERVIEW.md)
- [数据库接入指南](docs/DB_INTEGRATION_DEV.md)
- [Review Harness](docs/REVIEW_HARNESS.md)
- [订阅转换器说明](docs/SUBSCRIPTION_CONVERTER_NOTES.md)
- [3x-ui 对齐矩阵](docs/3XUI_ALIGNMENT_MATRIX.md)
- [s-ui 节点支持](docs/SUI_SUPPORT.md)
- [UI 设计系统](docs/UI_DESIGN_SYSTEM.md)
- [UI 审计](docs/NMS_FEATURE_UI_AUDIT.md)
- [差距与待办](docs/NMS_GAP_BACKLOG.md)

### 安全说明

- 仓库中的域名、邮箱和镜像标签都是通用占位符
- 不要提交真实管理员口令、SMTP 凭据、数据库密钥或节点地址
- `.env`、`data/*.json`、`logs/`、`client/dist/`、`server/dist/` 这类运行数据和构建产物应始终留在 Git 之外
- 提交前建议额外清理 `client/node_modules/.vite`、临时测试数据目录和本地导出的备份文件
- 生产环境建议启用 HTTPS、强密钥和定期备份
- 请把 `${DATA_DIR}/runtime.env` 与 `data/` 一起备份：自动生成的密钥保存在这里，丢失后已保存的节点凭据和加密备份将无法解密
- 配置优先级：进程环境变量 > `${DATA_DIR}/runtime.env` > `.env`
- 连续登录失败会让账号、IP 或二者组合被临时禁止登录 15 分钟；节点控制代理按角色限制权限（详见 [Runbook](docs/DEPLOYMENT_RUNBOOK.md#安全行为)）
