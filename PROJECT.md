# Project: NMS Bug Fixes and Enhancements

## Architecture
- **Client**: React + Vite + Vitest + ESLint. Located in `/root/NMS/client/`. Main entry point `/root/NMS/client/src/main.jsx`. Global styles in `/root/NMS/client/src/index.css`.
- **Server**: Node.js + Express + Node Native Test Runner (`node --test`). Located in `/root/NMS/server/`. Global entry point `/root/NMS/server/index.js`. Stores located in `/root/NMS/server/store/`, services in `/root/NMS/server/services/`, routes in `/root/NMS/server/routes/`.

## Code Layout
- **Client Codebase**: `/root/NMS/client/`
- **Server Codebase**: `/root/NMS/server/`
- **Client Tests**: `/root/NMS/client/src/**/*.test.jsx` (run via `npm run test` inside client folder)
- **Server Tests**: `/root/NMS/server/tests/**/*.test.js` (run via `npm test` inside server folder)

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 0 | E2E Test Suite | Design and implement Tier 1-4 tests, publish `TEST_READY.md` | none | DONE (Output: /root/NMS/server/tests/e2e.test.js, /root/NMS/TEST_READY.md) |
| 1 | Server-Side Data Store & Integrity Fixes | R1: trafficStatsStore, fileUtils, auditStore, storeRegistry, systemSettingsStore, graceful shutdown db state flush, user deletion panel cleanup | none | DONE (Conv: bbe834ef-c18a-425c-811d-eead7c371edd, Audit: 757b6ef3-824d-4c41-91d6-31602295bd35) |
| 2 | API Routes & Alerts | R2 & R3: batch redaction replay, unhandled Express rejections, 3x-ui API validation, passwordHash/salt filter, token TTL defaults, global snapshot cache, backup alert loops, notifications.json atomic write | M1 | IN_PROGRESS |
| 3 | Client UI, Design System & i18n | R4 & R5: speed limit units, xrayConfig template save, UI request loops, theme colors (dark theme variables, white-on-white text, flagship v3 Indigo colors, color-mix), ServerDetail & SystemSettings translation | M2 | PLANNED |

## Interface Contracts
### Backup Restoration Contract
- When `storeRegistry.js` restores a backup, it must explicitly call the `_save()` or write method for all registered stores (including audit and traffic stores) to write the restored memory state to disk.

### Telegram Validation Contract
- `systemSettingsStore.js` must validate Telegram credentials *before* modifying `this.settings` in memory, ensuring that failed validations do not corrupt settings state.

### User Policy Route Contract
- `userPolicy.js` PUT response must redact/exclude `passwordHash` and `salt` fields before returning the user record to the client.

### Client Speed Limit Modal
- `UserPolicyModal.jsx` speed limit input units must be standardized. All policy inputs and config modals must use consistent, aligned units (e.g. MB/s or raw KB/s).
