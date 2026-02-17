#!/bin/bash
set -e

# ============================
# Node Management System (NMS) 部署脚本
# ============================

APP_DIR="/opt/nms"
CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  Node Management System (NMS) 部署脚本${NC}"
echo -e "${CYAN}========================================${NC}"

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo -e "${CYAN}[1/6] 安装 Node.js...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo -e "${GREEN}[1/6] Node.js 已安装: $(node -v)${NC}"
fi

# 检查 PM2
if ! command -v pm2 &> /dev/null; then
    echo -e "${CYAN}[2/6] 安装 PM2...${NC}"
    sudo npm install -g pm2
else
    echo -e "${GREEN}[2/6] PM2 已安装${NC}"
fi

# 复制项目文件
echo -e "${CYAN}[3/6] 部署项目文件...${NC}"
sudo mkdir -p $APP_DIR
sudo cp -r . $APP_DIR/
cd $APP_DIR

# 创建 .env 文件 (如果不存在)
if [ ! -f .env ]; then
    echo -e "${CYAN}    创建 .env 配置文件...${NC}"
    cp .env.example .env
    # 生成随机 JWT 密钥
    JWT_SECRET=$(openssl rand -hex 32)
    CREDENTIALS_SECRET=$(openssl rand -hex 32)
    ADMIN_USERNAME="admin_$(openssl rand -hex 3)"
    sed -i "s/change-this-to-a-random-secret-key-in-production/$JWT_SECRET/g" .env
    sed -i "s/# CREDENTIALS_SECRET=change-this-to-a-dedicated-random-secret-key/CREDENTIALS_SECRET=$CREDENTIALS_SECRET/g" .env
    if ! grep -q "^ADMIN_USERNAME=" .env; then
        echo "ADMIN_USERNAME=$ADMIN_USERNAME" >> .env
    fi
    echo -e "${RED}    请编辑 $APP_DIR/.env 设置管理用户名和密码!${NC}"
fi

# 安装后端依赖
echo -e "${CYAN}[4/6] 安装后端依赖...${NC}"
cd $APP_DIR/server
npm install --production

# 构建前端
echo -e "${CYAN}[5/6] 构建前端...${NC}"
cd $APP_DIR/client
npm install
npm run build

# 创建日志目录
mkdir -p $APP_DIR/logs

# 启动/重启 PM2
echo -e "${CYAN}[6/6] 启动服务...${NC}"
cd $APP_DIR
pm2 delete nms 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

# 设置开机自启
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  部署完成!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "  应用地址: http://$(hostname -I | awk '{print $1}'):3001"
echo -e "  配置文件: $APP_DIR/.env"
echo -e ""
echo -e "  ${CYAN}如需使用 Nginx 反向代理:${NC}"
echo -e "  sudo cp $APP_DIR/nginx.conf /etc/nginx/sites-available/nms"
echo -e "  sudo ln -sf /etc/nginx/sites-available/nms /etc/nginx/sites-enabled/"
echo -e "  sudo nginx -t && sudo systemctl reload nginx"
echo -e ""
echo -e "  ${CYAN}常用命令:${NC}"
echo -e "  pm2 logs nms    # 查看日志"
echo -e "  pm2 restart nms # 重启服务"
echo -e "  pm2 status              # 查看状态"
echo ""
