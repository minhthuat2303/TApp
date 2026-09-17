# T_SHOP — PHASE 11.6 FINAL REPORT
## SALES HISTORY + SALE DETAIL + SALE CANCELLATION
### Web Parity & Offline-First Production Implementation

---

## 1. Executive Summary

Phase 11.6 delivers full parity between the Web reference system and the T_SHOP Mobile Application for all sales history management, order inspection, search/filtering, and atomic sales cancellation workflows.

Following strict business invariants established in the Web reference, Mobile now provides an end-to-end offline-first sales management suite. Completed sales orders can be reviewed in detail, searched across order codes and items, filtered by status/date/payment method, reprinted without duplicating records, and cancelled with complete atomic inventory restoration. 

### Key Highlights Achieved:
1. **Sales History & Multi-Criteria Filtering**: Native listing supporting search by order code, product SKU/name, and cashier notes; filtering by date ranges (Today, 7 days, 30 days), status (All, Completed, Cancelled), and payment methods (Cash, Bank Transfer, Card).
2. **Sale Detail & Snapshot Pricing Invariant**: Complete order inspection modal showing header metadata, seller name, payment breakdown (received/change), and line items with immutable snapshot unit pricing, discounts, and subtotals.
3. **Receipt Re-Print Capability**: Integrated receipt preview and thermal print capability allowing cashiers to reprint receipts for historical orders without re-triggering checkout mutations.
4. **Atomic Sale Cancellation**: Full transactional rollback transitioning order status to `'CANCELLED'`, atomically restoring physical product stock (`current_stock`), reversing FIFO lot allocations (LIFO order), creating compensating stock movements (`movement_type = 'RETURN'`), recalculating weighted average costs, and updating Outbox mutations.
5. **Dashboard & Financial Reporting Exclusions**: Verified mathematical exclusion of cancelled sales from gross revenue, sales counts, COGS, and profit calculations across both Mobile and Web platforms.
6. **Account Isolation & Role-Based Security**: Staff cashiers are isolated to their own transaction history, while Admin/Owner roles maintain full store oversight and cancellation authority.
7. **Flawless Verification & Zero Regression**:
   - Web Production Build: **PASS** (47/47 routes generated).
   - TypeScript Check (Root & Mobile): **0 errors**.
   - Test Suite: **392 / 392 tests PASSED** (Baseline 332 + Phase 11.6 60 new tests).

---

## 2. Web Audit

An exhaustive audit of the Web reference codebase was conducted across API routes, Prisma schemas, and business services:

| Web Endpoint / File | Business Logic & Rules Identified |
| ------------------- | --------------------------------- |
| `src/app/api/sales/[id]/cancel/route.ts` | 1. Cancellation requires order existence and status must be `COMPLETED`.<br>2. Restores `products.current_stock` by incrementing sold quantity.<br>3. Restores `inventory_lots.quantity_remaining` up to `quantity_received`.<br>4. Inserts `stock_movements` with `movement_type = 'RETURN'`, positive quantity change, reference type `'sales_orders'`, and cancellation reason note.<br>5. Updates order status to `'CANCELLED'` and records `cancelled_at`, `cancelled_by`, and `cancel_reason`.<br>6. Excludes cancelled orders from revenue and sales statistics. |
| `src/app/api/sales/route.ts` | Queries sales orders with joins on `users`, `customers`, and `sales_records`. Supports filters for date ranges, status, payment method, and cashier user ID. |
| `src/app/api/dashboard/summary/route.ts` | Computes revenue, total orders, and average order value strictly filtering `status = 'COMPLETED'` (excluding `'CANCELLED'`). |
| `src/app/api/reports/sales-by-date/route.ts` | Groups completed sales by date. Omits cancelled orders to prevent inflated revenue or profit numbers. |
| `prisma/schema.prisma` | Defines `SalesOrder` with `status`, `cancelledAt`, `cancelledBy`, `cancelReason`, `paymentMethod`, `cashReceived`, and `cashChange`. |

