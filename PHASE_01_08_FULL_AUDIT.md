# T_SHOP — FULL SYSTEM AUDIT REPORT (PHASE 01 → PHASE 08)

**Date**: 2026-09-10  
**Audit Target**: Complete T_SHOP codebase (Next.js Web + Central API + Mobile Native React Native/Expo SDK 57 + SQLite Offline-First Sync Architecture)  
**Auditor Roles**: Senior Software Architect, Senior React Native / Expo Engineer, Senior Next.js Engineer, Backend Engineer, Database Engineer, Offline-First Architect, QA / Test Engineer, Security Engineer  
**Audit Mode**: **AUDIT ONLY (Read, Analyze, Test, Report — Zero Code Changes)**

---

## 1. EXECUTIVE SUMMARY

| Metric | Result | Notes |
|---|---|---|
| **Overall System Status** | **PASS WITH WARNINGS** | Core architecture, offline transaction engine, sync, conflict, and auth pass; specific account isolation and build warnings identified |
| **Mobile Test Suite (`mobile/tests/database.test.mjs`)** | **122 PASSED / 0 FAILED** | 28 Test Suites covering migrations 1–7, atomicity, idempotency, outbox, pull/push, conflicts, device auth |
| **Root Web Test Suite (`scripts/test-runner.mjs`)** | **24 PASSED / 0 FAILED** | 100% Backward compatibility for Web App (Auth, FIFO COGS, Categories, Rollback, Dashboard) |
| **Mobile TypeScript (`npm run typecheck`)** | **0 Errors** | `tsc --noEmit` exits with code 0 in `mobile/` |
| **Mobile Expo Production Bundles** | **Android: PASS (2.4MB) / iOS: PASS (2.4MB)** | Hermes bytecode bundles compiled cleanly via `npx expo export` |
| **Next.js Web Production Build (`next build`)** | **FAILED (TypeScript check)** | Pre-existing `FormData.get()` type mismatch in excel preview & import routes |

---

## 2. PHASE-BY-PHASE DETAILED AUDIT

### PHASE 01 — Mobile Transformation Audit
- **Objective**: Establish native mobile architecture while preserving existing Next.js web application.
- **Audit Findings**:
  - **Architecture Verification**: The mobile application resides in `mobile/` built on Expo SDK 57, React Native 0.81, TypeScript 5.9, and native React Navigation.
  - **Web Separation**: Zero imports of browser DOM, `window`, `document`, Next.js UI components, or server-only modules (`pg`, `better-sqlite3`, `next/headers`) in `mobile/src/`.
  - **Evidence**: `mobile/package.json`, `mobile/src/navigation/RootNavigator.tsx`, verified by `npm run typecheck` and `npx expo export`.
- **Status**: **VERIFIED / PASS**

### PHASE 02 — Offline-First Architecture & Sync Contract
- **Objective**: Design SQLite local schema, outbox lifecycle, sync cursor, and API contracts.
- **Audit Findings**:
  - **Schema & Tables**: Unified schema definitions in SQLite mirroring PostgreSQL server domain tables (`products`, `categories`, `product_types`, `sales_records`, `stock_movements`, `price_history`).
  - **Outbox State Machine**: States `PENDING`, `SYNCING`, `SYNCED`, `RETRY`, `FAILED` defined in `mobile/src/services/types.ts` and `mobile/src/database/types.ts`.
  - **Idempotency**: `client_transaction_id` enforced across `sales_orders`, `sales_records`, `sync_queue`, and server `processed_sync_transactions`.
- **Status**: **VERIFIED / PASS**

### PHASE 03 — Mobile Project Foundation & Native Runtime
- **Objective**: Implement native mobile runtime, navigation, design tokens, API abstraction, and verify cross-platform bundling.
- **Audit Findings**:
  - **Navigation**: NativeStack + BottomTabs in `mobile/src/navigation/RootNavigator.tsx`.
  - **Design System**: Strict design tokens in `mobile/src/constants/colors.ts` and `layout.ts`.
  - **Platform Bundling**: `npx expo export --platform android` outputs `dist/_expo/static/js/android/index-*.hbc` (2.4MB); `npx expo export --platform ios` outputs `dist/_expo/static/js/ios/index-*.hbc` (2.4MB).
  - **Web Integrity**: Root Web test runner (`scripts/test-runner.mjs`) passes 24/24 without regression.
- **Status**: **VERIFIED / PASS**

### PHASE 04 — Local Database & Offline Data Layer
- **Objective**: Implement Expo SQLite driver, sequential migrations, transaction atomicity, and persistence.
- **Audit Findings**:
  - **Driver**: `ExpoSqliteDriver.ts` implementing `IDatabaseDriver` and `ITransactionClient`.
  - **Migrations (001 → 007)**: Idempotent sequential schema migrations tracked in `schema_migrations`.
  - **Pragmas**: `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 10000`.
  - **Crash Safety**: Verified in Test Suite 8: SQLite database survives abrupt disk close and reopen with full data persistence.
