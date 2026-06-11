# NMS 仓库全面扫描报告（UI + Bug + 设计）

扫描日期：2026-06-10。方法：7 个并行子代理审计服务端/客户端各层 + 双主题(dark/light)+移动端全页面 Playwright 截图视觉审查 + 设计系统/i18n 一致性核对。

图例：严重度 `critical/high/medium/low` · 置信度 `high/medium/low`。状态：☐ 待修 / ✅ 已修 / ⏭️ 暂不修(说明原因)。

---

## A. 服务端 — 数据完整性（最高危）

- ☐ **[high] trafficStatsStore.js:1031,1186** 面板拉取失败仍记录 0 字节快照 → 下次成功时把累计计数器当成单周期流量，产生巨型假尖峰；全节点宕机时把基线清零。修：失败时 `inbounds: null`，`hasLiveTotalsSnapshot` 只计成功节点。
- ☐ **[high] fileUtils.js:17-69** 原子写 catch 过宽，临时文件写失败时回退直写真实文件 → 截断损坏；userStore 随后静默重置为默认 admin，永久丢号。修：仅 rename 失败才回退；load 失败不覆盖。
- ☐ **[high] auditStore.js:44-194** 并发 fire-and-forget 异步保存同一文件，临时名 `pid.Date.now()` 同毫秒碰撞 → 丢条目/JSON 损坏/审计历史清空。修：每文件串行化写 + 临时名加随机后缀/计数器。
- ☐ **[medium] storeRegistry.js:252** 恢复备份对 audit/traffic（无 `_save`）只写内存，重启回滚但报告"已恢复"。
- ☐ **[medium] systemSettingsStore.js:908** Telegram 校验前先改 `this.settings` → 一次坏更新污染内存，后续所有设置更新都抛同样错误。
- ☐ **[medium] index.js:212 + snapshots.js** 优雅关机从不 flush DB 快照队列；db 模式下丢最近写入。
- ☐ **[medium] subscriptionSyncService.js:647** 删用户时面板不可达 → bare continue，客户端永久残留有效凭据，无记录。

## B. 服务端 — 路由/批量/面板集成

- ☐ **[high] jobStore.js + batch.js:935** 批量重试回放被脱敏(`[REDACTED]`)的请求快照 → 要么重试 0 目标，要么用字面量 `[REDACTED]` 覆盖真实客户端密码。
- ☐ **[high] batch.js:1228** user_sync 重试未捕获 promise 拒绝（Express4 裸 async）→ 目标用户已删时请求永久挂起。
- ☐ **[high] panelApiCompat.js:296,535 + batch.js** add/delete client 与裸 postForm 不校验 3x-ui 的 `success:false`（HTTP200）→ 失败当成功。
- ☐ **[medium] userPolicy.js:183** PUT 响应回传原始 user 记录（含 passwordHash/salt）。
- ☐ **[medium] users.js:175 + subscriptionTokenStore.js:191** 不传 ttlDays 静默创建永不过期 token。
- ☐ **[medium] batch.js:564,662** enable/disable 用稀疏输入重建完整 client/inbound → 清零配额/到期/清空 inbound 全部客户端。
- ☐ **[medium] clientEntitlementService.js:62** 空 email 的 OR 匹配无真值守卫 → 改到错误客户端。
- ☐ **[low] userGroups.js:37** 非法数字→NaN/0(=无限)，静默接受。
- ☐ **[low] users.js:34** mergeAuditResults 伪造 total。
- ☐ **[low] jobStore markCanceled 永不成功；taskQueue 非终态不清理。

## C. 服务端 — 监控/告警/Telegram

- ☐ **[high] dashboardSnapshotService.js:794 + serverStatusService.js:472** 单服务器请求污染全局集群快照缓存 → 刷新单节点后 10-20s 内所有集群消费者只看到一个节点。
- ☐ **[high] telegramAlertService.js:277** 每日备份失败 + 旧成功记录 → `lastBackupAt||lastBackupAttemptAt` 取错时间戳 → 零延迟无限重试（同步 gzip+加密+API 轰炸）。
- ☐ **[medium] telegramAlertService.js:1534** 节点恢复通知 INFO 级被严重度白名单(默认 warning,critical)挡掉 → 永不送达。
- ☐ **[medium] notifications.js:70** 非原子 writeFileSync，崩溃中途损坏 → 启动预检 hard-exit。
- ☐ **[medium] serverHealthMonitor.js:39** 恢复告警把宕机时长算成一个轮询周期。
- ☐ **[low] ipIspResolver.js:227** 刷新全失败时清空已加载记录。
- ☐ **[low] telegram/commands/servers.js:48** 在线用户数渲染成 NaN。
- ☐ **[low] 多处 per-server 缓存删服务器后不清理（缓慢泄漏）。

## D. 客户端 — 功能 Bug

