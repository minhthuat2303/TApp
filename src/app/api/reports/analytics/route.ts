import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveDateRange } from '@/lib/date-utils';

function calculateMetricComp(curr: number, prev: number) {
  const diff = curr - prev;
  const changePercent = prev > 0 ? Math.round(((curr - prev) / prev) * 1000) / 10 : (curr > 0 ? 100 : 0);
  const trend: 'UP' | 'DOWN' | 'FLAT' = diff > 0.01 ? 'UP' : diff < -0.01 ? 'DOWN' : 'FLAT';
  return { current: curr, previous: prev, diff, changePercent, trend };
}

function calculateMarginComp(currProfit: number, currRev: number, prevProfit: number, prevRev: number) {
  const currentMargin = currRev > 0 ? Math.round((currProfit / currRev) * 1000) / 10 : 0;
  const previousMargin = prevRev > 0 ? Math.round((prevProfit / prevRev) * 1000) / 10 : 0;
  const percentagePointsChange = Math.round((currentMargin - previousMargin) * 10) / 10;
  const trend: 'UP' | 'DOWN' | 'FLAT' = percentagePointsChange > 0.05 ? 'UP' : percentagePointsChange < -0.05 ? 'DOWN' : 'FLAT';
  return { currentMargin, previousMargin, percentagePointsChange, trend };
}