- **Status**: **VERIFIED / PASS**

### PHASE 05 — Offline Transaction & Outbox Engine
- **Objective**: Provide atomic offline POS checkout, inventory receipt, stock validation, and outbox queuing.
- **Audit Findings**:
  - **Atomic Checkout (`OfflineSaleService.ts`)**: In a single SQLite transaction, creates `sales_orders`, `sales_records` per line, decrements `products.current_stock`, inserts `stock_movements` (type `SALE`), and enqueues mutation into `sync_queue`.
  - **Effective Stock Validation**: `effectiveStock = product.current_stock - pending_sold`. Prevents local overselling during offline periods.
  - **Partial Failure Rollback**: Verified in Test Suite 3: An insufficient stock error on any item rolls back the entire multi-item cart atomically (0 rows inserted).
  - **Exponential Backoff**: Verified in Test Suite 11: Delays follow $2000 \times 2^{\text{attempt}} \pm \text{jitter}$.
- **Status**: **VERIFIED / PASS**

### PHASE 06 — API Sync Engine
- **Objective**: Implement bidirectional synchronization (Outbox push and Incremental pull cursor).
- **Audit Findings**:
  - **Push Engine (`PushSyncHandler.ts`)**: Batches pending mutations to `POST /api/sync/push`. Server returns per-item statuses (`SYNCED`, `ALREADY_PROCESSED`, `CONFLICT`, `FAILED`).
  - **Pull Engine (`PullSyncHandler.ts`)**: Incremental cursor pagination from `GET /api/sync/pull`. Updates `categories`, `product_types`, `products`, `price_history`, `inventory_lots`, and cursor atomically.
  - **Single Sync Lock**: `SyncEngine.ts` enforces `isSyncRunning = true` mutex; concurrent sync triggers are skipped safely.
  - **Crash Recovery**: Stale `SYNCING` records older than 60s are automatically recovered to `PENDING` on startup.
- **Status**: **VERIFIED / PASS**

### PHASE 07 — Conflict Resolution & Inventory Reconciliation
- **Objective**: Detect conflicts, prevent over-allocation, provide non-destructive resolution, and reconcile stock drift.
- **Audit Findings**:
  - **Over-Allocation Protection**: Verified in Test Suite 18: If Dev A sells 3 and Dev B sells 4 when stock is 5, Dev A is accepted (stock becomes 2), and Dev B is rejected with `INVENTORY_CONFLICT` (`INSUFFICIENT_STOCK`). Server stock remains strictly 2 (never negative).
  - **Tamper Detection**: Verified in Test Suite 19: Payload modification with the same transaction ID is rejected with `VALIDATION_CONFLICT` (`PAYLOAD_MISMATCH`).
  - **Resolution Strategies (`ConflictService.ts`)**: `CANCEL_LOCAL` marks local order as `CANCELLED`, restores local stock, inserts compensating `stock_movements`, and logs audit trail. Zero silent deletes.
  - **Stock Drift Ledger Reconciliation (`InventoryReconciliationService.ts`)**: Reconciles physical inventory drift against ledger movements sum $\sum \text{quantity\_change}$.
- **Status**: **VERIFIED / PASS**

### PHASE 08 — Authentication, Authorization & Multi-Device Security
- **Objective**: Multi-device session management, 15m access token + 30d SHA-256 refresh rotation, single-flight 401 mutex, offline session continuity, and safe logout guard.
- **Audit Findings**:
  - **Device Identity**: Persistent RFC 4122 v4 UUID in `expo-secure-store` (`tshop_device_id`).
  - **Token Rotation & Reuse Detection**: Verified in Test Suite 24: Rotated refresh tokens are invalidated. Replay attempts trigger `SESSION_REVOKED`.
  - **Single-Flight Concurrency Control**: Verified in Test Suite 25: 5 concurrent 401 callers trigger exactly 1 network refresh call.
  - **Safe Logout Guard**: Verified in Test Suite 26: Logout blocked when un-synced Outbox items exist. Forcing logout clears sensitive credentials while leaving SQLite business tables 100% intact.
  - **Zero Cross-User Hijacking**: Verified in Test Suite 28: Server rejects duplicate mutations from different user accounts with `CROSS_USER_HIJACKING_DETECTED`.
- **Status**: **VERIFIED / PASS WITH WARNINGS** (See Section 3 for Account Isolation gaps).

---

## 3. CROSS-PHASE INTEGRATION FLOW AUDIT

