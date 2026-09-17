# T_SHOP — PHASE 10 RISK REGISTER
## Operational Risks, Edge Cases & Mitigation Strategies

**Dự án**: T_SHOP Mobile Offline-First  
**Phase**: 10 — RISK MANAGEMENT & CONTROLS  

---

## 1. BẢNG THEO DÕI RỦI RO & PHƯƠNG ÁN GIẢI QUYẾT

| Mã Rủi ro | Mô tả Rủi ro | Mức độ | Khả năng xảy ra | Biện pháp giảm thiểu đã triển khai |
|---|---|---|---|---|
| **RSK-10-01** | Bán âm kho khi nhiều thiết bị offline cùng bán 1 sản phẩm | Trung bình | Thấp | Phát hiện xung đột tại Server qua `INVENTORY_CONFLICT`, lưu vết vào `conflict_records`, không làm mất đơn bán của khách hàng, cảnh báo quản lý nhập thêm hàng bù. |
| **RSK-10-02** | Sản phẩm không có lô hàng nào trong `inventory_lots` (dữ liệu ban đầu hoặc import cũ) | Thấp | Thấp | Fallback an toàn: Sử dụng `current_cost_price` từ bảng `products` để tính COGS, đảm bảo không bị crash hoặc chia cho 0. |
| **RSK-10-03** | Thao tác nhập kho lớn với hàng trăm sản phẩm gây giật lag UI | Thấp | Thấp | Thực thi trong SQLite Transaction bất đồng bộ (`async withTransactionAsync`), tối ưu index trên `inventory_lots(product_id, quantity_remaining)` và `stock_movements(product_id)`. |
| **RSK-10-04** | Trôi dạt giá vốn bình quân do làm tròn số thập phân (Rounding Drift) | Rất thấp | Rất thấp | Tất cả phép tính tiền tệ VNĐ được làm tròn `Math.round()` thống nhất với Web App của T_SHOP. |
| **RSK-10-05** | Mạng chập chờn khi đẩy mutation `INVENTORY_ADJUSTMENT` | Thấp | Trung bình | Cơ chế Idempotency dựa trên `client_movement_id` trên server. Nếu gửi lặp lại nhiều lần do timeout, server trả về thành công ngay mà không trừ lặp. |

---

## 2. KHUYẾN NGHỊ VẬN HÀNH CHO CỬA HÀNG

1. **Kiểm kê định kỳ**: Thực hiện kiểm kê định kỳ ít nhất mỗi tháng một lần bằng tính năng "Điều chỉnh kho -> Kiểm kê" để đảm bảo số tồn thực tế luôn khớp với hệ thống.
2. **Nhập hàng ngay khi nhận hàng**: Tạo thói quen lập phiếu nhập kho đa sản phẩm ngay khi nhận hàng từ nhà cung cấp để các lô hàng mới có giá vốn kịp thời cung ứng cho việc trừ FIFO khi bán hàng.
3. **Theo dõi thẻ "Tồn kho chậm"**: Thường xuyên kiểm tra Tab "Tồn kho chậm" trên màn hình Báo cáo để có chiến lược xả hàng trước khi hàng bị lỗi mốt hoặc giảm giá trị.

---

## 3. KẾT LUẬN

Hệ thống quản lý rủi ro Phase 10 đã lường trước đầy đủ các tình huống biên tế nhị nhất trong bán lẻ offline-first và trang bị sẵn các cơ chế tự bảo vệ cũng như khôi phục dữ liệu an toàn.
