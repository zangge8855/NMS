# UI Design System

## 中文

### 设计目标

NMS 的后台界面应优先满足三件事：稳定、清晰、可连续操作。界面不是营销页，重点是状态密度、风险提示、批量操作效率和低误触成本。

### 视觉基线：墨底信号（signal on ink）

配色取自 Logo：深海军蓝的“墨”作为底，水青色的“信号”只用来指路。

| 角色 | 暗色 | 亮色 | 用途 |
| --- | --- | --- | --- |
| `--signal` / `--accent-primary` | `#62d8c6` | `#007a6d` | 主按钮、焦点环、当前导航 / 标签页的引导边、选中项 |
| `--ink-rail` | `#061222` | `#f5f9fa` | 侧栏 |
| `--ink-canvas` | `#09172a` | `#ebf3f4` | 工作区底色 |
| `--ink-panel` | `#102034` | `#ffffff` | 面板 |
| `--ink-raised` | `#18283e` | `#f0f7f7` | 面板内的嵌套表面 |
| `--ink-input` | `#0c1a2c` | `#ffffff` | 输入框 |
| 成功 / 警告 / 危险 / 信息 | `#86d391` / `#f0be67` / `#ee857e` / `#86beee` | 各自加深到 AA 对比度 | 只描述状态 |

- 表面靠色阶区分，细线辅助结构；阴影只留给真正浮起的东西（菜单、弹窗、通行证）
- 圆角按层级：通行证 16px、面板 12px、控件 8px、标签 6px（`--radius-pass` / `--radius-panel` / `--radius-control` / `--radius-chip`）
- 字体分工：正文与一切需要阅读的文字用 Noto Sans SC；Wordmark 与数字用 Schibsted Grotesk（`--font-display` / `--font-figure`，比例数字 `proportional-nums`——这款字体的 `tnum` 会把冒号、小数点和“1”撑成整格宽，时间和百分比显得松散，所以全站不使用 `tabular-nums`）；IBM Plex Mono（`--font-mono`）只用于机器字面量——地址、密钥、日志。小号数据标签不用等宽字体
- 不使用全大写标签、无意义的序号、链接后的 “→”、环境渐变和常驻动画；运动只回应用户操作，并尊重 `prefers-reduced-motion`
- 明暗模式都必须使用明确且不透明的表面色
- 按钮尺寸、圆角、focus ring 和 hover 态必须复用 `.btn` 系列规则，图标按钮要保持稳定宽高
- 卡片只在内容本身需要独立交互边界时使用；普通信息区优先采用分栏、分隔线、表格和 ledger 列表

### 色彩纪律

- **信号色只表示“你在这里 / 在这里操作”**：每个操作区只有一个实心主按钮；同类切换（订阅格式、工具页签、自动刷新）使用 `btn-secondary` + `aria-pressed="true"`（或 `.is-on`）的“按下态”，而不是第二个实心主按钮
- **健康 = 墨色 + 6px 成功圆点**：正常 / 在线 / 已开通 / 已同步等常态不铺绿色底；只有警告和危险保留带色填充，让需要看的东西自己跳出来
- **分类一律中性**：协议、节点名、标签、角色、推荐配置名、头像首字母、搜索结果类型图标都用中性墨色，不借用信号色或语义色
- **次要数字和仪表中性**：上下行流量拆分、环形 / 条形仪表默认使用 `--meter-fill`，越过阈值才变成警告 / 危险色；筛选 pill 的计数保持中性，颜色由前面的圆点承担
- **不做常驻动画**：在线圆点不 ping，环形仪表不“呼吸”
- **日志面板两种主题都是墨底**：`.log-pane` 在局部重设暗色调色板；INFO 行无左边线，只有 WARN / ERROR 带色边与色字

### 签名元素：通行证（the pass）

