# NMS 开发环境数据库接入指南

## 1. 目标

在不改变现有 API 的前提下，为后端 Store 增加 PostgreSQL 持久化能力，并支持三种模式：

- `STORE_READ_MODE=file|db`
- `STORE_WRITE_MODE=file|dual|db`

默认仍是文件模式，便于平滑迁移。

## 2. 配置项

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

## 3. 新增系统接口（权限）

- `GET /api/system/db/status`（仅 admin）
- `POST /api/system/db/backfill`（仅 admin）
- `POST /api/system/db/switch`（仅 admin）

## 4. 回填脚本

后端目录执行：

```bash
npm run db:backfill -- --dry-run --redact
npm run db:backfill -- --no-dry-run --redact
npm run db:backfill -- --no-dry-run --keys=users,servers
```

## 5. 隐私保护策略（开发环境）

- 审计快照与流量快照写入 DB 时默认支持脱敏（email/ip/userAgent hash 化）。
- 敏感字段（password/token/secret/cookie）不进入普通日志。
- 建议仅连接开发库，不直连生产库。

## 6. 启动行为

`server/index.js` 在启动时会：

1. 初始化 DB 连接并确保 schema/table；
2. 加载运行模式（`read/write`）；
3. 当 `read=db` 时尝试从 DB 快照回填内存 Store；
4. 当 `write=dual|db` 时进行一次基线同步。

---

# NMS Development Database Integration Guide

## 1. Goal

Add PostgreSQL persistence to backend stores without changing existing APIs, and support three modes:

- `STORE_READ_MODE=file|db`
- `STORE_WRITE_MODE=file|dual|db`

File storage remains the default for safer migration.

## 2. Configuration

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

## 3. Added System APIs

- `GET /api/system/db/status` (`admin` only)
- `POST /api/system/db/backfill` (`admin` only)
- `POST /api/system/db/switch` (`admin` only)

## 4. Backfill Commands

Run from the backend directory:

```bash
npm run db:backfill -- --dry-run --redact
npm run db:backfill -- --no-dry-run --redact
npm run db:backfill -- --no-dry-run --keys=users,servers
```

## 5. Privacy Policy in Development

- Audit and traffic snapshots support redaction by default when written to DB, including hashed `email/ip/userAgent`.
- Sensitive fields such as `password/token/secret/cookie` must not enter normal logs.
- Use a development database only. Do not connect directly to production.

## 6. Startup Behavior

On startup, `server/index.js` will:

1. Initialize the DB connection and ensure schema/table creation.
2. Load the configured read/write mode.
3. Rehydrate in-memory stores from DB snapshots when `read=db`.
4. Run a baseline sync when `write=dual|db`.