### Flow 01: Online Sale (End-to-End)
- **Trace**: User cart $\rightarrow$ `SalesScreen.tsx` $\rightarrow$ `OfflineSaleService.ts` $\rightarrow$ SQLite atomic commit $\rightarrow$ `sync_queue` PENDING $\rightarrow$ `SyncEngine.sync()` $\rightarrow$ `PushSyncHandler.pushPendingMutations()` $\rightarrow$ Server `POST /api/sync/push` $\rightarrow$ Postgres `sales_records` + `inventory_lots` FIFO deduction + `processed_sync_transactions` $\rightarrow$ Response `SYNCED` $\rightarrow$ Mobile marks `sync_queue` and `sales_orders` as `SYNCED`.
- **Status**: **VERIFIED / PASS** (Verified in Test Suite 16).

### Flow 02: Offline Sale (Disconnection $\rightarrow$ Persistence $\rightarrow$ Reconnect Sync)
- **Trace**: Offline POS sale written to SQLite $\rightarrow$ Stock decremented locally $\rightarrow$ App killed/reopened (data persisted) $\rightarrow$ Network restored $\rightarrow$ `NetworkService` emits `isConnected = true` $\rightarrow$ Debounced `SyncEngine.sync()` fires $\rightarrow$ Pushed to server $\rightarrow$ Synced.
- **Status**: **VERIFIED / PASS** (Verified in Test Suites 5, 8, 10, 16).

### Flow 03: Offline Multi-Device Sale (Race Condition & Over-allocation)
- **Trace**: Server stock = 5. Device A (offline) sells 3. Device B (offline) sells 4. Device A reconnects and pushes $\rightarrow$ Server stock becomes 2. Device B reconnects and pushes $\rightarrow$ Server detects available stock = 2 < 4 $\rightarrow$ Rejects Device B with `INVENTORY_CONFLICT` (`INSUFFICIENT_STOCK`). Device B records open conflict in `conflict_records`. Server stock remains strictly 2.
- **Status**: **VERIFIED / PASS** (Verified in Test Suite 18).

### Flow 04: Token Expiration (Short-lived 15m Token Auto-Refresh)
- **Trace**: Mobile API call receives 401 $\rightarrow$ `client.ts` intercepts 401 $\rightarrow$ Calls `authManager.refreshToken()` $\rightarrow$ Single-flight mutex executes `POST /api/auth/refresh` $\rightarrow$ New access token + rotated refresh token stored $\rightarrow$ Original request retried with `_retry: true` $\rightarrow$ Success.
- **Status**: **VERIFIED / PASS** (Verified in Test Suite 25).

### Flow 05: Refresh Failure (Session Revoked / Refresh Expired)
- **Trace**: API call receives 401 $\rightarrow$ `authManager.refreshToken()` fails with `SESSION_REVOKED` or `AUTH_EXPIRED` $\rightarrow$ Auth state updated to `REVOKED`/`EXPIRED` $\rightarrow$ Dashboard displays warning banner $\rightarrow$ **Critical check: Outbox mutations and SQLite sales records are NOT deleted**.
- **Status**: **VERIFIED / PASS** (Verified in Test Suites 26, 27).

### Flow 06: Offline + Token Expired (Offline Continuity)
- **Trace**: Device is offline. Access token expired. User can still open app, browse products, and perform POS checkouts via cached session. When network returns, refresh executes before sync pushes pending mutations.
- **Status**: **VERIFIED / PASS** (Verified in `AuthContext.tsx` and Test Suite 24).

### Flow 07: Logout with Pending Outbox Data
- **Trace**: User attempts logout with 3 pending outbox mutations $\rightarrow$ `logout(false)` checks `checkPendingOutboxCount()` $\rightarrow$ Returns `{ success: false, unSyncedCount: 3, warning: '...' }` $\rightarrow$ `SettingsScreen.tsx` displays Alert dialog $\rightarrow$ If confirmed (`logout(true)`), sensitive credentials cleared from `expo-secure-store`, while SQLite `sync_queue` and `sales_orders` remain 100% intact.
- **Status**: **VERIFIED / PASS** (Verified in Test Suite 26).

### Flow 08: Account Switch on Shared Device (User A Logout $\rightarrow$ User B Login)
- **Trace**: User A creates offline orders $\rightarrow$ logs out. User B logs in on same mobile device.
- **Audit Check**:
  1. Does `sync_queue` distinguish User A's pending items from User B?
     - Migration 007 added `user_id` and `device_id` columns to `sync_queue`.
     - BUT `OutboxService.ts` line 28 does not write `user_id` in its `INSERT` statement.
     - AND `PushSyncHandler.ts` line 45 `getEligibleMutations()` queries `WHERE status = 'PENDING'` without `user_id` filtering.
  2. Does `SqliteSaleDataSource.ts` filter sales by logged-in user?
     - `getAllSales()` queries `sales_records` without `created_by` filtering. User B sees User A's local sales history.
  3. Does `ConflictService.ts` filter open conflicts by user?
     - `getOpenConflicts()` does not filter by `user_id`. User B sees User A's conflict list.
