# T_SHOP — PHASE 09 PRINTER REPORT
# ESC/POS THERMAL PRINTER PROTOCOL & FAILURE DECOUPLING

============================================================
**Project:** T_SHOP  
**Topic:** ESC/POS Protocol Generator, Bluetooth Adapter, Section 36 Invariant  
**Date:** September 10, 2026  
============================================================

## 1. ESC/POS Protocol Implementation

ESC/POS (Epson Standard Code for Point of Sale) is the universal binary control language for thermal receipt printers across retail hardware (Epson, Star Micronics, Xprinter, Rongta, Zywell).

### 1.1 Column Formats
- **58mm Paper (2 inches)**: 32 columns standard font (12x24 dots).
- **80mm Paper (3 inches)**: 48 columns standard font (12x24 dots).

### 1.2 Binary Command Mapping (`EscPosBuilder.ts`)

| Action | ESC/POS Hex Sequence | Description |
|---|---|---|
| **Initialize** | `1B 40` | Clears buffer, resets fonts and line spacing |
| **Align Left** | `1B 61 00` | Justifies subsequent text to left margin |
| **Align Center** | `1B 61 01` | Centers store header, order title, and barcodes |
| **Align Right** | `1B 61 02` | Right-aligns totals and prices |
| **Bold On/Off** | `1B 45 01` / `1B 45 00` | Toggles double-strike bold rendering |
| **Double Height** | `1D 21 01` | Enlarges store title for emphasis |
| **Line Feed** | `1B 64 n` | Feeds paper $n$ lines forward |
| **Cash Drawer Kick** | `1B 70 00 19 FA` | Sends a 24V pulse to pin 2 to pop the drawer |
| **Full / Partial Cut** | `1D 56 00` / `1D 56 01` | Triggers mechanical paper cutter |

---

## 2. Vietnamese Language Handling for Thermal Hardware

Budget thermal printers used in Vietnamese retail stores often lack Unicode UTF-8 fonts in their onboard ROM, resulting in corrupted character replacement (`???`).

`EscPosBuilder.removeDiacritics()` provides clean transliteration:
```typescript
static removeDiacritics(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x00-\x7E]/g, '');
}
```
This guarantees legible receipts on 100% of thermal receipt printers while preserving exact numeric currency formats and SKU identifiers.

---

## 3. Section 36 Invariant: Printer Failure Must NOT Break Sale

> **CRITICAL ARCHITECTURE PRINCIPLE:**  
> A POS sale is a binding financial and inventory transaction committed to local SQLite and the Outbox. A thermal printer is an unreliable peripheral subject to Bluetooth disconnection, out-of-paper sensor errors, jammed cutters, or drained batteries.

### Implementation Guarantee
1. The sale transaction commits atomically to SQLite **before** any print command is issued.
2. `ReceiptPrinterService.printReceipt()` catches all communication errors and returns `{ success: false, error: ... }`.
3. If printing fails:
   - **Sale Status**: `COMPLETED` (unmodified).
   - **Inventory Mutation**: Committed in SQLite (unmodified).
   - **Outbox Queue**: Intact and pending synchronization (unmodified).
   - **UI Behavior**: Shows non-blocking alert with `"Thử lại in"` (Retry) and `"📤 Chia sẻ hóa đơn"` (Native share fallback).
