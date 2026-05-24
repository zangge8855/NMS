# NMS Gap Backlog

## 中文

### 已完成

- 2026-05-24: 实现了用户流量趋势查询的服务器与入站节点细分（breakdown）统计、完成审计中心（Audit Center）与 Xray 控制台界面的响应式与高级视觉体验升级，并彻底清理了本地测试临时数据和运行日志。
- 2026-05-06: 补齐集中浏览器安全响应头、订阅公开 URL 与敏感查询参数日志脱敏、可配置 `TRUST_PROXY`、Docker 非 root 运行、数据库一致性校验 CLI、移动端 Toast/底部导航调整、图表懒加载，以及部署/数据库文档更新。

### P0

- 完整梳理剩余页面的表格外壳与空状态，消除最后一批零散样式（2026-05-05 已补一层跨页面布局兜底，后续继续向共享组件迁移）
- 为 Sidebar、Modal、Dropdown 再补一轮端到端交互回归
- 公开伪装首页持续保持内容隔离，新增模板或资源时必须通过敏感业务词断言

### P1

- 抽象更多共享列表工具栏、过滤器和分页容器
- 为审计、订阅和节点页面补充更清晰的状态文案与错误提示
- 增加更多无障碍支持，包括键盘导航顺序和 aria 标注

### P2

- 增加细粒度角色与权限模型
- 引入更完整的通知中心和告警分级策略
- 提供更多可配置的仪表盘卡片与报表导出能力

### 技术债

- 继续减少页面级样式覆盖，优先回收到共享组件与样式层
- 数据存储层继续保持 route / service / repository 边界清晰
- 完善 Docker、PM2 和数据库切换/回滚演练下的自动化验证

## English

### Completed

- 2026-05-24: Implemented user traffic trends breakdown queries aggregated by server and inbound connection, upgraded responsive layout and design for the Audit Center and Xray Console workspaces, and performed privacy sanitization on local storage.
- 2026-05-06: Added centralized browser security headers, public subscription URL and sensitive query redaction in request logs, configurable `TRUST_PROXY`, non-root Docker runtime, database consistency CLI, mobile toast/bottom-nav adjustments, lazy chart loading, and deployment/database documentation updates.

### P0

- Finish converging remaining table shells and empty states across less-polished pages (a cross-page layout guardrail was added on 2026-05-05; future work should keep migrating toward shared components)
- Add another round of end-to-end interaction regression for Sidebar, Modal, and Dropdown behavior
- Keep public camouflage content isolated; any new template or asset path must pass the sensitive product-language assertions

### P1

- Extract more shared list toolbars, filters, and pagination shells
- Improve status copy and error messaging in audit, subscription, and server pages
- Add broader accessibility coverage, including keyboard flow and aria labeling

### P2

- Introduce finer-grained roles and permissions
- Expand the notification center and alert severity handling
- Add more configurable dashboard cards and exportable reports

### Technical debt

- Continue reducing page-level style overrides in favor of shared components and style layers
- Keep route / service / repository boundaries explicit in the data layer
- Improve automated validation across Docker, PM2, and database cutover/rollback rehearsals
