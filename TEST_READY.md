# NMS E2E Test Suite Ready

The comprehensive, opaque-box E2E test suite has been implemented successfully under `/root/NMS/server/tests/e2e.test.js`. It utilizes Node's native test runner (`node:test`) and native `fetch` client to perform API integration testing against NMS and mock 3x-ui panels.

## Runner Commands

To execute the E2E tests:
```bash
# Run tests from NMS server directory or project root
node --test server/tests/e2e.test.js
```

## E2E Test Suite Summary
- **Test Runner**: Node Native Test Runner (`node --test`).
- **Dynamic Port Selection**: Three ports are dynamically allocated for NMS Backend, Healthy Panel Mock, and Legacy Panel Mock in the `before` hook.
- **Upstream Mocks**: Spawned automatically using `node scripts/review_fake_panel.js` in a child process.
- **Client**: Native `fetch` HTTP client to communicate with the backend.
- **Total Test Cases**: Exactly 60.

## Coverage Checklist

### Tier 1: Feature Coverage (Tests 1-25)
#### Feature 1: Server & Node Management
- [x] **Test 1**: POST `/api/servers` adds healthy server with API token
- [x] **Test 2**: POST `/api/servers` adds legacy server with password auth
- [x] **Test 3**: GET `/api/servers` lists registered servers
- [x] **Test 4**: GET `/api/servers/:id/snapshot` retrieves server snapshot details
- [x] **Test 5**: DELETE `/api/servers/:id` removes legacy server

#### Feature 2: User Policies & Traffic Enforcement
- [x] **Test 6**: PUT `/api/user-policy/:email` creates or updates user policy
- [x] **Test 7**: GET `/api/user-policy/:email` reads user policy
- [x] **Test 8**: User policy updates server scope mode to all
- [x] **Test 9**: User policy updates protocol scope mode to all
- [x] **Test 10**: Server deletion automatically cleans up server ID from policies

#### Feature 3: Subscription Client Generation
- [x] **Test 11**: POST `/api/auth/users` creates a new managed user
- [x] **Test 12**: POST `/api/subscriptions/:email/issue` issues a new subscription token
- [x] **Test 13**: GET `/api/subscriptions/:email` retrieves client links
- [x] **Test 14**: GET `/api/subscriptions/public/t/:tokenId/:token` retrieves public subscription config
- [x] **Test 15**: GET `/api/subscriptions/public/t/:tokenId/:token?target=singbox` retrieves config in JSON format

#### Feature 4: System Settings & Camouflage
- [x] **Test 16**: GET `/api/system/settings` reads settings successfully
- [x] **Test 17**: PUT `/api/system/settings` updates settings successfully
- [x] **Test 18**: GET `/` serves camouflage template instead of admin page
- [x] **Test 19**: GET `/admin-dashboard` serves the admin login page
- [x] **Test 20**: PUT `/api/system/settings` updates security policy confirmation settings

#### Feature 5: Alerts & SMTP Diagnostics
- [x] **Test 21**: POST `/api/system/invite-codes` generates a valid invite code
- [x] **Test 22**: POST `/api/system/invite-codes/send` fails if SMTP is not configured
- [x] **Test 23**: POST `/api/system/email/test` diagnostics returns connection failure if unconfigured
- [x] **Test 24**: GET `/api/system/email/status` returns mailer settings state
- [x] **Test 25**: POST `/api/system/telegram/test` returns error if TG bot is unconfigured

---

### Tier 2: Boundary & Corner Cases (Tests 26-50)
#### Feature 1: Server & Node Management Boundary
- [x] **Test 26**: POST `/api/servers` fails if URL is missing
- [x] **Test 27**: POST `/api/servers` fails if credentials are missing
- [x] **Test 28**: POST `/api/servers` rejects invalid protocols
- [x] **Test 29**: POST `/api/servers/:id/test` for offline server returns connection error
- [x] **Test 30**: GET `/api/servers/:id/panel-api-tokens` redacts the tokens in response

#### Feature 2: User Policies & Traffic Enforcement Boundary
- [x] **Test 31**: GET `/api/user-policy/:email` for non-existent email returns default policy
- [x] **Test 32**: PUT `/api/user-policy/:email` rejects unknown server IDs
- [x] **Test 33**: PUT `/api/user-policy/:email` validates scope modes
- [x] **Test 34**: PUT `/api/user-policy/:email` validates protocol list
- [x] **Test 35**: PUT `/api/user-policy/:email` allows empty allowedProtocols list

#### Feature 3: Subscription Client Generation Boundary
- [x] **Test 36**: POST `/api/subscriptions/:email/issue` fails for invalid email format
- [x] **Test 37**: GET `/api/subscriptions/public/t/:tokenId/:token` with invalid token returns error status
- [x] **Test 38**: Public subscription retrieval fails if user is disabled
- [x] **Test 39**: GET `/api/subscriptions/public/t/:tokenId/:token` returns rate limit headers
- [x] **Test 40**: POST `/api/subscriptions/:email/revoke` revokes the token

#### Feature 4: System Settings & Camouflage Boundary
- [x] **Test 41**: PUT `/api/system/settings` fails for invalid settings payload
- [x] **Test 42**: PUT `/api/system/settings` rejects reserved access path /api
- [x] **Test 43**: PUT `/api/system/settings` rejects camouflage title containing precision systems
- [x] **Test 44**: POST `/api/auth/register` fails when inviteOnlyEnabled is true and no code is provided
- [x] **Test 45**: GET `/api/system/db/status` returns file mode state when DB_ENABLED is false

#### Feature 5: Alerts & SMTP Diagnostics Boundary
- [x] **Test 46**: Sending invitation fails when target email address is malformed
- [x] **Test 47**: POST `/api/auth/resend-code` fails if email registration was not initiated
- [x] **Test 48**: POST `/api/system/telegram/test` fails with explicit message when token is missing
- [x] **Test 49**: POST `/api/system/email/notice-users/preview` validates subject and content template
- [x] **Test 50**: POST `/api/system/batch-risk-token` requires confirmation token

---

### Tier 3: Cross-Feature Combinations (Tests 51-55)
- [x] **Test 51**: Cross-Feature: User policy enforces restricted protocols and servers in public subscription config
- [x] **Test 52**: Cross-Feature: Invite code registration automatically registers, validates, and provisions subscription
- [x] **Test 53**: Cross-Feature: Custom access path restricts original index endpoint but allows access path endpoint
- [x] **Test 54**: Cross-Feature: Server node deletion automatically updates user policies and removes it from subscription links
- [x] **Test 55**: Cross-Feature: Export and restore settings restore NMS configuration to previous state

---

### Tier 4: Real-World Application Scenarios (Tests 56-60)
- [x] **Test 56**: Scenario: Complete Admin Node/User Lifecycle Flow
- [x] **Test 57**: Scenario: Invite-Only Registration & Autoprovisioning Flow
- [x] **Test 58**: Scenario: System Migration & Backup Restore Lifecycle Flow
- [x] **Test 59**: Scenario: Security and Audit Trail Validation Flow
- [x] **Test 60**: Scenario: Node Outage and Recovery Traffic Baseline Flow