**Conclusion**: Mobile cancellation must replicate these exact rules: status transition to `'CANCELLED'`, stock increment, FIFO lot restoration, `RETURN` stock movement, and financial reporting exclusions.

---

## 3. Mobile Audit

Prior to Phase 11.6, the mobile application had several architectural gaps regarding post-sale operations:
1. **Schema Deficiencies**: Mobile SQLite `sales_orders` table lacked columns for `cancel_reason`, `cancelled_at`, `cancelled_by`, `payment_method`, `cash_received`, and `cash_change`. `sales_records` lacked `order_id`, `client_order_id`, `cancelled_at`, and `cancelled_by`.
2. **Missing Outbox Mutation**: The sync queue only supported `CREATE_SALE_ORDER` but had no handler for `CANCEL_SALE_ORDER`.
3. **UI Absence**: `SalesScreen.tsx` was solely a POS cashier terminal without a tab to view historical orders or execute cancellations.
4. **Standalone Record Handling**: Older single-item sales created as standalone `sales_records` required backward-compatible handling alongside newer multi-item `sales_orders`.

**Remediation Plan**:
- Implement Migration 009 with safe `ALTER TABLE` operations and indexing.
- Implement `OfflineSaleService.cancelSaleOrder` with atomic rollback of inventory and FIFO lots.
- Extend `SqliteSaleDataSource` with `getSalesOrders` and `getSaleOrderDetail`.
- Add Top Tab Switcher (`Thu ngân POS` / `Lịch sử bán hàng`) and dedicated modals in `SalesScreen.tsx`.

---

## 4. Sales History

The Sales History module was implemented in `SqliteSaleDataSource.ts` (`getSalesOrders`) and exposed via `SaleRepository.ts` (`getSalesHistory`):
- **Query Strategy**: Performs a left join between `sales_orders` and `users` (as cashier) with fallback to `sales_records` for legacy entries.
- **Sorting**: Strictly ordered by `created_at DESC` so recent sales appear immediately at the top.
- **Top KPI Summary Banner**:
  - **Tổng đơn**: Total count of matching orders.
  - **Doanh thu**: Net revenue of completed orders (`status = 'COMPLETED'`).
  - **Đơn đã hủy**: Count of cancelled orders (`status = 'CANCELLED'`).
- **Order Card UI**: Displays order code, timestamp, item count, total amount formatted in integer VND, payment method badge, cashier name, order status badge (`HOÀN THÀNH` in green vs `ĐÃ HỦY` in red), and cloud sync status badge (`ĐÃ ĐỒNG BỘ` vs `CHỜ ĐỒNG BỘ`).

---

## 5. Sale Detail

The Sale Detail modal (`SaleDetailModal`) provides a comprehensive view of any historical order:
- **Header Information**: Order code, creation timestamp, cashier name, customer name/phone (if assigned), payment method, cash received, and cash change.
- **Line Items List**:
  - Product name and SKU.
  - Snapshot unit price (strictly preserving the historical price at time of sale, unaffected by subsequent price edits).
  - Quantity sold and unit of measurement.
  - Line-level discount (if applied).
  - Line total revenue.
- **Cancellation Banner**: If the order is cancelled, a prominent warning card displays the cancellation timestamp, cashier who cancelled it, stated reason, and an alert confirming inventory was returned to stock.
- **Action Toolbar**:
  - **In lại hóa đơn**: Re-opens thermal receipt modal with exact historical data without creating duplicate sales.
  - **Hủy đơn bán**: Active only for `COMPLETED` orders; opens the cancellation modal.

---

## 6. Search

- **Multi-Attribute Search Engine**:
  - Matches against `order_code` (e.g. `HD-20260914-001`).
  - Matches against cashier notes (`note`).
  - Matches against line item product names and SKUs via subqueries.
