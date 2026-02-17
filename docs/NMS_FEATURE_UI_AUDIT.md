# NMS 功能与 UI 全面统计报告

> 统计基线：`/root/NMS` 当前代码仓库（不含外部部署差异）
> 
> 统计时间：2026-02-16

## 1. 系统定位与总体结论

该项目是一个面向多节点 3x-ui 的统一管理面板，核心能力已经覆盖你关心的四大场景：

- 多服务器集中管理（服务器注册、分组、连通性检测、批量导入）
- 跨节点入站管理（增删改查、批量启停/删除/重置流量）
- 跨节点用户管理（新增、编辑、启停、删除、冲突修复、订阅策略）
- 流量与审计（操作审计、用户/节点流量趋势、订阅访问日志）

技术形态：

- 前端：React + Vite（`client/`）
- 后端：Express + WebSocket（`server/`）
- 管理方式：通过 `/api/panel/:serverId/*` 代理到各 3x-ui 节点

---

## 2. 后端 API 能力统计

### 2.1 路由规模

- 路由文件：13 个（`server/routes/*.js`）
- 路由定义总数：61 条（按 `router.get/post/put/delete/all` 统计）
- 对外前缀挂载：14 组（其中 `/api/batch` 与 `/api/jobs` 复用同一 router）
- 实际可访问入口数：72（`batch.js` 的 11 条路由通过两个前缀暴露）

### 2.2 按域统计

| API 域 | 路由定义数 | 主要能力 |
|---|---:|---|
| `/api/auth` | 13 | 登录/注册/邮箱验证/找回密码/用户账号管理 |
| `/api/servers` | 7 | 服务器 CRUD、批量导入、连接测试、治理汇总 |
| `/api/panel` | 1 (`all`) | 到 3x-ui 面板 API 的统一代理转发 |
| `/api/batch` | 11 | 批量用户/入站操作、历史记录、重试、取消 |
| `/api/jobs` | 11 (复用) | 与 `/api/batch` 同能力，任务化访问别名 |
| `/api/cluster` | 4 | 集群预检、模板下发、用户同步、订阅启用 |
| `/api/subscriptions` | 10 | token 签发撤销、公共订阅、访问日志、用户订阅查询 |
| `/api/audit` | 2 | 审计事件查询、单条详情 |
| `/api/traffic` | 4 | 流量采样刷新、总览、用户趋势、节点趋势 |
| `/api/capabilities` | 1 | 节点能力探测 |
| `/api/protocol-schemas` | 1 | 协议 schema 与默认模板 |
| `/api/system` | 4 | 系统设置、高风险确认 token、凭据轮换 |
| `/api/user-policy` | 2 | 用户订阅策略（可用节点/协议限制） |
| `/api/ws` | 1 | WebSocket ticket 签发 |

### 2.3 权限模型

角色定义：`admin` / `user`。

- `admin`：可访问并管理全部模块
- `user`：仅可访问订阅中心并查看自己的订阅连接

关键点：

- `subscriptions` 域混合了公开访问（`/public/*`）和登录后管理接口
- 管理类路由统一收敛为 `adminOnly`

---

## 3. 核心功能覆盖（按你关心的业务）

| 业务目标 | 覆盖情况 | 说明 |
|---|---|---|
| 多服务器管理 3x-ui | 已完整覆盖 | 服务器添加/编辑/删除、批量导入、连通性测试、凭据修复、分组与健康治理 |
| 跨节点添加用户 | 已完整覆盖 | 用户可按全节点或选定目标批量添加；支持 UUID/密码协议差异化处理 |
| 跨节点添加入站 | 已完整覆盖 | 入站支持批量下发，含协议、传输层、安全层（TLS/REALITY）与高级 JSON 模式 |
| 流量日志审计 | 已完整覆盖 | 审计中心包含操作审计、流量统计趋势、订阅访问日志（含状态分布） |
| 用户管理 | 已完整覆盖 | 用户聚合展示、批量启停删、冲突扫描修复、订阅链接与权限策略 |

---