登录页和用户订阅页使用同一个“通行证”对象：主体 + 撕口票根，凹口通过 CSS mask 的径向渐变实现，边缘由父级 `filter: drop-shadow(var(--pass-edge))` 提供。票根在两种主题下都印成 Logo 的海军蓝（`--pass-stub-bg` / `--pass-stub-text` / `--pass-stub-muted`）。容器查询 `pass`：≤860px 票根移到底部，≤560px 字段改为单列行。界面的大胆只花在这里，其余页面保持安静。

登录页的票根只印 Logo 与 “NMS” 字标，不放副标题、产品介绍或控制台主机名；表单侧所有输入框、主按钮、验证码发送按钮统一 42px 高，并沿同一左边线对齐。

### 数据展示

- 空值统一显示 “—”（em dash），不用 “-” 或 “--”
- 同一信息只出现一次：页头已有的名称、地址、健康状态，不在下方卡片里再列一遍；工具栏、区块标题不再重复显示计数或当前页签
- 不限量 / 永久的环形仪表显示 “∞” 且圆环留空，不画成 100%
- 只有一个采样点时不画折线图；在线 / 离线只在状态列出现
- 键值信息用 `<dl>` 网格：上方小号灰色标签、下方正文值，不在标签后加冒号

### 全局 token

运行时样式按以下顺序加载（见 `client/src/main.tsx`）：

`index.css` → `restrained-ui.css` → `overlay-restore.css` → `flagship-console.css` → `tokens.css` → `utilities.css` → `modules.css` → `subscription-center.css` → `theme.css` → `polish.css` → `identity.css`

- `theme.css`：颜色 token 的唯一来源（墨色阶、信号色、语义色、`--pass-*`、`--meter-fill`、`--log-bg` / `--log-text`）
- `identity.css`：最后加载，负责外壳与共享组件如何使用这些 token，以及通行证、色彩纪律等规则
- 新样式只引用 token，不再写死十六进制颜色；遇到旧层的 `!important` 时，优先删除旧规则，确实删不掉才在 `identity.css` 中以同等权重覆盖并注明原因

统一原则：

- 表面层级使用色阶 + 浅边框，而不是重描边或通用灰阴影
- Hover 使用 `transition-colors`
- Focus 使用统一 ring
- 浮层使用明确背景色和 `z-index`

### Layout

- Sidebar：支持展开、折叠和收起态 flyout
- Header：承载全局搜索、通知和当前上下文信息
- Content：保持稳定留白与滚动区域，不让浮层被裁切
- Header：主题只跟随系统自适应，不提供手动主题切换按钮；搜索、语言、通知等右侧控件必须保持同轴对齐，窄屏下按共享断点换行
- Login：登录卡片、提交按钮和忘记密码入口必须在常见桌面、平板、手机以及低高度桌面视口内可见，不得依赖用户先缩放页面
- Settings：优先使用分组工作台或 tab workbench，不要把系统状态、保存动作和全部设置块堆在同一长页里
- Settings 桌面端不要在应用侧边栏内再放第二个左侧栏；工作区切换应优先使用顶部横向导航，让表单内容获得完整宽度
- Settings 面板不应强制等高；除非确有对比需求，卡片按内容自然高度排列，避免短内容列产生大面积空白
- Settings 的说明文案应收敛到页签、标题和必要帮助文本，不要重复堆叠 hero、摘要卡和面板说明
- Settings 保存栏只在存在未保存修改时出现；干净状态不占用固定空间
- Settings 状态页使用并列 ledger 展示通知、巡检、数据库和存储状态，避免 KPI 卡片矩阵
- Settings 的备份 / 状态区域必须明确展示运行数据目录和本机备份目录的持久化健康状态，尤其是易失目录、读写权限和损坏 JSON 统计
- 状态卡片必须在侧边栏展开、折叠、窄屏三种布局下保持统一高度节奏，不允许同一行指标卡尺寸忽高忽低
- 仪表盘首屏使用三项紧凑摘要 KPI，不重复页面标题或堆放快捷操作卡；在线用户摘要应保留明细入口，流量区只保留日 / 周 / 月三个时间窗口
- 仪表盘节点健康在服务器数量较多时优先展示异常 / 离线节点，避免健康节点占据过多首屏空间
- 服务器管理在宽度大于 768px 时保持数据表格，移动端才切换为列表卡；详情与连接测试保留为显式操作，编辑和删除收纳进操作菜单
- 全页面必须通过统一内容宽度、工具栏换行、表格首尾留白和移动端底部导航避让兜底；新增页面不要绕过 `.page-content` / `.page-content--wide` 这套容器节奏
- 普通用户自助页要优先做成单列工作台，首屏聚焦最常用动作；不要为了“看起来丰富”增加弱信息右栏，避免宽屏出现大面积空白
- 订阅页的用户端应把状态摘要、配置切换、复制、一键导入、二维码和重置风险提示集中到导入工作台，客户端下载作为下方辅助区，不与主操作争夺首屏重心；用户端 `simple` 工作台必须保持单列，不得被后台双栏网格覆盖
- 账户、设置、订阅摘要这类表单 / 状态页必须优先减少重复说明文案，用紧凑标题、明确标签、必要帮助文本和稳定按钮宽度组织内容；桌面端应利用合理列宽减少空白，移动端保持单列但不能产生横向溢出

