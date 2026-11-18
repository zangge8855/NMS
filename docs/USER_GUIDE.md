# User Guide

## English

### Who Uses NMS

NMS uses a 4-tier RBAC model:

- **Admin (`admin`)**: full access to servers, Panel API Tokens & Panel Nodes, inbounds, users (including staff accounts), subscriptions, audit clearing, Xray console (`/xray`), and system settings (`/settings`)
- **Operator (`operator`)**: operational access to Dashboard, Servers, Inbounds, Users (non-staff `user` accounts only), Audit, Logs, Tools, and Capabilities; cannot open `/settings` or `/xray`, manage staff accounts, clear audit logs, or invoke panel-admin proxy endpoints
- **Auditor (`auditor`, legacy alias `viewer`)**: read-only staff access across Dashboard, Servers, Inbounds, Users, Audit, Logs, Tools, and Capabilities; write controls are hidden/disabled, marking notifications read is disabled, `/settings` and `/xray` are hidden, and Panel Features only exposes `Client Groups`, `Client Directory`, `Subscription Hosts`, and `Sub Balancers`
- **End user (`user`)**: self-service access limited to `Subscriptions`, `Downloads`, and `Account`

NMS is designed so admins and operators can run multi-node operations from one control plane while auditors inspect state safely and end users only see subscription actions that matter to them.

### Main Navigation

#### Global command search & Notification Bell

- Use the header search field, or `Ctrl K` / `Cmd K`, to jump across pages, users, and nodes without opening the sidebar first
- Staff with mutation rights can run common actions from the command palette, including refreshing the current view, creating a user, and adding a server
- Page refresh commands reuse each page's live-data loader, so they avoid a full browser reload when the current page supports it
- Open the header **Notification Bell** to filter alerts by severity (`All`, `Critical`, `Warning`, `Info`), toggle **Unread only**, jump directly to the referenced server (`View Node`) or `Audit` center (`View Audit`), or mark alerts read (`admin` / `operator` only; auditors are shown a read-only hint)

#### Dashboard

- Review node health, headline metrics, alerts, quick actions, and operational summaries
- Use **Customize** (`视图定制`) to toggle any of the five dashboard sections (`kpis`, `trafficWindows`, `systemTrends`, `nodeHealth`, `onlineSessions`) — preferences save per user in `localStorage` and can be reset with **Reset default**
- Use **Export** (`导出快照`) to download a UTF-8 BOM CSV snapshot covering current cluster KPIs, traffic windows, and node health/throughput metrics
- Online-user detail shows username and email together, so operators can identify the account without opening `Users`
- The dashboard prefers live cluster snapshots and only hydrates heavier online detail when needed, so the page stays responsive on first load

#### Servers

- Add, edit, and remove panel nodes (`admin` and `operator`; read-only for `auditor`)
- Check connectivity, credentials, and onboarding status
- Open **Server Detail** to inspect:
  - **API Tokens** (`admin` only): create, enable/disable, and delete 3x-ui/s-ui panel API tokens (plaintext token shown once on creation)
  - **Panel Features** (3x-ui v3): manage **Client Groups**, **Client Directory** (paged `clients/list/paged` table with search, inbound/group/status filters, plus exact lookup by **SubID** or **Telegram ID**), **Subscription Hosts**, **Sub Balancers**, **Outbound Subs** (`admin` / `operator`), and **Panel Nodes** (`admin` only). Unsupported older panels automatically show a clear compatibility notice

#### Keyboard & Accessibility Navigation

- Horizontal tab strips on **Server Detail**, **User Detail**, **Audit**, and **Users** support WAI-ARIA **roving tabindex** (`ArrowLeft`, `ArrowRight`, `Home`, `End` with wrap-around)
- Wide data tables across `Servers`, `Inbounds`, `Users`, and `Audit` expose keyboard-focusable scrollable regions (`role="region"`, `tabIndex={0}`) with sticky headers so keyboard-only users can scroll with arrow keys

#### Inbounds

- Inspect or update inbounds across connected nodes
- Useful for protocol changes, port edits, and traffic-policy maintenance
- Saved inbound order also controls the node order that end users receive from subscription refreshes
- Expanded inbound user tables now compress traffic and action columns more aggressively so sidebar-open layouts need less horizontal scrolling

#### Users

- Manage user records, subscription details, activity logs, entitlement details, and conflict handling
- Use this area when provisioning, repairing, resetting subscription links, or cleaning up user state as an admin
- The list renders the base account table first and then syncs node statistics in the background, so early rows may briefly show a syncing badge before traffic and node totals settle
- The user detail `Subscription` tab now follows the same layout as the end-user subscription center, so admins and end users are working from one consistent import model

