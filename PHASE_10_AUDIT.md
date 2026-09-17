# T_SHOP — PHASE 10 AUDIT REPORT
## TOÀN BỘ ĐỐI CHIẾU NGHIỆP VỤ: WEB THỰC TẾ vs. MOBILE APP (PHASE 01–09)

**Dự án**: T_SHOP — Nền tảng Bán lẻ Đồ chơi & Quản lý Kho Thông minh  
**Thời gian lập**: 10/09/2026  
**Nguyên tắc số 1**: **T_SHOP WEB LÀ BUSINESS REFERENCE**. Mobile không được tự ý sáng tạo hay suy đoán quy tắc nghiệp vụ khác với Web.

---

## PHẦN 1: TRẢ LỜI CHI TIẾT 18 CÂU HỎI AUDIT BẮT BUỘC

### 1. Inventory hiện được tính như thế nào?
- **Web Reference** (`src/app/api/inventory/route.ts`, `src/app/api/sales/route.ts`, `src/app/api/inventory/receipts/route.ts`):
  - Bảng `products.current_stock` đóng vai trò là số dư tồn kho khả dụng tức thời (cached balance).
  - Khi Nhập kho (`receipts`): `current_stock = current_stock + quantity`. Đồng thời ghi nhận vào bảng `inventory_lots` với `quantity_received` và `quantity_remaining` bằng số lượng nhập.
  - Khi Bán hàng (`sales`): Kiểm tra tiên quyết `current_stock >= quantity`. Khi hợp lệ, trừ `current_stock = current_stock - quantity`.
  - Khi Điều chỉnh kho (`adjustments`): `current_stock = current_stock + quantityChange` (kiểm tra chặn không cho tồn mới `< 0`).
  - Định giá tồn kho: `stock_valuation = SUM(il.quantity_remaining * il.unit_cost)` hoặc tính nhanh `current_stock * current_cost_price`.
- **Mobile Hiện tại**:
  - Đã có bảng `products.current_stock` trong SQLite.
  - `SqliteInventoryDataSource.getStockStatus()` tính toán `effectiveStock = Math.max(0, current_stock - pending_sold)` để trừ đi các đơn bán offline trong Outbox chưa sync lên server.
- **Khoảng cách (Gap)**: Mobile cần UI hiển thị đầy đủ tổng giá trị kho (`stock_valuation`), bộ lọc cảnh báo tồn ít (`low_stock_count`), và liên kết trực quan giữa tồn kho với các lô hàng (`inventory_lots`).

---

### 2. Import hiện được lưu như thế nào?
- **Web Reference** (`src/app/api/inventory/receipts/route.ts` & `src/app/api/inventory/import/page.tsx`):
  - Gồm 2 bảng liên kết:
    1. Header `imports`: `id`, `import_code` (mã dạng `NK-YYYYMMDD-xxxx`), `supplier_id`, `import_date`, `total_amount`, `note`, `created_by`.
    2. Chi tiết `import_items`: `id`, `import_id`, `product_id`, `quantity`, `unit_cost_price`, `total_amount`.
  - Đồng thời kích hoạt trong cùng 1 transaction:
    3. Tạo lô hàng `inventory_lots`: `lot_code`, `product_id`, `purchase_date`, `quantity_received`, `quantity_remaining`, `unit_cost`, `supplier_id`, `import_id`.
    4. Thêm lịch sử giá vốn `cost_price_history`: `product_id`, `cost_price`, `effective_from`, `note`.
    5. Cập nhật giá vốn bình quân gia quyền vào `products.current_cost_price`.
    6. Tạo biến động kho `stock_movements` với `movement_type = 'PURCHASE'`.
- **Mobile Hiện tại**:
  - Đã có bảng `imports` và `import_items` (Migration 004).
  - `OfflineInventoryService.createStockReceipt` đã cài đặt transaction ACID đầy đủ như trên và đưa vào Outbox (`sync_queue`) với mutation type `'IMPORT'`.
- **Khoảng cách (Gap)**: UI trên Mobile (`InventoryScreen.tsx`) mới chỉ hỗ trợ nhập đơn lẻ từng món (Single-item Quick Receipt). Cần mở rộng UI nhập nhiều sản phẩm trong 1 phiếu (Multi-item Import) tương tự Web.

---

