# s-ui 节点支持 / s-ui Node Support

NMS 可以同时管理 [3x-ui](https://github.com/MHSanaei/3x-ui)（Xray 内核）和 [s-ui](https://github.com/alireza0/s-ui)（sing-box 内核）节点。

NMS manages both 3x-ui (Xray core) and s-ui (sing-box core) nodes side by side.

## 接入 / Onboarding

在「服务器管理 → 添加服务器」中把**面板类型**选为 `s-ui`：

- **地址**：包含 s-ui 面板路径（默认 `/app`），例如 `https://1.2.3.4:2095/app`。
- **认证**，二选一：
  - 用户名 + 密码：走 s-ui `/api`（会话 Cookie，过期后自动重新登录）。
  - API Token：填写 s-ui 生成的管理令牌，走 `/apiv2`（请求头 `Token`）。

In **Servers → Add server**, set **Panel type** to `s-ui`. Include the panel path in the URL (default `/app`). Authenticate with a username and password (s-ui `/api`, session cookie with automatic re-login) or with an s-ui admin API token (`/apiv2`).

## 工作方式 / How it works

服务端为 s-ui 节点创建一个适配器（`server/lib/suiPanelAdapter.ts`），把 NMS 发出的 3x-ui 风格 API 调用翻译成 s-ui API，再把结果转换回 3x-ui 结构。因此入站、用户、订阅、流量、在线状态、日志、备份等页面无需区分节点类型。

The server wraps each s-ui node in an adapter (`server/lib/suiPanelAdapter.ts`). It translates the 3x-ui shaped calls NMS makes into s-ui API calls and converts the answers back, so inbounds, users, subscriptions, traffic, online status, logs and backups work on both panel types.

s-ui 以客户端为中心：一个客户端有一个名称（即订阅 ID）、一组按协议区分的凭据和所属入站列表，对应 3x-ui v3 的 `/panel/api/clients/*` 接口。

## 支持的协议与上游对齐（s-ui v1.6.7） / Protocols & Upstream Alignment (s-ui v1.6.7)

| 类型 | 协议 |
| --- | --- |
| 带用户的入站（NMS 管理其客户端） | VLESS, VMess, Trojan, Shadowsocks, Hysteria, Hysteria2, TUIC, Naive, AnyTLS, ShadowTLS, Snell, Mixed, SOCKS, HTTP |
| 仅 s-ui 可创建的其他入站 | Direct, TUN, Redirect, TProxy, Cloudflared |

- **没有按用户限速**：s-ui 的客户端没有限速字段，NMS 客户端表单里的上下行限速对 s-ui 节点不生效（表单里有提示）。`hysteria` / `hysteria2` 入站自己的 `up_mbps` / `down_mbps` 带宽设置照常读写。
- **客户端分组**：客户端的 `group` 可以在 NMS 客户端表单里填写，会写入 s-ui。IP 数限制和 Telegram 提醒是 3x-ui 独有的，本次保存只涉及 s-ui 节点时表单会隐藏这两项。
- **单客户端流量重置与软启用**：当将客户端 `up`/`down` 置零或切换 `enable` 状态时，适配器精准更新该客户端记录并同步入站 `users` 挂载列表，不会影响同一客户端下的其他参数。
- **入站启用/禁用**：入站列表和批量操作里的启用开关会改写 s-ui 入站的 `enable` 字段。不返回该字段的旧版 s-ui 会提示不支持。
- **传输层与混淆合成**：适配器支持 `naive` TLS ALPN、`anytls`、`hysteria` v1 (`auth_str`, `obfs`)、`hysteria2` (`salamander` 混淆密码, `masquerade`)、`tuic` (`congestion_control`, `zero_rtt_handshake`) 以及 `httpupgrade` / `ws` / `grpc` / `http`（3x-ui 一侧写作 `h2`）/ `quic` 传输配置的双向转换。
- **面板 API Token**：节点详情页的「API Token」标签可以列出、创建和删除 s-ui 的 API Token。s-ui 的 Token 都是完全权限，有效期按天计算，不能暂停。s-ui 只允许已登录的用户管理 Token，所以这台节点要用用户名 + 密码接入 NMS。
- **节点工具**：支持通过 s-ui `keypairs` 接口生成 `reality`（X25519）、`wireguard`、`ech`、`vless_enc`、`tls` 密钥与证书材料。

用户策略里的「允许协议」、批量添加客户端和订阅生成都已包含上述 s-ui 协议。

The user policy protocol list, batch client creation and subscription output all include the s-ui protocols above. The adapter also handles per-client traffic reset, client `enable` toggling via inbound user attachment, client `group`, inbound enable/disable, `h2`/`http` and `quic` transports, panel API tokens (list, create and delete; always full access, and NMS must log in with a username and password) and `keypairs` generation (`reality`, `wireguard`, `ech`, `vless_enc`, `tls`).

s-ui clients have no per-client speed limit, so the client form's speed-limit fields do nothing on s-ui nodes. Hysteria inbound bandwidth (`up_mbps`/`down_mbps`) is still read and written. IP limits and Telegram alerts are 3x-ui only and are hidden when a save touches only s-ui nodes.

## 不支持的功能 / Not available on s-ui

以下功能依赖 3x-ui 专有接口，在 s-ui 节点上会被隐藏、降级或返回「不支持」：

- Xray 配置（路由、出站、DNS）：请在 s-ui 面板中管理 sing-box 配置。
- CPU 历史曲线：显示为空。
- 多节点在线归属、3x-ui 面板设置接口。
- 按用户限速、IP 数限制、Telegram 提醒，以及 3x-ui v3 的按月/按周续期和单用户流量清零周期。
- 暂停 API Token（只能删除）；用 API Token 接入的节点不能管理 Token。

These rely on 3x-ui-only endpoints or fields and are hidden, degraded or reported as unsupported on s-ui nodes: Xray configuration (manage sing-box config in s-ui), CPU history (empty), multi-node online attribution, 3x-ui panel settings, per-client speed limits, IP limits, Telegram alerts, 3x-ui v3 calendar renewal and per-client traffic reset cycles, and pausing API tokens (delete them instead). A node connected with an API token cannot manage tokens.

## 本地验证 / Local testing

`server/scripts/fakeSuiPanel.js` 提供一个模拟 s-ui 面板，Review Harness（见 [REVIEW_HARNESS.md](REVIEW_HARNESS.md)）会同时启动模拟 3x-ui 与 s-ui 节点。适配器测试位于 `server/tests/suiPanelAdapter.test.js`。

`server/scripts/fakeSuiPanel.js` is a fake s-ui panel. The review harness starts fake 3x-ui and s-ui nodes together. Adapter tests live in `server/tests/suiPanelAdapter.test.js`.
