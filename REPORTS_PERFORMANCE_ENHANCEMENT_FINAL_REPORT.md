# T_SHOP — REPORTS & PERFORMANCE ENHANCEMENT FINAL REPORT

**Author / Role:** Senior Mobile Architect + Retail Business Analyst + QA Lead  
**Module:** Báo cáo & Hiệu suất (Reports & Performance)  
**Execution Environment:** Mobile React Native / Expo (Offline SQLite First)  
**Date:** 15/09/2026  
**Status:** **PASS**

---

## 1. Scope
Nhiệm vụ duy nhất được giao là nâng cấp toàn diện module **"BÁO CÁO & HIỆU SUẤT" (Reports & Performance)** trên nền tảng T_SHOP Mobile, phục vụ trực tiếp cho chủ cửa hàng bán lẻ có kinh nghiệm quản lý, giúp giải quyết trọn vẹn 12 câu hỏi kinh doanh cốt lõi:
1. Doanh thu hiện tại là bao nhiêu? (Net Revenue)
2. Thực thu bao nhiêu sau giảm giá? (Revenue Waterfall breakdown)
3. Giá vốn bao nhiêu? (COGS theo FIFO chính xác)
4. Lợi nhuận gộp bao nhiêu? (Gross Profit = Net Revenue - COGS)
5. Margin bao nhiêu? (Gross Margin %)
6. So với kỳ trước tốt hay xấu? (Comparison Engine: % volume/doanh thu & điểm phần trăm cho margin)
7. Sản phẩm nào tạo doanh thu? (Top Revenue ranking & breakdown)
8. Sản phẩm nào tạo lợi nhuận? (Top Profit ranking & breakdown)
9. Sản phẩm nào bán chạy nhưng lợi nhuận thấp? (Cash cows / Ma trận doanh thu × lợi nhuận)
10. Khung giờ/ngày nào bán tốt? (Phân tích theo khung giờ 08-10, 10-12,... và theo thứ T2–CN)
11. Vốn đang nằm ở đâu trong tồn kho? (Cơ cấu vốn theo danh mục & Top 10 sản phẩm chiếm vốn)
12. Có vấn đề bất thường nào cần xử lý? (Hệ thống cảnh báo kinh doanh thông minh tự động)

**Quy tắc bất biến:**
- **Isolated Scope:** Toàn bộ thay đổi bị cô lập trong module Reports & Analytics.
- **Read-Only Analytics:** Báo cáo chỉ đọc dữ liệu từ SQLite, tuyệt đối không thực hiện bất kỳ câu lệnh `INSERT`, `UPDATE`, hay `DELETE` nào trên dữ liệu giao dịch hoặc tồn kho.
- **Zero Business Logic Modification:** Giữ nguyên 100% logic POS, FIFO, COGS, Sales, Inventory, Purchase, Cancellation, Sync, Auth, và Outbox.
- **No Git Commit/Push:** Toàn bộ thay đổi lưu trữ trực tiếp trên local source code.

---

## 2. Baseline
Trước khi thực hiện thay đổi, toàn bộ hiện trạng hệ thống đã được audit chi tiết:
- **ReportsScreen.tsx:** Ban đầu có cấu trúc 3 tab cơ bản (`daily`, `top_selling`, `slow_moving`) với bộ lọc thời gian giới hạn (`today`, `week`, `month`).
- **AnalyticsService.ts:** Đang cung cấp 6 hàm cơ bản phục vụ cả Dashboard và Reports cũ (`getDashboardSummary`, `getRevenueProfitTrend`, `getTopSellingProducts`, `getSlowMovingProducts`, `getSalesByDateReport`, `getLowStockProducts`).
- **DashboardScreen.tsx:** Đang phụ thuộc vào `getDashboardSummary` và `getRevenueProfitTrend`.
- **Database Schema:** SQLite local v9 với các bảng chuẩn: `users`, `categories`, `product_types`, `products`, `sales_orders`, `sales_records`, `suppliers`, `imports`, `import_records`, `inventory_lots`, `stock_movements`, `sale_cost_allocations`, `sync_queue`.
- **Test Suite Hiện Có:** 6 suite tự động (`database.test.mjs`, `phase10_discount.test.mjs`, `phase10_inventory_cost.test.mjs`, `phase11_5_completion.test.mjs`, `phase11_6_sales_cancellation.test.mjs`, `phase11_production.test.mjs`) đang chạy xanh 100%.
- **TypeScript:** Không có lỗi kiểu dữ liệu trước khi thay đổi.

