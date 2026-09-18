import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim();
    const categoryId = searchParams.get('categoryId');
    const lowStockOnly = searchParams.get('lowStock') === 'true';

    let whereClauses: string[] = ["p.status = 'ACTIVE'"];
    let params: any[] = [];

    if (q) {
      whereClauses.push(`(p.sku ILIKE ? OR p.name ILIKE ?)`);
      params.push(`%${q}%`, `%${q}%`);
    }

    if (categoryId) {
      whereClauses.push(`p.category_id = ?`);
      params.push(categoryId);
    }

    if (lowStockOnly) {
      whereClauses.push(`p.current_stock <= p.min_stock_alert`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const summary = await db.queryOne<any>(`
      SELECT 
        COUNT(p.id) as total_products,
        COALESCE(SUM(p.current_stock), 0) as total_stock,
        COALESCE(SUM(p.current_stock * p.current_cost_price), 0) as total_stock_valuation,
        COALESCE(SUM(CASE WHEN p.current_stock <= p.min_stock_alert THEN 1 ELSE 0 END), 0) as low_stock_count
      FROM products p
      ${whereSql}
    `, params);

    const items = await db.query(`
      SELECT 
        p.id, p.sku, p.name, p.current_stock, p.min_stock_alert,
        p.current_cost_price, p.current_selling_price,
        (p.current_stock * p.current_cost_price) as stock_valuation,
        c.name as category_name,
        pt.name as product_type_name,
        CASE WHEN p.current_stock <= p.min_stock_alert THEN 1 ELSE 0 END as is_low_stock
      FROM products p
      JOIN categories c ON c.id = p.category_id
      JOIN product_types pt ON pt.id = p.product_type_id
      ${whereSql}
      ORDER BY is_low_stock DESC, p.current_stock ASC
    `, params);

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalProducts: Number(summary?.total_products || 0),
          totalStock: Number(summary?.total_stock || 0),
          totalStockItems: Number(summary?.total_stock || 0),
          totalValuation: Number(summary?.total_stock_valuation || 0),
          lowStockCount: Number(summary?.low_stock_count || 0),
        },
        items,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
  }
}
