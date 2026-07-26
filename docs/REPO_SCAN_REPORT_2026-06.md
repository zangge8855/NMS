# NMS 仓库全面扫描报告（UI + Bug + 设计）

扫描日期：2026-06-10。方法：7 个并行子代理审计服务端/客户端各层 + 双主题(dark/light)+移动端全页面 Playwright 截图视觉审查 + 设计系统/i18n 一致性核对。

> **2026-07-26 复核**：5 个并行核查代理逐项对照当前代码 + 双主题 28 页截图重新验证。绝大多数条目已在 M1/M2 及 flagship 重构中修复；本轮补齐残余项（见各条目注记），并额外修复复核中新发现的问题（见文末"2026-07-26 新增修复"）。测试基线：服务端 535 通过 / 客户端 260+ 通过 / lint 0 警告。

图例：严重度 `critical/high/medium/low` · 置信度 `high/medium/low`。状态：☐ 待修 / ✅ 已修 / ⏭️ 暂不修(说明原因)。

---

## A. 服务端 — 数据完整性（最高危）

- ✅ **[high] trafficStatsStore.js** 面板拉取失败仍记录 0 字节快照 → 巨型假尖峰/基线清零。已修（M1）：失败节点不写 0 基线。
- ✅ **[high] fileUtils.js** 原子写 catch 过宽 → 截断损坏、静默重置。已修（M1）：仅 rename 失败才回退（`saveObjectAtomic`）。
- ✅ **[high] auditStore.js** 并发保存同文件临时名碰撞 → 丢条目。已修（M1）：串行化写入。
- ✅ **[medium] storeRegistry.js** 恢复备份对 audit/traffic 只写内存。已修（M1）：恢复后显式落盘。
- ✅ **[medium] systemSettingsStore.js** Telegram 校验前污染内存。已修（M1）：先校验后赋值。
- ✅ **[medium] index.js + snapshots.js** 优雅关机不 flush DB 队列。已修（M1）。
- ✅ **[medium] subscriptionSyncService.js** 删用户面板不可达即静默跳过。已修（8fd56bc）：记录并可重试。

## B. 服务端 — 路由/批量/面板集成

- ✅ **[high] jobStore.js + batch.js** 批量重试回放 `[REDACTED]` 快照。已修：内存保留未脱敏请求（`retryRequestCache`），重启后含密文快照直接 409 拒绝回放。
- ✅ **[high] batch.js** user_sync 重试裸 async 未捕获拒绝 → 请求挂起。已修：`retryHistoryItem` 全路径 try/catch + 外层兜底。
- ✅ **[high] panelApiCompat.js + batch.js** 不校验 3x-ui `success:false`。已修：`assertPanelResponseSuccess` 全覆盖。
- ✅ **[medium] userPolicy.js** PUT 回传 passwordHash/salt。已修：服务层不再返回用户记录 + 路由白名单双保险。
- ✅ **[medium] users.js + subscriptionTokenStore.js** 缺省 ttlDays 永不过期。已修：默认 30 天；2026-07-26 加固 store 层（`ttlDays<=0` 不再隐式永久，仅显式 `noExpiry` 可）。
- ✅ **[medium] batch.js** enable/disable 稀疏输入重建 → 清空字段。已修：读取现网数据仅翻转 enable / `/setEnable` 定向操作。
- ✅ **[medium] clientEntitlementService.js** 空 email OR 匹配无守卫。已修；2026-07-26 追加 follow_policy 空邮箱 400 守卫。
- ✅ **[low] userGroups.js** 非法数字→0(=无限) 静默接受。2026-07-26 已修：非法数值返回 400（userGroups + userPolicy 同步加固），空值仍为"不限"。
- ✅ **[low] users.js** mergeAuditResults 伪造 total。已修：total=去重条数（子查询各 50 条上限内如实计数）。
- ✅ **[low] jobStore markCanceled 永不成功。2026-07-26 已修：批量历史只记录终态，cancel 语义不成立 → 移除死路由与 `markCanceled`；taskQueue 已具备非终态清理（12h prune）。

## C. 服务端 — 监控/告警/Telegram