### 3. Stock movement hiện được tạo như thế nào?
- **Web Reference** (`src/app/api/inventory/movements/route.ts`):
  - Lưu tại bảng `stock_movements` theo cơ chế **Append-Only** (không sửa, không xóa).
  - Các cột: `id`, `product_id`, `movement_type`, `quantity_change`, `balance_after`, `movement_date`, `reference_type`, `reference_id`, `note`, `created_by`, `created_at`.
  - Các loại `movement_type`: `SALE`, `PURCHASE`, `DAMAGE`, `LOSS`, `GIFT`, `RETURN`, `ADJUSTMENT`.
- **Mobile Hiện tại**:
  - SQLite có bảng `stock_movements` (Migration 002) với `client_movement_id` định danh duy nhất.
  - Cả luồng bán (`OfflineSaleService`) và nhập (`OfflineInventoryService`) đều ghi `stock_movements`.
- **Khoảng cách (Gap)**: Mobile cần UI xem chi tiết lịch sử biến động kho có phân loại màu sắc theo loại biến động (`PURCHASE` xanh lá, `SALE` xanh dương, `DAMAGE/LOSS` đỏ, `ADJUSTMENT` cam) và hỗ trợ lọc theo loại biến động.

---

### 4. Sale ảnh hưởng stock như thế nào?
- **Web Reference** (`src/app/api/sales/route.ts`):
  1. Kiểm tra tồn: `current_stock >= quantity`.
  2. Phân bổ giá vốn FIFO: Duyệt `inventory_lots` (`ORDER BY purchase_date ASC, id ASC`) để trừ dần `quantity_remaining`, ghi chi tiết vào `sale_cost_allocations`.
  3. Trừ tồn kho: `products.current_stock = current_stock - quantity`.
  4. Ghi biến động kho: `stock_movements` với `movement_type = 'SALE'`, `quantity_change = -quantity`, `balance_after = newStock`.
  5. Tính lại giá vốn bình quân: `weightedAvgCost = totalVal / totalRem` từ các lô còn tồn.
- **Mobile Hiện tại**:
  - `OfflineSaleService.createSaleOrder` đã mô phỏng đúng luồng trừ tồn, trừ lô FIFO và ghi `stock_movements`.
- **Khoảng cách (Gap)**: Cần bổ sung màn hình chi tiết lô hàng để thủ kho trên Mobile đối soát được lô nào đã xuất hết (`EXHAUSTED`) và lô nào còn tồn (`AVAILABLE`).

---

### 5. Giá nhập được lưu ở đâu?
- **Web Reference**:
  - Lưu snapshot tại từng dòng nhập: `import_items.unit_cost_price`.
  - Lưu tại từng lô hàng nhập về: `inventory_lots.unit_cost`.
  - Lưu vào nhật ký biến động giá nhập theo ngày: `cost_price_history.cost_price`.
  - Lưu giá vốn bình quân gia quyền hiện hành: `products.current_cost_price`.
- **Mobile Hiện tại**:
  - SQLite có đầy đủ các bảng `import_items`, `inventory_lots`, `cost_price_history`, `products.current_cost_price`.
- **Khoảng cách (Gap)**: Mobile cần hiển thị giá nhập lịch sử trong giao diện chi tiết sản phẩm.

---

### 6. Giá nhập có lịch sử hay overwrite?
- **Web Reference**: **BẢO TOÀN LỊCH SỬ TUYỆT ĐỐI (KHÔNG OVERWRITE)**.
  - Mỗi lần nhập với giá mới sẽ tạo một bản ghi mới trong `cost_price_history` và tạo một `inventory_lots` mới với mức giá đó.
  - Cột `current_cost_price` trong bảng `products` chỉ là giá trị tổng hợp (Weighted Average Cost), không xóa lịch sử cũ.
- **Mobile Hiện tại**: Hoàn toàn tuân thủ thiết kế append-only của Web.
- **Khoảng cách (Gap)**: Cần màn hình Modal hiển thị danh sách dòng thời gian các mức giá nhập trong quá khứ.

---