---

## 3. Files Modified
Chỉ có **3 files nguồn** và **1 test file mới** thuộc phạm vi Reports được thay đổi/tạo mới:
1. `mobile/src/services/types.ts`: Bổ sung định nghĩa cho 15 khoảng thời gian (`DatePeriod`) và các DTO thống kê nâng cao (`MetricComparison`, `MarginComparison`, `BusinessAlertItem`, `ReportOverviewData`, `DetailedSalesRowItem`, `DiscountAnalysisData`, `ProductPerformanceItem`, `CategoryPerformanceItem`, `ProfitabilityMatrixData`, `HourlyPerformanceItem`, `WeekdayPerformanceItem`, `StaffPerformanceItem`, `InventoryCapitalData`, `OrderDrilldownItem`, `ProductLotDrilldownItem`).
2. `mobile/src/services/AnalyticsService.ts`: Bổ sung toàn bộ logic tính toán báo cáo chuyên sâu: `resolveDateRange`, `resolvePreviousDateRange`, `getReportOverview`, `getDetailedSalesTimeline`, `getDiscountAnalysis`, `getProductPerformance`, `getCategoryPerformance`, `getProfitabilityMatrix`, `getHourlyPerformance`, `getWeekdayPerformance`, `getStaffPerformance`, `getInventoryCapitalAnalysis`, `getDateOrdersDrilldown`, `getProductLotDrilldown`. Giữ nguyên 100% các hàm cũ của Dashboard.
3. `mobile/src/screens/main/ReportsScreen.tsx`: Viết lại giao diện theo kiến trúc 5 nhóm tab chuẩn, thanh filter thời gian linh hoạt (15 periods), modal chọn ngày custom, hỗ trợ so sánh kỳ, ma trận BCG, biểu đồ phân rã doanh thu, biểu đồ giờ/thứ, và các modal drill-down tương tác.
4. `mobile/tests/phase12_reports_analytics.test.mjs`: Test suite tự động hóa độc lập kiểm tra toàn diện 43 kịch bản tính toán, so sánh, phân tích ma trận, phân quyền, và xử lý biên.

---

## 4. Files NOT Modified
Toàn bộ các file nghiệp vụ cốt lõi khác **tuyệt đối không bị chỉnh sửa** (`OUT OF SCOPE — NOT MODIFIED`):
- `mobile/src/screens/main/DashboardScreen.tsx` (Giữ nguyên giao diện và API gọi của Dashboard)
- `mobile/src/screens/main/SalesScreen.tsx` & `mobile/src/screens/main/PosScreen.tsx` (Nghiệp vụ bán hàng)
- `mobile/src/screens/main/InventoryScreen.tsx` & `mobile/src/screens/main/ProductsScreen.tsx`
- `mobile/src/services/SalesService.ts`, `DiscountEngine.ts`, `FifoCostEngine.ts`, `InventoryService.ts`
- `mobile/src/database/schema.ts`, `mobile/src/database/migrations.ts` (Không đổi schema hay migration)
- `mobile/src/sync/*` (Không đổi PushSyncHandler, PullSyncHandler, SyncEngine)
- `mobile/src/auth/*` (Không đổi AuthService, TokenManager, Session)
- `mobile/src/utils/printer.ts`, `thermalPrinter.ts`

---

## 5. Existing Reports
Hệ thống cũ chỉ cung cấp:
- Báo cáo doanh số theo ngày (doanh thu, lợi nhuận gộp theo từng ngày)
- Top 10 sản phẩm bán chạy theo số lượng
- Top 10 sản phẩm bán chậm (tồn kho > 0 nhưng không phát sinh giao dịch)
- Báo cáo tổng hợp nhanh trên Dashboard (doanh thu hôm nay, lợi nhuận hôm nay, đơn hàng hôm nay, hàng sắp hết)

---

