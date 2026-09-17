import { ITransactionClient } from '../database/types';
import offlineTransactionService, { OfflineTransactionService } from './OfflineTransactionService';
import outboxService, { OutboxService } from './OutboxService';
import { 
  CreateSaleOrderInput, 
  SaleOrderResult, 
  CancelSaleOrderInput,
  CancelSaleOrderResult,
  ValidationError, 
  InsufficientStockError 
} from './types';
import { SalesOrder } from '../database/types';
import { SalesRecord } from '../types/domain';
import logger from '../utils/logger';

export class OfflineSaleService {
  private txService: OfflineTransactionService;
  private outbox: OutboxService;

  constructor(txService?: OfflineTransactionService, outbox?: OutboxService) {
    this.txService = txService || offlineTransactionService;
    this.outbox = outbox || outboxService;
  }

  async createSaleOrder(input: CreateSaleOrderInput): Promise<SaleOrderResult> {
    if (!input.items || input.items.length === 0) {
      throw new ValidationError('Giỏ hàng không có sản phẩm nào để thanh toán.');
    }

    const clientOrderId = input.clientOrderId || this.txService.generateId('ord');
    const now = new Date();
    const dateStr = input.saleDate || now.toISOString().slice(0, 10);
    const timeSuffix = now.getTime().toString().slice(-4);
    const orderCode = `ORD-OFFLINE-${dateStr.replace(/-/g, '')}-${timeSuffix}`;

    return await this.txService.executeAtomic(
      clientOrderId,
      async (tx: ITransactionClient) => {
        let orderSubtotal = 0;
        let totalItems = 0;
        const lineAllocations: Array<{
          product: { id: number; sku: string; name: string; current_stock: number; current_cost_price: number; current_selling_price: number; status: string };
          quantity: number;
          unitPrice: number;
          costPrice: number;
          lineSubtotal: number;
          lineDiscount: number;
          lineRevenue: number;
          lineCost: number;
          profit: number;
          note?: string;
          clientLineTxId: string;
          lineTxCode: string;
        }> = [];

        // --- STEP 1: VALIDATION & PRICING SNAPSHOT FOR ALL ITEMS ---
        for (const item of input.items) {
          if (!item.productId || isNaN(item.quantity) || item.quantity <= 0) {
            throw new ValidationError('Số lượng bán của từng sản phẩm phải lớn hơn 0.');
          }

          // Fetch product
          const product = await tx.getFirstAsync<{
            id: number;
            sku: string;
            name: string;
            current_stock: number;
            current_cost_price: number;
            current_selling_price: number;
            status: string;
          }>('SELECT id, sku, name, current_stock, current_cost_price, current_selling_price, status FROM products WHERE id = ?', [item.productId]);

          if (!product) {
            throw new ValidationError(`Sản phẩm với ID ${item.productId} không tồn tại trong kho.`);
          }

          if (product.status !== 'ACTIVE') {
            throw new ValidationError(`Sản phẩm '${product.name}' đang ở trạng thái ngừng kinh doanh.`);
          }

          // Check effective stock available in local SQLite
          const effectiveStock = Number(product.current_stock);

          if (effectiveStock < item.quantity) {
            throw new InsufficientStockError(product.name, product.id, effectiveStock, item.quantity);
          }

          // Resolve historical selling price snapshot as of saleDate
          let unitPrice = item.unitPrice;
          if (unitPrice === undefined) {
            const priceRow = await tx.getFirstAsync<{ price: number }>(`
              SELECT price FROM price_history 
              WHERE product_id = ? AND effective_from <= ? 
              ORDER BY effective_from DESC, id DESC LIMIT 1
            `, [product.id, dateStr]);
            unitPrice = priceRow ? Number(priceRow.price) : Number(product.current_selling_price);
          }

          // FIFO COGS & Lot Allocation
          let costPrice = product.current_cost_price;
          let availableLots = await tx.getAllAsync<{
            id: number;
            lot_code: string;
            quantity_remaining: number;
            unit_cost: number;
          }>(`
            SELECT id, lot_code, quantity_remaining, unit_cost 
            FROM inventory_lots 
            WHERE product_id = ? AND quantity_remaining > 0 
            ORDER BY purchase_date ASC, id ASC
          `, [product.id]);

          let remainingNeeded = item.quantity;
          let accumulatedCost = 0;

          for (const lot of availableLots) {
            if (remainingNeeded <= 0) break;
            const take = Math.min(remainingNeeded, lot.quantity_remaining);
            accumulatedCost += take * lot.unit_cost;
            remainingNeeded -= take;

            await tx.runAsync('UPDATE inventory_lots SET quantity_remaining = ? WHERE id = ?', [
              lot.quantity_remaining - take,
              lot.id
            ]);
          }

          if (item.quantity > 0 && remainingNeeded < item.quantity) {
            costPrice = accumulatedCost / (item.quantity - remainingNeeded);
          }

          // Discount validation per item
          if (item.discount !== undefined && item.discount < 0) {
            throw new ValidationError(`Giảm giá sản phẩm '${product.name}' không được là số âm.`);
          }
          if (item.discountThousand !== undefined && item.discountThousand < 0) {
            throw new ValidationError(`Giảm giá sản phẩm '${product.name}' không được là số âm.`);
          }

          let itemDiscount = 0;
          if (item.discount !== undefined) {
            itemDiscount = Math.max(0, Math.round(item.discount));
          } else if (item.discountThousand !== undefined) {
            itemDiscount = Math.max(0, Math.round(item.discountThousand * 1000));
          }

          const lineSubtotal = item.quantity * unitPrice;
          if (itemDiscount > lineSubtotal) {
            throw new ValidationError(
              `Giảm giá sản phẩm '${product.name}' (${itemDiscount.toLocaleString('vi-VN')}đ) không được vượt quá thành tiền (${lineSubtotal.toLocaleString('vi-VN')}đ).`
            );
          }

          const lineRevenue = Math.max(0, lineSubtotal - itemDiscount);
          const lineCost = item.quantity * costPrice;
          const profit = lineRevenue - lineCost;

          orderSubtotal += lineSubtotal;
          totalItems += item.quantity;

          const clientLineTxId = this.txService.generateId('line');
          const lineTxCode = `${orderCode}-P${product.id}`;

          lineAllocations.push({
            product,
            quantity: item.quantity,
            unitPrice,
            costPrice,
            lineSubtotal,
            lineDiscount: itemDiscount,
            lineRevenue,
            lineCost,
            profit,
            note: item.note,
            clientLineTxId,
            lineTxCode,
          });
        }

        // --- ORDER-LEVEL DISCOUNT VALIDATION & PROPORTIONAL ALLOCATION ---
        if (input.totalDiscount !== undefined && input.totalDiscount < 0) {
          throw new ValidationError('Tổng giảm giá đơn hàng không được là số âm.');
        }

        let totalDiscount = Math.max(0, Math.round(input.totalDiscount || 0));
        if (totalDiscount > orderSubtotal) {
          throw new ValidationError(
            `Tổng giảm giá (${totalDiscount.toLocaleString('vi-VN')}đ) không được vượt quá tạm tính (${orderSubtotal.toLocaleString('vi-VN')}đ).`
          );
        }

        const sumItemDiscounts = lineAllocations.reduce((sum, l) => sum + l.lineDiscount, 0);

        if (totalDiscount > 0 && sumItemDiscounts === 0) {
          // Proportional allocation of order-level discount across items
          let allocatedSum = 0;
          for (let i = 0; i < lineAllocations.length; i++) {
            const line = lineAllocations[i];
            if (i === lineAllocations.length - 1) {
              line.lineDiscount = totalDiscount - allocatedSum;
            } else {
              const ratio = orderSubtotal > 0 ? (line.lineSubtotal / orderSubtotal) : 0;
              line.lineDiscount = Math.round(ratio * totalDiscount);
              allocatedSum += line.lineDiscount;
            }
            line.lineRevenue = Math.max(0, line.lineSubtotal - line.lineDiscount);
            line.profit = line.lineRevenue - line.lineCost;
          }
        } else if (sumItemDiscounts > 0) {
          totalDiscount = sumItemDiscounts;
        }

        const finalAmount = Math.max(0, orderSubtotal - totalDiscount);

        const paymentMethod = input.paymentMethod || 'CASH';
        const cashReceived = input.cashReceived !== undefined ? input.cashReceived : (paymentMethod === 'CASH' ? finalAmount : null);
        const cashChange = input.cashChange !== undefined ? input.cashChange : (cashReceived !== null ? Math.max(0, cashReceived - finalAmount) : null);

        // --- STEP 2: INSERT SALES ORDER HEADER ---
        let orderResult;
        try {
          orderResult = await tx.runAsync(`
            INSERT INTO sales_orders (
              client_order_id, order_code, sale_date, total_amount,
              total_discount, final_amount, total_items, payment_method,
              cash_received, cash_change, status, sync_status, note, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', 'PENDING', ?, ?, datetime('now'))
          `, [
            clientOrderId, orderCode, dateStr, orderSubtotal,
            totalDiscount, finalAmount, totalItems, paymentMethod,
            cashReceived, cashChange, input.note || null,
            input.createdBy || 1
          ]);
        } catch {
          // Backward-compatible fallback if payment columns are not yet present
          orderResult = await tx.runAsync(`
            INSERT INTO sales_orders (
              client_order_id, order_code, sale_date, total_amount,
              total_discount, final_amount, total_items, status,
              sync_status, note, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'COMPLETED', 'PENDING', ?, ?, datetime('now'))
          `, [
            clientOrderId, orderCode, dateStr, orderSubtotal,
            totalDiscount, finalAmount, totalItems, input.note || null,
            input.createdBy || 1
          ]);
        }

        const orderId = orderResult.lastInsertRowId;
        const createdRecords: SalesRecord[] = [];

        // --- STEP 3: INSERT SALES RECORDS & STOCK MOVEMENTS PER LINE ---
        for (const line of lineAllocations) {
          const saleInfo = await tx.runAsync(`
            INSERT INTO sales_records (
              order_id, client_order_id, client_transaction_id, transaction_code,
              product_id, sale_date, quantity, unit_price_at_sale, cost_price_at_sale,
              discount, total_revenue, total_cost, profit, status, sync_status,
              note, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', 'PENDING', ?, ?, datetime('now'))
          `, [
            orderId, clientOrderId, line.clientLineTxId, line.lineTxCode,
            line.product.id, dateStr, line.quantity, line.unitPrice, line.costPrice,
            line.lineDiscount, line.lineRevenue, line.lineCost, line.profit,
            line.note || null, input.createdBy || 1
          ]);

          const saleRecordId = saleInfo.lastInsertRowId;

          // Update local product stock
          const newStock = line.product.current_stock - line.quantity;
          await tx.runAsync(`
            UPDATE products 
            SET current_stock = ?, updated_at = datetime('now') 
            WHERE id = ?
          `, [newStock, line.product.id]);

          // Insert stock movement
          const clientMovementId = `mov-${line.clientLineTxId}`;
          await tx.runAsync(`
            INSERT INTO stock_movements (
              client_movement_id, product_id, movement_type, quantity_change,
              balance_after, movement_date, reference_type, reference_id,
              sync_status, note, created_by, created_at
            ) VALUES (?, ?, 'SALE', ?, ?, ?, 'sales_orders', ?, 'PENDING', ?, ?, datetime('now'))
          `, [
            clientMovementId, line.product.id, -line.quantity,
            newStock, dateStr, orderId.toString(),
            `Bán đơn ${orderCode}`, input.createdBy || 1
          ]);

          createdRecords.push({
            id: saleRecordId,
            client_transaction_id: line.clientLineTxId,
            transaction_code: line.lineTxCode,
            product_id: line.product.id,
            product_name: line.product.name,
            sku: line.product.sku,
            sale_date: dateStr,
            quantity: line.quantity,
            unit_price_at_sale: line.unitPrice,
            cost_price_at_sale: line.costPrice,
            discount: line.lineDiscount,
            total_revenue: line.lineRevenue,
            total_cost: line.lineCost,
            profit: line.profit,
            status: 'COMPLETED',
            sync_status: 'PENDING',
            note: line.note || null,
            created_by: input.createdBy || 1,
            created_at: now.toISOString(),
          });
        }

        // --- STEP 4: ENQUEUE MULTI-ITEM ORDER INTO OUTBOX QUEUE ---
        const outboxPayload = {
          client_order_id: clientOrderId,
          order_code: orderCode,
          sale_date: dateStr,
          total_amount: orderSubtotal,
          total_discount: totalDiscount,
          final_amount: finalAmount,
          total_items: totalItems,
          payment_method: paymentMethod,
          cash_received: cashReceived,
          cash_change: cashChange,
          items: lineAllocations.map((l) => ({
            client_transaction_id: l.clientLineTxId,
            product_id: l.product.id,
            sku: l.product.sku,
            quantity: l.quantity,
            unit_price_at_sale: l.unitPrice,
            cost_price_at_sale: l.costPrice,
            discount: l.lineDiscount,
            total_revenue: l.lineRevenue,
            note: l.note,
          })),
          note: input.note,
          created_by: input.createdBy || 1,
        };

        await this.outbox.enqueueMutation(tx, {
          client_mutation_id: clientOrderId,
          entity_type: 'SALE_ORDER',
          entity_id: clientOrderId,
          action: 'CREATE',
          payload: outboxPayload,
          payload_version: 1,
          created_at: now.toISOString(),
          user_id: input.createdBy || 1,
        });

        const createdOrder: SalesOrder = {
          id: orderId,
          client_order_id: clientOrderId,
          order_code: orderCode,
          sale_date: dateStr,
          total_amount: orderSubtotal,
          total_discount: totalDiscount,
          final_amount: finalAmount,
          total_items: totalItems,
          payment_method: paymentMethod,
          cash_received: cashReceived,
          cash_change: cashChange,
          status: 'COMPLETED',
          sync_status: 'PENDING',
          note: input.note || null,
          created_by: input.createdBy || 1,
          created_at: now.toISOString(),
          synced_at: null,
        };

        logger.info('OfflineSaleService', `Created multi-item sale order ${orderCode} with ${totalItems} items`);
        return { order: createdOrder, items: createdRecords };
      },
      {
        sql: 'SELECT id FROM sales_orders WHERE client_order_id = ?',
        params: [clientOrderId],
      }
    );
  }

