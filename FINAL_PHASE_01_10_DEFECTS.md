# T_SHOP — FINAL DEFECT REGISTER (PHASE 01–10)

## Defect Register & Resolution Log

This register documents all bugs, discrepancies, edge cases, and gaps identified during the end-to-end audit, along with their root causes, remediations, and verification tests.

| ID | Phase | Severity | Problem Description | Root Cause | Fix Applied | Automated Test Verification | Status |
| :---: | :---: | :---: | :--- | :--- | :--- | :--- | :---: |
| **DEF-001** | Phase 10 | **HIGH** | Double-discount calculation in `createMultiItemSale`: Order subtotal was reduced twice when computing `finalAmount`. | `totalAmount` in `OfflineSaleService.ts` was assigned the sum of `lineRevenue` (which had already subtracted line discount) and then subtracted `totalDiscount` again. | Updated formula: `orderSubtotal = sum(lineSubtotal)`, `total_discount = totalDiscount`, `final_amount = max(0, orderSubtotal - totalDiscount)`. | `phase10_discount.test.mjs` (Tests A, B, C) | **RESOLVED** |
| **DEF-002** | Phase 10 | **MEDIUM** | Inconsistent variable reference `totalAmount` in order object creation causing TS2304 compilation error. | Variable name was renamed to `orderSubtotal` during calculation refactor, but line 339 retained `total_amount: totalAmount`. | Fixed line 339: `total_amount: orderSubtotal`. | `npm --prefix mobile run typecheck` | **RESOLVED** |
| **DEF-003** | Phase 10 | **MEDIUM** | `sales_orders` and `sales_records` parameter layout mismatch in `WebDemoSqliteDriver.ts`. | Browser demo driver expected older parameter signature without `order_id` / `client_order_id`. | Enhanced `WebDemoSqliteDriver.runAsync` to dynamically detect parameter array length and extract values by semantic position. | Browser POS checkout on `http://localhost:8081` | **RESOLVED** |
| **DEF-004** | Phase 10 | **LOW** | Receipt modal and ESC/POS thermal printer displayed "Chiết khấu:" instead of "Giảm giá:". | Legacy label wording from early design drafts. | Replaced all instances of "Chiết khấu:" with "Giảm giá:" / "Giam gia:" across `ReceiptModal.tsx` and `ReceiptPrinterService.ts`. | `phase10_discount.test.mjs` (Test L) | **RESOLVED** |
| **DEF-005** | Phase 10 | **LOW** | Static date `'2026-09-10'` in `phase10_inventory_cost.test.mjs` caused test failure when run on subsequent calendar dates. | Test hardcoded `'2026-09-10'` while `getDashboardSummary(driver, 'today')` dynamically resolves the current calendar date. | Refactored test to dynamically resolve `new Date().toISOString().split('T')[0]`. | `phase10_inventory_cost.test.mjs` (Test Suite 6) | **RESOLVED** |
| **DEF-006** | Phase 09 | **LOW** | Synchronous tight-loop collision in test `lineTxCode` generation. | Millisecond timestamp `Date.now()` without entropy caused duplicate transaction code in SQLite constraint test. | Added cryptographic random salt `crypto.randomBytes(3).toString('hex')` to transaction codes. | `phase10_discount.test.mjs` (All tests) | **RESOLVED** |

---

### Defect Severity Summary
* **CRITICAL**: 0
* **HIGH**: 1 (Resolved)
* **MEDIUM**: 2 (Resolved)
* **LOW**: 3 (Resolved)
* **Remaining Unresolved Defects**: **0**
