# NMS User Guide / NMS 使用说明

> Updated: 2026-03-11

## 中文

### 1. 角色说明

NMS 默认有两类使用角色：

- 管理员：可以管理节点、入站、用户、订阅、审计、任务和系统设置
- 普通用户：只能查看自己的订阅信息，不能进入管理后台能力页

### 2. 首次登录

1. 打开你的 NMS 地址，例如 `https://nms.example.com`
2. 使用 `.env` 中配置的管理员账号登录
3. 首次进入后建议先检查：
   - 主题模式是否为跟随系统
   - 语言是否为中文或英文
   - 右上角通知中心是否正常

### 3. 首页仪表盘

仪表盘用于看全局状态，主要包含：

- 节点总数与在线状态
- 入站数量与启用情况
- 在线用户与流量概况
- 节点实时状态和异常提示

建议用途：

- 先看节点在线率
- 再看最近异常和通知
- 最后再进入具体页面处理问题

### 4. 服务器管理

“服务器管理”用于接入 3x-ui 节点。

常规流程：

1. 新增服务器
2. 填写名称、地址、认证信息、标签或环境信息
3. 执行连通性检查
4. 保存后等待状态同步

建议：

- 节点命名统一使用地区 + 环境 + 编号
- 地址尽量使用稳定域名，不要直接写容易变动的临时 IP
- 节点接入后先看健康状态，再开始用户和入站操作

### 5. 入站管理

“入站管理”用于跨节点查看和编辑入站。

你可以在这里做：

- 查看所有节点的入站列表
- 按协议、节点、状态筛选
- 修改启用状态、端口、备注等信息
- 批量执行启用、禁用、删除等操作

使用建议：

- 先用筛选条件缩小范围，再做批量操作
- 修改前确认目标节点和协议类型，避免跨节点误操作

### 6. 用户管理

“用户管理”是管理员最常用的页面之一，主要用于：

- 创建用户
- 编辑流量、到期时间、设备/IP 限制
- 查看用户详情
- 管理用户的订阅入口

常见字段建议：

- 邮箱：尽量使用稳定、唯一的标识
- 到期时间：与业务套餐保持一致
- 流量额度：和上游节点或套餐统一口径
- `limitIp`：按实际设备策略设置，不建议盲目设得太严

### 7. 订阅中心

订阅中心分管理员视角和普通用户视角。

#### 7.1 管理员视角

管理员可以：

- 查看指定用户的订阅地址
- 查看不同客户端专用链接
- 查看二维码
- 失效或重签订阅 token
- 配置兼容旧系统的订阅路径

#### 7.2 普通用户视角

普通用户进入订阅中心时，只会看到自己真正需要的内容：

- 订阅链接
- 客户端专用链接
- 二维码

不会看到管理员控制域、邮箱筛选和说明性管理文案。

### 8. 旧订阅地址迁移

如果你正在从旧系统迁移客户，可以为用户配置“兼容订阅路径”。

用途：

- 保持老客户原来的路径结构
- 只更换域名，不强制客户改客户端配置

规则：

- 路径必须以 `/` 开头
- 支持多级路径，例如 `/sub/customer-a`
- 只允许小写字母、数字、连字符和 `/`
- 不能与 `/api`、`/login`、`/audit` 等系统保留路径冲突
- 必须全局唯一

示例：

- 老系统路径：`/sub/customer-a`
- 新域名：`https://nms.example.com`
- 最终迁移地址：`https://nms.example.com/sub/customer-a`

### 9. 审计中心

审计中心用于排查谁做了什么、谁访问了哪些订阅、流量如何变化。

主要包括：

- 操作审计
- 订阅访问记录
- 流量统计
- 常见访问来源或异常聚合

适合用来：

- 排查错误配置是谁改的
- 判断订阅是否被频繁访问
- 分析一段时间内的流量变化

### 10. 任务中心

任务中心用于查看批量操作的执行结果，例如：

- 批量用户操作
- 批量流量重置
- 批量同步任务

建议关注：

- 成功数和失败数
- 失败原因
- 是否需要重试

### 11. 日志页

日志页用于集中查看节点日志与排障信息。

建议排障顺序：

1. 先看节点是否在线
2. 再看最近日志时间戳
3. 最后结合审计和任务结果交叉判断

### 12. 系统设置

系统设置建议优先检查这些项目：

- 订阅公网地址
- SMTP 配置与测试结果
- 备份导出
- 节点健康巡检
- 数据库接入状态

如果你启用了数据库模式，还可以在这里查看运行时读写模式和回填状态。

### 13. 主题、语言与移动端

当前 UI 行为：

- 默认跟随系统深浅主题
- 默认中文，可切换英文
- 页头不会同时显示中英双语
- PC 和手机端都会自动适配

