# NMS - Node Management System

NMS is a centralized management panel for multiple 3x-ui nodes. It keeps node operations, inbound management, user lifecycle, subscriptions, audit, tasks, and system settings in one place.

NMS 是一套面向多 3x-ui 节点的集中管理面板，把节点运维、入站管理、用户生命周期、订阅分发、审计、任务中心和系统设置统一到一个后台中。

## English

### Highlights

- Centralized multi-node management for 3x-ui panels
- User lifecycle support: registration, verification, password reset, admin-side user governance
- Built-in subscription outputs: `v2rayN`, `Raw`, `Native`, `Reconstructed`, `Clash YAML`, `Mihomo YAML`, `sing-box import`
- User-level legacy subscription path migration for smooth domain replacement
- Audit coverage for operations, subscription access, traffic trends, and centralized logs
- System settings for SMTP diagnostics, backup export, DB runtime mode, and health monitoring
- Responsive admin shell for desktop and mobile, with theme mode following the system by default
- Chinese-first UI with optional English switching; the header now shows one language at a time

### Architecture

The backend is organized as:

- `route -> service -> repository / panel gateway`

This keeps HTTP contracts stable and moves business logic out of route files.

### Requirements

- Linux: `Ubuntu 20.04+` or `Debian 11+` recommended
- Node.js: `18+` required, `20 LTS` recommended
- PM2 for source deployment
- Nginx recommended for public access
- PostgreSQL `14+` optional, only if you enable DB mode

### Quick Start

1. Install dependencies

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
```

2. Copy the project to the runtime directory

```bash
sudo mkdir -p /opt/nms
sudo cp -r . /opt/nms/
```

3. Install and build

```bash
cd /opt/nms/server && npm install --production
cd /opt/nms/client && npm install && npm run build
```

4. Create the runtime environment file

```bash
cd /opt/nms
cp .env.example .env
```

Change at least these values before production startup:

- `JWT_SECRET`
- `CREDENTIALS_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

Recommended:

- `SUB_PUBLIC_BASE_URL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

5. Start the service

```bash
cd /opt/nms
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 save
```

6. Open the panel

- `http://SERVER_IP:3001`

### Deployment Options

- Source + PM2: recommended when you want a conventional Linux deployment under `/opt/nms`
- Docker / GHCR: recommended when you want image-based delivery

Available image tags:

- `ghcr.io/<your-github-user-or-org>/nms:latest`
- `ghcr.io/<your-github-user-or-org>/nms:<commit_sha>`

### First Setup Checklist

- Log in with the admin account from `.env`
- Open `System Settings` and set the public subscription base URL
- Add your 3x-ui nodes in `Servers`
- Verify node connectivity before importing users or inbounds
- Configure SMTP only if you need verification or password-reset mail
- Review `Subscriptions` and, if needed, assign a legacy alias path to users for old-client migration

### Current UI Baseline

- Theme mode defaults to `auto` and follows the system theme
- UI locale defaults to `zh-CN` and can be switched to `en-US`
- Chinese font stack prefers locally installed `Source Han Sans SC` / `Noto Sans SC` / system CJK fonts
- Light mode hover, tooltip, search panel, audit card, tasks, logs, and modal surfaces were normalized for readability

### Documentation

- [Deployment Runbook](docs/DEPLOYMENT_RUNBOOK.md)
- [User Guide](docs/USER_GUIDE.md)
- [Architecture Overview](docs/ARCHITECTURE_OVERVIEW.md)
- [Admin UI Design Baseline](docs/UI_DESIGN_SYSTEM.md)
- [3x-ui Alignment Matrix](docs/3XUI_ALIGNMENT_MATRIX.md)
- [DB Integration Guide](docs/DB_INTEGRATION_DEV.md)
- [Review Harness](docs/REVIEW_HARNESS.md)
- [Subscription Output Notes](docs/SUBSCRIPTION_CONVERTER_NOTES.md)
- [Feature and UI Audit](docs/NMS_FEATURE_UI_AUDIT.md)
- [Gap Backlog](docs/NMS_GAP_BACKLOG.md)

