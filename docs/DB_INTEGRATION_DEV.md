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
