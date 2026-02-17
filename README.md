# NMS — Node Management System

NMS 是一个 3x-ui 多节点集中管理面板，提供用户管理、订阅分发、流量统计、审计日志等功能。

## 功能概览

- **节点管理**：集中管理多台 3x-ui 面板，统一查看入站/客户端
- **用户管理**：用户注册 → 管理员审核 → 一键开通订阅 → 自动部署客户端
- **订阅系统**：自动生成订阅链接，支持 v2rayN / Clash / sing-box 格式
- **流量统计**：按客户端/入站/服务器维度采集和展示流量数据
- **审计日志**：操作审计 + 订阅访问日志 + IP 归属地解析
- **安全特性**：JWT 认证、凭据加密、密码强度校验、速率限制

## 系统要求

- **操作系统**：Linux (Ubuntu 20.04+ / Debian 11+ 推荐)
- **Node.js**：v18.0+ (推荐 v20 LTS)
- **PM2**：进程管理器
- **Nginx**：反向代理 (推荐，非必须)
- **PostgreSQL**：v14+ (可选，仅数据库模式需要)

---

## 快速安装 (文件存储模式)

默认使用 JSON 文件存储数据，无需数据库，适合中小规模部署。

### 1. 安装依赖

```bash
# 安装 Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 安装 PM2
sudo npm install -g pm2
```

### 2. 部署项目

```bash
# 克隆或上传项目到服务器
sudo mkdir -p /opt/nms
sudo cp -r . /opt/nms/
cd /opt/nms

# 安装后端依赖
cd /opt/nms/server
npm install --production

# 构建前端
cd /opt/nms/client
npm install
npm run build
```

### 3. 配置环境变量

```bash
cd /opt/nms
cp .env.example .env
```

编辑 `.env`，**必须修改**以下项：

```ini
# JWT 密钥 (至少 32 位随机字符串)
JWT_SECRET=<生成: openssl rand -hex 32>

# 节点凭据加密密钥 (不要与 JWT_SECRET 相同)
CREDENTIALS_SECRET=<生成: openssl rand -hex 32>

# 管理员用户名 (不要使用 admin/root 等常见名称)
ADMIN_USERNAME=your-admin-name

# 管理员密码 (至少 8 位，包含大写/小写/数字/特殊字符中的 3 类)
ADMIN_PASSWORD=YourStr0ng!Pass
```

可选配置项参见 `.env.example` 中的完整说明。

### 4. 启动服务

```bash
cd /opt/nms
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 save

# 设置开机自启
pm2 startup systemd -u root --hp /root
```

### 5. 访问面板

浏览器打开 `http://<服务器IP>:3001`，使用 `.env` 中配置的管理员账号登录。

---

## 数据库模式安装 (PostgreSQL)

适合大规模部署或需要更可靠数据存储的场景。

### 1. 安装 PostgreSQL

```bash
sudo apt-get install -y postgresql postgresql-contrib
```

### 2. 创建数据库

```bash
sudo -u postgres psql

-- 创建用户和数据库
CREATE USER nms WITH PASSWORD 'your-db-password';
CREATE DATABASE nms OWNER nms;

-- 创建 schema (可选，默认使用 nms)
\c nms
CREATE SCHEMA IF NOT EXISTS nms AUTHORIZATION nms;

\q
```

### 3. 配置环境变量

在前述基础配置之上，编辑 `.env` 追加数据库配置：

```ini
# 开启数据库
DB_ENABLED=true

# PostgreSQL 连接串
DB_URL=postgres://nms:your-db-password@127.0.0.1:5432/nms

# Schema 名称
DB_SCHEMA=nms

# 连接池最大连接数
DB_POOL_MAX=10

# SSL 模式 (本地连接用 disable，远程连接用 require)
DB_SSL_MODE=disable

# 启动时自动建表
DB_MIGRATION_AUTO=true

# 存储读取模式: file | db
STORE_READ_MODE=db

# 存储写入模式: file | dual | db
STORE_WRITE_MODE=db
```

### 4. 存储模式说明

