# T_SHOP — PHASE 10 REPORTING REPORT
## Managerial Reporting Suite, Top Sellers, & Slow-Moving Stock Analysis

**Dự án**: T_SHOP Mobile Offline-First  
**Phase**: 10 — REPORTING  
**Tài liệu tham chiếu**: `src/app/api/reports/` & `src/app/reports/`

---

## 1. MỤC TIÊU PHÂN HỆ BÁO CÁO

Phân hệ Báo cáo chuyên sâu cung cấp các góc nhìn phân tích đa chiều phục vụ quyết định nhập hàng, thanh lý, và đánh giá hiệu quả sản phẩm:
1. **Báo cáo Bán hàng theo ngày (Sales by Date)**: Theo dõi tiến độ doanh thu, chi phí giá vốn, lợi nhuận gộp và số đơn hàng theo từng ngày trong chu kỳ.
2. **Báo cáo Sản phẩm Bán chạy nhất (Top Selling Products)**: Nhận diện "ngôi sao" doanh số của cửa hàng để lên kế hoạch nhập hàng ưu tiên.
3. **Báo cáo Hàng tồn kho Chậm luân chuyển (Slow Moving / Dead Stock)**: Nhận diện các mặt hàng có tồn đọng lâu ngày không phát sinh đơn bán để có phương án xả hàng hoặc khuyến mãi.
4. **Xem chi tiết đa chiều (Detail Modal)**: Cho phép chạm vào bất kỳ dòng nào để xem chi tiết đầy đủ của sản phẩm hoặc ngày bán đó.

---

## 2. TRIỂN KHAI 3 TAB BÁO CÁO CHUYÊN SÂU (`ReportsScreen.tsx`)

### 2.1. Tab 1: Bán hàng theo ngày (`Sales by Date`)
* **Truy vấn SQLite**:
  ```sql
  SELECT 
    strftime('%Y-%m-%d', sale_date) as date,
    COUNT(DISTINCT transaction_code) as order_count,
    SUM(quantity) as units_sold,
    SUM(total_revenue) as total_revenue,
    SUM(total_cost) as total_cost,
    SUM(profit) as gross_profit
  FROM sales_records
  WHERE status = 'COMPLETED' AND [date_filter]
  GROUP BY strftime('%Y-%m-%d', sale_date)
  ORDER BY date DESC
  ```
* **Hiển thị**: Mỗi dòng hiển thị ngày bán, số đơn, số lượng đã bán, tổng doanh thu và lãi gộp nổi bật màu xanh lá kèm biên lợi nhuận (%).

### 2.2. Tab 2: Sản phẩm Bán chạy nhất (`Top Selling`)
* **Truy vấn SQLite**:
  ```sql
  SELECT 
    p.id as product_id,
    p.name as product_name,
    p.sku,
    SUM(s.quantity) as total_quantity,
    SUM(s.total_revenue) as total_revenue,
    SUM(s.profit) as total_profit
  FROM sales_records s
  JOIN products p ON s.product_id = p.id
  WHERE s.status = 'COMPLETED' AND [date_filter]
  GROUP BY p.id, p.name, p.sku
  ORDER BY total_revenue DESC
  LIMIT ?
  ```
* **Hiển thị**: Huy hiệu xếp hạng (Top 1, 2, 3), tên sản phẩm, SKU, số lượng bán, doanh thu, lợi nhuận gộp và tỷ lệ phần trăm đóng góp doanh thu của sản phẩm đó.

### 2.3. Tab 3: Hàng tồn kho Chậm luân chuyển (`Slow Moving`)
* **Nguyên tắc phát hiện**: Sản phẩm có `current_stock > 0` nhưng không phát sinh bất kỳ lượt bán nào trong khoảng thời gian đã chọn (hoặc lượt bán rất thấp).
* **Truy vấn SQLite**:
  ```sql
  SELECT 
    p.id as product_id,
    p.name as product_name,
    p.sku,
    p.current_stock,
    p.current_cost_price,
    (p.current_stock * p.current_cost_price) as tied_up_capital,
    MAX(s.sale_date) as last_sold_date
  FROM products p
  LEFT JOIN sales_records s ON p.id = s.product_id AND s.status = 'COMPLETED'
  WHERE p.status = 'ACTIVE' AND p.current_stock > 0
  GROUP BY p.id, p.name, p.sku, p.current_stock, p.current_cost_price
  ORDER BY tied_up_capital DESC
  LIMIT ?
  ```
* **Hiển thị**: Tên sản phẩm, số lượng tồn đọng, vốn đọng trong kho (`tied_up_capital`), ngày bán gần nhất hoặc huy hiệu `Chưa từng bán`.

---

## 3. MODAL CHI TIẾT TƯƠNG TÁC (INTERACTIVE DRILL-DOWN MODAL)

Khi người dùng nhấn vào một dòng bất kỳ trên cả 3 tab:
* Modal chi tiết hiển thị toàn bộ thuộc tính của bản ghi đó.
* Đối với sản phẩm: Hiển thị SKU, Giá bán niêm yết, Giá vốn bình quân, Doanh thu, Lợi nhuận gộp thu về, Số lượng tồn hiện tại, Giá trị vốn đang đọng trong kho.
* Giúp người dùng đưa ra quyết định mà không cần rời màn hình báo cáo.

---

## 4. KẾT LUẬN

Phân hệ Báo cáo Phase 10 đem lại năng lực phân tích dữ liệu quản trị chuẩn xác, tốc độ cao, hoạt động 100% offline và giải quyết bài toán luân chuyển hàng hóa thực tế của cửa hàng bán lẻ.
