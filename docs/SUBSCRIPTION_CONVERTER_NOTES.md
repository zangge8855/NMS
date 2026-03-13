# Subscription Converter Integration Notes

## English

### What Changed

NMS now supports an external subscription converter base URL for client-specific links.

- Raw subscription links still come from NMS.
- Client-specific links for Clash / Mihomo, sing-box, and Surge can now be wrapped through an external converter.
- Subscription Center quick actions, displayed client links, and the subscription URL QR code all follow the configured converter URL automatically.
- The configurable homepage access path only changes where the UI loads; it does not rewrite subscription public URLs.

### Where To Configure It

You can configure the converter in either place:

1. System Settings
   `System Settings -> Subscription Addresses -> External Subscription Converter URL`
2. Environment variable
   `SUB_CONVERTER_BASE_URL`

System Settings are the recommended option when the URL may change later.

### Accepted Format

Use the converter base URL only.

Valid examples:

```text
https://converter.example.com
https://converter.example.com/
```

Do not enter:

```text
https://converter.example.com/clash
https://converter.example.com/singbox
https://converter.example.com/surge
https://converter.example.com/clash?config=...
```

NMS will append the correct path and `config` query automatically.

### Example Output

Assume:

```text
NMS public base: https://nms.example.com
Converter base: https://converter.example.com
Raw subscription URL:
https://nms.example.com/api/subscriptions/public/t/token-id/token-secret?format=raw
```

Then NMS will generate:

```text
Clash / Mihomo
https://converter.example.com/clash?config=https%3A%2F%2Fnms.example.com%2Fapi%2Fsubscriptions%2Fpublic%2Ft%2Ftoken-id%2Ftoken-secret%3Fformat%3Draw

sing-box
https://converter.example.com/singbox?config=https%3A%2F%2Fnms.example.com%2Fapi%2Fsubscriptions%2Fpublic%2Ft%2Ftoken-id%2Ftoken-secret%3Fformat%3Draw

Surge
https://converter.example.com/surge?config=https%3A%2F%2Fnms.example.com%2Fapi%2Fsubscriptions%2Fpublic%2Ft%2Ftoken-id%2Ftoken-secret%3Fformat%3Draw
```

### Subscription Center Behavior

After the converter base URL is saved:

- The `Clash / Mihomo` link switches to the external converter URL.
- The `sing-box` link switches to the external converter URL.
- The `Surge` link switches to the external converter URL.
- Quick import buttons follow the new URLs automatically.
- The QR code shown in Subscription Center represents the currently selected subscription URL itself.

If the converter base URL is changed later, Subscription Center updates accordingly after saving settings.

### Recommended Practice

- Set `SUB_PUBLIC_BASE_URL` to a real public NMS domain.
- Keep the converter on a stable HTTPS domain.
- Use a base URL only; let NMS assemble `/clash`, `/singbox`, and `/surge`.
- Do not place private production domains in repository docs or examples.

### Example Configuration

```env
SUB_PUBLIC_BASE_URL=https://nms.example.com
SUB_CONVERTER_BASE_URL=https://converter.example.com
```

## 中文

### 这次更新了什么

NMS 现在支持“外部订阅转换器基址”。

- 原始订阅链接仍然由 NMS 自己生成。
- Clash / Mihomo、sing-box、Surge 这些客户端专用链接可以自动包装到外部转换器。
- 订阅中心里的快捷导入、展示出来的客户端专用链接、以及订阅网址二维码，都会自动跟随这个转换器地址。
- 可配置的首页访问路径只影响后台和登录页从哪里打开，不会改写订阅公开地址。

### 在哪里配置

可以在两处配置：

1. 管理后台系统设置
   `系统设置 -> 订阅地址 -> 外部订阅转换器地址`
2. 环境变量
   `SUB_CONVERTER_BASE_URL`

如果你后面可能频繁更换域名，建议直接在系统设置里维护。

### 正确填写格式

只填写“转换器基址”即可。

正确示例：

```text
https://converter.example.com
https://converter.example.com/
```

不要这样填：

```text
https://converter.example.com/clash
https://converter.example.com/singbox
https://converter.example.com/surge
https://converter.example.com/clash?config=...
```

因为 `/clash`、`/singbox`、`/surge` 和 `config=...` 这些参数会由 NMS 自动拼接。

### 生成结果示例

假设：

```text
NMS 公网地址: https://nms.example.com
转换器基址: https://converter.example.com
原始订阅地址:
https://nms.example.com/api/subscriptions/public/t/token-id/token-secret?format=raw
```

那么 NMS 会自动生成：

```text
Clash / Mihomo
https://converter.example.com/clash?config=https%3A%2F%2Fnms.example.com%2Fapi%2Fsubscriptions%2Fpublic%2Ft%2Ftoken-id%2Ftoken-secret%3Fformat%3Draw

sing-box
https://converter.example.com/singbox?config=https%3A%2F%2Fnms.example.com%2Fapi%2Fsubscriptions%2Fpublic%2Ft%2Ftoken-id%2Ftoken-secret%3Fformat%3Draw

Surge
https://converter.example.com/surge?config=https%3A%2F%2Fnms.example.com%2Fapi%2Fsubscriptions%2Fpublic%2Ft%2Ftoken-id%2Ftoken-secret%3Fformat%3Draw
```

### 订阅中心会怎么表现

保存转换器地址后：

- `Clash / Mihomo` 会切换到外部转换器地址
- `sing-box` 会切换到外部转换器地址
- `Surge` 会切换到外部转换器地址
- 快捷导入按钮会自动跟着切换
- 订阅中心显示的二维码内容是“当前选中的订阅网址本身”

如果以后修改了转换器基址，只要保存设置，订阅中心里的对应入口会一起更新。

### 建议做法

- `SUB_PUBLIC_BASE_URL` 要填写真实可访问的 NMS 公网域名
- 转换器尽量使用稳定的 HTTPS 域名
- 只填基址，不要手工拼 `/clash`、`/singbox`、`/surge`
- 不要把真实私有生产域名写进仓库文档或示例

### 配置示例

```env
SUB_PUBLIC_BASE_URL=https://nms.example.com
SUB_CONVERTER_BASE_URL=https://converter.example.com
```
