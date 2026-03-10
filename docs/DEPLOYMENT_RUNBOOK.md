# NMS 部署与升级 Runbook

> 更新时间：2026-03-10

## 中文

### 1. 适用范围

这份 Runbook 面向两类场景：

- 首次把 NMS 部署到服务器
- 已有 `/opt/nms` 实例的前后端升级

### 2. 默认目录约定

推荐约定：

- 仓库工作区：`/root/NMS`
- 运行目录：`/opt/nms`
- PM2 应用名：`nms`

### 3. 首次部署

1. 安装依赖

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
```

2. 拷贝代码

```bash
sudo mkdir -p /opt/nms
sudo cp -r /root/NMS/. /opt/nms/
```

3. 安装并构建

```bash
cd /opt/nms/server && npm install --production
cd /opt/nms/client && npm install && npm run build
```

4. 配置环境变量

```bash
cd /opt/nms
cp .env.example .env
```

至少要修改：

- `JWT_SECRET`
- `CREDENTIALS_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

5. 启动

```bash
cd /opt/nms
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 save
```

### 4. 升级现有实例

如果代码在 `/root/NMS`，运行实例在 `/opt/nms`，建议按下面顺序升级：

1. 本地构建和测试

```bash
cd /root/NMS/client && npm install && npm run build
cd /root/NMS/client && npm test
```

2. 同步前端产物

```bash
cp -R /root/NMS/client/dist/assets/. /opt/nms/client/dist/assets/
cp /root/NMS/client/dist/index.html /opt/nms/client/dist/index.html
```

3. 如后端代码有变化，再同步后端

```bash
rsync -av --delete /root/NMS/server/ /opt/nms/server/
rsync -av /root/NMS/ecosystem.config.cjs /opt/nms/
```

4. 重启服务

```bash
pm2 restart nms
```

### 5. 常用 PM2 操作

启动：

```bash
pm2 start ecosystem.config.cjs
```

重启：

```bash
pm2 restart nms
```

停止：

```bash
pm2 stop nms
```

查看状态：

```bash
pm2 list
pm2 logs nms
```

### 6. 验证清单

前端资源：

```bash
curl -sS http://127.0.0.1:3001/
```

需要确认：

- 返回新的 `index-*.js`
- 返回新的 `index-*.css`
- 字体链接包含 `IBM Plex Sans`、`JetBrains Mono`、`Noto Sans SC`

接口可用性：

```bash
curl -sS http://127.0.0.1:3001/api/auth/check
```

页面回归建议：

- `/login`
- `/`
- `/servers`
- `/inbounds`
- `/clients`
- `/audit`
- `/settings`

### 7. 文档与 Git 发布流程

建议顺序：

```bash
git status
git add .
git commit -m "your message"
git push origin main
```

发布前确认：

- `.env`、密钥、密码、数据文件没有进入 git
- 调试截图、临时脚本、导出包已经删除
- `.gitignore` 已覆盖 `output/`、日志、运行时数据

### 8. 隐私与清理

不建议入库的内容：

- `output/` 下的截图
- `/tmp` 下的临时验收脚本
- `.env`
- `data/**/*.json`
- 日志文件

清理示例：

```bash
rm -rf /root/NMS/output
rm -f /tmp/nms_ui_check.cjs /tmp/nms_ui_round3_check.cjs
```

### 9. 当前已知边界

- 如果运行实例实际读取的是 `/opt/nms`，仅在 `/root/NMS` 构建不会自动生效
- 某些环境中 headless browser 需要脱离沙箱运行
- 3x-ui 日志能力、Telegram 配置能力取决于远端节点版本和官方 API 暴露范围

---

# NMS Deployment and Upgrade Runbook

> Updated: 2026-03-10

## English

### 1. Scope

This runbook covers:

- first-time deployment
- upgrading an existing `/opt/nms` instance

### 2. Recommended Paths

- workspace repo: `/root/NMS`
- runtime instance: `/opt/nms`
- PM2 app name: `nms`

### 3. Upgrade Flow

Recommended order:

1. build and test in the workspace
2. sync frontend assets into `/opt/nms/client/dist`
3. sync backend files when needed
4. restart `pm2`

### 4. Core Commands

Build and test:

```bash
cd /root/NMS/client && npm install && npm run build
cd /root/NMS/client && npm test
```

Sync frontend:

```bash
cp -R /root/NMS/client/dist/assets/. /opt/nms/client/dist/assets/
cp /root/NMS/client/dist/index.html /opt/nms/client/dist/index.html
```

Restart:

```bash
pm2 restart nms
```

### 5. Publish Checklist

- no secrets or runtime data in git
- no debug screenshots or temporary scripts
- verify built asset hashes from `http://127.0.0.1:3001/`
- verify critical routes after restart