#### Subscriptions

- This page is primarily for end users
- Use it for self-service subscription links, client import, and password changes
- Admins normally enter subscription details from `Users`
- The primary import area now keeps quick import, copy address, QR code, and reset link together
- The device section now only shows download links and recommended profile types, so the page stays simple for non-technical users

#### Downloads

- A dedicated software download center for end users
- Lists recommended client applications with download links for each platform
- Paired with the subscription page so users can get both links and software from the same interface

#### Account

- End-user self-service account center
- Supports viewing profile info, changing password, and updating email
- Admins are redirected to the main user management area instead

#### Capabilities and Tools

- Inspect protocol capability coverage
- Use node tools for protocol-side diagnostics
- Open the node console from `Settings -> Node Console` when you need server maintenance or cluster-side operations

#### Audit

- Review admin actions, subscription access history, and operational traces
- This is the best place to confirm what happened after a batch change
- Filters and status summaries are intentionally compact now; expect small pills and control rows instead of large empty state cards
- Event and subscription-access views support date range, actor, target user, server, token, and real-IP filtering where relevant
- CSV export uses the same filter set as the visible audit event list, so exported evidence matches the on-screen review

#### Settings

- Configure the site access path, random hidden entry generation, optional camouflage landing page, SMTP diagnostics, domain-change mail broadcast, security controls, backup actions, storage modes, Telegram delivery, and global system behavior
- Turn invite-only registration on or off, and batch-generate invite codes with usage limits and subscription duration
- Use the embedded `Node Console` tab for cluster maintenance without leaving the system workbench
- System status now lives in its own tab instead of occupying the top of every settings view
- Reserve this page for controlled admin changes

### Common Workflows

#### Onboard a new node

1. Open `Servers`.
2. Add the panel URL and credentials.
3. Verify connectivity and capability detection.
4. Return to the dashboard to confirm healthy status.

#### Create or govern a user

1. Open `Users`.
2. Create or edit the user profile, quota, expiry, and policy settings.
3. Open the user detail page to review subscription data, node list, and recent activity.
4. Check whether any client conflict or entitlement issue needs attention.

#### Issue a subscription

1. As an admin, open `Users` and enter the target user detail page.
2. Open the `Subscription` tab.
3. Copy the current subscription link, or use reset link when the old one should be invalidated.
4. Send the subscription link to the user.
5. If you only changed server or inbound order, keep using the same link and ask the user to refresh the subscription once.

#### Invite-only registration

1. Open `Settings`.
2. Turn on invite-only registration if you want registration to require a code.
3. Generate one or more invite codes, set how many times each code may be used, and set how many days of subscription access the code grants.
4. Users who register with a valid invite code can sign in immediately; the backend auto-provisions a subscription with all nodes and all protocols by default.
5. Share the generated codes through your own support workflow.

#### Change the homepage access path

1. Open `Settings`.
2. In the basic system parameters area, set the homepage access path to a value such as `/portal`.
3. Use `Random Path` if you want the system to generate a high-entropy hidden entry for you.
4. Optionally turn on the camouflage landing page so non-matching document requests show a neutral city-magazine homepage instead of the real UI.
5. Save the settings and update bookmarks or reverse-proxy routing as needed.
6. Keep `/api`, `/ws`, and subscription public routes reachable.
7. Existing subscription links stay the same; this setting only changes where the UI loads.

#### Validate a batch change

1. Run the batch action.
2. Open `Audit` to inspect the recorded result.
3. Return to the dashboard, users, or inbounds list to confirm final state.

#### Operate the system safely

1. Test SMTP before enabling email-dependent flows.
2. Export a backup before sensitive changes.
3. If you plan to change domains or public entry URLs, use the built-in domain-change mail action after SMTP diagnostics pass.
4. Use system settings and runtime modes deliberately, especially when DB mode is involved.

#### Telegram notification flow

1. Open `Settings`.
2. Configure the bot token and Chat ID in the Telegram area.
3. Use the built-in test message to confirm delivery.
4. Once enabled, Telegram delivers structured summaries for system notifications, security audits, expiry reminders, and periodic operations digests.
5. In Telegram itself, send `/help` or type commands such as `/status` directly. The Telegram command menu is optional and can stay disabled.

#### Review Harness (3x-ui v3 & s-ui)

