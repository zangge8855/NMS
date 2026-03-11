# 3x-ui Alignment Matrix

## 中文

### 目的

本矩阵用于说明 NMS 与 3x-ui 面板能力之间的对齐关系，帮助开发、测试和运维判断哪些能力已经稳定映射，哪些能力仍然依赖面板差异或需要额外适配。

### 对齐矩阵

| NMS 侧能力 | 3x-ui 侧能力 | 当前状态 | 说明 |
| --- | --- | --- | --- |
| 节点接入 | 面板登录、会话保持 | 已对齐 | 由 `panelGateway` 与 `panelClient` 负责 |
| 能力探测 | 不同版本面板字段差异 | 已对齐 | `Capabilities` 页面用于显式展示探测结果 |
| 入站读取 | 入站列表与详情 | 已对齐 | 主要差异由协议目录与 schema 处理 |
| 用户 / 客户端管理 | client 增删改查 | 基本对齐 | 字段命名和协议细节仍可能因面板版本不同而有差异 |
| 订阅生成 | 节点信息、用户映射、token 访问 | 已扩展 | NMS 在 3x-ui 之上增加了独立 token 与公开订阅入口 |
| 日志与审计 | 面板日志、系统操作日志 | 已扩展 | NMS 增加了独立审计中心，不仅依赖面板原生日志 |
| 流量统计 | 节点与用户流量 | 基本对齐 | 展示聚合维度由 NMS 自定义 |
| 批量任务 | 面板原生无统一批量模型 | NMS 自建 | 批量任务与结果持久化完全由 NMS 提供 |

### 重点差异

- 3x-ui 关注单节点管理，NMS 关注多节点统一运营
- 3x-ui 的公开订阅能力不等于 NMS 的 token 化订阅中心
- 面板不同版本返回字段可能不完全一致，NMS 通过能力探测与 schema 适配减少耦合
- 审计、批量任务、系统设置属于 NMS 的平台化扩展，不是面板原生能力

### 验证建议

- 每次适配新的面板版本后，先检查 `Capabilities`
- 新增协议或字段时，同步更新协议 schema 与 UI 展示
- 对齐测试不要只看单次请求，还要看批量操作、订阅生成和回滚路径

## English

### Purpose

This matrix describes how NMS aligns with 3x-ui panel capabilities. It helps developers, testers, and operators understand which integrations are stable and which still depend on panel-version differences or additional adapters.

### Alignment matrix

| NMS capability | 3x-ui capability | Current state | Notes |
| --- | --- | --- | --- |
| Server onboarding | panel login and session handling | aligned | handled by `panelGateway` and `panelClient` |
| Capability detection | version-specific field differences | aligned | surfaced explicitly in the `Capabilities` page |
| Inbound reads | inbound list and detail | aligned | protocol catalog and schema mapping absorb most differences |
| User / client admin | client CRUD | mostly aligned | field naming and protocol detail can still vary by panel version |
| Subscription generation | node info, user mapping, token access | extended | NMS adds independent tokenized public subscription access |
| Logs and audit | panel logs and system actions | extended | NMS adds its own audit center beyond panel-native logs |
| Traffic analytics | node and user traffic | mostly aligned | aggregation and presentation are defined by NMS |
| Batch jobs | no consistent native batch model | NMS-owned | job orchestration and persistence are native NMS features |

### Key differences

- 3x-ui focuses on single-node administration; NMS focuses on multi-node operations
- 3x-ui public links are not the same thing as the NMS token-based subscription center
- Panel versions may return different field shapes; NMS reduces coupling through capability detection and schema mapping
- Audit, batch jobs, and system settings are platform features implemented by NMS

### Validation guidance

- After supporting a new panel version, validate the `Capabilities` page first
- When adding protocols or fields, update both schema mapping and UI rendering
- Alignment testing should cover batch operations, subscription generation, and rollback paths, not only single requests
