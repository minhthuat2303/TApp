import { InventoryLot, StockMovement } from '../../types/domain';
import { StockStatus } from '../../database/types';
import { PriceHistoryRecord, CostHistoryRecord } from '../../services/types';
import databaseService, { DatabaseService } from '../../database/DatabaseService';
import logger from '../../utils/logger';

export class SqliteInventoryDataSource {
  private db: DatabaseService;

  constructor(db?: DatabaseService) {
    this.db = db || databaseService;
  }

  async getStockStatus(productId: number): Promise<StockStatus> {
    try {
      const product = await this.db.queryOne<{ current_stock: number }>(
        'SELECT current_stock FROM products WHERE id = ?',
        [productId]
      );
      const serverStock = product ? product.current_stock : 0;

      // Calculate local pending sales that have not yet synced to server
      const pendingRow = await this.db.queryOne<{ pending_sold: number }>(`
        SELECT COALESCE(SUM(quantity), 0) as pending_sold 
        FROM sales_records 
        WHERE product_id = ? AND status = 'COMPLETED' AND sync_status = 'PENDING'
      `, [productId]);

      const pendingDelta = pendingRow ? pendingRow.pending_sold : 0;
      const effectiveStock = Math.max(0, serverStock - pendingDelta);

      return {
        productId,
        serverStock,
        pendingDelta,
        effectiveStock,
      };
    } catch (err) {
      logger.error('SqliteInventoryDataSource', `Failed to get stock status for product ${productId}`, err);
      return { productId, serverStock: 0, pendingDelta: 0, effectiveStock: 0 };
    }
  }

  async getAllStockStatuses(): Promise<StockStatus[]> {
    try {
      const rows = await this.db.query<{
        id: number;
        server_stock: number;
        pending_sold: number;
      }>(`
        SELECT 
          p.id,
          p.current_stock as server_stock,
          COALESCE(SUM(CASE WHEN s.sync_status = 'PENDING' AND s.status = 'COMPLETED' THEN s.quantity ELSE 0 END), 0) as pending_sold
        FROM products p
        LEFT JOIN sales_records s ON p.id = s.product_id
        GROUP BY p.id
        ORDER BY p.id ASC
      `);

      return rows.map((r) => {
        const rawStock = r.server_stock !== undefined ? r.server_stock : (r as any).current_stock;
        const serverStock = typeof rawStock === 'number' && !isNaN(rawStock) ? rawStock : 0;
        const rawPending = r.pending_sold;
        const pendingDelta = typeof rawPending === 'number' && !isNaN(rawPending) ? rawPending : 0;
        const effectiveStock = Math.max(0, serverStock - pendingDelta);
        return {
          productId: r.id,
          serverStock,
          pendingDelta,
          effectiveStock,
        };
      });
    } catch (err) {
      logger.error('SqliteInventoryDataSource', 'Failed to get all stock statuses', err);
      return [];
    }
  }

  async getInventoryLots(productId?: number): Promise<InventoryLot[]> {
    try {
      let sql = `
        SELECT 
          l.id,
          l.lot_code,
          l.product_id,
          p.name as product_name,
          p.sku,
          l.purchase_date,
          l.quantity_received,
          l.quantity_remaining,
          l.unit_cost,
          l.supplier_id,
          s.name as supplier_name,
          l.import_id,
          l.note,
          l.created_at
        FROM inventory_lots l
        LEFT JOIN products p ON l.product_id = p.id
        LEFT JOIN suppliers s ON l.supplier_id = s.id
      `;
      const params: unknown[] = [];

      if (productId) {
        sql += ' WHERE l.product_id = ?';
        params.push(productId);
      }

      sql += ' ORDER BY l.purchase_date ASC, l.id ASC';

      return await this.db.query<InventoryLot>(sql, params);
    } catch (err) {
      logger.error('SqliteInventoryDataSource', 'Failed to get inventory lots', err);
      return [];
    }
  }

  async getStockMovements(productId?: number, limit = 50): Promise<StockMovement[]> {
    try {
      let sql = `
        SELECT 
          m.id,
          m.product_id,
          p.name as product_name,
          p.sku,
          m.movement_type,
          m.quantity_change,
          m.balance_after,
          m.movement_date,
          m.reference_type,
          m.reference_id,
          m.sync_status,
          m.note,
          m.created_by,
          u.full_name as creator_name,
          m.created_at
        FROM stock_movements m
        LEFT JOIN products p ON m.product_id = p.id
        LEFT JOIN users u ON m.created_by = u.id
      `;
      const params: unknown[] = [];

      if (productId) {
        sql += ' WHERE m.product_id = ?';
        params.push(productId);
      }

      sql += ' ORDER BY m.id DESC LIMIT ?';
      params.push(limit);

      return await this.db.query<StockMovement>(sql, params);
    } catch (err) {
      logger.error('SqliteInventoryDataSource', 'Failed to get stock movements', err);
      return [];
    }
  }

  async getPriceHistory(productId: number): Promise<PriceHistoryRecord[]> {
    try {
      return await this.db.query<PriceHistoryRecord>(`
        SELECT id, product_id, price, effective_from, note, created_by, created_at
        FROM price_history
        WHERE product_id = ?
        ORDER BY effective_from DESC, id DESC
      `, [productId]);
    } catch (err) {
      logger.error('SqliteInventoryDataSource', `Failed to get price history for product ${productId}`, err);
      return [];
    }
  }

  async getCostHistory(productId: number): Promise<CostHistoryRecord[]> {
    try {
      return await this.db.query<CostHistoryRecord>(`
        SELECT id, product_id, cost_price, effective_from, note, created_by, created_at
        FROM cost_price_history
        WHERE product_id = ?
        ORDER BY effective_from DESC, id DESC
      `, [productId]);
    } catch (err) {
      logger.error('SqliteInventoryDataSource', `Failed to get cost history for product ${productId}`, err);
      return [];
    }
  }

  async getInventorySummary(): Promise<{ totalProducts: number; totalStock: number; totalValuation: number; lowStockCount: number }> {
    try {
      const summary = await this.db.queryOne<any>(`
        SELECT 
          COUNT(id) as total_products,
          COALESCE(SUM(current_stock), 0) as total_stock,
          COALESCE(SUM(current_stock * current_cost_price), 0) as total_valuation,
          COALESCE(SUM(CASE WHEN current_stock <= min_stock_alert THEN 1 ELSE 0 END), 0) as low_stock_count
        FROM products
        WHERE status = 'ACTIVE'
      `);

      return {
        totalProducts: Number(summary?.total_products || 0),
        totalStock: Number(summary?.total_stock || 0),
        totalValuation: Number(summary?.total_valuation || 0),
        lowStockCount: Number(summary?.low_stock_count || 0),
      };
    } catch (err) {
      logger.error('SqliteInventoryDataSource', 'Failed to get inventory summary', err);
      return { totalProducts: 0, totalStock: 0, totalValuation: 0, lowStockCount: 0 };
    }
  }
}

export default SqliteInventoryDataSource;