## 4. 前端页面与信息架构统计

### 4.1 页面规模

- 组件页面文件（`client/src/components/*/*.jsx`）：22 个
- 主路由受保护页面入口：14 条
- 侧边栏主导航项：13 项
- 侧边栏系统区：2 项（服务器管理、退出登录）

### 4.2 主路由清单

| 路由 | 页面 | 可见性/备注 |
|---|---|---|
| `/` | 仪表盘 | 仅 admin |
| `/inbounds` | 入站管理 | 仅 admin |
| `/clients` | 用户管理 | 仅 admin |
| `/subscriptions` | 订阅中心 | admin 可查全部；user 仅可查看自己的订阅连接 |
| `/cluster` | 集群向导 | 仅 admin |
| `/logs` | 日志查看 | 仅 admin |
| `/server` | 节点设置 | 仅 admin |
| `/tools` | 密钥工具 | 仅 admin；全局视图下隐藏 |
| `/capabilities` | 系统能力 | 仅 admin；全局视图下隐藏 |
| `/tasks` | 任务中心 | 仅 admin |
| `/audit` | 审计中心 | 仅 admin |
| `/servers` | 服务器管理 | 仅 admin |
| `/accounts` | 账号管理 | 仅 admin 导航可见 |
| `/settings` | 系统设置 | 仅 admin |

### 4.3 UI 组件使用统计（代码级）

- 含 `modal-overlay` 的弹窗场景：13 处
- `<table>` 表格使用：17 处
- 图表相关（Recharts/图表组件引用）：16 处（集中在仪表盘、审计中心）
- Tab 样式用法（`tabs` + `tab`）：10 处

---

## 5. 主要页面能力盘点

### 5.1 仪表盘（`Dashboard`）

- 单节点视图：CPU、内存、运行时长、在线用户、入站数、总流量、CPU 趋势
- 集群视图：在线节点统计、聚合流量、节点监控表、在线用户明细
- 实时能力：WebSocket `cluster_status` 推送，断线自动重取 ticket

### 5.2 服务器管理（`Servers`）

- 服务器新增/编辑/删除
- 批量导入（支持公共凭据 + 行级条目）
- 单节点/批量连接测试
- 凭据修复弹窗（可对选中节点批量修复）
- 治理字段：`group` / `tags` / `environment` / `health`

### 5.3 入站管理（`Inbounds` + `InboundModal`）

- 跨节点入站聚合列表
- 批量操作：启用、停用、删除、重置流量、批量加用户
- 入站编辑器：
  - 简单模式：协议、端口、传输层、TLS/REALITY、嗅探等可视化配置
  - 专家模式：`settings` / `streamSettings` / `sniffing` JSON 直接编辑
- 支持协议：VMess/VLESS/Trojan/Shadowsocks/HTTP/Tunnel/Mixed/WireGuard/TUN

### 5.4 用户管理（`Clients` + 系列弹窗）

- 用户按 email/标识跨节点聚合
- 批量启用/停用/删除
- 全节点添加用户
- 冲突扫描与自动修复（跨协议标识冲突）
- 订阅策略弹窗（限制可访问节点/协议）
- 订阅链接与二维码（多 profile：v2rayN/Clash/sing-box 等）

### 5.5 任务中心（`Tasks`）

- 展示批量任务历史（类型、动作、节点、成功失败）
- 任务详情查看
- 失败项重试（支持按节点/错误分组策略）
- 清空历史

### 5.6 审计中心（`AuditCenter`）

三大 Tab：

- 操作审计：按关键词、事件类型、结果、用户、节点过滤
- 流量统计：总量、活跃用户、采样点、用户/节点趋势图
- 订阅访问：PV/UV/状态分布、访问明细分页

### 5.7 节点设置（`Server`）

- Xray 服务启停/重启
- Xray 版本安装
- Geo 文件更新
- Telegram 备份
- DB 导出/导入（仅单节点）
- Xray 配置查看（仅单节点）

### 5.8 日志查看（`Logs`）

