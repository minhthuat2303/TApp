# DISCOUNT REMEDIATION FINAL REPORT

## BÁO CÁO NGHIỆM THU CUỐI CÙNG — BỔ SUNG GIẢM GIÁ TRONG GHI NHẬN BÁN HÀNG MOBILE

---

### 1. WEB AUDIT
**PASS**
* **Reference Implementation**: Đã kiểm tra `src/app/sales/new/page.tsx`, `src/app/api/sync/push/route.ts`, `src/app/api/sales/route.ts`.
* **Discount Mechanism**: Bản Web sử dụng chiết khấu dòng sản phẩm theo hàng nghìn đồng (`discountThousand * 1000` hoặc trực tiếp VND).
* **Calculations**: `lineSubtotal = quantity * unitPrice`, `lineRevenue = lineSubtotal - discount`, `totalRevenue = sum(lineRevenue)`, `finalAmount = max(0, subtotal - totalDiscount)`.
* **Sync & Persistence**: Cả PostgreSQL Server và SQLite Mobile đã có sẵn cột `discount` trong `sales_records` và `total_discount` trong `sales_orders`.

---

### 2. MOBILE UI
**PASS**
* **Priority Layout**: Triển khai chính xác theo thứ tự yêu cầu:
  1. **Tạm tính (Subtotal)**
  2. **Giảm giá (Discount)**: Khung nhập số VND kèm hậu tố `đ`, nút xóa, và thanh quick chips tiện dụng trên màn hình cảm ứng: `0đ`, `10.000đ`, `20.000đ`, `50.000đ`, `100.000đ`, `5%`, `10%`, `20%`. Hỗ trợ thêm giảm giá theo từng dòng sản phẩm tương đương Web.
  3. **Tổng thanh toán (Final Amount)**: Cập nhật thời gian thực (`realtime`).
  4. **Phương thức thanh toán**: `CASH` (Tiền mặt), `BANK_TRANSFER` (Chuyển khoản), `CARD` (Thẻ) với các nút phím nhanh tiền khách đưa (Đủ tiền, 50k, 100k, 200k, 500k) và tính tiền thừa chính xác.
  5. **Thanh toán**: Bottom sticky bar thanh toán ngay.
* **UX/UI**: Giao diện native responsive, bàn phím số, định dạng tiền tệ VND chuẩn `vi-VN`, giữ nguyên Design System.

---

### 3. BUSINESS LOGIC
**PASS**
* Đồng bộ 100% logic với Web:
  * `orderSubtotal` = Tổng tiền hàng trước giảm giá.
  * `totalDiscount` = Giảm giá áp dụng (không vượt quá `orderSubtotal`).
  * `finalAmount` = `orderSubtotal` - `totalDiscount`.
  * Phân bổ tỷ lệ giảm giá tổng vào từng dòng sản phẩm (`sales_records.discount`) để ghi nhận đúng doanh thu thuần từng món, phục vụ báo cáo doanh thu và tính lợi nhuận FIFO.

---

### 4. DATABASE
**PASS**
* Sử dụng trường có sẵn: `sales_orders.total_discount` và `sales_records.discount`.
* Không drop table, không reset database, không mất dữ liệu hiện có.
* Backward compatibility: SQLite driver xử lý linh hoạt cả cấu trúc đơn và cấu trúc đa sản phẩm (`sales_orders`).

---

### 5. OFFLINE
**PASS**
* Hoạt động 100% Offline-First.
* Luồng POS $\rightarrow$ Cart $\rightarrow$ Discount $\rightarrow$ Total $\rightarrow$ Checkout $\rightarrow$ SQLite Transaction (`sales_orders` + `sales_records` + `stock_movements` + `sync_outbox`) được bao bọc trong transaction nguyên tử (`atomic`).
* Nếu có sự cố giữa chừng, toàn bộ transaction bị `ROLLBACK`, không tạo dữ liệu dở dang.

---

### 6. OUTBOX
**PASS**
* Payload Outbox chứa đầy đủ:
  * `total_amount`: Tạm tính trước giảm giá
  * `total_discount`: Tổng tiền giảm giá
  * `final_amount`: Tổng thanh toán sau giảm giá
  * `items[].discount`: Chiết khấu chi tiết của từng dòng sản phẩm
  * `items[].total_revenue`: Doanh thu thuần từng dòng
  * `client_mutation_id`, `client_order_id`, `user_id` giữ nguyên theo chuẩn Phase 05–09.

