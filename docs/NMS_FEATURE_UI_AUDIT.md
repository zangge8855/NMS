# NMS Feature And UI Audit

## 中文

审计日期：2026-03-11

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

### 当前状态良好区域

- Layout、Sidebar、Header 的信息层级明显优于旧版
- 监控、节点管理、订阅和审计主路径可连续操作
- 明暗模式下的浮层稳定性明显提升
- 关键操作的 hover / active / focus 反馈已可接受
- Logs、Tasks、Tools 这类次级运维页面也开始跟随同一套卡片、表格和空状态规范

### 仍建议继续优化的区域

- 各业务页仍有少量零散的列表容器样式，后续应继续收敛到统一表格外壳
- 非核心页面的 Empty State 仍可继续替换为共享组件
- 一些业务文案仍偏工程化，后续可以优化为更面向运维人员的提示
- 更细粒度的键盘导航和无障碍提示仍有提升空间

### 风险点

- 历史样式覆盖较多时，后续新增页面可能重新引入局部不一致
- 如果新增第三方浮层组件，必须遵守现有的 portal、层级与过渡规则
- 如果在低性能设备上重新启用重度模糊效果，闪烁问题可能复发

### 结论

当前版本已经完成本轮最重要的后台 UI 稳定性修复，可以作为后续页面统一重构的基线。下一阶段重点应从“修 bug”转向“收敛样式与组件复用”。

## English

Audit date: 2026-03-11

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
- The login page now exposes self-service password reset by email code, while the public response stays generic so the flow does not reveal whether an email is registered
- The subscription page now centers the user flow around “choose profile -> copy address -> import client”, keeps the QR code beside the address, and switches quick-import actions with the selected profile
- Native select styling has been tightened again so the global dropdown menu no longer falls back to black native popups on Chromium

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

### Risk points

- If future pages add ad hoc overrides, style drift can return
- Any newly introduced overlay library must follow the existing portal, z-index, and transition rules
- Reintroducing heavy blur on low-performance devices can bring flicker back

### Conclusion

The current build resolves the most important admin UI stability issues and is a valid baseline for broader page unification. The next phase should shift from bug fixing to style convergence and component reuse.
