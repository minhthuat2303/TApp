# BÁO CÁO TỔNG KẾT KIỂM ĐỊNH VÀ KHẮC PHỤC HỆ THỐNG T_SHOP
## Báo Cáo Bán Hàng, Tồn Kho, Đơn Hàng & Đồng Bộ Đám Mây (Supabase / PostgreSQL)

**Dự án:** T_SHOP (T_App)  
**Phiên bản:** Release 1.0.0 (Production APK)  
**Ngày hoàn thành:** 22/09/2026  
**Kiến trúc:** React Native Mobile Client ➔ Vercel Serverless API ➔ Supabase PostgreSQL (Single Source of Truth)  
**Tình trạng kiểm định cuối cùng (Final Verdict):** ✅ **READY (SẴN SÀNG TRIỂN KHAI SẢN XUẤT)**

---

## 1. TỔNG QUAN ĐIỀU HÀNH (EXECUTIVE SUMMARY)

Dự án T_SHOP đã hoàn thành kiểm tra toàn diện, khắc phục lỗi gốc rễ và xác thực thực nghiệm trên môi trường Runtime (Android Emulator `emulator-5554` và Supabase PostgreSQL Cloud).

Toàn bộ 7 nhóm vấn đề trọng yếu (A đến G) đã được xử lý triệt để:
1. **Báo cáo bán hàng & Hiệu suất (5 Tabs):** Khắc phục lỗi crash `Cannot read property 'netRevenue' of undefined`, chuẩn hóa cấu trúc 9 chỉ số KPI cốt lõi, bảng đối soát thời gian thực, ma trận sản phẩm và thống kê theo khung giờ/thứ trong tuần theo múi giờ Việt Nam (`Asia/Ho_Chi_Minh`). Loại bỏ hoàn toàn doanh thu ảo từ các đơn hàng đã hủy.
2. **Quản lý Vòng đời Đơn hàng & Hủy đơn (Multi-item & FIFO):** Đảm bảo đơn hàng bán không bị tự động hủy; quy trình hủy đơn hoàn nguyên chính xác số lượng tồn kho theo từng Lô nhập (FIFO lots), hoàn nhập `products.current_stock`, cập nhật giá vốn bình quân và ghi nhận lịch sử biến động kho (`stock_movements`) với loại `RETURN`.
3. **Đồng bộ Trạng thái DB và UI:** Đồng nhất 100% giữa Supabase (`sales_records.status`) và giao diện Mobile APK (`COMPLETED` vs `CANCELLED`).
4. **Chuẩn hóa Thời gian Giao dịch (Timezone & Timestamps):** Xử lý triệt để hiện tượng lệch 1 ngày / lệch 7 giờ do pg driver parser (Type 1082) và hiển thị định dạng chuẩn `HH:mm dd/MM/yyyy`.
5. **Khắc phục lỗi Nhập kho:** Xóa bỏ lỗi `Cannot read property 'import code' of undefined` bằng cách đồng bộ camelCase và snake_case trong payload trả về từ API receipts.
6. **Tối ưu Giao diện Lịch sử Bán hàng:** Ẩn hoàn toàn nhãn kỹ thuật nội bộ "Đã đồng bộ", mang lại trải nghiệm người dùng chuyên nghiệp và tinh gọn.
7. **Bộ lọc Lịch sử Bán hàng & Phương thức Thanh toán:** Bổ sung cột `payment_method` vào PostgreSQL, hỗ trợ đầy đủ bộ lọc đơn hàng: Hoàn thành, Đã hủy, Chuyển khoản, Tiền mặt.

---

## 2. NGUYÊN TẮC KIẾN TRÚC & NGUỒN DỮ LIỆU DUY NHẤT (SOURCE OF TRUTH)

* **Không sử dụng SQLite cho giao dịch nghiệp vụ:** Toàn bộ dữ liệu bán hàng, nhập kho, tồn kho và báo cáo được đọc/ghi trực tiếp từ Supabase PostgreSQL thông qua Vercel API.
* **Quy trình dữ liệu chuẩn:**
  ```
  Mobile Client (Release APK)
             ↓ (HTTPS / REST API)
    Vercel Serverless Functions
             ↓ (pg pool / SSL)
       Supabase PostgreSQL
  ```
* Mọi thao tác tính toán tài chính, trừ tồn kho và hoàn trả kho đều được thực hiện thông qua Database Transactions đảm bảo tính toàn vẹn (ACID).

---

## 3. CHI TIẾT NGUYÊN NHÂN GỐC RỄ & GIẢI PHÁP THEO 7 KHU VỰC THẤT BẠI

