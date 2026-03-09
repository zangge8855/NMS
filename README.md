# NMS - Node Management System

NMS is a centralized multi-node management panel for 3x-ui. It supports user management, subscription distribution, traffic analytics, and audit logging.

## English

### Features

- Centralized management for multiple 3x-ui panels
- User lifecycle: registration, admin approval, subscription provisioning
- Built-in subscription outputs: v2rayN, Raw, Native, Reconstructed, Clash YAML, Mihomo YAML, sing-box import
- Traffic analytics by client, inbound, and server
- Audit capabilities: operation logs, 3x-ui panel logs, traffic trends, subscription access logs, optional IP geolocation
- Security features: JWT auth, credential encryption, password policy, rate limiting

### Subscription Notes

- NMS no longer depends on an external subscription converter.
- Clash and Mihomo use NMS-generated YAML subscription URLs directly.
- Managers can still view and copy the full subscription URL for users.
- Exported node display names are privacy-safe: site name, domain, and email are not exposed in node labels.

### Audit Notes

- Audit Center is designed for centralized 3x-ui management.
- The log panel in Audit Center uses aggregated 3x-ui panel logs instead of host syslog.
- Traffic stats fall back to inbound totals when user-level traffic is unavailable from a node.

### Requirements

- Linux (Ubuntu 20.04+ / Debian 11+ recommended)
- Node.js 18+ (Node.js 20 LTS recommended)
- PM2
- Nginx (recommended, optional)
- PostgreSQL 14+ (optional, DB mode only)

### Quick Start (File Storage Mode)

1. Install dependencies

    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    sudo npm install -g pm2

2. Deploy and build

    sudo mkdir -p /opt/nms
    sudo cp -r . /opt/nms/
    cd /opt/nms/server && npm install --production
    cd /opt/nms/client && npm install && npm run build

3. Configure environment

    cd /opt/nms
    cp .env.example .env

Must change these values in .env: JWT_SECRET, CREDENTIALS_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD.

4. Start service

    cd /opt/nms
    mkdir -p logs
    pm2 start ecosystem.config.cjs
    pm2 save
    pm2 startup systemd -u root --hp /root

5. Access panel

- http://SERVER_IP:3001

### Docker and GHCR

This repository includes:

- Dockerfile
- .dockerignore
- .github/workflows/docker.yml

On push to main, GitHub Actions builds and publishes images to GHCR:

- ghcr.io/zangge8855/nms:latest
- ghcr.io/zangge8855/nms:<commit_sha>

More configuration details: .env.example

---

## 中文

### 功能

- 多个 3x-ui 面板的集中管理
- 用户全流程：注册、审核、开通订阅
- 内置订阅输出：v2rayN、Raw、Native、Reconstructed、Clash YAML、Mihomo YAML、sing-box 导入链接
- 流量统计：客户端、入站、服务器维度
- 审计能力：操作日志、3x-ui 日志、流量趋势、订阅访问日志、可选 IP 归属地
- 安全能力：JWT、凭据加密、密码策略、限流

### 订阅说明

- NMS 现在不再依赖外部订阅转换器。
- Clash / Mihomo 直接使用 NMS 生成的 YAML 订阅地址。
- 管理者仍然可以查看和复制完整订阅链接发给用户。
- 客户端导入后的节点显示名已做脱敏，不会把站点名、域名、邮箱暴露到节点标签里。

### 审计说明

- 审计中心面向集中管理 3x-ui 场景设计。
- 审计中心日志页聚合的是各节点 3x-ui panel 日志，不再依赖宿主机 syslog。
- 当某些节点拿不到用户级流量明细时，流量统计会自动回退到入站总流量采样。

### 环境要求

- Linux（推荐 Ubuntu 20.04+ / Debian 11+）
- Node.js 18+（推荐 Node.js 20 LTS）
- PM2
- Nginx（推荐，可选）
- PostgreSQL 14+（可选，仅数据库模式）

### 快速开始（文件存储模式）

1. 安装依赖

    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    sudo npm install -g pm2

2. 部署并构建

    sudo mkdir -p /opt/nms
    sudo cp -r . /opt/nms/
    cd /opt/nms/server && npm install --production
    cd /opt/nms/client && npm install && npm run build

3. 配置环境变量

    cd /opt/nms
    cp .env.example .env

必须修改 .env 中以下项：JWT_SECRET、CREDENTIALS_SECRET、ADMIN_USERNAME、ADMIN_PASSWORD。

4. 启动服务

    cd /opt/nms
    mkdir -p logs
    pm2 start ecosystem.config.cjs
    pm2 save
    pm2 startup systemd -u root --hp /root

5. 访问面板

- http://SERVER_IP:3001

### Docker 与 GHCR

仓库已包含：

- Dockerfile
- .dockerignore
- .github/workflows/docker.yml

推送到 main 后会自动构建并发布镜像到 GHCR：

- ghcr.io/zangge8855/nms:latest
- ghcr.io/zangge8855/nms:<commit_sha>

更多配置请参考：.env.example
