# T_SHOP — PHASE 10 DATA CONSISTENCY REPORT
## Inventory Consistency, Balance Verification & Reconciliation Rules

**Dự án**: T_SHOP Mobile Offline-First  
**Phase**: 10 — DATA CONSISTENCY & RECONCILIATION  
**Tài liệu tham chiếu**: Phase 04, 05, 07 Baselines & `DATABASE.md`

---

## 1. NGUYÊN TẮC NHẤT QUÁN DỮ LIỆU TỒN KHO

Tồn kho trong T_SHOP là trạng thái suy diễn có thể đối soát (Derivable & Reconcilable State). Để đảm bảo tính nhất quán tuyệt đối giữa 3 bảng:
```
products.current_stock
       ↕ (Luôn bằng nhau)
inventory_lots: SUM(quantity_remaining)
       ↕ (Luôn bằng nhau)
stock_movements: SUM(quantity_change)
```

### Phương trình Bất biến Tồn kho (Inventory Invariant):
$$\mathbf{P.current\_stock} = \sum_{j} \mathbf{Lot}_j.\mathbf{quantity\_remaining} = \sum_{k} \mathbf{Movement}_k.\mathbf{quantity\_change}$$

Bất kỳ sự sai lệch nào giữa 3 giá trị trên đều được coi là một lỗi trôi dạt dữ liệu tồn kho (**Stock Drift**).

---

## 2. CƠ CHẾ PHÒNG CHỐNG TRÔI DẠT DỮ LIỆU (DRIFT MITIGATION)

1. **Transaction nguyên tử (Atomicity)**:
   * Khi nhập hàng: Cùng một transaction thực hiện `INSERT INTO imports`, `INSERT INTO import_items`, `INSERT INTO inventory_lots`, `UPDATE products`, `INSERT INTO stock_movements`. Không thể xảy ra trường hợp tăng tồn kho mà không có bản ghi trong lô hàng hoặc thẻ kho.
   * Khi bán hàng: Cùng một transaction thực hiện `UPDATE inventory_lots` (trừ FIFO), `UPDATE products`, `INSERT INTO sales_records`, `INSERT INTO stock_movements`.
   * Khi điều chỉnh kho: Cùng một transaction thực hiện `UPDATE products` và `INSERT INTO stock_movements`.
2. **Kiểm tra biên an toàn (Boundary Checks)**:
   * CHECK constraint trong SQLite: `current_stock INTEGER NOT NULL DEFAULT 0`, `quantity_remaining >= 0`.
   * Mã ứng dụng kiểm tra chặn trước: `if (newStock < 0) throw new Error(...)`.

---

## 3. ĐỐI SOÁT & XỬ LÝ XUNG ĐỘT KHI ĐỒNG BỘ (CONFLICT RESOLUTION)

Nếu hai thiết bị bán hàng cùng lúc ở chế độ offline dẫn đến tồn kho tổng trên server bị thiếu hụt khi đồng bộ:
* Server áp dụng nguyên tắc từ Phase 07:
  * Không làm mất đơn bán hàng hợp lệ đã thu tiền từ khách.
  * Ghi nhận dòng xung đột vào `conflict_records` với `conflict_type = 'INVENTORY_CONFLICT'`.
  * Ghi nhận cảnh báo trôi dạt tồn kho vào `stock_drift_records`.
  * Cho phép người quản lý thực hiện thao tác cân bằng tồn kho hoặc nhập bù lô hàng mới.

---

## 4. KẾT LUẬN

Mô hình dữ liệu và cơ chế transaction nhất quán của Phase 10 đảm bảo sổ sách kế toán kho của T_SHOP luôn chuẩn xác, không có độ trôi dạt số liệu và hoàn toàn minh bạch.