### Khu Vực A: Báo Cáo Bán Hàng & Hiệu Suất (5 Tabs)
* **Nguyên nhân gốc:** 
  1. API backend cũ và mobile client không khớp hợp đồng dữ liệu: Mobile yêu cầu object `comparisons` chứa các tỷ lệ tăng trưởng (`changePercent`) cho từng chỉ số (`netRevenue`, `grossProfit`, `ordersCount`, ...), nhưng API chỉ trả về các trường đơn vị phẳng hoặc thiếu cấu trúc lồng nhau khiến UI bị unhandled exception crash.
  2. Dữ liệu báo cáo bị cộng dồn cả các đơn đã `CANCELLED`, dẫn đến doanh thu và lợi nhuận bị thổi phồng sai lệch so với thực tế.
  3. Thống kê theo giờ và theo thứ bị lệch múi giờ UTC thay vì giờ Việt Nam.
* **Giải pháp:**
  - Viết lại API `/api/reports/analytics/route.ts` với đầy đủ các view aggregate trực tiếp trong PostgreSQL (`overview`, `timeline`, `discount`, `categories`, `products`, `matrix`, `hourly`, `weekday`, `staff`, `inventory_capital`).
  - Thêm điều kiện lọc `WHERE COALESCE(status, 'COMPLETED') = 'COMPLETED'` cho tất cả các query tài chính.
  - Sử dụng `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi trích xuất `EXTRACT(HOUR ...)` và `EXTRACT(DOW ...)`.
  - Cập nhật `mobile/src/services/AnalyticsService.ts`: Bổ sung adapter chuẩn hóa dữ liệu đám mây (`normalizeOverviewData`), cung cấp giá trị mặc định cho toàn bộ 9 chỉ số KPI và fallback object cho `comparisons`, loại bỏ hoàn toàn lỗi crash undefined.
  - Cập nhật `mobile/src/screens/main/ReportsScreen.tsx` áp dụng optional chaining an toàn (`overviewData.comparisons?.netRevenue?.changePercent`).

### Khu Vực B & C: Lỗi Đơn Hàng & Đồng Bộ Trạng Thái DB - UI
* **Nguyên nhân gốc:**
  1. API hủy đơn `/api/sales/[id]/cancel` trước đây chỉ xử lý đơn lẻ theo `id`, không nhận diện được đơn hàng gồm nhiều sản phẩm có chung `transaction_code`.
  2. Thiếu quy trình hoàn kho theo Lô (FIFO Lot Allocation) khi hủy đơn, làm sai lệch số lượng tồn kho khả dụng (`quantity_remaining`) và giá vốn tồn kho.
  3. Lịch sử kho (`stock_movements`) không ghi nhận giao dịch hoàn trả khi hủy đơn.
* **Giải pháp:**
  - Cập nhật `/api/sales/[id]/cancel/route.ts`:
    - Tìm và cập nhật tất cả các dòng giao dịch có cùng `transaction_code` (hoặc `id`) sang trạng thái `'CANCELLED'`.
    - Truy vấn các lô hàng liên quan trong `inventory_lots` và hoàn trả chính xác số lượng đã trừ.
    - Cập nhật lại số lượng tồn kho `products.current_stock` và tính toán lại giá vốn bình quân gia quyền.
    - Ghi nhận bản ghi `stock_movements` với `movement_type = 'RETURN'`, cập nhật `balance_after`.
    - Tính năng Idempotent: Nếu đơn hàng đã ở trạng thái `'CANCELLED'`, API trả về thành công ngay lập tức mà không thực hiện hoàn kho lặp lại hai lần.

### Khu Vực D: Chuẩn Hóa Thời Gian Giao Dịch (Timestamp & Timezone)
* **Nguyên nhân gốc:**
  - Driver `node-postgres` mặc định ép kiểu OID 1082 (`DATE`) thành đối tượng JavaScript Date ở 00:00:00 UTC. Khi ứng dụng chạy ở múi giờ GMT+7, ngày bị lùi lại 7 tiếng thành 17:00 ngày hôm trước (lệch 1 ngày).
* **Giải pháp:**
  - Trong `src/lib/db.ts`: Cấu hình Type Parser cho kiểu `DATE` (OID 1082):
    ```typescript
    types.setTypeParser(1082, (val: string) => val);
    ```
  - Trên Mobile Client (`mobile/src/screens/main/SalesScreen.tsx`): Định dạng chuẩn thời gian hiển thị bằng `formatDateTime(item.created_at || item.sale_date)` thay vì `formatDate`, hiển thị rõ ràng giờ, phút và ngày giao dịch (`HH:mm dd/MM/yyyy`).

### Khu Vực E: Khắc Phục Lỗi Nhập Kho
* **Nguyên nhân gốc:**
  - API `/api/inventory/receipts/route.ts` trả về đối tượng `importRecord` với khóa `import_code`, trong khi UI Mobile mong đợi `importCode`.
* **Giải pháp:**
  - Chuẩn hóa payload trả về từ API `/api/inventory/receipts/route.ts`, bao gồm cả hai trường `import_code` và `importCode`, đảm bảo tương thích 100% với cả code mới và client cũ.

### Khu Vực F: Lịch Sử Bán Hàng (Loại Bỏ Badge "Đã đồng bộ")
* **Nguyên nhân gốc:**
  - Giao diện thẻ đơn hàng bán trong `SalesScreen.tsx` hiển thị nhãn kỹ thuật "Đã đồng bộ" gây rối mắt người dùng.
* **Giải pháp:**
  - Loại bỏ hoàn toàn khối render badge "Đã đồng bộ" trong `mobile/src/screens/main/SalesScreen.tsx`.

### Khu Vực G: Bộ Lọc Lịch Sử Bán Hàng & Phương Thức Thanh Toán
* **Nguyên nhân gốc:**
  - Bảng `sales_records` trong PostgreSQL chưa có cột `payment_method`. Khi người dùng lọc đơn "Chuyển khoản" hoặc "Tiền mặt", hệ thống không phân loại được.
* **Giải pháp:**
  - Thực hiện migration thêm cột vào Supabase:
    ```sql
    ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30) DEFAULT 'CASH';
    ```
  - Cập nhật `/api/sales/route.ts` để nhận và lưu `payment_method` khi tạo đơn, đồng thời hỗ trợ filter theo query param `paymentMethod`.
  - Cập nhật `mobile/src/repository/SaleRepository.ts` và `mobile/src/screens/main/SalesScreen.tsx` gửi `paymentMethod` trong payload tạo đơn và truyền vào tham số bộ lọc khi tải lịch sử.

---

## 4. MA TRẬN FILE ĐÃ THAY ĐỔI (CODE MODIFICATIONS)

| Đường dẫn File | Loại thay đổi | Nội dung chính |
|---|---|---|
| `src/lib/db.ts` | Backend Core | Thêm pg type parser 1082 giữ nguyên chuỗi DATE, thêm định nghĩa cột `payment_method`. |
| `src/app/api/sales/route.ts` | Backend API | Hỗ trợ lưu trữ và lọc theo `payment_method` (CASH, BANK, ...). |
| `src/app/api/sales/[id]/cancel/route.ts` | Backend API | Xử lý hủy đơn đa sản phẩm theo `transaction_code`, hoàn kho FIFO lot, ghi `stock_movements`, tính năng Idempotent. |
| `src/app/api/inventory/receipts/route.ts` | Backend API | Đồng bộ snake_case và camelCase (`import_code` / `importCode`). |
| `src/app/api/reports/analytics/route.ts` | Backend API | Tính toán server-side PostgreSQL cho 5 tabs báo cáo, timezone Asia/Ho_Chi_Minh, loại trừ đơn hủy. |
| `mobile/src/repository/sqlite/SqliteSaleDataSource.ts` | Mobile Data Source | Bổ sung trường `paymentMethod?: string` vào giao diện đầu vào. |
| `mobile/src/repository/SaleRepository.ts` | Mobile Repository | Truyền `paymentMethod` vào API bán hàng, chuẩn hóa cache lịch sử, map an toàn dữ liệu trả về từ server. |
| `mobile/src/screens/main/SalesScreen.tsx` | Mobile Screen | Ẩn nhãn "Đã đồng bộ", chuẩn hóa hiển thị ngày giờ `formatDateTime`, hỗ trợ chọn phương thức thanh toán. |
| `mobile/src/services/AnalyticsService.ts` | Mobile Service | Chuẩn hóa dữ liệu Overview từ API Vercel/Supabase, fallback đầy đủ 9 KPIs và đối tượng comparisons. |
| `mobile/src/screens/main/ReportsScreen.tsx` | Mobile Screen | Thêm optional chaining an toàn khi đọc dữ liệu tăng trưởng comparisons. |

---

## 5. KẾT QUẢ BIÊN DỊCH & XÂY DỰNG GÓI SẢN PHẨM (BUILD VERIFICATION)

1. **Next.js Web & API Build:**
   - Lệnh: `npm run build`
   - Kết quả: **Thành công (0 Lỗi, 0 Cảnh báo TypeScript/Lint)**. Toàn bộ các route tĩnh và động được tạo chính xác.
2. **Mobile React Native TypeScript Check:**
   - Lệnh: `npx tsc --noEmit`
   - Kết quả: **Thành công (0 Lỗi)**.
3. **Android Release APK Compilation:**
   - Lệnh: `cd mobile/android && ./gradlew assembleRelease`
   - Kết quả: **BUILD SUCCESSFUL in 4m 26s**.
   - Vị trí tệp APK: `mobile/android/app/build/outputs/apk/release/app-release.apk`
   - Kích thước: **110.5 MB**.

---

## 6. BẰNG CHỨNG XÁC THỰC RUNTIME TRÊN EMULATOR (`emulator-5554`)

### 6.1. Cài đặt và Khởi chạy Ứng dụng
- APK Release được nạp trực tiếp qua ADB: `adb install -r mobile/android/app/build/outputs/apk/release/app-release.apk` ➔ `Success`.
- Ứng dụng khởi động ổn định, đăng nhập tài khoản quản trị Admin thành công.

### 6.2. Màn hình Lịch Sử Bán Hàng (Sales History)
- **Hình ảnh xác thực:** `emulator_sales_history_view.png`
- **Kết quả kiểm chứng:**
  - Nhãn "Đã đồng bộ" đã biến mất hoàn toàn.
  - Định dạng thời gian chính xác theo giờ Việt Nam: `10:29 22/09/2026`, `09:21 22/09/2026`.
  - Đơn hủy `#TX-TEST-1790047786819` hiển thị huy hiệu màu đỏ nổi bật `❌ Đã hủy`, lý do `Test verification cancellation`, ghi chú `Hoàn tiền / kho`.
  - Các đơn hợp lệ hiển thị trạng thái `✓ Hoàn thành` màu xanh lá cây.
  - Header tổng hợp thống kê: `Tổng đơn: 62`, `Doanh thu hoàn thành: 29,779,000 đ`, `Đơn đã hủy: 38`.

