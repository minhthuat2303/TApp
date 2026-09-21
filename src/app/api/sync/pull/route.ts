import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Vui lòng đăng nhập để đồng bộ dữ liệu.' } },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get('cursor') || '1970-01-01T00:00:00.000Z';
    const limit = Math.min(500, Math.max(10, parseInt(searchParams.get('limit') || '100', 10)));

    // Clean cursor for comparison
    const cursorValue = cursor.trim();

    // 1. Fetch changed categories
    const categories = await db.query(`
      SELECT id, code, name, description, status, created_at, updated_at
      FROM categories
      WHERE updated_at > ? OR created_at > ?
      ORDER BY updated_at ASC, id ASC
      LIMIT ?
    `, [cursorValue, cursorValue, limit]);

    // 2. Fetch changed product types
    const productTypes = await db.query(`
      SELECT id, category_id, code, name, description, status, created_at, updated_at
      FROM product_types
      WHERE updated_at > ? OR created_at > ?
      ORDER BY updated_at ASC, id ASC
      LIMIT ?
    `, [cursorValue, cursorValue, limit]);

    // 3. Fetch changed products
    const products = await db.query(`
      SELECT id, sku, name, category_id, product_type_id, current_cost_price,
             current_selling_price, current_stock, min_stock_alert, status, created_at, updated_at
      FROM products
      WHERE updated_at > ? OR created_at > ?
      ORDER BY updated_at ASC, id ASC
      LIMIT ?
    `, [cursorValue, cursorValue, limit]);

    // 4. Fetch changed price history
    const priceHistory = await db.query(`
      SELECT id, product_id, price, effective_from, note, created_by, created_at
      FROM price_history
      WHERE created_at > ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `, [cursorValue, limit]);

    // 5. Fetch changed inventory lots
    const inventoryLots = await db.query(`
      SELECT id, lot_code, product_id, purchase_date, quantity_received,
             quantity_remaining, unit_cost, supplier_id, import_id, note, created_by, created_at
      FROM inventory_lots
      WHERE created_at > ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `, [cursorValue, limit]);

    // 6. Fetch changed cost price history
    const costPriceHistory = await db.query(`
      SELECT id, product_id, cost_price, effective_from, note, created_by, created_at
      FROM cost_price_history
      WHERE created_at > ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `, [cursorValue, limit]);

    // 7. Fetch sales records (for cross-device synchronization)
    const salesRecords = await db.query(`
      SELECT id, transaction_code, product_id, sale_date, quantity, unit_price_at_sale, cost_price_at_sale,
             discount, total_revenue, total_cost, profit, status, cancel_reason, cancelled_at, cancelled_by,
             note, created_by, created_at
      FROM sales_records
      WHERE created_at > ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `, [cursorValue, limit]);

    // 8. Fetch sale cost allocations
    const saleCostAllocations = await db.query(`
      SELECT id, sale_id, inventory_lot_id, quantity AS allocated_quantity, unit_cost AS allocated_unit_cost, total_cost, created_at
      FROM sale_cost_allocations
      WHERE created_at > ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `, [cursorValue, limit]);

    // 9. Fetch stock movements
    const stockMovements = await db.query(`
      SELECT id, product_id, movement_type, quantity_change, balance_after, movement_date,
             reference_type, reference_id, note, created_by, created_at
      FROM stock_movements
      WHERE created_at > ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `, [cursorValue, limit]);

    // Calculate next cursor
    const nowIso = new Date().toISOString();
    let maxTimestamp = cursorValue;

    const inspectMax = (items: any[], dateField = 'updated_at') => {
      for (const it of items) {
        const val = it[dateField] || it.created_at;
        if (val && String(val) > maxTimestamp) {
          maxTimestamp = String(val);
        }
      }
    };

    inspectMax(categories);
    inspectMax(productTypes);
    inspectMax(products);
    inspectMax(priceHistory, 'created_at');
    inspectMax(inventoryLots, 'created_at');
    inspectMax(costPriceHistory, 'created_at');
    inspectMax(salesRecords, 'created_at');
    inspectMax(saleCostAllocations, 'created_at');
    inspectMax(stockMovements, 'created_at');

    const hasMore = (
      categories.length >= limit ||
      productTypes.length >= limit ||
      products.length >= limit ||
      priceHistory.length >= limit ||
      inventoryLots.length >= limit ||
      costPriceHistory.length >= limit ||
      salesRecords.length >= limit ||
      saleCostAllocations.length >= limit ||
      stockMovements.length >= limit
    );

    // If maxTimestamp didn't advance and no items changed, use nowIso
    const nextCursor = (maxTimestamp !== cursorValue) ? maxTimestamp : nowIso;

    return NextResponse.json({
      success: true,
      data: {
        categories,
        product_types: productTypes,
        products,
        price_history: priceHistory,
        cost_price_history: costPriceHistory,
        inventory_lots: inventoryLots,
        sales_records: salesRecords,
        sale_cost_allocations: saleCostAllocations,
        stock_movements: stockMovements,
        next_cursor: nextCursor,
        has_more: hasMore,
        server_timestamp: nowIso,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'SYNC_PULL_ERROR', message: error.message || 'Lỗi khi tải dữ liệu từ máy chủ.' },
      },
      { status: 500 }
    );
  }
}
