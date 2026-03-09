# NMS 功能/UI 缺口与迭代 Backlog

> 更新时间：2026-03-09  
> 适用环境：当前开发环境（隐私优先）

## 已完成（当前阶段）

- [x] 订阅中心已挂载到 `/subscriptions`
- [x] `user` 角色收敛为仅可访问自身订阅中心
- [x] 外部订阅转换器依赖已移除
- [x] Clash / Mihomo 改为内置 YAML 输出，并使用 `MetaCubeX meta-rules-dat` `mrs` 规则源
- [x] 审计中心“订阅访问”支持真实 IP / 代理 IP 展示
- [x] Cloudflare 场景下优先记录真实访客 IP
- [x] 审计中心日志页改为统一 3x-ui 日志入口，并对节点能力做兼容处理
- [x] 用户策略支持 `limitIp`、`trafficLimitBytes`、可访问节点和协议限制
- [x] 入站里的用户支持“单独限定”并可恢复跟随统一策略
- [x] 系统设置新增 SMTP 诊断
- [x] 系统设置新增系统备份导出
- [x] 系统设置新增节点健康巡检状态和“立即巡检”
- [x] DB 回填已支持任务化执行、进度查看和取消
- [x] DB 写入失败已接入告警与通知
- [x] 后端已整理为 `route -> service -> repository / panel gateway`

## P0（当前无阻塞缺口）

- [ ] 无

## P1（下一批最值得做）

- [ ] 订阅中心补齐 token 生命周期管理 UI（签发、撤销、到期时间、用途标注）
- [ ] 补齐“订阅中心”到“用户管理”的双向跳转（按 email 联动）
- [ ] 为系统备份补恢复/导入工作流，目前仅支持导出
- [ ] 为 `auth / subscriptions / provision-subscription` 增加更多 route 级集成测试
- [ ] 准备带真实 inbound/client 的测试节点，补齐开通订阅到节点下发的实机闭环

## P2（体验与运营增强）

- [ ] 挂载集群向导页面：`/cluster`
- [ ] 为集群向导补齐模板库（保存/复用入站模板）
- [ ] 流量页增加按 `server/group/environment` 的组合筛选
- [ ] 审计中心增加“字段差异视图”
- [ ] 服务器管理增加“批量标签编辑”与“分组批量迁移”

## 明确保守处理的边界

- Telegram Bot 的 `Token / Chat ID / Notification Time` 仍在 3x-ui 面板中配置，NMS 当前只负责触发 Telegram 备份
- 未文档化的 3x-ui 私有设置暂不通过 NMS 直接写入
- 3x-ui 日志能力受节点版本影响，NMS 只做能力探测和兼容 fallback

## 隐私与开发环境约束

- DB 回填默认使用 `dry-run + redact`
- 开发环境禁止接入生产数据库
- 敏感字段（`token/password/secret/cookie`）保持脱敏
- 审计和流量快照继续采用匿名化字段，如哈希化的 `email/ip/userAgent`

---

# NMS Gaps / UI Backlog

> Updated: 2026-03-09
> 
> Target environment: current development setup, privacy-first

## Completed in the Current Phase

- [x] Subscription Center is mounted at `/subscriptions`
- [x] The `user` role is reduced to self-only Subscription Center access
- [x] External subscription converter dependency has been removed
- [x] Clash / Mihomo now use built-in YAML output with `MetaCubeX meta-rules-dat` `mrs` providers
- [x] Subscription access audit now shows real IP and proxy IP
- [x] Real visitor IP is preferred under Cloudflare
- [x] Audit log view now uses a unified 3x-ui log entry with node capability fallback
- [x] User policy supports `limitIp`, `trafficLimitBytes`, and accessible server/protocol scope
- [x] Users inside inbounds can use per-client entitlement override and return to follow policy
- [x] System Settings now expose SMTP diagnostics
- [x] System Settings now expose system backup export
- [x] System Settings now expose node health monitor status and manual run
- [x] DB backfill is task-based with progress tracking and cancellation
- [x] DB write failures now generate alerts and notifications
- [x] The backend has been reorganized into `route -> service -> repository / panel gateway`

## P0

- [ ] None at the current stage

## P1

- [ ] Add token lifecycle management UI to Subscription Center, including issue, revoke, expiry, and purpose label
- [ ] Add two-way navigation between Subscription Center and User Management by email
- [ ] Add restore/import workflow for system backups, since the current phase only exports backup archives
- [ ] Add more route-level integration tests for `auth`, `subscriptions`, and provisioning flows
- [ ] Prepare a real node with inbound/client fixtures to complete end-to-end live-node validation

## P2

- [ ] Mount the Cluster Wizard page at `/cluster`
- [ ] Add reusable inbound templates to Cluster Wizard
- [ ] Add combined filters by `server/group/environment` on traffic pages
- [ ] Add a field diff view to Audit Center
- [ ] Add batch tag editing and group migration to Server Management

## Deliberately Conservative Boundaries

- Telegram Bot `Token / Chat ID / Notification Time` still belong to the 3x-ui panel; NMS currently only triggers Telegram backup
- Undocumented private 3x-ui settings are not written by NMS
- 3x-ui log capability still depends on node version; NMS only detects support and performs graceful fallback

## Privacy and Development Constraints

- DB backfill should default to `dry-run + redact`
- Development environments must not connect to production databases
- Sensitive fields such as `token/password/secret/cookie` must remain redacted
- Audit and traffic snapshots should continue to use anonymized fields such as hashed `email/ip/userAgent`
