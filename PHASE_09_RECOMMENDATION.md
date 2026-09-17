# T_SHOP — PHASE 09 & PRODUCT COMPLETION ROADMAP RECOMMENDATIONS

## 1. STRATEGIC CONTEXT
Having completed Phase 01 through Phase 08, T_SHOP possesses an enterprise-grade distributed systems foundation:
- SQLite local ACID persistence with 7 versioned migrations.
- Outbox queue with idempotency and exponential backoff retry.
- Bidirectional pull/push cursor sync with server authoritative stock validation.
- Multi-device over-allocation conflict rejection with non-destructive resolution.
- Short-lived token rotation with single-flight mutex and hardware device identity.

To advance from an architectural foundation to a polished commercial retail product, the remaining capabilities are prioritized below.

---

## 2. FEATURE & DEBT CLASSIFICATION

### RELEASE BLOCKERS (Must fix before store pilot)
1. **Shared-Device Outbox & Sales Attribution Fix**:
   - Update `OutboxService.enqueueMutation` to insert `user_id` and `device_id` into `sync_queue`.
   - Update `SalesScreen.tsx` to pass `createdBy: user?.id` into `createMultiItemSale()`.
   - Scope `PushSyncHandler.getEligibleMutations` to active `user.id`.
2. **Next.js Web Production Build Resolution**:
   - Resolve the 5 `FormData.get()` typing lines in `excel/preview` and `inventory/import-excel` so `next build` passes cleanly.

### MUST HAVE (Core Retail Operations)
1. **Barcode / QR Scanning Engine**:
   - Native camera barcode scanner (`expo-camera` or `react-native-camera-kit`) for instant product scanning at checkout and stock receipt.
2. **Receipt Printing & Digital Invoice Sharing**:
   - Bluetooth ESC/POS thermal printer support (58mm/80mm) for cashier sales slips.
   - Shareable PDF invoice export via native share sheet.
3. **Product Image Caching & Offline Media**:
   - Local disk caching for product thumbnail images (`expo-image`) so products have rich visual presentation while offline.

### SHOULD HAVE (Store Efficiency & Usability)
1. **Customer & Debt (Công Nợ) Management**:
   - Customer lookup, customer loyalty points, and retail customer debt tracking.
2. **Cash Drawer & Shift Management**:
   - Shift opening/closing balance, cash in/out drawer tracking, and daily cashier reconciliation report (Z-report).
3. **Payment Methods Integration**:
   - VietQR / MoMo dynamic payment QR code generation with offline fallbacks.

### NICE TO HAVE (Advanced Operations)
1. **Biometric Authentication**:
   - Fingerprint / FaceID authentication via `expo-local-authentication` for quick cashier unlock without password re-entry.
2. **Dark Mode & High Contrast Themes**:
   - Full theme customization for dim retail environments.
3. **Voice Search & SKU Audio Feedback**:
   - Audio beep on barcode scan and voice product search.

### TECHNICAL DEBT
1. **Outbox Purge / Vacuum Service**:
   - Automatic cleanup of `sync_queue` records in status `SYNCED` older than 30 days to keep SQLite database lean.
2. **Comprehensive React Native Component Testing**:
   - Jest / React Native Testing Library tests for UI components (`SalesScreen`, `InventoryScreen`, `ConflictCenterScreen`).

---

## 3. RECOMMENDED FUTURE PHASE ROADMAP

### PHASE 09: POS HARDWARE INTEGRATION & BARCODE SCANNING
- **Goal**: Integrate native camera barcode scanning, Bluetooth ESC/POS thermal printer engine, and cash drawer management.
- **Deliverables**:
  - `BarcodeScannerModal.tsx` supporting EAN-13, Code-128, QR Code.
  - `ReceiptPrinterService.ts` generating ESC/POS commands and PDF receipts.
  - POS Shift tracking (`cashier_shifts` table in SQLite and Postgres).

### PHASE 10: CUSTOMER CRM & MULTI-PAYMENT ENGINE
- **Goal**: Add retail customer database, customer debt (công nợ), VietQR dynamic code generation, and split payments.
- **Deliverables**:
  - `customers` domain entity in SQLite & server.
  - Offline payment split (Cash, Bank Transfer, Card, Debt).
  - Customer purchase history in POS checkout.

### PHASE 11: PRODUCTION PACKAGING, BIOMETRICS & APP STORE DISTRIBUTION
- **Goal**: EAS build configuration, app signing, store icon/splash optimization, biometrics, and production cloud deployment.
- **Deliverables**:
  - Biometric unlock (`expo-local-authentication`).
  - Production Google Play APK/AAB and Apple App Store IPA builds.
  - Dockerized multi-stage container deployment for Next.js Web backend.
