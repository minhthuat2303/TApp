import databaseService, { DatabaseService } from '../database/DatabaseService';
import { ITransactionClient, SyncQueueRecord } from '../database/types';
import { OutboxMutationPayload, OutboxRetryConfig } from './types';
import logger from '../utils/logger';

export const DEFAULT_RETRY_CONFIG: OutboxRetryConfig = {
  maxRetries: 5,
  baseDelayMs: 2000, // 2 seconds
  maxDelayMs: 60000, // 1 minute
};

export class OutboxService {
  private db: DatabaseService;
  private retryConfig: OutboxRetryConfig;

  constructor(db?: DatabaseService, retryConfig: OutboxRetryConfig = DEFAULT_RETRY_CONFIG) {
    this.db = db || databaseService;
    this.retryConfig = retryConfig;
  }

  // Enqueue mutation within an active atomic transaction
  async enqueueMutation<T>(
    tx: ITransactionClient,
    mutation: OutboxMutationPayload<T>
  ): Promise<number> {
    const payloadJson = JSON.stringify(mutation.payload);
    const result = await tx.runAsync(`
      INSERT INTO sync_queue (
        client_mutation_id, entity_type, entity_id, action,
        payload_json, payload_version, status, retry_count,
        user_id, device_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?, datetime('now'), datetime('now'))
    `, [
      mutation.client_mutation_id,
      mutation.entity_type,
      mutation.entity_id,
      mutation.action,
      payloadJson,
      mutation.payload_version || 1,
      mutation.user_id !== undefined ? mutation.user_id : null,
      mutation.device_id || null,
    ]);

    logger.debug('OutboxService', `Enqueued mutation ${mutation.client_mutation_id} (${mutation.entity_type}) for user ${mutation.user_id}`);
    return result.lastInsertRowId;
  }

  // Convenience helper: enqueue mutation using automatic transaction
  async enqueue<T>(mutation: {
    clientMutationId: string;
    entityType: any;
    entityId: string;
    action: 'CREATE' | 'UPDATE' | 'DELETE';
    payload: T;
    payloadVersion?: number;
    userId?: number;
    deviceId?: string;
  }): Promise<number> {
    return await this.db.withTransactionAsync(async (tx) => {
      return await this.enqueueMutation(tx, {
        client_mutation_id: mutation.clientMutationId,
        entity_type: mutation.entityType,
        entity_id: mutation.entityId,
        action: mutation.action,
        payload: mutation.payload,
        payload_version: mutation.payloadVersion || 1,
        created_at: new Date().toISOString(),
        user_id: mutation.userId,
        device_id: mutation.deviceId,
      });
    });
  }

  // Transition: PENDING / RETRY -> SYNCING
  async markSyncing(id: number): Promise<void> {
    await this.db.execute(`
      UPDATE sync_queue 
      SET status = 'SYNCING', updated_at = datetime('now')
      WHERE id = ? AND status IN ('PENDING', 'RETRY')
    `, [id]);
    logger.debug('OutboxService', `Mutation ${id} transitioned to SYNCING`);
  }

  // Transition: SYNCING -> SYNCED
  async markSynced(id: number): Promise<void> {
    await this.db.execute(`
      UPDATE sync_queue 
      SET status = 'SYNCED', last_error = NULL, next_retry_at = NULL, updated_at = datetime('now')
      WHERE id = ?
    `, [id]);
    logger.info('OutboxService', `Mutation ${id} transitioned to SYNCED`);
  }

  // Transition: SYNCING -> RETRY (with exponential backoff) or FAILED (if max retries reached)
  async markRetry(id: number, errorMessage: string, currentRetryCount: number): Promise<'RETRY' | 'FAILED'> {
    const nextRetryCount = currentRetryCount + 1;

    if (nextRetryCount > this.retryConfig.maxRetries) {
      await this.markFailed(id, `Đã vượt quá số lần retry tối đa (${this.retryConfig.maxRetries}): ${errorMessage}`);
      return 'FAILED';
    }

    // Exponential backoff calculation with jitter
    const delay = Math.min(
      this.retryConfig.baseDelayMs * Math.pow(2, nextRetryCount - 1) + Math.random() * 500,
      this.retryConfig.maxDelayMs
    );
    const nextRetryDate = new Date(Date.now() + delay).toISOString();

    await this.db.execute(`
      UPDATE sync_queue 
      SET status = 'RETRY',
          retry_count = ?,
          last_error = ?,
          next_retry_at = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `, [nextRetryCount, errorMessage, nextRetryDate, id]);

    logger.warn('OutboxService', `Mutation ${id} transitioned to RETRY (attempt ${nextRetryCount}, next at ${nextRetryDate})`);
    return 'RETRY';
  }

