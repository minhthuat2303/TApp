# T_SHOP — PHASE 09 PAYMENT REPORT
# PAYMENT ENGINE FOUNDATION & CASH RECONCILIATION

============================================================
**Project:** T_SHOP  
**Topic:** Retail Payment Engine, Denomination Chips, Offline Validation  
**Date:** September 10, 2026  
============================================================

## 1. Domain Payment Model

To prevent hardcoded conditionals across the application, payment processing is structured around a decoupled domain contract:

```typescript
export type PaymentMethodType = 'CASH' | 'BANK_TRANSFER' | 'CARD';

export interface PaymentDetails {
  method: PaymentMethodType;
  totalAmount: number;
  cashReceived?: number;
  cashChange?: number;
  note?: string;
}
```

---

## 2. Cash Reconciliation & Change Calculation

### Financial Rules & Invariants
1. **Integer Money Representation**: All monetary values are represented as integer Vietnamese Đồng (`VND`). Floating-point arithmetic is strictly avoided.
2. **Payment Sufficiency**:
   $$\text{cashReceived} \ge \text{finalTotal}$$
   If `cashReceived < finalTotal`, checkout is blocked with validation feedback:
   `"Còn thiếu [số tiền] đ"`.
3. **Change Calculation**:
   $$\text{cashChange} = \max(0, \text{cashReceived} - \text{finalTotal})$$
   Negative change values are strictly prohibited.

---

## 3. Quick Cash Denomination Buttons

To optimize checkout throughput on mobile screens, the UI offers horizontal denomination chips based on standard State Bank of Vietnam currency notes:
- **`Đủ tiền`**: Auto-populates `finalTotal` exactly (change = 0 đ).
- **`50.000 đ`**, **`100.000 đ`**, **`200.000 đ`**, **`500.000 đ`**, **`1.000.000 đ`**, **`2.000.000 đ`**:
  Filtered dynamically to display notes greater than or equal to `finalTotal`.

---

## 4. Offline Payment Policy

- **Cash (CASH)**: Operates 100% offline. No network verification is required or attempted.
- **Bank Transfer (BANK_TRANSFER) & Card (CARD)**: In Phase 09, external payment gateway APIs (VietQR, MoMo, POS terminals) are out of scope (Section 3). When selected offline, they record the cashier-verified tender type in local metadata without falsely asserting server gateway verification.
- **Split Payment Extensibility**: The payment model payload in Outbox supports an extensible array structure so that Phase 10 can implement split tender without schema breakage.
