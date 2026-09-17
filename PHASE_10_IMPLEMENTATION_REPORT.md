# T_SHOP — PHASE 10 IMPLEMENTATION REPORT
## Comprehensive Inventory, Stock Movement, Cost/Profit, Dashboard & Reporting Architecture

**Dự án**: T_SHOP Mobile Offline-First Native App  
**Phase**: 10 — INVENTORY MANAGEMENT, STOCK MOVEMENT, IMPORT STOCK, COST/PROFIT, DASHBOARD, REPORTING  
**Trạng thái**: COMPLETED (PASS)  
**Tài liệu tham chiếu**: T_SHOP Web App (Business Reference) & Phase 01–09 Baselines  
**Nguyên tắc**: Tuyệt đối bảo toàn nghiệp vụ Web, 100% Offline-First SQLite, Không over-engineering, Zero Git Commit.

---

## 1. TỔNG QUAN TRIỂN KHAI

Phase 10 hoàn thiện chuỗi giá trị cốt lõi của T_SHOP trên nền tảng Mobile Native:
```
IMPORT (Nhập kho đa sản phẩm, đa giá vốn, sinh Lô FIFO)
  ↓
INVENTORY (Quản lý tồn kho tức thời, cảnh báo tồn tối thiểu)
  ↓
STOCK MOVEMENT (Sổ cái thẻ kho bất biến, đầy đủ 7 loại biến động)
  ↓
SALE (Bán hàng POS trừ kho FIFO, tính COGS chính xác theo lô)
  ↓
COST / PROFIT (Giá vốn bình quân gia quyền trên tồn kho, Lợi nhuận gộp = Doanh thu - COGS)
  ↓
DASHBOARD (KPIs trực quan theo kỳ: Hôm nay, 7 ngày, 30 ngày, Tháng này; biểu đồ xu hướng)
  ↓
REPORTING (Báo cáo Doanh thu theo ngày, Bán chạy nhất, Hàng tồn chậm/tồn lâu)
```

Toàn bộ nghiệp vụ hoạt động **100% Offline-First** trên SQLite nội bộ, ghi nhận Outbox mutation để đồng bộ 2 chiều với Server khi có kết nối Internet mà không làm gián đoạn trải nghiệm người dùng.

---

## 2. DANH MỤC CÁC FILE ĐÃ TẠO VÀ CHỈNH SỬA

### 2.1. Backend Server API & Sync
* `src/app/api/sync/push/route.ts`:
  * Mở rộng handler xử lý mutation `INVENTORY_ADJUSTMENT`.
  * Hỗ trợ đồng bộ biến động kho thủ công từ mobile lên server một cách idempotent (dựa trên `client_movement_id`).
  * Kiểm tra tồn kho phòng chống âm kho trên server, ghi nhận audit log và stock movement server.
* `src/app/api/sync/pull/route.ts`:
  * Bổ sung bảng `cost_price_history` vào dữ liệu pull incremental sync về client.

### 2.2. Mobile Data Models & Core Services
* `mobile/src/services/types.ts`:
  * Định nghĩa interface cho `StockAdjustmentInput`, `StockAdjustmentResult`, outbox mutation payload `INVENTORY_ADJUSTMENT`.
  * Định nghĩa cấu trúc báo cáo: `DatePeriod`, `DashboardSummaryData`, `RevenueProfitTrendItem`, `TopSellingItem`, `SlowMovingItem`, `SalesByDateItem`.
  * Định nghĩa `PriceHistoryRecord`, `CostHistoryRecord`.
* `mobile/src/services/OfflineInventoryService.ts`:
  * Bổ sung hàm `adjustStock()` thực thi transaction SQLite cục bộ: kiểm tra tồn, trừ/cộng tồn kho trong `products`, append vào `stock_movements`, và enqueue mutation `INVENTORY_ADJUSTMENT` vào `sync_queue`.
* `mobile/src/services/AnalyticsService.ts` **(MỚI)**:
  * Service chuyên trách tính toán tổng hợp chỉ số kinh doanh cục bộ trực tiếp từ SQLite:
    * `getDashboardSummary(period)`: Doanh thu, giá vốn, lợi nhuận gộp, tỷ suất biên lợi nhuận (%), số đơn hàng, số lượng bán, định giá tồn kho (`SUM(current_stock * current_cost_price)`), số mặt hàng sắp hết.
    * `getRevenueProfitTrend(period)`: Phân tích xu hướng theo từng mốc thời gian.
    * `getTopSellingProducts(period, limit)`: Bảng xếp hạng bán chạy theo doanh thu và sản lượng.
    * `getSlowMovingProducts(thresholdDays, limit)`: Nhận diện tồn kho chết / hàng chậm luân chuyển.
    * `getSalesByDate(period)`: Bảng kê doanh số và lãi gộp theo ngày.
* `mobile/src/sync/PushSyncHandler.ts`:
  * Thêm case xử lý commit kết quả push cho `INVENTORY_ADJUSTMENT` -> cập nhật `stock_movements.sync_status = 'SYNCED'`.
* `mobile/src/repository/sqlite/SqliteInventoryDataSource.ts`:
  * Triển khai các phương thức truy vấn `getPriceHistory()`, `getCostHistory()`, `getInventorySummary()`.
* `mobile/src/repository/InventoryRepository.ts`:
  * Public facade cung cấp đầy đủ các API quản lý kho và lịch sử giá cho UI layer.

