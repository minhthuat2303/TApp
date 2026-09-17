// T_SHOP Mobile - Purchase Order & Supplier Procurement Service
// Implements complete Purchase Order lifecycle matching Web business logic 100%:
// Draft/Pending PO creation -> Confirmation -> Receiving -> FIFO Lot allocation -> Stock Movement -> Outbox

import databaseService, { DatabaseService } from '../database/DatabaseService';
import { ITransactionClient, ImportRecord, ImportItem } from '../database/types';
import outboxService, { OutboxService } from './OutboxService';
import { ValidationError, BusinessRuleError } from './types';
import logger from '../utils/logger';

export interface PurchaseOrderItemInput {
  productId: number;
  quantity: number;
  unitCostPrice: number;
}

export interface CreatePurchaseOrderInput {
  supplierId?: number | null;
  importDate?: string;
  expectedDate?: string | null;
  note?: string | null;
  status?: 'PENDING' | 'COMPLETED';
  items: PurchaseOrderItemInput[];
  createdBy?: number;
}

export interface PurchaseOrderWithItems extends ImportRecord {
  supplier_name?: string;
  creator_name?: string;
  items: Array<ImportItem & { product_name?: string; sku?: string; current_stock?: number }>;
}

export class PurchaseOrderService {
  private db: DatabaseService;
  private outbox: OutboxService;

  constructor(db?: DatabaseService, outbox?: OutboxService) {
    this.db = db || databaseService;
    this.outbox = outbox || outboxService;
  }

  // 1. Get Purchase Orders with optional search & status filter
  async getPurchaseOrders(filters?: {
    status?: string;
    search?: string;
    limit?: number;
  }): Promise<PurchaseOrderWithItems[]> {
    try {
      let sql = `
        SELECT 
          i.id,
          i.client_import_id,
          i.server_id,
          i.import_code,
          i.supplier_id,
          s.name as supplier_name,
          i.import_date,
          i.expected_date,
          i.total_amount,
          i.note,
          COALESCE(i.status, 'COMPLETED') as status,
          i.sync_status,
          i.created_by,
          i.created_at,
          i.synced_at,
          u.username as creator_name
        FROM imports i
        LEFT JOIN suppliers s ON s.id = i.supplier_id
        LEFT JOIN users u ON u.id = i.created_by
        WHERE 1=1
      `;
      const params: any[] = [];

      if (filters?.status && filters.status !== 'ALL') {
        sql += ' AND COALESCE(i.status, "COMPLETED") = ?';
        params.push(filters.status);
      }

      if (filters?.search && filters.search.trim()) {
        const term = `%${filters.search.trim()}%`;
        sql += ' AND (i.import_code LIKE ? OR s.name LIKE ? OR i.note LIKE ?)';
        params.push(term, term, term);
      }

      sql += ' ORDER BY i.id DESC';
      if (filters?.limit) {
        sql += ' LIMIT ?';
        params.push(filters.limit);
      }

      const orders = await this.db.query<any>(sql, params);

      // Fetch items for each order
      const result: PurchaseOrderWithItems[] = [];
      for (const ord of orders) {
        const items = await this.db.query<any>(`
          SELECT 
            it.id,
            it.import_id,
            it.product_id,
            p.name as product_name,
            p.sku,
            p.current_stock,
            it.quantity,
            it.unit_cost_price,
            it.total_amount,
            it.created_at
          FROM import_items it
          JOIN products p ON p.id = it.product_id
          WHERE it.import_id = ?
        `, [ord.id]);

        result.push({
          ...ord,
          status: ord.status || 'COMPLETED',
          items: items || [],
        });
      }

      return result;
    } catch (err) {
      logger.error('PurchaseOrderService', 'Failed to query purchase orders', err);
      return [];
    }
  }

  // 2. Get Purchase Order Details by ID
  async getPurchaseOrderById(id: number | string): Promise<PurchaseOrderWithItems | null> {
    try {
      const ord = await this.db.queryOne<any>(`
        SELECT 
          i.id,
          i.client_import_id,
          i.server_id,
          i.import_code,
          i.supplier_id,
          s.name as supplier_name,
          i.import_date,
          i.expected_date,
          i.total_amount,
          i.note,
          COALESCE(i.status, 'COMPLETED') as status,
          i.sync_status,
          i.created_by,
          i.created_at,
          i.synced_at,
          u.username as creator_name
        FROM imports i
        LEFT JOIN suppliers s ON s.id = i.supplier_id
        LEFT JOIN users u ON u.id = i.created_by
        WHERE i.id = ?
      `, [Number(id)]);

      if (!ord) return null;

      const items = await this.db.query<any>(`
        SELECT 
          it.id,
          it.import_id,
          it.product_id,
          p.name as product_name,
          p.sku,
          p.current_stock,
          it.quantity,
          it.unit_cost_price,
          it.total_amount,
          it.created_at
        FROM import_items it
        JOIN products p ON p.id = it.product_id
        WHERE it.import_id = ?
      `, [ord.id]);

      return {
        ...ord,
        status: ord.status || 'COMPLETED',
        items: items || [],
      };
    } catch (err) {
      logger.error('PurchaseOrderService', `Failed to get purchase order ${id}`, err);
      return null;
    }
  }

