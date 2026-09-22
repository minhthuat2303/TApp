# T_SHOP — CRITICAL BUG FIX FINAL REPORT
## CANCEL ORDER PARAMETER $3 + PRODUCT PRICE FORMAT INTEGRITY

> **Status:** COMPLETED & VERIFIED  
> **Date:** 2026-09-22  
> **Environment:** Production (Supabase PostgreSQL / Next.js Serverless API / React Native Mobile)  
> **Scope:** Strictly 2 Critical Bugs (No unapproved business logic changes)

---

## 1. BUG #1 ROOT CAUSE — CANCEL ORDER "could not determine data type of parameter $3"

### 1.1 Trace Flow
```
Mobile UI (Confirm Cancel Order)
  ↓
SaleRepository.cancelSaleOrder({ clientOrderId: "TX-20260922-...", orderId: ... })
  ↓
POST /api/sales/[id]/cancel (with id = "TX-20260922-...")
  ↓
Clean ID & Numeric Check:
  cleanId = "TX-20260922-..."
  isNumeric = /^\d+$/.test(cleanId)  --> FALSE
  numericId = null
  ↓
SQL Query in route.ts:
  SELECT ... FROM sales_records
  WHERE transaction_code = ? OR (id = ? AND ? IS NOT NULL)
  ORDER BY id ASC LIMIT 1
  with parameters: [cleanId, numericId, numericId] -> ["TX-...", null, null]
  ↓
db.queryOne converts '?' to PostgreSQL placeholders:
  SELECT ... FROM sales_records
  WHERE transaction_code = $1 OR (id = $2 AND $3 IS NOT NULL)
  with parameters: $1 = "TX-...", $2 = NULL, $3 = NULL
  ↓
PostgreSQL Parser:
  $3 is evaluated in isolation as "$3 IS NOT NULL".
  Because $3 is NULL and not compared against any table column or typed literal,
  PostgreSQL cannot determine its data type.
  ↓
PostgreSQL Exception:
  error: could not determine data type of parameter $3
```

