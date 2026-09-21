import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const status = searchParams.get('status');

    let whereSql = '';
    const params: any[] = [];

    if (status && status !== 'ALL') {
      whereSql = 'WHERE COALESCE(i.status, \'COMPLETED\') = ?';
      params.push(status);
    }

    const imports = await db.query<any>(`
      SELECT 
        i.id,
        i.import_code,
        i.supplier_id,
        s.name as supplier_name,
        TO_CHAR(i.import_date, 'YYYY-MM-DD') as import_date,
        i.total_amount,
        i.note,
        'COMPLETED' as status,
        i.created_by,
        i.created_at,
        u.full_name as creator_name
      FROM imports i
      LEFT JOIN suppliers s ON s.id = i.supplier_id
      LEFT JOIN users u ON u.id = i.created_by
      ${whereSql}
      ORDER BY i.id DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    if (imports.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const importIds = imports.map(imp => imp.id);
    const items = await db.query<any>(`
      SELECT 
        ii.id,
        ii.import_id,
        ii.product_id,
        p.name as product_name,
        p.sku,
        p.current_stock,
        ii.quantity,
        ii.unit_cost_price,
        ii.total_amount
      FROM import_items ii
      JOIN products p ON p.id = ii.product_id
      WHERE ii.import_id = ANY(?)
      ORDER BY ii.id ASC
    `, [importIds]);

    const itemsByImportId = new Map<number, any[]>();
    for (const item of items) {
      if (!itemsByImportId.has(item.import_id)) {
        itemsByImportId.set(item.import_id, []);
      }
      itemsByImportId.get(item.import_id)!.push(item);
    }

    const data = imports.map(imp => ({
      ...imp,
      items: itemsByImportId.get(imp.id) || [],
    }));

    return NextResponse.json({ success: true, data });
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
        { success: false, error: { code: 'FORBIDDEN', message: 'Chỉ Admin mới có quyền nhập kho.' } },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      items: inputItems,
      productId: singleProductId,
      quantity: singleQuantity,
      unitCostPrice: singleUnitCostPrice,
      supplierId,
      note,
      importDate,
    } = body;

    const rawItems: any[] = Array.isArray(inputItems) && inputItems.length > 0
      ? inputItems
      : [{
          productId: singleProductId,
          quantity: singleQuantity,
          unitCostPrice: singleUnitCostPrice,
        }];

    if (rawItems.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'Danh sách sản phẩm nhập kho không được để trống.' } },
        { status: 400 }
      );
    }

    const validatedItems: Array<{ productId: number; quantity: number; unitCostPrice: number }> = [];
    for (const it of rawItems) {
      const pid = Number(it.productId);
      const qty = parseInt(String(it.quantity), 10);
      const cost = parseFloat(String(it.unitCostPrice));

      if (!pid || isNaN(qty) || qty <= 0 || isNaN(cost) || cost < 0) {
        return NextResponse.json(
          {
            success: false,
            error: { code: 'INVALID_INPUT', message: 'Mỗi sản phẩm nhập kho phải có ID hợp lệ, số lượng > 0 và đơn giá >= 0.' },
          },
          { status: 400 }
        );
      }
      validatedItems.push({ productId: pid, quantity: qty, unitCostPrice: cost });
    }

    const date = importDate || new Date().toISOString().split('T')[0];
    const cleanDate = date.replace(/-/g, '');
    const importCode = `NK-${cleanDate}-${Date.now().toString().slice(-4)}`;

    const receiptResult = await db.transaction(async (tx) => {
      let totalAmount = 0;
      const verifiedItems: Array<{
        product: any;
        quantity: number;
        unitCostPrice: number;
        totalItemAmount: number;
      }> = [];

      for (const it of validatedItems) {
        const product = await tx.queryOne<any>(
          'SELECT id, sku, name, current_stock, current_cost_price FROM products WHERE id = ?',
          [it.productId]
        );
        if (!product) {
          throw new Error(`Sản phẩm với ID ${it.productId} không tồn tại trên hệ thống.`);
        }
        const totalItemAmount = it.quantity * it.unitCostPrice;
        totalAmount += totalItemAmount;
        verifiedItems.push({
          product,
          quantity: it.quantity,
          unitCostPrice: it.unitCostPrice,
          totalItemAmount,
        });
      }

      // 1. Create Import Header
      const importInfo = await tx.execute(`
        INSERT INTO imports (import_code, supplier_id, import_date, total_amount, note, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [importCode, supplierId || null, date, totalAmount, note ? note.trim() : null, user.id]);

      const importId = Number(importInfo.lastInsertId);
      const createdLots: any[] = [];

      // 2. Process each item
      for (const item of verifiedItems) {
        // 2a. Insert import item
        await tx.execute(`
          INSERT INTO import_items (import_id, product_id, quantity, unit_cost_price, total_amount)
          VALUES (?, ?, ?, ?, ?)
        `, [importId, item.product.id, item.quantity, item.unitCostPrice, item.totalItemAmount]);

        // 2b. Create INVENTORY LOT (FIFO tracking)
        const lotCode = `LOT-${cleanDate}-${item.product.sku}-${Date.now().toString().slice(-4)}`;
        const lotInfo = await tx.execute(`
          INSERT INTO inventory_lots (
            lot_code, product_id, purchase_date, quantity_received, quantity_remaining,
            unit_cost, supplier_id, import_id, note, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          lotCode,
          item.product.id,
          date,
          item.quantity,
          item.quantity,
          item.unitCostPrice,
          supplierId || null,
          importId,
          note ? note.trim() : `Nhập kho phiếu ${importCode}`,
          user.id
        ]);
        const lotId = Number(lotInfo.lastInsertId);

        // 2c. Record Cost Price History
        await tx.execute(`
          INSERT INTO cost_price_history (product_id, cost_price, effective_from, note, created_by)
          VALUES (?, ?, ?, ?, ?)
        `, [item.product.id, item.unitCostPrice, date, `Nhập kho theo phiếu ${importCode} (Lô ${lotCode})`, user.id]);

        // 2d. Calculate weighted average cost of remaining lots
        const remainingLotsSummary = await tx.queryOne<any>(`
          SELECT 
            COALESCE(SUM(quantity_remaining), 0) as total_rem,
            COALESCE(SUM(quantity_remaining * unit_cost), 0) as total_val
          FROM inventory_lots
          WHERE product_id = ? AND quantity_remaining > 0
        `, [item.product.id]);

        const totalRem = Number(remainingLotsSummary?.total_rem || 0);
        const totalVal = Number(remainingLotsSummary?.total_val || 0);
        const newStock = Number(item.product.current_stock) + item.quantity;
        const weightedAvgCost = totalRem > 0
          ? Math.round(totalVal / totalRem)
          : item.unitCostPrice;

        // 2e. Update Product Stock & Cost
        await tx.execute(`
          UPDATE products
          SET current_stock = ?,
              current_cost_price = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [newStock, weightedAvgCost, item.product.id]);

        // 2f. Create Stock Movement (PURCHASE)
        await tx.execute(`
          INSERT INTO stock_movements (
            product_id, movement_type, quantity_change, balance_after,
            movement_date, reference_type, reference_id, note, created_by
          ) VALUES (?, 'PURCHASE', ?, ?, ?, 'imports', ?, ?, ?)
        `, [
          item.product.id,
          item.quantity,
          newStock,
          date,
          importId,
          `Nhập kho phiếu ${importCode} (Lô: ${lotCode})` + (note ? `: ${note}` : ''),
          user.id
        ]);

        createdLots.push({
          lotId,
          lotCode,
          productId: item.product.id,
          productName: item.product.name,
          quantity: item.quantity,
          unitCostPrice: item.unitCostPrice,
          balanceAfter: newStock,
        });
      }

      // 3. Audit Log
      await tx.execute(`
        INSERT INTO audit_logs (user_id, action, entity_name, entity_id, new_value_json)
        VALUES (?, 'STOCK_IMPORT', 'IMPORTS', ?, ?)
      `, [user.id, (importId || 0).toString(), JSON.stringify({
        import_code: importCode,
        total_amount: totalAmount,
        items_count: verifiedItems.length,
      })]);

      return {
        importId,
        importCode,
        totalAmount,
        itemsCount: verifiedItems.length,
        importDate: date,
        lots: createdLots,
      };
    });

    return NextResponse.json({
      success: true,
      data: receiptResult,
      message: 'Nhập kho và khởi tạo các lô hàng thành công.',
    }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'IMPORT_ERROR', message: error.message || 'Lỗi xử lý nhập kho.' },
      },
      { status: 400 }
    );
  }
}