  // 3. Create a Purchase Order (either PENDING or COMPLETED)
  async createPurchaseOrder(input: CreatePurchaseOrderInput): Promise<PurchaseOrderWithItems> {
    if (!input.items || input.items.length === 0) {
      throw new ValidationError('Đơn mua hàng phải có ít nhất một mặt hàng.');
    }

    const orderStatus = input.status || 'PENDING';
    const now = new Date();
    const dateStr = input.importDate || now.toISOString().slice(0, 10);
    const timeSuffix = now.getTime().toString().slice(-4);
    const importCode = `PO-${dateStr.replace(/-/g, '')}-${timeSuffix}`;
    const clientImportId = `po-client-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    return await this.db.withTransactionAsync(async (tx: ITransactionClient) => {
      let totalAmount = 0;
      const verifiedItems: Array<{
        product: any;
        quantity: number;
        unitCostPrice: number;
        totalItemAmount: number;
      }> = [];

      for (const it of input.items) {
        if (!it.productId || it.quantity <= 0 || it.unitCostPrice < 0) {
          throw new ValidationError('Thông tin sản phẩm, số lượng (>0) hoặc đơn giá (>=0) không hợp lệ.');
        }

        const prod = await tx.getFirstAsync<any>(
          'SELECT id, sku, name, current_stock, current_cost_price FROM products WHERE id = ?',
          [it.productId]
        );
        if (!prod) {
          throw new ValidationError(`Sản phẩm với ID ${it.productId} không tồn tại.`);
        }

        const itemTotal = it.quantity * it.unitCostPrice;
        totalAmount += itemTotal;
        verifiedItems.push({
          product: prod,
          quantity: it.quantity,
          unitCostPrice: it.unitCostPrice,
          totalItemAmount: itemTotal,
        });
      }

      // Insert Import Header
      const headerResult = await tx.runAsync(`
        INSERT INTO imports (
          client_import_id, import_code, supplier_id, import_date, expected_date,
          total_amount, note, status, sync_status, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, datetime('now'))
      `, [
        clientImportId,
        importCode,
        input.supplierId || null,
        dateStr,
        input.expectedDate || null,
        totalAmount,
        input.note || null,
        orderStatus,
        input.createdBy || 1,
      ]);

      const importId = headerResult.lastInsertRowId;
      const createdItems: any[] = [];

      // Insert Items
      for (const item of verifiedItems) {
        const itRes = await tx.runAsync(`
          INSERT INTO import_items (
            import_id, product_id, quantity, unit_cost_price, total_amount, created_at
          ) VALUES (?, ?, ?, ?, ?, datetime('now'))
        `, [
          importId,
          item.product.id,
          item.quantity,
          item.unitCostPrice,
          item.totalItemAmount,
        ]);

        createdItems.push({
          id: itRes.lastInsertRowId,
          import_id: importId,
          product_id: item.product.id,
          product_name: item.product.name,
          sku: item.product.sku,
          quantity: item.quantity,
          unit_cost_price: item.unitCostPrice,
          total_amount: item.totalItemAmount,
          created_at: new Date().toISOString(),
        });

        // If creating directly with COMPLETED status, execute immediate inventory receiving:
        if (orderStatus === 'COMPLETED') {
          const lotCode = `LOT-${dateStr.replace(/-/g, '')}-${item.product.sku}-${timeSuffix}`;

          // 1. Create FIFO Inventory Lot
          await tx.runAsync(`
            INSERT INTO inventory_lots (
              lot_code, product_id, purchase_date, quantity_received,
              quantity_remaining, unit_cost, supplier_id, import_id,
              note, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          `, [
            lotCode, item.product.id, dateStr, item.quantity,
            item.quantity, item.unitCostPrice, input.supplierId || null,
            importId, `Nhập kho đơn ${importCode}`, input.createdBy || 1,
          ]);

          // 2. Insert Cost Price History
          await tx.runAsync(`
            INSERT INTO cost_price_history (
              product_id, cost_price, effective_from, note, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, datetime('now'))
          `, [
            item.product.id, item.unitCostPrice, dateStr,
            `Nhập kho theo đơn mua hàng ${importCode}`, input.createdBy || 1,
          ]);

          // 3. Update Product Stock & Weighted Average Cost
          const remainingLots = await tx.getFirstAsync<any>(`
            SELECT 
              COALESCE(SUM(quantity_remaining), 0) as total_rem,
              COALESCE(SUM(quantity_remaining * unit_cost), 0) as total_val
            FROM inventory_lots
            WHERE product_id = ? AND quantity_remaining > 0
          `, [item.product.id]);

          const totalRem = Number(remainingLots?.total_rem || 0);
          const totalVal = Number(remainingLots?.total_val || 0);
          const newStock = Number(item.product.current_stock) + item.quantity;
          const weightedAvgCost = totalRem > 0 ? Math.round(totalVal / totalRem) : item.unitCostPrice;

          await tx.runAsync(`
            UPDATE products
            SET current_stock = ?, current_cost_price = ?, updated_at = datetime('now')
            WHERE id = ?
          `, [newStock, weightedAvgCost, item.product.id]);

          // 4. Create Stock Movement (PURCHASE)
          const clientMovementId = `mov-po-${Date.now()}-${item.product.id}`;
          await tx.runAsync(`
            INSERT INTO stock_movements (
              client_movement_id, product_id, movement_type, quantity_change,
              balance_after, movement_date, reference_type, reference_id,
              sync_status, note, created_by, created_at
            ) VALUES (?, ?, 'PURCHASE', ?, ?, ?, 'IMPORT', ?, 'PENDING', ?, datetime('now'))
          `, [
            clientMovementId, item.product.id, item.quantity,
            newStock, dateStr, importId,
            `Nhập kho đơn mua hàng ${importCode}`, input.createdBy || 1,
          ]);
        }
      }

      // Enqueue Outbox mutation for synchronization
      await this.outbox.enqueue({
        clientMutationId: `po-sync-${importId}-${Date.now()}`,
        entityType: 'IMPORT_ORDER',
        entityId: String(importId),
        action: 'CREATE',
        payload: {
          client_import_id: clientImportId,
          import_code: importCode,
          supplier_id: input.supplierId || null,
          import_date: dateStr,
          expected_date: input.expectedDate || null,
          total_amount: totalAmount,
          note: input.note || null,
          status: orderStatus,
          items: createdItems.map(it => ({
            product_id: it.product_id,
            quantity: it.quantity,
            unit_cost_price: it.unit_cost_price,
            total_amount: it.total_amount,
          })),
        },
        userId: input.createdBy || 1,
      });

      return {
        id: importId,
        client_import_id: clientImportId,
        server_id: null,
        import_code: importCode,
        supplier_id: input.supplierId || null,
        import_date: dateStr,
        expected_date: input.expectedDate || null,
        total_amount: totalAmount,
        note: input.note || null,
        status: orderStatus,
        sync_status: 'PENDING',
        created_by: input.createdBy || 1,
        created_at: new Date().toISOString(),
        synced_at: null,
        items: createdItems,
      };
    });
  }

  // 4. Confirm Purchase Order (transitions PENDING -> COMPLETED, allocates FIFO lots, increases inventory)
  async confirmPurchaseOrder(orderId: number, userId = 1): Promise<{ success: boolean; importCode: string }> {
    const order = await this.getPurchaseOrderById(orderId);
    if (!order) {
      throw new BusinessRuleError('Không tìm thấy đơn mua hàng.');
    }

    if (order.status === 'COMPLETED') {
      throw new BusinessRuleError('Đơn mua hàng này đã được xác nhận nhập kho trước đó.');
    }

    if (order.status === 'CANCELLED') {
      throw new BusinessRuleError('Không thể xác nhận đơn mua hàng đã bị hủy.');
    }

    return await this.db.withTransactionAsync(async (tx: ITransactionClient) => {
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      const timeSuffix = now.getTime().toString().slice(-4);

      for (const item of order.items) {
        const prod = await tx.getFirstAsync<any>(
          'SELECT id, sku, name, current_stock, current_cost_price FROM products WHERE id = ?',
          [item.product_id]
        );
        if (!prod) continue;

        const lotCode = `LOT-${dateStr.replace(/-/g, '')}-${item.sku || prod.sku}-${timeSuffix}`;

        // 1. Create FIFO Inventory Lot
        await tx.runAsync(`
          INSERT INTO inventory_lots (
            lot_code, product_id, purchase_date, quantity_received,
            quantity_remaining, unit_cost, supplier_id, import_id,
            note, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `, [
          lotCode, item.product_id, dateStr, item.quantity,
          item.quantity, item.unit_cost_price, order.supplier_id || null,
          order.id, `Nhập kho từ đơn xác nhận ${order.import_code}`, userId,
        ]);

        // 2. Insert Cost Price History
        await tx.runAsync(`
          INSERT INTO cost_price_history (
            product_id, cost_price, effective_from, note, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, datetime('now'))
        `, [
          item.product_id, item.unit_cost_price, dateStr,
          `Xác nhận nhập kho theo đơn ${order.import_code}`, userId,
        ]);

        // 3. Reconcile weighted average cost
        const remainingLots = await tx.getFirstAsync<any>(`
          SELECT 
            COALESCE(SUM(quantity_remaining), 0) as total_rem,
            COALESCE(SUM(quantity_remaining * unit_cost), 0) as total_val
          FROM inventory_lots
          WHERE product_id = ? AND quantity_remaining > 0
        `, [item.product_id]);

        const totalRem = Number(remainingLots?.total_rem || 0);
        const totalVal = Number(remainingLots?.total_val || 0);
        const newStock = Number(prod.current_stock) + item.quantity;
        const weightedAvgCost = totalRem > 0 ? Math.round(totalVal / totalRem) : item.unit_cost_price;

        // 4. Update Product Stock
        await tx.runAsync(`
          UPDATE products
          SET current_stock = ?, current_cost_price = ?, updated_at = datetime('now')
          WHERE id = ?
        `, [newStock, weightedAvgCost, item.product_id]);

        // 5. Log Stock Movement (PURCHASE)
        const clientMovementId = `mov-po-confirm-${Date.now()}-${item.product_id}`;
        await tx.runAsync(`
          INSERT INTO stock_movements (
            client_movement_id, product_id, movement_type, quantity_change,
            balance_after, movement_date, reference_type, reference_id,
            sync_status, note, created_by, created_at
          ) VALUES (?, ?, 'PURCHASE', ?, ?, ?, 'IMPORT', ?, 'PENDING', ?, datetime('now'))
        `, [
          clientMovementId, item.product_id, item.quantity,
          newStock, dateStr, order.id,
          `Xác nhận nhập kho đơn ${order.import_code}`, userId,
        ]);
      }

      // Mark Order as COMPLETED
      await tx.runAsync(`
        UPDATE imports
        SET status = 'COMPLETED', sync_status = 'PENDING', updated_at = datetime('now')
        WHERE id = ?
      `, [order.id]);

      // Enqueue Outbox mutation for state transition
      await this.outbox.enqueue({
        clientMutationId: `po-confirm-${order.id}-${Date.now()}`,
        entityType: 'IMPORT_ORDER',
        entityId: String(order.id),
        action: 'UPDATE',
        payload: {
          id: order.id,
          status: 'COMPLETED',
          confirmed_at: new Date().toISOString(),
        },
        userId,
      });

      return {
        success: true,
        importCode: order.import_code,
      };
    });
  }

  // 5. Cancel a Purchase Order
  async cancelPurchaseOrder(orderId: number, reason?: string, userId = 1): Promise<void> {
    const order = await this.getPurchaseOrderById(orderId);
    if (!order) {
      throw new BusinessRuleError('Không tìm thấy đơn mua hàng.');
    }

    if (order.status === 'COMPLETED') {
      throw new BusinessRuleError('Không thể hủy đơn mua hàng đã nhập kho.');
    }

    await this.db.run(`
      UPDATE imports
      SET status = 'CANCELLED', note = COALESCE(note, '') || ' [Đã hủy: ' || ? || ']', sync_status = 'PENDING'
      WHERE id = ?
    `, [reason || 'Người dùng hủy', orderId]);

    await this.outbox.enqueue({
      clientMutationId: `po-cancel-${orderId}-${Date.now()}`,
      entityType: 'IMPORT_ORDER',
      entityId: String(orderId),
      action: 'UPDATE',
      payload: {
        id: orderId,
        status: 'CANCELLED',
        cancel_reason: reason || null,
      },
      userId,
    });
  }
}

export const purchaseOrderService = new PurchaseOrderService();
export default purchaseOrderService;