| 读取模式 | 写入模式 | 说明 |
|---------|---------|------|
| `file` | `file` | 默认，纯 JSON 文件存储 |
| `file` | `dual` | 迁移过渡期：读文件，同时写文件+数据库 |
| `db` | `db` | 纯数据库存储 |
| `db` | `dual` | 数据库为主，同时备份到文件 |

**推荐迁移路径**：

1. 先设置 `STORE_WRITE_MODE=dual`，运行一段时间确认数据库写入正常
2. 运行数据回填脚本：`cd /opt/nms/server && npm run db:backfill`
3. 确认无误后切换到 `STORE_READ_MODE=db`，`STORE_WRITE_MODE=db`

### 5. 其余步骤

安装依赖、构建前端、启动服务与文件模式相同，参见上文步骤 1-5。

---

## 一键部署脚本

项目提供了自动化部署脚本：

```bash
chmod +x deploy.sh
sudo ./deploy.sh
```

脚本会自动检测并安装 Node.js / PM2，部署项目到 `/opt/nms`，生成安全密钥并启动服务。部署完成后请编辑 `/opt/nms/.env` 设置管理员用户名和密码。

---

## Nginx 反向代理 (推荐)

使用 Nginx 可以启用 HTTPS、提供静态文件缓存和安全头。

### 安装 Nginx

```bash
sudo apt-get install -y nginx
```

### 配置站点

```bash
sudo cp /opt/nms/nginx.conf /etc/nginx/sites-available/nms
sudo ln -sf /etc/nginx/sites-available/nms /etc/nginx/sites-enabled/

# 编辑配置，将 your-domain.com 替换为你的域名
sudo nano /etc/nginx/sites-available/nms

sudo nginx -t && sudo systemctl reload nginx
```

### 配置 HTTPS (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

配置 HTTPS 后，建议在 `.env` 中设置订阅公网地址：

```ini
SUB_PUBLIC_BASE_URL=https://your-domain.com
```

---

## 邮箱功能配置 (可选)

配置 SMTP 后可启用邮箱验证和密码找回功能。

```ini
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

---

## 订阅系统配置 (可选)

### 订阅转换器

配置后可生成 Clash / sing-box 格式的订阅链接：

```ini
SUB_CONVERTER_BASE_URL=http://127.0.0.1:25500/sub
SUB_CONVERTER_CLASH_CONFIG_URL=https://example.com/clash.ini
SUB_CONVERTER_SINGBOX_CONFIG_URL=https://example.com/singbox.json
```

### IP 归属地解析

开启后订阅访问日志会显示 IP 归属地：

```ini
AUDIT_IP_GEO_ENABLED=true
```

---

## 常用命令

```bash
# 查看服务状态
pm2 status

# 查看日志
pm2 logs nms

# 重启服务
pm2 restart nms

# 停止服务
pm2 stop nms

# 重新构建前端
cd /opt/nms/client && npm run build

# 数据回填到数据库
cd /opt/nms/server && npm run db:backfill
```

## 数据目录

默认数据存储在 `data/` 目录下：

```
data/
├── users.json              # 用户数据
├── servers.json            # 节点服务器列表
├── subscription_tokens.json # 订阅令牌
├── user_policies.json      # 用户策略
├── audit_events.json       # 审计事件
├── subscription_access_logs.json # 订阅访问日志
├── traffic_counters.json   # 流量计数
├── traffic_samples.json    # 流量采样
├── jobs.json               # 批量任务记录
├── system_settings.json    # 系统设置
└── security_audit.log      # 安全审计日志
```

---

## 用户管理流程

1. **用户注册**：用户通过登录页注册账号（默认待审核状态，无法登录）
2. **管理员审核**：管理员在「用户管理」页面查看待审核用户，点击「通过」启用账号
3. **开通订阅**：选择入站节点、设定有效期，一键开通订阅
4. **分发链接**：系统自动生成订阅链接，支持多种客户端格式
5. **日常管理**：编辑用户信息、修改有效期/策略、停用/启用/删除

---

## 环境变量完整参考

详见 [.env.example](.env.example) 文件，包含所有可配置项及说明。
