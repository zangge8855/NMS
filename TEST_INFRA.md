# E2E Test Infra: NMS

## Test Philosophy
- **Opaque-Box Verification**: The test suite treats NMS as a black box, starting the server as a background subprocess on a dynamic port and querying it via REST APIs and public URLs.
- **Independence & Isolation**: Tests use a unique, ephemeral data directory (`DATA_DIR`) for each run to guarantee clean state. Mocks are used for upstream 3x-ui panels, ensuring no external dependencies.
- **Requirement-Driven**: Test cases are derived strictly from user requirements and acceptance criteria in `ORIGINAL_REQUEST.md`.

## Feature Inventory
| # | Feature | Source (Requirement) | Tier 1 (Coverage) | Tier 2 (Boundary) | Tier 3 (Cross) |
|---|---------|---------------------|:----------------:|:----------------:|:--------------:|
| 1 | Server & Node Management | ORIGINAL_REQUEST §R1, R2 | 5 | 5 | ✓ |
| 2 | User Policies & Traffic Enforcement | ORIGINAL_REQUEST §R1, R4 | 5 | 5 | ✓ |
| 3 | Subscription Client Generation | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 4 | System Settings & Camouflage | ORIGINAL_REQUEST §R1, R4, R5 | 5 | 5 | ✓ |
| 5 | Alerts & SMTP Diagnostics | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |

## Test Architecture
- **Test Runner**: Node Native Test Runner (`node --test`).
- **Dynamic Port Selection**: Starts the Express server in a child process on a random TCP port.
- **REST / HTTP client**: Uses the native `fetch` API for zero external dependency.
- **Verification Logic**: Checks response status codes, header values, JSON structures, error message translations, and config content constraints.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Complete Admin Node/User Lifecycle | Node, User, Policy, Subscription | High |
| 2 | Invite-Only Registration & Autoprovisioning Flow | Settings, User, Account, Subscription | High |
| 3 | System Migration & Backup Restore Lifecycle | Settings, Backup, Restore, Subscription | High |
| 4 | Security and Audit Trail Validation | Security, Audit, Batch replay, Subscriptions | High |
| 5 | Node Outage and Recovery Traffic Baseline | Node, Cache, Traffic baseline | High |

## Coverage Thresholds
- Tier 1: 25 test cases (5 per feature)
- Tier 2: 25 test cases (5 per feature)
- Tier 3: 5 test cases (covering major interactions)
- Tier 4: 5 real-world application scenarios
- **Total: 60 E2E test cases**
