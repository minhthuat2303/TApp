# PHASE 08 — AUTHENTICATION & SECURITY AUDIT REPORT
**Project:** T_SHOP (Toy Store Management System)  
**Date:** 2026-09-10  
**Author:** Senior Mobile Architect & Backend Security Engineer  

---

## 1. Executive Summary
This audit provides a comprehensive, ground-truth assessment of the existing authentication, authorization, session handling, token storage, and offline transaction synchronization security across both the Next.js Web backend and the React Native / Expo Mobile App.

The primary objective is to implement a robust, enterprise-grade **Multi-Device, Offline-First Security Architecture** without breaking existing Web workflows, destroying database records, or deleting offline sales transactions during authentication failures or logouts.

---

## 2. Component-by-Component Deep Audit

### A. Current Mobile Authentication (`mobile/src/auth/`)
* **Login Flow**:
  - Screen: `mobile/src/screens/auth/LoginScreen.tsx` collects `username` and `password`.
  - Context: `AuthContext.tsx` calls `apiClient.post(Endpoints.AUTH_LOGIN, credentials, { skipAuth: true })`.
  - Success: Extracts `{ token, user }`, stores them in `expo-secure-store` via `tokenStorage.ts`, updates local state `isAuthenticated = true`.
* **Logout Flow**:
  - Calls `apiClient.post(Endpoints.AUTH_LOGOUT)`.
  - Clears `SecureStore` via `tokenStorage.clearAll()`.
  - Sets `user = null`, `token = null`.
  - **Identified Gap**: Logout currently wipes credentials but does NOT check if un-synced Outbox mutations or open conflicts exist in local SQLite. Does not warn user about pending offline data.
* **Token Implementation & Lifecycle**:
  - Current token is a single stateless JWT with a 7-day expiration.
  - **No Refresh Token**: Neither the client nor the server implements refresh tokens.
  - **No 401 Interceptor**: `mobile/src/api/client.ts` throws a `MobileError('AUTH_REQUIRED', ..., 401)` on receiving HTTP 401. It does not attempt to refresh or retry.
* **Token Storage**:
  - Uses `expo-secure-store` (backed by iOS Keychain and Android Keystore).
  - Keys: `tshop_auth_token` and `tshop_auth_user`.
  - Sensitive tokens are NOT stored in SQLite business tables (Compliance with Principle 2.22).
* **Session Handling**:
  - On app launch, `AuthContext.restoreSession()` reads credentials from `SecureStore`.
  - If credentials exist, user is immediately marked `isAuthenticated: true` (enabling instant offline startup).
  - Background verification against `GET /api/auth/me` is attempted.
  - **Identified Gap**: If `GET /api/auth/me` returns 401 (e.g. expired or revoked), the error is caught and logged as "skipped (offline or server unreachable)". It does not detect server revocation immediately.
* **Navigation Protection**:
  - `RootNavigator.tsx` conditionally renders `<MainStack />` if `isAuthenticated`, else `<AuthStack />`.

---

### B. Current Backend Authentication (`src/lib/auth.ts`, `src/app/api/auth/`)
* **User Identity Model**:
  - Table: `users` (`id`, `username`, `password_hash`, `full_name`, `role: ADMIN | STAFF`, `status: ACTIVE | INACTIVE`, `created_at`, `updated_at`).
  - Seeded users: `admin` (`ADMIN`, password `admin123`) and `staff` (`STAFF`, password `staff123`).
* **Password Hashing**:
  - Uses `bcryptjs` with salt factor 10 (`bcrypt.compareSync`). Passwords are never stored plaintext.
* **Token Signing & Verification**:
  - `signToken(user)` uses `jsonwebtoken` with secret `process.env.JWT_SECRET || 't_shop_secure_jwt_secret_key_2026_retail'`.
  - Token payload: `{ id, username, full_name, role }`.
  - Token expiration: `7d`.
* **Session & Revocation Mechanism**:
  - **Currently Stateless**: No `sessions` or `devices` table exists in PostgreSQL or SQLite. Tokens cannot be revoked server-side prior to expiration.
* **API Request Authentication**:
  - `getCurrentUser(request)` checks:
    1. Header: `Authorization: Bearer <token>` (used by Mobile).
    2. Cookie: `tshop_token` (used by Web App).
* **Authorization & Roles**:
  - Two roles: `ADMIN` and `STAFF`.
  - Endpoints like `/api/sync/conflicts/resolve` and `/api/inventory/receipts` explicitly check `user.role === 'ADMIN'`.
  - Protected API routes call `getCurrentUser(request)` and return 401 if missing.

---

### C. Current Database Schema (`src/lib/db.ts`)
* **Database Driver**:
  - Dual-mode: PostgreSQL pool (production) and SQLite fallback (`data/t_shop.db` for local dev/tests).
* **Existing Tables**:
  - Identity: `users`
  - Master Data: `categories`, `product_types`, `products`, `suppliers`
  - Pricing & Cost: `price_history`, `cost_price_history`, `inventory_lots`, `sale_cost_allocations`
  - Business Transactions: `sales_records`, `stock_movements`, `imports`, `import_items`
  - Audit & Sync: `audit_logs`, `processed_sync_transactions`, `import_logs`