---

### 7. SYNC
**PASS**
* Tương thích hoàn toàn với API Server (`/api/sync/push`).
* Server nhận payload, đối soát và lưu `discount` vào bảng `sales_records`.
* Đảm bảo tính lũy thừa (`Idempotency`): Tránh duplicate đơn hàng khi retry mạng.

---

### 8. RECEIPT
**PASS**
* Cập nhật `ReceiptModal.tsx` và `ReceiptPrinterService.ts`:
  * Hiển thị rõ ràng dòng `Giảm giá: -XX.XXX đ` giữa `Tạm tính` và `TỔNG CỘNG`.
  * Áp dụng đồng bộ cho cả giao diện Modal, bản in nhiệt ESC/POS (58mm / 80mm), và text chia sẻ Zalo/Clipboard.

---

### 9. INVENTORY
**PASS**
* Giảm giá chỉ tác động vào số tiền thanh toán và doanh thu.
* Tuyệt đối **không ảnh hưởng** đến:
  * Số lượng trừ tồn kho (`quantity`)
  * Trừ lô hàng FIFO (`inventory_lots.quantity_remaining`)
  * Lịch sử xuất nhập tồn (`stock_movements`)
  * Giá vốn sản phẩm (`cost_price`).

---

### 10. DASHBOARD
**PASS**
* Doanh thu trên Dashboard (`DashboardScreen.tsx`) được tính theo **doanh thu thuần sau giảm giá** (`SUM(final_amount)`).
* Gross Margin và KPI đồng bộ hoàn toàn với Web.

---

### 11. REPORT
**PASS**
* Báo cáo theo ngày (`ReportsScreen.tsx`) tổng hợp chính xác:
  * Doanh thu thuần (Net Sales)
  * Tổng tiền giảm giá (Discount Sum)
  * Tỷ suất lợi nhuận gộp thực tế.

---

### 12. PROFIT
**PASS**
* Lợi nhuận được tính theo công thức chuẩn:
  $$\text{Lợi nhuận} = \text{Doanh thu sau giảm giá} - \text{Giá vốn FIFO (COGS)}$$
* Không bị sai lệch hay tính 2 lần chiết khấu.

---

### 13. ACCOUNT ISOLATION
**PASS**
* Dữ liệu giảm giá và đơn hàng gắn chặt với `created_by` / `user_id`.
* User A không thể nhìn thấy đơn hàng, chiết khấu hoặc Outbox của User B trên cùng thiết bị dùng chung (bảo toàn Phase 08.1).

---

### 14. TEST
**283 / 283 PASS (100%)**
* **Mobile Discount Suite (`mobile/tests/phase10_discount.test.mjs`)**: **53 / 53 PASS**
  * A. Discount = 0: PASS
  * B. Discount hợp lệ: PASS
  * C. Discount tối đa (100%): PASS
  * D. Discount vượt giới hạn: PASS (bắt ValidationError)
  * E. Discount âm: PASS (bắt ValidationError)
  * F. Offline checkout: PASS
  * G. SQLite persistence: PASS
  * H. App restart: PASS
  * I. Outbox payload: PASS
  * J. Sync: PASS
  * K. Duplicate sync idempotency: PASS
  * L. Receipt: PASS
  * M. Inventory independence: PASS
  * N. Dashboard net revenue: PASS
  * O. Report aggregation: PASS
  * P. Profit calculation: PASS
  * Q. Account isolation: PASS
  * R. Multi-item proportional distribution: PASS
  * S. Payment CASH: PASS
  * T. Payment BANK_TRANSFER: PASS
  * U. Payment CARD: PASS
* **Phase 10 Inventory & FIFO Suite (`mobile/tests/phase10_inventory_cost.test.mjs`)**: **44 / 44 PASS**
* **Full Mobile Regression Suite (`mobile/tests/database.test.mjs`)**: **162 / 162 PASS**
* **Web Automated Test Suite (`scripts/test-runner.mjs`)**: **24 / 24 PASS**

---

### 15. WEB BUILD
**PASS**
* `npx tsc --noEmit` (Root Web App): **0 errors**.
* `node scripts/test-runner.mjs`: **24/24 PASS**.

---

### 16. MOBILE TYPECHECK
**PASS**
* `npm --prefix mobile run typecheck` (`tsc --noEmit`): **0 errors**.

---

### 17. REGRESSION
**PASS**
* Toàn bộ các chức năng từ Phase 01 đến Phase 10 không có bất kỳ hồi quy nào.

