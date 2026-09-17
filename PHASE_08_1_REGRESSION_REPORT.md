# T_SHOP — PHASE 08.1 REGRESSION REPORT
## FULL SYSTEM REGRESSION & POST-REMEDIATION AUDIT

**Author**: Senior QA / E2E & Full-Stack Architect  
**Timestamp**: 2026-09-10T13:12:00+07:00  
**Overall Status**: **100% PASSED (ZERO REGRESSIONS)**  

---

## 1. REGRESSION AUDIT SCOPE & METHODOLOGY

Following the remediation of Next.js Production Build errors and Account Isolation vulnerabilities, a comprehensive multi-tier regression audit was executed to guarantee that:
1. No offline capabilities were degraded.
2. No inventory reconciliation, FIFO costing, or duplicate prevention rules were compromised.
3. No authentication, token rotation, or device identity mechanisms broke.
4. No database records or schema integrity were affected.

---

## 2. DETAILED TEST GROUP RESULTS

### TEST GROUP A — WEB PRODUCTION BUILD
- **Command**: `npm run build` (`next build` with Turbopack)
- **Target**: Production server compilation, route data collection, and static page generation.
- **Results**:
  - Compiled successfully in 4.2s.
  - TypeScript validation: 0 errors (Finished in 1172ms).
  - Collecting page data: 7 workers.
  - Static page generation: 47/47 routes generated cleanly.
- **Status**: **PASS**

### TEST GROUP B — WEB FUNCTIONAL TESTS
- **Command**: `node scripts/test-runner.mjs`
- **Results**:
  - Authentication & Security: 7/7 PASS (Admin/Staff bcrypt verification, JWT signing & verification).
  - Categories & Product Types Hierarchy: 2/2 PASS.
  - FIFO Purchase Lots & COGS Resolution: 9/9 PASS (Multi-lot allocation, FIFO COGS 4,850,000đ, weighted average cost 87,500đ).
  - Sale Cancellation & Inventory Rollback: 5/5 PASS (Restoration to lots, status CANCELLED, reason saved).
  - Dashboard Aggregation: 1/1 PASS.
- **Summary**: **24 PASSED / 0 FAILED**
- **Status**: **PASS**

### TEST GROUP C — MOBILE RUNTIME & STATIC ANALYSIS
- **TypeScript**: `npm run typecheck` (`tsc --noEmit` in `mobile/`) $\rightarrow$ **0 ERRORS**.
- **Hermes Runtime Export**: `npx expo export` $\rightarrow$ Android & iOS bytecode bundles compile cleanly (2.4MB each).
- **Core Database & Service Test Runner**: `node tests/database.test.mjs` $\rightarrow$ **135 PASSED / 0 FAILED**.
- **Status**: **PASS**

### TEST GROUP D — ACCOUNT ISOLATION (TEST SUITE 29)
- **Test A (Sales Record Isolation)**: User B cannot see User A's sales; User A sees own sales $\rightarrow$ **PASS**.
- **Test B (Outbox Isolation)**: User B sync push cannot fetch User A's un-synced orders $\rightarrow$ **PASS**.
- **Test C (Conflict Center Isolation)**: User B cannot see or resolve User A's conflicts $\rightarrow$ **PASS**.
- **Test D (Cache Isolation)**: RAM and SessionStorage cache completely flushed on logout $\rightarrow$ **PASS**.
- **Test E (Cursor Isolation)**: User B cursor tracks independently without inheriting User A's cursor $\rightarrow$ **PASS**.
- **Status**: **PASS**

### TEST GROUP E — OFFLINE REGRESSION
- **Test Suite 2 (Atomic Sale)**: Local product stock decrements immediately in SQLite transaction $\rightarrow$ **PASS**.
- **Test Suite 3 (Partial Failure Rollback)**: Insufficient stock error rolls back entire transaction without partial deduction $\rightarrow$ **PASS**.
- **Test Suite 4 (Duplicate Order ID)**: Blocked by UNIQUE constraint on `client_order_id` $\rightarrow$ **PASS**.
- **Test Suite 5 (Offline Stock Receipt)**: Import transaction committed in SQLite, stock incremented, outbox mutation enqueued $\rightarrow$ **PASS**.
- **Test Suite 7 (Sequential Sales)**: 3 sequential sales on same product produce exact calculated balance (65 - 15 = 50) $\rightarrow$ **PASS**.
- **Test Suite 8 (Disk Persistence)**: All SQLite data survives full database close and reopen $\rightarrow$ **PASS**.
- **Status**: **PASS**

### TEST GROUP F — AUTHENTICATION & DEVICE IDENTITY REGRESSION
- **Test Suite 23 (Device Identity)**: UUID matches RFC 4122 v4; scoped Outbox mutation created with `user_id` and `device_id` $\rightarrow$ **PASS**.
- **Test Suite 24 (Access & Refresh Rotation)**: Refresh token rotated with cryptographic secret; revoked/stale tokens rejected $\rightarrow$ **PASS**.
- **Test Suite 25 (Single-Flight Refresh Mutex)**: Exactly 1 refresh network call executes for 5 concurrent 401 callers $\rightarrow$ **PASS**.
- **Test Suite 26 (Safe Logout Guard)**: Un-synced outbox mutations detected; warning raised; forced logout preserves SQLite data $\rightarrow$ **PASS**.
- **Test Suite 27 (Remote Revocation)**: Revoked session rejected; device lockout recognized $\rightarrow$ **PASS**.
- **Status**: **PASS**

