# NMS - Node Management System

NMS is a centralized management panel for multiple 3x-ui nodes. It keeps user lifecycle, subscription delivery, audit, and node operations in one place without requiring an external subscription converter.

## English

### Highlights

- Centralized management for multiple 3x-ui panels
- User lifecycle support: registration, email verification, password reset, admin-side user management
- Built-in subscription outputs: `v2rayN`, `Raw`, `Native`, `Reconstructed`, `Clash YAML`, `Mihomo YAML`, `sing-box import`
- User policy and provisioning controls: `limitIp`, traffic limit, expiry, per-client entitlement override
- Audit coverage: operation audit, subscription access logs, traffic trends, centralized 3x-ui log view
- Real visitor IP extraction under reverse proxy and Cloudflare
- Admin operations: SMTP diagnostics, system backup export, DB mode controls, node health monitoring, notification center
- Admin shell polish: working global page search in the top header with `Ctrl/Cmd + K`, plus improved light-theme readability and interaction consistency
- Security baseline: JWT auth, credential encryption, password policy, rate limiting, SSRF protection

### Architecture

The backend is now organized as:

- `route -> service -> repository / panel gateway`

This keeps public APIs stable while moving heavy business logic out of route files.

### Operational Notes

- NMS generates Clash and Mihomo YAML directly. No external subscription converter is required.
- Clash / Mihomo rules now use MetaCubeX `meta-rules-dat` `mrs` rule providers.
- Telegram backup can be triggered from NMS, but Telegram Bot configuration still lives in the 3x-ui panel because the official 3x-ui API does not document a config write endpoint for it.
- 3x-ui log API support depends on the remote node version and capability. NMS detects support and degrades gracefully when a node does not expose the expected log endpoints.
- The admin UI is now dark-first by default. The current visual baseline uses `IBM Plex Sans + Noto Sans SC + JetBrains Mono`.
- The top header search is now interactive instead of decorative. It can route by page keyword and supports `Ctrl/Cmd + K`.
- Light theme text tokens and interaction states were tightened so muted labels, helper text, and page-level search surfaces stay readable without dark hover artifacts.
- In production frontend-hosting mode, missing `client/dist/index.html` now returns an explicit `503` on SPA routes instead of an opaque `500` file error. Rebuild and sync the frontend bundle before restarting PM2.
- Inbound `settings` and `streamSettings` are normalized from either plain objects or JSON strings, so mixed panel payload shapes no longer break client counts or subscription generation.

### Requirements

- Linux (`Ubuntu 20.04+` / `Debian 11+` recommended)
- Node.js `18+` (`20 LTS` recommended)
- PM2
- Nginx (recommended, optional)
- PostgreSQL `14+` (optional, DB mode only)

### Quick Start (File Storage Mode)

1. Install dependencies

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
```

2. Deploy and build

```bash
sudo mkdir -p /opt/nms
sudo cp -r . /opt/nms/
cd /opt/nms/server && npm install --production
cd /opt/nms/client && npm install && npm run build
```

3. Configure environment

```bash
cd /opt/nms
cp .env.example .env
```

You must change at least:

- `JWT_SECRET`
- `CREDENTIALS_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

Optional but strongly recommended:

- `SUB_PUBLIC_BASE_URL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

The `.env.example` SMTP section is intentionally provider-neutral. Put your real mail provider host, port, and credentials only in your local `.env`.

4. Start the service

```bash
cd /opt/nms
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root
```

5. Access the panel

- `http://SERVER_IP:3001`

### Upgrade and Deployment Workflow

Use this when upgrading an existing `/opt/nms` deployment:

```bash
cd /root/NMS/client && npm install && npm run build
cd /root/NMS/client && npm test
cp -R /root/NMS/client/dist/assets/. /opt/nms/client/dist/assets/
cp /root/NMS/client/dist/index.html /opt/nms/client/dist/index.html
pm2 restart nms
```

