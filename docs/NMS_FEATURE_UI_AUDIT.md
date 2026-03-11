# NMS 功能与 UI 审计报告

> 统计基线：`/root/NMS` 当前代码仓库（不含外部部署差异）  
> 统计时间：2026-03-11

## 中文

## 1. 系统定位与结论

NMS 当前已经是一个面向多节点 3x-ui 的统一管理面板，而不是单纯的节点代理工具。它的产品主线已经比较清晰：

- 多节点服务器接入与治理
- 跨节点入站与客户端管理
- 用户注册、订阅开通与限额控制
- 集中审计、流量趋势、订阅访问记录
- 系统级运维能力，如 DB 运维、备份导出、健康巡检、SMTP 诊断

总体结论：

- 产品能力覆盖度高
- 对 3x-ui 场景的针对性强
- 当前架构已经从“路由堆业务”收口为更可维护的分层实现

## 2. 后端形态与 API 规模

### 2.1 技术形态

- 前端：React + Vite（`client/`）
- 后端：Express + WebSocket（`server/`）
- 节点集成：通过 NMS 的 panel gateway / panel client 访问各 3x-ui 节点
- 内部分层：`route -> service -> repository / panel gateway`

### 2.2 路由规模

- 路由文件：14 个（`server/routes/*.js`）
- 路由定义总数：90 条
- 对外前缀挂载：15 组
- `batch.js` 同时挂载在 `/api/batch` 与 `/api/jobs`

### 2.3 按域统计

| API 域 | 路由定义数 | 主要能力 |
|---|---:|---|
| `/api/auth` | 19 | 登录、注册、邮箱验证、找回密码、用户账号管理、开通订阅 |
| `/api/servers` | 9 | 服务器 CRUD、批量导入、连接测试、健康治理、统一日志 |
| `/api/panel` | 1 (`all`) | 到 3x-ui 面板 API 的统一代理转发 |
| `/api/batch` | 11 | 批量用户/入站操作、历史记录、重试、取消 |
| `/api/jobs` | 11（复用） | 与 `/api/batch` 同能力，任务化访问别名 |
| `/api/cluster` | 4 | 集群预检、模板下发、用户同步、订阅启用 |
| `/api/subscriptions` | 11 | token、公共订阅、订阅访问日志、用户订阅查询 |
| `/api/audit` | 5 | 审计事件、详情、聚合统计 |
| `/api/traffic` | 4 | 流量采样、总览、趋势 |
| `/api/capabilities` | 1 | 节点能力探测 |
| `/api/protocol-schemas` | 1 | 协议 schema 与默认模板 |
| `/api/system` | 19 | 系统设置、DB 运维、备份导出、监控、通知、SMTP 状态 |
| `/api/user-policy` | 2 | 用户策略（节点/协议/IP/流量限制） |
| `/api/users` | 4 | 聚合用户列表与账号侧查询 |
| `/api/clients` | 2 | 单实例 entitlement override 查询与更新 |
| `/api/ws` | 1 | WebSocket ticket 签发 |

## 3. 核心业务覆盖

| 业务目标 | 覆盖情况 | 说明 |
|---|---|---|
| 多服务器管理 3x-ui | 已完整覆盖 | 服务器添加、编辑、删除、批量导入、连通性测试、分组治理 |
| 跨节点添加/编辑入站 | 已完整覆盖 | 支持批量操作、排序、协议感知编辑 |
| 跨节点添加/同步用户 | 已完整覆盖 | 支持开通订阅、限额同步、单实例单独限定 |
| 邮箱注册与找回密码 | 已覆盖 | 增加 SMTP 诊断，发信失败不再假成功 |
| 订阅输出 | 已完整覆盖 | 内置生成多种订阅格式，不依赖外部转换器 |
| 审计与流量 | 已完整覆盖 | 操作审计、流量趋势、订阅访问日志、3x-ui 日志兼容层 |
| 系统运维 | 已明显增强 | DB 模式切换、回填任务、备份导出、节点健康巡检、通知中心 |

## 4. 前端页面与信息架构

### 4.1 主路由

主要页面包括：

