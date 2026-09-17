# T_SHOP — PHASE 10 IMPORT REPORT
## Stock Import Engine, Multi-item Ingestion, & FIFO Lot Generation

**Dự án**: T_SHOP Mobile Offline-First  
**Phase**: 10 — INVENTORY MANAGEMENT, STOCK MOVEMENT, IMPORT STOCK  
**Tài liệu tham chiếu**: `src/app/api/inventory/import/route.ts` & `DATABASE.md`

---

## 1. NGUYÊN TẮC NGHIỆP VỤ NHẬP KHO TỪ WEB SANG MOBILE

Trên Web App của T_SHOP, quy trình nhập hàng có các đặc điểm cốt lõi sau:
1. **Phiếu nhập đa sản phẩm (Multi-item)**: Một phiếu nhập (`imports`) có thể chứa nhiều dòng sản phẩm (`import_items`), mỗi dòng có số lượng (`quantity`) và đơn giá vốn nhập (`unit_cost_price`) khác nhau.
2. **Quản lý đa giá vốn (Multiple Import Costs)**: Mỗi đợt nhập hàng có thể có giá vốn khác nhau tùy theo nhà cung cấp và thời điểm. Hệ thống **không bao giờ ghi đè** làm mất lịch sử giá nhập cũ.
3. **Sinh lô hàng tự động (FIFO Lots)**: Mỗi dòng hàng nhập kho tạo ra một bản ghi trong `inventory_lots` với `quantity_received` và `quantity_remaining` ban đầu bằng nhau, lưu vết `unit_cost` của riêng lô đó.
4. **Cập nhật tồn kho sản phẩm**: Tồn kho tức thời `products.current_stock` tăng thêm số lượng nhập.
5. **Cập nhật giá vốn bình quân gia quyền**: Giá vốn hiển thị của sản phẩm `products.current_cost_price` được tính lại theo trọng số số lượng còn lại của tất cả các lô đang hoạt động (`quantity_remaining > 0`).
6. **Lịch sử biến động giá vốn**: Ghi nhận một dòng vào `cost_price_history` để phục vụ đối soát.
7. **Thẻ kho (Stock Movement)**: Ghi nhận giao dịch `PURCHASE` vào `stock_movements`.

---

## 2. TRIỂN KHAI TRÊN MOBILE NATIVE

### 2.1. Cấu trúc dữ liệu SQLite cục bộ
Khi người dùng bấm "Hoàn tất nhập kho" trên Mobile, toàn bộ quá trình được thực thi bên trong **một SQLite Transaction duy nhất** (`BEGIN IMMEDIATE`):
* `imports`:
  * `client_import_id`: UUID duy nhất tại client.
  * `import_code`: Mã phiếu `IMP-{timestamp}`.
  * `supplier_id`: ID nhà cung cấp được chọn.
  * `import_date`: Ngày nhập (mặc định hôm nay).
  * `total_amount`: Tổng tiền cả phiếu `SUM(quantity * unit_cost_price)`.
  * `sync_status`: `'PENDING'`.
* `import_items`:
  * `import_id`: Khóa ngoại trỏ về bảng `imports`.
  * `product_id`: ID sản phẩm.
  * `quantity`: Số lượng nhập (> 0).
  * `unit_cost_price`: Giá nhập đơn vị (>= 0).
  * `total_amount`: Thành tiền dòng.
* `inventory_lots`:
  * `lot_code`: Mã lô dạng `LOT-{product_id}-{timestamp}-{random}`.
  * `product_id`: ID sản phẩm.
  * `purchase_date`: Ngày nhập.
  * `quantity_received`: Số lượng nhập ban đầu.
  * `quantity_remaining`: Số lượng tồn còn lại của lô (khởi tạo = quantity_received).
  * `unit_cost`: Giá vốn đơn vị của lô.
* `cost_price_history`:
  * `product_id`: ID sản phẩm.
  * `cost_price`: Đơn giá vốn nhập lần này.
  * `effective_from`: Ngày hiệu lực.
  * `note`: `Nhập hàng {import_code}`.
* `stock_movements`:
  * `movement_type`: `'PURCHASE'`.
  * `quantity_change`: `+quantity`.
  * `balance_after`: Tồn kho mới sau khi cộng.
  * `reference_type`: `'IMPORT'`.
  * `reference_id`: Mã phiếu nhập.
* `sync_queue`:
  * Enqueue mutation `action: 'CREATE'`, `entity_type: 'IMPORT'`, payload JSON chứa đầy đủ thông tin phiếu và danh sách items.

### 2.2. Giao diện Nhập kho đa sản phẩm (`InventoryScreen.tsx`)
* Giao diện Modal trực quan cho phép:
  * Chọn Nhà cung cấp từ danh sách có sẵn.
  * Thêm từng sản phẩm từ danh mục hoặc quét mã vạch Barcode / QR code bằng camera.
  * Điều chỉnh số lượng và giá vốn nhập riêng cho từng dòng.
  * Tự động tính toán thành tiền dòng và tổng giá trị phiếu nhập theo thời gian thực.
  * Nút "Xóa dòng" cho phép gỡ bỏ sản phẩm khỏi phiếu trước khi hoàn tất.
  * Nút "Hoàn tất nhập kho" thực thi lưu trữ tức thời vào SQLite và Outbox.

---

## 3. ĐỐI SOÁT TOÁN HỌC VÍ DỤ THỰC TẾ

| Bước | Hành động | Số lượng | Đơn giá vốn | Tồn kho sau bước | Lô hàng còn lại | Giá vốn BQGQ (`products.current_cost_price`) |
|---|---|---|---|---|---|---|
| 1 | Khởi tạo ban đầu | 0 | 0 đ | 0 | Không có | 0 đ |
| 2 | Nhập Lô 1 (`IMP-01`) | +10 | 100,000 đ | 10 | Lô 1: 10 cái @ 100,000 đ | 100,000 đ |
| 3 | Nhập Lô 2 (`IMP-02`) | +20 | 160,000 đ | 30 | Lô 1: 10 cái @ 100,000 đ<br>Lô 2: 20 cái @ 160,000 đ | (10×100k + 20×160k)/30 = **140,000 đ** |
| 4 | Bán hàng (`HD-01`) | -15 | 250,000 đ (bán) | 15 | Lô 1: 0 cái (hết)<br>Lô 2: 15 cái @ 160,000 đ | 15×160k / 15 = **160,000 đ** |

Mô hình trên hoàn toàn trùng khớp với kết quả kiểm thử tự động tại `mobile/tests/phase10_inventory_cost.test.mjs`.

---

## 4. KẾT LUẬN

Module Nhập kho Mobile đáp ứng 100% yêu cầu nghiệp vụ của T_SHOP Web, xử lý trơn tru quy trình nhập đa sản phẩm, quản lý đa giá vốn và thiết lập tiền đề chính xác cho việc trừ kho FIFO và tính giá vốn hàng bán (COGS).