### 公开伪装首页规范

- 公开伪装首页必须与站内业务完全脱钩，不能出现 NMS、订阅、节点、面板、审计、代理、后台、运维等语义
- 默认方向为城市生活杂志，当前三套模板分别是城市周刊、影像笔记、周末指南
- 旧技术品牌或系统类标题（例如 `Edge Precision Systems`）不得作为公开标题展示，应迁移到城市杂志默认标题
- 公开资源路径必须使用中性命名，例如 `/media/city/...`，不要使用 `server`、`node`、`ops`、`support`、`network`、`panel` 等词
- 404 / 异常路径也只展示普通杂志内容，不显示真实入口、请求路径、请求方法或状态码
- 公开伪装首页必须跟随系统 `prefers-color-scheme`，三套模板都要提供浅色和深色变量，不允许固定浅色页面
- 新增模板、文案或素材后，必须保留服务端敏感词断言

### Sidebar 规范

- 当前激活项必须有明显背景区分与指示条
- 展开态菜单文字使用可收缩内容区并允许安全换行，徽标保持独立且不得挤压标签；收起态只显示图标
- 收起态子菜单必须通过 Portal 或 `overflow-visible` 机制渲染
- 手风琴展开动画应避免 `display` 动画，优先使用 `max-height` 或 grid rows 技巧
- 菜单分组应尽量少而稳定，避免把 `Dashboard`、`Monitor` 这类高度重叠的入口拆成多个顶部区域
- 退出登录和账号入口放在独立底部工具区；主导航负责滚动，工具区在短屏和移动抽屉中保持可见且不得遮挡最后一个菜单项
- 服务器和用户列表在视口不大于 1100px 时切换为信息完整的卡片列表；入站与审计在相同宽度使用卡片化布局
- 服务器与入站表格在 769–1580px 的中宽桌面合并次要列信息，避免展开侧栏后依赖横向滚动

### Dropdown / Popover 规范

- 统一使用不透明背景色，例如 `bg-white dark:bg-slate-800`
- 统一提升层级到 `z-50`
- 只对 `opacity`、`transform`、`visibility` 做过渡
- 不对 `display` 做 transition
- 低性能设备上不要叠加多层 `backdrop-blur`

### Modal 规范

- 遮罩使用 `bg-slate-900/50 backdrop-blur-sm`
- 内容层使用 `rounded-xl shadow-lg border border-slate-200 dark:border-slate-700/50`
- 进退场动画使用轻微上浮与透明度变化
- 必须支持点击遮罩关闭和 `Esc` 关闭

### 中西文排版与间距规范 (Pangu Spacing)

