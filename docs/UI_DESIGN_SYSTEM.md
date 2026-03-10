# NMS 管理端 UI 设计基线

> 更新时间：2026-03-10

## 中文

### 1. 目标

这一版 UI 的目标不是做“监控大屏”或强赛博风，而是建立一套更稳定的企业后台视觉基线：

- 深色优先，亮色跟随
- 强调秩序、层级、留白和数据可读性
- 把首页、导航壳层、登录页和高频管理页先收口成同一套系统

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

- 侧边栏稳重、低噪音，激活态用实体底和细高亮条
- 顶栏只承担上下文说明和核心操作，不堆叠装饰

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

### 10. 后续迭代建议

下一轮优先级：

- `Tasks`
- `Logs`
- 各类 modal 与详情页
- 用户详情、订阅中心的深浅主题一致性

---

# NMS Admin UI Design Baseline

> Updated: 2026-03-10

## English

### 1. Goal

This UI pass is not meant to turn NMS into a flashy dashboard. The goal is to establish a stable enterprise admin baseline:

- dark-first, light as a mapped variant
- emphasis on hierarchy, rhythm, spacing, and data readability
- unify login, shell layout, dashboard, and high-frequency admin pages first

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

- sidebar is quiet and stable
- header is contextual, not decorative

Pages:

- title and subtitle first
- toolbar second
- data shell after that

### 7. Implementation Notes

- base styles live in `client/src/index.css`
- the current visual refinement layer lives in `client/src/ui-refresh.css`
- new visual work should prefer semantic classes plus centralized CSS instead of inline styles
