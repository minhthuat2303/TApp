import { SalesRecord } from '../../types/domain';
import { SalesOrder } from '../../database/types';
import databaseService, { DatabaseService } from '../../database/DatabaseService';
import logger from '../../utils/logger';

export interface CreateSaleInput {
  productId: number;
  quantity: number;
  unitPriceAtSale?: number;
  discount?: number;
  paymentMethod?: string;
  note?: string;
  createdBy?: number;
}

export interface TodaySalesSummary {
  totalRevenue: number;
  totalOrders: number;
  totalProfit: number;
}

// Generate client UUID for offline idempotency
function generateClientUUID(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 10);
  const counter = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `tx-${timestamp}-${randomPart}-${counter}`;
}

export class SqliteSaleDataSource {
  private db: DatabaseService;

  constructor(db?: DatabaseService) {
    this.db = db || databaseService;
  }

  async createLocalSale(input: CreateSaleInput): Promise<SalesRecord> {
    const { productId, quantity, discount = 0, note, createdBy } = input;

    if (quantity <= 0) {
      throw new Error('Số lượng bán phải lớn hơn 0');
    }

    return await this.db.withTransaction(async (tx) => {
      // 1. Check product existence and pricing
      const product = await tx.getFirstAsync<{
        id: number;
        sku: string;
        name: string;
        current_selling_price: number;
        current_cost_price: number;
        current_stock: number;
      }>('SELECT id, sku, name, current_selling_price, current_cost_price, current_stock FROM products WHERE id = ?', [productId]);

      if (!product) {
        throw new Error(`Sản phẩm với ID ${productId} không tồn tại`);
      }

      // 2. Check effective available stock (accounting for pending offline sales)
      const pendingSoldRow = await tx.getFirstAsync<{ pending_sold: number }>(`
        SELECT COALESCE(SUM(quantity), 0) as pending_sold 
        FROM sales_records 
        WHERE product_id = ? AND status = 'COMPLETED' AND sync_status = 'PENDING'
      `, [productId]);

      const pendingSold = pendingSoldRow ? pendingSoldRow.pending_sold : 0;
      const effectiveStock = product.current_stock - pendingSold;

      if (effectiveStock < quantity) {
        throw new Error(
          `Không đủ tồn kho khả dụng! Hiện có: ${effectiveStock} (${product.current_stock} trên máy chủ, ${pendingSold} đang chờ đồng bộ), yêu cầu: ${quantity}`
        );
      }

      // 3. Resolve snapshot pricing
      const unitPrice = input.unitPriceAtSale !== undefined ? input.unitPriceAtSale : product.current_selling_price;
      const costPrice = product.current_cost_price;
      const totalRevenue = Math.max(0, quantity * unitPrice - discount);
      const totalCost = quantity * costPrice;
      const profit = totalRevenue - totalCost;

      // 4. Generate unique client transaction ID & readable transaction code
      const clientTxId = generateClientUUID();
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      const timeTag = now.getTime().toString().slice(-4);
      const txCode = `TX-OFFLINE-${dateStr.replace(/-/g, '')}-${timeTag}`;

      // 5. Insert sales_records
      const saleResult = await tx.runAsync(`
        INSERT INTO sales_records (
          client_transaction_id, transaction_code, product_id, sale_date,
          quantity, unit_price_at_sale, cost_price_at_sale, discount,
          total_revenue, total_cost, profit, status, sync_status, note,
          created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', 'PENDING', ?, ?, datetime('now'))
      `, [
        clientTxId, txCode, productId, dateStr,
        quantity, unitPrice, costPrice, discount,
        totalRevenue, totalCost, profit, note || null,
        createdBy || 1
      ]);

      const saleId = saleResult.lastInsertRowId;

      // 6. Insert stock_movements
      const clientMovementId = `mov-${clientTxId}`;
      const newBalanceAfter = effectiveStock - quantity;
      await tx.runAsync(`
        INSERT INTO stock_movements (
          client_movement_id, product_id, movement_type, quantity_change,
          balance_after, movement_date, reference_type, reference_id,
          sync_status, note, created_by, created_at
        ) VALUES (?, ?, 'SALE', ?, ?, ?, 'sales_records', ?, 'PENDING', ?, ?, datetime('now'))
      `, [
        clientMovementId, productId, -quantity,
        newBalanceAfter, dateStr, saleId.toString(),
        note || 'Bán lẻ Offline POS', createdBy || 1
      ]);

      // 7. Enqueue into Outbox sync_queue
      const mutationPayload = JSON.stringify({
        client_transaction_id: clientTxId,
        transaction_code: txCode,
        product_id: productId,
        sale_date: dateStr,
        quantity,
        unit_price_at_sale: unitPrice,
        cost_price_at_sale: costPrice,
        discount,
        total_revenue: totalRevenue,
        total_cost: totalCost,
        profit,
        note,
        created_by: createdBy || 1
      });

      await tx.runAsync(`
        INSERT INTO sync_queue (
          client_mutation_id, entity_type, entity_id, action,
          payload_json, status, created_at, updated_at
        ) VALUES (?, 'SALE', ?, 'CREATE', ?, 'PENDING', datetime('now'), datetime('now'))
      `, [clientTxId, clientTxId, mutationPayload]);

      logger.info('SqliteSaleDataSource', `Created local offline sale ${txCode} (id: ${saleId})`);

      return {
        id: saleId,
        client_transaction_id: clientTxId,
        transaction_code: txCode,
        product_id: productId,
        product_name: product.name,
        sku: product.sku,
        sale_date: dateStr,
        quantity,
        unit_price_at_sale: unitPrice,
        cost_price_at_sale: costPrice,
        discount,
        total_revenue: totalRevenue,
        total_cost: totalCost,
        profit,
        status: 'COMPLETED',
        sync_status: 'PENDING',
        note: note || null,
        created_by: createdBy || 1,
        created_at: now.toISOString(),
      };
    });
  }

