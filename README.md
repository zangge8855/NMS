# NMS - Node Management System

NMS is a centralized multi-node management panel for 3x-ui. It provides user management, subscription distribution, traffic analytics, and audit logging.

## Features

- Node management for multiple 3x-ui panels in one place
- User onboarding flow: registration, admin approval, subscription provisioning
- Subscription link generation for v2rayN, Clash, and sing-box
- Traffic analytics by client, inbound, and server
- Audit logging for operations and subscription access
- Security controls: JWT auth, credential encryption, password policy, rate limiting

## Requirements

- Linux (Ubuntu 20.04+ / Debian 11+ recommended)
- Node.js 18+ (Node.js 20 LTS recommended)
- PM2
- Nginx (recommended, optional)
- PostgreSQL 14+ (optional, only for database mode)

---

## Quick Install (File Storage Mode)

Default mode uses JSON files and does not require a database.

### 1) Install dependencies

    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    sudo npm install -g pm2

### 2) Deploy project

    sudo mkdir -p /opt/nms
    sudo cp -r . /opt/nms/
    cd /opt/nms

    cd /opt/nms/server
    npm install --production

    cd /opt/nms/client
    npm install
    npm run build

### 3) Configure environment

    cd /opt/nms
    cp .env.example .env

Edit .env and change these values:

- JWT_SECRET (at least 32 random characters)
- CREDENTIALS_SECRET (must differ from JWT_SECRET)
- ADMIN_USERNAME (do not use common names)
- ADMIN_PASSWORD (strong password)

Example generation:

    openssl rand -hex 32

### 4) Start services

    cd /opt/nms
    mkdir -p logs
    pm2 start ecosystem.config.cjs
    pm2 save
    pm2 startup systemd -u root --hp /root

### 5) Access panel

Open:

- http://SERVER_IP:3001

---

## PostgreSQL Mode

Use this mode for larger deployments.

### 1) Install PostgreSQL

    sudo apt-get install -y postgresql postgresql-contrib

### 2) Create DB and user

    sudo -u postgres psql
    CREATE USER nms WITH PASSWORD your-db-password;
    CREATE DATABASE nms OWNER nms;
    \c nms
    CREATE SCHEMA IF NOT EXISTS nms AUTHORIZATION nms;
    \q

### 3) Add DB config in .env

- DB_ENABLED=true
- DB_URL=postgres://nms:your-db-password@127.0.0.1:5432/nms
- DB_SCHEMA=nms
- DB_POOL_MAX=10
- DB_SSL_MODE=disable (local) / require (remote)
- DB_MIGRATION_AUTO=true
- STORE_READ_MODE=db
- STORE_WRITE_MODE=db

### 4) Migration recommendation

1. Start with STORE_WRITE_MODE=dual
2. Backfill data:

       cd /opt/nms/server && npm run db:backfill

3. Switch to STORE_READ_MODE=db and STORE_WRITE_MODE=db

---

## One Command Deployment

    chmod +x deploy.sh
    sudo ./deploy.sh

The script installs dependencies, deploys to /opt/nms, generates secrets, and starts services.

---

## Nginx Reverse Proxy (Recommended)

### Install Nginx

    sudo apt-get install -y nginx

### Configure site

    sudo cp /opt/nms/nginx.conf /etc/nginx/sites-available/nms
    sudo ln -sf /etc/nginx/sites-available/nms /etc/nginx/sites-enabled/
    sudo nano /etc/nginx/sites-available/nms
    sudo nginx -t && sudo systemctl reload nginx

### HTTPS with Lets Encrypt

    sudo apt install certbot python3-certbot-nginx
    sudo certbot --nginx -d your-domain.com

Set public URL in .env after HTTPS:

- SUB_PUBLIC_BASE_URL=https://your-domain.com

---

## Optional Email

Set SMTP values in .env:

- SMTP_HOST
- SMTP_PORT
- SMTP_USER
- SMTP_PASS

---

## Optional Subscription Converter

Set values in .env:

- SUB_CONVERTER_BASE_URL
- SUB_CONVERTER_CLASH_CONFIG_URL
- SUB_CONVERTER_SINGBOX_CONFIG_URL

Optional IP geolocation for audit logs:

- AUDIT_IP_GEO_ENABLED=true

---

## Common Commands

    pm2 status
    pm2 logs nms
    pm2 restart nms
    pm2 stop nms
    cd /opt/nms/client && npm run build
    cd /opt/nms/server && npm run db:backfill

## Data Directory (Default)

- data/users.json
- data/servers.json
- data/subscription_tokens.json
- data/user_policies.json
- data/audit_events.json
- data/subscription_access_logs.json
- data/traffic_counters.json
- data/traffic_samples.json
- data/jobs.json
- data/system_settings.json
- data/security_audit.log

---

## User Workflow

1. User registration with pending approval status
2. Admin approval
3. Subscription provisioning
4. Link distribution
5. Ongoing lifecycle management

---

## Full Environment Variables

See .env.example for complete configuration details.