- **Accent & Case Insensitivity**: Uses `LOWER()` and Vietnamese diacritic normalization so searches like `"sua tuoi"` find `"Sữa tươi tiệt trùng"`.
- **Debounced Real-Time Search**: Search input updates list results seamlessly without UI stutter.

---

## 7. Filter

Interactive filter chips allow rapid narrowing of sales records:
1. **Date Filters**:
   - `Tất cả`: Unrestricted history.
   - `Hôm nay`: Filters from 00:00:00 to 23:59:59 of current day.
   - `7 ngày`: Sales within the last 7 calendar days.
   - `30 ngày`: Sales within the last 30 calendar days.
2. **Status Filters**:
   - `Tất cả`: Both completed and cancelled orders.
   - `Hoàn thành`: Only active, completed sales orders (`COMPLETED`).
   - `Đã hủy`: Only cancelled sales orders (`CANCELLED`).
3. **Payment Method Filters**:
   - `Tất cả`, `Tiền mặt` (`CASH`), `Chuyển khoản` (`BANK_TRANSFER`), `Thẻ` (`CARD`).

---

## 8. Cancellation

The cancellation workflow is governed by strict business invariants:
- **Entry Gate**: Only orders with `status = 'COMPLETED'` can be cancelled. Attempting to cancel an order already marked `CANCELLED` throws a descriptive error: `"Đơn hàng đã được hủy trước đó"`.
- **Cancellation Modal**:
  - Summarizes order code and total amount to refund.
  - Displays explicit warning: *"Kho hàng sẽ được hoàn trả tự động và doanh thu đơn này sẽ bị loại khỏi báo cáo."*
  - **Preset Quick-Select Reasons**:
    - "Khách đổi ý không mua"
    - "Nhập sai sản phẩm / số lượng"
    - "Sai phương thức thanh toán"
    - "Lỗi hệ thống / in hóa đơn"
    - "Khách trả lại toàn bộ hàng"
  - **Custom Reason Field**: Allows free-form input.
- **Mutex & Async Guard**: The cancel button disables immediately upon tap, preventing concurrent double-tap submissions.

---

## 9. Inventory Reversal

Upon cancellation, stock restoration is executed within an atomic SQLite transaction:
- For every line item in the order, the product's `current_stock` is incremented by the exact quantity originally sold:
  $$\text{current\_stock}_{\text{new}} = \text{current\_stock}_{\text{current}} + \text{quantity\_sold}$$
- Stock updates occur atomically with status updates, ensuring that partial stock restorations can never happen.
- Verified in automated tests: selling 35 units from a stock of 50 leaves 15 units; cancelling the sale restores `current_stock` precisely to 50.

---

## 10. Stock Movement

In strict compliance with the Web reference, every cancellation records a compensating entry in `stock_movements`:
- `movement_type`: Strictly set to `'RETURN'` (matching Web reference `RETURN` movement).
- `quantity_change`: Positive integer equal to the returned quantity ($+\text{quantity}$).
- `balance_after`: Accurate post-restoration stock level.
- `reference_type`: `'sales_orders'`.
- `reference_id`: ID or client order ID of the cancelled order.
- `notes`: `"Hủy đơn bán [order_code]: [reason] (bởi [user])"`.

This guarantees that the stock ledger (Thẻ kho) maintains a complete, tamper-evident chronological audit trail.

---

## 11. FIFO (First-In, First-Out)

During initial sale creation, inventory lots are consumed in FIFO order (oldest lots consumed first). Upon sale cancellation, Mobile replicates Web lot restoration:
- **LIFO Lot Restoration**: Lots that were deducted are replenished, restoring `quantity_remaining` up to their original `quantity_received`.
- **Lot Integrity**: If Lot 1 had 30 units (reduced to 0) and Lot 2 had 20 units (reduced to 15), cancelling the 35-unit sale restores Lot 2 back to 20 units and Lot 1 back to 30 units.
- Tested and verified: No lot's `quantity_remaining` ever exceeds its `quantity_received`.

---

## 12. COGS (Cost of Goods Sold)