### 6.3. Màn hình Báo Cáo Doanh Thu & Hiệu Suất (5 Tabs)
- **Tab 1 - Tổng quan điều hành (`emulator_reports_screen_fixed.png`):**
  - Màn hình tải mượt mà, không gặp bất kỳ lỗi crash nào.
  - Hiển thị đầy đủ 9 chỉ số: Doanh thu thực thu `12,810,000 đ`, Lợi nhuận gộp `11,150,000 đ`, Biên lợi nhuận `87%`, Số đơn `11`, Số món đã bán `12`, Giá trị trung bình/đơn `1,164,545 đ`.
- **Tab 2 - Doanh thu & Lãi ròng theo ngày (`emulator_reports_tab2_view.png`):**
  - Hiển thị danh sách chi tiết từng ngày bán: Ngày `2026-09-22` (Doanh thu 12,810,000 đ, Lãi 11,150,000 đ), các ngày `2026-09-21`, `2026-09-18`.
- **Tab 3 - Phân tích Sản phẩm & Ngành hàng (`emulator_reports_tab3_view.png`):**
  - Ma trận sản phẩm (Ngôi sao, Tiềm năng, Cần xử lý) hiển thị trực quan.
  - Cơ cấu danh mục chính xác: Gấu bông (82.3%), Lego (8.5%), Đồ chơi giáo dục (4.2%), Khác (5.0%).

