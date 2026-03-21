# NMS Feature And UI Audit

## 中文

审计日期：2026-03-21

### 已完成项

- Dropdown / Select / Popover 浮层统一使用显式背景、稳定层级和 `opacity` / `visibility` 过渡
- Sidebar 收起态 flyout 已迁移为不被滚动容器裁切的渲染方式
- Modal 已统一遮罩、动画、点击外部关闭与 `Esc` 关闭行为
- Card、Dropdown、Modal、Input、Button 的圆角、边框、阴影和 focus ring 已统一
- 表格滚动条、表头吸顶和空状态展示已统一
- Empty State 已抽成共享组件并接入核心页面
- `Logs` 页的加载空状态已从手写壳替换为共享 `EmptyState`，并统一到共享表单与圆角体系
- `Tasks` 页已移除孤立的 `tasks-table-shell` / `audit-tasks-table-shell`，回收到共享 `table-container`
- `Tools` 页空状态已补上明确的下一步动作按钮，避免停留在被动提示
- 邀请码注册链路已改为“注册即启用、后台自动开通订阅”，后台邀请码表也补上了可用次数与开通时长展示
- 仪表盘在线用户明细现在会同时显示用户名与邮箱，减少在用户识别时来回切页
- 系统设置已收敛成更紧凑的工作台，核心配置优先展示，系统状态独立成单独页签
- 用户详情里的订阅页签已与普通用户订阅中心对齐，不再维护两套明显不同的导入布局
- 审计中心、批量任务和订阅访问的筛选摘要已统一为紧凑控制条，减少大面积空白和重复状态卡
- 侧边栏去掉了重复的监控分组与底部单节点切换区，主导航整体更靠上，账号 / 退出入口更容易被看到
- 入站、服务器、用户等主要表格重新统一了对齐规则、紧凑列宽和 badge 语言
- Telegram 告警、状态摘要和帮助命令已经统一为结构化 HTML 消息，重点数值加粗，命令说明改成对齐表格
- 用户管理、用户详情、通知中心和仪表盘都补上了分阶段加载或共享缓存，后台首屏等待感明显下降
- 伪装首页的 `corporate` 模板已经重写为完整的工业自动化企业官网，包含导航栏、动画计数器、客户信任条、产品矩阵、应用场景、交付流程、联系信息、四列 Footer、ISO/CE 认证标识和 Cookie 横幅
- 普通用户新增独立的软件下载中心（Downloads）和自助账户中心（Account），与订阅页分离
- 审计日志写入改为持久化流（替代 `appendFileSync`），模式匹配改用内存环形缓冲，减少事件循环阻塞
- 任务队列增加容量上限（1000），超限时自动清理已完成任务
- 公开订阅端点增加独立轻量限流器，与管理 API 限流策略分离
- 搜索引擎与扫描器探测拦截中间件已加入请求处理链
- GitHub Actions CI/CD 工作流已配置：CI 自动测试，Docker 工作流自动构建并推送镜像到 GHCR

### 当前状态良好区域

- Layout、Sidebar、Header 的信息层级明显优于旧版
- 监控、节点管理、订阅和审计主路径可连续操作
- 明暗模式下的浮层稳定性明显提升
- 关键操作的 hover / active / focus 反馈已可接受
- Logs、Tasks、Tools 这类次级运维页面也开始跟随同一套卡片、表格和空状态规范
- 审计、系统设置、用户详情和订阅中心的页面长度已经明显缩短，信息密度更接近真正的运维工作台
- Telegram 输出已经更接近正式值班摘要，而不是原始日志片段堆叠

### 仍建议继续优化的区域

- 各业务页仍有少量零散的列表容器样式，后续应继续收敛到统一表格外壳
- 非核心页面的 Empty State 仍可继续替换为共享组件
- 一些业务文案仍偏工程化，后续可以优化为更面向运维人员的提示
- 更细粒度的键盘导航和无障碍提示仍有提升空间
- 仍可继续把旧页面中的残留副标题、说明段和非必要提示卡向更紧凑的控制行收敛
- 可以继续为 Telegram 做更统一的标题命名和不同级别事件的词汇规范

### 风险点

- 历史样式覆盖较多时，后续新增页面可能重新引入局部不一致
- 如果新增第三方浮层组件，必须遵守现有的 portal、层级与过渡规则
- 如果在低性能设备上重新启用重度模糊效果，闪烁问题可能复发

### 结论

当前版本已经完成本轮最重要的后台 UI 稳定性修复，可以作为后续页面统一重构的基线。下一阶段重点应从“修 bug”转向“收敛样式与组件复用”。

## English

