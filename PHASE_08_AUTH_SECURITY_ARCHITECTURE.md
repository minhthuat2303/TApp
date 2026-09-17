# PHASE 08 — AUTHENTICATION & MULTI-DEVICE SECURITY ARCHITECTURE
**Project:** T_SHOP  
**Date:** 2026-09-10  
**Status:** Approved Architecture Design  

---

## 1. Architectural Principles & Non-Negotiable Invariants

1. **Non-Destructive Invariant**:
   - Authentication failure $\neq$ Data loss.
   - Logout $\neq$ Delete offline transactions.
   - Token expiration $\neq$ Delete Outbox items.
   - Device revocation $\neq$ Delete local transaction history.
2. **Zero-Trust Client Identity**:
   - The server **never** trusts `user_id`, `role`, or `created_by` sent in client request bodies.
   - User identity, permissions, and session status are strictly verified server-side from the authenticated session context.
3. **Storage Separation**:
   - Sensitive credentials (`access_token`, `refresh_token`, `user_session`) $\rightarrow$ **`expo-secure-store`** (Hardware Keychain/Keystore).
   - Business data (`products`, `sales`, `outbox`, `movements`, `conflicts`) $\rightarrow$ **`expo-sqlite`**.
   - Plaintext passwords and tokens are never stored in SQLite.
4. **Backward Compatibility**:
   - Central Next.js Web App authentication, cookie-based sessions, and existing web test suites must remain 100% intact with zero regressions.

---

## 2. Authentication & Session Architecture

```text
+-------------------------------------------------------------------------------+
|                               CENTRAL BACKEND                                 |
|                                                                               |
|  +--------------------+         +------------------+     +-----------------+  |
|  |       users        |         |     devices      |     |  user_sessions  |  |
|  |--------------------|         |------------------|     |-----------------|  |
|  | id (PK)            |<---+    | device_id (PK)   |<---+| session_id (PK) |  |
|  | username           |    +----| user_id (FK)     |    +| user_id (FK)    |  |
|  | password_hash      |         | platform         |     | device_id (FK)  |  |
|  | role (ADMIN/STAFF) |         | status (ACTIVE)  |     | rtoken_hash     |  |
|  +--------------------+         +------------------+     | status (ACTIVE) |  |
|                                                          | expires_at      |  |
|                                                          +-----------------+  |
+---------------------------------------^---------------------------------------+
                                        |
                 POST /api/auth/login   |  POST /api/auth/refresh
                 (username, pass, devId)|  (refreshToken, devId)
                                        v
+-------------------------------------------------------------------------------+
|                            T_SHOP MOBILE CLIENT                               |
|                                                                               |
|  +-------------------------------------------------------------------------+  |
|  |                         AuthManager / ApiClient                         |  |
|  |  * Injects Authorization: Bearer <accessToken>                          |  |
|  |  * Single-Flight Mutex on 401 (One refresh at a time, queued requests)  |  |
|  |  * Automatic 1-time retry on refresh success                            |  |
|  +------------------------------------^------------------------------------+  |
|                                       |                                       |
|                +----------------------+----------------------+                |
|                |                                             |                |
|  +-------------v--------------+               +--------------v-------------+  |
|  |      expo-secure-store     |               |         expo-sqlite        |  |
|  |----------------------------|               |----------------------------|  |
|  | * tshop_device_id (UUID v4)|               | * products, lots, pricing  |  |
|  | * tshop_access_token       |               | * sales_orders, records    |  |
|  | * tshop_refresh_token      |               | * sync_queue (Outbox)      |  |
|  | * tshop_auth_user          |               | * conflict_records         |  |
|  +----------------------------+               +----------------------------+  |
+-------------------------------------------------------------------------------+
```

---

## 3. Token Lifecycle & Cryptographic Refresh Rotation

### A. Access Token
- **Lifespan**: 15 minutes (`expiresIn: '15m'`).
- **Format**: Signed JWT with standard HMAC-SHA256.
- **Payload Claims**:
  ```json
  {
    "id": 1,
    "username": "staff",
    "full_name": "Nhân Viên Bán Hàng",
    "role": "STAFF",
    "session_id": "sess-uuid-456",
    "device_id": "dev-uuid-123"
  }
  ```
- **Transmission**: HTTP header `Authorization: Bearer <access_token>`.