### 7. Giá vốn được tính theo rule nào?
- **Web Reference**:
  - **Khi xuất bán (COGS - Cost of Goods Sold)**: Dùng **FIFO (First-In First-Out)** thông qua các bản ghi trong `inventory_lots`. Hàng nhập trước sẽ được tính giá vốn trước.
  - **Khi đánh giá tồn kho tức thời (Stock Valuation)**: Dùng **Giá vốn bình quân gia quyền (Weighted Average Cost)** = $\frac{\sum (\text{SL còn} \times \text{Đơn giá lô})}{\sum \text{SL còn}}$.
- **Mobile Hiện tại**: `OfflineSaleService` và `OfflineInventoryService` đã áp dụng cùng công thức này.
- **Khoảng cách (Gap)**: Đồng bộ thuật toán này lên màn hình báo cáo lợi nhuận và dashboard.

---

### 8. Profit được tính theo rule nào?
- **Web Reference** (`src/app/api/sales/route.ts` & `src/app/api/dashboard/summary/route.ts`):
  - Doanh thu từng món: `subtotal = quantity * unit_price`.
  - Doanh thu thuần: `total_revenue = subtotal - discountAmount`.
  - Giá vốn hàng bán: `total_cost = sum(takeQty * lot.unit_cost)` (tính theo FIFO).
  - Lợi nhuận gộp (Gross Profit): `profit = total_revenue - total_cost`.
  - Đơn giá vốn bình quân tại thời điểm bán: `cost_price_at_sale = total_cost / quantity`.
- **Mobile Hiện tại**: `sales_records` trong SQLite lưu chính xác `unit_price_at_sale`, `cost_price_at_sale`, `discount`, `total_revenue`, `total_cost`, `profit`.
- **Khoảng cách (Gap)**: Mobile cần hiển thị lợi nhuận này trên Dashboard và màn hình Báo cáo theo ngày.

---

### 9. Dashboard hiện có KPI nào?
- **Web Reference** (`src/app/api/dashboard/summary/route.ts`):
  1. `revenue`: Tổng doanh thu thuần.
  2. `cogs`: Tổng giá vốn hàng bán.
  3. `profit`: Tổng lợi nhuận gộp.
  4. `salesCount`: Tổng số giao dịch bán hoàn tất.
  5. `soldQuantity`: Tổng số lượng sản phẩm đã bán ra.
  6. `currentTotalStock`: Tổng số lượng hàng hóa còn trong kho.
  7. `stockValuation`: Tổng giá trị tồn kho theo giá vốn lô.
  8. `lowStockCount`: Số mặt hàng đang chạm hoặc dưới định mức an toàn.
  9. `cancelledCount` & `cancelledRevenue`: Số lượng đơn và tiền bị hủy.
- **Mobile Hiện tại**: Dashboard mới chỉ hiển thị sơ sài Doanh thu hôm nay, Số đơn hàng và Cảnh báo tồn.
- **Khoảng cách (Gap)**: Cần nâng cấp `DashboardScreen.tsx` để hiển thị đầy đủ 7 KPI tài chính & kho cốt lõi của Web kèm bộ chọn thời gian (`Hôm nay`, `7 ngày`, `30 ngày`, `Tháng này`).

---

### 10. Dashboard có chart nào?
- **Web Reference**:
  - `revenue-profit`: Biểu đồ cột/đường so sánh Doanh thu vs. Lợi nhuận theo ngày/tuần/tháng.
  - `inventory`: Biểu đồ xu hướng tồn kho tích lũy và số lượng nhập/xuất theo thời gian.
- **Mobile Hiện tại**: Chưa có biểu đồ trực quan (chỉ có các thẻ text).
- **Khoảng cách (Gap)**: Xây dựng biểu đồ cột mini (Bar Trend Visualization) native-friendly trên Mobile thể hiện Doanh thu vs Lợi nhuận theo các mốc ngày.

---

### 11. Report hiện có những loại nào?
- **Web Reference** (`src/app/api/reports/`):
  1. `sales-by-date`: Báo cáo bán hàng theo ngày (Ngày, Số đơn, Số lượng, Doanh thu, Giá vốn, Lợi nhuận).
  2. `top-selling`: Top 10 sản phẩm bán chạy nhất (theo Số lượng và Doanh thu).
  3. `slowMoving`: Danh sách sản phẩm tồn đọng lâu ngày (0 phát sinh bán trong kỳ lọc).
- **Mobile Hiện tại**: Chưa có màn hình Báo cáo chuyên biệt (`ReportsScreen`).
- **Khoảng cách (Gap)**: Cần tạo mới `ReportsScreen.tsx` tích hợp cả 3 báo cáo trên.

