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

## 支持的协议 / Protocols

| 类型 | 协议 |
| --- | --- |
| 带用户的入站（NMS 管理其客户端） | VLESS, VMess, Trojan, Shadowsocks, Hysteria, Hysteria2, TUIC, Naive, AnyTLS, ShadowTLS, Snell, Mixed, SOCKS, HTTP |
| 仅 s-ui 可创建的其他入站 | Direct, TUN, Redirect, TProxy, Cloudflared |

用户策略里的「允许协议」、批量添加客户端和订阅生成都已包含上述 s-ui 协议。

The user policy protocol list, batch client creation and subscription output all include the s-ui protocols above.

## 不支持的功能 / Not available on s-ui

以下功能依赖 3x-ui 专有接口，在 s-ui 节点上会被隐藏、降级或返回「不支持」：

- Xray 配置（路由、出站、DNS）：请在 s-ui 面板中管理 sing-box 配置。
- 入站单独启用/禁用：自动回退为更新入站。
- CPU 历史曲线：显示为空。
- 多节点在线归属、3x-ui 面板设置接口、面板 API Token 管理。

These rely on 3x-ui-only endpoints and are hidden, degraded or reported as unsupported on s-ui nodes: Xray configuration (manage sing-box config in s-ui), per-inbound enable toggles (falls back to an inbound update), CPU history (empty), multi-node online attribution, 3x-ui panel settings and panel API token management.

## 本地验证 / Local testing

`server/scripts/fakeSuiPanel.js` 提供一个模拟 s-ui 面板，Review Harness（见 [REVIEW_HARNESS.md](REVIEW_HARNESS.md)）会同时启动模拟 3x-ui 与 s-ui 节点。适配器测试位于 `server/tests/suiPanelAdapter.test.js`。

`server/scripts/fakeSuiPanel.js` is a fake s-ui panel. The review harness starts fake 3x-ui and s-ui nodes together. Adapter tests live in `server/tests/suiPanelAdapter.test.js`.