* **Identified Gaps for Phase 08**:
  - No `devices` table (to track mobile hardware installations, device names, push status).
  - No `user_sessions` table (to track active device sessions, refresh token hashes, expiration, and revocation).
  - In `processed_sync_transactions`: Currently lacks `user_id` column. A client could theoretically claim an idempotency key created by a different user.

---

### D. Current Sync Architecture (`mobile/src/sync/`, `src/app/api/sync/`)
* **Outbox Queue (`sync_queue`)**:
  - Table in local SQLite: `client_mutation_id`, `entity_type`, `entity_id`, `action`, `payload_json`, `status`, `retry_count`, `last_error`, `next_retry_at`.
  - Status values: `PENDING`, `SYNCING`, `SYNCED`, `FAILED`, `RETRY`.
* **PushSyncHandler Auth Error Handling**:
  - Lines 136-142 of `PushSyncHandler.ts`:
    ```typescript
    if (mobileError.statusCode === 401 || mobileError.statusCode === 403) {
      for (const record of eligibleRecords) {
        await this.db.execute("UPDATE sync_queue SET status = 'PENDING' WHERE id = ?", [record.id]);
      }
      throw mobileError;
    }
    ```
  - **Compliance Check**: If 401 occurs, Outbox mutations are reverted to `PENDING` (NOT marked FAILED, NOT deleted). Offline sales and transactions are completely preserved!
* **Critical Scenario: Token Expired During Offline Transactions**:
  - If a cashier makes 5 sales offline and the access token expires:
  - When reconnecting to Internet, sync triggers $\rightarrow$ server responds with 401.
  - Because there is no automatic token refresh, sync halts repeatedly with 401 until manual re-login.
  - **Solution needed in Phase 08**: Auto-refresh interceptor with single-flight mutex lock. If refresh succeeds, retry push seamlessly. If refresh fails (session revoked), transition to `AUTH_REQUIRED` while keeping Outbox intact.

---

### E. Current SQLite Database (`mobile/src/database/`)
* **Migrations Applied**:
  - `001_initial_master_data`
  - `002_transactions_and_inventory`
  - `003_outbox_and_sync_metadata`
  - `004_offline_transactions_and_outbox_engine`
  - `005_conflict_records_and_sync_sessions`
  - `006_conflict_taxonomy_and_reconciliation`
* **Local Data Ownership**:
  - `sales_orders.created_by`, `sales_records.created_by`, `stock_movements.created_by` track the user who executed the local transaction.
  - `sync_queue` does not currently store `user_id` or `device_id` as explicit queryable columns.
* **Storage Separation**:
  - Business entities and transaction ledger remain in SQLite.
  - Secret credentials (JWT tokens, user session payload) remain in `SecureStore`.

---

### F. Web App Compatibility & Zero Regression
* **Shared User Identity**:
  - Web App and Mobile App share the exact same `users` table and password hashes.
* **Session Mechanism**:
  - Web App uses HTTP-only cookie `tshop_token` + `localStorage.getItem('tshop_token')`.
  - Web App does not send `device_id`.
  - **Zero Regression Rule**: Backend login route `POST /api/auth/login` must remain 100% backward compatible:
    - If request contains no `device_id` (Web request): generate 7-day token, set HTTP-only cookie, return standard response.
    - If request contains `device_id` (Mobile request): issue short-lived access token, generate & hash refresh token, register/update device session, return tokens in JSON payload.
* **Web Tests**:
  - `scripts/test-runner.mjs` verifies admin/staff credentials, password bcrypt check, and JWT verification. All 24 tests must remain PASS.

---

## 3. Findings & Required Architecture Extensions

| Finding ID | Component | Issue / Observation | Required Phase 08 Solution |
| :--- | :--- | :--- | :--- |
| **F-01** | Backend DB | No session or device tracking in database. | Add `devices` and `user_sessions` tables to PostgreSQL and SQLite fallback schemas. |
| **F-02** | Token Lifecycle | Single 7-day token; no refresh token or rotation. | Short-lived access token (15m) + secure refresh token (30d) with cryptographic rotation. |
| **F-03** | Mobile HTTP | No 401 auto-refresh interceptor; calls fail on 401. | Create `AuthManager` with single-flight refresh lock and transparent 1-time request retry. |
| **F-04** | Device Identity | Mobile has no persistent device identifier. | Generate and persist UUID v4 `device_id` in `SecureStore`; register with server on login. |
| **F-05** | Multi-Device | Server cannot revoke specific device session. | Implement `POST /api/devices/revoke` to terminate stolen or obsolete device sessions. |
| **F-06** | Logout Safety | Logout clears credentials without checking outbox. | Add safety guard: check for pending outbox items before logout, warn user, prevent data loss. |
| **F-07** | Account Isolation | Switching users on same device could expose un-synced data. | Scope local session and outbox items by `user_id`; prevent cross-account transaction theft. |
| **F-08** | Sync Idempotency | `processed_sync_transactions` lacks `user_id` check. | Associate `user_id` with sync transactions; reject cross-user client transaction IDs. |
