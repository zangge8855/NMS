# NMS - Node Management System

NMS is a centralized multi-node management panel for 3x-ui. It supports user management, subscription distribution, traffic analytics, and audit logging.

## English

### Features

- Centralized management for multiple 3x-ui panels
- User lifecycle: registration, admin approval, subscription provisioning
- Subscription formats: v2rayN / Clash / sing-box
- Traffic analytics by client, inbound, and server
- Audit capabilities: operation logs, subscription access logs, optional IP geolocation
- Security features: JWT auth, credential encryption, password policy, rate limiting

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
- 订阅格式：v2rayN / Clash / sing-box
- 流量统计：客户端、入站、服务器维度
- 审计能力：操作日志、订阅访问日志、可选 IP 归属地
- 安全能力：JWT、凭据加密、密码策略、限汁

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
