import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Chỉ Quản trị viên mới có quyền hủy phiếu bán hàng.' } },
        { status: 403 }
      );
    }

    const { id } = await params;
    const cleanId = id ? id.trim() : '';

    if (!cleanId) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_ID', message: 'Mã hoặc ID giao dịch không hợp lệ.' } },
        { status: 400 }
      );
    }

    const isNumeric = /^\d+$/.test(cleanId);
    const numericId = isNumeric ? parseInt(cleanId, 10) : null;

    const body = await request.json().catch(() => ({}));
    const reason = body.reason?.trim() || 'Khách hủy mua / Tạo nhầm phiếu';

    const cancelResult = await db.transaction(async (tx) => {
      // 1. Fetch target sale record by transaction_code OR id
      const initialSale = await tx.queryOne<any>(`
        SELECT id, transaction_code, product_id, sale_date, quantity, 
               unit_price_at_sale, discount, total_revenue, total_cost, profit, status
        FROM sales_records
        WHERE transaction_code = ? OR (id = ? AND ? IS NOT NULL)
        ORDER BY id ASC
        LIMIT 1
      `, [cleanId, numericId, numericId]);

      if (!initialSale) {
        throw new Error(`Không tìm thấy phiếu bán hàng [${cleanId}] cần hủy.`);
      }

      const canonicalTxCode = initialSale.transaction_code;

      // 2. Fetch all sales records sharing this transaction code or ID (multi-item order)
      const allRecordsForOrder = await tx.query<any>(`
        SELECT sr.id, sr.transaction_code, sr.product_id, sr.sale_date, sr.quantity, 
               sr.unit_price_at_sale, sr.discount, sr.total_revenue, sr.total_cost, sr.profit, sr.status,
               p.sku as product_sku, p.name as product_name, p.current_cost_price
        FROM sales_records sr
        JOIN products p ON p.id = sr.product_id
        WHERE sr.transaction_code = ? OR (sr.id = ? AND ? IS NOT NULL)
        ORDER BY sr.id ASC
      `, [canonicalTxCode, numericId, numericId]);

      const recordsToCancel = allRecordsForOrder.filter((r) => r.status !== 'CANCELLED');

      // Idempotent check: if all items already cancelled, return success without duplicate restoration
      if (recordsToCancel.length === 0) {
        return {
          saleId: initialSale.id,
          transactionCode: canonicalTxCode,
          alreadyCancelled: true,
          quantityRestored: 0,
          restoredQuantity: 0,
          restoredItemsCount: 0,
          cancelledCount: 0,
          cancelledRevenue: 0,
          message: `Đơn hàng [${canonicalTxCode}] đã được hủy trước đó.`,
        };
      }

      let totalQuantityRestored = 0;
      let totalCancelledRevenue = 0;
      let lastNewStock = 0;
      const now = new Date().toISOString().split('T')[0];

      for (const sale of recordsToCancel) {
        // Fetch current product stock
        const product = await tx.queryOne<any>(`
          SELECT id, sku, name, current_stock, current_cost_price
          FROM products
          WHERE id = ?
        `, [sale.product_id]);

        if (!product) continue;

        const saleQty = Number(sale.quantity || 0);

        // 3. Revert FIFO Lot allocations for this sale item
        const allocations = await tx.query<any>(`
          SELECT inventory_lot_id, quantity, unit_cost, total_cost
          FROM sale_cost_allocations
          WHERE sale_id = ?
        `, [sale.id]);

        let lotQtyRestored = 0;
        if (allocations && allocations.length > 0) {
          for (const alloc of allocations) {
            const allocQty = Number(alloc.quantity || 0);
            await tx.execute(`
              UPDATE inventory_lots
              SET quantity_remaining = quantity_remaining + ?
              WHERE id = ?
            `, [allocQty, alloc.inventory_lot_id]);
            lotQtyRestored += allocQty;
          }
        }

        // Safety fallback if no lot allocation was previously recorded for this sale item
        if (lotQtyRestored < saleQty) {
          const deficit = saleQty - lotQtyRestored;
          const fallbackLot = await tx.queryOne<any>(`
            SELECT id FROM inventory_lots
            WHERE product_id = ? AND quantity_remaining >= 0
            ORDER BY purchase_date DESC, id DESC
            LIMIT 1
          `, [sale.product_id]);

          if (fallbackLot) {
            await tx.execute(`
              UPDATE inventory_lots
              SET quantity_remaining = quantity_remaining + ?
              WHERE id = ?
            `, [deficit, fallbackLot.id]);
          } else {
            const emergencyLotCode = `LOT-RESTORE-${product.sku}-${Date.now().toString().slice(-4)}`;
            await tx.execute(`
              INSERT INTO inventory_lots (lot_code, product_id, purchase_date, quantity_received, quantity_remaining, unit_cost, note, created_by)
              VALUES (?, ?, ?, ?, ?, ?, 'Lô hoàn tồn tự động do hủy đơn', ?)
            `, [emergencyLotCode, sale.product_id, now, deficit, deficit, product.current_cost_price, user.id]);
          }
        }

        // 4. Update Product Stock and Recalculate Weighted Average Cost
        const newStock = Number(product.current_stock) + saleQty;
        lastNewStock = newStock;

        const remainingLotsSummary = await tx.queryOne<any>(`
          SELECT 
            COALESCE(SUM(quantity_remaining), 0) as total_rem,
            COALESCE(SUM(quantity_remaining * unit_cost), 0) as total_val
          FROM inventory_lots
          WHERE product_id = ? AND quantity_remaining > 0
        `, [sale.product_id]);

        const totalRem = Number(remainingLotsSummary?.total_rem || 0);
        const totalVal = Number(remainingLotsSummary?.total_val || 0);

        const weightedAvgCost = totalRem > 0
          ? Math.round(totalVal / totalRem)
          : Number(product.current_cost_price);

        await tx.execute(`
          UPDATE products
          SET current_stock = ?,
              current_cost_price = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [newStock, weightedAvgCost, sale.product_id]);

        // 5. Create Stock Movement (Type = RETURN)
        await tx.execute(`
          INSERT INTO stock_movements (
            product_id, movement_type, quantity_change, balance_after,
            movement_date, reference_type, reference_id, note, created_by
          ) VALUES (?, 'RETURN', ?, ?, ?, 'sales_records', ?, ?, ?)
        `, [
          sale.product_id,
          saleQty,
          newStock,
          now,
          sale.id,
          `Hoàn tồn do hủy phiếu bán [${sale.transaction_code}]: ${reason}`,
          user.id
        ]);

        // 6. Update Sales Record status to CANCELLED
        await tx.execute(`
          UPDATE sales_records
          SET status = 'CANCELLED',
              cancel_reason = ?,
              cancelled_at = CURRENT_TIMESTAMP,
              cancelled_by = ?
          WHERE id = ?
        `, [reason, user.id, sale.id]);

        // 7. Audit Log
        await tx.execute(`
          INSERT INTO audit_logs (user_id, action, entity_name, entity_id, new_value_json)
          VALUES (?, 'CANCEL_SALE', 'SALES_RECORDS', ?, ?)
        `, [user.id, sale.id.toString(), JSON.stringify({
          transaction_code: sale.transaction_code,
          product_sku: sale.product_sku,
          product_name: sale.product_name,
          quantity_restored: saleQty,
          revenue_cancelled: sale.total_revenue,
          cogs_cancelled: sale.total_cost,
          profit_cancelled: sale.profit,
          reason: reason,
          new_stock: newStock,
        })]);

        totalQuantityRestored += saleQty;
        totalCancelledRevenue += Number(sale.total_revenue || 0);
      }

      return {
        saleId: initialSale.id,
        transactionCode: canonicalTxCode,
        productName: recordsToCancel[0]?.product_name || 'Sản phẩm',
        quantityRestored: totalQuantityRestored,
        restoredQuantity: totalQuantityRestored,
        restoredItemsCount: recordsToCancel.length,
        cancelledCount: recordsToCancel.length,
        newStock: lastNewStock,
        cancelledRevenue: totalCancelledRevenue,
      };
    });

    return NextResponse.json({
      success: true,
      data: cancelResult,
      message: `Đã hủy thành công đơn hàng [${cancelResult.transactionCode}] và hoàn lại ${cancelResult.quantityRestored} sản phẩm vào kho.`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { code: 'CANCEL_ERROR', message: error.message || 'Lỗi hủy phiếu bán hàng.' } },
      { status: 400 }
    );
  }
}