  async getAllSales(params?: { limit?: number; offset?: number; syncStatus?: string; createdBy?: number }): Promise<SalesRecord[]> {
    try {
      const limit = params?.limit || 50;
      const offset = params?.offset || 0;
      let sql = `
        SELECT 
          s.id,
          s.client_transaction_id,
          s.transaction_code,
          s.product_id,
          p.name as product_name,
          p.sku,
          c.name as category_name,
          pt.name as product_type_name,
          s.sale_date,
          s.quantity,
          s.unit_price_at_sale,
          s.cost_price_at_sale,
          s.discount,
          s.total_revenue,
          s.total_cost,
          s.profit,
          s.status,
          s.sync_status,
          s.note,
          s.created_by,
          u.full_name as seller_name,
          s.created_at,
          s.synced_at
        FROM sales_records s
        LEFT JOIN products p ON s.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN product_types pt ON p.product_type_id = pt.id
        LEFT JOIN users u ON s.created_by = u.id
      `;
      const queryParams: unknown[] = [];
      const conditions: string[] = [];

      if (params?.syncStatus) {
        conditions.push('s.sync_status = ?');
        queryParams.push(params.syncStatus);
      }
      if (params?.createdBy !== undefined) {
        conditions.push('s.created_by = ?');
        queryParams.push(params.createdBy);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      sql += ' ORDER BY s.id DESC LIMIT ? OFFSET ?';
      queryParams.push(limit, offset);

      return await this.db.query<SalesRecord>(sql, queryParams);
    } catch (err) {
      logger.error('SqliteSaleDataSource', 'Failed to get all sales', err);
      return [];
    }
  }

  async getPendingSales(createdBy?: number): Promise<SalesRecord[]> {
    return await this.getAllSales({ syncStatus: 'PENDING', createdBy });
  }

  async getPendingSyncCount(userId?: number): Promise<number> {
    try {
      if (userId !== undefined) {
        const row = await this.db.queryOne<{ count: number }>(`
          SELECT COUNT(*) as count FROM sync_queue 
          WHERE status = 'PENDING' AND (user_id = ? OR user_id IS NULL)
        `, [userId]);
        return row ? row.count : 0;
      }
      const row = await this.db.queryOne<{ count: number }>(
        "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING'"
      );
      return row ? row.count : 0;
    } catch (err) {
      logger.error('SqliteSaleDataSource', 'Failed to get pending sync count', err);
      return 0;
    }
  }

  async getTodaySummary(createdBy?: number): Promise<TodaySalesSummary> {
    try {
      const today = new Date().toISOString().slice(0, 10);
      let sql = `
        SELECT 
          COALESCE(SUM(total_revenue), 0) as total_revenue,
          COUNT(id) as total_orders,
          COALESCE(SUM(profit), 0) as total_profit
        FROM sales_records
        WHERE sale_date = ? AND status = 'COMPLETED'
      `;
      const params: unknown[] = [today];

      if (createdBy !== undefined) {
        sql += ' AND created_by = ?';
        params.push(createdBy);
      }

      const row = await this.db.queryOne<{
        total_revenue: number;
        total_orders: number;
        total_profit: number;
      }>(sql, params);

      return {
        totalRevenue: row ? row.total_revenue : 0,
        totalOrders: row ? row.total_orders : 0,
        totalProfit: row ? row.total_profit : 0,
      };
    } catch (err) {
      logger.error('SqliteSaleDataSource', 'Failed to get today summary', err);
      return { totalRevenue: 0, totalOrders: 0, totalProfit: 0 };
    }
  }

  // --- SALES HISTORY & SEARCH/FILTER QUERIES (PHASE 11.6 WEB PARITY) ---
  async getSalesOrders(params?: {
    search?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    paymentMethod?: string;
    createdBy?: number;
    limit?: number;
    offset?: number;
  }): Promise<SalesOrder[]> {
    try {
      const limit = params?.limit || 50;
      const offset = params?.offset || 0;
      let sql = `
        SELECT 
          so.id,
          so.client_order_id,
          so.order_code,
          so.sale_date,
          so.total_amount,
          so.total_discount,
          so.final_amount,
          so.total_items,
          COALESCE(so.payment_method, 'CASH') as payment_method,
          so.cash_received,
          so.cash_change,
          so.status,
          so.sync_status,
          so.cancel_reason,
          so.cancelled_at,
          so.cancelled_by,
          so.note,
          so.created_by,
          u.full_name as seller_name,
          so.created_at,
          so.synced_at
        FROM sales_orders so
        LEFT JOIN users u ON so.created_by = u.id
      `;

      const conditions: string[] = [];
      const queryParams: unknown[] = [];

      if (params?.startDate) {
        conditions.push('substr(so.sale_date, 1, 10) >= ?');
        queryParams.push(params.startDate);
      }
      if (params?.endDate) {
        conditions.push('substr(so.sale_date, 1, 10) <= ?');
        queryParams.push(params.endDate);
      }
      if (params?.status && params.status !== 'ALL') {
        conditions.push('so.status = ?');
        queryParams.push(params.status);
      }
      if (params?.paymentMethod && params.paymentMethod !== 'ALL') {
        conditions.push('COALESCE(so.payment_method, "CASH") = ?');
        queryParams.push(params.paymentMethod);
      }
      if (params?.createdBy !== undefined) {
        conditions.push('so.created_by = ?');
        queryParams.push(params.createdBy);
      }
      if (params?.search && params.search.trim()) {
        const q = `%${params.search.trim()}%`;
        conditions.push(`(
          so.order_code LIKE ? OR 
          so.client_order_id LIKE ? OR 
          so.note LIKE ? OR 
          EXISTS (
            SELECT 1 FROM sales_records sr 
            JOIN products p ON sr.product_id = p.id 
            WHERE (sr.order_id = so.id OR sr.client_order_id = so.client_order_id) 
              AND (p.name LIKE ? OR p.sku LIKE ?)
          )
        )`);
        queryParams.push(q, q, q, q, q);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      sql += ' ORDER BY so.sale_date DESC, so.id DESC LIMIT ? OFFSET ?';
      queryParams.push(limit, offset);

      return await this.db.query<SalesOrder>(sql, queryParams);
    } catch (err) {
      logger.error('SqliteSaleDataSource', 'Failed to get sales orders', err);
      return [];
    }
  }

  async getSaleOrderDetail(orderIdOrClientOrderId: number | string): Promise<{
    order: SalesOrder;
    items: Array<SalesRecord & { product_name: string; sku: string; category_name?: string }>;
  } | null> {
    try {
      let order: SalesOrder | null = null;
      if (typeof orderIdOrClientOrderId === 'number' || !isNaN(Number(orderIdOrClientOrderId))) {
        order = await this.db.queryOne<SalesOrder>(`
          SELECT so.*, u.full_name as seller_name 
          FROM sales_orders so 
          LEFT JOIN users u ON so.created_by = u.id 
          WHERE so.id = ?
        `, [Number(orderIdOrClientOrderId)]);
      }
      if (!order) {
        order = await this.db.queryOne<SalesOrder>(`
          SELECT so.*, u.full_name as seller_name 
          FROM sales_orders so 
          LEFT JOIN users u ON so.created_by = u.id 
          WHERE so.client_order_id = ? OR so.order_code = ?
        `, [String(orderIdOrClientOrderId), String(orderIdOrClientOrderId)]);
      }

      if (!order) {
        // Fallback: Check if it is a standalone sales_record
        const singleRecord = await this.db.queryOne<SalesRecord & { product_name: string; sku: string; category_name?: string }>(`
          SELECT sr.*, p.name as product_name, p.sku, c.name as category_name, u.full_name as seller_name
          FROM sales_records sr
          JOIN products p ON sr.product_id = p.id
          LEFT JOIN categories c ON p.category_id = c.id
          LEFT JOIN users u ON sr.created_by = u.id
          WHERE sr.id = ? OR sr.client_transaction_id = ? OR sr.transaction_code = ?
        `, [orderIdOrClientOrderId, String(orderIdOrClientOrderId), String(orderIdOrClientOrderId)]);

        if (!singleRecord) return null;

        const syntheticOrder: SalesOrder = {
          id: singleRecord.id,
          client_order_id: singleRecord.client_transaction_id || singleRecord.transaction_code,
          order_code: singleRecord.transaction_code,
          sale_date: singleRecord.sale_date,
          total_amount: singleRecord.total_revenue,
          total_discount: singleRecord.discount,
          final_amount: singleRecord.total_revenue,
          total_items: singleRecord.quantity,
          payment_method: 'CASH',
          cash_received: singleRecord.total_revenue,
          cash_change: 0,
          status: singleRecord.status as any,
          sync_status: (singleRecord.sync_status || 'PENDING') as any,
          cancel_reason: singleRecord.cancel_reason || null,
          cancelled_at: singleRecord.cancelled_at || null,
          cancelled_by: singleRecord.cancelled_by ?? null,
          note: singleRecord.note || null,
          created_by: singleRecord.created_by ?? null,
          created_at: singleRecord.created_at,
          synced_at: singleRecord.synced_at ?? null,
        };

        return { order: syntheticOrder, items: [singleRecord] };
      }

      // Fetch items for this order
      const items = await this.db.query<SalesRecord & { product_name: string; sku: string; category_name?: string }>(`
        SELECT sr.*, p.name as product_name, p.sku, c.name as category_name
        FROM sales_records sr
        JOIN products p ON sr.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE sr.order_id = ? OR sr.client_order_id = ?
        ORDER BY sr.id ASC
      `, [order.id, order.client_order_id]);

      return { order, items };
    } catch (err) {
      logger.error('SqliteSaleDataSource', 'Failed to get sale order detail', err);
      return null;
    }
  }
}

export default SqliteSaleDataSource;