function resolvePrevRange(startStr: string, endStr: string) {
  const start = new Date(startStr);
  const end = new Date(endStr);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (diffDays - 1));

  const pad = (n: number) => String(n).padStart(2, '0');
  const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  return {
    startDate: toYMD(prevStart),
    endDate: toYMD(prevEnd),
    label: `Kỳ trước (${toYMD(prevStart)} - ${toYMD(prevEnd)})`
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'overview';
    const period = searchParams.get('period') || 'this_month';
    const customStart = searchParams.get('startDate') || undefined;
    const customEnd = searchParams.get('endDate') || undefined;
    const userIdParam = searchParams.get('userId');
    const userId = userIdParam ? parseInt(userIdParam, 10) : undefined;
    const productIdParam = searchParams.get('productId');
    const targetDate = searchParams.get('date');

    const { startDate, endDate, label } = resolveDateRange(period, customStart, customEnd);
    const prevRange = resolvePrevRange(startDate, endDate);

    // =========================================================================
    // 1. DATE ORDERS DRILLDOWN MODAL
    // =========================================================================
    if (type === 'date_orders') {
      const queryDate = targetDate || startDate;
      const rows = await db.query<any>(`
        SELECT 
          sr.id,
          sr.transaction_code,
          TO_CHAR(sr.sale_date, 'YYYY-MM-DD') as sale_date,
          COALESCE(sr.payment_method, 'CASH') as payment_method,
          sr.quantity,
          sr.total_revenue,
          COALESCE(sr.discount, 0) as discount,
          u.full_name as cashier_name
        FROM sales_records sr
        LEFT JOIN users u ON u.id = sr.created_by
        WHERE DATE(sr.sale_date) = ? AND COALESCE(sr.status, 'COMPLETED') = 'COMPLETED'
        ORDER BY sr.id DESC
      `, [queryDate]);

      const orderMap = new Map<string, any>();
      for (const r of rows) {
        const code = r.transaction_code || `TX-${r.id}`;
        if (!orderMap.has(code)) {
          orderMap.set(code, {
            id: r.id,
            orderCode: code,
            saleDate: r.sale_date,
            finalAmount: Number(r.total_revenue),
            totalDiscount: Number(r.discount || 0),
            totalAmount: Number(r.total_revenue) + Number(r.discount || 0),
            paymentMethod: r.payment_method || 'CASH',
            cashierName: r.cashier_name || 'Thu ngân',
            itemsCount: Number(r.quantity),
          });
        } else {
          const ex = orderMap.get(code)!;
          ex.finalAmount += Number(r.total_revenue);
          ex.totalDiscount += Number(r.discount || 0);
          ex.totalAmount += Number(r.total_revenue) + Number(r.discount || 0);
          ex.itemsCount += Number(r.quantity);
        }
      }

      return NextResponse.json({
        success: true,
        data: Array.from(orderMap.values()),
      });
    }

    // =========================================================================
    // 2. PRODUCT LOTS DRILLDOWN MODAL
    // =========================================================================
    if (type === 'product_lots') {
      const pid = parseInt(productIdParam || '0', 10);
      if (!pid) {
        return NextResponse.json({ success: true, data: [] });
      }

      const lots = await db.query<any>(`
        SELECT 
          id, lot_code, TO_CHAR(purchase_date, 'YYYY-MM-DD') as purchase_date,
          quantity_received, quantity_remaining, unit_cost,
          CASE WHEN quantity_remaining > 0 THEN 'ACTIVE' ELSE 'DEPLETED' END as status
        FROM inventory_lots
        WHERE product_id = ?
        ORDER BY purchase_date DESC, id DESC
      `, [pid]);

      return NextResponse.json({
        success: true,
        data: lots.map(l => ({
          id: Number(l.id),
          lotCode: l.lot_code,
          purchaseDate: l.purchase_date,
          quantityReceived: Number(l.quantity_received),
          quantityRemaining: Number(l.quantity_remaining),
          unitCost: Number(l.unit_cost),
          status: l.status,
        })),
      });
    }

    // =========================================================================
    // 3. STAFF PERFORMANCE (Tab 4)
    // =========================================================================
    if (type === 'staff') {
      const rows = await db.query<any>(`
        SELECT 
          COALESCE(u.id, sr.created_by, 1) as user_id,
          COALESCE(u.username, 'nhanvien_' || COALESCE(sr.created_by, 1)) as username,
          COALESCE(u.full_name, 'Nhân viên ' || COALESCE(sr.created_by, 1)) as full_name,
          COALESCE(u.role, 'STAFF') as role,
          COUNT(DISTINCT COALESCE(sr.transaction_code, sr.id::text)) as orders_count,
          COALESCE(SUM(sr.total_revenue), 0) as net_revenue,
          COALESCE(SUM(sr.profit), 0) as gross_profit,
          COALESCE(SUM(sr.quantity), 0) as units_sold
        FROM sales_records sr
        LEFT JOIN users u ON u.id = sr.created_by
        WHERE DATE(sr.sale_date) >= ? AND DATE(sr.sale_date) <= ? 
          AND COALESCE(sr.status, 'COMPLETED') = 'COMPLETED'
        GROUP BY sr.created_by, u.id, u.username, u.full_name, u.role
        ORDER BY net_revenue DESC
      `, [startDate, endDate]);

      const staff = rows.map((r) => {
        const netRev = Number(r.net_revenue || 0);
        const profit = Number(r.gross_profit || 0);
        const orders = Number(r.orders_count || 0);
        const margin = netRev > 0 ? Math.round((profit / netRev) * 1000) / 10 : 0;
        const aov = orders > 0 ? Math.round(netRev / orders) : 0;

        return {
          userId: Number(r.user_id),
          username: String(r.username),
          fullName: String(r.full_name),
          role: String(r.role),
          ordersCount: orders,
          netRevenue: netRev,
          grossProfit: profit,
          margin,
          unitsSold: Number(r.units_sold || 0),
          aov,
        };
      });

      return NextResponse.json({
        success: true,
        data: { hasData: staff.length > 0, staff },
      });
    }

    // =========================================================================
    // 4. TIMELINE (Tab 2: Daily Sales Breakdown)
    // =========================================================================
    if (type === 'timeline') {
      let sql = `
        SELECT 
          TO_CHAR(sr.sale_date, 'YYYY-MM-DD') as date_str,
          COUNT(DISTINCT COALESCE(sr.transaction_code, sr.id::text)) as orders_count,
          COALESCE(SUM(sr.quantity * sr.unit_price_at_sale), 0) as gross_sales,
          COALESCE(SUM(sr.discount), 0) as discount,
          COALESCE(SUM(sr.total_revenue), 0) as net_revenue,
          COALESCE(SUM(sr.total_cost), 0) as cogs,
          COALESCE(SUM(sr.profit), 0) as gross_profit,
          COALESCE(SUM(sr.quantity), 0) as units_sold
        FROM sales_records sr
        WHERE DATE(sr.sale_date) >= ? AND DATE(sr.sale_date) <= ? 
          AND COALESCE(sr.status, 'COMPLETED') = 'COMPLETED'
      `;
      const params: any[] = [startDate, endDate];
      if (userId !== undefined) {
        sql += ' AND sr.created_by = ?';
        params.push(userId);
      }
      sql += ' GROUP BY TO_CHAR(sr.sale_date, \'YYYY-MM-DD\') ORDER BY date_str ASC';

      const rows = await db.query<any>(sql, params);
      const points = rows.map((r) => {
        const netRev = Number(r.net_revenue || 0);
        const profit = Number(r.gross_profit || 0);
        const orders = Number(r.orders_count || 0);
        const [y, m, d] = String(r.date_str).split('-');
        return {
          timeKey: r.date_str,
          label: `${d}/${m}`,
          grossSales: Number(r.gross_sales || 0),
          discount: Number(r.discount || 0),
          netRevenue: netRev,
          cogs: Number(r.cogs || 0),
          grossProfit: profit,
          margin: netRev > 0 ? Math.round((profit / netRev) * 1000) / 10 : 0,
          ordersCount: orders,
          unitsSold: Number(r.units_sold || 0),
          aov: orders > 0 ? Math.round(netRev / orders) : 0,
        };
      });

      return NextResponse.json({
        success: true,
        data: points,
      });
    }

    // =========================================================================
    // 5. DISCOUNT ANALYSIS (Tab 2: Discount Breakdown)
    // =========================================================================
    if (type === 'discount') {
      const [summaryRow, topRows] = await Promise.all([
        db.queryOne<any>(`
          SELECT 
            COALESCE(SUM(quantity * unit_price_at_sale), 0) as gross_sales,
            COALESCE(SUM(discount), 0) as total_discount,
            COUNT(DISTINCT COALESCE(transaction_code, id::text)) as total_orders,
            COUNT(DISTINCT CASE WHEN discount > 0 THEN COALESCE(transaction_code, id::text) END) as discounted_orders
          FROM sales_records
          WHERE DATE(sale_date) >= ? AND DATE(sale_date) <= ? 
            AND COALESCE(status, 'COMPLETED') = 'COMPLETED'
        `, [startDate, endDate]),
        db.query<any>(`
          SELECT 
            p.id as product_id,
            p.name,
            p.sku,
            COALESCE(SUM(sr.discount), 0) as discount_total,
            COALESCE(SUM(CASE WHEN sr.discount > 0 THEN sr.quantity ELSE 0 END), 0) as units_discounted
          FROM sales_records sr
          JOIN products p ON p.id = sr.product_id
          WHERE DATE(sr.sale_date) >= ? AND DATE(sr.sale_date) <= ? 
            AND COALESCE(sr.status, 'COMPLETED') = 'COMPLETED' 
            AND sr.discount > 0
          GROUP BY p.id, p.name, p.sku
          ORDER BY discount_total DESC
          LIMIT 5
        `, [startDate, endDate])
      ]);

      const grossSales = Number(summaryRow?.gross_sales || 0);
      const totalDiscount = Number(summaryRow?.total_discount || 0);
      const ordersTotalCount = Number(summaryRow?.total_orders || 0);
      const ordersWithDiscountCount = Number(summaryRow?.discounted_orders || 0);
      const discountPercentageOfGross = grossSales > 0 ? Math.round((totalDiscount / grossSales) * 1000) / 10 : 0;
      const avgDiscountPerDiscountedOrder = ordersWithDiscountCount > 0 ? Math.round(totalDiscount / ordersWithDiscountCount) : 0;
      const avgDiscountPerTotalOrder = ordersTotalCount > 0 ? Math.round(totalDiscount / ordersTotalCount) : 0;
      const ordersWithDiscountPercent = ordersTotalCount > 0 ? Math.round((ordersWithDiscountCount / ordersTotalCount) * 1000) / 10 : 0;

      return NextResponse.json({
        success: true,
        data: {
          totalDiscount,
          ordersWithDiscountCount,
          ordersTotalCount,
          ordersWithDiscountPercent,
          avgDiscountPerDiscountedOrder,
          avgDiscountPerTotalOrder,
          discountToRevenueRatio: discountPercentageOfGross,
          topDiscountedProducts: topRows.map(r => ({
            productId: Number(r.product_id),
            name: String(r.name),
            sku: String(r.sku),
            discountTotal: Number(r.discount_total || 0),
            unitsDiscounted: Number(r.units_discounted || 0),
          })),
        },
      });
    }

    // =========================================================================
    // 6. CATEGORIES PERFORMANCE (Tab 3)
    // =========================================================================
    if (type === 'categories') {
      const rows = await db.query<any>(`
        SELECT 
          c.id as category_id,
          c.name as category_name,
          c.code as category_code,
          COUNT(DISTINCT p.id) as product_count,
          COALESCE(SUM(sr.quantity), 0) as sold_quantity,
          COALESCE(SUM(sr.quantity * sr.unit_price_at_sale), 0) as gross_sales,
          COALESCE(SUM(sr.discount), 0) as discount,
          COALESCE(SUM(sr.total_revenue), 0) as net_revenue,
          COALESCE(SUM(sr.total_cost), 0) as cogs,
          COALESCE(SUM(sr.profit), 0) as gross_profit
        FROM categories c
        JOIN products p ON p.category_id = c.id
        LEFT JOIN sales_records sr ON sr.product_id = p.id 
          AND DATE(sr.sale_date) >= ? AND DATE(sr.sale_date) <= ? 
          AND COALESCE(sr.status, 'COMPLETED') = 'COMPLETED'
        WHERE c.status = 'ACTIVE'
        GROUP BY c.id, c.name, c.code
        ORDER BY net_revenue DESC
      `, [startDate, endDate]);

      const totalStoreRev = rows.reduce((sum, r) => sum + Number(r.net_revenue || 0), 0);

      const categories = rows.map((r) => {
        const netRev = Number(r.net_revenue || 0);
        const profit = Number(r.gross_profit || 0);
        const margin = netRev > 0 ? Math.round((profit / netRev) * 1000) / 10 : 0;
        const revenueSharePercent = totalStoreRev > 0 ? Math.round((netRev / totalStoreRev) * 1000) / 10 : 0;

        return {
          categoryId: Number(r.category_id),
          categoryName: String(r.category_name),
          categoryCode: String(r.category_code),
          productCount: Number(r.product_count || 0),
          soldQuantity: Number(r.sold_quantity || 0),
          grossSales: Number(r.gross_sales || 0),
          discount: Number(r.discount || 0),
          netRevenue: netRev,
          cogs: Number(r.cogs || 0),
          grossProfit: profit,
          margin,
          revenueSharePercent,
        };
      });

      return NextResponse.json({
        success: true,
        data: categories,
      });
    }

    // =========================================================================
    // 7. PRODUCTS PERFORMANCE (Tab 3)
    // =========================================================================
    if (type === 'products') {
      const rows = await db.query<any>(`
        SELECT 
          p.id, p.sku, p.name,
          c.name as category_name,
          pt.name as product_type_name,
          p.current_stock,
          COALESCE(SUM(sr.quantity * sr.unit_price_at_sale), 0) as gross_sales,
          COALESCE(SUM(sr.discount), 0) as discount,
          COALESCE(SUM(sr.quantity), 0) as sold_quantity,
          COALESCE(SUM(sr.total_revenue), 0) as net_revenue,
          COALESCE(SUM(sr.total_cost), 0) as cogs,
          COALESCE(SUM(sr.profit), 0) as gross_profit
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN product_types pt ON pt.id = p.product_type_id
        LEFT JOIN sales_records sr ON sr.product_id = p.id 
          AND DATE(sr.sale_date) >= ? AND DATE(sr.sale_date) <= ? 
          AND COALESCE(sr.status, 'COMPLETED') = 'COMPLETED'
        WHERE p.status = 'ACTIVE'
        GROUP BY p.id, p.sku, p.name, c.name, pt.name, p.current_stock
        ORDER BY net_revenue DESC
      `, [startDate, endDate]);

      const products = rows.map((r) => {
        const netRev = Number(r.net_revenue || 0);
        const profit = Number(r.gross_profit || 0);
        return {
          id: Number(r.id),
          sku: String(r.sku),
          name: String(r.name),
          categoryName: r.category_name || 'Chưa phân loại',
          productTypeName: r.product_type_name || 'Chưa phân loại',
          currentStock: Number(r.current_stock || 0),
          soldQuantity: Number(r.sold_quantity || 0),
          grossSales: Number(r.gross_sales || 0),
          discount: Number(r.discount || 0),
          netRevenue: netRev,
          cogs: Number(r.cogs || 0),
          grossProfit: profit,
          margin: netRev > 0 ? Math.round((profit / netRev) * 1000) / 10 : 0,
        };
      });

      return NextResponse.json({
        success: true,
        data: products,
      });
    }

    // =========================================================================
    // 8. PROFITABILITY MATRIX (BCG Matrix for Tab 3)
    // =========================================================================
    if (type === 'matrix') {
      const rows = await db.query<any>(`
        SELECT 
          p.id, p.sku, p.name,
          c.name as category_name,
          pt.name as product_type_name,
          p.current_stock,
          COALESCE(SUM(sr.quantity * sr.unit_price_at_sale), 0) as gross_sales,
          COALESCE(SUM(sr.discount), 0) as discount,
          COALESCE(SUM(sr.quantity), 0) as sold_quantity,
          COALESCE(SUM(sr.total_revenue), 0) as net_revenue,
          COALESCE(SUM(sr.total_cost), 0) as cogs,
          COALESCE(SUM(sr.profit), 0) as gross_profit
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN product_types pt ON pt.id = p.product_type_id
        LEFT JOIN sales_records sr ON sr.product_id = p.id 
          AND DATE(sr.sale_date) >= ? AND DATE(sr.sale_date) <= ? 
          AND COALESCE(sr.status, 'COMPLETED') = 'COMPLETED'
        WHERE p.status = 'ACTIVE'
        GROUP BY p.id, p.sku, p.name, c.name, pt.name, p.current_stock
      `, [startDate, endDate]);

      const items = rows.map((r) => {
        const netRev = Number(r.net_revenue || 0);
        const profit = Number(r.gross_profit || 0);
        return {
          id: Number(r.id),
          sku: String(r.sku),
          name: String(r.name),
          categoryName: r.category_name || 'Chưa phân loại',
          productTypeName: r.product_type_name || 'Chưa phân loại',
          currentStock: Number(r.current_stock || 0),
          soldQuantity: Number(r.sold_quantity || 0),
          grossSales: Number(r.gross_sales || 0),
          discount: Number(r.discount || 0),
          netRevenue: netRev,
          cogs: Number(r.cogs || 0),
          grossProfit: profit,
          margin: netRev > 0 ? Math.round((profit / netRev) * 1000) / 10 : 0,
        };
      });

      const totalItems = items.length;
      const totalRev = items.reduce((s, i) => s + i.netRevenue, 0);
      const totalProf = items.reduce((s, i) => s + i.grossProfit, 0);
      const avgRevenue = totalItems > 0 ? Math.round(totalRev / totalItems) : 0;
      const avgProfit = totalItems > 0 ? Math.round(totalProf / totalItems) : 0;

      const stars = items.filter(i => i.netRevenue >= avgRevenue && i.grossProfit >= avgProfit);
      const highVolumeLowMargin = items.filter(i => i.netRevenue >= avgRevenue && i.grossProfit < avgProfit);
      const potentials = items.filter(i => i.netRevenue < avgRevenue && i.grossProfit >= avgProfit);
      const lowPerformers = items.filter(i => i.netRevenue < avgRevenue && i.grossProfit < avgProfit);

      return NextResponse.json({
        success: true,
        data: {
          avgRevenue,
          avgProfit,
          totalProductsCount: totalItems,
          stars,
          highVolumeLowMargin,
          potentials,
          lowPerformers,
        },
      });
    }

    // =========================================================================
    // 9. WEEKDAY PERFORMANCE (Tab 4)
    // =========================================================================
    if (type === 'weekday') {
      const rows = await db.query<any>(`
        SELECT 
          EXTRACT(DOW FROM (sr.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')) as day_of_week,
          COUNT(DISTINCT COALESCE(sr.transaction_code, sr.id::text)) as orders_count,
          COALESCE(SUM(sr.total_revenue), 0) as net_revenue,
          COALESCE(SUM(sr.profit), 0) as gross_profit,
          COALESCE(SUM(sr.quantity), 0) as units_sold
        FROM sales_records sr
        WHERE DATE(sr.sale_date) >= ? AND DATE(sr.sale_date) <= ? 
          AND COALESCE(sr.status, 'COMPLETED') = 'COMPLETED'
        GROUP BY EXTRACT(DOW FROM (sr.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'))
        ORDER BY day_of_week ASC
      `, [startDate, endDate]);

      const dayMap = new Map<number, any>();
      for (const r of rows) {
        dayMap.set(Number(r.day_of_week), r);
      }

      const dayOrder = [
        { dow: 1, name: 'Thứ Hai' },
        { dow: 2, name: 'Thứ Ba' },
        { dow: 3, name: 'Thứ Tư' },
        { dow: 4, name: 'Thứ Năm' },
        { dow: 5, name: 'Thứ Sáu' },
        { dow: 6, name: 'Thứ Bảy' },
        { dow: 0, name: 'Chủ Nhật' },
      ];

      const weekday = dayOrder.map((item) => {
        const d = dayMap.get(item.dow);
        const rev = Number(d?.net_revenue || 0);
        const prof = Number(d?.gross_profit || 0);
        const orders = Number(d?.orders_count || 0);
        return {
          dayOfWeek: item.dow,
          dayName: item.name,
          ordersCount: orders,
          netRevenue: rev,
          grossProfit: prof,
          margin: rev > 0 ? Math.round((prof / rev) * 1000) / 10 : 0,
          unitsSold: Number(d?.units_sold || 0),
          aov: orders > 0 ? Math.round(rev / orders) : 0,
        };
      });

      return NextResponse.json({
        success: true,
        data: weekday,
      });
    }

    // =========================================================================
    // 10. HOURLY PERFORMANCE (Tab 4)
    // =========================================================================
    if (type === 'hourly') {
      const rows = await db.query<any>(`
        SELECT 
          EXTRACT(HOUR FROM (sr.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')) as hour_of_day,
          COUNT(DISTINCT COALESCE(sr.transaction_code, sr.id::text)) as orders_count,
          COALESCE(SUM(sr.total_revenue), 0) as net_revenue,
          COALESCE(SUM(sr.profit), 0) as gross_profit,
          COALESCE(SUM(sr.quantity), 0) as units_sold
        FROM sales_records sr
        WHERE DATE(sr.sale_date) >= ? AND DATE(sr.sale_date) <= ? 
          AND COALESCE(sr.status, 'COMPLETED') = 'COMPLETED'
        GROUP BY EXTRACT(HOUR FROM (sr.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'))
        ORDER BY hour_of_day ASC
      `, [startDate, endDate]);

      const hourMap = new Map<number, any>();
      for (const r of rows) {
        hourMap.set(Number(r.hour_of_day), r);
      }

      const hourly = [];
      for (let h = 7; h <= 22; h++) {
        const d = hourMap.get(h);
        const rev = Number(d?.net_revenue || 0);
        const prof = Number(d?.gross_profit || 0);
        const orders = Number(d?.orders_count || 0);
        hourly.push({
          hourRange: `${String(h).padStart(2, '0')}:00 - ${String(h + 1).padStart(2, '0')}:00`,
          hourStart: h,
          hourEnd: h + 1,
          ordersCount: orders,
          netRevenue: rev,
          grossProfit: prof,
          margin: rev > 0 ? Math.round((prof / rev) * 1000) / 10 : 0,
          unitsSold: Number(d?.units_sold || 0),
        });
      }

      return NextResponse.json({
        success: true,
        data: hourly,
      });
    }

    // =========================================================================
    // 11. INVENTORY CAPITAL (Tab 5)
    // =========================================================================
    if (type === 'inventory_capital') {
      const [valuationRow, stockStats, cogsRow, categoriesCap, topProds] = await Promise.all([
        db.queryOne<any>(`
          SELECT COALESCE(SUM(quantity_remaining * unit_cost), 0) as lot_valuation
          FROM inventory_lots
          WHERE quantity_remaining > 0
        `),
        db.queryOne<any>(`
          SELECT 
            COALESCE(SUM(current_stock), 0) as total_stock,
            COALESCE(SUM(current_stock * current_cost_price), 0) as stock_valuation,
            COALESCE(SUM(CASE WHEN current_stock <= min_stock_alert THEN 1 ELSE 0 END), 0) as low_stock_count
          FROM products
          WHERE status = 'ACTIVE'
        `),
        db.queryOne<any>(`
          SELECT COALESCE(SUM(total_cost), 0) as period_cogs
          FROM sales_records
          WHERE DATE(sale_date) >= ? AND DATE(sale_date) <= ? 
            AND COALESCE(status, 'COMPLETED') = 'COMPLETED'
        `, [startDate, endDate]),
        db.query<any>(`
          SELECT 
            c.id, c.name,
            COALESCE(SUM(p.current_stock * p.current_cost_price), 0) as capital_value,
            COALESCE(SUM(p.current_stock), 0) as stock_qty
          FROM categories c
          JOIN products p ON p.category_id = c.id
          WHERE c.status = 'ACTIVE' AND p.status = 'ACTIVE'
          GROUP BY c.id, c.name
          ORDER BY capital_value DESC
        `),
        db.query<any>(`
          SELECT 
            p.id, p.sku, p.name, c.name as category_name,
            p.current_stock, p.current_cost_price,
            (p.current_stock * p.current_cost_price) as stock_valuation
          FROM products p
          LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.status = 'ACTIVE' AND p.current_stock > 0
          ORDER BY stock_valuation DESC
          LIMIT 10
        `)
      ]);

      const lotVal = Number(valuationRow?.lot_valuation || 0);
      const prodVal = Number(stockStats?.stock_valuation || 0);
      const totalCapital = lotVal > 0 ? lotVal : prodVal;
      const cogsInPeriod = Number(cogsRow?.period_cogs || 0);
      const inventoryTurnover = totalCapital > 0 ? Math.round((cogsInPeriod / totalCapital) * 10) / 10 : 0;
      const daysOfInventory = inventoryTurnover > 0 ? Math.round(365 / inventoryTurnover) : 0;

      return NextResponse.json({
        success: true,
        data: {
          totalInventoryValuation: totalCapital,
          totalStockQuantity: Number(stockStats?.total_stock || 0),
          lowStockItemsCount: Number(stockStats?.low_stock_count || 0),
          deadStockCount: 0,
          deadStockValuation: 0,
          cogsInPeriod,
          inventoryTurnover,
          daysOfInventory,
          categoryCapitalAllocation: categoriesCap.map((c) => {
            const val = Number(c.capital_value || 0);
            return {
              categoryId: Number(c.id),
              categoryName: String(c.name),
              stockValuation: val,
              stockQuantity: Number(c.stock_qty || 0),
              capitalSharePercent: totalCapital > 0 ? Math.round((val / totalCapital) * 1000) / 10 : 0,
            };
          }),
          topCapitalProducts: topProds.map((p) => {
            const val = Number(p.stock_valuation || 0);
            return {
              id: Number(p.id),
              sku: String(p.sku),
              name: String(p.name),
              categoryName: p.category_name || 'Chưa phân loại',
              currentStock: Number(p.current_stock || 0),
              unitCostPrice: Number(p.current_cost_price || 0),
              stockValuation: val,
              capitalSharePercent: totalCapital > 0 ? Math.round((val / totalCapital) * 1000) / 10 : 0,
            };
          }),
        },
      });
    }

    // =========================================================================
    // 12. DEFAULT OVERVIEW (Tab 1 & Dashboard)
    // =========================================================================
    const [curStats, prevStats, stockStats, trendRows] = await Promise.all([
      db.queryOne<any>(`
        SELECT 
          COALESCE(SUM(quantity * unit_price_at_sale), 0) as gross_sales,
          COALESCE(SUM(discount), 0) as total_discount,
          COALESCE(SUM(total_revenue), 0) as net_revenue,
          COALESCE(SUM(total_cost), 0) as total_cogs,
          COALESCE(SUM(profit), 0) as gross_profit,
          COALESCE(SUM(quantity), 0) as units_sold,
          COUNT(DISTINCT COALESCE(transaction_code, id::text)) as orders_count
        FROM sales_records
        WHERE DATE(sale_date) >= ? AND DATE(sale_date) <= ? 
          AND COALESCE(status, 'COMPLETED') = 'COMPLETED'
      `, [startDate, endDate]),
      db.queryOne<any>(`
        SELECT 
          COALESCE(SUM(total_revenue), 0) as net_revenue,
          COALESCE(SUM(profit), 0) as gross_profit,
          COUNT(DISTINCT COALESCE(transaction_code, id::text)) as orders_count
        FROM sales_records
        WHERE DATE(sale_date) >= ? AND DATE(sale_date) <= ? 
          AND COALESCE(status, 'COMPLETED') = 'COMPLETED'
      `, [prevRange.startDate, prevRange.endDate]),
      db.queryOne<any>(`
        SELECT 
          COALESCE(SUM(current_stock), 0) as total_stock,
          COALESCE(SUM(current_stock * current_cost_price), 0) as stock_valuation,
          COALESCE(SUM(CASE WHEN current_stock <= min_stock_alert THEN 1 ELSE 0 END), 0) as low_stock_count
        FROM products
        WHERE status = 'ACTIVE'
      `),
      db.query<any>(`
        SELECT 
          TO_CHAR(sale_date, 'YYYY-MM-DD') as date_str,
          COALESCE(SUM(total_revenue), 0) as revenue,
          COALESCE(SUM(total_cost), 0) as cogs,
          COALESCE(SUM(profit), 0) as profit,
          COALESCE(SUM(quantity), 0) as sold_quantity,
          COUNT(DISTINCT COALESCE(transaction_code, id::text)) as transaction_count
        FROM sales_records
        WHERE DATE(sale_date) >= ? AND DATE(sale_date) <= ? 
          AND COALESCE(status, 'COMPLETED') = 'COMPLETED'
        GROUP BY TO_CHAR(sale_date, 'YYYY-MM-DD')
        ORDER BY date_str ASC
      `, [startDate, endDate])
    ]);

    const netRevenue = Number(curStats?.net_revenue || 0);
    const discount = Number(curStats?.total_discount || 0);
    const grossSales = Number(curStats?.gross_sales || (netRevenue + discount));
    const cogs = Number(curStats?.total_cogs || 0);
    const grossProfit = Number(curStats?.gross_profit || 0);
    const unitsSold = Number(curStats?.units_sold || 0);
    const ordersCount = Number(curStats?.orders_count || 0);
    const margin = netRevenue > 0 ? Math.round((grossProfit / netRevenue) * 1000) / 10 : 0;
    const aov = ordersCount > 0 ? Math.round(netRevenue / ordersCount) : 0;
    const unitsPerOrder = ordersCount > 0 ? Math.round((unitsSold / ordersCount) * 10) / 10 : 0;

    const prevNetRevenue = Number(prevStats?.net_revenue || 0);
    const prevGrossProfit = Number(prevStats?.gross_profit || 0);
    const prevOrdersCount = Number(prevStats?.orders_count || 0);
    const prevAov = prevOrdersCount > 0 ? Math.round(prevNetRevenue / prevOrdersCount) : 0;

    const comparisons = {
      netRevenue: calculateMetricComp(netRevenue, prevNetRevenue),
      grossProfit: calculateMetricComp(grossProfit, prevGrossProfit),
      ordersCount: calculateMetricComp(ordersCount, prevOrdersCount),
      aov: calculateMetricComp(aov, prevAov),
      margin: calculateMarginComp(grossProfit, netRevenue, prevGrossProfit, prevNetRevenue),
    };

    const alerts: any[] = [];
    if (prevNetRevenue > 0 && comparisons.netRevenue.changePercent < -15) {
      alerts.push({
        id: 'alert_rev_drop',
        type: 'DANGER',
        title: 'Doanh thu sụt giảm mạnh',
        message: `Doanh thu giảm ${Math.abs(comparisons.netRevenue.changePercent)}% so với kỳ trước (${prevRange.label}).`,
        severity: 'HIGH',
      });
    }
    const lowStockCount = Number(stockStats?.low_stock_count || 0);
    if (lowStockCount > 0) {
      alerts.push({
        id: 'alert_low_stock',
        type: 'WARNING',
        title: 'Cảnh báo sắp hết hàng',
        message: `Có ${lowStockCount} sản phẩm dưới định mức tồn kho tối thiểu. Cần nhập hàng bổ sung.`,
        severity: 'MEDIUM',
      });
    }

    const trend = trendRows.map(r => {
      const [y, m, d] = String(r.date_str).split('-');
      return {
        date: r.date_str,
        label: `${d}/${m}`,
        revenue: Number(r.revenue || 0),
        cogs: Number(r.cogs || 0),
        profit: Number(r.profit || 0),
        soldQuantity: Number(r.sold_quantity || 0),
        transactionCount: Number(r.transaction_count || 0),
      };
    });

    const overviewData = {
      grossSales,
      discount,
      netRevenue,
      revenue: netRevenue,
      cogs,
      grossProfit,
      profit: grossProfit,
      margin,
      ordersCount,
      salesCount: ordersCount,
      unitsSold,
      soldQuantity: unitsSold,
      aov,
      unitsPerOrder,
      currentTotalStock: Number(stockStats?.total_stock || 0),
      stockValuation: Number(stockStats?.stock_valuation || 0),
      lowStockCount,
      comparisons,
      trend,
      alerts,
      periodLabel: label,
      previousPeriodLabel: prevRange.label,
      startDate,
      endDate,
      previousStartDate: prevRange.startDate,
      previousEndDate: prevRange.endDate,
      dateRange: { startDate, endDate, period },
    };

    return NextResponse.json({
      success: true,
      data: overviewData,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { code: 'ANALYTICS_ERROR', message: error.message } },
      { status: 500 }
    );
  }
}