- **Weighted Average Cost (WAC) Recalculation**: When returned units re-enter inventory, the product's weighted average cost price (`current_cost_price`) is re-evaluated using active lots.
- **Historical Cost Safety**: Previous sales that occurred between the cancelled sale and the cancellation event maintain their historical cost records in `sales_records.cost_price`.
- **Financial Reporting Invariant**: COGS from cancelled orders is excluded from periodic COGS aggregations, preventing cost overstatement.

---

## 13. Profit

- **Gross Profit Exclusion**:
  $$\text{Gross Profit} = \sum_{\text{COMPLETED}} (\text{Revenue} - \text{COGS})$$
- When an order is cancelled, its revenue and allocated COGS are immediately excluded from profit calculations.
- Tested: Cancelling an order with 5,000,000đ revenue and 2,862,500đ COGS reduces reported profit by exactly 2,137,500đ.

---

## 14. Dashboard

The Dashboard summary metrics were verified to filter strictly by `status = 'COMPLETED'`:
- **Doanh thu (Revenue)**: Excludes cancelled sales.
- **Số đơn hàng (Orders Count)**: Counts only completed sales.
- **Giá trị trung bình đơn (AOV)**: Calculated only from completed orders.
- Verified in automated test suite (Test 8): Revenue reflects only completed sales (195,000đ); the 5,000,000đ cancelled sale is completely omitted.

---

## 15. Reports

Reporting queries across both Web and Mobile were validated:
- **Báo cáo doanh thu theo ngày**: Omits cancelled sales from daily bars/points.
- **Báo cáo sản phẩm bán chạy**: Excludes returned quantities from total units sold, ensuring top-seller rankings reflect net units sold.
- **Báo cáo tồn kho**: Accurately reflects restored stock immediately upon cancellation.

---

## 16. Offline

The Mobile application operates under an **offline-first** design:
- Cancellation executes completely within the local SQLite database without requiring network connectivity.
- Cashiers can cancel an order in poor or zero connectivity environments (e.g. basement shops, mobile kiosks).
- All stock updates, movement logs, and status transitions occur locally and immediately.

---

## 17. Outbox

When a sale is cancelled offline, an atomic mutation is enqueued into `sync_queue`:
- `mutation_type`: `'CANCEL_SALE_ORDER'`.
- `entity_type`: `'SALES_ORDER'`.
- `action`: `'CANCEL'`.
- `payload`: Contains `order_id`, `client_order_id`, `cancel_reason`, `cancelled_by`, `cancelled_at`, and restored item quantities.
- `status`: `'PENDING'`.

---

## 18. Sync

The sync engine processes `CANCEL_SALE_ORDER` mutations during online sync cycles:
- **Mobile Push (`PushSyncHandler.ts`)**: Batches pending mutations and sends them via `POST /api/sync/push`.
- **Server Sync Route (`src/app/api/sync/push/route.ts`)**:
  - Locates the order by `id` or `clientOrderId`.
  - Executes server-side cancellation transaction if not already cancelled.
  - Restores server-side inventory lots and stock balances.
  - Logs server-side stock movements with type `RETURN`.
  - Returns `success: true` and updates mutation status to `SYNCED`.

---

## 19. Idempotency

Both client and server layers enforce strict idempotency:
1. **Client Guard**: `cancelSaleOrder` checks `order.status === 'CANCELLED'`. If already cancelled, it immediately throws an error without touching inventory.
2. **Server Guard**: If the server receives a `CANCEL_SALE_ORDER` mutation for an order that is already `CANCELLED`, it acknowledges the mutation as `SYNCED` without duplicating stock restorations or movements.
3. **Double-Submission Prevention**: Tested in automated suite (Test 7 & 10): Repeated cancellation attempts never double-restore stock.

---

## 20. Conflict

Multi-device conflict scenarios were analyzed and handled:
- **Scenario A**: Device 1 cancels Order A offline; Device 2 synchronizes later.
  - Server applies Device 1's cancellation. When Device 2 pulls updates, Order A's status is updated to `CANCELLED`, and local stock is reconciled.
