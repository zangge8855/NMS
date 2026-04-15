# Subscription Converter Integration Notes

## English

### What Changed

NMS now supports the correct `Subconverter + Sublink Worker` split:

- Raw subscription links still come from NMS.
- NMS sends the real subscription as the converter's `url=...` parameter.
- NMS sends a full Sublink Worker `/subconverter?...` URL as the converter's `config=...` parameter.
- Client-specific links for Clash / Mihomo, sing-box, and Surge can be wrapped through an external converter independently.
- Subscription Center device cards, quick import entries, and the subscription URL QR code all follow the configured converter URL automatically.
- The configurable homepage access path only changes where the UI loads; it does not rewrite subscription public URLs.

### Where To Configure It

You configure two layers:

1. Converter base URL
   `SUB_CONVERTER_BASE_URL`
2. Per-target config URL
   `SUB_CONVERTER_CLASH_CONFIG_URL`
   `SUB_CONVERTER_SINGBOX_CONFIG_URL`
   `SUB_CONVERTER_SURGE_CONFIG_URL`

The same fields are also available in:
`System Settings -> Access & Subscription -> External Converter`

System Settings are the recommended option when the URLs may change later.

### Accepted Format

Use the converter base URL only for `SUB_CONVERTER_BASE_URL`.

Valid examples:

```text
https://converter.example.com
https://converter.example.com/
```

For each `*_CONFIG_URL`, use the full Sublink Worker config URL, for example:

```text
https://worker.example.com/subconverter
https://worker.example.com/subconverter?selectedRules=balanced
https://worker.example.com/subconverter?selectedRules=comprehensive&group_by_country=true
```

Do not put the raw NMS subscription URL into `config`.

### Example Output

Assume:

```text
NMS public base: https://nms.example.com
Converter base: https://converter.example.com
Clash config URL:
https://worker.example.com/subconverter?selectedRules=balanced
Raw subscription URL:
https://nms.example.com/api/subscriptions/public/t/token-id/token-secret?format=raw
```

Then NMS will generate:

```text
Clash / Mihomo
https://converter.example.com/sub?target=clash&url=https%3A%2F%2Fnms.example.com%2Fapi%2Fsubscriptions%2Fpublic%2Ft%2Ftoken-id%2Ftoken-secret%3Fformat%3Draw&config=https%3A%2F%2Fworker.example.com%2Fsubconverter%3FselectedRules%3Dbalanced

sing-box
https://converter.example.com/sub?target=singbox&url=https%3A%2F%2Fnms.example.com%2Fapi%2Fsubscriptions%2Fpublic%2Ft%2Ftoken-id%2Ftoken-secret%3Fformat%3Draw&config=https%3A%2F%2Fworker.example.com%2Fsubconverter%3FselectedRules%3Dcomprehensive

Surge
https://converter.example.com/sub?target=surge&url=https%3A%2F%2Fnms.example.com%2Fapi%2Fsubscriptions%2Fpublic%2Ft%2Ftoken-id%2Ftoken-secret%3Fformat%3Draw&config=https%3A%2F%2Fworker.example.com%2Fsubconverter%3FselectedRules%3Dminimal
```

### Subscription Center Behavior

After the converter base URL and matching config URL are saved:

- The `Clash / Mihomo` link switches to the external converter URL.
- The `sing-box` link switches to the external converter URL.
- The `Surge` link switches to the external converter URL.
- Quick import buttons follow the new URLs automatically.
- The QR code shown in Subscription Center represents the currently selected subscription URL itself.

If a target does not have its own config URL, NMS falls back to its built-in link for that target.

### Recommended Practice

- Set `SUB_PUBLIC_BASE_URL` to a real public NMS domain.
- Keep the converter on a stable HTTPS domain.
- Use a base URL only for `SUB_CONVERTER_BASE_URL`; let NMS assemble `/sub?target=...`.
- Use full Worker `/subconverter?...` URLs for each `*_CONFIG_URL`.
- Do not place private production domains in repository docs or examples.

### Example Configuration

```env
SUB_PUBLIC_BASE_URL=https://nms.example.com
SUB_CONVERTER_BASE_URL=https://converter.example.com
SUB_CONVERTER_CLASH_CONFIG_URL=https://worker.example.com/subconverter?selectedRules=balanced
SUB_CONVERTER_SINGBOX_CONFIG_URL=https://worker.example.com/subconverter?selectedRules=comprehensive
SUB_CONVERTER_SURGE_CONFIG_URL=https://worker.example.com/subconverter?selectedRules=minimal
```

## 中文

### 这次更新了什么

NMS 现在按正确的 `Subconverter + Sublink Worker` 方式生成外部订阅链接：