### B. Refresh Token
- **Lifespan**: 30 days.
- **Entropy**: Cryptographically secure 256-bit random hex string (`crypto.randomBytes(32).toString('hex')`).
- **Server Storage**: Only SHA-256 digest is stored in `user_sessions.refresh_token_hash`. Plaintext is never stored on the server.
- **Client Storage**: Stored exclusively in `expo-secure-store`.
- **Single-Use Rotation**:
  1. Client sends `POST /api/auth/refresh` with `{ refresh_token, device_id }`.
  2. Server verifies `SHA-256(refresh_token)` matches `user_sessions.refresh_token_hash` and `status === 'ACTIVE'`.
  3. Server issues **new access token** + **NEW refresh token**.
  4. Server immediately updates `refresh_token_hash` in `user_sessions` and advances `last_refreshed_at`.
  5. The old refresh token is invalidated immediately.

---

## 4. Single-Flight Refresh Concurrency Control (AuthManager)

When multiple concurrent HTTP requests receive 401 (e.g. while pulling master data and pushing outbox):

```text
Request A (Push) -----> 401 --+
                              |
Request B (Pull) -----> 401 --+--> AuthManager: isRefreshing?
                              |    |
Request C (Me)   -----> 401 --+    |-- NO  --> Acquire lock -> Fire POST /api/auth/refresh
                                   |-- YES --> Join waiting subscriber queue
                                   v
                             Refresh completes:
                             * Store new access & refresh tokens
                             * Release lock
                             * Retry Request A, B, C ONCE with new access token
```

- **Loop Prevention**: Each request object is tagged with `_retry: true`. If a retried request still returns 401, it throws `AUTH_EXPIRED` immediately without refreshing again.

---

## 5. Offline Authentication & State Machine

T_SHOP distinguishes between two operational states:

1. **`AUTHENTICATED_ONLINE`**: User session confirmed with central server.
2. **`AUTHENTICATED_OFFLINE`**: Device is disconnected from Internet, but local session in `SecureStore` is valid. User has full authority to use all offline capabilities:
   - Search cached catalog & inventory.
   - Execute POS sales (committed to SQLite & Outbox).
   - Record warehouse receipts/imports (committed to SQLite & Outbox).

### State Machine Transition:
```text
                  [App Launch]
                       |
             Read SecureStore session
              /                 \
        Found                     None
          |                         |
      [ONLINE?]                 [AUTH_REQUIRED]
       /      \                     |
     Yes       No             (Login Screen)
     /          \                   |
[Verify me]  [AUTHENTICATED_OFFLINE]|
    |                               |
[AUTHENTICATED_ONLINE] <------------+
```

---

## 6. Offline Transactions with Expired Tokens

**Scenario**: A cashier conducts offline sales while disconnected. During this time, the 15-minute access token expires. The cashier then reconnects to Wi-Fi.

**Flow**:
1. `SyncEngine` detects network reconnection and triggers Outbox push.
2. `POST /api/sync/push` receives 401 because the access token has expired.
3. `AuthManager` catches the 401, pauses outgoing sync calls, and calls `POST /api/auth/refresh` with the stored refresh token.
4. Server verifies the session, rotates the tokens, and returns a fresh access token.
5. `AuthManager` replays the push mutation $\rightarrow$ sync succeeds seamlessly!
6. **If Refresh Fails (e.g. Session Revoked)**:
   - `PushSyncHandler` marks Outbox records as `PENDING` (reverted, never deleted).
   - `SyncEngine` halts with `AUTH_REQUIRED`.
   - Local sales records, inventory stock, and Outbox mutations remain **100% preserved in SQLite**.
   - Upon next login, the pending transactions automatically flush to the server.

---

## 7. Device Identity & Registration

- **`device_id`**:
  - Generated on first mobile app launch using UUID v4.
  - Persisted permanently in `expo-secure-store` under `tshop_device_id`.
  - Stable across app restarts and updates.
  - Sent with `POST /api/auth/login` and `POST /api/auth/refresh`.
- **Database Schema**:
  ```sql
  CREATE TABLE devices (
    device_id VARCHAR(100) PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    device_name VARCHAR(100),
    platform VARCHAR(20) NOT NULL, -- 'android' | 'ios' | 'web'
    app_version VARCHAR(50),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE' | 'REVOKED'
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE user_sessions (
    session_id VARCHAR(100) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(100) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE' | 'REVOKED' | 'EXPIRED'
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMPTZ,
    revoked_reason VARCHAR(255)
  );
  ```