## 6. New Reports
Hệ thống mới gom gọn toàn bộ báo cáo vào **5 nhóm chính** tinh gọn, mạnh mẽ:
1. **TỔNG QUAN (Overview):** Màn hình điều hành tổng thể với 9 KPI trọng yếu, huy hiệu so sánh với kỳ trước, thác nước phân rã doanh thu (Waterfall Breakdown), biểu đồ xu hướng 3 đường (Doanh thu - Giá vốn - Lợi nhuận gộp), và hệ thống Cảnh báo kinh doanh thông minh.
2. **DOANH THU & LÃI (Revenue & Profit):** Dòng thời gian chi tiết theo Ngày / Tuần / Tháng, đi kèm phân tích chiết khấu chuyên sâu, Top sản phẩm bị giảm giá nhiều nhất, và khả năng Drill-down xem toàn bộ hóa đơn trong ngày.
3. **SẢN PHẨM (Product Intelligence):** Bảng xếp hạng sản phẩm đa chiều (Top Doanh thu, Top Lợi nhuận, Top Margin, Top Số lượng, Margin thấp, Bán chậm), Báo cáo hiệu suất theo Danh mục hàng hóa (với tỷ trọng đóng góp doanh thu), và Ma trận Doanh thu × Lợi nhuận BCG 4 góc phần tư.
4. **HIỆU SUẤT (Store Performance):** Phân tích doanh số theo khung giờ bán lẻ thực tế (08-10h, 10-12h, 12-14h, 14-16h, 16-18h, 18-20h, 20-22h), Phân tích doanh số theo thứ trong tuần (T2 đến CN), và Báo cáo hiệu suất từng nhân viên (nếu dữ liệu và quyền hạn cho phép).
5. **TỒN KHO & VỐN (Inventory Capital):** Báo cáo "Tiền đang nằm ở đâu?", định giá tồn kho theo giá vốn và giá bán lẻ, các chỉ số Vòng quay tồn kho (Turnover) và Số ngày tồn kho (Days of Inventory), phân bổ vốn theo danh mục, Top 10 mặt hàng chiếm nhiều vốn nhất, và Drill-down chi tiết từng lô nhập FIFO của sản phẩm.

---

## 7. New KPIs
Cung cấp đầy đủ 9 chỉ số điều hành cốt lõi, được tính toán từ dữ liệu giao dịch hoàn tất (`COMPLETED`):
1. **Gross Sales (Doanh thu gộp):** $\sum (\text{quantity} \times \text{unit\_price\_at\_sale})$
2. **Discount (Tổng chiết khấu):** $\sum (\text{line\_discount})$
3. **Net Revenue (Doanh thu thực thu):** $\text{Gross Sales} - \text{Discount} = \sum (\text{total\_revenue})$
4. **COGS (Giá vốn hàng bán):** $\sum (\text{total\_cost})$ xác định theo FIFO allocation
5. **Gross Profit (Lợi nhuận gộp):** $\text{Net Revenue} - \text{COGS} = \sum (\text{profit})$
6. **Gross Margin (Tỷ suất lợi nhuận gộp):** $(\text{Gross Profit} / \text{Net Revenue}) \times 100$
7. **Completed Orders (Số đơn hàng thành công):** $\text{COUNT(DISTINCT order\_id)}$
8. **Units Sold (Số lượng sản phẩm bán):** $\sum (\text{quantity})$
9. **AOV (Giá trị đơn trung bình):** $\text{Net Revenue} / \text{Completed Orders}$ (an toàn với phép chia cho 0)
10. **Units per Order (Số món/đơn):** $\text{Units Sold} / \text{Completed Orders}$ (an toàn với phép chia cho 0)

---

## 8. Time Filters
Toàn bộ 5 tab dùng chung một bộ lọc thời gian thống nhất gồm **15 tùy chọn**, hỗ trợ đầy đủ giờ địa phương (00:00:00 đến 23:59:59):
- `today`: Hôm nay
- `yesterday`: Hôm qua
- `7days`: 7 ngày qua
- `30days`: 30 ngày qua
- `this_week`: Tuần này (bắt đầu từ Thứ Hai)
- `last_week`: Tuần trước (Thứ Hai đến Chủ Nhật tuần trước)
- `this_month`: Tháng này (từ ngày 1 đến hiện tại)
- `last_month`: Tháng trước (trọn vẹn tháng trước)
- `this_quarter`: Quý này
- `last_quarter`: Quý trước
- `6months`: 6 tháng gần nhất
- `this_year`: Năm nay (từ 01/01 đến nay)
- `last_year`: Năm trước (toàn bộ năm trước)
- `all_time`: Toàn thời gian (truy vấn toàn bộ lịch sử)
- `custom`: Tùy chọn ngày (modal chọn ngày bắt đầu & ngày kết thúc)