- 原始订阅链接仍然由 NMS 自己生成。
- NMS 会把真实订阅地址放到转换器的 `url=...` 参数里。
- NMS 会把完整的 Sublink Worker `/subconverter?...` 地址放到转换器的 `config=...` 参数里。
- Clash / Mihomo、sing-box、Surge 可以分别配置各自的外部转换规则。
- 订阅中心里的设备卡片、快捷导入入口、以及订阅网址二维码，都会自动跟随这个转换器地址。
- 可配置的首页访问路径只影响后台和登录页从哪里打开，不会改写订阅公开地址。

### 在哪里配置

这次需要配置两层地址：

1. 转换器基址
   `SUB_CONVERTER_BASE_URL`
2. 各类型的规则配置地址
   `SUB_CONVERTER_CLASH_CONFIG_URL`
   `SUB_CONVERTER_SINGBOX_CONFIG_URL`
   `SUB_CONVERTER_SURGE_CONFIG_URL`

后台里也可以直接配置：
`系统设置 -> 入口与订阅 -> 外部转换器`

如果你后面可能频繁更换域名或规则地址，建议直接在系统设置里维护。

### 正确填写格式

`SUB_CONVERTER_BASE_URL` 只填写“转换器基址”。

```text
https://converter.example.com
https://converter.example.com/
```

各个 `*_CONFIG_URL` 则填写完整的 Worker 配置地址，例如：

```text
https://worker.example.com/subconverter
https://worker.example.com/subconverter?selectedRules=balanced
https://worker.example.com/subconverter?selectedRules=comprehensive&group_by_country=true
```

不要把 NMS 的原始订阅地址直接填进 `config`。

### 生成结果示例

假设：

```text
NMS 公网地址: https://nms.example.com
转换器基址: https://converter.example.com
Clash 规则配置地址:
https://worker.example.com/subconverter?selectedRules=balanced
原始订阅地址:
https://nms.example.com/api/subscriptions/public/t/token-id/token-secret?format=raw
```

那么 NMS 会自动生成：

```text
Clash / Mihomo
https://converter.example.com/sub?target=clash&url=https%3A%2F%2Fnms.example.com%2Fapi%2Fsubscriptions%2Fpublic%2Ft%2Ftoken-id%2Ftoken-secret%3Fformat%3Draw&config=https%3A%2F%2Fworker.example.com%2Fsubconverter%3FselectedRules%3Dbalanced

sing-box
https://converter.example.com/sub?target=singbox&url=https%3A%2F%2Fnms.example.com%2Fapi%2Fsubscriptions%2Fpublic%2Ft%2Ftoken-id%2Ftoken-secret%3Fformat%3Draw&config=https%3A%2F%2Fworker.example.com%2Fsubconverter%3FselectedRules%3Dcomprehensive

Surge
https://converter.example.com/sub?target=surge&url=https%3A%2F%2Fnms.example.com%2Fapi%2Fsubscriptions%2Fpublic%2Ft%2Ftoken-id%2Ftoken-secret%3Fformat%3Draw&config=https%3A%2F%2Fworker.example.com%2Fsubconverter%3FselectedRules%3Dminimal
```

### 订阅中心会怎么表现

保存转换器基址和对应 config URL 后：

- `Clash / Mihomo` 会切换到外部转换器地址
- `sing-box` 会切换到外部转换器地址
- `Surge` 会切换到外部转换器地址
- 快捷导入按钮会自动跟着切换
- 订阅中心显示的二维码内容是“当前选中的订阅网址本身”
- 订阅页里较短的地址框、二维码和快捷导入会放在同一组导入区域，不再把超长网址整条铺开

如果某个类型没有配置自己的 config URL，NMS 会只让该类型回退到内置链接，不影响其它类型。

### 建议做法

- `SUB_PUBLIC_BASE_URL` 要填写真实可访问的 NMS 公网域名
- 转换器尽量使用稳定的 HTTPS 域名
- `SUB_CONVERTER_BASE_URL` 只填基址，由 NMS 自动拼 `/sub?target=...`
- `*_CONFIG_URL` 填完整 Worker `/subconverter?...` 地址
- 不要把真实私有生产域名写进仓库文档或示例

### 配置示例

```env
SUB_PUBLIC_BASE_URL=https://nms.example.com
SUB_CONVERTER_BASE_URL=https://converter.example.com
SUB_CONVERTER_CLASH_CONFIG_URL=https://worker.example.com/subconverter?selectedRules=balanced
SUB_CONVERTER_SINGBOX_CONFIG_URL=https://worker.example.com/subconverter?selectedRules=comprehensive
SUB_CONVERTER_SURGE_CONFIG_URL=https://worker.example.com/subconverter?selectedRules=minimal
```
