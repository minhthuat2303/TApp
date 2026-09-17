# T_SHOP — PHASE 09 IMPLEMENTATION REPORT
# TECHNICAL SPECIFICATION & CODE MODIFICATIONS

============================================================
**Project:** T_SHOP (Point of Sale Core & Barcode Foundation)  
**Author:** Senior React Native & POS Systems Architect  
**Date:** September 10, 2026  
============================================================

## 1. Overview of Codebase Modifications

All changes in Phase 09 strictly adhere to the layered architecture:
`UI -> Use Case / Service -> Repository -> SQLite Transaction -> Outbox -> Sync Engine -> API`.

### 1.1 Dependency Changes
- Added `expo-camera@~57.0.4` to `mobile/package.json` and `mobile/package-lock.json`.
- Configured Camera Plugin and iOS/Android permissions in `mobile/app.json`:
  ```json
  "plugins": [
    [
      "expo-camera",
      {
        "cameraPermission": "T_SHOP can quyen truy cap camera de quet ma vach san pham tinh tien va kiem kho."
      }
    ]
  ]
  ```

---

## 2. Implemented Modules & Components

### 2.1 ESC/POS Thermal Protocol Generator
- **File**: `mobile/src/services/printer/EscPosBuilder.ts`
- **Features**:
  - Byte array buffer builder for standard thermal receipt printers.
  - Paper width configurations: `58mm` (32 columns) and `80mm` (48 columns).
  - Hardware commands:
    - Reset: `ESC @` (`0x1B, 0x40`)
    - Alignment: Left (`0x1B, 0x61, 0x00`), Center (`0x1B, 0x61, 0x01`), Right (`0x1B, 0x61, 0x02`)
    - Styles: Bold (`ESC E`), Double Size (`GS !`), Underline (`ESC -`)
    - Drawer kick pulse: `ESC p 0 25 250`
    - Paper cut: `GS V 0`
  - Vietnamese Transliteration: `EscPosBuilder.removeDiacritics()` strips complex combining Unicode diacritics to prevent `???` garbled printing on budget thermal printers.

### 2.2 Receipt Printer Service
- **File**: `mobile/src/services/printer/ReceiptPrinterService.ts`
- **Features**:
  - Decoupled domain model `ReceiptData` containing store info, cashier name, transaction ID, items, financial totals, and sync status.
  - Formats raw ESC/POS binary buffers for thermal hardware.
  - Formats structured plain text for mobile native sharing sheet (`Share.share`).
  - Isolated execution: catches all hardware/network exceptions to guarantee that printer errors never rollback or invalidate the persisted Sale.

### 2.3 Native Barcode & QR Scanner Modal
- **File**: `mobile/src/components/scanner/BarcodeScannerModal.tsx`
- **Features**:
  - Built on `expo-camera` (`CameraView`) with back camera and barcode filter: `['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e']`.
  - Animated laser scan line using React Native `Animated.loop`.
  - Cooldown timer (`scanLockRef`, 1200ms) to prevent double-scanning the same box.
  - Comprehensive permission handling: permission prompt, denied warning, and manual mode fallback.
  - Hardware barcode wedge input support for USB OTG or Bluetooth laser guns.

### 2.4 Interactive Receipt Modal
- **File**: `mobile/src/screens/main/ReceiptModal.tsx`
- **Features**:
  - Interactive bottom sheet displaying completed order receipt immediately after checkout.
  - Accurate sync status indicator: `○ Lưu Offline - Chờ đồng bộ` (amber) vs `● Đã đồng bộ máy chủ` (green).
  - Action buttons: "🖨️ In hóa đơn (ESC/POS)" and "📤 Chia sẻ".
  - Graceful error alert if printer is disconnected, prompting retry without impacting the sale.

### 2.5 POS Sales Screen Enhancement
- **File**: `mobile/src/screens/main/SalesScreen.tsx`
- **Features**:
  - Added "📷 Quét Barcode / QR" toolbar button next to "➕ Chọn từ kho".
  - Real-time stock pre-validation: warns and disables `+` if cart quantity reaches available stock.
  - Payment Method Selector: `CASH`, `BANK_TRANSFER`, `CARD`.
  - Quick cash denomination chips: `Đủ tiền`, `50.000đ`, `100.000đ`, `200.000đ`, `500.000đ`, `1.000.000đ`, `2.000.000đ`.
  - Real-time change calculation with underpayment validation.
  - Commits sale atomically via `saleRepository.createMultiItemSale()` and displays `ReceiptModal`.

### 2.6 Offline Barcode Lookup in Data Sources
- **Files**:
  - `mobile/src/repository/sqlite/SqliteProductDataSource.ts`: Added `getByBarcode(barcode: string)`.
  - `mobile/src/repository/ProductRepository.ts`: Added `getByBarcode(barcode: string)`.
  - `mobile/src/screens/main/InventoryScreen.tsx`: Added barcode scanning button to Stock Receipt modal.

---

## 3. SQLite Database Invariants

No schema alteration was needed because the existing SQLite schema from Phase 04-08 (Migrations 001-007) already accommodates all required entities:
- `sales_orders`: Contains `client_order_id`, `order_code`, `sale_date`, `total_amount`, `final_amount`, `status`, `sync_status`, `created_by`.
- `sales_records`: Contains `client_transaction_id`, `product_id`, `unit_price_at_sale`, `quantity`, `sync_status`, `created_by`.
- `sync_queue`: Contains `client_mutation_id`, `entity_type`, `action`, `payload_json`, `status`, `user_id`, `device_id`.
- `products`: Contains `sku`, `name`, `current_selling_price`, `current_stock`.

This guarantees 100% backward and forward compatibility with server sync and web applications.
