# T_SHOP — PHASE 10 INVENTORY REPORT
## Inventory State Management, Lot Tracking, & Stock Health

**Dự án**: T_SHOP Mobile Offline-First  
**Phase**: 10 — INVENTORY MANAGEMENT  
**Tài liệu tham chiếu**: `DATABASE.md` & `src/app/api/inventory/`

---

## 1. MỤC TIÊU VÀ NGUYÊN TẮC

Quản lý tồn kho trong T_SHOP là trung tâm điều phối của toàn bộ hệ thống bán hàng và tài chính. Mobile App phải đảm bảo:
* **Tồn kho tức thời chính xác**: Phản ánh số lượng thực tế có thể bán (`current_stock`) của từng sản phẩm.
* **Theo dõi trạng thái lô hàng (Lot Tracking)**: Mọi đơn vị hàng hóa đều có thể truy vết về lô hàng nhập ban đầu, nhà cung cấp, ngày nhập và giá vốn.
* **Cảnh báo tồn kho an toàn**: Phát hiện sớm các sản phẩm có tồn kho thấp hơn ngưỡng `min_stock_alert` để người quản lý kịp thời nhập thêm hàng.
* **Định giá tồn kho chuẩn xác**: Tổng giá trị tồn kho của cửa hàng được tính bằng `SUM(current_stock * current_cost_price)`.
* **Không để âm kho ngoài ý muốn**: Tất cả thao tác xuất bán hoặc điều chỉnh giảm đều phải qua kiểm tra `current_stock >= quantity_deduct`.

---

## 2. KIẾN TRÚC QUẢN LÝ KHO TRÊN MOBILE

### 2.1. Phân tầng dữ liệu trong SQLite
1. **Bảng `products`**:
   * Cột `current_stock`: Lưu số lượng tồn kho tổng thể tức thời của sản phẩm. Được index để truy vấn nhanh.
   * Cột `current_cost_price`: Lưu giá vốn bình quân gia quyền hiện tại của các lô hàng còn tồn.
   * Cột `min_stock_alert`: Ngưỡng cảnh báo hết hàng (mặc định = 5).
2. **Bảng `inventory_lots`**:
   * Lưu chi tiết từng lô hàng nhập về.
   * `quantity_received`: Số lượng nhập gốc của lô.
   * `quantity_remaining`: Số lượng thực tế còn lại trong lô.
   * `unit_cost`: Giá vốn đơn vị của riêng lô này.
3. **Bảng `stock_movements`**:
   * Sổ cái nhật ký bất biến ghi chép mọi biến động làm thay đổi `current_stock`.

### 2.2. Giao diện người dùng Quản lý kho (`InventoryScreen.tsx`)
Màn hình Kho hàng trên Mobile được thiết kế chuẩn mực theo Web Design System với 3 khu vực chính:
1. **Top Metric Cards**:
   * *Tổng mặt hàng*: Số lượng sản phẩm đang hoạt động.
   * *Tổng tồn kho*: Tổng số lượng đơn vị sản phẩm có trong kho (`SUM(current_stock)`).
   * *Cảnh báo hết*: Số lượng mặt hàng có `current_stock <= min_stock_alert`.
   * *Giá trị tồn*: Tổng giá trị vốn của kho hàng (`SUM(current_stock * current_cost_price)`).
2. **Bộ chuyển Tab chuyên biệt**:
   * `Tồn kho (DANH SÁCH)`: Tìm kiếm sản phẩm theo tên, SKU, lọc theo loại hàng; hiển thị giá vốn, giá bán, số lượng tồn và nút thao tác nhanh (Nhập kho, Điều chỉnh, Lịch sử giá).
   * `Lô hàng (LÔ HÀNG - FIFO)`: Liệt kê chi tiết từng lô hàng, ngày nhập, đơn giá lô, số lượng ban đầu và số lượng còn lại kèm Badge trạng thái (`Còn X cái` hoặc `Đã xuất hết`).
   * `Thẻ kho (LỊCH SỬ BIẾN ĐỘNG)`: Thể hiện sổ cái thời gian thực mọi giao dịch nhập (`PURCHASE`), xuất (`SALE`), điều chỉnh (`DAMAGE`, `LOSS`, `GIFT`, `RETURN`, `ADJUSTMENT`).
3. **Thao tác nhanh**:
   * Nút `+ Nhập hàng`: Mở modal lập phiếu nhập kho đa sản phẩm.
   * Nút `Điều chỉnh`: Mở modal điều chỉnh kiểm kê tồn kho với 5 lý do chuẩn hóa.
   * Nút `Lịch sử giá`: Mở modal xem biến động giá bán và giá vốn qua từng thời kỳ.

---

## 3. KIỂM THỬ VÀ XÁC NHẬN

* **Định giá tồn kho**:
  * Công thức `SUM(current_stock * current_cost_price)` đã được kiểm chứng tự động tại `phase10_inventory_cost.test.mjs` đạt kết quả chính xác 100%.
* **Kiểm tra trực quan Browser**:
  * Đã chụp ảnh `dashboard_screen`, `inventory_lots_fifo`, `stock_movement_ledger`, `import_stock_modal`, `stock_adjustment_modal`, `price_history_modal`.
  * Các thẻ chỉ số hiển thị rõ ràng, không bị tràn viền hay che khuất trên mọi kích thước màn hình.

---

## 4. KẾT LUẬN

Hệ thống quản lý kho Phase 10 mang lại cho nhân viên và chủ cửa hàng khả năng nắm bắt tức thời tình trạng tồn kho, loại bỏ nguy cơ bán hàng thiếu hụt và giúp ra quyết định nhập hàng kịp thời.
