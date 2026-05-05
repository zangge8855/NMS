# NMS Feature And UI Audit

## 中文

审计日期：2026-04-28
最近复核：2026-05-05，全页面排版复核、公开伪装首页重装、站内共用布局兜底收敛

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
- 伪装首页三套模板已重装为城市生活杂志方向：`corporate` 为城市周刊，`blog` 为影像笔记，`nginx` 为周末指南；公开文案、标题、资源路径和 404 内容均与站内运维、订阅、节点、审计等业务语义脱钩
- 站内页面新增一层全局排版兜底：统一页面最大宽度、工具栏换行、表格首尾留白、设置页入口区栅格和移动端底部导航避让
- 普通用户新增自助账户中心（Account），用户侧导航收敛为订阅中心与账户，订阅页不再混入软件下载 / 客户端下载入口
- 普通用户订阅页已重新收敛为单列导入工作台：状态摘要、配置文件切换、地址复制、一键导入、二维码和重置风险提示集中在首屏，避免右侧空概览列、大面积空白和无关下载内容
- 伪装站旧技术品牌名（例如 `Edge Precision Systems`）已加入服务端渲染与系统设置归一化迁移，公开页会回落到城市杂志默认标题，避免残留系统/技术语义
- 审计日志写入改为持久化流（替代 `appendFileSync`），模式匹配改用内存环形缓冲，减少事件循环阻塞
- 任务队列增加容量上限（1000），超限时自动清理已完成任务
- 公开订阅端点增加独立轻量限流器，与管理 API 限流策略分离
- 搜索引擎与扫描器探测拦截中间件已加入请求处理链
- GitHub Actions CI/CD 工作流已配置：CI 自动测试，Docker 工作流自动构建并推送镜像到 GHCR
- 顶部搜索已升级为全局命令入口，支持页面、用户、节点跳转，以及刷新当前页、添加账号、添加服务器等常用动作
- 登录后的后台外壳改为轻量 bootstrap，审计、设置、任务和遥测等重数据由页面按需加载，减少首屏阻塞
- 用户创建/编辑弹窗里的密码操作收敛成可访问的图标按钮，窄屏下不再因为“生成”等文字挤压布局
- 登录页背景光效改为纯装饰层，移动端不会再拦截“忘记密码”等表单按钮点击
- 系统设置工作区导航在移动端改为横向胶囊分段，`入口与订阅`、`策略与审计` 等长标签不再被压成竖排文字
- 首次部署安全向导在小屏下改为弹窗内滚动，并让底部操作区保持可触达，避免首次部署时无法点击解锁按钮
- 系统设置桌面端已完成专项排版收敛：移除工作区内第二侧栏，改为顶部横向导航；隐藏重复说明区；访问控制、运行维护、备份等面板按内容自然高度排列，减少左右空白和卡片错位
- 系统设置移动端已复核为横向标签导航 + 单列内容流，避免窄屏下标题、开关卡片和保存区互相挤压
- 审计中心已补齐事件与订阅访问的日期、操作者、目标用户、Token、真实 IP、节点等筛选条件，列表、摘要和 CSV 导出现在使用同一套筛选语义
- 审计中心桌面端已收敛为更紧凑的工作台：页签、筛选区、状态摘要、表格和流量分析区域统一列宽与间距，侧边栏展开或收起时都保持清晰对齐
- 审计中心移动端已复核为横向页签 + 单列筛选流 + 全宽操作按钮，避免小屏下按钮、日期输入和表格摘要互相挤压
- 普通用户外壳现在不会加载管理员专用的服务器上下文、系统通知接口或通知铃铛，避免用户端页面出现无意义请求和顶部操作噪音
- 用户详情页标题允许在窄屏下自然换行，服务器表格账号列和操作列重新校准，暗色收起侧边栏状态下不再出现账号字符竖排
- 审计中心流量图表已统一移动端边距和紧凑 Y 轴刻度，保留 tooltip 的完整字节展示，同时避免窄屏坐标轴单位换行
- 顶部手动主题切换按钮已移除，主题跟随系统偏好；头部搜索、语言和通知区在桌面保持同一行，小屏搜索回到第二行但保持可见
- 登录页已按 1366x768、1280x720、1024x768、390x844 等视口重新压缩间距，登录按钮和“忘记密码”入口在低高度桌面也保持可见
- 后台按钮与强调色收敛为专业蓝 / 青主色体系，按钮 hover、focus、危险操作和浅色主题对比重新校准
- 仪表盘、审计、订阅、设置等状态卡网格在侧边栏展开 / 折叠下强制同列等高，避免卡片高低不一
- 服务器管理在 1500px 以下切换为列表卡片，避免常见笔记本宽度下表格列挤压；PC / 平板 / 手机端的详情、测试连接、编辑、删除按钮均保持等宽可见
- 系统设置再次压缩工作区导航、面板、开关卡片和状态面板间距，状态 / 策略页在宽屏恢复双列，减少大面积空白
- 文件存储持久化增加启动预检：生产环境 `DATA_DIR` 指向 `/tmp` 或 `/var/tmp` 会给出易失存储警告；Docker 镜像声明 `/app/data`、`/app/logs` 运行时卷