1. Run `npm run review:fake-panel`, `npm run review:seed`, and `npm run review:server` inside `server/` (see [Review Harness](REVIEW_HARNESS.md)).
2. `review_fake_panel.js` simulates 3x-ui v3 endpoints (`clients/list/paged`, `get/subId`, `get/tgId`, `clients/groups`, `hosts`, `sub-balancers`, `xray/outbound-subs`, `nodes`, `clients/hwids`, `setting/apiTokens`) alongside legacy 3x-ui and s-ui nodes so operators can safely verify RBAC roles, Panel Features, and UI workflows locally without touching production panels.

### Why Daily Operations Feel Easier

- One interface covers nodes, users, subscriptions, and system controls
- Client-ready subscription links reduce manual operator formatting
- Audit and job history make changes easier to explain and verify
- Capability views, health checks, and diagnostics shorten troubleshooting loops
- Bilingual UI helps mixed-language teams onboard faster

### Usage Tips

- Confirm the active node scope before high-volume changes
- Set `SUB_PUBLIC_BASE_URL` before sending links outside your internal network
- Treat the homepage access path as a UI entry only; it does not replace `SUB_PUBLIC_BASE_URL`
- The camouflage landing page only affects non-matching document requests; it does not change APIs, WebSocket routes, or subscription URLs
- Changing server order or inbound order changes delivered node order, but does not change issued subscription URLs
- After critical changes, always check `Audit` instead of trusting the first success toast
- NMS is configured to block search engine indexing by default using `noindex, nofollow` and `robots.txt` to keep the panel private. Do not remove these settings.
- If the UI looks stale behind a proxy, refresh first and then inspect cache behavior

## 中文

### 谁会使用 NMS

NMS 采用四层 RBAC 角色体系：

- **管理员（`admin`）**：拥有完整权限，可管理服务器与面板 API Token/多节点、入站、用户（含运维/审计等工作人员账号）、订阅、审计清空、Xray 控制台（`/xray`）和系统设置（`/settings`）
- **运维（`operator`）**：可操作仪表盘、服务器、入站、用户（仅限普通 `user` 账号，禁止创建/修改/禁用/删除任何非 `user` 工作人员账号）、审计、日志、节点工具与能力探测；不可访问 `/settings` 或 `/xray`、不可清空审计日志、不可调用面板底层管理代理接口
- **审计员（`auditor`，兼容旧别名 `viewer`）**：只读运维审计角色，可查看仪表盘、服务器、入站、用户、审计、日志、工具和能力页面；所有写操作按钮均隐藏或禁用，无法标记通知已读，不可访问 `/settings` 与 `/xray`，在「面板功能」中仅可查看客户端分组、客户端目录（含 SubID / TG ID 查询）、订阅 Hosts 与均衡器
- **普通用户（`user`）**：自助服务角色，仅访问 `Subscriptions`（订阅中心）、`Downloads`（软件下载）和 `Account`（账户中心）

NMS 的设计重点是让管理员和运维在一个后台安全协作，让审计员以最小权限核查状态，而普通用户只接触真正需要的订阅动作。

### 主要导航

#### 全局命令搜索与通知铃铛

- 使用顶部搜索框，或按 `Ctrl K` / `Cmd K`，可以直接跳转页面、用户和节点，不必先展开侧边栏查找
- 具备写权限的工作人员还可以在命令面板执行刷新当前页、添加账号和添加服务器等常用动作
- 支持的页面会复用自己的实时数据加载逻辑刷新内容，避免不必要的整页重载
- 点击顶部**通知铃铛**可打开通知中心，按严重级别（`全部`、`严重`、`警告`、`信息`）与`仅未读`筛选告警，直接点击**查看节点**或**查看审计**跳转上下文；`admin` / `operator` 可标记已读，审计员界面会显示只读提示

#### Dashboard

- 查看节点健康状态、关键统计、告警、快捷入口和运行摘要
- 点击**视图定制**可按个人偏好显隐 5 个仪表盘区块（核心指标 KPI、流量周期统计、系统资源趋势、节点健康状态、在线会话明细），按用户名保存在 `localStorage` 中，并支持一键**恢复默认**
- 点击**导出快照**可下载包含当前集群 KPI、用户流量周期和节点健康/吞吐明细的 UTF-8 BOM CSV 快照
- 在线用户明细会同时显示用户名和邮箱，方便直接识别账号，不必再切去用户管理
- 仪表盘首屏会优先使用集群实时快照，只有在需要时才继续补更重的在线明细，因此登录后进入后台会更快

#### Servers

