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
| 入站协议覆盖 | vmess/vless/trojan/ss/http/tunnel/mixed/wireguard/tun/mtproto/hysteria/tuic/amneziawg/masque | 已对齐（v3.11.0） | 3x-ui 没有 `hysteria2` 协议：NMS 创建 Hysteria2 入站时会转换为 `protocol: "hysteria"` + `version: 2`，客户端凭据写入 `auth`；s-ui 节点保持 `hysteria2` |
| Hysteria2 / TUIC 客户端 | `auth`（Hysteria）、原生 TUIC `uuid` + `password` | 已对齐 | 托管用户会为这两类入站写入凭据；订阅链接读取 `finalmask` 中的 salamander 与 udphop 端口跳跃，以及 TUIC 的 `settings.server` |
| 入站更新语义 | v3.9.0 起 `/inbounds/update` 不再修改客户端与启用状态 | 已对齐 | 启用/禁用优先走 `/inbounds/setEnable/:id`，客户端走 `/panel/api/clients/*`，旧接口仅作回退 |
| Xray 路由 / 出站 / DNS / 负载均衡 | v3.0 Xray Settings 页 | 已对齐 | 通过 `server/services/xrayConfigService.ts` + `/xray` 页面读写，api 规则强制保持第一条 |
| 订阅生成 | 节点信息、用户映射、token 访问 | 已扩展 | NMS 在 3x-ui 之上增加了独立 token 与公开订阅入口 |
| 日志与审计 | 面板日志、系统操作日志 | 已扩展 | NMS 增加了独立审计中心，不仅依赖面板原生日志 |
| 流量统计 | 节点与用户流量 | 基本对齐 | 展示聚合维度由 NMS 自定义 |
| 批量任务 | 面板原生无统一批量模型 | NMS 自建 | 批量任务与结果持久化完全由 NMS 提供 |
| 多节点部署 | v3.0 `runtime/{local,manager,remote}` | NMS 自建 | NMS 沿用自有多节点架构，不跟随上游协议 |

### 重点差异

- 3x-ui 关注单节点管理，NMS 关注多节点统一运营
- 3x-ui 的公开订阅能力不等于 NMS 的 token 化订阅中心
- 面板不同版本返回字段可能不完全一致，NMS 通过能力探测与 schema 适配减少耦合
- 审计、批量任务、系统设置属于 NMS 的平台化扩展，不是面板原生能力

### v3.11.0 备注

- 对照版本：3x-ui v3.11.0（2026-10-25）。
- v3.8.0 起无效 Bearer Token 返回 401（不再是 404），NMS 按认证失败处理。
- v3.11.0 起 `openapi.json` 需要登录，节点 API Token 只写不读；NMS 不依赖这两项。
- 上游新增但 NMS 暂未使用的接口：`clients/list/paged`、`get/subId`、`get/tgId`、批量客户端接口、客户端分组、hosts、订阅负载均衡、Xray 出站订阅。

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
| Inbound protocol coverage | vmess/vless/trojan/ss/http/tunnel/mixed/wireguard/tun/mtproto/hysteria/tuic/amneziawg/masque | aligned (v3.11.0) | 3x-ui has no `hysteria2` protocol: NMS sends Hysteria2 inbounds as `protocol: "hysteria"` with `version: 2` and client `auth`; s-ui nodes keep `hysteria2` |
| Hysteria2 / TUIC clients | `auth` (Hysteria), native TUIC `uuid` + `password` | aligned | managed users get credentials on these inbounds; share links read salamander and udphop port hopping from `finalmask`, and TUIC options from `settings.server` |
| Inbound update semantics | since v3.9.0 `/inbounds/update` no longer changes clients or the enable flag | aligned | enable toggles use `/inbounds/setEnable/:id` first and clients use `/panel/api/clients/*`; legacy routes are fallbacks only |
| Xray routing / outbounds / DNS / balancers | v3.0 Xray Settings page | aligned | reads and writes via `server/services/xrayConfigService.ts` and the `/xray` console; the api rule is forced first |
| Subscription generation | node info, user mapping, token access | extended | NMS adds independent tokenized public subscription access |
| Logs and audit | panel logs and system actions | extended | NMS adds its own audit center beyond panel-native logs |
| Traffic analytics | node and user traffic | mostly aligned | aggregation and presentation are defined by NMS |
| Batch jobs | no consistent native batch model | NMS-owned | job orchestration and persistence are native NMS features |
| Multi-node deployment | v3.0 `runtime/{local,manager,remote}` | NMS-owned | NMS keeps its own multi-node design rather than adopting the upstream protocol |

### Key differences

- 3x-ui focuses on single-node administration; NMS focuses on multi-node operations
- 3x-ui public links are not the same thing as the NMS token-based subscription center
- Panel versions may return different field shapes; NMS reduces coupling through capability detection and schema mapping
- Audit, batch jobs, and system settings are platform features implemented by NMS

### v3.11.0 notes

- Checked against 3x-ui v3.11.0 (2026-10-25).
- Since v3.8.0 a bad Bearer token returns 401 instead of 404; NMS treats it as an auth failure.
- Since v3.11.0 `openapi.json` requires login and node API tokens are write-only; NMS relies on neither.
- Upstream endpoints NMS does not use yet: `clients/list/paged`, `get/subId`, `get/tgId`, bulk client endpoints, client groups, hosts, subscription balancers and Xray outbound subscriptions.

### Validation guidance

- After supporting a new panel version, validate the `Capabilities` page first
- When adding protocols or fields, update both schema mapping and UI rendering
- Alignment testing should cover batch operations, subscription generation, and rollback paths, not only single requests
