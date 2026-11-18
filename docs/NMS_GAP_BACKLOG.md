# NMS Gap Backlog

## 中文

### 已完成

- 2026-11-18: 完成四层 RBAC 角色与权限治理（`admin`、`operator`、`auditor`、`user` 路由与代理边界及运营/只读界面门控）、通知中心严重级别筛选（`critical`/`warning`/`info`）与未读过滤及上下文跳转、仪表盘卡片按用户 `localStorage` 定制与 UTF-8 BOM CSV 快照导出、完整 3x-ui v3.11 面板能力对齐（Panel API Tokens、Panel Features 分页客户端目录与 SubID/TG ID 精确查询、客户端分组、Hosts、均衡器、出站订阅、多节点与 HWID 设备）、全栈安全与存储弹性加固（受控 Cloudflare/XFF IP 解析、AES-256-GCM 凭据/证书/订阅 Token/系统设置统一密钥轮换与加密备份、单次 WebSocket Ticket、SQLite/PostgreSQL 队列与重试修复、SS-2022/Clash/Surge/sing-box/TUIC/Hysteria2 同步修正、动态端口 E2E 与 v3 Review Harness），以及 Wave 3 UI/CSS 与 ES2023 现代化改造（`modern-web-guidance` 0 项遗留告警、WAI-ARIA Roving Tabs 与 Forced-Colors 安全指示条、键盘可滚动表头吸顶表格、移动端 `viewport-fit=cover` 与安全区适配）。
- 2026-05-24: 实现了用户流量趋势查询的服务器与入站节点细分（breakdown）统计、完成审计中心（Audit Center）与 Xray 控制台界面的响应式与高级视觉体验升级，并彻底清理了本地测试临时数据和运行日志。
- 2026-05-06: 补齐集中浏览器安全响应头、订阅公开 URL 与敏感查询参数日志脱敏、可配置 `TRUST_PROXY`、Docker 非 root 运行、数据库一致性校验 CLI、移动端 Toast/底部导航调整、图表懒加载，以及部署/数据库文档更新。

### P0

- 完整梳理剩余页面的表格外壳与空状态，消除最后一批零散样式（2026-05-05 已补一层跨页面布局兜底，后续继续向共享组件迁移）
- 为 Sidebar、Modal、Dropdown 再补一轮端到端交互回归
- 公开伪装首页持续保持内容隔离，新增模板或资源时必须通过敏感业务词断言

### P1

- 抽象更多共享列表工具栏、过滤器和分页容器
- 为审计、订阅和节点页面补充更清晰的状态文案与错误提示
- 持续扩展其余页面与弹窗的键盘导航和 aria 无障碍覆盖（标签页 Roving Tabs 与表格滚屏区域已完成）

### P2

- 既定 P2 项（四层细粒度 RBAC 权限模型、通知中心告警分级与筛选跳转、可配置仪表盘卡片与快照导出）均已交付并移入「已完成」

### 技术债

- 继续减少页面级样式覆盖，优先回收到共享组件与样式层
- 数据存储层继续保持 route / service / repository 边界清晰
- 完善 Docker、PM2 和数据库切换/回滚演练下的自动化验证

## English

### Completed

- 2026-11-18: Delivered 4-tier RBAC roles and boundary enforcement (`admin`, `operator`, `auditor`, `user` backend route/proxy guards and UI/nav gating), notification center severity grading/filtering (`critical`/`warning`/`info`) with unread filter and context jump, per-user `localStorage` dashboard card customization and UTF-8 BOM CSV snapshot export, full 3x-ui v3.11 alignment (Panel API Tokens, Panel Features paged Client Directory with SubID/TG ID exact lookup, client groups, hosts, sub-balancers, outbound subs, panel nodes, and HWID devices), Wave 2 full-stack security & storage resilience (gated Cloudflare/XFF IP resolution, unified secret rotation across server/settings/certificates/subscription tokens, AES-256-GCM encrypted backups, single-use WS tickets, SQLite/PostgreSQL pool & snapshot queue fixes, SS-2022/Clash/Surge/sing-box/TUIC/Hysteria2 protocol alignment, and dynamic-port E2E/v3 review harness), and Wave 3 UI/CSS & ES2023 modernization (0 `modern-web-guidance` legacy-scan findings, Forced-Colors-safe WAI-ARIA roving tabs, keyboard-scrollable sticky-header tables, and mobile `viewport-fit=cover` + safe-area adaptation).
- 2026-05-24: Implemented user traffic trends breakdown queries aggregated by server and inbound connection, upgraded responsive layout and design for the Audit Center and Xray Console workspaces, and performed privacy sanitization on local storage.
- 2026-05-06: Added centralized browser security headers, public subscription URL and sensitive query redaction in request logs, configurable `TRUST_PROXY`, non-root Docker runtime, database consistency CLI, mobile toast/bottom-nav adjustments, lazy chart loading, and deployment/database documentation updates.

### P0

- Finish converging remaining table shells and empty states across less-polished pages (a cross-page layout guardrail was added on 2026-05-05; future work should keep migrating toward shared components)
- Add another round of end-to-end interaction regression for Sidebar, Modal, and Dropdown behavior
- Keep public camouflage content isolated; any new template or asset path must pass the sensitive product-language assertions

### P1

- Extract more shared list toolbars, filters, and pagination shells
- Improve status copy and error messaging in audit, subscription, and server pages
- Continue expanding keyboard navigation and aria coverage across remaining modals and views (roving tablists and keyboard-scrollable table regions completed)

### P2

- Previously planned P2 items (4-tier fine-grained RBAC model, notification severity grading & filtering, and configurable dashboard cards & snapshot export) are completed and moved to Completed

### Technical debt

- Continue reducing page-level style overrides in favor of shared components and style layers
- Keep route / service / repository boundaries explicit in the data layer
- Improve automated validation across Docker, PM2, and database cutover/rollback rehearsals
