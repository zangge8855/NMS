# NMS

## English

NMS is a bilingual control plane for 3x-ui / Xray operations. It brings server onboarding, inbound changes, user and subscription management, audit trails, backups, and system administration into one dashboard, so teams spend less time jumping between panel tabs, shell scripts, and handwritten runbooks.

It is built for operators who want a practical deployment path: start with file-backed storage, move to PostgreSQL when needed, keep Docker available for packaging, and retain enough auditability to trust day-to-day changes.

### Why NMS

- Centralize multi-node operations in one admin UI instead of logging into each panel separately
- Manage users, clients, subscriptions, and policy changes from the same workflow
- Keep an operational trail through audit logs, traffic views, notifications, and job history
- Use built-in backup, SMTP diagnostics, and runtime storage controls instead of external glue scripts
- Validate locally with the review harness before touching production nodes

### What You Can Do

- Onboard and monitor multiple 3x-ui nodes from a single dashboard
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
- Open the admin UI faster by rendering user lists before node-wide stats finish syncing, reusing shared node panel caches, and loading only notification previews until the bell is opened
- Keep late bootstrap snapshots from overriding live node choice, users, notifications, audit traffic, system settings, or telemetry after the page has already hydrated fresh data
- Run batch changes with risk controls and verify outcomes through audit records
- Reuse geo and carrier enrichment from subscription audit logs inside user activity views
- Configure a custom homepage access path in `Settings` to hide the UI behind a non-root entry when needed
- Enable an optional bilingual camouflage landing page so non-matching document requests show a public high-tech hardware homepage instead of the real control plane
- Choose from three camouflage templates — corporate (industrial automation homepage), blog (industry journal), or nginx (default server page) — each with startup-randomized CSS classes to prevent fingerprinting
- Search bot and scanner protection middleware automatically blocks common probes and crawlers
- Public subscription endpoints are rate-limited independently from admin APIs to prevent abuse
- Generate a random hidden UI entry path in `Settings` when you want a high-entropy access path without typing one manually
- Test SMTP, export backups, restore snapshots, inspect storage mode state, and use the embedded node console from the system area
- Let end users access a dedicated downloads center and self-service account center separate from the subscription page

### Deploy In Minutes

Prerequisites:

- Node.js `20+`, or Docker if you prefer container delivery
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

Verified source-install path on March 24, 2026:

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