---

# FINAL STATUS: PASS

---

### KÈM THEO CHI TIẾT

#### 1. Files Changed
* [mobile/src/services/types.ts](file:///d:/project/T_App/mobile/src/services/types.ts): Mở rộng `CartItemInput` (`discountThousand`), `CreateSaleOrderInput` (`totalDiscount`), và `DashboardSummaryData`.
* [mobile/src/services/OfflineSaleService.ts](file:///d:/project/T_App/mobile/src/services/OfflineSaleService.ts): Logic tính toán, validation số âm / vượt tạm tính, phân bổ chiết khấu tỷ lệ cho multi-item, lưu `total_amount`, `total_discount`, `final_amount` vào Outbox và SQLite.
* [mobile/src/database/WebDemoSqliteDriver.ts](file:///d:/project/T_App/mobile/src/database/WebDemoSqliteDriver.ts): Hỗ trợ đa dạng parameter schema cho `sales_orders` và `sales_records`.
* [mobile/src/screens/main/SalesScreen.tsx](file:///d:/project/T_App/mobile/src/screens/main/SalesScreen.tsx): Bổ sung khung nhập Giảm giá đơn hàng, quick chips, item discount, layout chuẩn Tạm tính $\rightarrow$ Giảm giá $\rightarrow$ Tổng thanh toán $\rightarrow$ Phương thức thanh toán $\rightarrow$ Thanh toán.
* [mobile/src/screens/main/ReceiptModal.tsx](file:///d:/project/T_App/mobile/src/screens/main/ReceiptModal.tsx): Định dạng dòng Giảm giá trên hóa đơn.
* [mobile/src/services/printer/ReceiptPrinterService.ts](file:///d:/project/T_App/mobile/src/services/printer/ReceiptPrinterService.ts): Hỗ trợ in Giảm giá trên ESC/POS và Plain text.
* [mobile/tests/phase10_inventory_cost.test.mjs](file:///d:/project/T_App/mobile/tests/phase10_inventory_cost.test.mjs): Cập nhật ngày động tránh trôi date.

#### 2. Migrations Changed
* **Không cần thêm migration mới**: Hệ thống SQLite và Postgres Server từ migration trước đã có sẵn `total_discount` trong `sales_orders` và `discount` trong `sales_records`. Giữ nguyên 100% cấu trúc schema và dữ liệu hiện tại.

#### 3. API Changed
* Tái sử dụng trọn vẹn API hiện có `POST /api/sync/push`. Payload Outbox mở rộng thêm các field `total_discount`, `items[].discount` mà backend đã có schema tiếp nhận.

#### 4. Tests Added
* [mobile/tests/phase10_discount.test.mjs](file:///d:/project/T_App/mobile/tests/phase10_discount.test.mjs): 53 kiểm thử tự động chuyên sâu cho tất cả các kịch bản A đến U.

#### 5. Web vs Mobile Consistency Matrix

| Chỉ số kiểm thử | Web App | Mobile Native POS | Kết quả đối chiếu |
| :--- | :---: | :---: | :---: |
| **Subtotal (Tạm tính)** | 500.000 đ | 500.000 đ | **KHỚP 100%** |
| **Discount (Giảm giá)** | 50.000 đ | 50.000 đ | **KHỚP 100%** |
| **Total (Tổng thanh toán)** | 450.000 đ | 450.000 đ | **KHỚP 100%** |
| **Quantity Sold (Số lượng bán)** | 2 cái | 2 cái | **KHỚP 100%** |
| **Stock Deduction (Trừ tồn kho)** | -2 cái | -2 cái | **KHỚP 100%** |
| **Revenue (Doanh thu thuần)** | 450.000 đ | 450.000 đ | **KHỚP 100%** |
| **COGS (Giá vốn FIFO)** | 200.000 đ | 200.000 đ | **KHỚP 100%** |
| **Profit (Lợi nhuận gộp)** | 250.000 đ | 250.000 đ | **KHỚP 100%** |

#### 6. Known Limitations
* Mức chiết khấu đơn hàng hiện tại được phân bổ tỷ lệ vào các sản phẩm trong giỏ để bảo đảm tính chính xác khi tính lợi nhuận FIFO của từng sản phẩm. Khi trả hàng từng món lẻ trong tương lai, giá trị hoàn trả sẽ tính trên đơn giá sau phân bổ chiết khấu.
