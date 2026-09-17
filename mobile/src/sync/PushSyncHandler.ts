import databaseService, { DatabaseService } from '../database/DatabaseService';
import { ITransactionClient, SyncQueueRecord } from '../database/types';
import outboxService, { OutboxService } from '../services/OutboxService';
import conflictService, { ConflictService } from './ConflictService';
import apiClient from '../api/client';
import Endpoints from '../api/endpoints';
import { PushMutationItem, PushMutationResult, PushSyncResponse } from './types';
import { MobileError } from '../types/errors';
import logger from '../utils/logger';

export class PushSyncHandler {
  private db: DatabaseService;
  private outbox: OutboxService;
  private conflicts: ConflictService;

  constructor(
    db?: DatabaseService,
    outbox?: OutboxService,
    conflicts?: ConflictService
  ) {
    this.db = db || databaseService;
    this.outbox = outbox || outboxService;
    this.conflicts = conflicts || conflictService;
  }

  // --- 1. RECOVERY OF STALE SYNCING RECORDS (Crash / Kill Recovery) ---
  async recoverStaleSyncingRecords(maxAgeMs = 60000): Promise<number> {
    const thresholdDate = new Date(Date.now() - maxAgeMs).toISOString();
    const result = await this.db.execute(`
      UPDATE sync_queue
      SET status = 'PENDING',
          updated_at = datetime('now')
      WHERE status = 'SYNCING' AND updated_at <= ?
    `, [thresholdDate]);

    if (result.changes > 0) {
      logger.warn('PushSyncHandler', `Recovered ${result.changes} stale SYNCING records back to PENDING`);
    }
    return result.changes;
  }

  // --- 2. RETRIEVE ELIGIBLE OUTBOX MUTATIONS ---
  async getEligibleMutations(limit = 20, userId?: number): Promise<SyncQueueRecord[]> {
    const nowIso = new Date().toISOString();
    if (userId !== undefined) {
      return await this.db.query<SyncQueueRecord>(`
        SELECT * FROM sync_queue
        WHERE (user_id = ? OR user_id IS NULL)
          AND (status = 'PENDING'
            OR (status = 'RETRY' AND next_retry_at IS NOT NULL AND next_retry_at <= ?))
        ORDER BY id ASC
        LIMIT ?
      `, [userId, nowIso, limit]);
    }
    return await this.db.query<SyncQueueRecord>(`
      SELECT * FROM sync_queue
      WHERE status = 'PENDING'
         OR (status = 'RETRY' AND next_retry_at IS NOT NULL AND next_retry_at <= ?)
      ORDER BY id ASC
      LIMIT ?
    `, [nowIso, limit]);
  }

  // --- 3. PUSH BATCH OF OUTBOX MUTATIONS ---
  async pushPendingMutations(batchSize = 20, userId?: number): Promise<{
    processed: number;
    successes: number;
    failures: number;
    conflicts: number;
  }> {
    const eligibleRecords = await this.getEligibleMutations(batchSize, userId);
    if (eligibleRecords.length === 0) {
      return { processed: 0, successes: 0, failures: 0, conflicts: 0 };
    }

    logger.info('PushSyncHandler', `Starting push for ${eligibleRecords.length} mutations`);

    // Mark all as SYNCING
    for (const record of eligibleRecords) {
      await this.outbox.markSyncing(record.id);
    }

    const mutationPayloads: PushMutationItem[] = eligibleRecords.map((r) => {
      let parsedPayload: any = {};
      try {
        parsedPayload = JSON.parse(r.payload_json);
      } catch {
        parsedPayload = {};
      }
      return {
        client_mutation_id: r.client_mutation_id,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        action: r.action,
        payload: parsedPayload,
        payload_version: r.payload_version,
        created_at: r.created_at,
      };
    });

    let successes = 0;
    let failures = 0;
    let conflicts = 0;

    try {
      const response = await apiClient.post<PushSyncResponse>(Endpoints.SYNC_PUSH, {
        mutations: mutationPayloads,
      });

      const results: PushMutationResult[] = response.data?.results || [];
      const resultMap = new Map<string, PushMutationResult>();
      for (const res of results) {
        resultMap.set(res.client_mutation_id, res);
      }

      for (const record of eligibleRecords) {
        const itemResult = resultMap.get(record.client_mutation_id);

        if (!itemResult) {
          // If server did not return a result for this item, mark for retry
          await this.outbox.markRetry(record.id, 'Máy chủ không phản hồi kết quả cho giao dịch này', record.retry_count);
          failures++;
          continue;
        }

        if (itemResult.status === 'SYNCED' || itemResult.status === 'ALREADY_PROCESSED') {
          // --- SUCCESS / ALREADY PROCESSED ---
          await this.commitSyncedRecord(record, itemResult.server_transaction_id);
          successes++;
        } else if (itemResult.status === 'CONFLICT') {
          // --- CONFLICT DETECTED ---
          await this.handleConflictRecord(record, itemResult);
          conflicts++;
        } else {
          // --- FATAL / VALIDATION ERROR ---
          const errorMsg = itemResult.error?.message || 'Lỗi xử lý từ chối bởi máy chủ';
          await this.outbox.markFailed(record.id, errorMsg);
          failures++;
        }
      }
    } catch (err: any) {
      const mobileError = err instanceof MobileError ? err : new MobileError('NETWORK_ERROR', err.message || 'Lỗi kết nối');
      logger.error('PushSyncHandler', `Push request failed (${mobileError.statusCode || 0}): ${mobileError.message}`);

      // Handle specific error codes
      if (mobileError.statusCode === 401 || mobileError.statusCode === 403) {
        // Auth error: Revert records to PENDING so they are not failed permanently
        for (const record of eligibleRecords) {
          await this.db.execute("UPDATE sync_queue SET status = 'PENDING' WHERE id = ?", [record.id]);
        }
        throw mobileError;
      }

      // Retryable errors: 429, 5xx, Network disconnect, Timeout
      for (const record of eligibleRecords) {
        await this.outbox.markRetry(record.id, mobileError.message, record.retry_count);
      }

      failures += eligibleRecords.length;
    }

    return {
      processed: eligibleRecords.length,
      successes,
      failures,
      conflicts,
    };
  }

