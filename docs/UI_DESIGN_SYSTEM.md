# UI Design System (Ant Design Refactor)

## 中文

### 设计目标
NMS 的后台界面已全面重构为 **Ant Design (React)** 架构。重构目标是提升排版专业度、操作效率以及移动端适配能力，同时建立统一的“科技/暗黑风 (Sci-Fi / Dark Mode)”视觉基调。

### 视觉基线
- **主题**：基于 Ant Design 的 `darkAlgorithm`。
- **色彩**：深黑色背景 (`#000000`)，配合高科技感十足的霓虹蓝 (`#6366f1`) 作为主色调。
- **圆角与边框**：采用更细腻的圆角控制 (`borderRadius: 6`) 和半透明细边框，增强层次感。
- **字体**：优先使用系统无衬线字体及 `IBM Plex Sans`，确保双语排版清晰、极简。

### 核心框架：Ant Design
我们不再依赖大量零散的自定义 CSS 类（如 `.btn`, `.form-input`），而是全面使用 Ant Design 组件：
- **布局**：使用 `<Layout>`, `<Sider>`, `<Header>`, `<Content>`。
- **表单**：使用 `<Form>`, `<Input>`, `<Select>`, `<Switch>`, `<Checkbox>`, `<InputNumber>`。
- **数据展示**：使用 `<Table>`, `<Card>`, `<Descriptions>`, `<Statistic>`, `<Badge>`, `<Tag>`, `<Timeline>`。
- **反馈**：使用 `<Modal>`, `<Drawer>`, `<Message>`, `<Notification>`, `<Alert>`, `<Spin>`。

### 主题配置 (Theme Tokens)
全局主题通过 `client/src/contexts/ThemeContext.jsx` 中的 `<ConfigProvider>` 进行集中管理，不再散落在多个 `.css` 文件中。
- **colorPrimary**: `#6366f1` (Indigo/Neon Blue)
- **colorBgBase**: `#000000` (Pure Black)
- **colorBgContainer**: `#121214` (Deep Slate)
- **Table/Card/Layout**: 均进行了特定的深色透明度优化。

### 响应式规范
- 布局和栅格全面适配 Antd 的 `xs` (手机), `sm`, `md` (平板), `lg`, `xl` (PC) 断点。
- **侧边栏 (Sidebar)**：PC 端支持折叠态，移动端自动转为抽屉模式。
- **表格 (Table)**：在小屏幕上默认启用横向滚动，确保关键列可读。

---

## English

### Design Goal
The NMS admin UI has been fully refactored to use **Ant Design (React)**. The goal is to establish a professional, efficient, and responsive interface with a "Sci-Fi / Dark Mode" aesthetic.

### Visual Baseline
- **Theme**: Based on Ant Design's `darkAlgorithm`.
- **Colors**: Pure black background (`#000000`) with high-tech Neon Blue (`#6366f1`) as the primary accent.
- **Radius & Borders**: Refined corner radius (`borderRadius: 6`) and subtle translucent borders for depth.
- **Typography**: Prefers system sans-serif and `IBM Plex Sans` for clear, minimalist bilingual layouts.

### Core Framework: Ant Design
Legacy custom CSS classes (like `.btn`, `.form-input`) have been replaced by Ant Design components:
- **Layout**: `<Layout>`, `<Sider>`, `<Header>`, `<Content>`.
- **Forms**: `<Form>`, `<Input>`, `<Select>`, `<Switch>`, `<Checkbox>`, `<InputNumber>`.
- **Data Display**: `<Table>`, `<Card>`, `<Descriptions>`, `<Statistic>`, `<Badge>`, `<Tag>`, `<Timeline>`.
- **Feedback**: `<Modal>`, `<Drawer>`, `<Message>`, `<Notification>`, `<Alert>`, `<Spin>`.

### Theme Management
Global tokens are managed via the `<ConfigProvider>` in `client/src/contexts/ThemeContext.jsx`.
- **Primary Color**: `#6366f1`
- **Base Background**: `#000000`
- **Component Backgrounds**: Optimized for transparency and depth in dark mode.

### Responsive Standards
- Full adherence to Antd's grid breakpoints: `xs`, `sm`, `md`, `lg`, `xl`.
- **Sidebar**: Collapsible on Desktop, transitions to Drawer on Mobile.
- **Tables**: Responsive horizontal scrolling enabled for all data grids.