### 当前状态良好区域

- Layout、Sidebar、Header 的信息层级明显优于旧版
- 监控、节点管理、订阅和审计主路径可连续操作
- 明暗模式下的浮层稳定性明显提升
- 关键操作的 hover / active / focus 反馈已可接受
- Logs、Tasks、Tools 这类次级运维页面也开始跟随同一套卡片、表格和空状态规范
- 审计、系统设置、用户详情和订阅中心的页面长度已经明显缩短，信息密度更接近真正的运维工作台
- 普通用户订阅页现在以导入行为为中心，桌面端不再因右侧弱信息区造成视觉重心偏移
- Telegram 输出已经更接近正式值班摘要，而不是原始日志片段堆叠
- 系统设置现在更接近单一工作台布局，桌面端横向导航、内容列宽和保存区域的视觉节奏更稳定

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

### 2026-05-04 系统设置专项结论

本次复核覆盖系统设置的状态、入口与订阅、策略与审计、运行维护、备份五个工作区，并分别检查桌面亮色、桌面暗色和移动端布局。主要问题集中在工作区内二级侧栏占宽、说明区重复、面板被强制等高导致留白过多、运行维护开关卡片文字换行不稳定。当前样式已调整为单工作台结构，导航横置，卡片按内容自然高度排列，桌面和移动端均已通过生产构建与 Playwright 截图复核。

### 2026-05-04 全页面排版复核结论

本次全页面复核覆盖管理员端 19 个桌面页面的亮色、暗色、侧边栏展开和侧边栏收起状态，共 76 张桌面截图；同时覆盖管理员端和普通用户端主要移动页面的亮色、暗色状态，共 44 张移动截图。自动指标未发现横向溢出、明显错位、异常大空白或控件文本挤压。人工抽样确认了仪表盘、系统设置、审计中心、服务器详情、入站列表和普通用户订阅页，当前主要页面排版已经可以作为继续收敛共享组件的稳定基线。

### 2026-05-05 全页面排版复核结论

本次复核覆盖管理员端 22 个路由在桌面亮色、桌面暗色、侧边栏展开和侧边栏收起下的组合，以及管理员端和普通用户端移动 / 桌面主要页面，共 144 个页面状态、224 张截图。自动指标未发现横向溢出、明显错位、控件文本截断或过小文字按钮。人工抽样确认了暗色收起侧边栏下的服务器表格、移动端审计流量图表、系统设置移动暗色页和普通用户桌面订阅页；当前主页面在明暗主题、桌面侧边栏展开 / 收起、移动端底部导航下均保持可读和对齐。

### 2026-05-05 公开首页与站内布局补强

本次实现将公开伪装页从旧的技术/工业站点语义改为完全无关的城市生活杂志。三套模板使用城市街景、咖啡、展览、建筑和周末路线内容，默认标题改为 `City Field Notes`，设置页模板展示名改为“城市周刊 / 周末指南 / 影像笔记”。服务端测试增加敏感业务词断言，确保公开 HTML 不出现 NMS、subscription、node、server、panel、audit、proxy、token、admin、订阅、节点、面板、审计、后台、运维等站内语义。

站内部分新增跨页面布局兜底，覆盖 Dashboard、Users、Audit、Settings、Servers、Inbounds、Logs、Tools、Capabilities、Subscriptions、Account 等页面的容器宽度、工具栏对齐、表格留白和移动端操作按钮换行。此层作为新增页面的防护线，避免侧边栏展开/折叠、浅深主题或移动端底部导航下重新出现挤压和错位。

2026-05-05 补充：普通用户订阅页进一步移除右侧概览列，改为更紧凑的单列导入工作台，并从订阅主流程中移除客户端下载 / 软件下载入口，仅保留配置文件选择、复制、扫码、一键导入和适用软件提示。公开伪装站也增加旧技术标题迁移，`Edge Precision Systems` 等残留名称不再进入公开 HTML。

