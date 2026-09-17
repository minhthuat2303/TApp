import databaseService, { DatabaseService } from '../database/DatabaseService';
import { ConflictRecord, ITransactionClient } from '../database/types';
import logger from '../utils/logger';

export class ConflictService {
  private db: DatabaseService;

  constructor(db?: DatabaseService) {
    this.db = db || databaseService;
  }

  async recordConflict(conflict: {
    conflict_id?: string;
    client_transaction_id: string;
    conflict_type?: string;
    operation?: string;
    entity_type: string;
    entity_id: string;
    device_id?: string | null;
    user_id?: string | null;
    local_data: any;
    server_data: any;
    reason: string;
  }): Promise<number> {
    const conflictId = conflict.conflict_id || `conf-${conflict.client_transaction_id}-${Date.now().toString().slice(-4)}`;
    const localDataStr = typeof conflict.local_data === 'string' ? conflict.local_data : JSON.stringify(conflict.local_data);
    const serverDataStr = typeof conflict.server_data === 'string' ? conflict.server_data : JSON.stringify(conflict.server_data);
    const conflictType = conflict.conflict_type || 'UNKNOWN_CONFLICT';
    const operation = conflict.operation || 'PUSH_MUTATION';

    const result = await this.db.execute(`
      INSERT INTO conflict_records (
        conflict_id, client_transaction_id, conflict_type, operation,
        entity_type, entity_id, device_id, user_id,
        local_data, server_data, reason, status, detected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', datetime('now'))
    `, [
      conflictId,
      conflict.client_transaction_id,
      conflictType,
      operation,
      conflict.entity_type,
      conflict.entity_id,
      conflict.device_id || null,
      conflict.user_id || null,
      localDataStr,
      serverDataStr,
      conflict.reason,
    ]);

    logger.warn('ConflictService', `Conflict recorded [${conflictId}] type=${conflictType} for ${conflict.entity_type} (${conflict.client_transaction_id}): ${conflict.reason}`);
    return result.lastInsertRowId;
  }

  async getOpenConflicts(userId?: number): Promise<ConflictRecord[]> {
    if (userId !== undefined) {
      return await this.db.query<ConflictRecord>(`
        SELECT * FROM conflict_records
        WHERE status = 'OPEN' AND (user_id = ? OR user_id IS NULL)
        ORDER BY id DESC
      `, [userId]);
    }
    return await this.db.query<ConflictRecord>(`
      SELECT * FROM conflict_records
      WHERE status = 'OPEN'
      ORDER BY id DESC
    `);
  }

  async getAllConflicts(filter?: { status?: string; conflict_type?: string; user_id?: number }): Promise<ConflictRecord[]> {
    let sql = 'SELECT * FROM conflict_records WHERE 1=1';
    const params: any[] = [];

    if (filter?.status) {
      sql += ' AND status = ?';
      params.push(filter.status);
    }
    if (filter?.conflict_type) {
      sql += ' AND conflict_type = ?';
      params.push(filter.conflict_type);
    }
    if (filter?.user_id !== undefined) {
      sql += ' AND (user_id = ? OR user_id IS NULL)';
      params.push(filter.user_id);
    }

    sql += ' ORDER BY id DESC';
    return await this.db.query<ConflictRecord>(sql, params);
  }

  async getConflictById(conflictId: string): Promise<ConflictRecord | null> {
    return await this.db.queryOne<ConflictRecord>(`
      SELECT * FROM conflict_records WHERE conflict_id = ?
    `, [conflictId]);
  }

  async getConflictCount(userId?: number): Promise<number> {
    if (userId !== undefined) {
      const row = await this.db.queryOne<{ count: number }>(`
        SELECT COUNT(*) as count FROM conflict_records 
        WHERE status = 'OPEN' AND (user_id = ? OR user_id IS NULL)
      `, [userId]);
      return row ? row.count : 0;
    }
    const row = await this.db.queryOne<{ count: number }>(`
      SELECT COUNT(*) as count FROM conflict_records WHERE status = 'OPEN'
    `);
    return row ? row.count : 0;
  }

