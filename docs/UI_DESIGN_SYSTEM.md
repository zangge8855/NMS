# UI Design System

## 中文

### 设计目标

NMS 的后台界面应优先满足三件事：稳定、清晰、可连续操作。界面不是营销页，重点是状态密度、风险提示、批量操作效率和低误触成本。

### 视觉基线

- 布局容器使用柔和分层，不使用生硬纯黑边框
- 卡片、下拉、弹窗统一采用紧凑圆角、柔和阴影与浅边框，常规卡片圆角不超过 8px
- 按钮、输入框统一采用稳定高度、紧凑圆角和同轴图标 / 文案对齐
- 明暗模式都必须使用明确且不透明的表面色
- 后台主色以专业蓝 / 青色为主，危险操作只使用红色系；避免把后台做成单一紫蓝、深蓝或棕橙主题
- 按钮尺寸、圆角、focus ring 和 hover 态必须复用 `.btn` 系列规则，图标按钮要保持稳定宽高

### 全局 token

样式分散在以下文件中（按加载顺序）：

- `client/src/styles/ui-tokens.css`
- `client/src/styles/layout-polish.css`
- `client/src/styles/interaction-polish.css`
- `client/src/styles/experience-upgrade.css`
- `client/src/styles/console-redesign.css`

**权威 token 层**：统一的设计 token 定义在最后加载的 `console-redesign.css`（Design System v2）。约定：每个颜色只有一个基色，`-bg` / `-border` / `-glow` 一律用 `color-mix()` 从基色派生，主题（明/暗）只覆盖基色而不重复定义派生值，强调色因此永远不会和自己的背景脱节。其余文件不应再新增会冲突的 `:root` 颜色定义，也不要写死霓虹色或发光/扫光/无限脉冲等装饰特效。

统一原则：

- 表面层级使用浅边框 + 阴影，而不是重描边
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
- Settings 的备份 / 状态区域必须明确展示运行数据目录和本机备份目录的持久化健康状态，尤其是易失目录、读写权限和损坏 JSON 统计
- 状态卡片必须在侧边栏展开、折叠、窄屏三种布局下保持统一高度节奏，不允许同一行指标卡尺寸忽高忽低
- 仪表盘节点健康在服务器数量较多时默认使用重点视图，优先展示异常 / 离线节点，避免健康卡片占据过多首屏空间
- 服务器管理在 1500px 以下优先切换为列表卡片，避免侧边栏展开后的常见 PC 宽度把多列表格压坏；超宽桌面表格也必须保留右侧操作列可见，测试连接、编辑、删除等按钮不能被横向裁切
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
- 菜单文字在宽度过渡期间保持 `whitespace-nowrap`
- 收起态子菜单必须通过 Portal 或 `overflow-visible` 机制渲染
- 手风琴展开动画应避免 `display` 动画，优先使用 `max-height` 或 grid rows 技巧
- 菜单分组应尽量少而稳定，避免把 `Dashboard`、`Monitor` 这类高度重叠的入口拆成多个顶部区域
- 退出登录和账号入口不要被压到侧边栏最底部不可见位置，工具区应尽量贴近主导航末端

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

### 表单规范

- 所有输入框与按钮必须去掉默认浏览器蓝框
- Focus 态统一为 `focus:outline-none focus:ring-2 focus:ring-blue-500/50`
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

### Visual baseline

- Use soft separation instead of harsh black borders
- Cards, dropdowns, and modals use compact radius, soft shadow, and subtle borders; standard cards should stay at 8px radius or below
- Buttons and inputs share stable height, compact radius, and aligned icon / label rhythm
- Both light and dark themes must use explicit opaque surfaces
- Admin accents should stay in a professional blue / cyan range, with destructive actions reserved for red; avoid one-note purple-blue, dark-blue, or brown-orange themes
- Button sizing, radius, focus rings, and hover states must reuse the `.btn` family, and icon buttons need stable dimensions

### Global tokens

Styles are split across (in load order):

- `client/src/styles/ui-tokens.css`
- `client/src/styles/layout-polish.css`
- `client/src/styles/interaction-polish.css`
- `client/src/styles/experience-upgrade.css`
- `client/src/styles/console-redesign.css`

**Authoritative token layer**: the unified design tokens live in the last-loaded `console-redesign.css` (Design System v2). Rules: each color has a single base; every `-bg` / `-border` / `-glow` is derived from it via `color-mix()`; themes (light/dark) only override the bases, never the derived values, so an accent can never drift out of sync with its own background. Other files must not add conflicting `:root` color definitions, hardcoded neon colors, or decorative glow / shine-sweep / infinite-pulse effects.

Consistent rules:

- separate layers with subtle borders and shadows
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
- Settings backup/status areas must expose runtime storage health, especially volatile data paths, read/write access, and corrupted JSON counts
- Status cards must keep a consistent height rhythm across expanded-sidebar, collapsed-sidebar, and narrow layouts
- Dashboard node health should switch to a priority view when many servers exist, keeping abnormal/offline nodes first and reducing first-screen height
- Server Management should switch to list cards below 1500px so common laptop widths with an expanded sidebar do not crush dense tables. Ultra-wide desktop tables must still keep the right action column visible so test, edit, and delete actions are never horizontally clipped
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
- Labels keep `whitespace-nowrap` during width animation
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

### Form rules

- Remove default browser focus outlines from inputs and buttons
- Standardize focus with `focus:outline-none focus:ring-2 focus:ring-blue-500/50`
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