---

## 8. Multi-Device Management & Revocation

- A user can be logged in concurrently on multiple devices (e.g., Device A at counter 1, Device B in the warehouse).
- Each device possesses its own `device_id` and independent `session_id`.
- Logging in on Device B does **NOT** invalidate Device A.
- **Revocation Flow**:
  - Admin or user calls `POST /api/devices/revoke` with `{ device_id }`.
  - Server sets `devices.status = 'REVOKED'` and all matching `user_sessions.status = 'REVOKED'`.
  - Next time Device B calls any API:
    - Server verifies session status $\rightarrow$ returns 401 with `{ code: 'SESSION_REVOKED' }`.
    - Refresh token rotation is rejected.
    - Mobile transitions to `AUTH_REQUIRED` while keeping local SQLite data intact.

---

## 9. Safe Logout with Pending Outbox Guard

When the user taps **Đăng xuất (Logout)**:
1. Mobile queries SQLite:
   ```sql
   SELECT COUNT(*) as pending FROM sync_queue WHERE status IN ('PENDING', 'SYNCING', 'RETRY');
   ```
2. **If `pending === 0`**:
   - Proceed with standard logout: call `POST /api/auth/logout`, clear `SecureStore` tokens, navigate to `LoginScreen`.
3. **If `pending > 0`**:
   - Present modal warning to user:
     > **⚠️ Cảnh báo: Còn X giao dịch chưa đồng bộ**  
     > Bạn có các đơn hàng offline chưa được gửi lên máy chủ. Bạn nên kết nối mạng và đồng bộ trước khi đăng xuất.
   - User choices:
     - **[Đồng bộ ngay]**: Triggers sync and keeps user logged in.
     - **[Tiếp tục đăng xuất (Bảo toàn dữ liệu)]**: Revokes server session and clears local credentials, but **retains the SQLite database and Outbox**.

---

## 10. Account Switching & Data Isolation

If User A logs out and User B logs in on the same device:
1. `sync_queue` items retain the `user_id` of the user who authorized the transaction.
2. In-memory TanStack Query caches and domain state are completely reset upon logout.
3. When sync runs:
   - Server validates transaction ownership:
     ```sql
     -- In processed_sync_transactions table
     WHERE client_transaction_id = ? AND user_id = ?
     ```
   - A transaction cannot be claimed or mutated by a different user account (`AUTHORIZATION_CONFLICT`).

---

## 11. Server-Side Authorization Matrix

| Action / Resource | Permission Required | Server-Side Enforcement |
| :--- | :--- | :--- |
| View Catalog / Search Products | `STAFF` or `ADMIN` | Verified via active token |
| Create Offline POS Sale | `STAFF` or `ADMIN` | Server sets `created_by = user.id` |
| Import Goods / Receipts | `STAFF` or `ADMIN` | Server sets `created_by = user.id` |
| Conflict Resolution (Restock & Accept) | `ADMIN` Only | Strict check: `user.role === 'ADMIN'` |
| Stock Ledger Reconciliation Override | `ADMIN` Only | Strict check: `user.role === 'ADMIN'` |
| Device Revocation | `ADMIN` or Device Owner | Strict check: `user.role === 'ADMIN' \|\| device.user_id === user.id` |
| Pull Delta Master Data | `STAFF` or `ADMIN` | Scoped to active tenant/account |

---

## 12. Security Logging & Error Taxonomy

- **Log Sanitization**:
  - `mobile/src/utils/logger.ts` redacts JWTs, passwords, and authorization headers.
  - Server logs audit entries in `audit_logs` without storing credentials.
- **Standard Error Codes**:
  - `AUTH_INVALID_CREDENTIALS`: Wrong username/password (HTTP 401).
  - `AUTH_EXPIRED`: Access/refresh token expired (HTTP 401).
  - `AUTH_REFRESH_FAILED`: Refresh token invalid or already rotated (HTTP 401).
  - `SESSION_REVOKED`: Session explicitly terminated by admin/user (HTTP 401).
  - `FORBIDDEN`: User lacks role permission for the operation (HTTP 403).
  - `DEVICE_REVOKED`: Device has been blacklisted or revoked (HTTP 401).