  /**
   * Resolution Strategy 1: CANCEL_LOCAL
   * Non-destructive rollback: Marks local order as CANCELLED, releases reserved stock
   * by adding compensating stock movements, and marks the conflict as RESOLVED.
   */
  async resolveWithCancellation(conflictId: string, reason: string, resolvedBy: string, resolvingUserId?: number): Promise<void> {
    const conflict = await this.getConflictById(conflictId);
    if (!conflict) {
      throw new Error(`Conflict record '${conflictId}' not found.`);
    }

    if (resolvingUserId !== undefined && conflict.user_id !== null && conflict.user_id !== resolvingUserId && resolvingUserId !== 1) {
      throw new Error(`Permission denied: User ${resolvingUserId} cannot resolve conflict belonging to user ${conflict.user_id}.`);
    }

    await this.db.withTransaction(async (tx: ITransactionClient) => {
      // 1. Mark conflict as RESOLVED with CANCEL_LOCAL
      await tx.runAsync(`
        UPDATE conflict_records
        SET status = 'RESOLVED',
            resolution = 'CANCEL_LOCAL',
            resolved_at = datetime('now'),
            resolved_by = ?
        WHERE conflict_id = ?
      `, [resolvedBy, conflictId]);

      // 2. If entity is SALE_ORDER, revert local inventory and cancel order
      if (conflict.entity_type === 'SALE_ORDER') {
        const clientOrderId = conflict.client_transaction_id;

        // Fetch sales records to restore local stock
        const items = await tx.getAllAsync<{ product_id: number; quantity: number }>(`
          SELECT product_id, quantity FROM sales_records WHERE client_order_id = ?
        `, [clientOrderId]);

        const todayStr = new Date().toISOString().slice(0, 10);

        for (const item of items) {
          // Fetch current stock
          const prod = await tx.getFirstAsync<{ current_stock: number }>(
            'SELECT current_stock FROM products WHERE id = ?',
            [item.product_id]
          );
          const currentStock = prod ? prod.current_stock : 0;
          const restoredStock = currentStock + item.quantity;

          // Restore product stock
          await tx.runAsync(
            'UPDATE products SET current_stock = ?, updated_at = datetime(\'now\') WHERE id = ?',
            [restoredStock, item.product_id]
          );

          // Add compensating stock movement
          const movId = `mov-revert-${clientOrderId.slice(-8)}-p${item.product_id}`;
          await tx.runAsync(`
            INSERT INTO stock_movements (
              client_movement_id, product_id, movement_type, quantity_change,
              balance_after, movement_date, reference_type, reference_id,
              sync_status, note, created_by, created_at
            ) VALUES (?, ?, 'ADJUSTMENT', ?, ?, ?, 'conflict_resolution', ?, 'SYNCED', ?, ?, datetime('now'))
          `, [
            movId,
            item.product_id,
            item.quantity, // Positive adjustment compensating for cancelled sale
            restoredStock,
            todayStr,
            conflictId,
            `Hủy đơn bán do xung đột: ${reason}`,
            resolvedBy,
          ]);
        }

        // Cancel sales_orders and sales_records
        await tx.runAsync(`
          UPDATE sales_orders
          SET status = 'CANCELLED', sync_status = 'FAILED'
          WHERE client_order_id = ?
        `, [clientOrderId]);

        await tx.runAsync(`
          UPDATE sales_records
          SET status = 'CANCELLED', sync_status = 'FAILED'
          WHERE client_order_id = ?
        `, [clientOrderId]);

        // Mark outbox entry as FAILED with cancellation reason
        await tx.runAsync(`
          UPDATE sync_queue
          SET status = 'FAILED',
              last_error = ?,
              updated_at = datetime('now')
          WHERE client_mutation_id = ?
        `, [`Đã hủy tại thiết bị do xung đột: ${reason}`, clientOrderId]);
      }

      logger.info('ConflictService', `Resolved conflict ${conflictId} via CANCEL_LOCAL by ${resolvedBy}`);
    });
  }

