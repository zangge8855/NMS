# NMS 管理端 UI 设计基线

> 更新时间：2026-03-11

## 中文

### 1. 目标

这一版 UI 的目标不是做“监控大屏”或强赛博风，而是建立一套更稳定的企业后台视觉基线：

- 深色优先，亮色跟随
- 强调秩序、层级、留白和数据可读性
- 把首页、导航壳层、登录页和高频管理页先收口成同一套系统
- 完善全站的设备自适应（移动端抽屉式侧边栏与数据表格滚动）

### 2. 设计方向

当前主风格关键词：

- 企业感
- 克制
- 精准
- 高密度但不拥挤

避免的方向：

- 大面积高饱和霓虹发光
- 紫蓝绿多强调色同时竞争
- 过多持续动画
- 玻璃拟态过重导致信息发灰

### 3. 主题策略

- 默认主题：`dark`
- 保留主题切换：`dark -> light -> auto`
- 深色版作为主设计稿，亮色版只做同质映射，不另起一套语言
- 亮色版的 hover / focus / tab / tooltip / 次级按钮态必须使用同一套浅色 token，不能再出现悬浮后局部发黑的“深色补丁感”
- 亮色版的 `text-secondary` / `text-muted` 不能为了“轻”而牺牲可读性；副标题、说明字、表头、筛选说明和通知时间必须保持稳定可辨

实现位置：

- `client/src/contexts/ThemeContext.jsx`

### 4. 字体策略

- 界面字体：`IBM Plex Sans`
- 中文回退：`Noto Sans SC`
- 数字 / URL / 标识符：`JetBrains Mono`

实现位置：

- `client/index.html`
- `client/src/index.css`
- `client/src/ui-refresh.css`

### 5. 色彩与层级

核心基线：

- 主背景：深墨蓝
- 表面层：深蓝灰递进
- 强调色：钴蓝
- 语义色：绿色 / 橙色 / 红色，仅用于状态语义

原则：

- 主要靠亮度对比和边界，不靠强发光制造层级
- 工具条、表格、主卡片、次卡片必须有清晰层次
- 同一屏内控制强调色数量，默认只允许一个主强调

### 6. 布局规则

壳层规则：

- 桌面端侧边栏稳重、低噪音，激活态用实体底和细高亮条
- 移动端自动收起侧边栏，提供顶部汉堡菜单呼出抽屉式侧边栏
- 顶栏只承担上下文说明和核心操作，不堆叠装饰
- 顶栏搜索必须是可用的页面搜索入口，而不是只显示占位文案的装饰控件；键盘快捷键统一为 `Ctrl/Cmd + K`
- 内容区采用 `min-width: 0` 保护 Flexbox 边界，避免大表格溢出顶破全局布局

页面规则：

- 页面先有标题与副标题，再进入工具条
- 工具条承担过滤、范围、主动作
- 数据主体用表格壳或卡片壳统一收口

### 7. 组件基线

已重点收口的区域：

- 登录页
- 侧边栏
- 顶栏
- 首页仪表盘
- 节点健康卡
- 服务器管理
- 入站管理
- 用户管理
- 审计中心
- 系统设置

统一规则：

- 按钮圆角、边框、hover、focus 使用统一 token
- 表格表头与表体边界统一
- 批量条、筛选条、统计卡共享同一套表面层级
- 次级卡片使用 `mini-card` 语义，不再和主卡片同权
- 登录页使用单卡片居中布局，不再保留额外品牌展示区和营销式说明文案
- 顶栏搜索结果面板、筛选输入框和轻量下拉菜单在深浅主题下都使用同一套表面层级与文字 token

### 8. CSS 组织方式

基础样式：

- `client/src/index.css`

视觉覆盖层：

- `client/src/ui-refresh.css`

原则：

- 新的视觉收口优先写进 `ui-refresh.css`
- 业务组件只补稳定语义 class，不直接堆大量 inline style
- 组件逻辑和视觉 token 尽量分离

### 9. 当前验收重点

建议固定检查以下视口：

- `1440x900`
- `1024x768`
- `390x844`