---

## 9. Comparison Engine
Cho phép đối chiếu tự động giữa Kỳ hiện tại với Kỳ liền trước cùng độ dài:
- **Tăng / Giảm theo phần trăm (% Growth):** Áp dụng cho Doanh thu, Lợi nhuận gộp, Số đơn hàng, Số lượng bán, và AOV.  
  Công thức: $\frac{\text{Current} - \text{Previous}}{|\text{Previous}|} \times 100\%$
- **Điểm phần trăm (Percentage Points - pp):** Áp dụng **riêng biệt cho Gross Margin** để tránh gây hiểu lầm tai hại trong tài chính bán lẻ.  
  Ví dụ: Margin kỳ trước 40%, kỳ này 42% $\rightarrow$ Hiển thị **+2.00 điểm %**, tuyệt đối không nhầm lẫn với mức tăng trưởng 5%.
- **Trực quan hóa:** Các huy hiệu màu sắc trực quan (Xanh lá `↑` tăng, Đỏ `↓` giảm, Xám `→` không đổi).

---

## 10. Revenue Breakdown
Trình bày phân rã tài chính theo mô hình thác nước (Financial Waterfall Breakdown):
$$\text{Doanh thu trước giảm giá (Gross Sales)}$$
$$\downarrow$$
$$\text{Chiết khấu (- Discount)}$$
$$\downarrow$$
$$\text{Doanh thu thực thu (Net Revenue)}$$
$$\downarrow$$
$$\text{Giá vốn hàng bán (- COGS FIFO)}$$
$$\downarrow$$
$$\text{Lợi nhuận gộp (Gross Profit)}$$
$$\downarrow$$
$$\text{Biên lợi nhuận gộp (Gross Margin \%)}$$
Mô hình hiển thị dạng thẻ thanh lịch, trực quan, có tỷ lệ % chiết khấu trên doanh thu và % margin gộp rõ ràng.

---

## 11. Profitability Analysis
Biểu đồ xu hướng tài chính đa trục:
- Đối với khoảng thời gian ngắn ($\le 31$ ngày): Tự động tổng hợp và vẽ theo từng ngày.
- Đối với khoảng thời gian dài ($> 31$ ngày): Tự động gom nhóm theo tuần hoặc tháng để đảm bảo mượt mà, không bao giờ render hàng nghìn điểm gây giật lag app.
- Trình bày 3 đường chỉ số đồng thời: Doanh thu thực (Xanh dương), Giá vốn COGS (Đỏ cam), Lợi nhuận gộp (Xanh lá).

---

## 12. Product Analysis
Phân tích sâu từng mặt hàng với các nút lọc nhanh:
- **Top Doanh thu (Top Revenue):** Những sản phẩm mang về dòng tiền lớn nhất cho shop.
- **Top Lợi nhuận (Top Profit):** Những sản phẩm tạo ra nhiều tiền lãi nhất.
- **Top Margin %:** Những sản phẩm có tỷ suất lợi nhuận cao nhất.
- **Top Số lượng (Top Units):** Sản phẩm bán ra nhiều chiếc nhất.
- **Margin thấp (Low Margin):** Các sản phẩm có biên lãi gộp dưới 15% cần xem xét giá bán hoặc đàm phán giá nhập.
- **Bán chậm (Slow Moving):** Sản phẩm có tồn kho nhưng không phát sinh bán hàng trong kỳ.
Bảng hiển thị dạng thẻ mobile responsive, gồm: SKU, Tên, Số lượng bán, Doanh thu, Giá vốn, Lợi nhuận gộp, và Margin %.

---

## 13. Category Analysis
Phân tích cơ cấu ngành hàng:
- Thống kê chi tiết từng danh mục: Tên danh mục, Doanh thu thực, Giá vốn COGS, Lợi nhuận gộp, Tỷ suất Margin, và Số lượng đã bán.
- Hiển thị thanh tiến trình trực quan thể hiện **Tỷ trọng đóng góp doanh thu (% Revenue Share)** của từng danh mục trên tổng doanh thu cửa hàng.

---

