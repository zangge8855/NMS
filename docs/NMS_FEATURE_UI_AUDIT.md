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

### 当前状态良好区域

- Layout、Sidebar、Header 的信息层级明显优于旧版
- 监控、节点管理、订阅和审计主路径可连续操作
- 明暗模式下的浮层稳定性明显提升
- 关键操作的 hover / active / focus 反馈已可接受

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

### Areas in good shape

- Layout, Sidebar, and Header now have clearer hierarchy than the previous baseline
- The main operating paths across monitoring, server management, subscriptions, and audit are stable
- Floating panel behavior in both light and dark themes is much more consistent
- Hover, active, and focus feedback is now acceptable for core actions

### Recommended follow-up areas

- Some feature pages still use isolated list container styles and should converge on a shared table shell
- More non-core pages can still migrate to the shared `EmptyState`
- Some operational copy is still too engineering-oriented and can be improved for operators
- Keyboard navigation depth and accessibility hints still have room to improve

### Risk points

- If future pages add ad hoc overrides, style drift can return
- Any newly introduced overlay library must follow the existing portal, z-index, and transition rules
- Reintroducing heavy blur on low-performance devices can bring flicker back

### Conclusion

The current build resolves the most important admin UI stability issues and is a valid baseline for broader page unification. The next phase should shift from bug fixing to style convergence and component reuse.