---

## 中文

### 核心能力

- 多个 3x-ui 面板的集中管理
- 用户全流程支持：注册、验证、找回密码、管理员侧用户治理
- 内置订阅输出：`v2rayN`、`Raw`、`Native`、`Reconstructed`、`Clash YAML`、`Mihomo YAML`、`sing-box 导入`
- 支持“旧订阅路径迁移”能力，方便把老系统地址平滑迁移到新域名
- 审计覆盖操作日志、订阅访问、流量趋势和集中日志查看
- 系统设置提供 SMTP 诊断、备份导出、数据库运行模式和健康巡检
- 管理后台适配 PC 与手机端，默认跟随系统主题
- 默认中文界面，可切换英文；页头同一时刻只显示一种语言

### 架构说明

后端当前按以下层次组织：

- `route -> service -> repository / panel gateway`

这样可以保持 HTTP 接口稳定，同时把重业务逻辑从路由文件中抽离。

### 环境要求

- Linux：推荐 `Ubuntu 20.04+` 或 `Debian 11+`
- Node.js：最低 `18+`，推荐 `20 LTS`
- PM2：源码部署推荐
- Nginx：公网访问推荐
- PostgreSQL `14+`：可选，仅在启用数据库模式时需要

### 快速开始

1. 安装依赖

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
```

2. 拷贝项目到运行目录

```bash
sudo mkdir -p /opt/nms
sudo cp -r . /opt/nms/
```

3. 安装并构建

```bash
cd /opt/nms/server && npm install --production
cd /opt/nms/client && npm install && npm run build
```

4. 创建运行环境文件

```bash
cd /opt/nms
cp .env.example .env
```

生产环境启动前至少要改：

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

5. 启动服务

```bash
cd /opt/nms
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 save
```

6. 访问面板

- `http://服务器IP:3001`

### 部署方式

- 源码 + PM2：适合常规 Linux 部署，运行目录通常为 `/opt/nms`
- Docker / GHCR：适合镜像化交付

可用镜像标签：

- `ghcr.io/<你的 GitHub 用户或组织>/nms:latest`
- `ghcr.io/<你的 GitHub 用户或组织>/nms:<commit_sha>`

### 首次配置清单

- 使用 `.env` 中的管理员账号登录
- 进入“系统设置”填写订阅公网地址
- 在“服务器管理”中录入各 3x-ui 节点
- 在导入用户或入站前先做节点连通性检查
- 只有在需要邮箱验证或找回密码时再配置 SMTP
- 如需承接旧系统订阅地址，在“用户管理 / 订阅中心”为用户设置兼容路径

### 当前 UI 基线

- 主题模式默认 `auto`，自动跟随系统深浅主题
- 界面语言默认 `zh-CN`，可切换 `en-US`
- 中文字体优先使用本地安装的 `Source Han Sans SC`、`Noto Sans SC` 和系统中文字体
- 浅色主题下的 hover、tooltip、搜索面板、审计卡片、任务页、日志页和弹窗表面已做统一收口

### 文档索引

- [部署 Runbook](docs/DEPLOYMENT_RUNBOOK.md)
- [使用说明](docs/USER_GUIDE.md)
- [架构总览](docs/ARCHITECTURE_OVERVIEW.md)
- [管理端 UI 设计基线](docs/UI_DESIGN_SYSTEM.md)
- [3x-ui 对齐矩阵](docs/3XUI_ALIGNMENT_MATRIX.md)
- [数据库接入指南](docs/DB_INTEGRATION_DEV.md)
- [Review Harness](docs/REVIEW_HARNESS.md)
- [订阅输出说明](docs/SUBSCRIPTION_CONVERTER_NOTES.md)
- [功能与 UI 审计](docs/NMS_FEATURE_UI_AUDIT.md)
- [缺口与 Backlog](docs/NMS_GAP_BACKLOG.md)
