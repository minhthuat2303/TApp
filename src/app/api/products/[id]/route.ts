import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, props: Props) {
  try {
    const { id } = await props.params;

    const product = await db.queryOne(`
      SELECT 
        p.*,
        c.name as category_name,
        pt.name as product_type_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
      JOIN product_types pt ON pt.id = p.product_type_id
      WHERE p.id = ?
    `, [id]);

    if (!product) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy sản phẩm.' } },
        { status: 404 }
      );
    }

    const normalizedProduct = {
      ...product,
      current_cost_price: Math.round(Number((product as any).current_cost_price || 0)),
      current_selling_price: Math.round(Number((product as any).current_selling_price || 0)),
      current_stock: Number((product as any).current_stock || 0),
      min_stock_alert: Number((product as any).min_stock_alert || 0),
    };

    return NextResponse.json({ success: true, data: normalizedProduct });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, props: Props) {
  try {
    const user = await getCurrentUser(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Bạn không có quyền thực hiện thao tác này.' } },
        { status: 403 }
      );
    }

    const { id } = await props.params;
    const body = await request.json();
    const {
      name,
      sku,
      category_id,
      product_type_id,
      min_stock_alert,
      status,
      selling_price,
      current_selling_price,
      description,
    } = body;

    const oldProduct = await db.queryOne<any>('SELECT * FROM products WHERE id = ?', [id]);
    if (!oldProduct) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy sản phẩm.' } },
        { status: 404 }
      );
    }

    let finalSku = oldProduct.sku;
    if (sku && sku.trim().toUpperCase() !== oldProduct.sku) {
      finalSku = sku.trim().toUpperCase();
      const existingSku = await db.queryOne<any>('SELECT id FROM products WHERE sku = ? AND id != ?', [finalSku, id]);
      if (existingSku) {
        return NextResponse.json(
          { success: false, error: { code: 'DUPLICATE_SKU', message: `Mã SKU '${finalSku}' đã tồn tại ở sản phẩm khác.` } },
          { status: 400 }
        );
      }
    }

    // Process selling price change and record price history
    const effectivePriceInput = selling_price !== undefined ? selling_price : current_selling_price;
    let newSellingPrice = Math.round(Number(oldProduct.current_selling_price || 0));
    if (effectivePriceInput !== undefined && effectivePriceInput !== null && !isNaN(Number(effectivePriceInput))) {
      const parsedPrice = Math.round(Number(effectivePriceInput));
      if (parsedPrice >= 0 && parsedPrice !== Math.round(Number(oldProduct.current_selling_price || 0))) {
        newSellingPrice = parsedPrice;
        await db.execute(`
          INSERT INTO price_history (product_id, price, effective_from, note, created_by)
          VALUES (?, ?, CURRENT_DATE, 'Cập nhật giá bán', ?)
        `, [id, newSellingPrice, user.id]);
      }
    }

    await db.execute(`
      UPDATE products
      SET name = COALESCE(?, name),
          sku = ?,
          category_id = COALESCE(?, category_id),
          product_type_id = COALESCE(?, product_type_id),
          min_stock_alert = COALESCE(?, min_stock_alert),
          current_selling_price = ?,
          description = COALESCE(?, description),
          status = COALESCE(?, status),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      name?.trim() || null,
      finalSku,
      category_id || null,
      product_type_id || null,
      min_stock_alert !== undefined ? Number(min_stock_alert) : oldProduct.min_stock_alert,
      newSellingPrice,
      description !== undefined ? description : null,
      status || null,
      id
    ]);

    const updated = await db.queryOne(`
      SELECT 
        p.*,
        c.name as category_name,
        pt.name as product_type_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
      JOIN product_types pt ON pt.id = p.product_type_id
      WHERE p.id = ?
    `, [id]);

    await db.execute(`
      INSERT INTO audit_logs (user_id, action, entity_name, entity_id, old_value_json, new_value_json)
      VALUES (?, 'UPDATE_PRODUCT', 'PRODUCTS', ?, ?, ?)
    `, [user.id, id, JSON.stringify(oldProduct), JSON.stringify(updated)]);

    const normalizedUpdated = {
      ...updated,
      current_cost_price: Math.round(Number((updated as any).current_cost_price || 0)),
      current_selling_price: Math.round(Number((updated as any).current_selling_price || 0)),
      current_stock: Number((updated as any).current_stock || 0),
      min_stock_alert: Number((updated as any).min_stock_alert || 0),
    };

    return NextResponse.json({ success: true, data: normalizedUpdated });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { code: 'SERVER_ERROR', message: error.message } },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, props: Props) {
  try {
    const user = await getCurrentUser(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Bạn không có quyền thực hiện thao tác này.' } },
        { status: 403 }
      );
    }

    const { id } = await props.params;
    const body = await request.json();
    const { status } = body;

    if (!status || !['ACTIVE', 'INACTIVE'].includes(status)) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_STATUS', message: 'Trạng thái không hợp lệ (ACTIVE hoặc INACTIVE).' } },
        { status: 400 }
      );
    }

    const oldProduct = await db.queryOne<any>('SELECT id, status FROM products WHERE id = ?', [id]);
    if (!oldProduct) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy sản phẩm.' } },
        { status: 404 }
      );
    }

    await db.execute(`
      UPDATE products
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [status, id]);

    await db.execute(`
      INSERT INTO audit_logs (user_id, action, entity_name, entity_id, old_value_json, new_value_json)
      VALUES (?, 'TOGGLE_PRODUCT_STATUS', 'PRODUCTS', ?, ?, ?)
    `, [user.id, id, JSON.stringify({ status: oldProduct.status }), JSON.stringify({ status })]);

    return NextResponse.json({ success: true, data: { id, status } });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { code: 'SERVER_ERROR', message: error.message } },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, props: Props) {
  try {
    const user = await getCurrentUser(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Bạn không có quyền thực hiện thao tác này.' } },
        { status: 403 }
      );
    }

    const { id } = await props.params;

    // Check if product has sales records
    const salesCount = await db.queryOne<any>('SELECT COUNT(*) as c FROM sales_records WHERE product_id = ?', [id]);
    if (salesCount && Number(salesCount.c) > 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'TRANSACTION_EXISTS',
            message: `Sản phẩm này đã có ${salesCount.c} giao dịch bán hàng. Không được xóa cứng để bảo vệ dữ liệu lịch sử kế toán. Vui lòng chuyển trạng thái sang 'Ngừng bán'.`,
          },
        },
        { status: 400 }
      );
    }

    // Check if product has stock movements
    const movementsCount = await db.queryOne<any>('SELECT COUNT(*) as c FROM stock_movements WHERE product_id = ?', [id]);
    if (movementsCount && Number(movementsCount.c) > 1) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'STOCK_HISTORY_EXISTS',
            message: `Sản phẩm đã có biến động kho thực tế. Vui lòng chuyển trạng thái sang 'Ngừng bán'.`,
          },
        },
        { status: 400 }
      );
    }

    const old = await db.queryOne('SELECT * FROM products WHERE id = ?', [id]);
    if (!old) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy sản phẩm.' } },
        { status: 404 }
      );
    }

    // Cascade delete price history & clean movement
    await db.execute('DELETE FROM price_history WHERE product_id = ?', [id]);
    await db.execute('DELETE FROM cost_price_history WHERE product_id = ?', [id]);
    await db.execute('DELETE FROM stock_movements WHERE product_id = ?', [id]);
    await db.execute('DELETE FROM products WHERE id = ?', [id]);

    await db.execute(`
      INSERT INTO audit_logs (user_id, action, entity_name, entity_id, old_value_json)
      VALUES (?, 'DELETE_PRODUCT', 'PRODUCTS', ?, ?)
    `, [user.id, id, JSON.stringify(old)]);

    return NextResponse.json({ success: true, data: { message: 'Đã xóa sản phẩm thành công.' } });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { code: 'SERVER_ERROR', message: error.message } },
      { status: 500 }
    );
  }
}
