# NMS 架构总览

> 更新时间：2026-03-09

## 中文

### 1. 目标

这一版 NMS 的目标不是重写整个系统，而是在不改变对外 API、页面入口和部署方式的前提下，把后端内部结构收口成更稳定的形态，便于继续迭代 3x-ui 管理、订阅、审计和系统运维功能。

### 2. 当前分层

后端主干已经整理为：

- `routes/`
  负责请求解析、权限校验、参数初步校验、HTTP 状态映射
- `services/`
  负责业务编排和跨模块逻辑
- `repositories/`
  负责统一访问 store / DB 镜像层
- `panel gateway / panel client`
  负责访问 3x-ui 节点 API
- `store/`
  负责当前文件存储与运行时内存态

### 3. 关键服务

- `emailAuthService`
  负责注册、邮箱验证、重发验证码、找回密码、验证码重置密码
- `authSessionService`
  负责登录、会话相关认证流程
- `userAdminService`
  负责管理员视角下的用户账号操作
- `subscriptionSyncService`
  负责开通订阅、策略同步、客户端 entitlement 下发
- `subscriptionAuditService`
  负责订阅访问审计聚合与 IP 归属地整合
- `panelLogsService`
  负责统一 3x-ui `panel/xray/system` 日志查询兼容层
- `clientEntitlementService`
  负责单实例单独限定与恢复跟随统一策略

### 4. 数据与持久化

- 默认仍支持文件模式
- PostgreSQL 仍以兼容模式存在，用于快照、镜像和运行模式切换
- 业务层不再直接依赖具体 store，而是通过 repository 访问
- 当前仍保持：
  `STORE_READ_MODE=file|db`
  `STORE_WRITE_MODE=file|dual|db`

### 5. 当前新增的系统运维能力

- SMTP 诊断
  `GET /api/system/email/status`
- 系统备份导出
  `GET /api/system/backup/status`
  `GET /api/system/backup/export`
- 节点健康巡检
  `GET /api/system/monitor/status`
  `POST /api/system/monitor/run`
- DB 回填任务化
  `POST /api/system/db/backfill`
  `GET /api/system/tasks`
  `GET /api/system/tasks/:taskId`
  `DELETE /api/system/tasks/:taskId`
- 通知中心
  `GET /api/system/notifications`
  `POST /api/system/notifications/read`

### 6. 用户限额与策略模型

统一策略层：

- `limitIp`
- `trafficLimitBytes`
- `expiryTime`

单实例覆盖层：

- `PUT /api/clients/entitlement`
- `GET /api/clients/entitlement-overrides`

设计原则：

- 大多数用户跟随统一策略
- 个别入站里的客户端可以单独限定
- 单独限定优先于统一策略
- 可以一键恢复跟随统一策略

### 7. 审计与真实 IP

订阅访问审计当前会记录：

- `clientIp`
- `proxyIp`
- `ipSource`
- `cfCountry`

在 Cloudflare 或其他反代场景下，NMS 会优先使用可信代理头解析真实访客 IP，而不是直接把边缘代理地址当成用户 IP。

### 8. 与 3x-ui 的边界

NMS 通过官方 API 能稳定做的事情：

- 登录节点
- 读取状态、版本、配置、DB 导出
- 管理入站和客户端
- 触发 Telegram 备份
- 读取已支持的日志接口

当前明确保守处理的边界：

- Telegram Bot 配置仍在 3x-ui 面板里管理
- 某些节点可能不支持 `panel logs` 或 `xray logs`
- NMS 不直接通过未文档化接口改 3x-ui 私有设置

### 9. 当前阶段不做的事

- 不把 PostgreSQL 立刻升级为唯一主存储
- 不引入 Go 或其他后端语言
- 不因为架构调整而修改既有 API 路径和响应结构
- 不通过 SSH 默认修改高风险节点配置

---

# NMS Architecture Overview

> Updated: 2026-03-09

## English

### 1. Goal

This phase does not rewrite the system. The goal is to keep public APIs, pages, and deployment unchanged while making the backend easier to extend safely.

### 2. Current Layers

The backend is now organized as:

- `routes/`
  request parsing, authorization, light validation, HTTP mapping
- `services/`
  business orchestration and cross-module logic
- `repositories/`
  unified access to stores and DB mirror behavior
- `panel gateway / panel client`
  3x-ui node communication
- `store/`
  current file-backed and in-memory runtime state

### 3. Key Services

- `emailAuthService`
- `authSessionService`
- `userAdminService`
- `subscriptionSyncService`
- `subscriptionAuditService`
- `panelLogsService`
- `clientEntitlementService`

These services hold the main business logic that previously lived in route files.

### 4. Data and Persistence

- File mode remains the default
- PostgreSQL is still supported as a compatibility layer for snapshots and runtime mode switching
- Business code now uses repositories instead of directly spreading store access across routes
- Runtime modes remain:
  `STORE_READ_MODE=file|db`
  `STORE_WRITE_MODE=file|dual|db`

### 5. Operational Features Added in the Current Architecture

- SMTP diagnostics
  `GET /api/system/email/status`
- System backup export
  `GET /api/system/backup/status`
  `GET /api/system/backup/export`
- Node health monitor
  `GET /api/system/monitor/status`
  `POST /api/system/monitor/run`
- Task-based DB backfill
  `POST /api/system/db/backfill`
  `GET /api/system/tasks`
  `GET /api/system/tasks/:taskId`
  `DELETE /api/system/tasks/:taskId`
- Notification center
  `GET /api/system/notifications`
  `POST /api/system/notifications/read`

### 6. Entitlement Model

Policy-level defaults:

- `limitIp`
- `trafficLimitBytes`
- `expiryTime`

Per-client overrides:

- `PUT /api/clients/entitlement`
- `GET /api/clients/entitlement-overrides`

Design rules:

- most users follow a shared policy
- exceptional inbound clients can override it
- override values win over policy defaults
- a client can be switched back to follow policy

### 7. Audit and Real Client IP

Subscription access audit now stores:

- `clientIp`
- `proxyIp`
- `ipSource`
- `cfCountry`

Under Cloudflare or other reverse proxies, NMS prefers trusted forwarding headers instead of treating the proxy edge IP as the visitor IP.

### 8. Boundary with 3x-ui

Stable operations via official 3x-ui APIs include:

- node login
- status, version, config, DB export
- inbound and client management
- Telegram backup trigger
- supported log endpoints

Deliberately conservative boundaries:

- Telegram Bot configuration still belongs to the 3x-ui panel
- some nodes do not expose `panel logs` or `xray logs`
- NMS does not write undocumented private 3x-ui settings through guessed APIs

### 9. What This Phase Does Not Do

- it does not make PostgreSQL the only primary store
- it does not introduce Go or another backend language
- it does not change existing API paths or response shapes
- it does not enable risky SSH-based node mutation by default
