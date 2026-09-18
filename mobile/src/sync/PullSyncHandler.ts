import databaseService, { DatabaseService } from '../database/DatabaseService';
import { ITransactionClient } from '../database/types';
import apiClient from '../api/client';
import Endpoints from '../api/endpoints';
import { PullSyncData } from './types';
import logger from '../utils/logger';

export class PullSyncHandler {
  private db: DatabaseService;

  constructor(db?: DatabaseService) {
    this.db = db || databaseService;
  }

  getCursorKey(userId?: number): string {
    return userId !== undefined ? `pull_cursor_user_${userId}` : 'pull_cursor';
  }

  // Get currently saved sync cursor (scoped by authenticated account)
  async getCurrentCursor(userId?: number): Promise<string> {
    const key = this.getCursorKey(userId);
    const row = await this.db.queryOne<{ value: string }>(`
      SELECT value FROM sync_metadata WHERE key = ?
    `, [key]);
    if (row) return row.value;

    // Global fallback for initial backwards compatibility
    const fallback = await this.db.queryOne<{ value: string }>(`
      SELECT value FROM sync_metadata WHERE key = 'pull_cursor'
    `);
    return fallback ? fallback.value : '1970-01-01T00:00:00.000Z';
  }

  // Pull server delta changes and apply them atomically along with cursor
  async pullServerChanges(limit = 100, userId?: number): Promise<{
    pulledCount: number;
    nextCursor: string;
  }> {
    let currentCursor = await this.getCurrentCursor(userId);
    let totalPulled = 0;
    let hasMore = true;
    let finalCursor = currentCursor;

    logger.info('PullSyncHandler', `Starting incremental pull for user ${userId || 'global'} from cursor: ${currentCursor}`);

    while (hasMore) {
      const response = await apiClient.get<PullSyncData>(Endpoints.SYNC_PULL, {
        params: {
          cursor: currentCursor,
          limit,
        },
      });

      const data = response.data;
      if (!data) {
        break;
      }

      const {
        categories = [],
        product_types: productTypes = [],
        products = [],
        price_history: priceHistory = [],
        cost_price_history: costPriceHistory = [],
        inventory_lots: inventoryLots = [],
        sales_records: salesRecords = [],
        sale_cost_allocations: saleCostAllocations = [],
        stock_movements: stockMovements = [],
        next_cursor: nextCursor,
        has_more: moreAvailable,
      } = data;

      const batchCount = categories.length + productTypes.length + products.length +
        priceHistory.length + costPriceHistory.length + inventoryLots.length +
        salesRecords.length + saleCostAllocations.length + stockMovements.length;

      // --- ATOMIC TRANSACTION: APPLY CHANGES + UPDATE CURSOR ---
      await this.db.withTransaction(async (tx: ITransactionClient) => {
        // 1. Categories
        for (const cat of categories) {
          await tx.runAsync(`
            INSERT OR REPLACE INTO categories (id, code, name, description, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [cat.id, cat.code, cat.name, cat.description, cat.status, cat.created_at, cat.updated_at]);
        }

        // 2. Product Types
        for (const pt of productTypes) {
          await tx.runAsync(`
            INSERT OR REPLACE INTO product_types (id, category_id, code, name, description, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [pt.id, pt.category_id, pt.code, pt.name, pt.description, pt.status, pt.created_at, pt.updated_at]);
        }

        // 3. Products
        for (const prod of products) {
          if (prod.category_id) {
            await tx.runAsync(`
              INSERT OR IGNORE INTO categories (id, code, name, status, created_at, updated_at)
              VALUES (?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
            `, [prod.category_id, `CAT-${prod.category_id}`, `Danh mục ${prod.category_id}`]);
          }
          if (prod.product_type_id && prod.category_id) {
            await tx.runAsync(`
              INSERT OR IGNORE INTO product_types (id, category_id, code, name, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
            `, [prod.product_type_id, prod.category_id, `TYPE-${prod.product_type_id}`, `Loại ${prod.product_type_id}`]);
          }

          await tx.runAsync(`
            INSERT INTO products (
              id, sku, name, category_id, product_type_id, current_cost_price,
              current_selling_price, current_stock, min_stock_alert, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              sku = excluded.sku,
              name = excluded.name,
              category_id = excluded.category_id,
              product_type_id = excluded.product_type_id,
              current_cost_price = excluded.current_cost_price,
              current_selling_price = excluded.current_selling_price,
              current_stock = excluded.current_stock,
              min_stock_alert = excluded.min_stock_alert,
              status = excluded.status,
              updated_at = excluded.updated_at
          `, [
            prod.id,
            prod.sku,
            prod.name,
            prod.category_id,
            prod.product_type_id,
            prod.current_cost_price,
            prod.current_selling_price,
            prod.current_stock,
            prod.min_stock_alert,
            prod.status,
            prod.created_at,
            prod.updated_at,
          ]);
        }

        // 4. Price History
        for (const ph of priceHistory) {
          await tx.runAsync(`
            INSERT OR IGNORE INTO price_history (id, product_id, price, effective_from, note, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [ph.id, ph.product_id, ph.price, ph.effective_from, ph.note, ph.created_by, ph.created_at]);
        }

        // 5. Cost Price History
        for (const cph of costPriceHistory) {
          await tx.runAsync(`
            INSERT OR IGNORE INTO cost_price_history (id, product_id, cost_price, effective_from, note, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [cph.id, cph.product_id, cph.cost_price, cph.effective_from, cph.note, cph.created_by, cph.created_at]);
        }

        // 6. Inventory Lots
        for (const lot of inventoryLots) {
          await tx.runAsync(`
            INSERT OR IGNORE INTO inventory_lots (
              id, lot_code, product_id, purchase_date, quantity_received,
              quantity_remaining, unit_cost, supplier_id, import_id, note, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            lot.id,
            lot.lot_code,
            lot.product_id,
            lot.purchase_date,
            lot.quantity_received,
            lot.quantity_remaining,
            lot.unit_cost,
            lot.supplier_id,
            lot.import_id,
            lot.note,
            lot.created_by,
            lot.created_at,
          ]);
        }

        // 7. Sales Records (Multi-device synchronization)
        for (const sale of salesRecords) {
          const clientTxId = sale.transaction_code || `server-sale-${sale.id}`;
          await tx.runAsync(`
            INSERT INTO sales_records (
              client_transaction_id, server_id, transaction_code, product_id, sale_date,
              quantity, unit_price_at_sale, cost_price_at_sale, discount, total_revenue,
              total_cost, profit, status, sync_status, cancel_reason, cancelled_at,
              cancelled_by, note, created_by, created_at, synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(transaction_code) DO UPDATE SET
              server_id = excluded.server_id,
              status = excluded.status,
              cancel_reason = excluded.cancel_reason,
              cancelled_at = excluded.cancelled_at,
              cancelled_by = excluded.cancelled_by,
              sync_status = 'SYNCED',
              synced_at = datetime('now')
          `, [
            clientTxId,
            sale.id,
            sale.transaction_code,
            sale.product_id,
            sale.sale_date,
            sale.quantity,
            sale.unit_price_at_sale,
            sale.cost_price_at_sale,
            sale.discount || 0,
            sale.total_revenue,
            sale.total_cost,
            sale.profit,
            sale.status || 'COMPLETED',
            sale.cancel_reason,
            sale.cancelled_at,
            sale.cancelled_by,
            sale.note,
            sale.created_by,
            sale.created_at,
          ]);

          // Also sync into sales_orders so order history on other devices matches 100%
          const orderTotalAmount = Number(sale.total_revenue) + Number(sale.discount || 0);
          await tx.runAsync(`
            INSERT INTO sales_orders (
              client_order_id, order_code, sale_date, total_amount, total_discount,
              final_amount, total_items, payment_method, cash_received, cash_change,
              status, sync_status, note, created_by, created_at, synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'CASH', ?, 0, ?, 'SYNCED', ?, ?, ?, datetime('now'))
            ON CONFLICT(order_code) DO UPDATE SET
              status = excluded.status,
              total_discount = excluded.total_discount,
              final_amount = excluded.final_amount,
              sync_status = 'SYNCED',
              synced_at = datetime('now')
          `, [
            clientTxId,
            sale.transaction_code,
            sale.sale_date,
            orderTotalAmount,
            sale.discount || 0,
            sale.total_revenue,
            sale.quantity,
            sale.total_revenue,
            sale.status || 'COMPLETED',
            sale.note,
            sale.created_by,
            sale.created_at,
          ]);
        }

        // 8. Sale Cost Allocations
        for (const alloc of saleCostAllocations) {
          await tx.runAsync(`
            INSERT OR REPLACE INTO sale_cost_allocations (
              id, sale_id, inventory_lot_id, allocated_quantity, allocated_unit_cost, total_cost, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [
            alloc.id,
            alloc.sale_id,
            alloc.inventory_lot_id,
            alloc.allocated_quantity,
            alloc.allocated_unit_cost,
            alloc.total_cost,
            alloc.created_at,
          ]);
        }

        // 9. Stock Movements
        for (const mov of stockMovements) {
          const clientMovId = `srv-mov-${mov.id}`;
          await tx.runAsync(`
            INSERT OR IGNORE INTO stock_movements (
              client_movement_id, product_id, movement_type, quantity_change, balance_after,
              movement_date, reference_type, reference_id, sync_status, note, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', ?, ?, ?)
          `, [
            clientMovId,
            mov.product_id,
            mov.movement_type,
            mov.quantity_change,
            mov.balance_after,
            mov.movement_date,
            mov.reference_type,
            mov.reference_id,
            mov.note,
            mov.created_by,
            mov.created_at,
          ]);
        }

        // 10. ATOMIC CURSOR COMMIT (Scoped to authenticated account)
        const cursorKey = this.getCursorKey(userId);
        await tx.runAsync(`
          INSERT OR REPLACE INTO sync_metadata (key, value, updated_at)
          VALUES (?, ?, datetime('now'))
        `, [cursorKey, nextCursor]);
      });

      totalPulled += batchCount;
      finalCursor = nextCursor;
      currentCursor = nextCursor;
      hasMore = !!moreAvailable;

      logger.info('PullSyncHandler', `Applied ${batchCount} records. Next cursor: ${nextCursor}`);
    }

    return {
      pulledCount: totalPulled,
      nextCursor: finalCursor,
    };
  }
}

export const pullSyncHandler = new PullSyncHandler();
export default pullSyncHandler;
