# T_SHOP — PHASE 01–08 CRITICAL RISK MATRIX

**Severity Levels**:
- **CRITICAL**: Threatens transaction loss, double deductions, negative inventory, credential theft, or system crash.
- **HIGH**: Account isolation leaks, un-scoped shared-device sync attribution, or potential operational confusion.
- **MEDIUM**: Build failures, environment configuration defaults, or performance bottlenecks.
- **LOW**: Minor cleanup, cosmetic items, or code comments.

---

| # | Risk Description | Severity | Probability | Impact | Evidence / Source Code Location | Recommendation |
|---|---|---|---|---|---|---|
| **RSK-01** | **Shared Device Outbox Sync Attribution Mismatch** | **HIGH** | High (if devices shared) | If Staff A creates offline sales and logs out, and Staff B logs in on same device, Staff B's auth token will push Staff A's pending outbox records, attributing sales to Staff B on server. | `mobile/src/services/OutboxService.ts` line 28 omits `user_id` on insert. `PushSyncHandler.ts` line 45 selects all `status = 'PENDING'` without filtering `WHERE user_id = ?`. | Update `OutboxService.enqueueMutation` to accept and write `user_id`, and update `PushSyncHandler.getEligibleMutations` to filter by current authenticated `user.id`. |
| **RSK-02** | **Local SQLite Sales History Shared Across Logouts** | **HIGH** | Medium | Staff B on the same POS phone can browse local sales transactions recorded by Staff A in `SalesScreen.tsx`. | `mobile/src/repository/sqlite/SqliteSaleDataSource.ts` line 173 `getAllSales()` does not filter by `created_by`. | Add `createdBy?: number` parameter to `getAllSales()` and pass `user.id` when caller is role `STAFF`. |
| **RSK-03** | **Next.js Web Production Build Failure (`next build`)** | **MEDIUM** | High | `next build` fails type checking on 5 lines in Excel preview and inventory import routes, preventing standard CI/CD deployment of the web app. | `src/app/api/excel/preview/route.ts:17-18`, `src/app/api/inventory/import-excel/route.ts:17-19` (`Property 'get' does not exist on type 'FormData'`). | Update the 5 lines with `(formData as any).get(...)` or refine root `tsconfig.json` DOM library mapping. |
| **RSK-04** | **Backend Fallback JWT Secret** | **MEDIUM** | Low (if env configured) | If `JWT_SECRET` is missing in server environment, server falls back to hardcoded default `'t_shop_secure_jwt_secret_key_2026_retail'`. | `src/lib/auth.ts` line 8: `const JWT_SECRET = process.env.JWT_SECRET || 't_shop_secure_jwt_secret_key_2026_retail';` | In production environments, throw error if `process.env.JWT_SECRET` is undefined instead of using a fallback string. |
| **RSK-05** | **POS Sales Checkout Defaulting createdBy to Admin** | **MEDIUM** | High | When cashier clicks "Thanh toán ngay" in `SalesScreen.tsx`, `createdBy` is omitted from the input, causing `OfflineSaleService.ts` line 175 to default to `1` (Admin) instead of the logged-in staff. | `mobile/src/screens/main/SalesScreen.tsx` line 103 `createMultiItemSale({...})` omits `createdBy: user?.id`. | Pass `createdBy: user?.id` in `SalesScreen.tsx` checkout handler. |
| **RSK-06** | **`data/t_shop.db` Excluded from `.gitignore`** | **LOW** | Medium | Local test SQLite database file could accidentally be staged and committed to Git if developer runs `git add .`. | `.gitignore` lines 42-43 ignores `*.db-shm` and `*.db-wal`, but lacks `data/t_shop.db` or `*.db`. | Add `data/*.db` and `*.db` to `.gitignore`. |
| **RSK-07** | **Large Outbox Memory Accumulation over Time** | **LOW** | Low | `sync_queue` records are marked `SYNCED` but never purged or archived, leading to gradual SQLite file growth over months. | `mobile/src/sync/PushSyncHandler.ts` line 165 sets `status = 'SYNCED'`. | Introduce a periodic background vacuum / cleanup service purging `SYNCED` mutations older than 30 days. |

---

## Zero Critical Defects Verified
- **Zero Transaction Loss**: All offline sales and stock receipts are written to SQLite within an atomic transaction.
- **Zero Double Deductions**: Server-side idempotency in `processed_sync_transactions` guarantees exactly one stock deduction even during network retries.
- **Zero Negative Inventory**: Multi-device race conditions are rejected with `INVENTORY_CONFLICT`; server stock is strictly bounded $\ge 0$.
- **Zero Plaintext Credential Exposure in SQLite**: Auth tokens and refresh secrets are stored strictly in `expo-secure-store`.
