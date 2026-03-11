# Database Integration For Development

## 中文

### 目标

本说明用于本地开发和迁移演练。NMS 默认使用文件存储，不要求数据库；当你需要验证 PostgreSQL schema、双写迁移或生产前演练时，再开启数据库相关配置。

### 前置条件

- 已安装 PostgreSQL 14+
- 已准备好独立的开发数据库
- 已在 `server/` 安装依赖

### 最小配置

将下面的变量写入 `.env`：

```env
DB_ENABLED=true
DB_URL=postgres://postgres:postgres@127.0.0.1:5432/nms_dev
DB_SCHEMA=nms_dev
DB_MIGRATION_AUTO=true
STORE_READ_MODE=file
STORE_WRITE_MODE=dual
DB_BACKFILL_REDACT=true
DB_BACKFILL_DRY_RUN=true
```

建议先用 `dual` 模式做迁移演练：

- 读：仍然从文件读取
- 写：同时写入文件和 PostgreSQL
- 好处：即使 DB schema 有问题，也不会破坏现有文件数据

### 推荐工作流

1. 保持一份可回滚的 `data/` 目录备份
2. 启动服务，让自动建表完成 schema 初始化
3. 在 `dual` 模式下完成基础功能联调
4. 运行回填命令检查历史数据同步情况
5. 确认数据一致后，再切换到 `STORE_READ_MODE=db`

### 回填命令

```bash
cd server
npm run db:backfill
```

常用组合：

- 演练模式：`DB_BACKFILL_DRY_RUN=true`
- 实际执行：`DB_BACKFILL_DRY_RUN=false`
- 脱敏迁移：`DB_BACKFILL_REDACT=true`

### 模式说明

| 变量 | 推荐值 | 说明 |
| --- | --- | --- |
| `DB_ENABLED` | `true` | 启用数据库能力 |
| `STORE_READ_MODE` | `file` -> `db` | 先文件读，确认稳定后切到 DB |
| `STORE_WRITE_MODE` | `dual` | 迁移阶段推荐 |
| `DB_PRIVACY_MODE` | `strict` | 开发环境建议严格脱敏 |

### 验证项

- 管理员登录正常
- 节点列表、用户列表、订阅列表数据一致
- 审计与流量页面可正常翻页
- 新增、编辑、删除操作在 DB 中有对应结果
- 服务重启后数据仍可正确恢复

### 常见问题

#### 自动建表失败

- 检查 `DB_URL` 是否可达
- 检查数据库用户是否有 schema 创建权限
- 检查 `DB_SCHEMA` 是否与现有对象冲突

#### 双写成功但读不到数据

- 确认当前仍在 `STORE_READ_MODE=file`
- 切换到 `db` 之前先执行回填或完成一次全量同步

#### 开发环境不想暴露敏感数据

- 保持 `DB_BACKFILL_REDACT=true`
- 保持 `DB_PRIVACY_MODE=strict`
- 不要把生产库快照直接导入本地开发库

## English

### Goal

This guide is for local development and migration rehearsal. NMS works without a database by default. Enable PostgreSQL only when you need to test schema bootstrap, dual-write migration, or production-like storage behavior.

### Prerequisites

- PostgreSQL 14+
- A dedicated development database
- Installed dependencies under `server/`

### Minimum configuration

Add the following variables to `.env`:

```env
DB_ENABLED=true
DB_URL=postgres://postgres:postgres@127.0.0.1:5432/nms_dev
DB_SCHEMA=nms_dev
DB_MIGRATION_AUTO=true
STORE_READ_MODE=file
STORE_WRITE_MODE=dual
DB_BACKFILL_REDACT=true
DB_BACKFILL_DRY_RUN=true
```

Start with `dual` mode:

- Reads still come from files
- Writes go to both files and PostgreSQL
- This gives you a safe migration path without depending on the new schema immediately

### Recommended workflow

1. Keep a restorable backup of `data/`
2. Start the server and let automatic schema bootstrap finish
3. Exercise the application in `dual` mode
4. Run the backfill command to inspect historical sync results
5. Switch `STORE_READ_MODE` to `db` only after data consistency is confirmed

### Backfill command

```bash
cd server
npm run db:backfill
```

Useful combinations:

- rehearsal: `DB_BACKFILL_DRY_RUN=true`
- actual execution: `DB_BACKFILL_DRY_RUN=false`
- privacy-preserving migration: `DB_BACKFILL_REDACT=true`

### Mode summary

| Variable | Suggested value | Meaning |
| --- | --- | --- |
| `DB_ENABLED` | `true` | turn on database support |
| `STORE_READ_MODE` | `file` -> `db` | move reads after validation |
| `STORE_WRITE_MODE` | `dual` | recommended during migration |
| `DB_PRIVACY_MODE` | `strict` | good default for development |

### Validation checklist

- Admin login works
- Servers, users, and subscriptions render the expected records
- Audit and traffic pages paginate correctly
- Create, update, and delete operations appear in PostgreSQL
- Restarting the service preserves data integrity

### Common issues

#### Schema bootstrap fails

- Check that `DB_URL` is reachable
- Verify schema creation privileges for the database user
- Ensure `DB_SCHEMA` does not collide with an existing layout

#### Dual-write works but reads do not change

- Confirm that `STORE_READ_MODE` is still `file`
- Perform backfill or a full sync before switching reads to `db`

#### Avoiding sensitive data in development

- Keep `DB_BACKFILL_REDACT=true`
- Keep `DB_PRIVACY_MODE=strict`
- Do not import production snapshots directly into a local development database
