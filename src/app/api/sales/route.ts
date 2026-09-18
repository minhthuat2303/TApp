import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const productId = searchParams.get('productId');
    const status = searchParams.get('status');
    const q = searchParams.get('q')?.trim();
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = (page - 1) * limit;

    let whereClauses: string[] = [];
    let params: any[] = [];

    if (startDate) {
      whereClauses.push(`DATE(sr.sale_date) >= ?`);
      params.push(startDate);
    }

    if (endDate) {
      whereClauses.push(`DATE(sr.sale_date) <= ?`);
      params.push(endDate);
    }

    if (productId) {
      whereClauses.push(`sr.product_id = ?`);
      params.push(productId);
    }

    if (status && status !== 'ALL') {
      whereClauses.push(`COALESCE(sr.status, 'COMPLETED') = ?`);
      params.push(status);
    }

    if (q) {
      whereClauses.push(`(sr.transaction_code ILIKE ? OR p.name ILIKE ? OR p.sku ILIKE ? OR sr.note ILIKE ?)`);
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countResult = await db.queryOne<any>(`
      SELECT 
        COUNT(*) as total, 
        SUM(CASE WHEN COALESCE(sr.status, 'COMPLETED') = 'COMPLETED' THEN sr.total_revenue ELSE 0 END) as sum_revenue, 
        SUM(CASE WHEN COALESCE(sr.status, 'COMPLETED') = 'COMPLETED' THEN sr.profit ELSE 0 END) as sum_profit, 
        SUM(CASE WHEN COALESCE(sr.status, 'COMPLETED') = 'COMPLETED' THEN sr.quantity ELSE 0 END) as sum_qty,
        SUM(CASE WHEN COALESCE(sr.status, 'COMPLETED') = 'COMPLETED' THEN COALESCE(sr.discount, 0) ELSE 0 END) as sum_discount,
        SUM(CASE WHEN COALESCE(sr.status, 'COMPLETED') = 'COMPLETED' THEN sr.total_cost ELSE 0 END) as sum_cost,
        SUM(CASE WHEN sr.status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled_count,
        SUM(CASE WHEN sr.status = 'CANCELLED' THEN sr.total_revenue ELSE 0 END) as sum_cancelled_revenue
      FROM sales_records sr
      JOIN products p ON p.id = sr.product_id
      ${whereSql}
    `, params);

    const total = Number(countResult?.total || 0);
    const totalPages = Math.ceil(total / limit);

    const records = await db.query(`
      SELECT 
        sr.id, sr.transaction_code, sr.product_id, sr.sale_date, sr.quantity,
        sr.unit_price_at_sale, sr.cost_price_at_sale, 
        COALESCE(sr.discount, 0) as discount,
        sr.total_revenue, sr.total_cost, sr.profit,
        COALESCE(sr.status, 'COMPLETED') as status,
        sr.cancel_reason, sr.cancelled_at,
        sr.note, sr.created_at,
        p.name as product_name, p.sku,
        c.name as category_name,
        pt.name as product_type_name,
        u.full_name as seller_name,
        canceller.full_name as canceller_name
      FROM sales_records sr
      JOIN products p ON p.id = sr.product_id
      JOIN categories c ON c.id = p.category_id
      JOIN product_types pt ON pt.id = p.product_type_id
      LEFT JOIN users u ON u.id = sr.created_by
      LEFT JOIN users canceller ON canceller.id = sr.cancelled_by
      ${whereSql}
      ORDER BY sr.sale_date DESC, sr.id DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    return NextResponse.json({
      success: true,
      data: records,
      summary: {
        totalRevenue: Number(countResult?.sum_revenue || 0),
        totalCost: Number(countResult?.sum_cost || 0),
        totalProfit: Number(countResult?.sum_profit || 0),
        totalQuantity: Number(countResult?.sum_qty || 0),
        totalDiscount: Number(countResult?.sum_discount || 0),
        cancelledCount: Number(countResult?.cancelled_count || 0),
        cancelledRevenue: Number(countResult?.sum_cancelled_revenue || 0),
      },
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
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
    if (!user) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Vui lòng đăng nhập để ghi nhận bán.' } },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { saleDate, items, productId, quantity, discountThousand, note } = body;

    const date = saleDate || new Date().toISOString().split('T')[0];

    let salesItems: Array<{ productId: number; quantity: number; discountThousand?: number; note?: string }> = [];

    if (Array.isArray(items) && items.length > 0) {
      salesItems = items.map((it: any) => ({
        productId: Number(it.productId),
        quantity: parseInt(it.quantity, 10),
        discountThousand: parseFloat(it.discountThousand || '0') || 0,
        note: it.note ? String(it.note).trim() : undefined,
      }));
    } else if (productId) {
      salesItems = [{
        productId: Number(productId),
        quantity: parseInt(quantity, 10),
        discountThousand: parseFloat(discountThousand || '0') || 0,
        note: note ? String(note).trim() : undefined,
      }];
    }

    if (salesItems.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'Vui lòng chọn ít nhất 1 sản phẩm để bán.' } },
        { status: 400 }
      );
    }

    // Execute safe atomic transaction for all items using FIFO COGS Allocation
    const results = await db.transaction(async (tx) => {
      const recordedList: any[] = [];

      for (const item of salesItems) {
        if (!item.productId || isNaN(item.quantity) || item.quantity <= 0) {
          throw new Error('Số lượng bán của mỗi sản phẩm phải lớn hơn 0.');
        }

        // 1. Check product existence and status
        const product = await tx.queryOne<any>(`
          SELECT id, sku, name, current_stock, current_selling_price, current_cost_price, status
          FROM products
          WHERE id = ?
        `, [item.productId]);

        if (!product) {
          throw new Error(`Sản phẩm (ID: ${item.productId}) không tồn tại trong hệ thống.`);
        }

        if (product.status !== 'ACTIVE') {
          throw new Error(`Sản phẩm '${product.name}' đang ở trạng thái ngừng kinh doanh.`);
        }

        // 2. Check stock availability
        if (Number(product.current_stock) < item.quantity) {
          throw new Error(`Sản phẩm '${product.name}' tồn kho không đủ (Hiện còn: ${product.current_stock}, Yêu cầu: ${item.quantity}).`);
        }

        // 3. Resolve historical selling price at the sale date
        const priceRecord = await tx.queryOne<any>(`
          SELECT price FROM price_history
          WHERE product_id = ? AND effective_from <= ?
          ORDER BY effective_from DESC, id DESC
          LIMIT 1
        `, [item.productId, date]);

        const unitPrice = priceRecord ? Number(priceRecord.price) : Number(product.current_selling_price);

        const discountAmount = Math.max(0, (item.discountThousand || 0) * 1000);
        const subtotal = item.quantity * unitPrice;
        const totalRevenue = Math.max(0, subtotal - discountAmount);

        // 4. FIFO COGS ALLOCATION ENGINE
        let availableLots = await tx.query<any>(`
          SELECT id, lot_code, quantity_received, quantity_remaining, unit_cost, purchase_date
          FROM inventory_lots
          WHERE product_id = ? AND quantity_remaining > 0
          ORDER BY purchase_date ASC, id ASC
        `, [item.productId]);

        const totalLotQty = availableLots.reduce((acc, l) => acc + Number(l.quantity_remaining), 0);

        if (totalLotQty < item.quantity) {
          const missingQty = item.quantity - totalLotQty;
          const emergencyLotCode = `LOT-BASE-${product.sku}-${Date.now().toString().slice(-4)}`;
          const insertEmergency = await tx.execute(`
            INSERT INTO inventory_lots (lot_code, product_id, purchase_date, quantity_received, quantity_remaining, unit_cost, note, created_by)
            VALUES (?, ?, ?, ?, ?, ?, 'Khởi tạo lô bổ sung tự động', ?)
          `, [emergencyLotCode, product.id, date, missingQty, missingQty, product.current_cost_price, user.id]);

          availableLots.push({
            id: Number(insertEmergency.lastInsertId),
            lot_code: emergencyLotCode,
            quantity_received: missingQty,
            quantity_remaining: missingQty,
            unit_cost: Number(product.current_cost_price),
            purchase_date: date,
          });
        }

        let remainingNeeded = item.quantity;
        let accumulatedCOGS = 0;
        const allocationsToInsert: Array<{ lotId: number; lotCode: string; qty: number; unitCost: number; totalCost: number }> = [];

        for (const lot of availableLots) {
          if (remainingNeeded <= 0) break;

          const lotRemaining = Number(lot.quantity_remaining);
          const takeQty = Math.min(remainingNeeded, lotRemaining);
          const lotCost = takeQty * Number(lot.unit_cost);
          accumulatedCOGS += lotCost;
          remainingNeeded -= takeQty;

          const updatedLotRemaining = lotRemaining - takeQty;

          await tx.execute(`
            UPDATE inventory_lots
            SET quantity_remaining = ?
            WHERE id = ?
          `, [updatedLotRemaining, lot.id]);

          allocationsToInsert.push({
            lotId: lot.id,
            lotCode: lot.lot_code,
            qty: takeQty,
            unitCost: Number(lot.unit_cost),
            totalCost: lotCost,
          });
        }

        if (remainingNeeded > 0) {
          throw new Error(`Không đủ số lượng trong các lô hàng để phân bổ FIFO cho sản phẩm '${product.name}'.`);
        }

        const totalCost = accumulatedCOGS;
        const profit = totalRevenue - totalCost;
        const costPriceAtSale = item.quantity > 0 ? (totalCost / item.quantity) : Number(product.current_cost_price);

        const cleanDate = date.replace(/-/g, '');
        const randomSuffix = Math.floor(1000 + Math.random() * 9000);
        const txCode = `TX-${cleanDate}-${Date.now().toString().slice(-4)}${randomSuffix}`;

        // 5. Insert sales_records
        const saleInfo = await tx.execute(`
          INSERT INTO sales_records (
            transaction_code, product_id, sale_date, quantity,
            unit_price_at_sale, cost_price_at_sale, discount, total_revenue, total_cost, profit,
            note, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          txCode,
          item.productId,
          date,
          item.quantity,
          unitPrice,
          costPriceAtSale,
          discountAmount,
          totalRevenue,
          totalCost,
          profit,
          item.note || null,
          user.id
        ]);

        const saleRecordId = Number(saleInfo.lastInsertId);

        // 6. Insert sale_cost_allocations
        for (const alloc of allocationsToInsert) {
          await tx.execute(`
            INSERT INTO sale_cost_allocations (sale_id, inventory_lot_id, quantity, unit_cost, total_cost)
            VALUES (?, ?, ?, ?, ?)
          `, [saleRecordId, alloc.lotId, alloc.qty, alloc.unitCost, alloc.totalCost]);
        }

        const newStockBalance = Number(product.current_stock) - item.quantity;

        // 7. Insert stock_movements (Type = SALE)
        await tx.execute(`
          INSERT INTO stock_movements (
            product_id, movement_type, quantity_change, balance_after,
            movement_date, reference_type, reference_id, note, created_by
          ) VALUES (?, 'SALE', ?, ?, ?, 'sales_records', ?, ?, ?)
        `, [
          item.productId,
          -item.quantity,
          newStockBalance,
          date,
          saleRecordId,
          `Ghi nhận bán mã ${txCode} (FIFO: ${allocationsToInsert.map(a => `${a.qty}x${a.lotCode}`).join(', ')})` +
            (discountAmount > 0 ? ` (Giảm ${discountAmount.toLocaleString('vi-VN')}đ)` : ''),
          user.id
        ]);

        // 8. Calculate weighted average cost of remaining lots
        const remainingLotsSummary = await tx.queryOne<any>(`
          SELECT 
            COALESCE(SUM(quantity_remaining), 0) as total_rem,
            COALESCE(SUM(quantity_remaining * unit_cost), 0) as total_val
          FROM inventory_lots
          WHERE product_id = ? AND quantity_remaining > 0
        `, [item.productId]);

        const totalRem = Number(remainingLotsSummary?.total_rem || 0);
        const totalVal = Number(remainingLotsSummary?.total_val || 0);
        const weightedAvgCost = totalRem > 0
          ? Math.round(totalVal / totalRem)
          : Number(product.current_cost_price);

        // 9. Update product cached stock & weighted average cost
        await tx.execute(`
          UPDATE products
          SET current_stock = ?,
              current_cost_price = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [newStockBalance, weightedAvgCost, item.productId]);

        // 10. Insert Audit Log
        await tx.execute(`
          INSERT INTO audit_logs (user_id, action, entity_name, entity_id, new_value_json)
          VALUES (?, 'RECORD_SALE_FIFO', 'SALES_RECORDS', ?, ?)
        `, [user.id, saleRecordId.toString(), JSON.stringify({
          transaction_code: txCode,
          product_sku: product.sku,
          product_name: product.name,
          quantity: item.quantity,
          unit_price_at_sale: unitPrice,
          discount: discountAmount,
          total_revenue: totalRevenue,
          cogs: totalCost,
          profit: profit,
          allocations: allocationsToInsert,
          balance_after: newStockBalance,
        })]);

        recordedList.push({
          id: saleRecordId,
          transaction_code: txCode,
          product_name: product.name,
          sku: product.sku,
          quantity: item.quantity,
          unit_price_at_sale: unitPrice,
          discount: discountAmount,
          total_revenue: totalRevenue,
          total_cost: totalCost,
          profit: profit,
          allocations: allocationsToInsert,
          remaining_stock: newStockBalance,
          sale_date: date,
        });
      }

      return recordedList;
    });

    const totalBatchRevenue = results.reduce((acc, r) => acc + r.total_revenue, 0);

    return NextResponse.json({
      success: true,
      data: results.length === 1 ? results[0] : results,
      totalRevenue: totalBatchRevenue,
      count: results.length,
      message: `Đã ghi nhận bán thành công ${results.length} sản phẩm theo chuẩn FIFO.`,
    }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'SALE_ERROR', message: error.message || 'Không thể ghi nhận giao dịch.' },
      },
      { status: 400 }
    );
  }
}