- ✅ **[high] dashboardSnapshotService.js + serverStatusService.js** 单服务器请求污染全局快照缓存。已修：scoped 请求不读写全局缓存。
- ✅ **[high] telegramAlertService.js** 备份失败时间戳取错 → 零延迟无限重试。已修：`max(lastSuccess, lastAttempt)`。
- ✅ **[medium] telegramAlertService.js** 节点恢复 INFO 被严重度白名单挡掉。已修：恢复通知绕过白名单。
- ✅ **[medium] notifications.js** 非原子写。已修：`saveObjectAtomic` + 防抖。（损坏文件启动时由生产预检 `collectStartupIssues` 明确报告 — 有意的 fail-fast 设计。）
- ✅ **[medium] serverHealthMonitor.js** 恢复告警宕机时长=一个轮询周期。已修：持久化 `outageStartedAt` 计真实时长。
- ✅ **[low] ipIspResolver.js** 刷新全失败清空记录。已修；2026-07-26 追加部分失败保护：部分源失败时保留更全数据集 + 短 TTL 重试。
- ✅ **[low] telegram/commands/servers.js** 在线数 NaN。已修；2026-07-26 追加 CPU/MEM 字段同类 NaN 守卫。
- ✅ **[low] per-server 缓存删除不清理。2026-07-26 已修：删除节点时逐出 `cpuHistoryCache` 与 `throughputBaselineByServerId`（panel 快照缓存此前已清理）。

## D. 客户端 — 功能 Bug

- ✅ **[high] UserPolicyModal.jsx** 限速单位三套不一致。已修：统一走 `utils/entitlements.js` 转换（KB/s↔B/s）。
- ✅ **[high] xrayConfig.js + XrayConsole.jsx** 保存响应丢 template → 配置回退。已修：服务端回传 template；2026-07-26 追加响应缺 template 时强制 `loadConfig()` 重同步。
- ✅ **[medium] Inbounds.jsx** 刷新按钮把 click 事件当 options。已修：`fetchAllInbounds({ force: true })`。
- ✅ **[medium] XrayJsonEditor.jsx** 提交 null 被 strict 解析拒绝。已修：显式 JSON 序列化 + `express.json({ strict: false })`。
- ✅ **[medium] ModalShell.jsx** 一次 Escape 关闭所有堆叠模态。已修：共享 modalStack 仅顶层响应；2026-07-26 将 QR 放大层纳入同一栈（修复"QR 覆盖模态时 Escape 双关"）。
- ✅ **[medium] useTrafficLeaderboardTrends.js** 依赖数组含原始数组 → 周期性重发。已修：memo 键 + requestId 守卫。
- ✅ **[medium] ClientModal.jsx / ConflictScannerModal** 批量编辑丢字段。已修：payload 含 comment/reset/speedLimit。
- ✅ **[medium] RoutingRulesEditor.jsx** 双状态分叉丢编辑。已修：双向同步；2026-07-26 追加修复 updateRule 原地改 state。
- ✅ **[medium] panelClientIps.js** 重复 IP 合并结果被丢弃。已修：合并写回。
- ✅ **[medium] SystemSettings.jsx 数字输入** 清空即回填。已修：保留原始输入串，保存时钳制。
- ✅ **[low] UsersHub.jsx** 成员预览多余 `$`。已修。
- ✅ **[low] format.js** copyToClipboard 失败仍返回 true。已修。
- ✅ **[low] useAnimatedCounter.js** 计数器卡中间值。已修：逐帧更新 from 值。
- ✅ **[low] UserDetail.jsx** 总流量无单位。已修：`formatBytes`。
- ✅ **[low] NodeHealthGrid.jsx** 整页刷新 + memPercent 除零。已修：router navigate + total>0 守卫。
- ✅ **[low] UsersHub.jsx** 全选对比隐藏选择。已修：可见行范围。
- ✅ **[low] Logs.jsx + VirtualList** 换行日志裁剪重叠。已修：换行模式禁用虚拟化。
- ✅ **[low] AuditCenter.jsx** 趋势请求不守选中实体。已修：entity + window 双守卫。
- ✅ **[low] ExpandableQRCode.jsx** 未清理 timeout；复制静默失败。已修：清理 + toast 报错。
- ✅ **[low] Server.jsx** 孤立死代码页。已删除（`/server` 重定向到设置）；2026-07-26 清理残留的失效测试 mock。

## E. 设计系统 / 主题

> 2026-07 前提变化：6 个旧样式层（console-redesign 等，~29k 行）已整体删除，当前权威层为 `styles/flagship-console.css`（最后加载），功能色为蓝色系（dark `#2f7df6` / light `#2569db`）。以下按"问题类别是否仍存在于现行文件"复核。

