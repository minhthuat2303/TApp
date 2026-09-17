import databaseService, { DatabaseService } from '../database/DatabaseService';
import { ITransactionClient, StockDriftRecord } from '../database/types';
import logger from '../utils/logger';

export interface ProductReconciliationResult {
  productId: number;
  productName: string;
  sku: string;
  actualStock: number;
  expectedStock: number;
  driftQuantity: number;
  hasDrift: boolean;
}

export interface EffectiveStockBreakdown {
  productId: number;
  cachedStock: number;
  pendingSales: number;
  pendingImports: number;
  effectiveStock: number;
}

export class InventoryReconciliationService {
  private db: DatabaseService;

  constructor(db?: DatabaseService) {
    this.db = db || databaseService;
  }

  /**
   * Reconciles a single product's cached stock against the sum of historical stock movements.
   */
  async reconcileProductStock(productId: number, source: string = 'AUDIT'): Promise<ProductReconciliationResult> {
    const product = await this.db.queryOne<{ id: number; name: string; sku: string; current_stock: number }>(`
      SELECT id, name, sku, current_stock FROM products WHERE id = ?
    `, [productId]);

    if (!product) {
      throw new Error(`Product with ID ${productId} not found`);
    }

    const movementRow = await this.db.queryOne<{ total_change: number }>(`
      SELECT COALESCE(SUM(quantity_change), 0) as total_change
      FROM stock_movements
      WHERE product_id = ?
    `, [productId]);

    const expectedStock = movementRow ? Number(movementRow.total_change) : 0;
    const actualStock = product.current_stock;
    const driftQuantity = actualStock - expectedStock;
    const hasDrift = driftQuantity !== 0;

    if (hasDrift) {
      await this.db.execute(`
        INSERT INTO stock_drift_records (
          product_id, expected_stock, actual_stock, drift_quantity,
          detected_at, source, status, notes
        ) VALUES (?, ?, ?, ?, datetime('now'), ?, 'DETECTED', ?)
      `, [
        productId,
        expectedStock,
        actualStock,
        driftQuantity,
        source,
        `Phát hiện chênh lệch: Kho hiển thị ${actualStock}, Tổng sổ cái ${expectedStock}`
      ]);

      logger.warn('InventoryReconciliation', `Stock drift detected for product ${productId} (${product.sku}): actual=${actualStock}, expected=${expectedStock}, drift=${driftQuantity}`);
    }

    return {
      productId,
      productName: product.name,
      sku: product.sku,
      actualStock,
      expectedStock,
      driftQuantity,
      hasDrift,
    };
  }

  /**
   * Audits all products in the database to detect ledger discrepancies.
   */
  async reconcileAllProducts(source: string = 'ROUTINE_AUDIT'): Promise<ProductReconciliationResult[]> {
    const rows = await this.db.query<{
      id: number;
      name: string;
      sku: string;
      current_stock: number;
      ledger_sum: number;
    }>(`
      SELECT 
        p.id,
        p.name,
        p.sku,
        p.current_stock,
        COALESCE(SUM(sm.quantity_change), 0) as ledger_sum
      FROM products p
      LEFT JOIN stock_movements sm ON p.id = sm.product_id
      GROUP BY p.id
    `);

    const drifts: ProductReconciliationResult[] = [];

    for (const row of rows) {
      const expectedStock = Number(row.ledger_sum);
      const actualStock = row.current_stock;
      const driftQuantity = actualStock - expectedStock;
      const hasDrift = driftQuantity !== 0;

      if (hasDrift) {
        await this.db.execute(`
          INSERT INTO stock_drift_records (
            product_id, expected_stock, actual_stock, drift_quantity,
            detected_at, source, status, notes
          ) VALUES (?, ?, ?, ?, datetime('now'), ?, 'DETECTED', ?)
        `, [
          row.id,
          expectedStock,
          actualStock,
          driftQuantity,
          source,
          `Batch audit: Sổ cái=${expectedStock}, Tồn thực tế=${actualStock}`
        ]);

        drifts.push({
          productId: row.id,
          productName: row.name,
          sku: row.sku,
          actualStock,
          expectedStock,
          driftQuantity,
          hasDrift: true,
        });
      }
    }

    logger.info('InventoryReconciliation', `Audit completed: checked ${rows.length} products, found ${drifts.length} drifts.`);
    return drifts;
  }