为了保证界面的可读性与专业感，所有用户可见文本均应遵循中西文混排间距规范（盘古之白）：
- **中西文间距**：中文汉字与西文字符（英文字母、阿拉伯数字、半角标点等）直接相邻时，必须保留一个半角空格（例如：`至少 8 位，含 3 类字符`、`服务器 ID`、`2 列`）。
- **变量/插值占位符间距**：在翻译文件（`messages.js`）或 JSX 文本中，中文与花括号变量 `{variable}` 或模板字符串占位符 `${variable}` 相邻时，如果变量解析后可能为西文字符或数字，必须加空格（例如：`确定 {action} 用户`、`复制 {label}`、`${remainingDays} 天`）。如果占位符后紧跟中文全角标点（如逗号、句号等），则不需要额外加空格。
- **标点符号**：中文文本中优先使用全角标点符号（如 `，`、`。`、`？`、`（）`），全角标点符号前后不需要添加空格。

### 表单规范

- 所有输入框与按钮必须去掉默认浏览器蓝框
- Focus 态统一为 `focus:outline-none focus:ring-2 focus:ring-accent-primary/50` (在非 Tailwind 类中，使用统一的 CSS 变量 `--focus-ring-border` 与 `--focus-ring-shadow`)
- 如果页面不直接使用 Tailwind 原子类，也必须接入共享的 `.form-input`、`.form-select`、`.btn`、原生 checkbox/radio 焦点规则，确保视觉结果与统一 focus ring 一致
- Select 必须有显式背景色，避免暗色模式下闪黑块
- Select 的 closed state 不要继承普通输入框那种会切换背景色的 hover / focus 过渡，否则原生弹层会先闪默认深色
- 原生 select 的弹出面板不要强行做玻璃化或渐变背景，优先保留系统 `Canvas / CanvasText`，避免 Chromium 下出现黑色块

### 表格规范

- 表头默认吸顶
- 行 hover 明显，但不能干扰可读性
- 空数据时使用统一 Empty State 组件，不直接裸写“暂无数据”
- 滚动条统一细化并适配亮 / 暗模式
- 列表外壳优先收敛到共享 `table-container`，避免业务页面继续扩散特定表格壳类
- 筛选状态、总数、已启用筛选项这类摘要应优先做成紧凑 pills / summary rows，不要在表格上方单独堆大型状态卡
- 同一表格中的 badge、数值列、状态列、操作列需要显式定义对齐规则，避免依赖默认继承

### Empty State 规范

- 使用共享 `EmptyState` 组件
- 支持默认版、紧凑版和带表面层次版
- 文案要说明下一步，而不只是一句“没有数据”
- 当场景允许时，应通过 `action` 提供下一步按钮，例如“前往服务器管理”或“刷新后重试”

### 性能与加载态

- 数据较重的后台页优先”先出基础列表，再补节点统计”，不要让整页阻塞在跨节点扫描上
- 对节点面板这类高成本请求优先做共享缓存或 in-flight 去重，避免 `Dashboard`、`Users`、`User Detail` 重复扫同一批节点
- 通知类入口优先先拿计数和轻量预览，完整列表在用户展开面板后再补齐
- `Settings` 按工作区分组惰性加载，避免首次进入一次性请求全部系统诊断数据

### 可访问性

- 交互控件要有可见焦点
- 键盘用户必须能关闭弹窗并切换主要导航
- 色彩对比度优先于装饰效果

## English

### Design goal

The NMS admin UI optimizes for stability, clarity, and uninterrupted operations. This is not a marketing site. The interface should prioritize state density, risk visibility, batch efficiency, and low error cost.

### Visual baseline: signal on ink

The palette comes from the logo: deep navy "ink" is the ground, and aqua "signal" only points the way.

