import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Vui lòng đăng nhập.' } },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const productIdParam = searchParams.get('productId');

    let whereClause = "p.status = 'ACTIVE'";
    const params: any[] = [];

    if (productIdParam) {
      whereClause += ' AND p.id = ?';
      params.push(productIdParam);
    }

    // Query product cached stock alongside ledger sum of all movements
    const reportItems = await db.query(`
      SELECT 
        p.id as product_id,
        p.sku,
        p.name as product_name,
        p.current_stock as cached_stock,
        COALESCE(ledger.sum_change, 0) as ledger_stock,
        (p.current_stock - COALESCE(ledger.sum_change, 0)) as stock_drift,
        c.name as category_name
      FROM products p
      LEFT JOIN (
        SELECT product_id, SUM(quantity_change) as sum_change
        FROM stock_movements
        GROUP BY product_id
      ) ledger ON ledger.product_id = p.id
      JOIN categories c ON c.id = p.category_id
      WHERE ${whereClause}
      ORDER BY ABS(p.current_stock - COALESCE(ledger.sum_change, 0)) DESC, p.id ASC
    `, params);

    const driftedItems = reportItems.filter((it: any) => Number(it.stock_drift) !== 0);

    return NextResponse.json({
      success: true,
      data: {
        total_audited: reportItems.length,
        drift_count: driftedItems.length,
        is_consistent: driftedItems.length === 0,
        items: reportItems.map((it: any) => ({
          product_id: it.product_id,
          sku: it.sku,
          product_name: it.product_name,
          category_name: it.category_name,
          cached_stock: Number(it.cached_stock),
          ledger_stock: Number(it.ledger_stock),
          stock_drift: Number(it.stock_drift),
          has_drift: Number(it.stock_drift) !== 0,
        })),
        drifted_items: driftedItems,
        audited_at: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'RECONCILIATION_ERROR', message: error.message || 'Lỗi khi kiểm tra đối soát kho.' },
      },
      { status: 500 }
    );
  }
}
