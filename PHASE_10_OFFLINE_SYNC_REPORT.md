# T_SHOP — PHASE 10 OFFLINE SYNC REPORT
## Two-Way Bidirectional Synchronization & Outbox Queue Mechanics

**Dự án**: T_SHOP Mobile Offline-First  
**Phase**: 10 — OFFLINE SYNC ENGINE  
**Tài liệu tham chiếu**: `src/app/api/sync/` & Phase 05–07 Baselines

---

## 1. MÔ HÌNH ĐỒNG BỘ 2 CHIỀU TRONG PHASE 10

```
                   MOBILE SQLITE (Offline-First)
                   [imports, inventory_lots, stock_movements]
                                  │
                                  ▼
                   LOCAL OUTBOX (sync_queue)
               [entity_type = 'IMPORT' | 'INVENTORY_ADJUSTMENT']
                                  │
                                  ▼
                     MOBILE PUSH SYNC ENGINE
                                  │  (HTTP POST /api/sync/push)
                                  ▼
                     SERVER SYNC HANDLER
                    [Idempotent Validation]
                    [Stock Verification]
                    [Server DB Commit]
                                  │
                                  ▼
                     SERVER DATABASE (PostgreSQL)
                                  │
                                  ▼
                     MOBILE PULL SYNC ENGINE
                                  │  (HTTP GET /api/sync/pull?since=cursor)
                                  ▼
                     INCREMENTAL LOCAL HYDRATION
             [cost_price_history, updated products, lot sync]
```

---

## 2. PUSH SYNC CHO BIẾN ĐỘNG KHO (`INVENTORY_ADJUSTMENT`)

### 2.1. Payload Outbox
Khi người dùng thực hiện điều chỉnh tồn kho (Hư hỏng, Thất thoát, Kiểm kê...), Outbox ghi nhận bản ghi:
```json
{
  "client_mutation_id": "uuid-v4",
  "entity_type": "INVENTORY_ADJUSTMENT",
  "entity_id": "client_movement_id",
  "action": "UPDATE",
  "payload_json": {
    "client_movement_id": "client_movement_id",
    "product_id": 1,
    "movement_type": "DAMAGE",
    "quantity_change": -2,
    "balance_after": 13,
    "movement_date": "2026-09-10",
    "note": "Hỏng trong lúc vận chuyển",
    "created_by": 1
  }
}
```

### 2.2. Xử lý trên Server (`/api/sync/push`)
Server tiếp nhận mutation `INVENTORY_ADJUSTMENT`:
1. **Kiểm tra Idempotency**: Dựa vào `client_movement_id` trong `stock_movements`. Nếu đã tồn tại -> trả về thành công ngay lập tức (`SKIPPED_DUPLICATE`), không làm trừ 2 lần.
2. **Kiểm tra tồn kho Server**: Nếu thao tác làm tồn kho server âm (`current_stock + quantity_change < 0`):
   * Phân loại là `INVENTORY_CONFLICT`.
   * Ghi nhận vào `conflict_records` để quản lý xử lý hòa giải, không để database bị lỗi ràng buộc.
3. **Cập nhật dữ liệu Server**:
   * Cập nhật `products.current_stock`.
   * Thêm bản ghi vào `stock_movements` của server.
   * Ghi nhận audit log: `"Synced offline inventory adjustment for product X: Y"`.
4. **Phản hồi Client**: Client nhận kết quả thành công và chuyển `stock_movements.sync_status = 'SYNCED'`.

---

## 3. PUSH SYNC CHO PHIẾU NHẬP KHO (`IMPORT`)

* Client push payload chứa toàn bộ phiếu nhập và danh sách items.
* Server chèn `imports`, `import_items`, sinh các `inventory_lots` tương ứng trên Server, cộng tồn kho và tính lại giá vốn bình quân gia quyền.
* Bất kỳ thiết bị mobile khác khi kéo dữ liệu (Pull Sync) sẽ nhận được các lô hàng và giá vốn mới nhất.

---

## 4. PULL SYNC NÂNG CẤP (`/api/sync/pull`)

* Bổ sung bảng `cost_price_history` vào dữ liệu pull trả về cho Mobile theo cursor `since`.
* Mobile cập nhật lịch sử giá vốn, đảm bảo dữ liệu giá vốn luôn khớp 100% giữa Server và mọi thiết bị Mobile.

---

## 5. KẾT LUẬN

Hệ thống đồng bộ hai chiều Phase 10 bảo đảm giao dịch nhập kho và điều chỉnh kho được lưu chuyển an toàn, không bao giờ mất mát hay tạo trùng lặp giao dịch khi có sự cố mạng.