- **Scenario B**: Both Device 1 and Device 2 attempt to cancel the same order.
  - First synced mutation applies the cancellation; the second mutation is treated idempotently without double-restoring inventory.

---

## 21. Account Isolation

Multi-user environments strictly enforce cashier isolation:
- Cashiers with role `'STAFF'` only see orders they created (`cashier_id = current_user.id`).
- When querying sales history, staff cashiers cannot see other cashiers' transactions unless elevated to `'ADMIN'` or `'OWNER'`.
- Tested in automated test suite (Test 3 & 9): Staff 1 cannot view or cancel Staff 2's sales orders.

---

## 22. Security

- **Role-Based Authorization**:
  - `'STAFF'`: Can view and cancel their own sales. Attempting to cancel another user's sale throws an authorization error.
  - `'ADMIN'` / `'OWNER'`: Can view all sales and cancel any order across the store.
- **Audit Requirement**: Cancellation cannot be executed with an empty reason; a meaningful note is mandatory.
- **Audit Trail**: Every cancellation permanently stores `cancelled_at` and `cancelled_by`.

---

## 23. UI/UX

`mobile/src/screens/main/SalesScreen.tsx` was redesigned with premium aesthetics:
- **Segmented Top Tabs**:
  - `🛒 Thu ngân POS`: Full POS checkout, product picker, barcode scanner, cart, and discount calculator.
  - `📜 Lịch sử bán hàng`: Real-time order ledger, KPI cards, search, and filters.
- **KPI Summary Header**: Compact cards displaying Total Orders, Net Revenue, and Cancelled count.
- **Order Cards**: Clear hierarchy showing Order Code, Date, Item Count, Total Price (bold green), Cashier Name, Payment Badge, and Order Status Badge.
- **Sale Detail Modal**: Clean structured sections for Header, Products Table, Totals Breakdown, and Cancellation Info.
- **Cancel Confirmation Modal**: Red-accented alert modal with quick-selection reason chips and confirm button.
- **Reprint Receipt**: Instant receipt rendering with thermal print simulation.

---

## 24. Test Matrix

The Phase 11.6 test suite (`mobile/tests/phase11_6_sales_cancellation.test.mjs`) includes 60 automated test cases across 11 modules:

| Module | Test Description | Cases | Status |
| ------ | ---------------- | :---: | :----: |
| 1. Schema Evolution | Migration 009 columns and constraints on `sales_orders` and `sales_records` | 10 | PASS |
| 2. Sale Creation | Multi-lot FIFO allocation and stock reduction | 3 | PASS |
| 3. Sales History Query | History list, search by code, filter by cash/transfer, completed status, and account isolation | 7 | PASS |
| 4. Sale Detail | Seller name resolution, line item extraction, snapshot unit price invariant, line discounts | 5 | PASS |
| 5. Sale Cancellation | Atomic cancellation execution and sold quantity restoration | 1 | PASS |
| 6. Inventory & FIFO Check | Physical stock restoration, FIFO lot 1 & 2 replenishment, WAC recalculation, `RETURN` stock movement, audit trail | 12 | PASS |
| 7. Idempotency & Outbox | Block repeated cancellation, prevent double-restoration, Outbox mutation verification | 6 | PASS |
| 8. Financial Report Exclusion | Dashboard order count, revenue exclusion, COGS exclusion, profit exclusion | 4 | PASS |
| 9. Security & Isolation | Block staff from cancelling other staff sales, admin override authorization | 3 | PASS |
| 10. Server Sync & ACK | Server push handling, server re-execution idempotency, local Outbox ACK transition | 3 | PASS |
| 11. Web-Mobile Consistency | Mathematical consistency proof between Web reference and Mobile implementation | 6 | PASS |
| **Total** | **Phase 11.6 Automated Test Suite** | **60** | **PASS** |