  // --- SALE CANCELLATION & INVENTORY ROLLBACK WORKFLOW (WEB PARITY) ---
  async cancelSaleOrder(input: CancelSaleOrderInput): Promise<CancelSaleOrderResult> {
    if (!input.reason?.trim()) {
      throw new ValidationError('Vui lòng nhập lý do hủy đơn hàng.');
    }
    if (!input.orderId && !input.clientOrderId) {
      throw new ValidationError('Thiếu ID hoặc mã đơn hàng cần hủy.');
    }

    const cancelMutationId = this.txService.generateId('cancel');

    return await this.txService.executeAtomic(
      cancelMutationId,
      async (tx: ITransactionClient) => {
        // 1. Fetch order from sales_orders
        let order: SalesOrder | null = null;
        if (input.clientOrderId) {
          order = await tx.getFirstAsync<SalesOrder>(
            'SELECT * FROM sales_orders WHERE client_order_id = ?',
            [input.clientOrderId]
          );
        }
        if (!order && input.orderId) {
          order = await tx.getFirstAsync<SalesOrder>(
            'SELECT * FROM sales_orders WHERE id = ?',
            [input.orderId]
          );
        }

        // Fallback: Check standalone sales_records if not found in sales_orders
        let standaloneRecord: SalesRecord | null = null;
        if (!order) {
          if (input.clientOrderId) {
            standaloneRecord = await tx.getFirstAsync<SalesRecord>(
              'SELECT * FROM sales_records WHERE client_transaction_id = ? OR client_order_id = ? OR transaction_code = ?',
              [input.clientOrderId, input.clientOrderId, input.clientOrderId]
            );
          }
          if (!standaloneRecord && input.orderId) {
            standaloneRecord = await tx.getFirstAsync<SalesRecord>(
              'SELECT * FROM sales_records WHERE id = ? OR order_id = ?',
              [input.orderId, input.orderId]
            );
          }
        }

        if (!order && !standaloneRecord) {
          throw new ValidationError('Không tìm thấy đơn hàng cần hủy.');
        }

        const currentStatus = order ? order.status : standaloneRecord?.status;
        const orderCode = order ? order.order_code : standaloneRecord?.transaction_code;

        if (currentStatus === 'CANCELLED') {
          throw new ValidationError(`Đơn hàng [${orderCode}] đã được hủy trước đó.`);
        }

        // 2. Authorization & Account Isolation check
        const orderOwner = order ? order.created_by : standaloneRecord?.created_by;
        const isAdmin = input.userRole === 'ADMIN' || input.userRole === 'OWNER';
        if (input.userId !== undefined && !isAdmin && orderOwner !== null && orderOwner !== undefined) {
          if (orderOwner !== input.userId) {
            throw new ValidationError('Bạn không có quyền hủy đơn hàng của nhân viên khác.');
          }
        }

        // 3. Find all line items
        let lines: Array<{
          id: number;
          product_id: number;
          quantity: number;
          client_transaction_id: string;
          transaction_code: string;
        }> = [];

        if (order) {
          lines = await tx.getAllAsync<any>(
            'SELECT id, product_id, quantity, client_transaction_id, transaction_code FROM sales_records WHERE client_order_id = ? OR order_id = ?',
            [order.client_order_id, order.id]
          );
        } else if (standaloneRecord) {
          lines = [{
            id: standaloneRecord.id,
            product_id: standaloneRecord.product_id,
            quantity: standaloneRecord.quantity,
            client_transaction_id: standaloneRecord.client_transaction_id || standaloneRecord.transaction_code,
            transaction_code: standaloneRecord.transaction_code,
          }];
        }

        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        const nowIso = now.toISOString();
        let totalRestoredQty = 0;

        // 4. Revert inventory & FIFO lots per line
        for (const line of lines) {
          const qty = Number(line.quantity);
          totalRestoredQty += qty;

          // Fetch product
          const product = await tx.getFirstAsync<{
            id: number;
            sku: string;
            name: string;
            current_stock: number;
            current_cost_price: number;
          }>('SELECT id, sku, name, current_stock, current_cost_price FROM products WHERE id = ?', [line.product_id]);

          const newStock = (product ? Number(product.current_stock) : 0) + qty;

          // Revert FIFO lots: restore consumed quantity to depleted lots in LIFO order
          const depletedLots = await tx.getAllAsync<{
            id: number;
            quantity_received: number;
            quantity_remaining: number;
            unit_cost: number;
          }>(`
            SELECT id, quantity_received, quantity_remaining, unit_cost 
            FROM inventory_lots 
            WHERE product_id = ? AND quantity_remaining < quantity_received 
            ORDER BY purchase_date DESC, id DESC
          `, [line.product_id]);

          let restoreNeeded = qty;
          for (const lot of depletedLots) {
            if (restoreNeeded <= 0) break;
            const space = lot.quantity_received - lot.quantity_remaining;
            const add = Math.min(restoreNeeded, space);
            await tx.runAsync('UPDATE inventory_lots SET quantity_remaining = ? WHERE id = ?', [
              lot.quantity_remaining + add,
              lot.id
            ]);
            restoreNeeded -= add;
          }

          // If there's still quantity remaining to restore
          if (restoreNeeded > 0) {
            const anyLot = await tx.getFirstAsync<{ id: number; quantity_remaining: number }>(
              'SELECT id, quantity_remaining FROM inventory_lots WHERE product_id = ? ORDER BY id DESC LIMIT 1',
              [line.product_id]
            );
            if (anyLot) {
              await tx.runAsync('UPDATE inventory_lots SET quantity_remaining = quantity_remaining + ? WHERE id = ?', [
                restoreNeeded,
                anyLot.id
              ]);
            }
          }

          // Recalculate weighted average cost
          const remainingLotsSummary = await tx.getFirstAsync<{ total_rem: number; total_val: number }>(`
            SELECT 
              COALESCE(SUM(quantity_remaining), 0) as total_rem,
              COALESCE(SUM(quantity_remaining * unit_cost), 0) as total_val 
            FROM inventory_lots 
            WHERE product_id = ? AND quantity_remaining > 0
          `, [line.product_id]);

          const totalRem = Number(remainingLotsSummary?.total_rem || 0);
          const totalVal = Number(remainingLotsSummary?.total_val || 0);
          const weightedAvgCost = totalRem > 0 
            ? Math.round(totalVal / totalRem) 
            : (product ? Number(product.current_cost_price) : 0);

          // Update product stock and weighted average cost
          await tx.runAsync(`
            UPDATE products 
            SET current_stock = ?, current_cost_price = ?, updated_at = datetime('now') 
            WHERE id = ?
          `, [newStock, weightedAvgCost, line.product_id]);

          // Create compensating stock movement (movement_type = 'RETURN' matching Web reference)
          const clientMovementId = `mov-${cancelMutationId}-${line.id}`;
          await tx.runAsync(`
            INSERT INTO stock_movements (
              client_movement_id, product_id, movement_type, quantity_change,
              balance_after, movement_date, reference_type, reference_id,
              sync_status, note, created_by, created_at
            ) VALUES (?, ?, 'RETURN', ?, ?, ?, 'sales_orders', ?, 'PENDING', ?, ?, datetime('now'))
          `, [
            clientMovementId, line.product_id, qty,
            newStock, dateStr, (order?.id || line.id).toString(),
            `Hoàn tồn do hủy đơn [${orderCode}]: ${input.reason.trim()}`,
            input.userId || 1
          ]);

          // Mark line sales_record as CANCELLED
          await tx.runAsync(`
            UPDATE sales_records 
            SET status = 'CANCELLED', cancel_reason = ?, cancelled_at = datetime('now'), cancelled_by = ? 
            WHERE id = ?
          `, [input.reason.trim(), input.userId || 1, line.id]);
        }

        // 5. Mark sales_order header as CANCELLED
        if (order) {
          try {
            await tx.runAsync(`
              UPDATE sales_orders 
              SET status = 'CANCELLED', cancel_reason = ?, cancelled_at = datetime('now'), cancelled_by = ? 
              WHERE id = ?
            `, [input.reason.trim(), input.userId || 1, order.id]);
          } catch {
            await tx.runAsync(`
              UPDATE sales_orders 
              SET status = 'CANCELLED' 
              WHERE id = ?
            `, [order.id]);
          }
        }

        // 6. Enqueue cancellation mutation into Outbox with stable client mutation ID
        const outboxPayload = {
          client_order_id: order?.client_order_id || standaloneRecord?.client_transaction_id,
          order_code: orderCode,
          reason: input.reason.trim(),
          restored_quantity: totalRestoredQty,
          cancelled_by: input.userId || 1,
          cancelled_at: nowIso,
        };

        await this.outbox.enqueueMutation(tx, {
          client_mutation_id: cancelMutationId,
          entity_type: 'CANCEL_SALE_ORDER',
          entity_id: order?.client_order_id || standaloneRecord?.client_transaction_id || String(order?.id),
          action: 'UPDATE',
          payload: outboxPayload,
          payload_version: 1,
          created_at: nowIso,
          user_id: input.userId || 1,
        });

        const updatedOrder: SalesOrder = order ? {
          ...order,
          status: 'CANCELLED',
          cancel_reason: input.reason.trim(),
          cancelled_at: nowIso,
          cancelled_by: input.userId || 1,
        } : {
          id: standaloneRecord!.id,
          client_order_id: standaloneRecord!.client_transaction_id || standaloneRecord!.transaction_code,
          order_code: standaloneRecord!.transaction_code,
          sale_date: standaloneRecord!.sale_date,
          total_amount: standaloneRecord!.total_revenue,
          total_discount: standaloneRecord!.discount,
          final_amount: standaloneRecord!.total_revenue,
          total_items: standaloneRecord!.quantity,
          payment_method: 'CASH',
          cash_received: standaloneRecord!.total_revenue,
          cash_change: 0,
          status: 'CANCELLED',
          sync_status: 'PENDING',
          cancel_reason: input.reason.trim(),
          cancelled_at: nowIso,
          cancelled_by: input.userId || 1,
          note: standaloneRecord!.note || null,
          created_by: standaloneRecord!.created_by ?? null,
          created_at: standaloneRecord!.created_at,
          synced_at: null,
        };

        logger.info('OfflineSaleService', `Cancelled sale order ${orderCode}, restored ${totalRestoredQty} items`);

        return {
          order: updatedOrder,
          restoredItemsCount: lines.length,
          restoredQuantity: totalRestoredQty,
          message: `Đã hủy thành công đơn hàng [${orderCode}] và hoàn trả ${totalRestoredQty} sản phẩm vào kho.`,
        };
      }
    );
  }
}

export const offlineSaleService = new OfflineSaleService();
export default offlineSaleService;