### TEST GROUP G — SYNC ENGINE REGRESSION
- **Test Suite 6 (Outbox State Machine)**: PENDING $\rightarrow$ SYNCING $\rightarrow$ RETRY $\rightarrow$ SYNCED transitions $\rightarrow$ **PASS**.
- **Test Suite 9 (Server Idempotency)**: Duplicate client transaction detected; server stock never double-decremented $\rightarrow$ **PASS**.
- **Test Suite 10 (Stale Record Recovery)**: Interrupted SYNCING mutation recovered back to PENDING on restart $\rightarrow$ **PASS**.
- **Test Suite 11 (Exponential Backoff & Jitter)**: Retry delays match exponential calculation with jitter $\rightarrow$ **PASS**.
- **Test Suite 13 (Atomic Pull Cursor)**: Cursor commits atomically with delta changes; rollback on error preserves previous cursor $\rightarrow$ **PASS**.
- **Test Suite 14 (Concurrency Guard)**: Single sync lock prevents concurrent runs $\rightarrow$ **PASS**.
- **Test Suite 15 (Error Classification)**: 401 (PAUSE_AUTH), 429 (RETRY_BACKOFF), 409 (CONFLICT), 422 (FATAL_CLIENT_ERROR), 503 (RETRY_SERVER_ERROR) $\rightarrow$ **PASS**.
- **Test Suite 16 (Bidirectional E2E)**: Offline sale $\rightarrow$ Server push $\rightarrow$ Server ACK $\rightarrow$ Local status SYNCED $\rightarrow$ **PASS**.
- **Status**: **PASS**

### TEST GROUP H — INVENTORY & CONFLICT RESOLUTION REGRESSION
- **Test Suite 12 (Authoritative Stock Validation)**: Overdrawn order produces CONFLICT status and OPEN conflict record $\rightarrow$ **PASS**.
- **Test Suite 18 (Multi-Device Race)**: Device A accepted; Device B rejected with `INSUFFICIENT_STOCK`; server stock never negative $\rightarrow$ **PASS**.
- **Test Suite 19 (Payload Tampering Guard)**: Modified payload with same transaction ID rejected with `PAYLOAD_MISMATCH` $\rightarrow$ **PASS**.
- **Test Suite 20 (Non-Destructive Local Cancellation)**: Cancel local order; restore product stock; record compensating movement $\rightarrow$ **PASS**.
- **Test Suite 21 (Stock Drift Ledger Reconciliation)**: Detect drift; record in `stock_drift_records`; adjust ledger to match actual stock $\rightarrow$ **PASS**.
- **Test Suite 22 (Role-Based Authorization)**: Staff permitted for local cancellation; Staff denied for server restock override; Admin granted $\rightarrow$ **PASS**.
- **Status**: **PASS**

---

## 3. DATA INTEGRITY & SECURITY AUDIT

1. **Zero Data Loss**: No SQLite tables were dropped or recreated; all existing rows, products, and price history remain intact.
2. **Zero Sensitive Logging**: Audited all logger calls in `PushSyncHandler`, `SyncEngine`, `OutboxService`, `ConflictService`, and `AuthContext`. No passwords, tokens, or authorization headers are logged.
3. **No Destructive Migrations**: Zero database resets (`prisma migrate reset` was never run; SQLite file was never deleted).

---

## 4. FINAL ACCEPTANCE CHECKLIST

### ACCOUNT ISOLATION
- [x] User A không thấy Sale của User B
- [x] User B không thấy Sale của User A
- [x] Outbox được scope đúng account (`sync_queue.user_id`)
- [x] Push chỉ xử lý Outbox hợp lệ (`user_id = ? OR user_id IS NULL`)
- [x] Conflict được scope đúng account (`conflict_records.user_id`)
- [x] Sync cursor không cross-account (`pull_cursor_user_${userId}`)
- [x] TanStack / client query cache không leak (`clearClientCache()` on auth transitions)
- [x] Account switch an toàn
- [x] Logout an toàn
- [x] Pending Outbox không bị mất khi logout
- [x] User B không thể push transaction của User A
- [x] Server authorization không tin client `user_id`
- [x] IDOR test PASS (`CROSS_USER_HIJACKING_DETECTED`)

### WEB PRODUCTION BUILD
- [x] Next.js production build PASS (Turbopack, 47/47 routes)
- [x] Không disable TypeScript để đạt PASS
- [x] Không sử dụng `@ts-ignore` để che root cause
- [x] Excel import (preview & commit) vẫn hoạt động nguyên vẹn

### REGRESSION
- [x] Web tests PASS (24/24)
- [x] Mobile tests PASS (135/135)
- [x] SQLite tests PASS
- [x] Outbox tests PASS
- [x] Sync tests PASS
- [x] Conflict tests PASS
- [x] Auth tests PASS
- [x] Inventory tests PASS
- [x] Account isolation tests PASS
- [x] No data loss
- [x] No duplicate transaction
- [x] No negative inventory