| Role | Dark | Light | Use |
| --- | --- | --- | --- |
| `--signal` / `--accent-primary` | `#62d8c6` | `#007a6d` | Primary button, focus ring, leading edge of the current nav item / tab, selected option |
| `--ink-rail` | `#061222` | `#f5f9fa` | Sidebar |
| `--ink-canvas` | `#09172a` | `#ebf3f4` | Workspace ground |
| `--ink-panel` | `#102034` | `#ffffff` | Panels |
| `--ink-raised` | `#18283e` | `#f0f7f7` | Nested surfaces inside a panel |
| `--ink-input` | `#0c1a2c` | `#ffffff` | Inputs |
| Success / warning / danger / info | `#86d391` / `#f0be67` / `#ee857e` / `#86beee` | Each deepened to AA contrast | State only |

- Surfaces separate by tone, with hairlines for structure; shadows are kept for things that float (menus, dialogs, the pass)
- Radius follows hierarchy: pass 16px, panels 12px, controls 8px, chips 6px (`--radius-pass` / `--radius-panel` / `--radius-control` / `--radius-chip`)
- Type roles: Noto Sans SC for everything people read; Schibsted Grotesk for the wordmark and figures (`--font-display` / `--font-figure`, proportional numerals: this face's `tnum` widens colons, decimal points and the digit 1 to a full cell, so times and percentages look loose; never use `tabular-nums`); IBM Plex Mono (`--font-mono`) only for literal machine strings such as addresses, keys, and logs. Small data labels are not set in mono
- No all-caps labels, decorative numbering, "→" on links, ambient gradients, or perpetual motion; motion answers user actions and respects `prefers-reduced-motion`
- Both light and dark themes must use explicit opaque surfaces
- Button sizing, radius, focus rings, and hover states must reuse the `.btn` family, and icon buttons need stable dimensions
- Use cards only when the content needs an independent interaction boundary. Prefer columns, dividers, tables, and ledger rows for routine information

### Colour discipline

- **Signal means "you are here / act here"**: one filled primary per action area. Mode switches (subscription formats, tool tabs, auto-refresh) use `btn-secondary` with `aria-pressed="true"` (or `.is-on`) for a pressed state instead of a second filled primary
- **Healthy = ink plus a 6px success dot**: normal / online / enabled / synced do not get green fills. Only warning and danger keep a tinted fill, so what needs a look stands out on its own
- **Categories are neutral**: protocols, node names, tags, roles, recommended profile names, avatar initials, and search-result type icons use neutral ink, never signal or state colours
- **Secondary figures and meters are neutral**: upload/download splits and ring/bar meters use `--meter-fill` until a threshold is crossed; filter-pill counts stay neutral and the leading dot carries the colour
- **No perpetual motion**: online dots do not ping and ring meters do not "breathe"
- **The log pane is ink in both themes**: `.log-pane` re-declares the dark palette locally; INFO lines have no edge, only WARN / ERROR get a coloured edge and text

### Signature object: the pass

Login and the user's subscription page share one "pass" object: a body plus a torn stub. The notches are a CSS mask built from radial gradients, and the edge comes from `filter: drop-shadow(var(--pass-edge))` on the parent. The stub is printed in the logo's navy in both themes (`--pass-stub-bg` / `--pass-stub-text` / `--pass-stub-muted`). Container query `pass`: at ≤860px the stub moves to the bottom; at ≤560px fields become rows. The interface spends its boldness here and stays quiet everywhere else.

The login stub carries only the logo and the “NMS” wordmark: no subtitle, product pitch, or console host name. On the form side, inputs, the primary button and the send-code button are all 42px tall and share one left edge.

### Data display

- Empty values render as “—” (em dash), never “-” or “--”
- Show each fact once: the name, address and health that lead a page header are not listed again in a card below, and toolbars and section headers do not restate counts or the active tab
- Unlimited / permanent ring meters show “∞” with an empty ring, not a full 100%
- No sparkline with a single sample; online / offline appears only in the status column
- Key/value details use a `<dl>` grid: a small muted label above the value, with no trailing colon

### Global tokens

Runtime styles load in this order (see `client/src/main.tsx`):

`index.css` → `restrained-ui.css` → `overlay-restore.css` → `flagship-console.css` → `tokens.css` → `utilities.css` → `modules.css` → `subscription-center.css` → `theme.css` → `polish.css` → `identity.css`

- `theme.css` is the single source of colour tokens (ink scale, signal, state colours, `--pass-*`, `--meter-fill`, `--log-bg` / `--log-text`)
- `identity.css` loads last and owns how the shell and shared components use those tokens, plus the pass and colour-discipline rules
- New styles reference tokens rather than hard-coded hex values. When an older layer uses `!important`, delete the legacy rule first; override it in `identity.css` with matching weight only when it cannot be removed, and say why in a comment

Consistent rules:

- separate layers with tone and subtle borders, not heavy outlines or generic grey shadows
- use `transition-colors` for hover feedback
- keep a shared focus ring
- give floating panels explicit background color and stable z-order

### Layout

- Sidebar supports expanded, collapsed, and flyout states
- Header hosts global search, notifications, and context
- Content keeps stable spacing and scroll regions without clipping overlays
- Header follows the system theme automatically and should not expose a manual theme toggle. Search, language, notification, and other right-side controls must stay axis-aligned and wrap only at shared breakpoints
- Login cards, submit buttons, and forgot-password links must remain visible on common desktop, tablet, mobile, and short-height desktop viewports without requiring browser zoom
- Settings should use grouped workspaces or a tabbed workbench instead of placing system status, save actions, and every setting block in one long page
- Desktop Settings should not add a second inner left rail inside the app sidebar. Prefer a top horizontal workspace rail so forms can use the full content width
- Settings panels should not be forced to equal heights unless comparison is the goal. Let cards size to content to avoid blank columns
- Settings explanatory copy should be consolidated into tabs, headings, and necessary helper text instead of stacking heroes, summary cards, and panel descriptions
- The Settings save dock renders only when unsaved changes exist; a clean workspace should not reserve fixed space for it
- The Settings status workspace uses paired ledgers for notification, monitoring, database, and storage state instead of a KPI-card mosaic
- Settings backup/status areas must expose runtime storage health, especially volatile data paths, read/write access, and corrupted JSON counts
- Status cards must keep a consistent height rhythm across expanded-sidebar, collapsed-sidebar, and narrow layouts
- The Dashboard first screen uses three compact summary KPIs, without a duplicate page title or quick-action card grid. The online-user KPI keeps the detail toggle, and traffic summaries are limited to day / week / month
- Dashboard node health should prioritize abnormal and offline nodes when the cluster grows, reducing first-screen height
- Server Management stays table-first above 768px and switches to list cards only on mobile. Detail and connection test remain explicit; edit and delete live in the actions menu
- All pages must keep the shared content width, toolbar wrapping, table edge padding, and mobile bottom-navigation spacing. New pages should not bypass the `.page-content` / `.page-content--wide` rhythm
- End-user self-service pages should prefer a single-column workbench focused on the primary action. Do not add weak side columns that create large blank areas on wide screens
- The end-user subscription page should keep status, profile switching, copy, one-tap import, QR, and reset-risk controls in the import workbench, with client downloads below as supporting content. The user-facing `simple` workbench must remain single-column and must not inherit the admin two-column grid
- Form and status pages such as Account, Settings, and subscription summaries should reduce repeated helper copy, use compact headings and necessary help text, keep stable button widths, use practical desktop columns to avoid blank space, and remain single-column without horizontal overflow on mobile

### Public Camouflage Rules

- Public camouflage pages must stay fully detached from internal product language, including NMS, subscriptions, nodes, panels, audit, proxy, admin, and operations language
- The default direction is a city-life magazine. The current templates are city weekly, photo notes, and weekend guide
- Legacy technical/system titles such as `Edge Precision Systems` must not render publicly; they should fall back to the city-magazine default title
- Public asset paths must use neutral naming such as `/media/city/...`; avoid words like `server`, `node`, `ops`, `support`, `network`, and `panel`
- 404 / abnormal paths should still render ordinary magazine content and must not show the real entry path, request path, request method, or status code
- Public camouflage pages must follow system `prefers-color-scheme`; every template needs both light and dark variables instead of a fixed light page
- Any new template, copy, or asset must keep the server-side sensitive-language assertions passing

### Sidebar rules

- The active item must be visually distinct and clearly indicated
- Expanded labels use a shrinkable content region and may wrap safely; badges remain independent and must not squeeze the label. Collapsed navigation shows icons only
- Sign-out and account actions live in a dedicated utility footer; the main navigation scrolls while the footer stays visible without covering the final item
- Server and user lists switch to information-complete cards at viewports up to 1100px; inbound and audit views use card layouts at the same width
- Server and inbound tables merge secondary-column information between 769px and 1580px so an expanded sidebar does not require horizontal scrolling
- Collapsed flyouts must render through a Portal or an overflow-safe strategy
- Accordion transitions should avoid animating `display`; prefer `max-height` or grid-row techniques

### Dropdown / Popover rules

- Use opaque surfaces such as `bg-white dark:bg-slate-800`
- Standardize layer order at `z-50`
- Transition only `opacity`, `transform`, and `visibility`
- Never transition `display`
- Avoid stacking heavy `backdrop-blur` effects on lower-end devices

### Modal rules

- Overlay uses `bg-slate-900/50 backdrop-blur-sm`
- The surface uses `rounded-xl shadow-lg border border-slate-200 dark:border-slate-700/50`
- Enter and exit motion uses a slight upward float with opacity
- Click-outside close and `Esc` close are required

### CJK & Latin Typography Spacing (Pangu Spacing)

To ensure high readability and a professional visual presentation across localizations, all user-facing strings must adhere to standard mixed CJK/Latin spacing rules:
- **Spacing Between CJK and Latin**: A single half-width space must be placed between Chinese characters and Western letters, digits, or half-width symbols (e.g., `至少 8 位，含 3 类字符`, `服务器 ID`, `2 列`).
- **Spacing Around Placeholders**: In translation files (`messages.js`) or JSX code, if a Chinese character is adjacent to a brace placeholder `{variable}` or template literal `${variable}` that resolves to a Latin string/number, a space must be added (e.g., `确定 {action} 用户`, `复制 {label}`, `${remainingDays} 天`). If the placeholder is followed immediately by full-width Chinese punctuation (e.g., `，` or `。`), no space is needed.
- **Punctuation Rules**: Use full-width CJK punctuation (e.g., `，`, `。`, `？`, `（）`) in Chinese contexts; do not add spaces around full-width punctuation marks.

### Form rules

- Remove default browser focus outlines from inputs and buttons
- Standardize focus with `focus:outline-none focus:ring-2 focus:ring-accent-primary/50` (for non-Tailwind styles, bind to the unified variables `--focus-ring-border` and `--focus-ring-shadow`)
- If a page does not use Tailwind utilities directly, it must still use the shared `.form-input`, `.form-select`, `.btn`, and native checkbox/radio focus rules so the rendered result matches the shared focus ring
- Native selects need explicit backgrounds to avoid dark-mode flashing
- Closed-state selects should not inherit input-style background transitions on hover / focus, or Chromium can flash the native dark surface before repainting the final theme
- Do not force native select popups into glass or gradient surfaces; keep system `Canvas / CanvasText` colors so Chromium does not render the menu as a black block

### Table rules

- Headers should remain sticky
- Row hover should be visible without reducing readability
- Empty states should use the shared `EmptyState` component
- Scrollbars should be slim and theme-aware
- Feature pages should prefer the shared `table-container` shell instead of adding more page-specific table wrappers

### Empty state rules

- Use the shared `EmptyState` component
- Support default, compact, and surfaced variants
- Copy should describe the next useful action, not only "no data"
- When the flow has a clear next step, expose it through the `action` slot, for example "Open Servers" or "Refresh and retry"

### Accessibility

- Interactive elements must keep visible focus
- Keyboard users must be able to close modals and navigate primary layout areas
- Color contrast has higher priority than decorative effects
