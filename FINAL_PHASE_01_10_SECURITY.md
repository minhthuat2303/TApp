# T_SHOP — FINAL SECURITY AUDIT REPORT (PHASE 01–10)

## Security Architecture & Vulnerability Assessment

### 1. Hardcoded Secrets & Credential Exposure Audit
* **Static Code Scan**: Conducted across all `/mobile/src` and `/src` directories.
* **Findings**:
  * Zero JWT secrets, database passwords, or private keys committed to source code.
  * API endpoints dynamically resolve LAN host via `ExpoConstants.expoConfig?.hostUri` in development and fallback to HTTPS production domain.
  * Passwords hashed using `bcryptjs` with salt rounds = 10.
* **Status**: **PASS (Clean)**.

---

### 2. Authentication & Token Security Architecture
* **Access Token**: Short-lived JSON Web Token (15-minute expiration) containing user identity and role claims (`ADMIN` / `STAFF`).
* **Refresh Token Rotation**:
  * Every refresh cycle invalidates the old refresh token and issues a new cryptographic token secret.
  * Token reuse detection: Presenting an already-consumed refresh token immediately triggers session termination and logs a security event.
* **Single-Flight Concurrency Mutex**:
  * When multiple background requests encounter 401 simultaneously, a single-flight mutex queues all callers and executes exactly 1 network refresh request.
  * All callers resolve with the new token without sending duplicate refresh requests.
* **Status**: **PASS**.

---

### 3. Device Identity & Remote Revocation
* **Device Installation UUID**:
  * Generated on initial app install according to RFC 4122 v4 format.
  * Persisted in platform secure storage (`expo-secure-store` on native, isolated localStorage on web demo).
  * Included in all sync outbox entries (`sync_queue.device_id`) and sync requests.
* **Remote Device Revocation**:
  * When a device session is marked revoked on the server (`/api/devices/revoke`), server returns `REVOKED_DEVICE`.
  * Mobile client immediately halts sync, notifies the user, and clears active session tokens.
* **Status**: **PASS**.

---

### 4. Account Isolation & Shared Device Protection (Phase 08.1 Baseline)
* **Threat Model**: Multiple cashiers / staff members sharing a single physical POS terminal or phone.
* **Enforced Controls**:
  1. **SQLite Query Scoping**:
     * `sales_orders`, `sales_records`, and `sync_queue` records are tagged with `created_by` / `user_id`.
     * Queries by Staff users filter strictly by `WHERE created_by = currentUserId`.
     * Admin users possess store-wide read permissions for consolidated dashboard reporting.
  2. **Outbox Synchronization Scoping**:
     * `PushSyncHandler` queries mutations where `user_id = currentUserId`.
     * User B cannot push User A's pending mutations. User A's mutations remain safely pending on the device until User A logs back in.
  3. **In-Memory Cache Invalidation**:
     * `tokenStorage.clearAuthCredentials()` flushes access tokens, refresh tokens, and in-memory caches upon logout.
     * User B starts with a pristine session without inheriting User A's cursors or cached states.
* **Status**: **PASS (Verified by Automated Test Suite 29 in `database.test.mjs`)**.

---

### 5. Role-Based Access Control (RBAC)
* **ADMIN**:
  * Full access to Product Catalog, Inventory Adjustments, Supplier imports, Store-wide Reports, and Ledger Stock Overrides.
* **STAFF**:
  * Restricted to POS Sales, Cart Management, Receipt Printing, and viewing personal shift sales.
  * Denied access to server restock overrides and ledger stock overrides.
* **Status**: **PASS**.
