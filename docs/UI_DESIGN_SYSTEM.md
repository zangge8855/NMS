# UI Design System

## 中文

### 设计目标

NMS 的后台界面应优先满足三件事：稳定、清晰、可连续操作。界面不是营销页，重点是状态密度、风险提示、批量操作效率和低误触成本。

### 视觉基线

- 布局容器使用柔和分层，不使用生硬纯黑边框
- 卡片、下拉、弹窗统一采用 `rounded-xl`、柔和阴影与浅边框
- 按钮、输入框统一采用 `rounded-lg`
- 明暗模式都必须使用明确且不透明的表面色

### 全局 token

样式分散在三个文件中：

- `client/src/styles/ui-tokens.css`
- `client/src/styles/layout-polish.css`
- `client/src/styles/interaction-polish.css`

统一原则：

- 表面层级使用浅边框 + 阴影，而不是重描边
- Hover 使用 `transition-colors`
- Focus 使用统一 ring
- 浮层使用明确背景色和 `z-index`

### Layout

- Sidebar：支持展开、折叠和收起态 flyout
- Header：承载全局搜索、通知和当前上下文信息
- Content：保持稳定留白与滚动区域，不让浮层被裁切

### Sidebar 规范

- 当前激活项必须有明显背景区分与指示条
- 菜单文字在宽度过渡期间保持 `whitespace-nowrap`
- 收起态子菜单必须通过 Portal 或 `overflow-visible` 机制渲染
- 手风琴展开动画应避免 `display` 动画，优先使用 `max-height` 或 grid rows 技巧

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
- Select 必须有显式背景色，避免暗色模式下闪黑块

### 表格规范

- 表头默认吸顶
- 行 hover 明显，但不能干扰可读性
- 空数据时使用统一 Empty State 组件，不直接裸写“暂无数据”
- 滚动条统一细化并适配亮 / 暗模式

### Empty State 规范

- 使用共享 `EmptyState` 组件
- 支持默认版、紧凑版和带表面层次版
- 文案要说明下一步，而不只是一句“没有数据”

### 可访问性

- 交互控件要有可见焦点
- 键盘用户必须能关闭弹窗并切换主要导航
- 色彩对比度优先于装饰效果

## English

### Design goal

The NMS admin UI optimizes for stability, clarity, and uninterrupted operations. This is not a marketing site. The interface should prioritize state density, risk visibility, batch efficiency, and low error cost.

### Visual baseline

- Use soft separation instead of harsh black borders
- Cards, dropdowns, and modals share `rounded-xl`, soft shadow, and subtle borders
- Buttons and inputs share `rounded-lg`
- Both light and dark themes must use explicit opaque surfaces

### Global tokens

Styles are split across:

- `client/src/styles/ui-tokens.css`
- `client/src/styles/layout-polish.css`
- `client/src/styles/interaction-polish.css`

Consistent rules:

- separate layers with subtle borders and shadows
- use `transition-colors` for hover feedback
- keep a shared focus ring
- give floating panels explicit background color and stable z-order

### Layout

- Sidebar supports expanded, collapsed, and flyout states
- Header hosts global search, notifications, and context
- Content keeps stable spacing and scroll regions without clipping overlays

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
- Native selects need explicit backgrounds to avoid dark-mode flashing

### Table rules

- Headers should remain sticky
- Row hover should be visible without reducing readability
- Empty states should use the shared `EmptyState` component
- Scrollbars should be slim and theme-aware

### Empty state rules

- Use the shared `EmptyState` component
- Support default, compact, and surfaced variants
- Copy should describe the next useful action, not only "no data"

### Accessibility

- Interactive elements must keep visible focus
- Keyboard users must be able to close modals and navigate primary layout areas
- Color contrast has higher priority than decorative effects