- `/`
- `/inbounds`
- `/clients`
- `/subscriptions`
- `/logs`
- `/server`
- `/tools`
- `/capabilities`
- `/tasks`
- `/audit`
- `/servers`
- `/accounts`
- `/settings`

### 4.2 角色模型

- `admin`
  可访问全部模块
- `user`
  仅可访问订阅中心，且默认只可查看自身订阅身份

## 5. 主要页面能力盘点

### 5.1 仪表盘（`Dashboard`）

- 集群与单节点状态展示
- CPU / 内存 / 在线用户 / 入站数 / 总流量
- WebSocket 实时状态刷新

### 5.2 服务器管理（`Servers`）

- 服务器新增、编辑、删除
- 批量导入
- 单节点/批量连接测试
- 分组、标签、环境、健康状态治理

### 5.3 入站管理（`Inbounds`）

- 跨节点入站聚合列表
- 手工排序并持久化，排序会影响订阅输出顺序
- 批量启停、删除、重置流量、批量加用户
- 入站下用户可查看流量并删除
- 支持“单独限定”：
  到期时间、IP 限制、流量总量、恢复跟随统一策略

### 5.4 用户管理与账号管理（`Clients` / `UsersHub` / `Accounts`）

- 用户按 email / 标识跨节点聚合
- 批量启停删
- 订阅策略弹窗
- 管理端可直接开通订阅并下发：
  `limitIp`
  `trafficLimitBytes`
  `expiryTime`
- 管理员可重置账号密码

### 5.5 订阅中心（`Subscriptions`）

- 支持 admin 与 user 两类角色
- 支持多 profile 输出
- 内置 Clash / Mihomo YAML 输出
- 节点显示名默认脱敏

### 5.6 审计中心（`AuditCenter`）

主要包含：

- 操作审计
- 流量统计
- 订阅访问日志

当前增强点：

- 订阅访问显示 `真实 IP / 代理 IP`
- Cloudflare 场景优先记录真实访客 IP
- 可选 IP 归属地解析
- 订阅访问统计基于真实客户端 IP

### 5.7 日志查看（`Logs`）

- 支持 `panel / xray / system` 三类日志源
- 支持单节点与集群视图
- 支持关键字过滤、行数控制、复制
- 对不支持日志 API 的节点会返回明确能力提示

### 5.8 节点设置（`Server`）

- Xray 服务启停 / 重启
- Xray 版本安装
- Geo 文件更新
- Telegram 备份触发
- DB 导出 / 导入（单节点）
- Xray 配置查看（单节点）

说明：

- Telegram Bot 配置当前仍在 3x-ui 面板里管理
- NMS 当前只负责触发备份，而不负责写入 Telegram Bot 参数

### 5.9 系统能力（`Capabilities`）

- 探测节点协议支持
- 探测工具 API 可用性
- 探测日志能力，如 `panelLogs / xrayLogs`
- 展示 3x-ui 相关官方文档入口

### 5.10 系统设置（`SystemSettings`）

当前已经包含：

- 安全参数与高风险确认 token
- 任务参数
- 审计参数
- 凭据轮换
- 数据库运维：状态、模式切换、回填、快照
- SMTP 诊断
- 系统备份导出
- 节点健康巡检状态与手动巡检
- DB 告警与通知未读数汇总

## 6. 安全、审计与运维机制

### 6.1 认证与安全

- JWT Bearer 鉴权
- 登录/注册/找回密码按 IP 限流
- 节点凭据 AES-256-GCM 加密存储
- SSRF 防护：阻断内网 / localhost / 私网解析

### 6.2 审计与隐私

- 敏感字段自动脱敏
- 订阅访问日志记录状态、真实 IP、代理 IP、UA、格式等
- 审计与流量快照支持匿名化

### 6.3 系统运维

- DB 回填任务化，支持进度和取消
- DB 写入失败告警接入通知中心
- 节点健康巡检支持后台定时执行与手动触发
- 系统备份可导出 `gzip` 归档

## 7. 当前边界与注意点

- Telegram Bot 参数仍不在 NMS 中配置
- 3x-ui 日志接口能力受节点版本影响，并非所有节点都支持
- 当前系统备份只支持导出，不含完整恢复工作流
- PostgreSQL 仍是兼容持久化层，不是唯一主存储

## 8. 关键源码定位

