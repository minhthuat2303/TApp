# T_SHOP — PHASE 08.1 BASELINE SNAPSHOT

Timestamp: 2026-09-10T11:10:00+07:00
Environment: Windows 11 / Node.js v20+ / React Native 0.83.2 / Expo SDK 57 / Next.js 16.3.1 (Turbopack) / React 19.2.8

============================================================
BASELINE AUDIT MATRIX
============================================================

| CHECK | EXPECTED | ACTUAL | STATUS |
| :--- | :--- | :--- | :--- |
| **Git Status** | Clean working tree or tracked changes only | Modified: `data/t_shop.db`, `src/app/api/auth/*`, `src/lib/*`. Untracked: Phase reports, `mobile/`, new API endpoints (`/sync`, `/devices`, `/reconciliation`). No uncommitted git reset. | PASS (RECORDED) |
| **TypeScript (Web)** | `next build` passes type check with zero errors | `next build` failed with 5 TS errors: TS2339 `Property 'get' does not exist on type 'FormData'` in `preview/route.ts` and `import-excel/route.ts`. | FAIL |
| **TypeScript (Mobile)** | `tsc --noEmit` exits with code 0 | Exited with code 0. Zero errors across all mobile components, repositories, and services. | PASS |
| **Lint Status (Root & Mobile)** | Standard code quality check | No `lint` script configured in `package.json` (root or mobile). Code formatting consistent across projects. | N/A (NO SCRIPT) |
| **Web Test Runner** | 24 core backend tests pass (`node scripts/test-runner.mjs`) | 24 PASSED / 0 FAILED (Auth, Categories, FIFO COGS, Cancellation, Dashboard). | PASS |
| **Mobile Test Runner** | All automated tests pass (`node tests/database.test.mjs`) | 122 PASSED / 0 FAILED across 28 test suites. | PASS |
| **Web Production Build** | `next build` produces production Turbopack output | Build aborted during `Running TypeScript ...` due to `FormData.get()` type mismatch. | FAIL |
| **Mobile Runtime / Hermes** | Hermes JS bundles compile for Android/iOS | Android & iOS Hermes bytecode generated cleanly (2.4MB each) in `dist/`. | PASS |
| **SQLite Tests** | Tables, migrations, atomicity, and rollback work offline | 122/122 passed in mobile suite (Migrations 001-007 verified). | PASS |
| **Sync Tests** | Push, pull, idempotency, backoff, cursor tracking | Test Suites 6, 9, 10, 11, 13, 14, 15, 16 all PASS. | PASS |
| **Auth Tests** | Password hashing, JWT signing, refresh rotation, device sessions | Test Suites 1, 23, 24, 25, 26, 27 all PASS. | PASS |
| **Conflict Tests** | Stock drift, non-destructive resolution, multi-device races | Test Suites 12, 17, 18, 19, 20, 21, 22 all PASS. | PASS |
| **Account Isolation (Local)** | Local mutations, Outbox, and Sales strictly scoped to user | Identified vulnerability: Outbox enqueued without user ID, Push queries without user scope, Sales list lacks user filtering. | TARGET FOR REMEDIATION |

============================================================
AUDITED REMEDIATION TARGETS
============================================================

1. **Target 1: Next.js Web Production Build**:
   - `src/app/api/excel/preview/route.ts`: Lines 17, 18 `formData.get()` TS2339.
   - `src/app/api/inventory/import-excel/route.ts`: Lines 17, 18, 19 `formData.get()` TS2339.
   - Root Cause: Node.js global `FormData` vs Web standard `FormData` conflicting definition under `@types/node` v26.

2. **Target 2: Local Account Isolation**:
   - `mobile/src/services/OutboxService.ts`: `enqueueMutation` does not populate `user_id` and `device_id` into `sync_queue`.
   - `mobile/src/sync/PushSyncHandler.ts`: `getEligibleMutations()` queries all pending items regardless of current authenticated user.
   - `mobile/src/screens/main/SalesScreen.tsx`: `handleCheckout` does not pass `createdBy: user?.id`.
   - `mobile/src/repository/sqlite/SqliteSaleDataSource.ts`: `getAllSales()` does not filter by user.
   - `mobile/src/sync/ConflictService.ts`: `getOpenConflicts()` does not filter by user.
   - `mobile/src/context/AuthContext.tsx` / Cache: Query client cache must clear on account switch to prevent data leakage.
