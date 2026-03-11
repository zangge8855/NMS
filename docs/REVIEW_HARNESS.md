# Review Harness

## 中文

### 用途

Review Harness 用于本地评审、演示和回归验证。它通过一组脚本快速启动假面板、种子数据和独立服务实例，让你在不污染正式数据目录的情况下验证关键路径。

### 相关脚本

位于 `server/package.json` 的常用脚本：

- `npm run review:fake-panel`
- `npm run review:seed`
- `npm run review:server`

### 推荐启动顺序

1. 启动假面板
2. 生成本地评审数据
3. 启动 review server

```bash
cd server
npm run review:fake-panel
npm run review:seed
npm run review:server
```

### 数据与凭据

- Review Harness 默认使用独立的数据目录
- 演示账号和面板密码会根据本地种子推导，避免仓库内硬编码固定口令
- 如需覆盖，可在 `.env` 中设置 `REVIEW_CREDENTIAL_SEED` 或单独的 `REVIEW_*_PASSWORD`

### 适合验证的内容

- 登录流程
- 节点接入与能力探测
- 订阅生成与公开访问
- 审计、流量与批量任务页面
- UI 回归，如 Sidebar、Dropdown、Modal 的交互稳定性

### 注意事项

- 不要把评审环境生成的数据当作正式数据
- 不要把本地评审口令写回仓库
- 评审结束后可直接删除对应的临时数据目录

## English

### Purpose

The review harness is for local review, demos, and regression validation. It uses scripts to start a fake panel, seed review data, and run an isolated service instance without touching your main data directory.

### Related scripts

Common scripts from `server/package.json`:

- `npm run review:fake-panel`
- `npm run review:seed`
- `npm run review:server`

### Recommended startup order

1. Start the fake panel
2. Seed the review data
3. Start the review server

```bash
cd server
npm run review:fake-panel
npm run review:seed
npm run review:server
```

### Data and credentials

- The review harness uses a dedicated data directory
- Demo credentials and panel passwords are derived from a local seed, so the repository does not need fixed secrets
- You can override them with `REVIEW_CREDENTIAL_SEED` or specific `REVIEW_*_PASSWORD` values in `.env`

### Good validation targets

- sign-in flow
- server onboarding and capability detection
- subscription generation and public access
- audit, traffic, and batch-job screens
- UI regression for Sidebar, Dropdown, and Modal behavior

### Notes

- Do not treat review data as production data
- Do not commit local review passwords
- When finished, remove the temporary review data directory