- 前端路由与导航：`client/src/App.jsx`
- 系统设置页：`client/src/components/System/SystemSettings.jsx`
- 审计中心：`client/src/components/Audit/AuditCenter.jsx`
- 入站管理：`client/src/components/Inbounds/Inbounds.jsx`
- 用户管理：`client/src/components/Users/UsersHub.jsx`
- 账号管理：`client/src/components/Accounts/Accounts.jsx`
- 后端入口：`server/index.js`
- 认证路由：`server/routes/auth.js`
- 系统路由：`server/routes/system.js`
- 订阅路由：`server/routes/subscriptions.js`
- 节点路由：`server/routes/servers.js`
- 关键服务：`server/services/*.js`
- 关键仓储层：`server/repositories/*.js`

---

# NMS Feature and UI Audit Report

> Baseline: current `/root/NMS` repository, excluding deployment-specific differences  
> Audit date: 2026-03-11

## English

## 1. Positioning and Conclusion

NMS is now a centralized multi-node 3x-ui management panel rather than a thin proxy tool. Its product shape is clear:

- multi-node server onboarding and governance
- cross-node inbound and client management
- registration, subscription provisioning, and entitlement control
- centralized audit, traffic visibility, and subscription access logging
- system operations such as DB tooling, backup export, health monitoring, and SMTP diagnostics

Overall conclusion:

- strong product coverage
- clearly targeted for 3x-ui operations
- backend architecture is now more maintainable than the earlier route-heavy shape

## 2. Backend Shape and API Scale

### 2.1 Technical Shape

- Frontend: React + Vite in `client/`
- Backend: Express + WebSocket in `server/`
- Node integration: panel gateway / panel client against 3x-ui nodes
- Internal layering: `route -> service -> repository / panel gateway`

### 2.2 Route Scale

- Route files: 14 under `server/routes/*.js`
- Route definitions: 90
- Mounted public prefixes: 15
- `batch.js` is mounted under both `/api/batch` and `/api/jobs`

### 2.3 Domain Breakdown

| API Domain | Route Count | Primary Purpose |
|---|---:|---|
| `/api/auth` | 19 | Login, registration, email verification, password reset, user admin, subscription provisioning |
| `/api/servers` | 9 | Server CRUD, batch import, connectivity test, health summary, unified logs |
| `/api/panel` | 1 (`all`) | Unified proxy to 3x-ui panel APIs |
| `/api/batch` | 11 | Batch user/inbound operations, history, retry, cancel |
| `/api/jobs` | 11 (shared) | Alias for `/api/batch` |
| `/api/cluster` | 4 | Cluster precheck, template apply, user sync, subscription enable |
| `/api/subscriptions` | 11 | Tokens, public subscriptions, access logs, subscription lookups |
| `/api/audit` | 5 | Audit events, details, summary data |
| `/api/traffic` | 4 | Sampling, summary, trends |
| `/api/capabilities` | 1 | Node capability detection |
| `/api/protocol-schemas` | 1 | Protocol schema and templates |
| `/api/system` | 19 | Settings, DB ops, backup export, monitoring, notifications, SMTP status |
| `/api/user-policy` | 2 | Policy scope and entitlement defaults |
| `/api/users` | 4 | Aggregated user/account queries |
| `/api/clients` | 2 | Per-client entitlement override list and update |
| `/api/ws` | 1 | WebSocket ticket issuing |

## 3. Core Business Coverage

| Business Goal | Coverage | Notes |
|---|---|---|
| Multi-server 3x-ui management | Fully covered | Add, edit, delete, import, connect test, grouping and governance |
| Cross-node inbound management | Fully covered | Batch actions, ordering, protocol-aware editing |
| Cross-node user provisioning | Fully covered | Provision subscriptions, sync limits, per-client override |
| Email registration and password reset | Covered | SMTP diagnostics added, send failures no longer fake success |
| Subscription output | Fully covered | Built-in multi-format output, no external converter |
| Audit and traffic | Fully covered | Operation audit, trends, subscription access, 3x-ui log compatibility layer |
| System operations | Strongly improved | DB mode switch, backfill tasks, backup export, health monitor, notifications |

## 4. Frontend Structure