移动端建议：

- 以“查看状态、复制链接、执行轻量操作”为主
- 大批量管理仍建议在桌面端完成

### 14. 推荐运维习惯

- 先设置订阅公网地址，再对外发放链接
- 新节点接入后先做连通性检查
- 大批量操作前先确认筛选条件
- 变更后去审计中心确认结果
- 发布前备份 `.env` 和 `data/`

---

## English

### 1. Roles

NMS normally has two user roles:

- Admin: can manage servers, inbounds, users, subscriptions, audit, tasks, and system settings
- User: can only view their own subscription information

### 2. First Login

1. Open your NMS URL, for example `https://nms.example.com`
2. Sign in with the admin account configured in `.env`
3. After login, quickly verify:
   - theme mode follows the system
   - locale is set to Chinese or English as expected
   - the notification center is working

### 3. Dashboard

The dashboard provides the global overview:

- total nodes and online status
- inbound counts and enabled ratios
- online users and traffic summaries
- live node state and recent alerts

Recommended reading order:

1. check node availability
2. review recent alerts
3. drill down into the affected page

### 4. Server Management

Use `Servers` to connect your 3x-ui nodes.

Typical workflow:

1. add a server
2. fill in name, URL, credentials, tags, and environment info
3. run the connectivity check
4. save and wait for sync

Recommendations:

- use a consistent naming pattern such as region + environment + index
- prefer stable hostnames over temporary IP addresses
- confirm health before doing user or inbound operations

### 5. Inbound Management

Use `Inbounds` to inspect and edit inbounds across nodes.

You can:

- browse all inbounds across nodes
- filter by protocol, node, and status
- change enabled state, port, remark, and related fields
- perform batch actions

Best practice:

- narrow the target set with filters before running batch actions
- verify protocol type and target nodes before saving changes

### 6. User Management

`Users` is one of the main admin pages. It is used to:

- create users
- edit quota, expiry, and device/IP limits
- inspect user details
- manage subscription entry points

Practical suggestions:

- use a stable unique email or identifier
- align expiry with the actual plan lifecycle
- keep traffic limits consistent with the product policy
- avoid over-tightening `limitIp` unless your client policy requires it

### 7. Subscription Center

The subscription center behaves differently for admins and end users.

#### 7.1 Admin view

Admins can:

- inspect subscription URLs for a user
- view client-specific links
- show QR codes
- revoke or reissue subscription tokens
- configure legacy migration paths

#### 7.2 User view

Regular users only see the content they need:

- subscription links
- client-specific import links
- QR code

They do not see admin-only context controls, email filters, or management copy.

### 8. Legacy Subscription Path Migration

If you are migrating from another panel, you can assign a compatibility path per user.

Why it matters:

- preserve the old path layout used by existing clients
- replace only the domain without forcing every client to reconfigure

Rules:

- the path must start with `/`
- nested paths are allowed, for example `/sub/customer-a`
- only lowercase letters, digits, hyphens, and `/` are allowed
- it must not conflict with reserved routes such as `/api`, `/login`, or `/audit`
- the path must be globally unique

Example:

- old path: `/sub/customer-a`
- new domain: `https://nms.example.com`
- final migrated URL: `https://nms.example.com/sub/customer-a`

### 9. Audit Center

The audit center helps answer:

- who changed what
- who accessed which subscription
- how traffic changed over time

Main areas:

- operation audit
- subscription access logs
- traffic statistics
- access source aggregation and anomaly clues

### 10. Tasks

The task center tracks background and batch actions such as:

- bulk user operations
- traffic resets
- synchronization jobs

Focus on:

- success and failure counts
- failure reasons
- retry decisions

### 11. Logs

The logs page centralizes node logs and troubleshooting signals.

Recommended order for debugging:

1. check whether the node is online
2. inspect the latest timestamps
3. correlate with audit and task records

### 12. System Settings

Priority items in `System Settings`:

- public subscription base URL
- SMTP configuration and test result
- backup export
- node health monitoring
- database runtime status

If DB mode is enabled, this page also shows runtime read/write modes and backfill status.

### 13. Theme, Language, and Mobile

Current UI behavior:

- theme defaults to system-following mode
- Chinese is the default locale, English is optional
- the header shows one language at a time
- the UI adapts to both desktop and mobile layouts

Mobile guidance:

- use it for status checks, link copying, and light operations
- keep heavy batch administration on desktop when possible

### 14. Recommended Operating Habits

- set the public subscription base URL before sharing links
- run a connectivity check when adding a new node
- verify filters before batch operations
- confirm changes in the audit center after major edits
- back up `.env` and `data/` before upgrading