2026-05-05 追加复核：按真实浏览器检查登录页、后台头部、仪表盘侧边栏展开 / 折叠、服务器管理、系统设置、审计中心和用户订阅页，覆盖 1440x900、1366x768、1280x720、1024x768、390x844 与明暗主题组合。重点确认登录页按钮可达、搜索不隐藏、状态卡同排等高、服务器操作列可见、系统设置无异常横向溢出和用户订阅页无右侧空列。

2026-05-05 服务器与用户页专项补强：服务器管理在 1440、1280、768、390 视口下改为稳定列表卡片，移动端工具栏和筛选区压缩为紧凑栅格，操作按钮不再被表格列宽挤压。普通用户订阅页修正旧双栏覆盖导致的桌面压窄问题，用户工作台恢复全宽单列节奏，手机端复制、导入和重置按钮改为安全全宽布局。

2026-05-05 全页面密度复扫：再次覆盖登录、仪表盘、服务器、入站、用户、订阅、审计、日志、账户、系统设置、公开伪装页在桌面 / 笔记本 / 手机与明暗主题下的布局。补齐普通按钮最小宽度、详情页标签宽度、订阅管理移动端工具栏换行，账户页改为更紧凑的身份条 + 表单布局，订阅管理摘要和数据库设置卡片进一步压缩空白。自动审计最终未发现真实横向溢出或按钮裁切；剩余登录根容器、隐藏移动端表头、表单卡高度属于脚本启发式误报，人工复核为可接受。

2026-05-05 最终补充复核：系统设置 `入口与订阅` 工作区修复 1280px + 展开侧边栏下注册面板被压成窄列的问题，访问、伪装、订阅外链、注册邀请码区按内容宽度重新栅格化，并隐藏重复眉标与冗余说明。仪表盘今日 / 本周 / 本月用户流量卡片现在分别跳转到审计中心对应时间窗口。注册、登录、忘记密码页在 1280x720、768x1024、390x844 下重新验证按钮可达；后台头部搜索、语言、通知在桌面同排对齐，移动端无横向溢出。

### 结论

当前版本已经完成本轮最重要的后台 UI 稳定性修复，可以作为后续页面统一重构的基线。下一阶段重点应从“修 bug”转向“收敛样式与组件复用”。

## English

Audit date: 2026-04-28
Latest review: 2026-05-05, full-page layout review, public camouflage redesign, and internal layout guardrail pass

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
- All three camouflage templates have been redesigned as unrelated city-magazine pages: `corporate` is a city weekly, `blog` is photo notes, and `nginx` is a weekend guide. Public copy, titles, asset paths, and 404 content are detached from internal operations, subscriptions, nodes, audit, and related product language
- Internal pages now have an extra global layout guardrail layer for page width, toolbar wrapping, table edge padding, the Settings access grid, and mobile bottom-navigation spacing
- End users now have a self-service Account center, while user navigation has been reduced to Subscriptions and Account so software-download entry points no longer appear in the subscription flow
- The end-user Subscriptions page now uses a single-column import workbench: status summary, profile switching, copy, quick import, QR, and reset-risk controls stay in the first viewport without a sparse side column or unrelated download panel
- Legacy technical camouflage titles such as `Edge Precision Systems` are now migrated by both the public renderer and system settings normalization, so the public page falls back to the city-magazine default title
- Audit log writing switched to a persistent write stream (replacing `appendFileSync`) with an in-memory ring buffer for pattern matching, reducing event-loop blocking
- Task queue now enforces a capacity cap (1000) with automatic pruning of completed tasks on overflow
- Public subscription endpoints now have a dedicated lightweight rate limiter, separated from the admin API rate limiter
- Search bot and scanner protection middleware has been added to the request pipeline
- GitHub Actions CI/CD workflows are now configured: CI auto-tests on push/PR, Docker workflow auto-builds and pushes images to GHCR
- Header search has been upgraded into a global command surface for page, user, and node jumps, plus common actions such as refresh current view, create user, and add server
- The admin shell now uses a lightweight bootstrap payload first, with heavier audit, settings, task, and telemetry data loaded by the pages that need them
- Password controls in the user create/edit dialogs now use accessible icon buttons, so narrow layouts no longer squeeze labels such as “generate”
- Login-page glow layers are now decorative only, so mobile taps on form actions such as “Forgot password” are no longer intercepted
- The System Settings workspace switcher now becomes a horizontal pill rail on mobile, preventing long labels such as “Access & Subscription” and “Policy & Audit” from collapsing into vertical text
- The first-run security wizard now scrolls inside the modal on small screens and keeps its action area reachable, so the unlock button remains usable during mobile setup
- The desktop System Settings layout has been tightened: the inner secondary sidebar was replaced with a top workspace rail, repeated explanatory hero copy was removed, and the access, operations, and backup panels now size to content instead of creating large blank columns
- The mobile System Settings flow was rechecked as a horizontal workspace rail plus single-column content, avoiding cramped labels, toggle cards, and save actions on narrow screens
- Audit Center now supports aligned filters for event and subscription-access views, including date range, actor, target user, token, real IP, and server fields; list, summary, and CSV export behavior now share the same filter semantics
- Audit Center desktop layout now reads as a denser workbench with consistent tab, filter, summary, table, and traffic-analysis spacing across expanded and collapsed sidebar states
- Audit Center mobile layout was rechecked as a horizontal tab rail, single-column filter flow, and full-width action controls so date inputs, buttons, and summaries do not crowd each other on small screens
- The end-user shell no longer loads admin-only server context, system-notification APIs, or the notification bell, removing unnecessary requests and header noise from user pages
- User Detail titles now wrap cleanly on narrow screens, while server account/action columns were retuned so collapsed-sidebar dark layouts no longer stack account text vertically
- Audit Center traffic charts now use consistent margins and compact Y-axis byte labels on mobile, keeping full byte values in tooltips while avoiding wrapped axis units