- 新增、编辑、删除面板节点（`admin` / `operator` 可操作，`auditor` 只读）
- 检查连通性、凭据和接入状态
- 进入**节点详情**可使用：
  - **API Token**（仅 `admin`）：创建、启停与删除 3x-ui / s-ui 面板 API Token（明文仅在创建后展示一次）
  - **面板功能**（3x-ui v3）：包含**客户端分组**、**客户端目录**（支持 `clients/list/paged` 分页目录、关键字/入站/分组/状态筛选，以及按 **SubID** 或 **Telegram ID** 精确查询）、**订阅 Hosts**、**订阅均衡器**、**Xray 出站订阅**（`admin` / `operator`）和**面板多节点**（仅 `admin`）。若目标面板版本过旧不支持某项能力，会统一显示兼容提示

#### 键盘与无障碍导航

- **节点详情**、**用户详情**、**审计中心**与**用户管理**的水平标签条支持 WAI-ARIA **Roving Tabindex**（`ArrowLeft` / `ArrowRight` / `Home` / `End` 循环切换并自动滚动到可见区域）
- `Servers`、`Inbounds`、`Users` 与 `Audit` 中的宽表格提供键盘可聚焦滚动容器（`role="region"`、`tabIndex={0}`）与吸顶表头，纯键盘用户也可直接用方向键左右滚动查看列数据

#### Inbounds

- 跨节点查看和维护入站
- 适合处理协议调整、端口修改和流量策略维护
- 保存后的入站顺序也会影响普通用户刷新订阅时拿到的节点顺序
- 展开用户列表后会优先压缩统计列和操作区，减少在侧边栏展开状态下还要横向拖动的情况

#### Users

- 管理用户资料、订阅信息、活动日志、授权信息和冲突处理
- 管理员新开通用户、修复状态、重置订阅链接或做清理时，主要会用到这里
- 用户列表会先把基础账号表显示出来，再后台同步节点统计，所以刚进入时节点数、流量、到期时间可能短暂显示“同步中”
- 用户详情里的 `订阅` 页签现在和普通用户的订阅中心保持同一套导入结构，管理员和用户看到的关键操作会更一致

#### Subscriptions

- 这个页面主要面向普通用户
- 用来查看自助订阅链接、快捷导入、扫码导入和修改密码
- 管理员通常从 `Users` 里的用户详情进入订阅信息
- 用户页的核心说明只有三步: `选类型 -> 复制地址 -> 导入客户端`
- 快捷导入、复制地址、二维码和重置链接会集中显示在同一个主导入区
- 设备区只保留下载链接和推荐类型，避免给普通用户重复解释导入方式

#### Downloads（软件下载）

- 普通用户专属的软件下载中心
- 按平台列出推荐客户端应用及下载链接
- 与订阅页面配合，让用户在同一个界面获取订阅链接和客户端软件

#### Account（账户中心）

- 普通用户自助账户管理页面
- 支持查看个人信息、修改密码和更新邮箱
- 管理员访问时会被重定向到用户管理区

#### Capabilities 与 Tools

- 查看节点协议能力覆盖情况
- 使用节点工具做协议侧诊断
- 需要节点维护或集群操作时，从 `系统设置 -> 节点控制台` 进入

#### Audit

- 查看管理员操作、订阅访问历史和关键运行痕迹
- 批量变更之后，这里是确认结果的首选页面
- 当前的筛选与状态摘要会尽量压缩成紧凑控制条，不再使用大块说明卡片
- 事件和订阅访问视图支持按日期范围、操作者、目标用户、节点、Token、真实 IP 等条件筛选
- CSV 导出会复用当前审计事件列表的筛选条件，确保导出的核对材料和页面上看到的结果一致

#### Settings

- 配置真实入口路径、随机入口生成、可选伪装首页、SMTP 诊断、网址变更通知、安全控制、备份操作、存储模式、Telegram 和全局系统行为
- 开关邀请制注册，并批量生成带使用次数和开通时长限制的邀请码
- 通过内嵌的 `节点控制台` 页签完成集群维护，不用再切到单独页面
- 系统状态已经独立到单独页签，不会一直占据设置页顶部
- 建议只在受控变更窗口中由管理员使用

### 常见工作流

#### 接入一个新节点

1. 打开 `Servers`。
2. 填写面板地址和凭据。
3. 验证连通性和能力探测结果。
4. 回到仪表盘确认状态健康。

#### 创建或治理一个用户

1. 打开 `Users`。
2. 创建或编辑用户资料、配额、到期时间和策略设置。
3. 进入用户详情查看订阅信息、节点列表和最近活动。
4. 检查是否存在客户端冲突或授权异常需要处理。

#### 发放一个订阅链接