  /**
   * Computes effective stock breakdown factoring in pending offline sales and pending imports.
   */
  async getEffectiveStockBreakdown(productId: number): Promise<EffectiveStockBreakdown> {
    const prod = await this.db.queryOne<{ id: number; current_stock: number }>(`
      SELECT id, current_stock FROM products WHERE id = ?
    `, [productId]);

    if (!prod) {
      throw new Error(`Product with ID ${productId} not found`);
    }

    const pendingSalesRow = await this.db.queryOne<{ pending_qty: number }>(`
      SELECT COALESCE(SUM(quantity), 0) as pending_qty
      FROM sales_records
      WHERE product_id = ? AND status = 'COMPLETED' AND sync_status = 'PENDING'
    `, [productId]);

    const pendingImportsRow = await this.db.queryOne<{ pending_qty: number }>(`
      SELECT COALESCE(SUM(ii.quantity), 0) as pending_qty
      FROM import_items ii
      JOIN imports i ON ii.import_id = i.id
      WHERE ii.product_id = ? AND i.sync_status = 'PENDING'
    `, [productId]);

    const cachedStock = prod.current_stock;
    const pendingSales = pendingSalesRow ? Number(pendingSalesRow.pending_qty) : 0;
    const pendingImports = pendingImportsRow ? Number(pendingImportsRow.pending_qty) : 0;
    const effectiveStock = cachedStock - pendingSales;

    return {
      productId,
      cachedStock,
      pendingSales,
      pendingImports,
      effectiveStock,
    };
  }

  /**
   * Retrieves stock drift records.
   */
  async getDriftRecords(status?: 'DETECTED' | 'RECONCILED' | 'IGNORED'): Promise<StockDriftRecord[]> {
    let sql = `
      SELECT 
        s.*,
        p.name as product_name,
        p.sku
      FROM stock_drift_records s
      JOIN products p ON s.product_id = p.id
    `;
    const params: any[] = [];

    if (status) {
      sql += ' WHERE s.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY s.id DESC';
    return await this.db.query<StockDriftRecord>(sql, params);
  }

  /**
   * Resolves a stock drift record.
   */
  async resolveDrift(
    driftRecordId: number,
    action: 'ALIGN_TO_LEDGER' | 'ALIGN_TO_COUNT' | 'DISMISS',
    resolvedBy: number,
    notes?: string
  ): Promise<void> {
    const drift = await this.db.queryOne<StockDriftRecord>(`
      SELECT * FROM stock_drift_records WHERE id = ?
    `, [driftRecordId]);

    if (!drift) {
      throw new Error(`Drift record ${driftRecordId} not found`);
    }

    await this.db.withTransaction(async (tx: ITransactionClient) => {
      const todayStr = new Date().toISOString().slice(0, 10);

      if (action === 'ALIGN_TO_LEDGER') {
        // Adjust product stock to match ledger
        await tx.runAsync(`
          UPDATE products SET current_stock = ?, updated_at = datetime('now') WHERE id = ?
        `, [drift.expected_stock, drift.product_id]);
      } else if (action === 'ALIGN_TO_COUNT') {
        // Add compensatory ledger movement so ledger matches actual count
        const movId = `mov-drift-${drift.id}-${Date.now().toString().slice(-4)}`;
        await tx.runAsync(`
          INSERT INTO stock_movements (
            client_movement_id, product_id, movement_type, quantity_change,
            balance_after, movement_date, reference_type, reference_id,
            sync_status, note, created_by, created_at
          ) VALUES (?, ?, 'ADJUSTMENT', ?, ?, ?, 'drift_reconciliation', ?, 'SYNCED', ?, ?, datetime('now'))
        `, [
          movId,
          drift.product_id,
          drift.drift_quantity,
          drift.actual_stock,
          todayStr,
          drift.id.toString(),
          notes || 'Cân bằng sổ cái theo kiểm kê thực tế',
          resolvedBy
        ]);
      }

      const finalStatus = action === 'DISMISS' ? 'IGNORED' : 'RECONCILED';
      await tx.runAsync(`
        UPDATE stock_drift_records
        SET status = ?,
            notes = COALESCE(notes || ' | ', '') || ?
        WHERE id = ?
      `, [finalStatus, `Resolved [${action}] by user ${resolvedBy}: ${notes || ''}`, driftRecordId]);
    });

    logger.info('InventoryReconciliation', `Resolved drift ${driftRecordId} with action ${action}`);
  }
}

export const inventoryReconciliationService = new InventoryReconciliationService();
export default inventoryReconciliationService;