- ✅ **[high] 暗色主题白底白字**（.timeline-item 等）。已消除：现行文件无无守卫浅色字面量（QR 白底、开关旋钮等为合法组件填充）。
- ✅ **[high] 仪表盘 legacy 青色功能色**。已消除：四个现行 CSS 文件 0 处青色。
- ✅ **[medium] `--aurora-ramp` 硬编码。已随旧层删除。
- ✅ **[medium] indigo 字面量不走 token**。2026-07-26 收尾：restrained-ui 残留的 6 处 `rgba(99,102,241,*)` 与 indigo 十六进制全部统一到旗舰蓝 token 值（原为被覆盖的死值，清除防漂移）。
- ✅ **[medium] 暗色 dropdown 硬编码 `#0f0f13`。已消除：overlay/floating 走 token。
- ✅ **[medium] :focus-visible 硬编码 + 双风格**。2026-07-26 修复：补定义缺失的 `--focus-ring-border` token（此前 4 处引用无定义），dark/light 双主题补齐 `--accent-info`/focus token。
- ⏭️ **[medium] 移动端两套滚动模型 / z-index 字面量与 token 混用**：现行值无危险倒置（dropdown 9999 已不存在）；纯 token 化迁移列入技术债，不动行为。
- ✅ **[low] 入站协议 pill 文字裁剪**（SHADOWSOCKS→"ADOWSO"）。已消除：列宽 140px + overflow visible；截图复核完整显示。
- ✅ **[low] legacy royal-blue 字面量泄漏**。audit tab 现行规则已走 var()；`--accent-info` 泄漏已于 2026-07-26 在旗舰层对齐。

## F. i18n

> **2026-07-26 运行时复核**：以 en-US locale 实际渲染全部 14 个路由并提取页面文本，**除语言切换按钮的"中"字外 0 处中文残留**。此前静态扫描的 CJK 行数把双语 copy-object（`AUDIT_COPY['en-US']`、`SERVER_ENV_LABELS_EN`、`isEnglish ? {...} : {...}` 等合法模式）的中文分支误计为硬编码。

- ✅ **[high] ServerDetail.jsx** 硬编码中文。已修：95 处 `t()`，`pages.serverDetail.*` 81 键双语齐全。
- ✅ **[medium] SystemSettings.jsx** 硬编码中文。已修：523 处 `t()`，`comp.system.*` 双语齐全（2026-07-26 顺带英化 2 条代码注释）。
- ✅ **[medium] `|| '中文'` 兜底 / 共享组件中文 aria**。已消除：全库 0 处该模式；ListToolbar/ActionsDropdown/ConfirmContext/ExpandableQRCode 均无 CJK。
- ✅ messages.js zh-CN/en-US 键集对齐：2026-07-26 补齐唯一漂移键 `pages.inbounds.cols.kind`（zh 缺失），现 1771/1771。

---

## 视觉总评（截图）
整体设计**已是高端水准**（Linear/Stripe 档）：dark/light 双主题干净专业、旗舰午夜蓝控制台、仪表盘 hero、卡片/表格密度得当、移动端布局合理。

### 2026-07-26 截图复审新发现并修复
- ✅ **[high] 订阅中心三个巨型黑色实心圆**：`CircularMeter` 的 `.circular-meter-*` 样式随旧层删除成为孤儿 → SVG circle 默认黑色填充撑满整列（页面高 2555px）。已按旗舰 token 重建（`overlay-restore.css` 第 5 节），恢复为紧凑双列环形仪表。
- ✅ **[medium] 日志页级别统计 chips 无样式重叠**：`.logs-level-summary/.logs-level-chip` 同为孤儿样式，已按 color-mix token 重建为可点击过滤 chips。
- ✅ **[medium] 共享分页布局丢失**：`.page-pagination*` 孤儿样式（"上一页 1/1 下一页"挤成一团），已复原 flex 布局。
- ✅ **[medium] 订阅状态卡邮箱溢出裁剪**：`.subscription-email-link` 改为可换行。
- ✅ **[low] 入站表节点列 124px（中档宽度 116px）全部截断为"REVIEW ⋯"**：放宽至 190px / 断点 170px。
- ✅ **[low] 设置页就绪值硬省略**（"认证失败 1 · 拒…"）：允许换行。
- ✅ **[low] servers 粘性操作列接缝**（亮色更明显）：阴影再降至近不可见。
- ✅ **[low] 桌面 toast 遮挡顶栏**：容器下移至 header 之下。
- ✅ **[low] ServerDetail KPI "3 / 4 会话"单位与数值同级**：后缀降级为小号次要文本。

## 2026-07-26 新增修复（复核代理发现，非原扫描项）
- ipIspResolver 部分源失败时整库被部分集覆盖 24h（数据丢失）→ 保留更全集 + 短 TTL 重试（含回归测试）。
- subscriptionTokenStore `ttlDays<=0` 隐式永久 token 足枪 → 仅显式 `noExpiry` 可永久（含回归测试）。
- clientEntitlementService follow_policy 空邮箱击穿至全局默认策略 → 400 守卫（含回归测试）。
- Telegram /servers MEM/CPU 非数值载荷渲染 NaN% → 有限性守卫（含回归测试）。
- 删除节点后 `cpuHistoryCache` / `throughputBaselineByServerId` 永久泄漏 → 删除路由逐出（含回归测试）。
- QR 放大层叠加模态时 Escape 双关闭 → 纳入共享 modalStack。
- RoutingRulesEditor 原地修改 React state → 复制后更新。