1. 管理员在 `Users` 中进入目标用户详情。
2. 打开 `订阅` 页签。
3. 让用户按页面上的三步使用: 先选类型，再复制地址或扫码，最后导入客户端。
4. 如果旧链接需要失效，就使用重置链接。
5. 把订阅链接发给用户。
6. 如果你只是调整了服务器顺序或入站顺序，继续用原来的订阅链接即可，让用户刷新一次订阅就行。

#### 用户忘记密码

1. 在登录页点击 `忘记密码`。
2. 输入注册邮箱并发送验证码。
3. 填写验证码和新密码后完成重置。
4. 为了避免泄露用户信息，系统对外只会提示“如果邮箱已注册，验证码已发送”，不会提示该邮箱是否存在。

#### 启用邀请制注册

1. 打开 `Settings`。
2. 如果希望注册必须带邀请码，就开启邀请注册。
3. 生成一个或多个邀请码，并设置每个邀请码可使用的次数和自动开通时长。
4. 用户使用有效邀请码注册后可以直接登录，后台会默认按“全部节点 + 全部协议”自动开通订阅。
5. 通过你自己的支持流程把邀请码发给用户。

#### 修改首页访问路径

1. 打开 `Settings`。
2. 在系统参数区域把首页访问路径改成例如 `/portal`。
3. 如果不想自己输入，可以直接点 `随机路径` 生成一条高随机度入口。
4. 如有需要，再开启 `站点伪装首页`，让没有命中真实入口的文档型请求展示公开企业首页。
5. 保存后同步更新书签或反向代理转发规则。
6. 保持 `/api`、`/ws` 和订阅公开地址继续可访问。
7. 已经发出去的订阅链接不会因为这个设置而变化。

#### 核对一次批量变更

1. 执行批量操作。
2. 打开 `Audit` 查看记录结果。
3. 回到仪表盘、用户列表或入站列表确认最终状态。

#### 更稳地运维系统

1. 在启用邮箱流程前先测试 SMTP。
2. 在敏感变更前先导出备份。
3. 如果要修改域名或对外入口，先完成 SMTP 连通测试，再使用网址变更通知。
4. 调整系统设置和运行模式时保持谨慎，尤其是接入数据库模式之后。

#### Telegram 通知使用方式

1. 打开 `Settings`。
2. 在 Telegram 配置区填入 Bot Token 和 Chat ID。
3. 先发送测试通知确认投递正常。
4. 启用后，Telegram 会接收结构化的系统通知、安全审计、到期提醒与周期运维汇总。
5. 在 Telegram 对话框里可以直接发送 `/help`，或手动输入 `/status` 等命令；Telegram 命令菜单可以保持关闭。

#### Review Harness（3x-ui v3 与 s-ui 本地仿真）

1. 在 `server/` 下依次执行 `npm run review:fake-panel`、`npm run review:seed` 与 `npm run review:server`（详见 [Review Harness](REVIEW_HARNESS.md)）。
2. `review_fake_panel.js` 完整支持 3x-ui v3 接口（`clients/list/paged`、`get/subId`、`get/tgId`、`clients/groups`、`hosts`、`sub-balancers`、`xray/outbound-subs`、`nodes`、`clients/hwids`、`setting/apiTokens`）以及旧版 3x-ui 与 s-ui 节点，可用于本地验证四层 RBAC 权限、面板功能页签与订阅流程。

### 为什么日常运维更轻松

- 一个界面覆盖节点、用户、订阅和系统控制
- 面向客户端的订阅链接可以直接复用，减少人工拼接
- 审计和任务记录让每次变更更容易解释、核对和回溯
- 能力探测、健康检查和诊断页缩短排障路径
- 双语界面更适合混合语言团队快速上手

### 使用建议

- 大批量改动前先确认当前节点范围是否正确
- 对外发送订阅前先检查 `SUB_PUBLIC_BASE_URL`
- 首页访问路径只影响后台与登录页入口，不替代 `SUB_PUBLIC_BASE_URL`
- 伪装首页只影响未命中真实入口的公开页面请求，不会改变 API、WebSocket 和订阅地址
- 调整服务器顺序或入站顺序会改变订阅内容里的节点排列，但不会改变已发出去的订阅网址
- 关键操作之后不要只看提示消息，优先去 `Audit` 再确认一次
- 面板默认配置了 `noindex, nofollow` 及 `robots.txt` 以阻止搜索引擎抓取和索引。请勿移除这些配置，以保障面板的安全性与隐私。
- 如果代理后界面看起来像缓存未刷新，先手动刷新，再检查缓存策略