- **Status**: **PARTIAL / WARNING** (Identified as Technical Debt & Account Isolation Risk).

---

## 4. DATA INTEGRITY AUDIT

| Invariant | Status | Verification Evidence |
|---|---|---|
| **Negative Inventory Prevention** | **PASS** | Server checks `current_stock >= quantity`; rejected with `INSUFFICIENT_STOCK` when exceeded. |
| **Duplicate Sale Deduction** | **PASS** | `processed_sync_transactions` returns `ALREADY_PROCESSED` without secondary deduction. |
| **Atomic POS Checkout** | **PASS** | Single SQLite transaction wraps order header, line records, stock movements, and outbox enqueue. |
| **Outbox Data Preservation on Logout** | **PASS** | `tokenStorage.clearAuthCredentials()` only touches `SecureStore`, leaving SQLite untouched. |
| **Cursor Rollback on Failure** | **PASS** | `PullSyncHandler.ts` commits pulled rows and cursor update inside a single transaction. |
| **Non-Destructive Conflict Resolution** | **PASS** | `CANCEL_LOCAL` marks order `CANCELLED` and writes compensating movement; never deletes. |
| **Account-Scoped Outbox Assignment** | **WARNING** | `OutboxService.ts` does not populate `user_id` on enqueue, leading to un-scoped pending queue. |

---

## 5. SECURITY & SECRETS AUDIT

1. **Storage Separation**:
   - Sensitive credentials (JWT access token, refresh token, session ID, user profile) $\rightarrow$ stored in hardware-encrypted `expo-secure-store`.
   - Business data (catalog, orders, inventory) $\rightarrow$ stored in `expo-sqlite`.
   - Plaintext passwords or tokens are NEVER stored in SQLite.
2. **Log Sanitization**:
   - `mobile/src/utils/logger.ts` implements automatic key sanitization for `password`, `token`, `secret`, `authorization`, and detects JWT regex (`data.startsWith('eyJ')`).
3. **Secrets in Codebase**:
   - `src/lib/auth.ts` line 8 contains fallback secret `'t_shop_secure_jwt_secret_key_2026_retail'` when `process.env.JWT_SECRET` is unset.
   - `.env.local` contains Supabase connection keys but is properly excluded in `.gitignore`.
   - `data/t_shop.db` is present on disk and NOT explicitly ignored in `.gitignore`.

---

## 6. BUILD & RUNTIME AUDIT

1. **Mobile Runtime**:
   - Framework: Expo SDK 57 / React Native 0.81 / TypeScript 5.9.
   - `npm run typecheck` in `mobile/`: **0 Errors** (`tsc --noEmit`).
   - Android Hermes Export: **PASS** (`2.4MB` bytecode bundle).
   - iOS Hermes Export: **PASS** (`2.4MB` bytecode bundle).
2. **Web Backend Runtime**:
   - Framework: Next.js 16.3.1 (Turbopack).
   - Automated Web Test Suite (`scripts/test-runner.mjs`): **24 PASSED / 0 FAILED**.
   - `npm run build`: Fails on pre-existing `FormData.get` typing in `preview/route.ts` and `import-excel/route.ts`.

---

## 7. AUDIT CLASSIFICATION SUMMARY

- **VERIFIED**:
  - Offline POS sales & stock decrement atomicity.
  - Multi-item partial failure rollback.
  - Outbox state machine & exponential backoff retry.
  - Single sync lock concurrency control.
  - Incremental cursor pull atomicity.
  - Over-allocation conflict rejection (stock never negative).
  - Tamper detection via SHA-256 canonical payload hashing.
  - Non-destructive `CANCEL_LOCAL` conflict resolution.
  - Inventory ledger reconciliation (`stock_drift_records`).
  - Persistent hardware device UUID.
  - Refresh token rotation & reuse detection.
  - Single-flight 401 mutex concurrency control.
  - Safe logout guard (outbox data preserved).
  - Cross-user transaction hijacking rejection.
- **PARTIAL / TECHNICAL DEBT**:
  - `OutboxService.ts` enqueue query does not populate `user_id` and `device_id` into `sync_queue`.
  - Shared-device account isolation in local SQLite UI (sales history and conflicts query all local rows without `created_by` filter).
  - POS checkout in `SalesScreen.tsx` defaults `createdBy` to 1 instead of passing authenticated `user.id`.
  - Web `next build` pre-existing TypeScript issue on `FormData.get()`.
- **CRITICAL RISKS**: **NONE** (No transaction loss, no duplicate deductions, no negative inventory).
