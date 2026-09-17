# T_SHOP — PHASE 10 SECURITY REPORT
## Authentication, Authorization, Account Scope & Role-Based Control

**Dự án**: T_SHOP Mobile Offline-First  
**Phase**: 10 — SECURITY & DATA ISOLATION  
**Tài liệu tham chiếu**: Phase 08 & Phase 08.1 Baselines

---

## 1. NGUYÊN TẮC BẢO MẬT TRONG PHASE 10

Các thao tác nhập hàng, điều chỉnh kho và xem báo cáo tài chính là những khu vực có độ nhạy cảm cao về bảo mật và quyền hạn. Phase 10 tuân thủ nghiêm ngặt các nguyên tắc:
1. **Cô lập theo tài khoản (Account Isolation)**: Toàn bộ dữ liệu nhập kho và điều chỉnh cục bộ đều gắn liền với `user_id` và `device_id` đã được xác thực tại Phase 08.
2. **Phân quyền theo vai trò (Role-Based Access Control - RBAC)**:
   * `ADMIN`: Toàn quyền xem và thực hiện: Lập phiếu nhập kho, Điều chỉnh tồn kho, Xem giá vốn, Xem biên lợi nhuận, Xem Báo cáo tài chính chuyên sâu.
   * `STAFF`: Quyền hạn bị giới hạn phù hợp: Thực hiện bán hàng POS, xem danh mục tồn kho; các hành động điều chỉnh kho lớn hoặc sửa giá vốn cần phê duyệt hoặc chỉ mở cho cấp quản lý.
3. **Audit Trail bất biến**: Mọi dòng biến động kho `stock_movements` và outbox queue đều lưu `created_by = user_id`, ngăn chặn việc chối bỏ trách nhiệm (Non-repudiation).

---

## 2. BẢO VỆ DỮ LIỆU ĐỘNG & BÁO CÁO NHẠY CẢM

### 2.1. Che dấu hoặc giới hạn trường Giá vốn và Lợi nhuận
* Trên giao diện bán lẻ POS dành cho thu ngân, giá vốn và tỷ suất lợi nhuận gộp không được phơi bày trực tiếp để bảo vệ bí mật kinh doanh khi khách hàng đứng trước quầy.
* Chỉ trên Dashboard và Màn hình Báo cáo (dành cho quản trị), các chỉ số Lợi nhuận gộp và Tỷ suất biên lãi mới được hiển thị.

### 2.2. Bảo vệ Transaction trong SQLite
* Tất cả thao tác ghi dữ liệu kho đều chạy trong Transaction Immediate (`BEGIN IMMEDIATE`), ngăn chặn xung đột tranh chấp ghi (Write-write conflict) giữa nhiều tiến trình hoặc luồng ngầm (Sync Worker).

---

## 3. TOÀN VẸN REQUEST ĐỒNG BỘ (SYNC PAYLOAD INTEGRITY)

* Mọi mutation gửi lên `/api/sync/push` bắt buộc phải kèm Bearer Token JWT hợp lệ.
* Server xác thực danh tính người gửi trước khi chấp nhận ghi nhận phiếu nhập hoặc điều chỉnh tồn kho.
* Thao tác điều chỉnh kho được ghi vào bảng `audit_logs` trên server với địa chỉ IP, User ID và chi tiết thay đổi.

---

## 4. KẾT LUẬN

Kiến trúc Phase 10 tiếp tục củng cố vững chắc nền tảng bảo mật của T_SHOP, bảo vệ dữ liệu tài chính nhạy cảm và duy trì quyền kiểm soát toàn diện cho chủ cửa hàng.
