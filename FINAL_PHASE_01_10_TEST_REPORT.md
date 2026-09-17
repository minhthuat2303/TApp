# T_SHOP — FINAL AUTOMATED TEST REPORT (PHASE 01–10)

## Comprehensive Automated Test Execution & Results

### 1. Overall Test Execution Summary
* **Total Automated Tests Executed**: **283**
* **Total Passed**: **283**
* **Total Failed**: **0**
* **Total Skipped**: **0**
* **Overall Pass Rate**: **100.0%**

---

### 2. Breakdown by Test Suite

#### 2.1. Mobile Discount Remediation Suite (`mobile/tests/phase10_discount.test.mjs`)
* **Total Tests**: **53**
* **Passed**: **53** | **Failed**: **0** | **Pass Rate**: **100%**
* **Coverage Details (Scenarios A through U)**:
  * **Test A (Discount = 0)**: Subtotal = 500k, Discount = 0, Final = 500k. (PASS)
  * **Test B (Discount hợp lệ)**: Subtotal = 500k, Discount = 50k, Final = 450k. (PASS)
  * **Test C (Discount tối đa)**: Subtotal = 250k, Discount = 250k, Final = 0. (PASS)
  * **Test D (Discount vượt giới hạn)**: Subtotal = 250k, Discount = 250,001 -> Throws `ValidationError`. (PASS)
  * **Test E1 (Discount tổng âm)**: Discount = -10,000 -> Throws `ValidationError`. (PASS)
  * **Test E2 (Discount sản phẩm âm)**: Item discount = -5,000 -> Throws `ValidationError`. (PASS)
  * **Test F (Offline checkout)**: Generates local order ID, computes accurate final amount offline. (PASS)
  * **Test G (SQLite persistence)**: Verifies atomic inserts to `sales_orders`, `sales_records`, and `stock_movements`. (PASS)
  * **Test H (App restart)**: State completely restored from disk with zero discount or order corruption. (PASS)
  * **Test I (Outbox payload)**: Payload includes `total_amount`, `total_discount`, `final_amount`, and item-level `discount`. (PASS)
  * **Test J (Sync transition)**: Order transitions from `PENDING` to `SYNCED` upon server ACK without losing discount data. (PASS)
  * **Test K (Duplicate sync idempotency)**: Replaying existing mutation returns existing order without duplicates. (PASS)
  * **Test L (Receipt formatting)**: Plain text and ESC/POS receipts contain Tạm tính, Giảm giá, and Tổng cộng. (PASS)
  * **Test M (Inventory deduction independence)**: Stock deduction is 100% independent of discount amount. (PASS)
  * **Test N (Dashboard net revenue)**: Dashboard aggregates net revenue (`gross_subtotal - total_discount`). (PASS)
  * **Test O (Report aggregation)**: Daily report aggregates total orders and total discounts accurately. (PASS)
  * **Test P (FIFO Profit calculation)**: Profit = Net revenue (after discount) - FIFO cost. (PASS)
  * **Test Q (Account isolation)**: User 1 and User 2 orders and outbox queues are strictly isolated. (PASS)
  * **Test R (Multi-item proportional allocation)**: Distributes order-level discount across items proportionally. (PASS)
  * **Test S (Payment CASH)**: Change calculated accurately (`cashReceived - finalAmount`). (PASS)
  * **Test T (Payment BANK_TRANSFER)**: Recorded properly with 0 change. (PASS)
  * **Test U (Payment CARD)**: Recorded properly with 0 change. (PASS)

#### 2.2. Phase 10 Inventory, Lots & FIFO COGS Suite (`mobile/tests/phase10_inventory_cost.test.mjs`)
* **Total Tests**: **44**
* **Passed**: **44** | **Failed**: **0** | **Pass Rate**: **100%**
* **Coverage Details**:
  * **Suite 1**: Multi-item stock import & FIFO lot creation. (13 tests PASS)
  * **Suite 2**: Multiple purchase costs & weighted average cost valuation. (4 tests PASS)
  * **Suite 3**: FIFO COGS deduction & sales profit calculation. (11 tests PASS)
  * **Suite 4**: Insufficient stock overselling protection. (2 tests PASS)
  * **Suite 5**: Offline stock adjustment & outbox synchronization. (7 tests PASS)
  * **Suite 6**: Analytics, Dashboard KPIs, and managerial reports. (7 tests PASS)

#### 2.3. Full Mobile Regression Suite (`mobile/tests/database.test.mjs`)
* **Total Tests**: **162**
* **Passed**: **162** | **Failed**: **0** | **Pass Rate**: **100%**
* **Coverage Details (Phases 01 to 09)**:
  * Database initialization and migrations 001–007.
  * Categories, product types, and product master data repositories.
  * Offline sales orders and itemized records.
  * Outbox queue and sync status state transitions.
  * Conflict taxonomy, stock drift detection, and ledger reconciliation.
  * Role-based authorization (Admin vs Staff permissions).
  * Device identity and installation UUID format.
  * Short-lived access token and refresh token rotation with single-flight mutex.
  * Safe logout guard detecting unsynced outbox items.
  * Remote session revocation and device lockout.
  * Multi-account isolation and cross-user hijacking protection.
  * POS barcode scanner, cart quantity manipulation, price snapshots.
  * POS atomic checkout, cash payments, change calculation.
  * Thermal printer ESC/POS binary generation, diacritic transliteration.
  * Printer failure safety invariant: Failure does NOT rollback or alter persisted sales.

#### 2.4. Web Automated Test Suite (`scripts/test-runner.mjs`)
* **Total Tests**: **24**
* **Passed**: **24** | **Failed**: **0** | **Pass Rate**: **100%**
* **Coverage Details**:
  * Authentication & security: Admin and Staff user roles, bcrypt password verification, JWT token sign and verify.
  * Categories & product types hierarchy parity.
  * FIFO purchase lots allocation & COGS resolution.
  * Sale cancellation & inventory rollback.
  * Dashboard summary aggregation and lot inventory valuation.

---

### 3. Compilation & Static Analysis Tests
* **Web App TypeScript (`npx tsc --noEmit`)**: **0 Errors (PASS)**.
* **Mobile App TypeScript (`npm --prefix mobile run typecheck`)**: **0 Errors (PASS)**.
* **Next.js Production Build (`npm run build`)**: **0 Errors (PASS)**.