### Areas in good shape

- Layout, Sidebar, and Header now have clearer hierarchy than the previous baseline
- The main operating paths across monitoring, server management, subscriptions, and audit are stable
- Floating panel behavior in both light and dark themes is much more consistent
- Hover, active, and focus feedback is now acceptable for core actions
- Secondary operator pages such as Logs, Tasks, and Tools are now aligning with the same card, table, and empty-state system
- The user-facing subscription page is now more focused and easier to explain to non-technical users
- System Settings now reads as one operational workbench, with steadier desktop rhythm across navigation, content columns, and the save area

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

### 2026-05-04 System Settings Conclusion

The focused pass covered all five System Settings workspaces: Status, Access & Subscription, Policy & Audit, Operations, and Backup. Desktop light, desktop dark, and mobile layouts were checked with Playwright screenshots. The main layout defects were the inner secondary sidebar consuming width, repeated summary copy, forced equal-height panels creating excess whitespace, and unstable wrapping in operations toggle cards. The current CSS now uses a single workbench structure with a horizontal rail, content-sized panels, and tighter desktop/mobile spacing.

### 2026-05-04 Full-Page Layout Conclusion

The full-page review covered 19 admin desktop pages across light theme, dark theme, expanded sidebar, and collapsed sidebar states for 76 desktop captures. It also covered the main admin and end-user mobile pages across light and dark themes for 44 mobile captures. Automated layout metrics found no horizontal overflow, visible misalignment, abnormal whitespace, or control text crowding. Manual samples included Dashboard, System Settings, Audit Center, Server Detail, Inbounds, and the end-user Subscription page; the main surfaces are now stable enough to use as the baseline for continued shared-component convergence.

### 2026-05-05 Full-Page Layout Conclusion

The review covered 22 admin routes across desktop light, desktop dark, expanded sidebar, and collapsed sidebar combinations, plus the primary admin and end-user mobile / desktop surfaces, for 144 page states and 224 screenshots. Automated metrics found no horizontal overflow, visible misalignment, clipped control text, or tiny text buttons. Manual samples confirmed the dark collapsed server table, mobile Audit Center traffic charts, dark mobile System Settings, and the end-user desktop Subscriptions page; the main surfaces now remain readable and aligned across themes, sidebar states, and mobile navigation.

### 2026-05-05 Final Supplement

The final pass fixed the Settings `Access & Subscription` workspace at 1280px with the sidebar expanded, where the registration panel could collapse into a narrow column. The access, camouflage, public subscription URL, and invite-code sections now use content-aware grids, repeated kicker text is hidden, and duplicate labels were renamed or removed. Dashboard traffic cards now route Today, Week, and Month user traffic to matching Audit Center windows. Login, registration, and forgot-password views were rechecked at 1280x720, 768x1024, and 390x844; header search, language, and notification controls stay aligned on desktop, and the checked mobile pages show no horizontal overflow.

### Conclusion

The current build resolves the most important admin UI stability issues and is a valid baseline for broader page unification. The next phase should shift from bug fixing to style convergence and component reuse.