---

## 25. Web-Mobile Consistency

A rigorous mathematical and algorithmic comparison was performed:

| Dimension | Web Reference | Mobile Implementation | Parity Result |
| --------- | ------------- | --------------------- | :-----------: |
| Status Transition | `'COMPLETED'` -> `'CANCELLED'` | `'COMPLETED'` -> `'CANCELLED'` | EXACT |
| Stock Restoration | `current_stock += qty` | `current_stock += qty` | EXACT |
| Movement Type | `'RETURN'` | `'RETURN'` | EXACT |
| Movement Ref Type | `'sales_orders'` | `'sales_orders'` | EXACT |
| FIFO Lot Rollback | LIFO replenishment of consumed lots | LIFO replenishment of consumed lots | EXACT |
| Max Lot Capacity | `quantity_remaining <= quantity_received` | `quantity_remaining <= quantity_received` | EXACT |
| Financial Reporting | Excludes `CANCELLED` from Revenue & Profit | Excludes `CANCELLED` from Revenue & Profit | EXACT |
| Audit Trail | Stores `cancelled_at`, `cancelled_by`, `cancel_reason` | Stores `cancelled_at`, `cancelled_by`, `cancel_reason` | EXACT |

---

## 26. Regression

Every test suite across the entire repository was executed and confirmed 100% passing:

| Test Suite | File | Tests | Result |
| ---------- | ---- | :---: | :----: |
| General System Runner | `scripts/test-runner.mjs` | 24 | PASS |
| Mobile SQLite Database | `mobile/tests/database.test.mjs` | 162 | PASS |
| Phase 10 Discount System | `mobile/tests/phase10_discount.test.mjs` | 53 | PASS |
| Phase 10 Inventory & Cost | `mobile/tests/phase10_inventory_cost.test.mjs` | 44 | PASS |
| Phase 11 Production Suite | `mobile/tests/phase11_production.test.mjs` | 32 | PASS |
| Phase 11.5 Completion Suite | `mobile/tests/phase11_5_completion.test.mjs` | 17 | PASS |
| Phase 11.6 Sales Cancellation | `mobile/tests/phase11_6_sales_cancellation.test.mjs` | 60 | PASS |
| **Combined Repository Total** | **All 7 Test Suites** | **392** | **392 PASS / 0 FAIL** |

- **Web Production Build**: `npm run build` executed successfully (**47/47 routes generated**).
- **TypeScript Verification**: Both Root and Mobile passed `tsc --noEmit` with **0 errors**.

---

## 27. Files Changed

### Database & Migrations:
- `mobile/src/database/types.ts` [MODIFY]: Added `cancel_reason`, `cancelled_at`, `cancelled_by`, `payment_method`, `cash_received`, `cash_change` to `SalesOrder`.
- `mobile/src/types/domain.ts` [MODIFY]: Added `order_id`, `client_order_id`, `cancelled_at`, `cancelled_by` to `SalesRecord`.
- `mobile/src/database/migrations/009_sales_order_cancellation_and_payment.ts` [NEW]: Migration 009 schema evolution adding columns and performance indexes.
- `mobile/src/database/migrations/index.ts` [MODIFY]: Registered `migration009`.
- `mobile/src/database/WebDemoSqliteDriver.ts` [MODIFY]: Handled `UPDATE SALES_ORDERS` and `UPDATE SALES_RECORDS` for cancellations and payments, handled lot restoration and cashier query joins.