## 14. Performance Analysis
1. **Phân tích theo khung giờ thực tế (Sales by Hour):**
   - Không giả định mở cửa 24/24, tập trung vào các khung giờ vàng bán lẻ: 08–10h, 10–12h, 12–14h, 14–16h, 16–18h, 18–20h, 20–22h.
   - Thống kê số đơn, doanh thu, lợi nhuận gộp và tỷ trọng cho từng khung giờ, có highlight khung giờ có doanh thu cao nhất.
2. **Phân tích theo thứ trong tuần (Sales by Weekday):**
   - Đầy đủ 7 ngày: Thứ Hai (T2), Thứ Ba (T3), Thứ Tư (T4), Thứ Năm (T5), Thứ Sáu (T6), Thứ Bảy (T7), Chủ Nhật (CN).
   - Giúp chủ shop lên kế hoạch nhân sự và nhập hàng cho những ngày cao điểm.
3. **Hiệu suất nhân viên (Employee Performance):**
   - Tự động kiểm tra quyền hạn và dữ liệu người tạo (`created_by`).
   - Nếu đủ quyền (Admin): Hiển thị bảng tổng hợp từng nhân viên (Số đơn đã chốt, Tổng doanh thu, Lợi nhuận gộp tạo ra, Số sản phẩm bán, AOV).
   - Nếu là nhân viên thông thường (Staff): Giữ nguyên nguyên tắc bảo mật và Account Isolation, chỉ thấy dữ liệu cá nhân.

---

## 15. Discount Analysis
Phân tích toàn diện hiệu quả các chương trình giảm giá:
- Tổng số tiền chiết khấu trong kỳ.
- Tỷ lệ chiết khấu trên doanh thu gộp (% Discount Rate).
- Số đơn hàng có áp dụng giảm giá và tỷ lệ % đơn giảm giá trên tổng số đơn.
- Số tiền chiết khấu trung bình trên mỗi đơn được giảm.
- Top 5 sản phẩm chịu giá trị chiết khấu lớn nhất trong kỳ.

---

## 16. Inventory Capital Analysis
Giải quyết câu hỏi cốt tử của chủ shop: **"Vốn đang nằm ở đâu trong kho?"**
- **Tổng giá trị vốn tồn kho (Cost Value):** $\sum (\text{current\_stock} \times \text{current\_cost\_price})$.
- **Tổng giá trị niêm yết bán lẻ (Retail Valuation):** $\sum (\text{current\_stock} \times \text{current\_selling\_price})$.
- **Tổng số lượng hàng tồn kho (Units in Stock).**
- **Số mặt hàng sắp hết hàng (Low Stock):** Tồn kho $\le \text{min\_stock\_alert}$.
- **Số mặt hàng đã hết hàng (Out of Stock):** Tồn kho $= 0$.
- **Hàng tồn kho chết (Dead Stock):** Sản phẩm còn tồn kho nhưng hoàn toàn không bán được trong 30 ngày qua.
- **Vòng quay tồn kho (Inventory Turnover) & Số ngày tồn kho (Days of Inventory):** Đánh giá tốc độ giải phóng vốn lưu động.
- **Cơ cấu vốn theo Danh mục:** Bảng phân bổ giá trị vốn và tỷ trọng vốn % cho từng nhóm hàng.
- **Top 10 sản phẩm chiếm vốn nhiều nhất:** Liệt kê các sản phẩm đang "giam" nhiều vốn nhất của cửa hàng.

---

## 17. Alerts
Hệ thống Cảnh báo kinh doanh tự động (Business Alerts Engine) đặt ngay tại Tab Tổng quan:
- `⚠ Doanh thu giảm mạnh`: Cảnh báo khi doanh thu giảm trên 15% so với kỳ trước.
- `⚠ Tỷ suất lợi nhuận gộp sụt giảm`: Cảnh báo khi Margin giảm trên 3 điểm phần trăm.
- `⚠ Lạm dụng chiết khấu`: Cảnh báo khi tổng chiết khấu vượt quá 10% doanh thu.
- `⚠ Sản phẩm bán chạy nhưng biên lãi mỏng`: Cảnh báo khi có sản phẩm lọt Top số lượng nhưng Margin $< 10\%$.
- `⚠ Nguy cơ đứt hàng`: Cảnh báo số lượng mặt hàng chạm ngưỡng tồn kho tối thiểu.
- `⚠ Vốn đọng trong hàng chết`: Cảnh báo giá trị tiền đang nằm trong các mặt hàng không phát sinh doanh số.

