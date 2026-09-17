import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Vui lòng đăng nhập.' } },
        { status: 401 }
      );
    }

    // Role-based authorization: Only ADMIN can resolve conflicts or adjust stock
    if (user.role !== 'ADMIN') {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Chỉ Quản trị viên (ADMIN) mới có quyền giải quyết xung đột dữ liệu và điều chỉnh kho.',
          },
        },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { client_transaction_id, action, resolution_note, restock_quantity, product_id } = body;

    if (!client_transaction_id || !action) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Thiếu client_transaction_id hoặc action giải quyết.' },
        },
        { status: 400 }
      );
    }

    const resolutionResult = await db.transaction(async (tx) => {
      const now = new Date().toISOString();

      if (action === 'RESTOCK_AND_ACCEPT') {
        if (!product_id || !restock_quantity || restock_quantity <= 0) {
          throw new Error('Hành động RESTOCK_AND_ACCEPT yêu cầu product_id và restock_quantity > 0.');
        }

        const product = await tx.queryOne<any>('SELECT id, sku, name, current_stock, current_cost_price FROM products WHERE id = ?', [product_id]);
        if (!product) {
          throw new Error('Sản phẩm không tồn tại.');
        }

        const qty = parseInt(restock_quantity, 10);
        const newStock = Number(product.current_stock) + qty;
        const cleanDate = now.split('T')[0].replace(/-/g, '');
        const lotCode = `LOT-RES-${cleanDate}-${product.sku}-${Date.now().toString().slice(-4)}`;

        // 1. Create emergency inventory lot for restock
        await tx.execute(`
          INSERT INTO inventory_lots (
            lot_code, product_id, purchase_date, quantity_received, quantity_remaining,
            unit_cost, note, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          lotCode,
          product.id,
          now.split('T')[0],
          qty,
          qty,
          product.current_cost_price,
          `Bổ sung tồn kho để giải quyết xung đột (${client_transaction_id})`,
          user.id,
        ]);

        // 2. Update stock & cost
        await tx.execute(`
          UPDATE products
          SET current_stock = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [newStock, product.id]);

        // 3. Record stock movement
        await tx.execute(`
          INSERT INTO stock_movements (
            product_id, movement_type, quantity_change, balance_after,
            movement_date, reference_type, note, created_by
          ) VALUES (?, 'ADJUSTMENT', ?, ?, ?, 'conflict_resolution', ?, ?)
        `, [
          product.id,
          qty,
          newStock,
          now.split('T')[0],
          `Nhập bổ sung ${qty} SP giải quyết xung đột ${client_transaction_id}: ${resolution_note || ''}`,
          user.id,
        ]);

        // 4. Audit Log
        await tx.execute(`
          INSERT INTO audit_logs (user_id, action, entity_name, entity_id, new_value_json)
          VALUES (?, 'CONFLICT_RESOLVE_RESTOCK', 'PRODUCTS', ?, ?)
        `, [
          user.id,
          product.id.toString(),
          JSON.stringify({
            client_transaction_id,
            restock_quantity: qty,
            balance_after: newStock,
            note: resolution_note,
          }),
        ]);

        return {
          action: 'RESTOCK_AND_ACCEPT',
          restocked_quantity: qty,
          new_stock: newStock,
          message: `Đã bổ sung ${qty} sản phẩm vào kho thành công. Giao dịch có thể thử lại đồng bộ.`,
        };
      } else if (action === 'CANCEL_TRANSACTION') {
        // Record cancellation audit
        await tx.execute(`
          INSERT INTO audit_logs (user_id, action, entity_name, entity_id, new_value_json)
          VALUES (?, 'CONFLICT_RESOLVE_CANCEL', 'SYNC_CONFLICT', ?, ?)
        `, [
          user.id,
          client_transaction_id,
          JSON.stringify({
            resolution: 'CANCEL_TRANSACTION',
            note: resolution_note || 'Hủy đơn hàng do không thể thỏa mãn tồn kho.',
            resolved_by: user.id,
          }),
        ]);

        return {
          action: 'CANCEL_TRANSACTION',
          message: `Giao dịch ${client_transaction_id} đã được xác nhận hủy an toàn kèm audit log.`,
        };
      } else if (action === 'DISMISS') {
        await tx.execute(`
          INSERT INTO audit_logs (user_id, action, entity_name, entity_id, new_value_json)
          VALUES (?, 'CONFLICT_RESOLVE_DISMISS', 'SYNC_CONFLICT', ?, ?)
        `, [
          user.id,
          client_transaction_id,
          JSON.stringify({
            resolution: 'DISMISS',
            note: resolution_note || 'Bỏ qua xung đột theo yêu cầu của Quản trị viên.',
            resolved_by: user.id,
          }),
        ]);

        return {
          action: 'DISMISS',
          message: `Đã bỏ qua cảnh báo xung đột ${client_transaction_id}.`,
        };
      } else {
        throw new Error(`Hành động giải quyết '${action}' không hợp lệ.`);
      }
    });

    return NextResponse.json({
      success: true,
      data: resolutionResult,
      resolved_at: new Date().toISOString(),
      resolved_by: { id: user.id, full_name: user.full_name },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'CONFLICT_RESOLUTION_ERROR', message: error.message || 'Lỗi khi giải quyết xung đột.' },
      },
      { status: 400 }
    );
  }
}
