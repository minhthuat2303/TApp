# T_SHOP — PHASE 10 COST / PROFIT REPORT
## FIFO COGS, Weighted Average Valuation, & Profit Mechanics

**Dự án**: T_SHOP Mobile Offline-First  
**Phase**: 10 — COST & PROFIT CALCULATION  
**Tài liệu tham chiếu**: `src/app/api/sales/route.ts` & `src/app/api/dashboard/summary/route.ts`

---

## 1. NGUYÊN TẮC TOÁN HỌC & NGHIỆP VỤ CỐT LÕI

Hệ thống T_SHOP áp dụng kết hợp hai phương pháp kế toán kinh điển:
1. **Phương pháp Nhập trước - Xuất trước (FIFO - First In, First Out)**:
   * Dùng để **tính giá vốn hàng bán (Cost of Goods Sold - COGS)** khi phát sinh giao dịch bán hàng.
   * Hàng nhập trước (lô có `purchase_date` cũ nhất và `id` nhỏ nhất) sẽ được ưu tiên trừ kho trước.
2. **Phương pháp Bình quân gia quyền (Weighted Average Cost)**:
   * Dùng để **định giá tồn kho và hiển thị giá vốn tham chiếu** của sản phẩm trên bảng danh mục (`products.current_cost_price`).
   * Công thức:
     $$\text{Weighted Average Cost} = \frac{\sum (\text{quantity\_remaining}_i \times \text{unit\_cost}_i)}{\sum \text{quantity\_remaining}_i}$$

---

## 2. QUY TRÌNH TRỪ KHO & TÍNH COGS BÁN HÀNG FIFO

Khi thực hiện thanh toán đơn hàng (POS Checkout):
1. **Lấy danh sách các lô hàng còn tồn**:
   ```sql
   SELECT * FROM inventory_lots 
   WHERE product_id = ? AND quantity_remaining > 0 
   ORDER BY purchase_date ASC, id ASC
   ```
2. **Duyệt từng lô theo thứ tự FIFO**:
   * Với mỗi lô $i$, số lượng lấy ra: $\text{take} = \min(\text{lot}_i.\text{quantity\_remaining}, \text{remaining\_to\_fulfill})$.
   * Chi phí giá vốn từ lô này: $\text{cost}_i = \text{take} \times \text{lot}_i.\text{unit\_cost}$.
   * Cộng dồn vào tổng giá vốn: $\text{total\_cogs} = \sum \text{cost}_i$.
   * Giảm trừ tồn dư của lô trong database:
     ```sql
     UPDATE inventory_lots 
     SET quantity_remaining = quantity_remaining - ? 
     WHERE id = ?
     ```
   * Giảm $\text{remaining\_to\_fulfill} = \text{remaining\_to\_fulfill} - \text{take}$.
   * Lặp lại cho đến khi $\text{remaining\_to\_fulfill} = 0$.
3. **Tính toán Lợi nhuận gộp (Gross Profit)**:
   $$\text{Total Revenue} = (\text{quantity} \times \text{unit\_price}) - \text{discount}$$
   $$\text{Gross Profit} = \text{Total Revenue} - \text{total\_cogs}$$
   $$\text{Gross Margin \%} = \frac{\text{Gross Profit}}{\text{Total Revenue}} \times 100$$
4. **Lưu trữ vào `sales_records`**:
   * `unit_price_at_sale`: Giá bán thực tế tại thời điểm bán.
   * `cost_price_at_sale`: Giá vốn bình quân của lần xuất bán này ($\text{total\_cogs} / \text{quantity}$).
   * `total_revenue`: Doanh thu dòng hàng sau chiết khấu.
   * `total_cost`: Tổng giá vốn thực tế của dòng hàng ($\text{total\_cogs}$).
   * `profit`: Lợi nhuận gộp thực tế.
5. **Cập nhật lại giá vốn BQGQ tồn kho**:
   * Sau khi các lô cũ bị tiêu thụ một phần hoặc toàn bộ, hệ thống tự động tính lại giá vốn bình quân gia quyền của các lô còn lại và cập nhật vào `products.current_cost_price`.

---

## 3. VÍ DỤ MINH HỌA CHI TIẾT ĐÃ ĐƯỢC TEST

Giả sử sản phẩm *Áo Sơ Mi Trắng*:
* **Lô 1 (ngày 01/09)**: Nhập 10 cái với giá vốn 100,000 đ/cái.
* **Lô 2 (ngày 05/09)**: Nhập 20 cái với giá vốn 160,000 đ/cái.
* **Tổng tồn trước bán**: 30 cái.
* **Giá vốn BQGQ trước bán**: $(10 \times 100,000 + 20 \times 160,000) / 30 = \mathbf{140,000\text{ đ}}$.

**Giao dịch bán 15 cái với giá bán 250,000 đ/cái**:
* Hệ thống trừ FIFO:
  * Trừ hết 10 cái từ Lô 1 @ 100,000 đ = **1,000,000 đ** (Lô 1 hết, còn 0 cái).
  * Trừ tiếp 5 cái từ Lô 2 @ 160,000 đ = **800,000 đ** (Lô 2 còn lại 15 cái).
* **Tổng COGS xuất bán**: $1,000,000 + 800,000 = \mathbf{1,800,000\text{ đ}}$.
* **Đơn giá vốn xuất bán**: $1,800,000 / 15 = \mathbf{120,000\text{ đ}}$.
* **Doanh thu**: $15 \times 250,000 = \mathbf{3,750,000\text{ đ}}$.
* **Lợi nhuận gộp**: $3,750,000 - 1,800,000 = \mathbf{1,950,000\text{ đ}}$ (Biên lãi **52%**).
* **Tồn kho sau bán**: 15 cái (toàn bộ nằm trong Lô 2).
* **Giá vốn BQGQ tồn kho mới**: Lô 2 còn 15 cái @ 160,000 đ $\rightarrow \mathbf{160,000\text{ đ}}$.

---

## 4. KẾT LUẬN

Thuật toán tính giá vốn FIFO và lợi nhuận trên Mobile App hoàn toàn chính xác theo chuẩn kế toán, đồng bộ từng con số với Web App và giúp nhà bán lẻ theo dõi sát sao lợi nhuận thực tế theo từng dòng hàng.
