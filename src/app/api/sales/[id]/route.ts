import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

function getOrderDisplayTitle(productNames: string[]): string {
  if (!productNames || productNames.length === 0) return 'Đơn hàng';
  const unique = [...new Set(productNames.filter(Boolean))];
  if (unique.length === 0) return 'Đơn hàng';
  if (unique.length === 1) return unique[0];
  return `${unique[0]} + ${unique.length - 1} sản phẩm khác`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const cleanId = id ? id.trim() : '';

    if (!cleanId) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_ID', message: 'Mã đơn hàng không hợp lệ.' } },
        { status: 400 }
      );
    }

    const isNumeric = /^\d+$/.test(cleanId);
    const numericId = isNumeric ? parseInt(cleanId, 10) : null;

    // 1. Resolve canonical transaction_code if numeric ID was provided
    let canonicalTxCode = cleanId;
    if (numericId !== null) {
      const record = await db.queryOne<any>(`
        SELECT transaction_code FROM sales_records WHERE id = ?
      `, [numericId]);
      if (record && record.transaction_code) {
        canonicalTxCode = record.transaction_code;
      }
    }

    // 2. Fetch all line items belonging to this canonical transaction code or ID
    const items = canonicalTxCode
      ? await db.query<any>(`
          SELECT 
            sr.id, sr.transaction_code, sr.product_id, sr.sale_date, sr.quantity,
            sr.unit_price_at_sale, sr.cost_price_at_sale, 
            COALESCE(sr.discount, 0) as discount,
            sr.total_revenue, sr.total_cost, sr.profit,
            COALESCE(sr.status, 'COMPLETED') as status,
            COALESCE(sr.payment_method, 'CASH') as payment_method,
            sr.cancel_reason, sr.cancelled_at,
            sr.note, sr.created_at,
            p.name as product_name, p.sku,
            c.name as category_name,
            pt.name as product_type_name,
            u.full_name as seller_name,
            canceller.full_name as canceller_name
          FROM sales_records sr
          JOIN products p ON p.id = sr.product_id
          LEFT JOIN categories c ON c.id = p.category_id
          LEFT JOIN product_types pt ON pt.id = p.product_type_id
          LEFT JOIN users u ON u.id = sr.created_by
          LEFT JOIN users canceller ON canceller.id = sr.cancelled_by
          WHERE sr.transaction_code = ?
          ORDER BY sr.id ASC
        `, [canonicalTxCode])
      : await db.query<any>(`
          SELECT 
            sr.id, sr.transaction_code, sr.product_id, sr.sale_date, sr.quantity,
            sr.unit_price_at_sale, sr.cost_price_at_sale, 
            COALESCE(sr.discount, 0) as discount,
            sr.total_revenue, sr.total_cost, sr.profit,
            COALESCE(sr.status, 'COMPLETED') as status,
            COALESCE(sr.payment_method, 'CASH') as payment_method,
            sr.cancel_reason, sr.cancelled_at,
            sr.note, sr.created_at,
            p.name as product_name, p.sku,
            c.name as category_name,
            pt.name as product_type_name,
            u.full_name as seller_name,
            canceller.full_name as canceller_name
          FROM sales_records sr
          JOIN products p ON p.id = sr.product_id
          LEFT JOIN categories c ON c.id = p.category_id
          LEFT JOIN product_types pt ON pt.id = p.product_type_id
          LEFT JOIN users u ON u.id = sr.created_by
          LEFT JOIN users canceller ON canceller.id = sr.cancelled_by
          WHERE sr.id = ?
          ORDER BY sr.id ASC
        `, [numericId]);

    if (!items || items.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'ORDER_NOT_FOUND', message: `Không tìm thấy đơn hàng [${cleanId}].` } },
        { status: 404 }
      );
    }

    const first = items[0];
    const totalItems = items.reduce((sum, it) => sum + Number(it.quantity || 0), 0);
    const finalAmount = items.reduce((sum, it) => sum + Number(it.total_revenue || 0), 0);
    const totalDiscount = items.reduce((sum, it) => sum + Number(it.discount || 0), 0);
    const totalCost = items.reduce((sum, it) => sum + Number(it.total_cost || 0), 0);
    const totalProfit = items.reduce((sum, it) => sum + Number(it.profit || 0), 0);
    const isCancelled = items.some((it) => it.status === 'CANCELLED');
    const productNames = items.map((it) => it.product_name).filter(Boolean);
    const displayTitle = getOrderDisplayTitle(productNames);

    const order = {
      id: first.id,
      client_order_id: first.transaction_code,
      order_code: first.transaction_code,
      transaction_code: first.transaction_code,
      sale_date: first.sale_date,
      total_items: totalItems,
      total_amount: finalAmount + totalDiscount,
      total_discount: totalDiscount,
      final_amount: finalAmount,
      total_cost: totalCost,
      profit: totalProfit,
      payment_method: first.payment_method || 'CASH',
      status: isCancelled ? 'CANCELLED' : 'COMPLETED',
      sync_status: 'SYNCED',
      note: first.note || null,
      cancel_reason: first.cancel_reason || null,
      cancelled_at: first.cancelled_at || null,
      seller_name: first.seller_name || null,
      created_by: first.created_by ?? null,
      created_at: first.created_at || first.sale_date,
      product_names: productNames,
      display_title: displayTitle,
    };

    return NextResponse.json({
      success: true,
      data: {
        order,
        items,
        displayTitle,
      }
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: error.message || 'Lỗi truy vấn chi tiết đơn hàng.' } },
      { status: 500 }
    );
  }
}
