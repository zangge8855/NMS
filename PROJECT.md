# Project: NMS TypeScript Full Refactoring & Production Hardening

## Architecture
- **Client**: React 18 + TypeScript + Vite + Vitest + ESLint. Located in `/root/NMS/client/`. Main entry point `/root/NMS/client/src/main.tsx`. Type definitions in `/root/NMS/client/src/types/index.ts`. Global styles in `/root/NMS/client/src/index.css`.
- **Server**: Node.js ESM + TypeScript (`tsx`) + Express + Node Native Test Runner (`node --import tsx --test`). Located in `/root/NMS/server/`. Global entry point `/root/NMS/server/index.ts` (with backward-compatible loader `/root/NMS/server/index.js`). Domain types in `/root/NMS/server/types/index.ts`. Stores in `/root/NMS/server/store/`, services in `/root/NMS/server/services/`, routes in `/root/NMS/server/routes/`.

## Code Layout
- **Client Codebase**: `/root/NMS/client/` (100% TypeScript / TSX)
- **Server Codebase**: `/root/NMS/server/` (100% TypeScript)
- **Client Tests**: `/root/NMS/client/src/**/*.test.{ts,tsx}` (run via `npm test` inside client folder, 265 tests passing)
- **Server Tests**: `/root/NMS/server/tests/**/*.test.js` (run via `npm test` inside server folder, 541 tests passing)

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 0 | E2E Test Suite | Design and implement Tier 1-4 tests, publish `TEST_READY.md` | none | DONE (Output: /root/NMS/server/tests/e2e.test.js, /root/NMS/TEST_READY.md) |
| 1 | Server-Side Data Store & Integrity Fixes | R1: trafficStatsStore, fileUtils, auditStore, storeRegistry, systemSettingsStore, graceful shutdown db state flush, user deletion panel cleanup | none | DONE |
| 2 | API Routes & Alerts | R2 & R3: batch redaction replay, unhandled Express rejections, 3x-ui API validation, passwordHash/salt filter, token TTL defaults, global snapshot cache, backup alert loops, notifications.json atomic write | M1 | DONE |
| 3 | Client UI, Design System & i18n | R4 & R5: speed limit units, xrayConfig template save, UI request loops, theme colors, ServerDetail & SystemSettings translation | M2 | DONE |
| 4 | Full TypeScript Migration | 100% full-stack TS refactoring: `server/**/*.ts`, `client/src/**/*.{ts,tsx}`, shared type contracts, backward-compatible runtime loader, 0 regression | M1-M3 | DONE (Server: 541/541 tests pass, Client: 265/265 tests pass, Production build 100% clean) |

## Interface Contracts
### Backup Restoration Contract
- When `storeRegistry.js` restores a backup, it must explicitly call the `_save()` or write method for all registered stores (including audit and traffic stores) to write the restored memory state to disk.

### Telegram Validation Contract
- `systemSettingsStore.js` must validate Telegram credentials *before* modifying `this.settings` in memory, ensuring that failed validations do not corrupt settings state.

### User Policy Route Contract
- `userPolicy.js` PUT response must redact/exclude `passwordHash` and `salt` fields before returning the user record to the client.

### Client Speed Limit Modal
- `UserPolicyModal.jsx` speed limit input units must be standardized. All policy inputs and config modals must use consistent, aligned units (e.g. MB/s or raw KB/s).