---

## 18. Drill-down
Khả năng truy vết dữ liệu chi tiết đa cấp:
1. **Từ Doanh thu ngày $\rightarrow$ Chi tiết đơn hàng:** Bấm vào bất kỳ ngày nào trong bảng doanh thu để mở Modal danh sách đơn hàng hoàn tất của ngày đó (Mã hóa đơn, Thời gian, Hình thức thanh toán, Số tiền, Chiết khấu).
2. **Từ Sản phẩm $\rightarrow$ Chi tiết lô hàng FIFO:** Bấm vào bất kỳ sản phẩm nào trong Báo cáo vốn tồn kho để mở Modal danh sách các lô hàng đang quản lý trong `inventory_lots` (Mã lô, Ngày nhập, Số lượng ban đầu, Số lượng còn lại, Đơn giá vốn).

---

## 19. Offline Behavior
Bảo đảm tính nguyên bản Offline-First của ứng dụng:
- Toàn bộ phép tính tổng hợp chạy 100% trên SQLite local của thiết bị, không phụ thuộc vào kết nối Internet hay máy chủ.
- Hiển thị nhãn **"Dữ liệu Offline"** kèm mốc thời gian cập nhật chính xác (`DD/MM/YYYY HH:mm`).
- Tự động kiểm tra và hiển thị số lượng giao dịch cục bộ đang chờ đồng bộ (`Chưa đồng bộ: X giao dịch`).

---

## 20. Account Isolation
- Toàn bộ các truy vấn báo cáo của nhân viên (Role `STAFF`) đều được tự động gắn bộ lọc `created_by = currentUserId`.
- Nhân viên bán hàng tuyệt đối không thể xem doanh số, lợi nhuận, hoặc đơn hàng của nhân viên khác.
- Tài khoản Quản trị (`ADMIN`) được quyền xem toàn bộ dữ liệu tổng hợp của cửa hàng.

---

## 21. Performance
- **Tối ưu hóa truy vấn:** 100% các phép tính tổng, nhóm, đếm được thực hiện trực tiếp bên trong SQLite engine thông qua `SUM`, `COUNT`, `GROUP BY`, `ORDER BY`, tránh tải hàng nghìn dòng vào RAM của JavaScript.
- **Tránh giật lag:** Tự động điều chỉnh granularity của biểu đồ theo độ dài khoảng thời gian.
- **Bộ nhớ đệm & Lazy load:** Sử dụng `useMemo` và cơ chế render điều kiện theo từng tab đang được chọn.

---

## 22. UI/UX
- Thiết kế giao diện theo phong cách **Professional Retail / POS Business Analytics**, không mang tính chất AI đồ họa giả lập.
- Bố cục responsive hoàn hảo trên cả 3 phân khúc màn hình mobile (Small 360dp, Medium 375-390dp, Large 412dp+), tuyệt đối không bị horizontal overflow.
- Thẻ card tự co giãn, bảng số liệu sử dụng định dạng danh sách card thông minh giúp người dùng dễ dàng thao tác bằng một tay mà không cần xoay ngang máy.

---

## 23. Tests
Xây dựng bộ kiểm thử tự động mới `mobile/tests/phase12_reports_analytics.test.mjs` với **43 test cases** chuyên sâu:
- Kiểm tra tính đúng đắn của Gross Sales, Discount, Net Revenue, COGS, Gross Profit, Margin %.
- Kiểm tra KPI Orders, Units, AOV, Units/Order.
- Kiểm tra tính toán so sánh kỳ: % tăng trưởng và điểm phần trăm (pp) của Margin.
- Kiểm tra 4 góc phần tư của Ma trận BCG (Stars, Cash Cows, Potentials, Need Review).
- Kiểm tra phân tích Danh mục và tỷ trọng doanh thu.
- Kiểm tra khung giờ và thứ trong tuần.
- Kiểm tra hiệu suất nhân viên và cơ chế Account Isolation.
- Kiểm tra định giá vốn tồn kho, hàng sắp hết, và Top sản phẩm chiếm vốn.
- Kiểm tra tính năng Drill-down đơn hàng và lô FIFO.
- Kiểm tra các trường hợp biên: 0 doanh số, 0 đơn hàng, phòng chống lỗi chia cho 0, loại bỏ đơn đã hủy (`CANCELLED`).
- **Kết quả:** `43 PASSED / 0 FAILED`.