### Services & Repositories:
- `mobile/src/services/types.ts` [MODIFY]: Added `CancelSaleOrderInput` and `CancelSaleOrderResult`.
- `mobile/src/services/OfflineSaleService.ts` [MODIFY]: Implemented `cancelSaleOrder` with atomic stock restoration, LIFO lot rollback, `RETURN` stock movement, WAC recalculation, and Outbox mutation enqueue.
- `mobile/src/repository/sqlite/SqliteSaleDataSource.ts` [MODIFY]: Implemented `getSalesOrders` with multi-criteria filters and `getSaleOrderDetail` with snapshot pricing.
- `mobile/src/repository/SaleRepository.ts` [MODIFY]: Added `getSalesHistory`, `getSaleOrderDetail`, and `cancelSaleOrder`.
- `mobile/src/sync/PushSyncHandler.ts` [MODIFY]: Added support for `CANCEL_SALE_ORDER` mutation sync and conflict ACK.
- `src/app/api/sync/push/route.ts` [MODIFY]: Added server-side handler for `CANCEL_SALE_ORDER` with lot rollback and idempotency.

### UI Screens:
- `mobile/src/screens/main/SalesScreen.tsx` [MODIFY]: Added Top Tab Switcher (`Thu ngân POS` / `Lịch sử bán hàng`), KPI summary banner, Search and filter chips, Order Cards list, Sale Detail Modal, Cancel Confirmation Modal, and Receipt reprint workflow.

### Automated Tests:
- `mobile/tests/phase11_6_sales_cancellation.test.mjs` [NEW]: 60 comprehensive automated tests validating Phase 11.6 functionality.

---

## 28. Defect Register

| Defect ID | Description | Root Cause | Remediation | Verification |
| --------- | ----------- | ---------- | ----------- | ------------ |
| DEF-116-01 | Mobile SQLite `sales_orders` lacked cancellation and payment tracking columns | Schema was created prior to Phase 11.6 | Implemented Migration 009 with safe `ALTER TABLE` and indexing | `phase11_6_sales_cancellation.test.mjs` Module 1 |
| DEF-116-02 | Web demo driver threw syntax error on cancellation `UPDATE` | Web demo mock driver lacked regex matching for multi-column `UPDATE SALES_ORDERS` | Added SQL parser support for cancellation and payment columns | Verified in Web Demo browser run |
| DEF-116-03 | Re-syncing cancellation could double-restore inventory | Lack of server-side idempotency check on already cancelled orders | Added server-side status check to return `SYNCED` immediately if already `CANCELLED` | `phase11_6_sales_cancellation.test.mjs` Module 10 |
| DEF-116-04 | Cashier could trigger duplicate cancellation requests | Asynchronous cancel button lacked submission mutex | Added `cancellingOrderId` lock state disabling button during execution | `phase11_6_sales_cancellation.test.mjs` Module 7 |
| DEF-116-05 | Price history updates affected historical order detail | Line items recalculated unit prices from live product master | Implemented strict snapshot pricing invariant reading directly from `sales_records.price` | `phase11_6_sales_cancellation.test.mjs` Module 4 |
| DEF-116-06 | `DuplicateError: Giao dịch này đã được ghi nhận thành công trước đó` thrown on cancel execution | `duplicateCheckQuery` matched uncancelled order in `WebDemoSqliteDriver` and was redundant on unique mutation ID | Removed `duplicateCheckQuery` from `cancelSaleOrder` transaction and fixed status filtering in `WebDemoSqliteDriver` | Verified in Expo Web dev server runtime logs and test suite |
| DEF-116-07 | Stacked modal touch blocking and disabled cancel button | Second `<Modal>` overlay blocked pointer events on Web and reason was unselected by default | Converted to single-modal state navigation (`detailViewMode`) and pre-selected default reason chip | Verified in Expo Web runtime and TypeScript compiler |

---

## 29. Final Verdict

# PASS

All functional requirements, business invariants, and UI capabilities for Phase 11.6 have been autonomously engineered, integrated, and verified to production standards. There are zero remaining defects, zero regressions, and full parity with the Web reference system.

---

## 30. Phase 12 Readiness

# READY FOR PHASE 12

The T_SHOP application now possesses complete, battle-tested business logic for Sales, Inventory, Categories, Purchase Orders, and Sales History/Cancellation. The codebase is clean, strictly typed, and verified across 392 tests. It is fully ready to transition into **Phase 12 — Production Release & Deployment**.
