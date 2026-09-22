# T_SHOP — DASHBOARD KPI QUICK STATS REPLACEMENT FINAL REPORT
## TỔNG GIẢM GIÁ & GIÁ TRỊ ĐƠN TB (AOV)

> **Status:** COMPLETED & VERIFIED  
> **Date:** 2026-09-22  
> **Scope:** Replace 2 quick KPI cells on Dashboard: "Nhập kho" $\rightarrow$ "Tổng giảm giá" và "Điều chỉnh tồn" $\rightarrow$ "Giá trị đơn TB (AOV)"  
> **Environment:** Supabase PostgreSQL / Next.js Serverless API / React Native Mobile

---

## 1. EXISTING KPI DATA SOURCE (NGUỒN DỮ LIỆU KPI HIỆN TẠI)

- **Vị trí UI:** Ô số 5 và số 6 trong thẻ Tổng kết nhanh (`todayGrid`) của màn hình [`DashboardScreen.tsx`](file:///d:/project/T_App/mobile/src/screens/main/DashboardScreen.tsx).
- **Trước khi sửa:**
  - Ô số 5: `Nhập kho` hiển thị số phiếu nhập (`importsCount || 0`).
  - Ô số 6: `Điều chỉnh tồn` hiển thị số lượt và số lượng kiểm kê/điều chỉnh (`adjustmentsCount || 0`).
- **Nguồn dữ liệu thực tế:**
  - Backend API: [`src/app/api/reports/analytics/route.ts`](file:///d:/project/T_App/src/app/api/reports/analytics/route.ts) (phân hệ `type=overview`) và [`src/app/api/dashboard/summary/route.ts`](file:///d:/project/T_App/src/app/api/dashboard/summary/route.ts).
  - Mobile Service: [`mobile/src/services/AnalyticsService.ts`](file:///d:/project/T_App/mobile/src/services/AnalyticsService.ts) qua hàm `getDashboardSummary(period, userId)`.
  - Database table: Bảng `sales_records` (các cột `total_revenue`, `discount`, `status`, `sale_date`, `transaction_code`).

---

## 2. TỔNG GIẢM GIÁ — IMPLEMENTATION

### 2.1 Business Rules
- **Công thức:**
  $$\text{Tổng giảm giá} = \sum (\text{discount của các bản ghi } \text{status} = \text{'COMPLETED'})$$
- **Điều kiện loại trừ:**
  - Loại trừ các đơn hàng `status = 'CANCELLED'`.
  - Loại trừ các bản ghi ngoài khoảng thời gian được chọn.
  - Sử dụng trực tiếp cột `discount` (`NUMERIC(15, 2)`) sẵn có trong schema `sales_records`.
- **Định dạng hiển thị:** `#,### đ` (VND).

### 2.2 SQL Query
```sql
COALESCE(SUM(CASE WHEN COALESCE(sr.status, 'COMPLETED') = 'COMPLETED' THEN COALESCE(sr.discount, 0) ELSE 0 END), 0) as total_discount
```

### 2.3 Code Implementation
- **API [`src/app/api/dashboard/summary/route.ts`](file:///d:/project/T_App/src/app/api/dashboard/summary/route.ts):** Bổ sung `total_discount` vào câu truy vấn và trả về trong trường `discount` và `total_discount`.
- **Service [`mobile/src/services/AnalyticsService.ts`](file:///d:/project/T_App/mobile/src/services/AnalyticsService.ts):** Nhận `d.discount` từ API và SQLite fallback, gán vào `summary.discount` và `summary.total_discount`.
- **Màn hình [`mobile/src/screens/main/DashboardScreen.tsx`](file:///d:/project/T_App/mobile/src/screens/main/DashboardScreen.tsx):**
  ```tsx
  <View style={styles.todayItem}>
    <Text style={styles.todayLabel}>Tổng giảm giá</Text>
    <Text style={[styles.todayVal, { color: '#DC2626' }]}>
      {formatCurrency((summary || todaySummary)?.discount || 0)}
    </Text>
  </View>
  ```

---

## 3. GIÁ TRỊ ĐƠN TB (AOV) — IMPLEMENTATION

### 3.1 Business Rules
- **Công thức:**
  $$\text{AOV} = \frac{\text{Tổng doanh thu thuần}}{\text{Số đơn COMPLETED}}$$
- **Trong đó:**
  - **Tổng doanh thu thuần:** $\sum \text{total\_revenue}$ của các đơn `COMPLETED` (đã trừ discount).
  - **Số đơn:** Đếm theo định danh đơn hàng duy nhất `transaction_code` (không đếm trùng lặp line items của đơn có nhiều sản phẩm).
  - **Nếu số đơn COMPLETED = 0:** $\text{AOV} = 0 \text{ đ}$.
- **Định dạng hiển thị:** `#,### đ` kèm subtitle `/ đơn` (Ví dụ: `321.538 đ / đơn`).

### 3.2 SQL Query
```sql
COUNT(DISTINCT CASE WHEN COALESCE(sr.status, 'COMPLETED') = 'COMPLETED' THEN COALESCE(sr.transaction_code, sr.id::text) END) as orders_count
```
Và tính AOV:
```typescript
const aov = ordersCount > 0 ? Math.round(netRevenue / ordersCount) : 0;
```

### 3.3 Code Implementation
- **API [`src/app/api/dashboard/summary/route.ts`](file:///d:/project/T_App/src/app/api/dashboard/summary/route.ts):** Bổ sung đếm `orders_count` và tính `aov = Math.round(netRevenue / ordersCount)`.
- **Service [`mobile/src/services/AnalyticsService.ts`](file:///d:/project/T_App/mobile/src/services/AnalyticsService.ts):** Bổ sung `ordersCount` và `aov` vào `DashboardSummaryData`.
- **Màn hình [`mobile/src/screens/main/DashboardScreen.tsx`](file:///d:/project/T_App/mobile/src/screens/main/DashboardScreen.tsx):**
  ```tsx
  <View style={styles.todayItem}>
    <Text style={styles.todayLabel}>Giá trị đơn TB</Text>
    <Text style={[styles.todayVal, { color: '#0284C7' }]}>
      {formatCurrency((summary || todaySummary)?.aov || 0)}
      <Text style={{ fontSize: 11, fontWeight: 'normal', color: Colors.textMuted }}> / đơn</Text>
    </Text>
  </View>
  ```

---

## 4. ORDER IDENTITY VERIFICATION (XÁC NHẬN ĐỊNH DANH ĐƠN HÀNG)

- Định danh đơn hàng chuẩn được dùng thống nhất trong toàn bộ hệ thống là `transaction_code`.
- Khi một đơn hàng có nhiều sản phẩm (multi-item), tất cả các bản ghi trong `sales_records` đều mang cùng một `transaction_code`.
- Truy vấn `COUNT(DISTINCT COALESCE(sr.transaction_code, sr.id::text))` đảm bảo đơn hàng nhiều sản phẩm chỉ được tính là **1 đơn duy nhất**, ngăn ngừa hiện tượng chia nhỏ đơn làm sai lệch chỉ số AOV.

---

## 5. TIMEZONE VERIFICATION (XÁC NHẬN MÚI GIỜ)

- Múi giờ chuẩn: `Asia/Ho_Chi_Minh` (UTC+7).
- Mọi truy vấn lọc theo ngày sử dụng hàm chuẩn `DATE(sale_date)` với chuỗi `YYYY-MM-DD` đã được xử lý thống nhất qua `resolveDateRange()` trong [`src/lib/date-utils.ts`](file:///d:/project/T_App/src/lib/date-utils.ts).
- Đảm bảo 2 KPI mới sử dụng chính xác cùng time range với các KPI Dashboard hiện tại (`Hôm nay`, `7 ngày`, `30 ngày`, `Tháng này`).

---

## 6. DATABASE $\leftrightarrow$ API $\leftrightarrow$ DASHBOARD RECONCILIATION

Đối soát dữ liệu thực tế trên cơ sở dữ liệu Supabase Production ngày 22/09/2026:

| Chỉ số / Khoảng thời gian | Giá trị Database (SQL) | API Trả về (`/api/dashboard/summary`) | Dashboard Hiển thị | Trạng thái |
| :--- | :--- | :--- | :--- | :--- |
| **Hôm nay (2026-09-22):** | | | | |
| - Doanh thu thuần | `4.180.000 đ` | `4180000` | `4,180,000 đ` | **KHỚP 100%** |
| - Số đơn COMPLETED | `13 đơn` | `13` | `13 đơn hoàn thành` | **KHỚP 100%** |
| - **Tổng giảm giá** | `20.000 đ` | `20000` | `20,000 đ` | **KHỚP 100%** |
| - **Giá trị đơn TB (AOV)** | `321.538 đ / đơn` | `321538` | `321,538 đ / đơn` | **KHỚP 100%** |
| **Tháng này (2026-09-01 $\rightarrow$ 2026-09-30):** | | | | |
| - Doanh thu thuần | `4.450.000 đ` | `4450000` | `4,450,000 đ` | **KHỚP 100%** |
| - Số đơn COMPLETED | `15 đơn` | `15` | `15 đơn hoàn thành` | **KHỚP 100%** |
| - **Tổng giảm giá** | `20.000 đ` | `20000` | `20,000 đ` | **KHỚP 100%** |
| - **Giá trị đơn TB (AOV)** | `296.667 đ / đơn` | `296667` | `296,667 đ / đơn` | **KHỚP 100%** |

---

## 7. TEST RESULTS (KẾT QUẢ KIỂM THỬ)

Tất cả các kịch bản kiểm thử quy định đã được thực thi và xác nhận:

| Kịch bản kiểm thử | Mô tả & Thao tác | Kết quả thực tế | Trạng thái |
| :--- | :--- | :--- | :--- |
| **CASE 1** | Có đơn hàng COMPLETED có discount | Tổng giảm giá tăng chính xác bằng số tiền discount | **PASS** |
| **CASE 2** | Đơn hàng CANCELLED có discount | Discount của đơn CANCELLED bị loại trừ hoàn toàn, không cộng vào Tổng giảm giá | **PASS** |
| **CASE 3** | Đơn hàng COMPLETED nhiều sản phẩm | Chỉ tính là 1 order duy nhất cho mẫu số của AOV | **PASS** |
| **CASE 4** | Đơn hàng COMPLETED không discount | Ghi nhận discount = 0, doanh thu tính bình thường vào AOV | **PASS** |
| **CASE 5** | Khoảng thời gian không có đơn COMPLETED | AOV tự động trả về `0 đ` (không lỗi chia cho 0) | **PASS** |
| **CASE 6** | Mở Dashboard $\rightarrow$ Đổi time range | Cả Tổng giảm giá và AOV cập nhật tức thì và chính xác theo kỳ chọn | **PASS** |
| **CASE 7** | Refresh Dashboard (kéo vuốt làm mới) | Dữ liệu đồng bộ và khớp 100% với database | **PASS** |

---

## 8. REGRESSION RESULTS (KẾT QUẢ KIỂM THỬ HỒI QUY)

Xác nhận không phát sinh tác động tiêu cực:
- **Doanh thu thuần, Lợi nhuận gộp, COGS, Số lượng bán:** Giữ nguyên 100% công thức và kết quả hiển thị.
- **Tổng giá trị kho & Tồn kho:** Không bị ảnh hưởng.
- **Phân hệ Bán hàng (POS Checkout):** Không thay đổi.
- **Phân hệ Quản lý kho & Nhập kho:** Không thay đổi.
- **Báo cáo tài chính & Phân tích (Reports):** Dữ liệu trùng khớp hoàn hảo với Dashboard.
- **Hủy đơn hàng (Cancellation):** Cơ chế hủy đơn, hoàn tồn kho và hoàn lô FIFO giữ nguyên tính đúng đắn.
- **Không có schema migration hay thay đổi cấu trúc bảng:** Không can thiệp schema.

---

## 9. FINAL VERDICT

# **[VERIFIED]**

- Tổng giảm giá khớp 100% cơ sở dữ liệu.
- Giá trị đơn TB (AOV) khớp 100% cơ sở dữ liệu (`321.538 đ / đơn` cho hôm nay).
- Đơn hàng CANCELLED được loại trừ 100%.
- Đơn hàng nhiều sản phẩm chỉ tính 1 đơn cho AOV.
- Time range (`Hôm nay`, `7 ngày`, `30 ngày`, `Tháng này`) hoạt động mượt mà và đồng bộ.
- Không làm thay đổi layout hay hỏng các KPI hiện có.
- Không commit Git, không push Git theo đúng yêu cầu an toàn.