- 单节点日志与集群日志
- 级别过滤、行数控制、关键词过滤、复制
- 集群模式支持节点选择与聚合显示

### 5.9 系统能力（`Capabilities`）

- 探测节点协议支持
- 探测工具 API 可用性（uuid/x25519/ml-dsa/ml-kem/vlessEnc/ech）
- 展示官方模块文档入口（SSL/Fail2Ban/WARP/TOR/Reverse Proxy 等）

### 5.10 密钥工具（`Tools`）

- 一键生成并复制：UUID、X25519、ML-DSA-65、ML-KEM-768、VLESS Enc、ECH Cert

### 5.11 账号管理（`Accounts`）

- 管理员查看用户账号清单
- 管理员重置指定用户密码（密码策略校验 + 随机密码生成）

### 5.12 系统设置（`SystemSettings`）

- 安全参数：高风险确认、风险阈值、token TTL（仅 admin）
- 任务参数：保留天数、分页上限、并发（仅 admin）
- 审计参数：保留天数、分页上限（仅 admin）
- 凭据轮换：Dry Run / 执行轮换（仅 admin）
- 数据库运维：状态观测、模式切换与回填（仅 admin）

### 5.13 登录与认证（`Login`）

- 登录
- 注册 + 邮箱验证码验证
- 忘记密码 + 邮箱验证码重置

---

## 6. 安全、风控与审计机制

### 6.1 认证与会话

- JWT Bearer 鉴权
- 前端 token 存于 `sessionStorage`（旧 key 自动迁移）
- 3x-ui 节点会话 cookie 由后端 `panelClient` 自动维护

### 6.2 风险控制

- 高风险批量动作（如 delete/disable）可触发确认 token
- 前端批量操作自动调用 `/system/batch-risk-token` 注入 `confirmToken`
- 重试任务也纳入风险评估

### 6.3 审计体系

- 安全事件写入安全审计日志并同步到审计存储
- 对敏感字段（password/token/secret/cookie）自动脱敏
- 订阅访问独立记录（状态、IP、UA、serverId、mode、format）

### 6.4 平台安全防护

- API 级限流（通用 + auth 路由）
- 登录/注册/找回密码额外按 IP 频率限制
- 服务器地址校验与 SSRF 防护：阻断内网 IP、localhost、本地域名及 DNS 解析到私网场景
- 节点凭据使用 AES-256-GCM 加密存储，并支持历史密钥迁移

---

## 7. 与“多服务器 3x-ui 管理面板”目标的匹配度

总体匹配度：高。

已具备的管理面板属性：

- 集中接入多节点
- 统一编排入站和用户
- 风险可控的批量执行
- 完整可追溯的操作审计 + 订阅访问审计
- 实时集群状态与在线会话可视化

---

## 8. 当前边界与注意点

- `Subscriptions` 与 `ClusterWizard` 已挂载到主路由与导航；`ClusterWizard` 仅 admin 可访问。
- `user` 角色仅保留订阅中心入口，且仅可查看自身邮箱对应的订阅连接。
- 系统设置已新增数据库运维面板（状态、模式切换、回填、快照查看），仅 admin 可访问。
- 全局视图下，`/tools`、`/capabilities` 会被隐藏并在访问时重定向；部分单节点动作（DB 导入导出、查看配置）在全局模式禁用。

---

## 9. 关键源码定位（便于二次核查）

- 路由与导航：`client/src/App.jsx`，`client/src/components/Layout/Sidebar.jsx`
- 多节点上下文：`client/src/contexts/ServerContext.jsx`
- 认证上下文：`client/src/contexts/AuthContext.jsx`
- 后端路由挂载：`server/index.js`
- 权限中间件：`server/middleware/auth.js`
- 节点代理：`server/routes/proxy.js`
- 批量任务：`server/routes/batch.js`
- 订阅体系：`server/routes/subscriptions.js`
- 审计与流量：`server/routes/audit.js`，`server/routes/traffic.js`
- 服务器存储与凭据加密：`server/store/serverStore.js`
- WebSocket 实时推送：`server/wsServer.js`