- ☐ **[high] UserPolicyModal.jsx:71,120** 限速单位三套 UI 不一致（一处 MB/s ×1024²，另两处 raw KB/s）→ 写错执行值。
- ☐ **[high] xrayConfig.js:76 + XrayConsole.jsx:146** 保存响应丢 `template` → Log/Policy/Advanced 编辑器留旧值、再保存把旧模板推回节点(配置回退)。
- ☐ **[medium] Inbounds.jsx:1395** 刷新按钮把 click 事件当 options 传 → force 永不为真，30s 内刷新无效。
- ☐ **[medium] XrayJsonEditor.jsx:38** "提交 null 清空"被 axios+express.json strict 破坏(400)。
- ☐ **[medium] ModalShell.jsx:195** 一次 Escape 关闭所有堆叠模态；focus trap 互抢。
- ☐ **[medium] useTrafficLeaderboardTrends.js:98** 依赖数组含原始数组 → 每 60s 重发最多 20 请求。
- ☐ **[medium] ClientModal.jsx:422 / ConflictScannerModal** 批量编辑丢 speedLimit/comment/reset。
- ☐ **[medium] RoutingRulesEditor.jsx:99** 可视/JSON 双状态分叉，切换丢未保存编辑。
- ☐ **[medium] panelClientIps.js:83** 重复 IP 合并结果被丢弃，少报命中数。
- ☐ **[medium] SystemSettings.jsx 数字输入** 清空即回填默认值，min 不校验。
- ☐ **[low] UsersHub.jsx:2132** 成员预览渲染出多余字面量 `$`。
- ☐ **[low] format.js:181** copyToClipboard 失败仍返回 true。
- ☐ **[low] useAnimatedCounter.js** 目标来回跳时计数器卡在中间值。
- ☐ **[low] UserDetail.jsx:1580** 总流量统计卡渲染无单位 MiB 数字。
- ☐ **[low] NodeHealthGrid.jsx:313** 空态用 window.location.href 整页刷新；memPercent 除零→Infinity%。
- ☐ **[low] UsersHub.jsx:912** 全选对比隐藏选择 vs 可见行。
- ☐ **[low] Logs.jsx:752 + VirtualList** 换行日志行固定高度裁剪重叠。
- ☐ **[low] AuditCenter.jsx:1647** 趋势请求守 window 不守选中实体。
- ☐ **[low] ExpandableQRCode.jsx:34** 未清理 timeout；HTTP 下复制静默失败。
- ☐ **[low] Server.jsx** 孤立死代码（含 latent bug），仍跑测试。

## E. 设计系统 / 主题

- ☐ **[high] console-redesign.css:3747,3685** 暗色主题白底白字（`.timeline-item`、`.audit-chart-selection` 用了无主题守卫的浅色字面量）。
- ☐ **[high] experience-upgrade.css:6208** 仪表盘旗舰 KPI 卡用 legacy 青色作功能色（违反 v3 只用 indigo）。
- ☐ **[medium] console-redesign.css:188** `--aurora-ramp` 硬编码 4 个 hex，light 主题不重算。
- ☐ **[medium] 231 处 `rgba(99,102,241,*)` indigo 字面量** 不走 color-mix → light 主题 accent 漂移。
- ☐ **[medium] console-redesign.css:3883** 暗色 dropdown 硬编码 `#0f0f13` 偏离调色板。
- ☐ **[medium] :focus-visible 硬编码 indigo + 双 focus 风格。
- ☐ **[medium] 移动端 ≤768px 两套互相矛盾的滚动模型。
- ☐ **[medium] z-index 令牌与字面量混用，dropdown 9999 会盖住 modal。
- ☐ **[medium] module-density.css ~90% 是孤立组件 resource-topology-*。
- ☐ **[low] 视觉：入站协议 pill 文字两侧裁剪（SHADOWSOCKS→"ADOWSO"，dokodemo→"ODEMO-D"）。** ← 截图实测
- ☐ **[low] 多处 index.css legacy royal-blue 字面量泄漏（audit tab 等）。

## F. i18n

- ☐ **[high] ServerDetail.jsx** 整页 ~60 条硬编码中文，无英文分支。
- ☐ **[medium] SystemSettings.jsx** 几乎全硬编码中文。
- ☐ **[medium] 83 处 `|| '中文'` 错误兜底；ListToolbar/ActionsDropdown/ConfirmContext/ExpandableQRCode 等 aria/默认文案硬编码中文。
- ✅ messages.js zh-CN/en-US 键集完美对齐(844/844)，无缺失。

---

## 视觉总评（截图）
整体设计**已是高端水准**（Linear/Stripe 档）：dark/light 双主题干净专业、aurora 登录页、仪表盘 hero、卡片/表格密度得当、移动端布局合理。主要可见缺陷：入站协议 pill 文字裁剪；暗色个别浅色面板白底白字；英文用户在 ServerDetail/Settings 看到中文。修掉这些后视觉即无明显瑕疵。