  /**
   * Resolution Strategy 2: RESTOCK_AND_RETRY
   * Used when server stock has been replenished, allowing the offline mutation to retry sync.
   */
  async resolveWithRetry(conflictId: string, resolvedBy: string, resolvingUserId?: number): Promise<void> {
    const conflict = await this.getConflictById(conflictId);
    if (!conflict) {
      throw new Error(`Conflict record '${conflictId}' not found.`);
    }

    if (resolvingUserId !== undefined && conflict.user_id !== null && conflict.user_id !== resolvingUserId && resolvingUserId !== 1) {
      throw new Error(`Permission denied: User ${resolvingUserId} cannot resolve conflict belonging to user ${conflict.user_id}.`);
    }

    await this.db.withTransaction(async (tx: ITransactionClient) => {
      // 1. Mark conflict as REVIEWING or RESOLVED
      await tx.runAsync(`
        UPDATE conflict_records
        SET status = 'REVIEWING',
            resolution = 'RESTOCK_AND_RETRY',
            resolved_at = datetime('now'),
            resolved_by = ?
        WHERE conflict_id = ?
      `, [resolvedBy, conflictId]);

      // 2. Reset outbox item to PENDING for retry
      await tx.runAsync(`
        UPDATE sync_queue
        SET status = 'PENDING',
            retry_count = 0,
            next_retry_at = datetime('now'),
            last_error = NULL,
            updated_at = datetime('now')
        WHERE client_mutation_id = ?
      `, [conflict.client_transaction_id]);

      // 3. Reset sales_orders sync_status to PENDING
      if (conflict.entity_type === 'SALE_ORDER') {
        await tx.runAsync(`
          UPDATE sales_orders
          SET sync_status = 'PENDING'
          WHERE client_order_id = ?
        `, [conflict.client_transaction_id]);
      }

      logger.info('ConflictService', `Scheduled retry for conflict ${conflictId} by ${resolvedBy}`);
    });
  }

  /**
   * Resolution Strategy 3: DISMISS / IGNORE
   * Keeps the transaction in its current state, closes the conflict record.
   */
  async resolveWithDismiss(conflictId: string, resolvedBy: string, note?: string, resolvingUserId?: number): Promise<void> {
    const conflict = await this.getConflictById(conflictId);
    if (!conflict) {
      throw new Error(`Conflict record '${conflictId}' not found.`);
    }

    if (resolvingUserId !== undefined && conflict.user_id !== null && conflict.user_id !== resolvingUserId && resolvingUserId !== 1) {
      throw new Error(`Permission denied: User ${resolvingUserId} cannot resolve conflict belonging to user ${conflict.user_id}.`);
    }

    await this.db.execute(`
      UPDATE conflict_records
      SET status = 'IGNORED',
          resolution = 'DISMISSED',
          resolved_at = datetime('now'),
          resolved_by = ?
      WHERE conflict_id = ?
    `, [resolvedBy, conflictId]);

    logger.info('ConflictService', `Dismissed conflict ${conflictId} by ${resolvedBy}: ${note || 'No note'}`);
  }

  async resolveConflict(conflictId: string, status: 'RESOLVED' | 'IGNORED' = 'RESOLVED'): Promise<void> {
    await this.db.execute(`
      UPDATE conflict_records
      SET status = ?, resolved_at = datetime('now')
      WHERE conflict_id = ?
    `, [status, conflictId]);

    logger.info('ConflictService', `Conflict ${conflictId} marked ${status}`);
  }
}

export const conflictService = new ConflictService();
export default conflictService;
