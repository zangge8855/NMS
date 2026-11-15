# Testing

## Commands

| What | Command (from the repo root) |
|------|------------------------------|
| Server tests (unit + e2e) | `npm test --workspace=server` |
| One server test file | `cd server && node --import tsx --import ./tests/setup/isolateDataDir.js --test tests/<name>.test.js` |
| Server typecheck | `npm run typecheck --workspace=server` |
| Client lint + typecheck | `npm run lint --workspace=client` |
| Client tests (Vitest) | `npm test --workspace=client` |
| Client production build | `npm run build --workspace=client` |

CI (`.github/workflows/ci.yml`) runs all of the above after `npm ci`, plus
`npm audit --omit=dev --audit-level=high`.

## Server test isolation

`server/tests/setup/isolateDataDir.js` is preloaded into every server test
process. It points `DATA_DIR` at a fresh temporary directory, so no test can read
or overwrite the repository's `data/` directory; `config.ts` refuses to start under
the test runner if `DATA_DIR` still resolves to it. Tests run with
`--test-concurrency=1` because several stores are process-wide singletons.

`tests/e2e.test.js` treats NMS as a black box: it starts the server in a child
process on a random port, starts mock 3x-ui panels
(`server/scripts/review_fake_panel.js`), and talks to them with `fetch`. It needs a
client build (`npm run build --workspace=client`) because it checks that the admin
page is served.

## Client tests

Vitest with jsdom. Shared setup lives in `client/src/test/setup.ts`, and
`client/src/test/render.tsx` renders components with the app providers.

## Lint notes

- The client is TypeScript 7 (native compiler), which has no JS API, so
  typescript-eslint cannot run. ESLint parses TS/TSX with `@babel/eslint-parser`
  for the React, hooks and jsx-a11y rules; `tsc --noEmit` does the type checking.
- `react-hooks/exhaustive-deps` is a warning. The lint script caps the warning
  count (`--max-warnings`) at the current backlog so it can only go down; lower the
  cap whenever you fix some.
- Both workspaces compile with `strict: false`. Turn strict options on per file or
  per directory as code is touched, not in one sweep.

## Persistence contracts worth keeping covered

- Restoring a backup (`storeRegistry`) must persist every restored store, including
  the audit and traffic stores, via `_save()`.
- `systemSettingsStore` validates Telegram credentials before mutating settings.
- User records returned by any route never include `passwordHash` or `salt`.
- The audit store coalesces writes; call `auditStore.flush()` (or `_save()`) before
  reading `audit_events.json` / `subscription_access_logs.json` from disk in a test.
