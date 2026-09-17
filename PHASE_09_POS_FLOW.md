# T_SHOP — PHASE 09 POS FLOW
# OFFLINE-FIRST NATIVE RETAIL CHECKOUT ARCHITECTURE

============================================================
**Project:** T_SHOP  
**Document:** POS End-to-End Operational Lifecycle  
**Date:** September 10, 2026  
============================================================

```mermaid
sequenceDiagram
    autonumber
    actor Cashier as Nhân Viên Thu Ngân
    participant UI as Mobile POS Screen
    participant Cam as Expo Camera / Laser Wedge
    participant Cart as In-Memory Cart Engine
    participant Repo as SaleRepository
    participant DB as SQLite (Local ACID)
    participant Outbox as Sync Queue (Outbox)
    participant Printer as ESC/POS Printer Service
    participant Server as Backend API

    %% 1. Product Acquisition
    Note over Cashier,Cam: 1. Thêm sản phẩm vào giỏ
    alt Quét mã vạch
        Cashier->>UI: Nhấn "📷 Quét Barcode / QR"
        UI->>Cam: Mở CameraView với laser viewfinder
        Cam-->>UI: Phát hiện Barcode (EAN-13 / Code-128 / QR)
        UI->>DB: Truy vấn SELECT * FROM products WHERE sku = ? OR id = ?
        DB-->>UI: Thông tin sản phẩm & tồn kho
    else Tìm thủ công
        Cashier->>UI: Nhấn "➕ Chọn từ kho" / Gõ tìm kiếm
        UI->>DB: SELECT * FROM products WHERE name LIKE ? OR sku LIKE ?
        DB-->>UI: Danh sách sản phẩm khả dụng
    end

    %% 2. Cart & Stock Validation
    Note over UI,Cart: 2. Quản lý giỏ hàng & kiểm kho
    UI->>Cart: Thêm sản phẩm (Số lượng + 1)
    Cart->>Cart: Kiểm tra: requested_qty <= current_stock
    alt Không đủ tồn kho
        Cart-->>UI: Cảnh báo: Vượt quá tồn kho khả dụng!
    else Đủ tồn kho
        Cart->>Cart: Snapshot giá bán (priceSnapshot)
        Cart-->>UI: Cập nhật Giỏ: Số lượng, Đơn giá, Thành tiền
    end

    %% 3. Payment Selection & Validation
    Note over Cashier,UI: 3. Thanh toán & Tính tiền thừa
    Cashier->>UI: Chọn hình thức (💵 Tiền mặt / 🏦 Chuyển khoản / 💳 Thẻ)
    opt Tiền mặt (CASH)
        Cashier->>UI: Chọn chip nhanh (50k, 100k, 200k, 500k...) hoặc gõ số tiền
        UI->>UI: Tính tiền thừa = tiền khách đưa - tổng cần thanh toán
        UI->>UI: Kiểm tra tiền khách đưa >= tổng cần thanh toán
    end

    %% 4. Atomic SQLite Commit
    Note over UI,DB: 4. Giao dịch nguyên khối ACID
    Cashier->>UI: Nhấn "XÁC NHẬN BÁN"
    UI->>Repo: createMultiItemSale(items, payment, user_id)
    Repo->>DB: BEGIN IMMEDIATE TRANSACTION
    DB->>DB: 1. INSERT INTO sales_orders (status='COMPLETED', sync_status='PENDING')
    DB->>DB: 2. INSERT INTO sales_records (snapshot unit_price, cost, profit)
    DB->>DB: 3. UPDATE products SET current_stock = current_stock - qty
    DB->>Outbox: 4. INSERT INTO sync_queue (action='CREATE', entity='SALE_ORDER')
    DB->>Repo: COMMIT
    Repo-->>UI: Trả về SaleOrderResult (order_code, items)

    %% 5. Receipt & Printing
    Note over UI,Printer: 5. Hiển thị hóa đơn & In ấn độc lập
    UI->>UI: Mở ReceiptModal (Trạng thái: "○ Lưu Offline - Chờ đồng bộ")
    alt In hóa đơn qua Bluetooth
        Cashier->>UI: Nhấn "🖨️ In hóa đơn (ESC/POS)"
        UI->>Printer: printReceipt(ReceiptData)
        Printer->>Printer: Sinh byte ESC/POS 58mm/80mm + transliterate tiếng Việt
        alt Máy in thành công
            Printer-->>UI: ✅ In thành công
        else Máy in mất kết nối / Hết giấy
            Printer-->>UI: ⚠️ Lỗi máy in (Giao dịch bán hàng vẫn giữ nguyên vẹn!)
            UI-->>Cashier: Cho phép thử lại in hoặc Chia sẻ (Share)
        end
    else Chia sẻ qua Zalo / SMS
        Cashier->>UI: Nhấn "📤 Chia sẻ"
        UI->>Cashier: Mở Native Share Sheet với hóa đơn text
    end

    %% 6. Asynchronous Server Sync
    Note over Outbox,Server: 6. Đồng bộ server khi có mạng
    Outbox->>Server: Push Mutation (client_mutation_id, payload)
    Server-->>Outbox: ACK 200 (ALREADY_PROCESSED / SYNCED)
    Outbox->>DB: UPDATE sales_orders SET sync_status = 'SYNCED'
    DB-->>UI: Cập nhật huy hiệu: "● Đã đồng bộ máy chủ"
```

---

## Các Bất Biến Trọng Tâm (Core Architectural Invariants)

1. **Local Stock Isolation**: Trừ tồn kho local ngay khi commit SQLite để ngăn chặn bán vượt số lượng ngay trên thiết bị.
2. **Server Authoritative**: Server vẫn là nguồn chân lý cho tồn kho tổng; khi sync, server kiểm tra và phân loại conflict nếu có tranh chấp giữa nhiều thiết bị (Phase 07).
3. **Printer Failure Decoupling (Section 36)**: Máy in là thiết bị ngoại vi không tin cậy (untrusted peripheral). Lỗi máy in không được phép trigger rollback database SQLite.
4. **Offline Resilience**: Toàn bộ từ bước 1 đến bước 5 hoạt động 100% khi ngắt kết nối Internet.