### 1.2 Exact Culprit
- **Files:**
  - [`src/app/api/sales/[id]/cancel/route.ts`](file:///d:/project/T_App/src/app/api/sales/[id]/cancel/route.ts)
  - [`src/app/api/sales/[id]/route.ts`](file:///d:/project/T_App/src/app/api/sales/[id]/route.ts)
- **Problematic Query:**
  ```sql
  WHERE transaction_code = ? OR (id = ? AND ? IS NOT NULL)
  ```
- **Parameter $3:** `numericId` which was `null` when a transaction code string (e.g. `TX-20260922-77298647`) was passed.
- **Why PostgreSQL Throws:** In PostgreSQL's prepared statement protocol, every parameter `$n` must have an inferrable data type from its context. A construct like `($3 IS NOT NULL)` without a cast like `($3::bigint IS NOT NULL)` or column association provides zero type context. When `$3` is passed as `null` in the parameter array, PostgreSQL fails with `error: could not determine data type of parameter $3`.

---

## 2. BUG #1 FIX

### 2.1 Applied Solution
Instead of an ambiguous single query with an untyped placeholder, we implement deterministic query branching based on the input type:
1. When `numericId !== null`:
   ```typescript
   const initialSale = await tx.queryOne<any>(`
     SELECT id, transaction_code, product_id, sale_date, quantity, 
            unit_price_at_sale, discount, total_revenue, total_cost, profit, status
     FROM sales_records
     WHERE transaction_code = ? OR id = ?
     ORDER BY id ASC
     LIMIT 1
   `, [cleanId, numericId]);
   ```
2. When `numericId === null` (string transaction code):
   ```typescript
   const initialSale = await tx.queryOne<any>(`
     SELECT id, transaction_code, product_id, sale_date, quantity, 
            unit_price_at_sale, discount, total_revenue, total_cost, profit, status
     FROM sales_records
     WHERE transaction_code = ?
     ORDER BY id ASC
     LIMIT 1
   `, [cleanId]);
   ```
3. For multi-item query (`allRecordsForOrder`):
   Uses `canonicalTxCode` directly:
   ```typescript
   const allRecordsForOrder = canonicalTxCode
     ? await tx.query<any>(`
         SELECT sr.id, sr.transaction_code, sr.product_id, sr.sale_date, sr.quantity, 
                sr.unit_price_at_sale, sr.discount, sr.total_revenue, sr.total_cost, sr.profit, sr.status,
                p.sku as product_sku, p.name as product_name, p.current_cost_price
         FROM sales_records sr
         JOIN products p ON p.id = sr.product_id
         WHERE sr.transaction_code = ?
         ORDER BY sr.id ASC
       `, [canonicalTxCode])
     : await tx.query<any>(`... WHERE sr.id = ? ...`, [initialSale.id]);
   ```
4. Symmetrical fix applied to [`src/app/api/sales/[id]/route.ts`](file:///d:/project/T_App/src/app/api/sales/[id]/route.ts).

---

## 3. BUG #1 TEST RESULTS

| Test Scenario | Input / Action | Result | Status |
| :--- | :--- | :--- | :--- |
| **Parameter $3 Query Execution** | String transaction code `TX-NONEXISTENT-TEST` | Executed without error (rows: 0, no error) | **PASS** |
| **Numeric ID Query Execution** | Numeric string `999999` | Executed without error (rows: 0, no error) | **PASS** |
| **1-Item Order Cancellation** | Cancel order with 1 item (qty: 2) | Stock restored 20 -> 18 -> 20 | **PASS** |
| **FIFO Lot Restoration** | Cancel order referencing Lot #6 (rem: 17) | Lot restored 17 -> 15 -> 17 | **PASS** |
| **RETURN Movement Creation** | Check `stock_movements` | 1 record created (`movement_type = 'RETURN'`, `quantity_change = 2`) | **PASS** |
| **Re-cancel Prevention** | Attempt cancelling already CANCELLED order | Idempotent response, no duplicate movements or inventory inflation | **PASS** |
| **Multi-Item Order Cancellation** | Cancel order with 2 items (qty: 3 and 4) | Product 1 restored (20), Product 2 restored (18) | **PASS** |
| **Revenue Exclusion in Reports** | Check `SUM(total_revenue)` for cancelled orders | Cancelled orders completely excluded (`Revenue = 0`) | **PASS** |

---

## 4. BUG #2 ROOT CAUSE — PRODUCT PRICE FORMAT / CORRUPTION

### 4.1 Trace Flow
```
Supabase PostgreSQL
  products.current_selling_price: NUMERIC(15, 2) = 125000.00
  ↓
node-postgres (pg driver)
  Node-postgres returns NUMERIC(15, 2) as string: "125000.00"
  ↓
GET /api/products or GET /api/products/[id]
  Returned "125000.00" as string or unrounded number to client
  ↓
Mobile: openEditProduct(prod)
  setEditSellingPrice(String(prod.current_selling_price || 0));
  --> editSellingPrice became "125000.00" (NO format, trailing .00)
  ↓
Mobile: handleSaveProduct()
  const priceNum = Number(editSellingPrice.replace(/[^0-9]/g, ''));
  --> editSellingPrice.replace(/[^0-9]/g, '') STRIPPED THE DOT!
  --> "125000.00" became "12500000"!
  --> priceNum = 12500000 (12.5 MILLION instead of 125 THOUSAND)
  ↓
PUT /api/products/[id] with selling_price = 12500000
  ↓
Database updated: current_selling_price = 12500000.00
Price multiplied by 100 on EVERY SAVE without edit!
```

### 4.2 Exact Culprit
1. **Frontend Regex Flaw:**
   In [`mobile/src/screens/main/ProductsScreen.tsx`](file:///d:/project/T_App/mobile/src/screens/main/ProductsScreen.tsx) (and `InventoryScreen.tsx`):
   ```typescript
   const priceNum = Number(editSellingPrice.replace(/[^0-9]/g, ''));
   ```
   Stripped all non-digits, converting the decimal fraction `.00` from `pg` into integer digits `00`, multiplying the value by 100.
2. **Missing Input Formatter:**
   `setEditSellingPrice` set raw string `String(prod.current_selling_price || 0)` instead of formatted `125,000`.
3. **API Normalization:**
   API did not guarantee whole integer numbers for VND currency.

---

## 5. BUG #2 FIX

### 5.1 Presentation & Parsing Utilities
Created in [`mobile/src/utils/formatters.ts`](file:///d:/project/T_App/mobile/src/utils/formatters.ts):
```typescript
/**
 * Formats a raw number or input string as a comma-separated currency string
 * e.g. 125000 -> "125,000", "125000.00" -> "125,000"
 * Handles node-postgres decimal strings like '125000.00' without appending extra zeros.
 */
export function formatCurrencyInput(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === '') return '';
  const num = typeof val === 'number' ? Math.round(val) : Math.round(parseFloat(String(val).replace(/,/g, '')) || 0);
  if (isNaN(num)) return '';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Parses a currency input string (e.g. "125,000" or "125000" or "125000.00") into an integer VND number (e.g. 125000).
 * Protects against accidental multiplication or trailing decimal issues.
 */
export function parseCurrencyInput(str: string | number | null | undefined): number {
  if (str === null || str === undefined || str === '') return 0;
  if (typeof str === 'number') return Math.round(str);
  const cleaned = String(str).replace(/,/g, '').trim();
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : Math.round(parsed);
}
```

### 5.2 Mobile Products Screen Updates
In [`mobile/src/screens/main/ProductsScreen.tsx`](file:///d:/project/T_App/mobile/src/screens/main/ProductsScreen.tsx):
1. **Modal Open:**
   ```typescript
   setEditSellingPrice(formatCurrencyInput(prod.current_selling_price));
   ```
2. **Input Change:**
   ```typescript
   <Input
     label="Giá bán niêm yết (VND) (*)"
     value={editSellingPrice}
     onChangeText={(t) => { setEditSellingPrice(formatCurrencyInput(t)); setIsFormDirty(true); }}
     keyboardType="numeric"
     placeholder="VD: 150,000"
   />
   ```
3. **Form Save:**
   ```typescript
   const priceNum = parseCurrencyInput(editSellingPrice);
   ```

### 5.3 Mobile Inventory Screen Updates
In [`mobile/src/screens/main/InventoryScreen.tsx`](file:///d:/project/T_App/mobile/src/screens/main/InventoryScreen.tsx):
Applied `formatCurrencyInput` to `poItemCost` on selection and edit, and `parseCurrencyInput(poItemCost)` on item addition.

### 5.4 Backend API Normalization
In [`src/app/api/products/route.ts`](file:///d:/project/T_App/src/app/api/products/route.ts) and [`src/app/api/products/[id]/route.ts`](file:///d:/project/T_App/src/app/api/products/[id]/route.ts):
Normalized all `current_selling_price` and `current_cost_price` values to whole integer numbers via `Math.round(Number(...))` before JSON serialization, preventing any `.00` strings from leaking to clients.

---

## 6. BUG #2 TEST RESULTS

| Test Case | Input | UI Display | Parsed / Saved Value | Expected | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Case 1** | Number `125000` | `125,000` | `125000` | `125000` | **PASS** |
| **Case 2** | DB String `'125000.00'` | `125,000` | `125000` | `125000` | **PASS** |
| **Case 3 (Critical)** | Open `'125000.00'` $\to$ Save without modification | `125,000` | `125000` | `125000` (NO +2 zeros) | **PASS** |
| **Case 4** | Edit `125000` to `130000` | `130,000` | `130000` | `130000` | **PASS** |
| **Case 5** | Edit with commas `130,000` | `130,000` | `130000` | `130000` | **PASS** |
| **Case 6** | High Value `1,000,000` | `1,000,000` | `1000000` | `1000000` (NOT 100M) | **PASS** |
| **Case 7** | Small Value `99,000` | `99,000` | `99000` | `99000` (NOT 9.9M) | **PASS** |
| **Case 8** | All sampled DB products | Formatted | Round-tripped | 100% Match | **PASS** |

---

## 7. DATA INTEGRITY VERIFICATION

### 7.1 Product Prices Round-Trip Verification
Direct audit of active products in Supabase PostgreSQL:
- Product #1 [GB001]: DB=`165000.00` $\to$ UI=`165,000` $\to$ Parsed=`165000` (Match: **true**)
- Product #2 [GB002]: DB=`210000.00` $\to$ UI=`210,000` $\to$ Parsed=`210000` (Match: **true**)
- Product #3 [GB003]: DB=`300000.00` $\to$ UI=`300,000` $\to$ Parsed=`300000` (Match: **true**)
- Product #4 [XE001]: DB=`390000.00` $\to$ UI=`390,000` $\to$ Parsed=`390000` (Match: **true**)
- Product #5 [XE002]: DB=`280000.00` $\to$ UI=`280,000` $\to$ Parsed=`280000` (Match: **true**)

### 7.2 Multiplicative / Divisive Guard
- **No unintended price multiplication ($\times 100$):** Guaranteed by using `parseFloat()` on comma-stripped strings instead of naive `replace(/[^0-9]/g, '')`.
- **No unintended price division ($\div 100$):** Guaranteed by preserving full VND currency scale throughout backend and frontend.

---

## 8. REGRESSION MATRIX

| Module | Verification Details | Impact | Status |
| :--- | :--- | :--- | :--- |
| **Cancellation Flow** | Tested 1-item, multi-item, idempotent cancellation | No regressions | **PASS** |
| **Inventory Restoration** | Verified `products.current_stock` restored to exact baseline | Restored accurately | **PASS** |
| **FIFO Lots** | Reverted `inventory_lots.quantity_remaining` according to `sale_cost_allocations` | FIFO queue intact | **PASS** |
| **Stock Movements** | Created `movement_type = 'RETURN'` with `quantity_change > 0` | Audit trail accurate | **PASS** |
| **Reports** | Cancelled orders excluded from `SUM(total_revenue)` | Revenue integrity maintained | **PASS** |
| **Product Import** | CSV/Excel import uses raw numerical parser | No interference | **PASS** |
| **POS Checkout** | POS cart calculations use numeric prices | Prices displayed with commas, calculated as integers | **PASS** |

---

## 9. FINAL VERDICT

# [VERIFIED]

**Proof of Verification:**
1. **Bug #1:** Parameter $3 error (`could not determine data type of parameter $3`) is completely resolved. Both string `transaction_code` (e.g. `TX-...`) and numeric `id` query paths execute with zero errors. 1-item and multi-item orders cancel cleanly with stock restoration, FIFO lot replenishment, and RETURN stock movements.
2. **Bug #2:** Proven mathematically and practically:
   $$\text{Database: } 125000.00 \longrightarrow \text{UI: } 125,000 \longrightarrow \text{Save: } 125000 \longrightarrow \text{Database: } 125000.00$$
   Opening and saving without modification maintains the exact value without appending two zeros.
3. **Safety Guidelines:** No unapproved business logic was changed. No Git commits or pushes were made.