重点验收页面：

- `/login`
- `/`
- `/servers`
- `/inbounds`
- `/clients`
- `/audit`
- `/settings`

本轮额外关注点：

- 亮色模式下仪表盘、服务器管理、审计中心、日志页的搜索框、标签页、图标按钮、次级按钮 hover / focus 是否仍出现发黑块
- 图表 tooltip、卡片 meta 区、筛选条和表格 hover 是否与浅色主题层级一致
- 顶栏搜索是否可输入、可键盘导航、可回车跳转，结果面板在深浅主题下都不应出现可读性下降
- 亮色模式下副标题、说明字、表头、通知时间和搜索结果 meta 是否仍然足够清晰，而不是发灰发虚

### 10. 后续迭代建议

下一轮优先级：

- `Tasks`
- `Logs`
- 各类 modal 与详情页
- 用户详情、订阅中心的深浅主题一致性

---

# NMS Admin UI Design Baseline

> Updated: 2026-03-11

## English

### 1. Goal

This UI pass is not meant to turn NMS into a flashy dashboard. The goal is to establish a stable enterprise admin baseline:

- dark-first, light as a mapped variant
- emphasis on hierarchy, rhythm, spacing, and data readability
- unify login, shell layout, dashboard, and high-frequency admin pages first
- complete and polished mobile responsiveness (drawer sidebar and table scroll)

### 2. Visual Direction

Current style keywords:

- enterprise
- restrained
- precise
- high-density without feeling cramped

Avoid:

- heavy neon glow
- too many competing accent colors
- constant decorative animations
- excessive glassmorphism that reduces contrast

### 3. Theme Strategy

- default theme: `dark`
- theme cycle remains: `dark -> light -> auto`
- dark is the primary reference, light follows the same visual language
- light mode hover, focus, tab, tooltip, and secondary-button states must use the same light token system instead of falling back to dark-looking overlays
- light-mode `text-secondary` and `text-muted` must stay readable; subtitles, helper copy, table headers, filter hints, and notification timestamps should not be faded into ambiguity

Implementation:

- `client/src/contexts/ThemeContext.jsx`

### 4. Typography

- UI type: `IBM Plex Sans`
- CJK fallback: `Noto Sans SC`
- numeric / URL / identifier type: `JetBrains Mono`

### 5. Color and Hierarchy

Core baseline:

- ink / navy background
- layered blue-gray surfaces
- cobalt primary accent
- semantic green / orange / red reserved for status

Rules:

- hierarchy comes from contrast and edges, not glow
- toolbars, data shells, primary cards, and secondary cards must be visually distinct
- one primary accent per screen by default

### 6. Layout Rules

Shell:

- sidebar is quiet and stable on desktop
- mobile auto-hides sidebar and relies on a top hamburger menu to reveal a drawer
- header is contextual, not decorative
- header search must be a real page-search entrypoint rather than a decorative placeholder, with `Ctrl/Cmd + K` as the shared shortcut
- main content block leverages `min-width: 0` to prevent inner flexbox tables from overflowing the global shell

Pages:

- title and subtitle first
- toolbar second
- data shell after that

### 7. Implementation Notes

- base styles live in `client/src/index.css`
- the current visual refinement layer lives in `client/src/ui-refresh.css`
- new visual work should prefer semantic classes plus centralized CSS instead of inline styles
- the login page now uses a centered single-card layout without a separate brand showcase block
- header search results, filter inputs, and lightweight dropdown surfaces should share the same text and surface tokens across dark and light themes

### 8. Current Acceptance Focus

Check these in both dark and light themes:

- `/login`
- `/`
- `/servers`
- `/audit`
- `/logs`
- `/settings`

Additional light-theme checks:

- search fields, tabs, icon buttons, and secondary buttons should not flash dark patches on hover or focus
- tooltips, filter bars, card meta sections, and table hover layers should stay within the same light hierarchy
- header search should accept input, support keyboard navigation, and keep its results readable in both themes
- subtitles, helper copy, table headers, notification timestamps, and search-result meta text should remain legible instead of washing out in light mode