### 2.3. Mobile UI Screens & Navigation
* `mobile/src/screens/main/InventoryScreen.tsx` **(NÂNG CẤP TOÀN DIỆN)**:
  * Top Metric Banner: Tổng mặt hàng, Tổng tồn kho, Cảnh báo sắp hết, Tổng giá trị tồn kho.
  * 3 Chế độ xem Tabs:
    * `DANH SÁCH`: Danh mục sản phẩm, giá bán, giá vốn bình quân, tồn kho, trạng thái.
    * `LÔ HÀNG (FIFO)`: Danh sách các lô hàng đang quản lý với số lượng ban đầu, số lượng còn lại, ngày nhập, đơn giá lô.
    * `LỊCH SỬ BIẾN ĐỘNG`: Thẻ kho chi tiết truy vết mọi biến động nhập, xuất bán, hư hỏng, kiểm kê.
  * Modal Nhập kho đa sản phẩm (`Multi-item Import Modal`):
    * Chọn nhiều sản phẩm trong một phiếu.
    * Nhập số lượng và đơn giá nhập riêng biệt cho từng dòng hàng.
    * Tự động tính thành tiền dòng và tổng tiền phiếu nhập.
    * Tích hợp máy quét mã vạch Barcode Scanner để thêm sản phẩm vào phiếu nhanh chóng.
  * Modal Điều chỉnh tồn kho (`Stock Adjustment Modal`):
    * Hỗ trợ 5 loại điều chỉnh: Hỏng hóc (`DAMAGE`), Thất thoát (`LOSS`), Tặng kèm (`GIFT`), Trả NCC (`RETURN`), Kiểm kê (`ADJUSTMENT`).
    * Nhập số lượng chênh lệch âm/dương, kiểm tra an toàn không cho phép âm kho.
  * Modal Lịch sử Giá & Giá vốn (`Price/Cost History Modal`):
    * Hiển thị bảng biến động giá bán và giá vốn theo thời gian có ghi chú nguồn gốc (phiếu nhập, điều chỉnh).
* `mobile/src/screens/main/DashboardScreen.tsx` **(NÂNG CẤP TOÀN DIỆN)**:
  * Bộ lọc kỳ kinh doanh: Hôm nay (`today`), 7 ngày qua (`7days`), 30 ngày qua (`30days`), Tháng này (`this_month`).
  * 4 Thẻ KPI chính: Doanh thu, Lợi nhuận gộp, Đơn hàng, Giá trị kho.
  * Biểu đồ xu hướng Doanh thu & Lợi nhuận gộp trực quan (Bar Trend Chart).
  * Phím tắt điều hướng nhanh sang POS, Kho hàng, và Báo cáo chuyên sâu.
* `mobile/src/screens/main/ReportsScreen.tsx` **(MỚI)**:
  * Màn hình Báo cáo quản trị với 3 tab:
    * `Bán hàng theo ngày`: Thống kê doanh thu, giá vốn, lãi gộp và số đơn từng ngày.
    * `Bán chạy nhất`: Bảng xếp hạng sản phẩm bán tốt nhất kèm tỷ trọng doanh thu.
    * `Tồn kho chậm / Tồn lâu`: Phát hiện các mặt hàng có tồn kho nhưng không có phát sinh bán trong chu kỳ.
  * Modal xem chi tiết dòng báo cáo: Click vào bất kỳ hàng nào để xem thông số chi tiết (giá bán, giá vốn, lãi gộp, tồn kho, ngày giao dịch gần nhất).
* `mobile/src/navigation/types.ts` & `mobile/src/navigation/MainStack.tsx`:
  * Đăng ký route `Reports` vào MainStack, cấu hình Header đồng bộ giao diện chung.
* `mobile/src/constants/colors.ts` & `mobile/src/constants/layout.ts`:
  * Chuẩn hóa Design System tokens (`Colors.text`, `Typography.bodySm`, `Typography.bodySmall`).
* `mobile/src/components/common/Card.tsx`:
  * Hỗ trợ `StyleProp<ViewStyle>` cho phép truyền style array linh hoạt.

### 2.4. Web Demo Driver & Testing Suite
* `mobile/src/database/WebDemoSqliteDriver.ts`:
  * Bổ sung kho dữ liệu in-memory đồng bộ cho Web Demo: `imports`, `import_items`, `inventory_lots`, `cost_price_history`, `price_history`, `stock_movements`.
  * Hỗ trợ thực thi các câu lệnh aggregation phân tích dữ liệu cho Dashboard và Reports.
* `mobile/tests/phase10_inventory_cost.test.mjs` **(MỚI)**:
  * Bộ test tự động kiểm thử 44 kịch bản chuyên sâu trên `better-sqlite3`.

---

## 3. KẾT QUẢ KIỂM THỬ

* **Unit & Integration Test**: 44/44 Test assertions PASS 100%.
* **Typecheck (TypeScript)**: `tsc --noEmit` hoàn thành với 0 lỗi, đạt chuẩn type-safety tuyệt đối.
* **Browser Subagent E2E Verification**:
  * Kiểm tra và chụp ảnh toàn bộ các màn hình: Dashboard (chuyển 4 kỳ lọc), Reports (3 tab dữ liệu + modal chi tiết), Inventory (3 tab + 3 modal thao tác).
  * Lưu trữ video ghi hình WebP: `phase10_inventory_verify_1789031018879.webp`.

---

## 4. KẾT LUẬN

Phase 10 đã được triển khai hoàn tất, bám sát 100% logic nghiệp vụ của T_SHOP Web, bảo đảm tính toàn vẹn dữ liệu, hiệu năng cao và trải nghiệm người dùng mượt mà trên nền tảng Native Mobile Offline-First.
