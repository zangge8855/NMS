# NMS 开发环境数据库接入指南

> 更新时间：2026-03-09

## 中文

### 1. 目标

在不改变现有 API 的前提下，为后端 Store 增加 PostgreSQL 持久化能力，并继续支持三种运行模式：

- `STORE_READ_MODE=file|db`
- `STORE_WRITE_MODE=file|dual|db`

默认仍是文件模式，便于平滑迁移和低风险回滚。

### 2. 配置项

参考 `.env.example` 中 DB 段落：

- `DB_ENABLED`
- `DB_URL`
- `DB_SCHEMA`
- `DB_POOL_MAX`
- `DB_SSL_MODE`
- `DB_MIGRATION_AUTO`
- `STORE_READ_MODE`
- `STORE_WRITE_MODE`
- `DB_BACKFILL_REDACT`
- `DB_BACKFILL_DRY_RUN`
- `DB_PRIVACY_MODE`

### 3. 相关系统接口

- `GET /api/system/db/status`  
  查看 DB 状态、运行模式、快照和默认回填参数
- `POST /api/system/db/backfill`  
  默认以任务模式执行回填，支持同步兼容模式
- `POST /api/system/db/switch`  
  切换 `read/write` 运行模式
- `GET /api/system/tasks`
- `GET /api/system/tasks/:taskId`
- `DELETE /api/system/tasks/:taskId`
- `GET /api/system/monitor/status`  
  同时包含 DB 告警统计与通知未读数
- `GET /api/system/notifications`
- `POST /api/system/notifications/read`

### 4. 回填方式

接口回填默认推荐异步模式：

- 立即返回 `taskId`
- 后台逐个 store 执行
- 可查看进度
- 可取消未完成任务

仍保留同步模式作为兼容路径。

后端目录也可继续执行脚本方式：

```bash
npm run db:backfill -- --dry-run --redact
npm run db:backfill -- --no-dry-run --redact
npm run db:backfill -- --no-dry-run --keys=users,servers
```

### 5. 告警与通知

当前已增加 DB 写入失败告警能力：

- 滑动时间窗口失败计数
- 连续失败次数检测
- 通知中心推送

系统设置里的“监控状态”会汇总：

- `failuresInWindow`
- `consecutiveFailures`
- `lastSuccessAt`
- 通知中心未读数量

### 6. 隐私保护策略（开发环境）

- 审计快照与流量快照写入 DB 时默认支持脱敏，包含哈希化的 `email/ip/userAgent`
- 敏感字段（`password/token/secret/cookie`）不进入普通日志
- 建议仅连接开发库，不直连生产库
- 回填默认使用 `dry-run + redact`

### 7. 启动行为

`server/index.js` 启动时会：

1. 初始化 DB 连接并确保 schema / table
2. 加载运行模式（`read/write`）
3. 当 `read=db` 时尝试从 DB 快照回填内存 Store
4. 当 `write=dual|db` 时进行一次基线同步
5. 在运行期持续把 DB 写入失败统计接入告警与通知

---

# NMS Development Database Integration Guide

> Updated: 2026-03-09

## English

### 1. Goal

Add PostgreSQL persistence to backend stores without changing existing APIs, while keeping the current runtime modes:

- `STORE_READ_MODE=file|db`
- `STORE_WRITE_MODE=file|dual|db`

File mode remains the default for safer rollout and rollback.

### 2. Configuration

See the DB section in `.env.example`:

- `DB_ENABLED`
- `DB_URL`
- `DB_SCHEMA`
- `DB_POOL_MAX`
- `DB_SSL_MODE`
- `DB_MIGRATION_AUTO`
- `STORE_READ_MODE`
- `STORE_WRITE_MODE`
- `DB_BACKFILL_REDACT`
- `DB_BACKFILL_DRY_RUN`
- `DB_PRIVACY_MODE`

### 3. Related System APIs

- `GET /api/system/db/status`  
  Inspect DB readiness, runtime modes, snapshots, and default backfill flags
- `POST /api/system/db/backfill`  
  Task-based by default, with synchronous compatibility mode
- `POST /api/system/db/switch`  
  Switch `read/write` runtime modes
- `GET /api/system/tasks`
- `GET /api/system/tasks/:taskId`
- `DELETE /api/system/tasks/:taskId`
- `GET /api/system/monitor/status`  
  Includes DB alert statistics and unread notification count
- `GET /api/system/notifications`
- `POST /api/system/notifications/read`

### 4. Backfill Strategy

The API path now prefers async task-based backfill:

- returns a `taskId` immediately
- processes stores in the background
- exposes progress
- allows cancellation before completion

The synchronous mode is still kept for compatibility.

You can still run the script path from the backend directory:

```bash
npm run db:backfill -- --dry-run --redact
npm run db:backfill -- --no-dry-run --redact
npm run db:backfill -- --no-dry-run --keys=users,servers
```

### 5. Alerts and Notifications

DB write failure alerting is now built in:

- sliding window failure counting
- consecutive failure detection
- notification center integration

System Settings monitoring status summarizes:

- `failuresInWindow`
- `consecutiveFailures`
- `lastSuccessAt`
- unread notification count

### 6. Privacy Policy in Development

- Audit and traffic snapshots support redaction by default, including hashed `email/ip/userAgent`
- Sensitive fields such as `password/token/secret/cookie` must not enter normal logs
- Use a development database only; do not connect directly to production
- Backfill should default to `dry-run + redact`

### 7. Startup Behavior

On startup, `server/index.js` will:

1. initialize the DB connection and ensure schema / table creation
2. load the configured read/write mode
3. rehydrate in-memory stores from DB snapshots when `read=db`
4. run a baseline sync when `write=dual|db`
5. keep DB write failures connected to alerting and notifications during runtime
