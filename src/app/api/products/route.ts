import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import serverCache from '@/lib/cache';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim();
    const categoryId = searchParams.get('categoryId');
    const productTypeId = searchParams.get('productTypeId');
    const status = searchParams.get('status');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = (page - 1) * limit;

    let whereClauses: string[] = [];
    let params: any[] = [];

    if (q) {
      whereClauses.push(`(p.sku ILIKE ? OR p.name ILIKE ?)`);
      params.push(`%${q}%`, `%${q}%`);
    }

    if (categoryId) {
      whereClauses.push(`p.category_id = ?`);
      params.push(categoryId);
    }

    if (productTypeId) {
      whereClauses.push(`p.product_type_id = ?`);
      params.push(productTypeId);
    }

    if (status) {
      whereClauses.push(`p.status = ?`);
      params.push(status);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const cacheKey = `products_list:${q || ''}:${categoryId || ''}:${productTypeId || ''}:${status || ''}:${page}:${limit}`;
    const cached = serverCache.get(cacheKey);
    if (cached) {
      return NextResponse.json({ success: true, ...cached }, {
        headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' }
      });
    }

    const [countResult, products] = await Promise.all([
      db.queryOne<{ total: number }>(`
        SELECT COUNT(*) as total
        FROM products p
        ${whereSql}
      `, params),

      db.query(`
        SELECT 
          p.id, p.sku, p.name, p.category_id, p.product_type_id,
          p.current_cost_price, p.current_selling_price, p.current_stock,
          p.min_stock_alert, p.status, p.created_at, p.updated_at,
          c.name as category_name,
          pt.name as product_type_name
        FROM products p
        JOIN categories c ON c.id = p.category_id
        JOIN product_types pt ON pt.id = p.product_type_id
        ${whereSql}
        ORDER BY p.name ASC
        LIMIT ? OFFSET ?
      `, [...params, limit, offset])
    ]);

    const total = Number(countResult?.total || 0);
    const totalPages = Math.ceil(total / limit);

    const normalizedProducts = (products as any[]).map((p) => ({
      ...p,
      current_cost_price: Math.round(Number(p.current_cost_price || 0)),
      current_selling_price: Math.round(Number(p.current_selling_price || 0)),
      current_stock: Number(p.current_stock || 0),
      min_stock_alert: Number(p.min_stock_alert || 0),
    }));

    const resultPayload = {
      data: normalizedProducts,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };

    serverCache.set(cacheKey, resultPayload, 60, ['products']);

    return NextResponse.json({
      success: true,
      ...resultPayload,
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' }
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Bạn không có quyền thực hiện thao tác này.' } },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      sku,
      name,
      category_id,
      product_type_id,
      cost_price = 0,
      selling_price = 0,
      initial_stock = 0,
      min_stock_alert = 5,
      effective_date,
    } = body;

    if (!sku || !name || !category_id || !product_type_id) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Vui lòng nhập đầy đủ SKU, tên, danh mục và loại sản phẩm.' },
        },
        { status: 400 }
      );
    }

    const formattedSku = sku.trim().toUpperCase();

    // Check SKU existence
    const existing = await db.queryOne('SELECT id FROM products WHERE sku = ?', [formattedSku]);
    if (existing) {
      return NextResponse.json(
        { success: false, error: { code: 'DUPLICATE_SKU', message: `Mã sản phẩm / SKU '${formattedSku}' đã tồn tại.` } },
        { status: 400 }
      );
    }

    const today = effective_date || new Date().toISOString().split('T')[0];

    const result = await db.transaction(async (tx) => {
      // 1. Insert product
      const info = await tx.execute(`
        INSERT INTO products (
          sku, name, category_id, product_type_id,
          current_cost_price, current_selling_price, current_stock,
          min_stock_alert, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
      `, [
        formattedSku,
        name.trim(),
        category_id,
        product_type_id,
        Number(cost_price) || 0,
        Number(selling_price) || 0,
        Number(initial_stock) || 0,
        Number(min_stock_alert) || 5
      ]);

      const newProductId = Number(info.lastInsertId);

      // 2. Insert initial price history
      await tx.execute(`
        INSERT INTO price_history (product_id, price, effective_from, note, created_by)
        VALUES (?, ?, ?, 'Khởi tạo giá niêm yết ban đầu', ?)
      `, [newProductId, Number(selling_price) || 0, today, user.id]);

      // 3. Insert initial cost price history
      await tx.execute(`
        INSERT INTO cost_price_history (product_id, cost_price, effective_from, note, created_by)
        VALUES (?, ?, ?, 'Khởi tạo giá vốn ban đầu', ?)
      `, [newProductId, Number(cost_price) || 0, today, user.id]);

      // 4. If initial stock > 0, insert stock movement & lot
      if (Number(initial_stock) > 0) {
        await tx.execute(`
          INSERT INTO stock_movements (
            product_id, movement_type, quantity_change, balance_after,
            movement_date, reference_type, note, created_by
          ) VALUES (?, 'PURCHASE', ?, ?, ?, 'INITIAL_STOCK', 'Khởi tạo tồn kho ban đầu', ?)
        `, [newProductId, Number(initial_stock), Number(initial_stock), today, user.id]);

        const lotCode = `LOT-INIT-${formattedSku}-${Date.now().toString().slice(-4)}`;
        await tx.execute(`
          INSERT INTO inventory_lots (lot_code, product_id, purchase_date, quantity_received, quantity_remaining, unit_cost, note, created_by)
          VALUES (?, ?, ?, ?, ?, ?, 'Khởi tạo lô tồn kho ban đầu', ?)
        `, [lotCode, newProductId, today, Number(initial_stock), Number(initial_stock), Number(cost_price) || 0, user.id]);
      }

      // 5. Audit log
      await tx.execute(`
        INSERT INTO audit_logs (user_id, action, entity_name, entity_id, new_value_json)
        VALUES (?, 'CREATE_PRODUCT', 'PRODUCTS', ?, ?)
      `, [user.id, newProductId.toString(), JSON.stringify({
        sku: formattedSku,
        name,
        selling_price,
        cost_price,
        initial_stock,
      })]);

      return newProductId;
    });

    const newProduct = await db.queryOne(`
      SELECT 
        p.*,
        c.name as category_name,
        pt.name as product_type_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
      JOIN product_types pt ON pt.id = p.product_type_id
      WHERE p.id = ?
    `, [result]);

    return NextResponse.json({ success: true, data: newProduct }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { code: 'SERVER_ERROR', message: error.message } },
      { status: 500 }
    );
  }
}
