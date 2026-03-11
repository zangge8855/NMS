# User Guide

## 中文

### 角色说明

- 管理员：可访问全部页面、节点接入、系统设置、审计、用户和订阅管理
- 普通用户：仅访问与自己相关的订阅页面

### 登录

1. 打开系统入口
2. 输入管理员或用户账号
3. 完成登录后进入默认首页

如果生产环境启用了更严格的安全策略，弱口令或默认账号不会被允许继续使用。

### 主要页面

#### Dashboard

- 查看节点健康状态、关键统计和异常提示
- 当某个模块暂无数据时，会展示统一的 Empty State

#### Servers

- 新增、编辑、删除面板节点
- 查看节点协议能力与基础状态
- 节点接入失败时，先检查地址、凭据和网络连通性

#### Inbounds

- 查看或维护各节点上的入站
- 适合排查协议、端口、流量限制等配置

#### Clients

- 管理用户、客户端和授权关系
- 可在此进行单用户排障、策略调整和冲突扫描

#### Subscriptions

- 生成和管理订阅令牌
- 复制原始订阅链接，或在配置了转换器后生成 Clash / sing-box 专用链接

#### Audit

- 查看审计事件、操作历史和部分安全相关记录
- 批量操作后优先到这里确认结果

#### Settings

- 配置系统参数、SMTP、注册行为与其他全局设置
- 只建议管理员在变更窗口内操作

### 推荐日常流程

#### 新接入节点

1. 在 Servers 中添加节点
2. 验证连接与能力探测结果
3. 到 Dashboard 观察健康状态

#### 为用户开通订阅

1. 在 Clients 中确认用户信息
2. 在 Subscriptions 中生成订阅令牌
3. 将订阅链接发送给目标用户

#### 批量变更后复核

1. 执行变更
2. 打开 Audit 页面确认任务记录
3. 返回 Dashboard 或相关列表检查最终状态

### 使用建议

- 大量操作前先确认当前选中的节点上下文
- 复制订阅链接前先检查 `SUB_PUBLIC_BASE_URL` 是否配置正确
- 如果弹窗、下拉或侧边导航表现异常，优先刷新页面并检查代理缓存

## English

### Roles

- Admin: full access to servers, settings, audit, user management, and subscriptions
- End user: access limited to personal subscription pages

### Sign-in

1. Open the application entry point
2. Enter admin or user credentials
3. After sign-in, the default landing page opens

If stricter production security is enabled, weak passwords and unsafe default usernames are rejected.

### Main pages

#### Dashboard

- Review server health, key metrics, and warning states
- When a module has no data, the shared empty state is shown

#### Servers

- Add, edit, and remove panel nodes
- Review server capabilities and baseline health
- If onboarding fails, check the URL, credentials, and network reachability first

#### Inbounds

- Inspect or maintain node inbounds
- Useful for protocol, port, and traffic-limit troubleshooting

#### Clients

- Manage users, clients, and entitlements
- Useful for per-user troubleshooting, policy adjustments, and conflict scans

#### Subscriptions

- Create and manage subscription tokens
- Copy raw subscription URLs or, when configured, Clash / sing-box links

#### Audit

- Review audit events, change history, and security-relevant actions
- After bulk changes, this is the first page to verify outcomes

#### Settings

- Configure system behavior, SMTP, registration, and other global settings
- Keep this page limited to controlled admin changes

### Recommended daily flows

#### Onboard a new node

1. Add the server in Servers
2. Verify connectivity and detected capabilities
3. Check Dashboard for healthy status

#### Issue a subscription

1. Confirm user details in Clients
2. Generate a subscription token in Subscriptions
3. Send the resulting link to the user

#### Verify after a batch change

1. Execute the change
2. Open Audit to inspect the recorded job
3. Return to Dashboard or the relevant list for final state validation

### Usage tips

- Confirm the active server context before high-volume operations
- Before sharing links, verify that `SUB_PUBLIC_BASE_URL` is set correctly
- If modal, dropdown, or sidebar behavior looks wrong, refresh first and then inspect proxy caching
