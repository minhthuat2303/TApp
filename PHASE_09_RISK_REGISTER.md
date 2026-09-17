# T_SHOP — PHASE 09 RISK REGISTER
# OPERATIONAL, PERIPHERAL & HARDWARE RISK REGISTER

============================================================
**Project:** T_SHOP  
**Phase:** 09 (POS Core & Barcode Foundation)  
**Date:** September 10, 2026  
============================================================

## 1. Identified Risks & Mitigations

| Risk ID | Category | Description | Severity | Mitigation Implemented |
|---|---|---|---|---|
| **RSK-09-01** | Peripheral | Bluetooth thermal printer connection drop, battery depletion, or out of paper during checkout | **HIGH** | **Section 36 Invariant**: The Sale transaction is committed to SQLite and Outbox *before* printer communication. Printer failures return a non-blocking error, permitting retry or native sharing without rolling back the sale. |
| **RSK-09-02** | Hardware | Older thermal receipt printers fail to render Unicode Vietnamese characters (printing `???`) | **MEDIUM** | `EscPosBuilder.removeDiacritics()` transliterates Vietnamese text to clean ASCII while preserving currency, SKU, and quantities accurately. |
| **RSK-09-03** | Scanner | Rapid continuous camera frames cause duplicate product scan events | **MEDIUM** | Synchronous `scanLockRef` and 1200ms debounce cooldown lock camera scanning between detections. |
| **RSK-09-04** | Security / Auth | Cashier switches user account while offline transactions are pending in Outbox | **HIGH** | Outbox rows are tagged with `user_id`. Safe logout guard warns cashiers of un-synced items before permitting logout. |
| **RSK-09-05** | Operational | Camera permission permanently denied in device settings | **LOW** | Intuitive warning screen directs user to OS settings, with an immediate fallback to manual SKU / USB OTG scanner wedge mode. |
| **RSK-09-06** | Data Consistency | Negative inventory over-allocation caused by simultaneous checkouts across multiple offline devices | **HIGH** | Local checkout decrements device inventory immediately to prevent local overselling; server authoritative FIFO conflict reconciliation (Phase 07) handles multi-device contention non-destructively. |

---

## 2. Dependencies & Out-of-Scope Items for Subsequent Phases

As strictly instructed in Section 3 of the Phase 09 specification, the following features remain dependencies for subsequent phases:
- **Phase 10 (Store Operations & Cashier Shifts)**:
  - Cashier shift open/close & cash drawer reconciliation.
  - X / Z Reports (Báo cáo chốt ca / chốt ngày).
  - Cash Drawer automated kick pulse hardware testing with drawer solenoid.
- **Phase 11 (Customer CRM & Loyalty)**:
  - Customer phone number lookup, member discounts, loyalty points.
  - Customer debt (Công nợ bán lẻ).
- **Phase 12 (Advanced Digital Payments)**:
  - VietQR dynamic payment QR code generation with automated webhook confirmation.
  - MoMo / ZaloPay native app switch or terminal integration.