This repository no longer relies on a `deploy.sh` helper. Use the explicit build, sync, and restart steps above or follow the full runbook.

For a full runbook, see [Deployment Runbook](docs/DEPLOYMENT_RUNBOOK.md).

### Main Admin Features

- Multi-node server registration, connectivity test, group/tag/environment governance
- Cross-node inbound management with sorting, batch actions, and protocol-aware editing
- Cross-node user management with subscription provisioning and entitlement sync
- Subscription access audit with real client IP, proxy IP, and optional geo lookup
- A shared admin shell with theme toggle, notification center, and top-header page search
- System Settings with SMTP diagnostics, backup export, DB runtime mode controls, and health monitor status

### Documentation

- [Architecture Overview](docs/ARCHITECTURE_OVERVIEW.md)
- [Admin UI Design Baseline](docs/UI_DESIGN_SYSTEM.md)
- [Deployment Runbook](docs/DEPLOYMENT_RUNBOOK.md)
- [3x-ui Alignment Matrix](docs/3XUI_ALIGNMENT_MATRIX.md)
- [DB Integration Guide](docs/DB_INTEGRATION_DEV.md)
- [Review Harness](docs/REVIEW_HARNESS.md)
- [Subscription Output Notes](docs/SUBSCRIPTION_CONVERTER_NOTES.md)
- [Feature and UI Audit](docs/NMS_FEATURE_UI_AUDIT.md)
- [Gap Backlog](docs/NMS_GAP_BACKLOG.md)

### Docker and GHCR

This repository includes:

- `Dockerfile`
- `.dockerignore`
- `.github/workflows/docker.yml`

On push to `main`, GitHub Actions builds and publishes images to GHCR:

- `ghcr.io/zangge8855/nms:latest`
- `ghcr.io/zangge8855/nms:<commit_sha>`

More configuration details: `.env.example`

---

## 中文

### 核心能力

- 多个 3x-ui 面板的集中管理
- 用户全流程支持：注册、邮箱验证、找回密码、管理员用户管理
- 内置订阅输出：`v2rayN`、`Raw`、`Native`、`Reconstructed`、`Clash YAML`、`Mihomo YAML`、`sing-box 导入`
- 用户策略与开通控制：`limitIp`、总流量、到期时间、单实例单独限定
- 审计能力：操作审计、订阅访问日志、流量趋势、集中 3x-ui 日志查看
- 在反代和 Cloudflare 场景下记录真实访客 IP
- 管理端增强：SMTP 诊断、系统备份导出、DB 模式切换、节点健康巡检、通知中心
- 管理端壳层增强：顶部全局页面搜索已可用，支持 `Ctrl/Cmd + K`，并补齐了浅色主题下的可读性与交互一致性
- 安全基线：JWT、凭据加密、密码策略、限流、SSRF 防护

### 架构说明

后端当前已整理为：

- `route -> service -> repository / panel gateway`

对外 API 保持兼容，重业务逻辑已经从路由层下沉。

### 运行说明

- NMS 现在直接生成 Clash / Mihomo YAML，不再依赖外部订阅转换器。
- Clash / Mihomo 规则源已切换为 MetaCubeX `meta-rules-dat` 的 `mrs` 规则提供器。
- NMS 可以触发 Telegram 备份，但 Telegram Bot 的 `Token / Chat ID / 定时通知` 仍需在 3x-ui 面板里配置，因为 3x-ui 官方 API 没有文档化的配置写入接口。
- 3x-ui 日志 API 是否可用取决于远端节点版本和能力；NMS 会先做能力探测，不支持时返回兼容提示而不是盲目报错。
- 当前管理端默认以深色主题作为主设计稿，字体基线为 `IBM Plex Sans + Noto Sans SC + JetBrains Mono`。
- 顶部搜索栏现在是可交互的页面搜索入口，不再只是装饰性占位；支持按页面关键词跳转，也支持 `Ctrl/Cmd + K` 快捷键。
- 浅色主题的文字 token 与搜索/悬浮交互层已统一收口，副标题、说明字、表头和搜索结果不再偏灰难辨，也不会在 hover 时回退成深色补丁。
- 生产环境如果启用了前端静态托管，但缺少 `client/dist/index.html`，SPA 路由现在会明确返回 `503`，而不是 `sendFile` 的 `500` 文件错误；升级时请先重新构建并同步前端产物。
- 入站 `settings` / `streamSettings` 已统一兼容“对象”或“JSON 字符串”两种形态，面板返回格式不一致时也不会再把客户端数量或订阅结果误判为空。