  // Transition: SYNCING / RETRY -> FAILED (fatal unrecoverable error)
  async markFailed(id: number, fatalError: string): Promise<void> {
    await this.db.execute(`
      UPDATE sync_queue 
      SET status = 'FAILED',
          last_error = ?,
          next_retry_at = NULL,
          updated_at = datetime('now')
      WHERE id = ?
    `, [fatalError, id]);
    logger.error('OutboxService', `Mutation ${id} marked FAILED: ${fatalError}`);
  }

  // Transition: FAILED -> PENDING (manual retry requested by user)
  async resetToPending(id: number): Promise<void> {
    await this.db.execute(`
      UPDATE sync_queue 
      SET status = 'PENDING',
          retry_count = 0,
          last_error = NULL,
          next_retry_at = NULL,
          updated_at = datetime('now')
      WHERE id = ?
    `, [id]);
    logger.info('OutboxService', `Mutation ${id} reset to PENDING by user action`);
  }

  // Retrieve pending mutations ready for sync processing
  async getPendingMutations(limit = 50, userId?: number): Promise<SyncQueueRecord[]> {
    if (userId !== undefined) {
      return await this.db.query<SyncQueueRecord>(`
        SELECT * FROM sync_queue 
        WHERE status = 'PENDING' AND (user_id = ? OR user_id IS NULL)
        ORDER BY id ASC 
        LIMIT ?
      `, [userId, limit]);
    }
    return await this.db.query<SyncQueueRecord>(`
      SELECT * FROM sync_queue 
      WHERE status = 'PENDING'
      ORDER BY id ASC 
      LIMIT ?
    `, [limit]);
  }

  // Retrieve mutations ready for retry
  async getReadyRetryMutations(nowIso?: string, limit = 50, userId?: number): Promise<SyncQueueRecord[]> {
    const now = nowIso || new Date().toISOString();
    if (userId !== undefined) {
      return await this.db.query<SyncQueueRecord>(`
        SELECT * FROM sync_queue 
        WHERE status = 'RETRY' AND (user_id = ? OR user_id IS NULL) AND next_retry_at <= ?
        ORDER BY id ASC 
        LIMIT ?
      `, [userId, now, limit]);
    }
    return await this.db.query<SyncQueueRecord>(`
      SELECT * FROM sync_queue 
      WHERE status = 'RETRY' AND next_retry_at <= ?
      ORDER BY id ASC 
      LIMIT ?
    `, [now, limit]);
  }

  // Get count of mutations waiting to sync (PENDING + RETRY)
  async getPendingCount(userId?: number): Promise<number> {
    if (userId !== undefined) {
      const row = await this.db.queryOne<{ count: number }>(`
        SELECT COUNT(*) as count FROM sync_queue 
        WHERE status IN ('PENDING', 'RETRY') AND (user_id = ? OR user_id IS NULL)
      `, [userId]);
      return row ? row.count : 0;
    }
    const row = await this.db.queryOne<{ count: number }>(`
      SELECT COUNT(*) as count FROM sync_queue WHERE status IN ('PENDING', 'RETRY')
    `);
    return row ? row.count : 0;
  }

  // Get detailed queue breakdown
  async getQueueStats(): Promise<{
    pending: number;
    syncing: number;
    retry: number;
    failed: number;
    synced: number;
  }> {
    const rows = await this.db.query<{ status: string; count: number }>(`
      SELECT status, COUNT(*) as count FROM sync_queue GROUP BY status
    `);

    const stats = { pending: 0, syncing: 0, retry: 0, failed: 0, synced: 0 };
    for (const r of rows) {
      if (r.status === 'PENDING') stats.pending = r.count;
      else if (r.status === 'SYNCING') stats.syncing = r.count;
      else if (r.status === 'RETRY') stats.retry = r.count;
      else if (r.status === 'FAILED') stats.failed = r.count;
      else if (r.status === 'SYNCED') stats.synced = r.count;
    }
    return stats;
  }
}

export const outboxService = new OutboxService();
export default outboxService;