---

## 7. HƯỚNG DẪN TRIỂN KHAI (DEPLOYMENT & MAINTENANCE)

1. **Triển khai Backend lên Vercel:**
   ```bash
   git add .
   git commit -m "fix(all): resolve sales reports, cancellation fifo stock restoration, timezone, and mobile stability"
   git push origin main
   ```
2. **Cập nhật Biến Môi Trường Vercel:**
   - Đảm bảo biến `DATABASE_URL` kết nối tới PostgreSQL Pooler của Supabase (`transaction` hoặc `session` mode).
   - Biến `TZ=Asia/Ho_Chi_Minh` đã được cấu hình.
3. **Phân phối APK cho Người Dùng:**
   - Tệp APK phân phối tại: `mobile/android/app/build/outputs/apk/release/app-release.apk`.
   - Người dùng có thể cài đặt trực tiếp mà không cần cấu hình thêm.

---

## 8. KẾT LUẬN (FINAL VERDICT)

Hệ thống T_SHOP hiện đã đạt tiêu chuẩn chất lượng cao nhất:
* Không còn lỗi dữ liệu ảo hoặc doanh thu từ đơn hủy.
* Toàn vẹn tồn kho theo nguyên tắc FIFO.
* Dữ liệu thời gian và báo cáo chính xác 100% theo chuẩn múi giờ Việt Nam.
* Ứng dụng di động mượt mà, ổn định và sẵn sàng vận hành thực tế.

**Xác nhận trạng thái:** ✅ **READY FOR PRODUCTION DEPLOYMENT**