### 环境要求

- Linux（推荐 `Ubuntu 20.04+` / `Debian 11+`）
- Node.js `18+`（推荐 `20 LTS`）
- PM2
- Nginx（推荐，可选）
- PostgreSQL `14+`（可选，仅数据库模式）

### 快速开始（文件存储模式）

1. 安装依赖

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
```

2. 部署并构建

```bash
sudo mkdir -p /opt/nms
sudo cp -r . /opt/nms/
cd /opt/nms/server && npm install --production
cd /opt/nms/client && npm install && npm run build
```

3. 配置环境变量

```bash
cd /opt/nms
cp .env.example .env
```

至少必须修改：

- `JWT_SECRET`
- `CREDENTIALS_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

建议同时配置：

- `SUB_PUBLIC_BASE_URL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

`.env.example` 里的 SMTP 段保持为通用模板，不写死某个邮箱服务商；实际服务商主机、端口和凭据只填写到你本地部署的 `.env` 中。

4. 启动服务

```bash
cd /opt/nms
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root
```

5. 访问面板

- `http://SERVER_IP:3001`

### 升级与部署流程

对已有 `/opt/nms` 实例升级时，建议按下面的顺序执行：

```bash
cd /root/NMS/client && npm install && npm run build
cd /root/NMS/client && npm test
cp -R /root/NMS/client/dist/assets/. /opt/nms/client/dist/assets/
cp /root/NMS/client/dist/index.html /opt/nms/client/dist/index.html
pm2 restart nms
```

仓库已不再依赖 `deploy.sh` 之类的包装脚本；请直接使用上面的显式构建、同步和重启步骤，或参考完整 Runbook。

完整说明见：[部署与升级 Runbook](docs/DEPLOYMENT_RUNBOOK.md)

### 当前管理端重点能力

- 多节点服务器接入、连通性测试、分组/标签/环境治理
- 跨节点入站管理，支持排序、批量动作、协议感知编辑
- 跨节点用户管理，支持订阅开通和限额同步
- 订阅访问审计，支持真实 IP、代理 IP 和可选归属地
- 统一管理端壳层，支持主题切换、通知中心和顶部页面搜索
- 系统设置中可直接查看 SMTP 状态、导出备份、切换 DB 模式、查看健康巡检状态

### 文档索引

- [架构总览](docs/ARCHITECTURE_OVERVIEW.md)
- [管理端 UI 设计基线](docs/UI_DESIGN_SYSTEM.md)
- [部署与升级 Runbook](docs/DEPLOYMENT_RUNBOOK.md)
- [3x-ui 对齐矩阵](docs/3XUI_ALIGNMENT_MATRIX.md)
- [数据库接入指南](docs/DB_INTEGRATION_DEV.md)
- [订阅输出说明](docs/SUBSCRIPTION_CONVERTER_NOTES.md)
- [功能与 UI 审计](docs/NMS_FEATURE_UI_AUDIT.md)
- [缺口与 Backlog](docs/NMS_GAP_BACKLOG.md)

### Docker 与 GHCR

仓库已包含：

- `Dockerfile`
- `.dockerignore`
- `.github/workflows/docker.yml`

推送到 `main` 后会自动构建并发布镜像到 GHCR：

- `ghcr.io/zangge8855/nms:latest`
- `ghcr.io/zangge8855/nms:<commit_sha>`

更多配置请参考：`.env.example`