Audit date: 2026-03-21

### Completed

- Dropdown, select, and popover layers now use explicit surfaces, stable z-order, and `opacity` / `visibility` transitions
- Collapsed sidebar flyouts no longer get clipped by scroll containers
- Modals now share overlay blur, motion, click-outside close, and `Esc` close behavior
- Cards, dropdowns, modals, inputs, and buttons now share radius, border, shadow, and focus-ring rules
- Table scrollbars, sticky headers, and empty states are standardized
- Empty states are now backed by a shared component in core pages
- The `Logs` page now uses the shared `EmptyState` for loading/empty states and follows the shared form and radius rules
- The `Tasks` page has dropped isolated `tasks-table-shell` / `audit-tasks-table-shell` wrappers and converged on the shared `table-container`
- The `Tools` page now exposes explicit next-step actions in empty states instead of passive copy only
- Invite-code registration now activates the account immediately and auto-provisions a subscription, while the settings table also exposes both usage limits and granted duration
- Dashboard online-user detail now shows username and email together, making account identification faster during operations
- The login page now exposes self-service password reset by email code, while the public response stays generic so the flow does not reveal whether an email is registered
- The subscription page now centers the user flow around “choose profile -> copy address -> import client”, keeps the QR code beside the address, and switches quick-import actions with the selected profile
- The end-user subscription page now keeps quick import, copy, QR code, and reset actions inside one primary import block, while device cards only show downloads and recommended profile types
- Native select styling is now finalized through one last-pass surface rule, so Chromium no longer flashes a black native popup before the themed menu settles
- Server and inbound tables were tightened again so sidebar-expanded layouts keep more operational information visible before horizontal scrolling is needed
- System settings now behave more like a compact workbench, keeping core controls first and moving system status into its own tab
- The user-detail subscription tab now mirrors the end-user subscription center instead of maintaining a clearly separate admin layout
- Audit tabs, task views, and subscription-access filters now use compact summary rows instead of large redundant status cards
- The sidebar no longer carries a duplicated monitor group or bottom single-node switcher, and account / sign-out actions sit closer to the main navigation
- Telegram digests, alerts, and help output now share one structured HTML message system with bold key values and aligned command tables
- Dashboard, Users, User Detail, and Notification Center now use staged loading and shared cache paths to reduce first-open waiting time
- The corporate camouflage template has been rewritten into a full industrial automation company homepage with navigation, animated counters, trust bar, product matrix, application scenarios, delivery steps, contact section, four-column footer, ISO/CE certification badges, and a cookie consent banner
- End users now have a dedicated Downloads center and self-service Account center, separated from the Subscriptions page
- Audit log writing switched to a persistent write stream (replacing `appendFileSync`) with an in-memory ring buffer for pattern matching, reducing event-loop blocking
- Task queue now enforces a capacity cap (1000) with automatic pruning of completed tasks on overflow
- Public subscription endpoints now have a dedicated lightweight rate limiter, separated from the admin API rate limiter
- Search bot and scanner protection middleware has been added to the request pipeline
- GitHub Actions CI/CD workflows are now configured: CI auto-tests on push/PR, Docker workflow auto-builds and pushes images to GHCR

### Areas in good shape

- Layout, Sidebar, and Header now have clearer hierarchy than the previous baseline
- The main operating paths across monitoring, server management, subscriptions, and audit are stable
- Floating panel behavior in both light and dark themes is much more consistent
- Hover, active, and focus feedback is now acceptable for core actions
- Secondary operator pages such as Logs, Tasks, and Tools are now aligning with the same card, table, and empty-state system
- The user-facing subscription page is now more focused and easier to explain to non-technical users

### Recommended follow-up areas

- Some feature pages still use isolated list container styles and should converge on a shared table shell
- More non-core pages can still migrate to the shared `EmptyState`
- Some operational copy is still too engineering-oriented and can be improved for operators
- Keyboard navigation depth and accessibility hints still have room to improve
- A few older pages still rely on style inheritance instead of explicitly attaching the shared form/control classes, so future refactors should keep tightening that contract
- Full i18n coverage still needs continued cleanup in a few older admin pages outside the main login / subscription / user-detail path
- Telegram wording can still be tuned further so different event classes read even more consistently in day-to-day on-call use

### Risk points

- If future pages add ad hoc overrides, style drift can return
- Any newly introduced overlay library must follow the existing portal, z-index, and transition rules
- Reintroducing heavy blur on low-performance devices can bring flicker back

### Conclusion

The current build resolves the most important admin UI stability issues and is a valid baseline for broader page unification. The next phase should shift from bug fixing to style convergence and component reuse.
