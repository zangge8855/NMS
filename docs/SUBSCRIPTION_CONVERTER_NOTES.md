# Subscription Converter Notes

## 中文

### 作用

NMS 可以直接生成原始订阅链接；如果额外配置 subconverter，还可以生成 Clash 或 sing-box 等客户端友好的转换链接。

### 关键环境变量

```env
SUB_PUBLIC_BASE_URL=https://nms.example.com
SUB_CONVERTER_BASE_URL=https://subconverter.example.com/sub
SUB_CONVERTER_CLASH_CONFIG_URL=https://rules.example.com/clash.ini
SUB_CONVERTER_SINGBOX_CONFIG_URL=https://rules.example.com/sing-box.json
```

### 行为规则

- 未设置 `SUB_PUBLIC_BASE_URL` 时，系统可能无法生成适合外部用户访问的公网链接
- 未设置 `SUB_CONVERTER_BASE_URL` 时，只提供原始订阅链接
- 设置了转换器地址后，前端才会显示 Clash / sing-box 专用入口

### 运营建议

- `SUB_PUBLIC_BASE_URL` 必须是终端用户真实可访问的域名
- 转换器应独立部署，并使用稳定可达的 HTTPS 地址
- 模板或规则地址失效时，会直接影响客户端导入体验

### 排障

- 链接域名错误：检查 `SUB_PUBLIC_BASE_URL`
- 没有 Clash / sing-box 选项：检查 `SUB_CONVERTER_BASE_URL`
- 客户端导入失败：检查转换模板地址是否能被转换器访问

## English

### Purpose

NMS can generate raw subscription URLs directly. If you also configure a subconverter service, it can generate client-friendly links for Clash, sing-box, and similar consumers.

### Key environment variables

```env
SUB_PUBLIC_BASE_URL=https://nms.example.com
SUB_CONVERTER_BASE_URL=https://subconverter.example.com/sub
SUB_CONVERTER_CLASH_CONFIG_URL=https://rules.example.com/clash.ini
SUB_CONVERTER_SINGBOX_CONFIG_URL=https://rules.example.com/sing-box.json
```

### Runtime rules

- Without `SUB_PUBLIC_BASE_URL`, the system may not produce a public-ready subscription URL
- Without `SUB_CONVERTER_BASE_URL`, only the raw subscription link is exposed
- Clash and sing-box entry points appear in the UI only when the converter is configured

### Operational guidance

- `SUB_PUBLIC_BASE_URL` must be reachable by end users
- Run the converter separately and expose it through a stable HTTPS URL
- If template or rule URLs break, the import experience breaks with them

### Troubleshooting

- Wrong link domain: check `SUB_PUBLIC_BASE_URL`
- Missing Clash / sing-box options: check `SUB_CONVERTER_BASE_URL`
- Client import fails: verify that the converter can fetch the configured template URLs
