# T_SHOP — PHASE 10 STOCK MOVEMENT REPORT
## Immutable Stock Movement Ledger & Audit Trail

**Dự án**: T_SHOP Mobile Offline-First  
**Phase**: 10 — STOCK MOVEMENT LEDGER  
**Tài liệu tham chiếu**: `src/lib/db.ts` & `DATABASE.md`

---

## 1. NGUYÊN TẮC BẤT BIẾN CỦA THẺ KHO (STOCK MOVEMENT LEDGER)

Trong T_SHOP:
* Bảng `stock_movements` là **sổ cái ghi nhận nối tiếp (Append-Only Ledger)**.
* **Tuyệt đối KHÔNG sửa (UPDATE) hay xóa (DELETE)** các bản ghi trong `stock_movements`.
* Mọi biến động làm tăng hoặc giảm tồn kho của sản phẩm đều phải tạo một bản ghi tương ứng trong `stock_movements`.
* Mỗi bản ghi lưu trữ:
  * `quantity_change`: Số lượng thay đổi (dương khi tăng, âm khi giảm).
  * `balance_after`: Số lượng tồn kho thực tế của sản phẩm ngay sau khi biến động xảy ra.
  * `reference_type`: Nguồn gốc sinh biến động (`IMPORT`, `SALE`, `MANUAL_ADJUSTMENT`, `RECONCILIATION`).
  * `reference_id`: Mã chứng từ liên quan (mã đơn bán, mã phiếu nhập, mã điều chỉnh).

---

## 2. PHÂN LOẠI 7 LOẠI BIẾN ĐỘNG KHO (MOVEMENT TYPES)

Bảng `stock_movements` hỗ trợ đầy đủ 7 loại biến động chuẩn hóa theo CHECK constraint của cơ sở dữ liệu:

| Loại biến động (`movement_type`) | Chiều thay đổi | Ý nghĩa nghiệp vụ | Nguồn phát sinh |
|---|---|---|---|
| `PURCHASE` | Tăng (+) | Nhập hàng từ nhà cung cấp | Phiếu nhập kho (`imports`) |
| `SALE` | Giảm (-) | Xuất bán lẻ cho khách hàng | Đơn hàng POS (`sales_records`) |
| `DAMAGE` | Giảm (-) | Hàng bị hỏng hóc, rách, vỡ, ố màu trong kho/trưng bày | Modal điều chỉnh kho |
| `LOSS` | Giảm (-) | Hàng thất thoát do mất cắp, thiếu sót khi kiểm kê | Modal điều chỉnh kho |
| `GIFT` | Giảm (-) | Xuất hàng làm quà tặng, chương trình khuyến mãi | Modal điều chỉnh kho |
| `RETURN` | Giảm (-) | Xuất trả lại hàng lỗi cho nhà cung cấp | Modal điều chỉnh kho |
| `ADJUSTMENT` | Tăng (+) hoặc Giảm (-) | Cân đối kiểm kê định kỳ thực tế | Modal điều chỉnh kho |

---

## 3. THAO TÁC ĐIỀU CHỈNH KHO OFFLINE (`adjustStock`)

### 3.1. Luồng thực thi kỹ thuật
Hàm `adjustStock()` trong `OfflineInventoryService.ts` thực hiện theo các bước nghiêm ngặt:
1. **Bắt đầu Transaction SQLite**: `BEGIN IMMEDIATE`.
2. **Kiểm tra sản phẩm & tồn kho hiện tại**:
   * Truy vấn `SELECT current_stock FROM products WHERE id = ?`.
   * Tính `newStock = current_stock + quantity_change`.
   * Nếu `newStock < 0`: Lập tức `ROLLBACK` và ném lỗi `"Insufficient stock for adjustment: current {current_stock}, change {quantity_change}"`.
3. **Ghi sổ cái `stock_movements`**:
   * Sinh `client_movement_id` bằng UUID.
   * Ghi nhận dòng biến động với `balance_after = newStock`, `sync_status = 'PENDING'`.
4. **Cập nhật `products`**:
   * Cập nhật `current_stock = newStock`, `updated_at = datetime('now')`.
5. **Ghi nhận Outbox Mutation**:
   * Ghi vào `sync_queue` bản ghi với `entity_type: 'INVENTORY_ADJUSTMENT'`, `action: 'UPDATE'`.
6. **Commit Transaction**: Hoàn tất an toàn.

---

## 4. BẢO ĐẢM TÍNH TRUY VẾT (AUDIT TRAIL)

Với mô hình sổ cái này:
* Bất kỳ thời điểm nào, kiểm toán viên có thể tái hiện lại số dư tồn kho lịch sử bằng cách tính lũy kế `SUM(quantity_change)` của sản phẩm từ ngày đầu tiên.
* Không có hiện tượng "nhảy số tồn kho" mà không rõ nguyên nhân.
* Mọi hành động xuất nhập đều gắn liền với ID nhân viên thực hiện (`created_by`) và thời gian chính xác (`movement_date`, `created_at`).

---

## 5. KẾT LUẬN

Sổ cái biến động kho Mobile đáp ứng tuyệt đối chuẩn mực kế toán kho của T_SHOP Web, đảm bảo tính minh bạch, khả năng kiểm toán và toàn vẹn dữ liệu xuyên suốt.
