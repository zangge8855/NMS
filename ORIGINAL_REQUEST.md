# Original User Request

## Initial Request — 2026-07-16T20:58:14+08:00

Fix outstanding bugs, design system defects, and i18n gaps identified in the NMS codebase to ensure high reliability, visual consistency, and bilingual coverage.

Working directory: /root/NMS
Integrity mode: development

## Reference Material

- [NMS Repository Scan Report (June 2026)](file:///root/NMS/docs/REPO_SCAN_REPORT_2026-06.md)
- [NMS Gap Backlog](file:///root/NMS/docs/NMS_GAP_BACKLOG.md)

## Requirements

### R1. Server-Side Data Store & Integrity Fixes
- **Traffic Stats**: Fix `trafficStatsStore.js` to ensure node fetch failures (null inbound responses) do not write `0` bytes baseline snapshots which cause traffic spikes or clear baselines when nodes recover.
- **Atomic Writes**: Fix `fileUtils.js` broad catch clause to prevent writing corrupted/truncated configurations and silently resetting settings/users.
- **Concurrent Saves**: Prevent collision and data loss in `auditStore.js` by serializing concurrent writes or using unique temp filenames.
- **Backup Recovery**: Fix `storeRegistry.js` to properly save audit and traffic stores to disk after restoring backups instead of keeping them memory-only.
- **Settings & Process Lifecycle**: Ensure Telegram validation in `systemSettingsStore.js` does not contaminate settings memory before validation succeeds, and ensure graceful shutdown in `index.js` and `snapshots.js` flushes DB state.
- **User Deletion**: Ensure deleting a user cleans up panel node credentials even if some nodes are unreachable.

### R2. API Routes & Batch Integration
- **Batch Redaction**: Fix batch retry log playback to use original credentials rather than re-sending redacted placeholder tokens `[REDACTED]`.
- **Unhandled Rejections**: Catch and handle errors in async middleware / retry jobs in `batch.js` to avoid infinite hanging requests.
- **3x-ui Result Validation**: Validate `success: false` outcomes for node POST forms (even when HTTP status is 200).
- **Security & Token Lifecycles**: Prevent PUT responses from returning password hashes or salts, and enforce token expiration defaults when `ttlDays` is missing.

### R3. Monitoring, Telemetry & Telegram Alerts
- **Global Snapshot Cache**: Prevent single server requests from overwriting the global cluster status cache.
- **Backup Alerts**: Fix backup timestamp comparisons to avoid infinite Telegram notification loops upon failure.
- **Notification Persistence**: Use safe atomic writing for `notifications.json`.

### R4. Client-Side UI & Design System consistency
- **Speed Limits**: Match speed limit input units across all policy and client configuration modals.
- **Configuration Templates**: Fix advanced template loss on save in `xrayConfig.js` and `XrayConsole.jsx`.
- **Refreshes & Request Loops**: Prevent UI components from running infinite request loops due to improper dependency arrays (e.g. `useTrafficLeaderboardTrends.js`).
- **Aesthetics & Theme**: Fix dark mode color conflicts (e.g. white-on-white text in `.timeline-item` and dropdown offsets) and standardize on color-mix tokens where appropriate.

### R5. i18n Localization
- Resolve hardcoded Chinese text in `ServerDetail.jsx` and `SystemSettings.jsx` to support full bilingual experience for English/Chinese toggles.

## Acceptance Criteria

### Technical Validation
- [ ] Client builds successfully via `npm run build` with zero compiler/linter errors.
- [ ] Server tests pass completely via `npm test` under the root server directory.
- [ ] Client tests pass completely via `npm test` under the root client directory.
- [ ] Regression coverage is added/updated for the file storage, traffic stats, and batch jobs.
