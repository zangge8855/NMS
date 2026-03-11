# NMS Gap Backlog

## 中文

### P0

- 完整梳理剩余页面的表格外壳与空状态，消除最后一批零散样式
- 为 Sidebar、Modal、Dropdown 再补一轮端到端交互回归
- 为数据库模式补充更完整的迁移、回滚和一致性检查脚本

### P1

- 抽象更多共享列表工具栏、过滤器和分页容器
- 为审计、订阅和节点页面补充更清晰的状态文案与错误提示
- 增加更多无障碍支持，包括键盘导航顺序和 aria 标注

### P2

- 增加细粒度角色与权限模型
- 引入更完整的通知中心和告警分级策略
- 提供更多可配置的仪表盘卡片与报表导出能力

### 技术债

- 继续减少页面级样式覆盖，优先回收到共享组件与样式层
- 数据存储层继续保持 route / service / repository 边界清晰
- 完善 Docker、PM2 和数据库模式下的自动化验证

## English

### P0

- Finish converging remaining table shells and empty states across less-polished pages
- Add another round of end-to-end interaction regression for Sidebar, Modal, and Dropdown behavior
- Expand migration, rollback, and consistency tooling for database mode

### P1

- Extract more shared list toolbars, filters, and pagination shells
- Improve status copy and error messaging in audit, subscription, and server pages
- Add broader accessibility coverage, including keyboard flow and aria labeling

### P2

- Introduce finer-grained roles and permissions
- Expand the notification center and alert severity handling
- Add more configurable dashboard cards and exportable reports

### Technical debt

- Continue reducing page-level style overrides in favor of shared components and style layers
- Keep route / service / repository boundaries explicit in the data layer
- Improve automated validation across Docker, PM2, and database-backed runtime modes