---

### 12. Report có filter nào?
- **Web Reference**:
  - Filter kỳ thời gian: `today`, `yesterday`, `7days`, `30days`, `this_month`, `last_month`, `this_year`, `custom`.
  - Filter theo Danh mục (`categoryId`).
  - Filter theo Loại sản phẩm (`productTypeId`).
  - Filter theo Sản phẩm cụ thể (`productId`).
- **Mobile Hiện tại**: Chưa có.
- **Khoảng cách (Gap)**: Hỗ trợ bộ lọc kỳ thời gian và danh mục đồng bộ với Web trên Mobile.

---

### 13. API nào đã tồn tại?
- **Web Backend đã có đầy đủ**:
  - `GET /api/inventory`
  - `POST /api/inventory/receipts`
  - `GET /api/inventory/movements`
  - `POST /api/inventory/adjustments`
  - `GET /api/inventory/lots`
  - `GET /api/sales`
  - `POST /api/sales`
  - `GET /api/dashboard/summary`
  - `GET /api/dashboard/charts/revenue-profit`
  - `GET /api/dashboard/charts/inventory`
  - `GET /api/reports/sales-by-date`
  - `GET /api/reports/top-selling`
  - `GET /api/products/[id]/price-history`
  - `GET /api/products/[id]/cost-history`
  - `POST /api/sync/push`
  - `GET /api/sync/pull`

---

### 14. API nào Mobile có thể reuse?
- Mobile có thể reuse 100% các API GET khi Online để làm giàu dữ liệu hoặc đối soát.
- Khi Offline: Mobile thực hiện tính toán song song trực tiếp trên SQLite địa phương bằng cùng công thức toán học với Web, sau đó đồng bộ kết quả qua `POST /api/sync/push`.

---

### 15. SQLite hiện tại đã có đủ schema chưa?
- **Đã có**: `products`, `categories`, `product_types`, `price_history`, `cost_price_history`, `suppliers`, `imports`, `import_items`, `sales_orders`, `sales_records`, `stock_movements`, `inventory_lots`, `sync_queue`, `sync_metadata`, `conflict_records`, `stock_drift_records`.
- **Đánh giá**: Schema đã sẵn sàng 100% cho toàn bộ nghiệp vụ Phase 10, không cần migration phá hủy dữ liệu.

---

### 16. Outbox đã hỗ trợ những mutation nào?
- **Hiện tại**: `SALE_ORDER`, `IMPORT`.
- **Cần bổ sung**: `INVENTORY_ADJUSTMENT` để khi nhân viên kiểm kê kho offline điều chỉnh hỏng hóc/thất thoát, dữ liệu được xếp hàng Outbox an toàn.

---

### 17. Sync server đã hỗ trợ những entity nào?
- **Hiện tại trên Server** (`src/app/api/sync/push/route.ts`): Đã hỗ trợ `SALE_ORDER` và `IMPORT` với cơ chế kiểm tra idempotent hash `processed_sync_transactions`.
- **Cần bổ sung**: Thêm nhánh xử lý `INVENTORY_ADJUSTMENT` trên server.

---

### 18. Conflict engine đã hỗ trợ inventory mutation như thế nào?
- `ConflictService` phát hiện xung đột `INVENTORY_CONFLICT` khi server báo lỗi không đủ tồn kho hoặc lệch dữ liệu giữa các thiết bị.
- `stock_drift_records` ghi nhận độ lệch giữa server và mobile khi thực hiện pull sync.

---

## PHẦN 2: MA TRẬN ĐỐI CHIẾU & TRACEABILITY (GAP ANALYSIS)