  // Atomically mark outbox item SYNCED and update corresponding local domain entity
  private async commitSyncedRecord(record: SyncQueueRecord, serverTransactionId?: number | null): Promise<void> {
    await this.db.withTransaction(async (tx: ITransactionClient) => {
      // 1. Mark Outbox record as SYNCED
      await tx.runAsync(`
        UPDATE sync_queue
        SET status = 'SYNCED',
            last_error = NULL,
            next_retry_at = NULL,
            updated_at = datetime('now')
        WHERE id = ?
      `, [record.id]);

      // 2. Update local entity sync status
      if (record.entity_type === 'SALE_ORDER' || record.entity_type === 'CANCEL_SALE_ORDER') {
        const targetOrderId = record.entity_id || record.client_mutation_id;
        await tx.runAsync(`
          UPDATE sales_orders
          SET sync_status = 'SYNCED',
              synced_at = datetime('now')
          WHERE client_order_id = ? OR client_order_id = ?
        `, [record.client_mutation_id, targetOrderId]);

        await tx.runAsync(`
          UPDATE sales_records
          SET sync_status = 'SYNCED'
          WHERE client_order_id = ? OR client_order_id = ?
        `, [record.client_mutation_id, targetOrderId]);
      } else if (record.entity_type === 'IMPORT') {
        await tx.runAsync(`
          UPDATE imports
          SET sync_status = 'SYNCED',
              server_id = ?,
              synced_at = datetime('now')
          WHERE client_import_id = ?
        `, [serverTransactionId || null, record.client_mutation_id]);
      } else if (record.entity_type === 'INVENTORY_ADJUSTMENT') {
        await tx.runAsync(`
          UPDATE stock_movements
          SET sync_status = 'SYNCED'
          WHERE client_movement_id = ?
        `, [record.client_mutation_id]);
      }
    });

    logger.info('PushSyncHandler', `Mutation ${record.client_mutation_id} (${record.entity_type}) committed as SYNCED`);
  }

  // Handle conflict by creating a persistent ConflictRecord and marking Outbox as FAILED
  private async handleConflictRecord(record: SyncQueueRecord, result: PushMutationResult): Promise<void> {
    const errorMsg = result.error?.message || 'Xung đột dữ liệu với trạng thái máy chủ';
    const reasonCode = result.error?.code || 'CONFLICT';
    const conflictType = result.conflict_type || (result.error?.code?.includes('STOCK') ? 'INVENTORY_CONFLICT' : 'BUSINESS_CONFLICT');

    await this.conflicts.recordConflict({
      client_transaction_id: record.client_mutation_id,
      conflict_type: conflictType,
      operation: 'PUSH_MUTATION',
      entity_type: record.entity_type,
      entity_id: record.entity_id,
      local_data: record.payload_json,
      server_data: { error: result.error, server_timestamp: result.server_timestamp },
      reason: `[${reasonCode}] ${errorMsg}`,
    });

    // Mark outbox record as FAILED (do not retry automatically without intervention)
    await this.outbox.markFailed(record.id, `CONFLICT: ${errorMsg}`);

    // Update local sales order / import status
    if (record.entity_type === 'SALE_ORDER' || record.entity_type === 'CANCEL_SALE_ORDER') {
      const targetId = record.entity_id || record.client_mutation_id;
      await this.db.execute("UPDATE sales_orders SET sync_status = 'FAILED' WHERE client_order_id = ? OR client_order_id = ?", [record.client_mutation_id, targetId]);
    } else if (record.entity_type === 'IMPORT') {
      await this.db.execute("UPDATE imports SET sync_status = 'FAILED' WHERE client_import_id = ?", [record.client_mutation_id]);
    }
  }
}

export const pushSyncHandler = new PushSyncHandler();
export default pushSyncHandler;