- `client`: `npm ci`, `npm run build`, and `npm test` passed (`197/197`)
- `server`: `npm ci` and `npm test` passed (`271/271`)
- `client`: `npm audit` reports `0` vulnerabilities after upgrading Vite-related dependencies and transitive overrides
- `server`: `npm audit` reports `0` vulnerabilities after upgrading `multer` to `2.x` and overriding `qs`

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
client/   React + Vite admin app
server/   Express API, WebSocket, stores, services
docs/     Deployment, usage, architecture, and review notes
data/     Default file-backed storage
```

### Key Environment Variables

- `JWT_SECRET`: JWT signing secret; use a strong random value
- `ADMIN_USERNAME`: admin login name; avoid defaults
- `ADMIN_PASSWORD`: admin password; production should use a strong multi-class password
- `CREDENTIALS_SECRET`: dedicated encryption secret for stored node credentials
- `DATA_DIR`: file-backed storage directory
- `DB_ENABLED` / `DB_URL`: PostgreSQL toggle and connection string
- `SUB_PUBLIC_BASE_URL`: public base URL for subscription links
- `SUB_CONVERTER_BASE_URL`: optional external subscription converter base URL

### Documentation Map

- [Deployment Runbook](docs/DEPLOYMENT_RUNBOOK.md)
- [User Guide](docs/USER_GUIDE.md)
- [Architecture Overview](docs/ARCHITECTURE_OVERVIEW.md)
- [DB Integration Guide](docs/DB_INTEGRATION_DEV.md)
- [Review Harness](docs/REVIEW_HARNESS.md)
- [Subscription Converter Notes](docs/SUBSCRIPTION_CONVERTER_NOTES.md)
- [3x-ui Alignment Matrix](docs/3XUI_ALIGNMENT_MATRIX.md)
- [UI Design System](docs/UI_DESIGN_SYSTEM.md)
- [UI Audit](docs/NMS_FEATURE_UI_AUDIT.md)
- [Gap Backlog](docs/NMS_GAP_BACKLOG.md)

### Security Notes

- All sample domains, email addresses, and image tags in this repository are placeholders
- Never commit real admin passwords, SMTP credentials, database secrets, or panel endpoints
- Keep `.env`, `data/*.json`, `logs/`, `client/dist/`, and `server/dist/` out of Git; only examples and `.gitkeep` belong in the repository
- Production deployments should use HTTPS, strong secrets, and regular backups

## 中文

NMS 是一套面向 3x-ui / Xray 运维场景的双语管理后台。它把节点接入、入站维护、用户与订阅管理、审计追踪、备份恢复和系统设置集中到一个界面里，减少在多个面板、脚本和临时文档之间来回切换的成本。

它的定位很务实: 先用文件存储快速上线，规模上来后再接 PostgreSQL；既能直接源码部署，也能走 Docker；既能覆盖日常运维，也保留足够的审计和恢复能力，方便团队长期使用。

### 为什么用 NMS

- 多节点统一管理，不用逐台登录 3x-ui 面板处理日常操作
- 用户、客户端、订阅链接和策略调整放在同一条工作流里
- 审计日志、流量视图、通知和任务记录帮助团队复盘每次变更
- 内置备份、SMTP 诊断和运行模式控制，减少依赖外部脚本拼装
- Review Harness 方便本地演示、回归检查和上线前预演

### 你可以用它做什么

- 从一个后台接入并监控多个 3x-ui 节点
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
- 后台首屏优先显示基础数据，再后台补节点统计；同时复用共享节点缓存并延迟加载通知详情，减少登录后的首屏等待感
- 登录后的晚到 bootstrap 快照不会再把当前节点、用户列表、通知、审计流量、系统设置或节点遥测回写成旧首屏数据
- 在 `Settings` 里设置自定义首页访问路径，需要时把后台藏到非根路径
- 在 `Settings` 里设置真实入口路径、生成随机入口，并在需要时开启对外的中英双语伪装首页
- 伪装首页提供三套模板——企业官网（industrial automation）、行业博客、默认 Nginx 页——每套模板的 CSS class 后缀在启动时随机化，防止指纹识别
- 内置搜索引擎与扫描器探测拦截中间件，自动拦截常见爬虫和探测请求
- 公开订阅端点独立限流，与管理 API 限流策略分离，防止滥用
- 在系统页测试 SMTP、导出备份、恢复快照、查看存储模式状态，并直接打开内嵌节点控制台
- 普通用户可以使用独立的软件下载中心和自助账户中心，与订阅页分开
- 为下拉菜单和筛选框提供稳定的主题表面，避免 Chromium 点击时先闪一层黑色原生菜单

普通用户看到的订阅页面会尽量保持简单:

- 只强调 `选类型 -> 复制地址 -> 导入客户端`
- 快捷导入、复制地址、二维码和重置链接会集中在同一个主导入区
- 当切换不同订阅配置类型时，二维码和快捷导入按钮会同步切到当前类型
- 设备区只保留下载链接和推荐类型，不重复堆导入说明

### 几分钟完成部署

前置要求:

- Node.js `20+`，或者使用 Docker
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

已在 2026 年 3 月 24 日验证源码安装链路:

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

- `client`: `npm ci`、`npm run build`、`npm test` 全部通过（`197/197`）
- `server`: `npm ci`、`npm test` 全部通过（`271/271`）
- `client`: 升级 Vite 相关依赖及其传递依赖覆盖后，`npm audit` 为 `0` 告警
- `server`: 升级 `multer` 到 `2.x` 并覆盖 `qs` 后，`npm audit` 为 `0` 告警

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
client/   React + Vite 管理端
server/   Express API、WebSocket、存储层与服务层
docs/     部署、使用、架构与评审文档
data/     默认文件存储目录
```

### 关键环境变量

- `JWT_SECRET`: JWT 签名密钥，必须使用足够强的随机值
- `ADMIN_USERNAME`: 管理员账号，建议不要使用默认值
- `ADMIN_PASSWORD`: 管理员密码，生产环境应满足多类字符复杂度
- `CREDENTIALS_SECRET`: 节点凭据加密密钥，建议与 JWT 密钥分离
- `DATA_DIR`: 文件存储目录
- `DB_ENABLED` / `DB_URL`: PostgreSQL 开关与连接串
- `SUB_PUBLIC_BASE_URL`: 对外订阅基址
- `SUB_CONVERTER_BASE_URL`: 可选的外部订阅转换器基址

### 文档索引

- [部署 Runbook](docs/DEPLOYMENT_RUNBOOK.md)
- [使用说明](docs/USER_GUIDE.md)
- [架构总览](docs/ARCHITECTURE_OVERVIEW.md)
- [数据库接入指南](docs/DB_INTEGRATION_DEV.md)
- [Review Harness](docs/REVIEW_HARNESS.md)
- [订阅转换器说明](docs/SUBSCRIPTION_CONVERTER_NOTES.md)
- [3x-ui 对齐矩阵](docs/3XUI_ALIGNMENT_MATRIX.md)
- [UI 设计系统](docs/UI_DESIGN_SYSTEM.md)
- [UI 审计](docs/NMS_FEATURE_UI_AUDIT.md)
- [差距与待办](docs/NMS_GAP_BACKLOG.md)

### 安全说明

- 仓库中的域名、邮箱和镜像标签都是通用占位符
- 不要提交真实管理员口令、SMTP 凭据、数据库密钥或节点地址
- `.env`、`data/*.json`、`logs/`、`client/dist/`、`server/dist/` 这类运行数据和构建产物应始终留在 Git 之外
- 提交前建议额外清理 `client/node_modules/.vite`、临时测试数据目录和本地导出的备份文件
- 生产环境建议启用 HTTPS、强密钥和定期备份
