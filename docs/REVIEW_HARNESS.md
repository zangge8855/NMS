# Review Harness

This repo now includes a local review harness for broad UI and workflow inspection without real 3x-ui nodes.

## What it provides

- A fake 3x-ui stack with:
  - one healthy node
  - one legacy/compatibility node
  - one auth-failure target
  - one unreachable target
- Seeded NMS data for:
  - admin and user accounts
  - servers
  - subscription tokens
  - audit events
  - task history
  - traffic samples
  - client entitlement overrides

## Default commands

Run these from [`server/package.json`](/root/NMS/server/package.json):

```bash
npm run review:fake-panel
npm run review:seed
npm run review:server
```

The default review data directory is `/tmp/nms-review-harness`.

## Login credentials

The repo no longer commits fixed demo passwords. When `REVIEW_CREDENTIAL_SEED` is unset, the harness derives machine-scoped local credentials instead of using a repo-fixed seed.

Run `npm run review:seed` to print the active local credentials in the command output summary. If you want stable custom credentials, set the same values before running both `review:seed` and `review:fake-panel`:

- `REVIEW_CREDENTIAL_SEED`
- `REVIEW_ADMIN_PASSWORD`
- `REVIEW_USER_PASSWORD`
- `REVIEW_PANEL_HEALTHY_PASSWORD`
- `REVIEW_PANEL_LEGACY_PASSWORD`

## Custom seed scenarios

```bash
npm run review:seed -- --scenario empty
npm run review:seed -- --scenario edge
```

Supported scenarios:

- `review`: mixed happy-path and failure data
- `empty`: minimal clean state
- `edge`: failure-heavy node registry

## Notes

- `review:server` enables `ALLOW_PRIVATE_SERVER_URL=true` so local fake panel URLs can be added and edited from the UI.
- The fake panel is intentionally stateful in-memory so inbound/client mutations can be exercised during a review session.
- Restart `review:fake-panel` to reset panel-side state.
