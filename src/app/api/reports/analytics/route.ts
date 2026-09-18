import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveDateRange } from '@/lib/date-utils';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'overview';
    const period = searchParams.get('period') || 'this_month';
    const customStart = searchParams.get('startDate') || undefined;
    const customEnd = searchParams.get('endDate') || undefined;
    const userIdParam = searchParams.get('userId');
    const userId = userIdParam ? parseInt(userIdParam, 10) : undefined;

    const { startDate, endDate, label } = resolveDateRange(period, customStart, customEnd);

    // 1. STAFF PERFORMANCE
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
        GROUP BY COALESCE(u.id, sr.created_by, 1), u.username, u.full_name, u.role
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

    // 2. TIMELINE (Daily aggregation)
    if (type === 'timeline') {
      let sql = `
        SELECT 
          TO_CHAR(sr.sale_date, 'YYYY-MM-DD') as date_str,
          COUNT(DISTINCT COALESCE(sr.transaction_code, sr.id::text)) as orders_count,
          COALESCE(SUM(sr.total_revenue), 0) as revenue,
          COALESCE(SUM(sr.total_cost), 0) as cost,
          COALESCE(SUM(sr.profit), 0) as profit,
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
        const rev = Number(r.revenue || 0);
        const prof = Number(r.profit || 0);
        return {
          date: r.date_str,
          revenue: rev,
          cost: Number(r.cost || 0),
          profit: prof,
          ordersCount: Number(r.orders_count || 0),
          unitsSold: Number(r.units_sold || 0),
          margin: rev > 0 ? Math.round((prof / rev) * 1000) / 10 : 0,
        };
      });

      const totalRevenue = points.reduce((sum, p) => sum + p.revenue, 0);
      const totalCost = points.reduce((sum, p) => sum + p.cost, 0);
      const totalProfit = points.reduce((sum, p) => sum + p.profit, 0);

      return NextResponse.json({
        success: true,
        data: {
          points,
          granularity: 'day',
          summary: {
            totalRevenue,
            totalCost,
            totalProfit,
            avgMargin: totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 1000) / 10 : 0,
          },
        },
      });
    }

    // 3. DISCOUNT ANALYSIS
    if (type === 'discount') {
      const stats = await db.queryOne<any>(`
        SELECT 
          COALESCE(SUM(discount), 0) as total_discount,
          COALESCE(SUM(total_revenue), 0) as total_revenue,
          COUNT(CASE WHEN discount > 0 THEN 1 END) as discounted_items_count,
          COUNT(id) as total_items_count
        FROM sales_records
        WHERE DATE(sale_date) >= ? AND DATE(sale_date) <= ? 
          AND COALESCE(status, 'COMPLETED') = 'COMPLETED'
      `, [startDate, endDate]);

      const totalDisc = Number(stats?.total_discount || 0);
      const totalRev = Number(stats?.total_revenue || 0);
      const grossSales = totalRev + totalDisc;

      return NextResponse.json({
        success: true,
        data: {
          totalDiscount: totalDisc,
          totalRevenue: totalRev,
          grossSales,
          discountPercentageOfGross: grossSales > 0 ? Math.round((totalDisc / grossSales) * 1000) / 10 : 0,
          discountedItemsCount: Number(stats?.discounted_items_count || 0),
          totalItemsCount: Number(stats?.total_items_count || 0),
        },
      });
    }

    // 4. CATEGORIES PERFORMANCE
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

    // 5. PRODUCTS PERFORMANCE & MATRIX
    if (type === 'products') {
      const rows = await db.query<any>(`
        SELECT 
          p.id, p.sku, p.name,
          c.name as category_name,
          pt.name as product_type_name,
          p.current_stock,
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

    // 6. WEEKDAY PERFORMANCE
    if (type === 'weekday') {
      const rows = await db.query<any>(`
        SELECT 
          EXTRACT(DOW FROM sr.sale_date) as day_of_week,
          COUNT(DISTINCT COALESCE(sr.transaction_code, sr.id::text)) as orders_count,
          COALESCE(SUM(sr.total_revenue), 0) as net_revenue,
          COALESCE(SUM(sr.profit), 0) as gross_profit,
          COALESCE(SUM(sr.quantity), 0) as units_sold
        FROM sales_records sr
        WHERE DATE(sr.sale_date) >= ? AND DATE(sr.sale_date) <= ? 
          AND COALESCE(sr.status, 'COMPLETED') = 'COMPLETED'
        GROUP BY EXTRACT(DOW FROM sr.sale_date)
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

    // 7. HOURLY PERFORMANCE
    if (type === 'hourly') {
      const rows = await db.query<any>(`
        SELECT 
          EXTRACT(HOUR FROM sr.created_at) as hour_of_day,
          COUNT(DISTINCT COALESCE(sr.transaction_code, sr.id::text)) as orders_count,
          COALESCE(SUM(sr.total_revenue), 0) as net_revenue,
          COALESCE(SUM(sr.profit), 0) as gross_profit,
          COALESCE(SUM(sr.quantity), 0) as units_sold
        FROM sales_records sr
        WHERE DATE(sr.sale_date) >= ? AND DATE(sr.sale_date) <= ? 
          AND COALESCE(sr.status, 'COMPLETED') = 'COMPLETED'
        GROUP BY EXTRACT(HOUR FROM sr.created_at)
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
          hour: h,
          hourLabel: `${String(h).padStart(2, '0')}:00`,
          ordersCount: orders,
          netRevenue: rev,
          grossProfit: prof,
          margin: rev > 0 ? Math.round((prof / rev) * 1000) / 10 : 0,
          unitsSold: Number(d?.units_sold || 0),
          aov: orders > 0 ? Math.round(rev / orders) : 0,
        });
      }

      return NextResponse.json({
        success: true,
        data: hourly,
      });
    }

    // 8. INVENTORY CAPITAL
    if (type === 'inventory_capital') {
      const [valuationRow, stockStats, categoriesCap] = await Promise.all([
        db.queryOne<any>(`
          SELECT COALESCE(SUM(quantity_remaining * unit_cost), 0) as lot_valuation
          FROM inventory_lots
          WHERE quantity_remaining > 0
        `),
        db.queryOne<any>(`
          SELECT 
            COALESCE(SUM(current_stock), 0) as total_stock,
            COALESCE(SUM(current_stock * current_cost_price), 0) as stock_valuation
          FROM products
          WHERE status = 'ACTIVE'
        `),
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
        `)
      ]);

      const lotVal = Number(valuationRow?.lot_valuation || 0);
      const prodVal = Number(stockStats?.stock_valuation || 0);
      const totalCapital = lotVal > 0 ? lotVal : prodVal;

      return NextResponse.json({
        success: true,
        data: {
          lotValuation: totalCapital,
          totalStock: Number(stockStats?.total_stock || 0),
          deadStockValuation: 0,
          categoriesCapital: categoriesCap.map((c) => ({
            id: Number(c.id),
            name: String(c.name),
            capitalValue: Number(c.capital_value || 0),
            stockQty: Number(c.stock_qty || 0),
            capitalSharePercent: totalCapital > 0 ? Math.round((Number(c.capital_value || 0) / totalCapital) * 1000) / 10 : 0,
          })),
        },
      });
    }

    // DEFAULT OVERVIEW
    const [salesStats, stockStats] = await Promise.all([
      db.queryOne<any>(`
        SELECT 
          COUNT(DISTINCT COALESCE(transaction_code, id::text)) as sales_count,
          COALESCE(SUM(quantity), 0) as sold_quantity,
          COALESCE(SUM(total_revenue), 0) as total_revenue,
          COALESCE(SUM(total_cost), 0) as total_cost,
          COALESCE(SUM(profit), 0) as total_profit
        FROM sales_records
        WHERE DATE(sale_date) >= ? AND DATE(sale_date) <= ? 
          AND COALESCE(status, 'COMPLETED') = 'COMPLETED'
      `, [startDate, endDate]),
      db.queryOne<any>(`
        SELECT 
          COALESCE(SUM(current_stock), 0) as total_stock,
          COALESCE(SUM(current_stock * current_cost_price), 0) as stock_valuation,
          COALESCE(SUM(CASE WHEN current_stock <= min_stock_alert THEN 1 ELSE 0 END), 0) as low_stock_count
        FROM products
        WHERE status = 'ACTIVE'
      `)
    ]);

    return NextResponse.json({
      success: true,
      data: {
        revenue: Number(salesStats?.total_revenue || 0),
        cogs: Number(salesStats?.total_cost || 0),
        profit: Number(salesStats?.total_profit || 0),
        salesCount: Number(salesStats?.sales_count || 0),
        soldQuantity: Number(salesStats?.sold_quantity || 0),
        currentTotalStock: Number(stockStats?.total_stock || 0),
        stockValuation: Number(stockStats?.stock_valuation || 0),
        lowStockCount: Number(stockStats?.low_stock_count || 0),
        periodLabel: label,
        dateRange: { startDate, endDate, period },
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { code: 'ANALYTICS_ERROR', message: error.message } },
      { status: 500 }
    );
  }
}
