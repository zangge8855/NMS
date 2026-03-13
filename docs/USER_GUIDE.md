# User Guide

## English

### Who Uses NMS

- Admins: full access to servers, inbounds, users, subscriptions, audit, tools, and system settings
- End users: access limited to their own subscription experience

NMS is designed so admins can operate multiple nodes from one control plane, while end users only see the subscription actions that matter to them.

### Main Navigation

#### Dashboard

- Review node health, headline metrics, alerts, quick actions, and operational summaries
- Use it as the first stop after login or after any major change
- Online-user detail now shows username and email together, so operators can identify the account without opening `Users`

#### Servers

- Add, edit, and remove panel nodes
- Check connectivity, credentials, and onboarding status

#### Inbounds

- Inspect or update inbounds across connected nodes
- Useful for protocol changes, port edits, and traffic-policy maintenance
- Saved inbound order also controls the node order that end users receive from subscription refreshes
- Expanded inbound user tables now compress traffic and action columns more aggressively so sidebar-open layouts need less horizontal scrolling

#### Users

- Manage user records, subscription details, activity logs, entitlement details, and conflict handling
- Use this area when provisioning, repairing, resetting subscription links, or cleaning up user state as an admin

#### Subscriptions

- This page is primarily for end users
- Use it for self-service subscription links, client import, and password changes
- Admins normally enter subscription details from `Users`
- The primary import area now keeps quick import, copy address, QR code, and reset link together
- The device section now only shows download links and recommended profile types, so the page stays simple for non-technical users

#### Capabilities and Tools

- Inspect protocol capability coverage
- Use node tools for protocol-side diagnostics
- Open the node console from `Settings -> Node Console` when you need server maintenance or cluster-side operations

#### Audit

- Review admin actions, subscription access history, and operational traces
- This is the best place to confirm what happened after a batch change

#### Settings

- Configure the site access path, random hidden entry generation, optional camouflage landing page, SMTP, security controls, backup actions, storage modes, monitoring, and global system behavior
- Turn invite-only registration on or off, and batch-generate invite codes with usage limits and subscription duration
- Use the embedded `Node Console` tab for cluster maintenance without leaving the system workbench
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
4. Optionally turn on the camouflage landing page so non-matching document requests show a public-facing corporate homepage instead of the real UI.
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
3. Use system settings and runtime modes deliberately, especially when DB mode is involved.

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
- If the UI looks stale behind a proxy, refresh first and then inspect cache behavior

## 中文

### 谁会使用 NMS

- 管理员: 可以访问服务器、入站、用户、订阅、审计、工具和系统设置
- 普通用户: 只看到与自己订阅相关的使用入口

NMS 的设计重点是让管理员在一个后台里管理多个节点，而普通用户只接触真正需要的订阅动作，不被后台运维细节打扰。

### 主要导航

#### Dashboard

- 查看节点健康状态、关键统计、告警、快捷入口和运行摘要
- 登录后、批量变更后，建议先回到这里看全局状态
- 在线用户明细会同时显示用户名和邮箱，方便直接识别账号，不必再切去用户管理

#### Servers

- 新增、编辑、删除面板节点
- 检查连通性、凭据和接入状态

#### Inbounds

- 跨节点查看和维护入站
- 适合处理协议调整、端口修改和流量策略维护
- 保存后的入站顺序也会影响普通用户刷新订阅时拿到的节点顺序
- 展开用户列表后会优先压缩统计列和操作区，减少在侧边栏展开状态下还要横向拖动的情况

#### Users

- 管理用户资料、订阅信息、活动日志、授权信息和冲突处理
- 管理员新开通用户、修复状态、重置订阅链接或做清理时，主要会用到这里

#### Subscriptions

- 这个页面主要面向普通用户
- 用来查看自助订阅链接、快捷导入、扫码导入和修改密码
- 管理员通常从 `Users` 里的用户详情进入订阅信息
- 用户页的核心说明只有三步: `选类型 -> 复制地址 -> 导入客户端`
- 快捷导入、复制地址、二维码和重置链接会集中显示在同一个主导入区
- 设备区只保留下载链接和推荐类型，避免给普通用户重复解释导入方式

#### Capabilities 与 Tools

- 查看节点协议能力覆盖情况
- 使用节点工具做协议侧诊断
- 需要节点维护或集群操作时，从 `系统设置 -> 节点控制台` 进入

#### Audit

- 查看管理员操作、订阅访问历史和关键运行痕迹
- 批量变更之后，这里是确认结果的首选页面

#### Settings

- 配置真实入口路径、随机入口生成、可选伪装首页、SMTP、安全控制、备份操作、存储模式、监控诊断和全局系统行为
- 开关邀请制注册，并批量生成带使用次数和开通时长限制的邀请码
- 通过内嵌的 `节点控制台` 页签完成集群维护，不用再切到单独页面
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
3. 调整系统设置和运行模式时保持谨慎，尤其是接入数据库模式之后。

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
- 如果代理后界面看起来像缓存未刷新，先手动刷新，再检查缓存策略
