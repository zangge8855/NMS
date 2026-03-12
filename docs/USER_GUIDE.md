# User Guide

## English

### Who Uses NMS

- Admins: full access to servers, inbounds, users, subscriptions, audit, tools, and system settings
- End users: access limited to their own subscription experience

NMS is designed so admins can operate multiple nodes from one control plane, while end users only see the subscription actions that matter to them.

### Main Navigation

#### Dashboard

- Review node health, headline metrics, alerts, and operational summaries
- Use it as the first stop after login or after any major change

#### Servers

- Add, edit, and remove panel nodes
- Check connectivity, credentials, and onboarding status

#### Inbounds

- Inspect or update inbounds across connected nodes
- Useful for protocol changes, port edits, and traffic-policy maintenance

#### Users and Clients

- Manage user records, client identities, entitlement details, and conflict handling
- Use this area when provisioning, repairing, or cleaning up user state

#### Subscriptions

- Issue, rotate, and revoke subscription tokens
- Copy user-facing links for raw, native, Clash, Mihomo, and sing-box workflows

#### Capabilities, Tools, and Node Console

- Inspect protocol capability coverage
- Use node tools and console surfaces for diagnostics and operator workflows

#### Audit

- Review admin actions, subscription access history, and operational traces
- This is the best place to confirm what happened after a batch change

#### Settings

- Configure SMTP, security controls, backup actions, storage modes, and global system behavior
- Reserve this page for controlled admin changes

### Common Workflows

#### Onboard a new node

1. Open `Servers`.
2. Add the panel URL and credentials.
3. Verify connectivity and capability detection.
4. Return to the dashboard to confirm healthy status.

#### Create or govern a user

1. Open `Users` or `Clients`.
2. Create or edit the user profile, quota, expiry, and policy settings.
3. Check whether any client conflict or entitlement issue needs attention.

#### Issue a subscription

1. Open `Subscriptions`.
2. Choose the target account.
3. Issue a token or rotate an existing one.
4. Copy the generated subscription link and send it to the user.

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
- After critical changes, always check `Audit` instead of trusting the first success toast
- If the UI looks stale behind a proxy, refresh first and then inspect cache behavior

## 中文

### 谁会使用 NMS

- 管理员: 可以访问服务器、入站、用户、订阅、审计、工具和系统设置
- 普通用户: 只看到与自己订阅相关的使用入口

NMS 的设计重点是让管理员在一个后台里管理多个节点，而普通用户只接触真正需要的订阅动作，不被后台运维细节打扰。

### 主要导航

#### Dashboard

- 查看节点健康状态、关键统计、告警和运行摘要
- 登录后、批量变更后，建议先回到这里看全局状态

#### Servers

- 新增、编辑、删除面板节点
- 检查连通性、凭据和接入状态

#### Inbounds

- 跨节点查看和维护入站
- 适合处理协议调整、端口修改和流量策略维护

#### Users 与 Clients

- 管理用户资料、客户端身份、授权信息和冲突处理
- 新开通用户、修复状态或做清理时，主要会用到这里

#### Subscriptions

- 签发、轮换、撤销订阅令牌
- 复制适合原始链接、原生导入、Clash、Mihomo、sing-box 等场景的订阅地址

#### Capabilities、Tools 与 Node Console

- 查看节点协议能力覆盖情况
- 使用节点工具和控制台做诊断与运维操作

#### Audit

- 查看管理员操作、订阅访问历史和关键运行痕迹
- 批量变更之后，这里是确认结果的首选页面

#### Settings

- 配置 SMTP、安全控制、备份操作、存储模式和全局系统行为
- 建议只在受控变更窗口中由管理员使用

### 常见工作流

#### 接入一个新节点

1. 打开 `Servers`。
2. 填写面板地址和凭据。
3. 验证连通性和能力探测结果。
4. 回到仪表盘确认状态健康。

#### 创建或治理一个用户

1. 打开 `Users` 或 `Clients`。
2. 创建或编辑用户资料、配额、到期时间和策略设置。
3. 检查是否存在客户端冲突或授权异常需要处理。

#### 发放一个订阅链接

1. 打开 `Subscriptions`。
2. 选择目标账号。
3. 签发新 token 或轮换旧 token。
4. 复制生成的订阅链接并发送给用户。

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
- 关键操作之后不要只看提示消息，优先去 `Audit` 再确认一次
- 如果代理后界面看起来像缓存未刷新，先手动刷新，再检查缓存策略
