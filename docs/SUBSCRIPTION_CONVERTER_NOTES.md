# 订阅转换与规则模板说明

> 适用版本：当前 `NMS` 开发分支

## 哪些订阅类型不需要后端转换器

- `v2rayN / v2rayNG`
- `Raw`
- `Native`
- `Reconstructed`

以上类型由 NMS 直接生成或透传，不依赖 `SUB_CONVERTER_BASE_URL` / 系统设置里的“转换器地址”。

## 哪些订阅类型需要后端转换器

- `Clash / Mihomo`
- `sing-box`

这两类依赖后端订阅转换服务。未配置转换器地址时，前端会隐藏这两类入口。

## 哪些内容需要你提供“规则”

- `Clash 规则模板 URL`（可选）
- `sing-box 规则模板 URL`（可选）

这两个 URL 会透传给转换器的 `config` 参数，用于注入你自己的规则模板。

## 最小可用配置（仅启用转换）

- 转换器地址：`http(s)://<your-converter>/sub`
- Clash/sing-box 模板 URL 可留空

## 推荐配置（转换 + 自定义规则）

- 转换器地址：`http(s)://<your-converter>/sub`
- Clash 模板：`https://.../clash.ini`
- sing-box 模板：`https://.../singbox.json`

## 配置入口

- 管理端：`系统设置 -> 订阅转换器`
- 环境变量（可选）：
  - `SUB_CONVERTER_BASE_URL`
  - `SUB_CONVERTER_CLASH_CONFIG_URL`
  - `SUB_CONVERTER_SINGBOX_CONFIG_URL`