### 4.1 Main Routes

Major pages include:

- `/`
- `/inbounds`
- `/clients`
- `/subscriptions`
- `/logs`
- `/server`
- `/tools`
- `/capabilities`
- `/tasks`
- `/audit`
- `/servers`
- `/accounts`
- `/settings`

### 4.2 Role Model

- `admin`
  can access all modules
- `user`
  is reduced to Subscription Center access for the current account

## 5. Major Page Capabilities

### 5.1 Dashboard

- cluster and single-node status
- CPU, memory, online users, inbound count, total traffic
- live refresh through WebSocket

### 5.2 Servers

- add, edit, delete servers
- batch import
- single or batch connection tests
- group, tag, environment, and health governance

### 5.3 Inbounds

- cross-node inbound aggregation
- persistent manual ordering that affects subscription output
- batch enable, disable, delete, reset traffic, add users
- user traffic display and removal under each inbound
- per-client entitlement override for expiry, IP limit, traffic limit, and follow-policy restore

### 5.4 Users and Accounts

- aggregate users by email or identifier
- batch enable, disable, delete
- subscription policy editor
- admin-side subscription provisioning with:
  `limitIp`
  `trafficLimitBytes`
  `expiryTime`
- admin password reset

### 5.5 Subscription Center

- supports both admin and user roles
- multi-profile outputs
- built-in Clash / Mihomo YAML
- privacy-safe node labels by default

### 5.6 Audit Center

Main areas:

- operation audit
- traffic statistics
- subscription access logs

Current improvements:

- real IP and proxy IP display
- real visitor IP preferred under Cloudflare
- optional geo lookup
- subscription access statistics based on client IP

### 5.7 Logs

- supports `panel / xray / system` sources
- supports both single-node and cluster views
- keyword filter, line count control, copy support
- returns clear capability warnings when a node does not support a log API

### 5.8 Server Settings

- Xray start / stop / restart
- Xray version install
- Geo file update
- Telegram backup trigger
- DB export / import
- Xray config view

Important note:

- Telegram Bot configuration itself is still managed in the 3x-ui panel
- NMS currently only triggers the backup action

### 5.9 Capabilities

- protocol support detection
- tool API support detection
- log capability detection such as `panelLogs / xrayLogs`
- official 3x-ui documentation links

### 5.10 System Settings

Current coverage includes:

- security controls and high-risk confirmation tokens
- task settings
- audit settings
- credential rotation
- DB operations: status, mode switch, backfill, snapshots
- SMTP diagnostics
- system backup export
- health monitor status and manual checks
- DB alert and unread notification summary

## 6. Security, Audit, and Operations

### 6.1 Authentication and Security

- JWT Bearer auth
- IP-based rate limits for login, registration, and password reset
- AES-256-GCM encrypted server credentials
- SSRF protection against localhost, private networks, and private DNS resolution

### 6.2 Audit and Privacy

- sensitive fields are redacted
- subscription access logs now include status, real IP, proxy IP, UA, and format
- audit and traffic snapshots support anonymization

### 6.3 System Operations

- DB backfill is task-based with progress and cancellation
- DB write failures are connected to the notification center
- health monitor supports background periodic checks and manual execution
- system backup exports a `gzip` archive

## 7. Current Boundaries

- Telegram Bot parameters are not configured in NMS
- 3x-ui log API support depends on node version and capability
- system backup currently supports export only, not a full restore workflow
- PostgreSQL is still a compatible persistence layer rather than the only primary store

## 8. Key Source Locations

- frontend routing: `client/src/App.jsx`
- System Settings: `client/src/components/System/SystemSettings.jsx`
- Audit Center: `client/src/components/Audit/AuditCenter.jsx`
- Inbounds: `client/src/components/Inbounds/Inbounds.jsx`
- Users Hub: `client/src/components/Users/UsersHub.jsx`
- Accounts: `client/src/components/Accounts/Accounts.jsx`
- backend entry: `server/index.js`
- auth routes: `server/routes/auth.js`
- system routes: `server/routes/system.js`
- subscription routes: `server/routes/subscriptions.js`
- server routes: `server/routes/servers.js`
- service layer: `server/services/*.js`
- repository layer: `server/repositories/*.js`
