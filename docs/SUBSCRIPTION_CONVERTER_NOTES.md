# 订阅输出与客户端导入说明

> 更新时间：2026-03-09
> 
> 文件名保留为 `SUBSCRIPTION_CONVERTER_NOTES.md` 仅为兼容旧引用；当前版本已不再依赖外部订阅转换器。

## 当前结论

- NMS 直接生成并提供订阅输出。
- `Clash` / `Mihomo` 使用 NMS 内置生成的 YAML 配置地址。
- `v2rayN / Raw / Native / Reconstructed` 继续由 NMS 直接生成或透传。
- `sing-box` 当前保留客户端导入链接方式，不依赖系统设置里的外部转换器。

## 现在有哪些订阅类型

- `v2rayN / v2rayNG`
- `Raw`
- `Native`
- `Reconstructed`
- `Clash YAML`
- `Mihomo YAML`
- `sing-box`

## 系统设置里还需要配置什么

只需要配置：

- `订阅公网地址（publicBaseUrl）`

作用：

- 让管理端生成的公开订阅地址稳定使用你的正式域名或公网地址
- 避免页面里出现 `localhost`、内网 IP 或测试地址

当前版本不再需要：

- `转换器地址`
- `Clash 模板 URL`
- `sing-box 模板 URL`

## 管理端与客户端的展示边界

- 管理者后台仍然会显示完整订阅链接，方便发给客户。
- 订阅内容里的节点显示名会做脱敏处理。
- 节点标签允许保留入站备注、协议简称、端口或去重编号。
- 节点标签不会包含站点名、网站域名、邮箱等敏感展示信息。

注意：

- 协议连接本身必须使用的真实目标地址仍然会保留在协议字段中，否则客户端无法连接。
- 被隐藏的是“节点显示名里的敏感信息”，不是协议本身的必要连接参数。

## Clash / Mihomo 配置结构

当前内置输出采用白名单风格规则结构，规则提供器组织方式参考 `Loyalsoldier/clash-rules`：

- `applications`
- `private`
- `reject`
- `icloud`
- `apple`
- `google`
- `proxy`
- `direct`
- `telegramcidr`
- `lancidr`
- `cncidr`

规则主顺序为：

- `RULE-SET,applications,DIRECT`
- `RULE-SET,private,DIRECT`
- `RULE-SET,reject,REJECT`
- `RULE-SET,google,PROXY`
- `RULE-SET,proxy,PROXY`
- `RULE-SET,direct,DIRECT`
- `GEOIP,CN,DIRECT`
- `MATCH,PROXY`

## 当前支持范围

可进入 Clash / Mihomo YAML 的订阅协议：

- `vmess`
- `vless`
- `trojan`
- `shadowsocks`

当前已处理的常见传输：

- `tcp`
- `ws`
- `grpc`
- `http/h2`
- `tls`
- `reality`

当前不会进入 Clash / Mihomo YAML 的内容：

- `hy2`
- `tuic`
- `httpupgrade`
- `xhttp`
- `kcp`
- `quic`

这类节点不会影响普通订阅，只是不会被写进当前版本的 Mihomo YAML。

## 客户端导入建议

- `v2rayN / v2rayNG`：优先使用普通订阅地址
- `Clash Verge / Mihomo Party`：使用 `Clash YAML` 或 `Mihomo YAML`
- `sing-box`：使用页面提供的导入链接或普通订阅地址按客户端方式导入

## 相关页面

- `订阅中心`
- `用户中心 / 开通订阅结果弹窗`
- `账号管理 / 开通订阅结果弹窗`
- `系统设置 -> 订阅地址`