---

## 24. Regression
Đã chạy lại toàn bộ 6 test suite nền tảng trước đó cùng với test suite mới:
1. `tests/database.test.mjs`: **PASS**
2. `tests/phase10_discount.test.mjs`: **PASS**
3. `tests/phase10_inventory_cost.test.mjs`: **PASS**
4. `tests/phase11_5_completion.test.mjs`: **PASS**
5. `tests/phase11_6_sales_cancellation.test.mjs`: **PASS** (60/60 PASSED)
6. `tests/phase11_production.test.mjs`: **PASS** (32/32 PASSED)
7. `tests/phase12_reports_analytics.test.mjs`: **PASS** (43/43 PASSED)
- **Tổng cộng:** 100% các bài kiểm tra hồi quy thành công rực rỡ, không có bất kỳ tác động tiêu cực nào tới hệ thống cũ.

---

## 25. Web-Mobile Consistency
- Công thức tính toán tài chính giữa Web và Mobile hoàn toàn đồng nhất:
  - $\text{Line Revenue} = \text{Subtotal} - \text{Discount}$
  - $\text{Line COGS} = \sum (\text{quantity\_taken} \times \text{unit\_cost})$ theo FIFO
  - $\text{Line Profit} = \text{Line Revenue} - \text{Line COGS}$
  - Thuật ngữ tài chính thống nhất sử dụng **Lợi nhuận gộp (Gross Profit)** và **Biên lợi nhuận gộp (Gross Margin)**.

---

## 26. Scope Violations Check
- [x] Không sửa đổi POS / Thu ngân
- [x] Không sửa đổi Sales History hay Sale Cancellation
- [x] Không sửa đổi Inventory / Điều chỉnh kho
- [x] Không sửa đổi Purchase Order / Quản lý đơn mua
- [x] Không sửa đổi FIFO Engine hay COGS Engine
- [x] Không sửa đổi Discount Engine
- [x] Không sửa đổi Sync / Outbox Engine
- [x] Không sửa đổi Auth / Authorization
- [x] Không thay đổi Database Schema / Migrations
- [x] Không thay đổi logic Dashboard cũ
- [x] Không commit hay push mã nguồn lên Git

---

## 27. Known Limitations
- Do hệ thống hiện tại là mô hình bán lẻ tinh gọn chưa có phân hệ hạch toán chi phí mặt bằng, điện nước, và lương nhân viên cố định (OPEX), báo cáo phản ánh chuẩn xác **Lợi nhuận gộp (Gross Profit)** thay vì **Lợi nhuận ròng (Net Profit)**.
- Khi sử dụng bộ lọc "Tùy chọn ngày" (Custom Date Range), nếu người dùng chọn khoảng thời gian vượt quá 2 năm, việc tổng hợp theo ngày sẽ tự động chuyển sang chế độ tổng hợp theo tháng để duy trì tốc độ phản hồi tức thì của thiết bị.

---

## 28. OUT_OF_SCOPE_FINDINGS
- Hệ thống máy in nhiệt hóa đơn (`thermalPrinter.ts`) và mã vạch hoạt động độc lập, không liên quan đến dữ liệu phân tích báo cáo và đã được giữ nguyên vẹn.
- Dịch vụ xuất dữ liệu dùng chung (`ExportService`) hiện đang hỗ trợ xuất bảng tính CSV, việc bổ sung xuất file PDF định dạng hóa đơn đồ họa phức tạp thuộc về giai đoạn nâng cấp UI Export dùng chung sau này (`OUT OF SCOPE — SHARED EXPORT SERVICE`).

---

## 29. Final Gate
- Toàn bộ 36 tiêu chí nghiệm thu khắt khe đã được thỏa mãn 100%.
- TypeScript: `tsc --noEmit` hoàn tất với **0 lỗi**.
- Kiểm thử hồi quy và kiểm thử tính năng mới đạt **100% PASS**.
- Giao diện người dùng trên runtime web demo và mobile đã được xác thực hoạt động trơn tru.

**KẾT LUẬN CUỐI CÙNG:**
$$\mathbf{PASS}$$
$$\text{REPORTS \& PERFORMANCE = PASS}$$
$$\text{OTHER APPLICATION MODULES = UNCHANGED}$$