| Nghiệp vụ Web | Web Implementation | API Tương ứng | Mobile Implementation | SQLite Table | Outbox Type | Sync Status | Mobile UI Status | Đánh giá Gap |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Nhập kho đơn lẻ** | `/inventory/receipts` | `POST /api/inventory/receipts` | `OfflineInventoryService.createStockReceipt` | `imports`, `import_items`, `inventory_lots` | `IMPORT` | `SYNCED` | Có modal nhập nhanh | **PASS** |
| **Nhập kho nhiều món** | `/inventory/import` | `POST /api/inventory/receipts` | `OfflineInventoryService.createStockReceipt` (multi-item) | `imports`, `import_items`, `inventory_lots` | `IMPORT` | `SYNCED` | **Cần bổ sung UI multi-item** | **CẦN LÀM UI** |
| **Lịch sử giá nhập** | `cost_price_history` | `GET /api/products/[id]/cost-history` | `SqliteInventoryDataSource` | `cost_price_history` | N/A | Pulled | **Cần bổ sung modal xem lịch sử** | **CẦN LÀM UI** |
| **Lịch sử giá bán** | `price_history` | `GET /api/products/[id]/price-history` | `SqliteProductDataSource` | `price_history` | N/A | Pulled | **Cần bổ sung modal xem lịch sử** | **CẦN LÀM UI** |
| **Giá vốn FIFO** | `sale_cost_allocations` | `POST /api/sales` | `OfflineSaleService.createSaleOrder` | `inventory_lots` | `SALE_ORDER` | `SYNCED` | Đã tích hợp POS | **PASS** |
| **Điều chỉnh kho** | `/inventory/adjustments` | `POST /api/inventory/adjustments` | **Cần bổ sung adjustStock()** | `stock_movements` | **INVENTORY_ADJUSTMENT** | **Cần bổ sung** | **Cần bổ sung modal điều chỉnh** | **CẦN BỔ SUNG CODE + UI** |
| **Biến động kho** | `/inventory/movements` | `GET /api/inventory/movements` | `InventoryRepository.getStockMovements` | `stock_movements` | N/A | Local + Pulled | Đã có tab movements cơ bản | **CẦN POLISH UI** |
| **Dashboard KPIs** | `/dashboard/summary` | `GET /api/dashboard/summary` | **Cần tạo AnalyticsService** | SQLite Aggregations | N/A | Realtime Offline | Chưa đủ KPI, thiếu lọc kỳ | **CẦN CODE + UI** |
| **Dashboard Chart**| `/dashboard/charts` | `GET /api/dashboard/charts` | **Cần tạo Chart Visualizer** | SQLite Aggregations | N/A | Realtime Offline | Chưa có biểu đồ | **CẦN BỔ SUNG UI** |
| **Báo cáo bán hàng**| `/reports/sales-by-date`| `GET /api/reports/sales-by-date`| **Cần tạo ReportsScreen** | `sales_records` aggregate | N/A | Realtime Offline | Chưa có màn hình Báo cáo | **CẦN TẠO MỚI** |
| **Top bán chạy** | `/reports/top-selling` | `GET /api/reports/top-selling` | **Cần tạo ReportsScreen** | `sales_records` aggregate | N/A | Realtime Offline | Chưa có màn hình Báo cáo | **CẦN TẠO MỚI** |

---

## KẾT LUẬN AUDIT & ĐỊNH HƯỚNG TRIỂN KHAI PHASE 10

Hệ thống cơ sở dữ liệu và các dịch vụ nền tảng (Service Layer) từ Phase 01–09 đã tuân thủ rất tốt nguyên tắc thiết kế của Web.  
Nhiệm vụ trọng tâm của Phase 10 là:
1. Mở rộng Service & Outbox để hỗ trợ đầy đủ **Điều chỉnh kho (Stock Adjustment)** và **Nhập kho nhiều mặt hàng (Multi-item Import)**.
2. Xây dựng bộ công cụ phân tích và tổng hợp số liệu ngoại tuyến **`AnalyticsService`** bảo đảm công thức toán học khớp 100% với Web.
3. Nâng cấp toàn diện giao diện Mobile:
   - Màn hình Quản lý Kho (`InventoryScreen.tsx`) với modal Nhập kho nhiều món, modal Điều chỉnh kho, modal Lịch sử giá/giá vốn.
   - Màn hình Tổng quan (`DashboardScreen.tsx`) với đầy đủ KPI tài chính & kho theo kỳ thời gian và biểu đồ xu hướng.
   - Màn hình Báo cáo (`ReportsScreen.tsx`) với Báo cáo bán theo ngày, Top bán chạy, Sản phẩm tồn đọng.
4. Cập nhật `WebDemoSqliteDriver` để giữ cho Mobile Web Demo (`http://localhost:8081`) hoạt động tương tác mượt mà ngay trên trình duyệt.
