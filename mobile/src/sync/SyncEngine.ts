import databaseService, { DatabaseService } from '../database/DatabaseService';
import networkService, { NetworkService } from '../network/NetworkService';
import tokenStorage, { TokenStorage } from '../auth/tokenStorage';
import outboxService, { OutboxService } from '../services/OutboxService';
import conflictService, { ConflictService } from './ConflictService';
import pushSyncHandler, { PushSyncHandler } from './PushSyncHandler';
import pullSyncHandler, { PullSyncHandler } from './PullSyncHandler';
import { SyncOptions, SyncSessionReport, SyncStateListener, SyncStatus } from './types';
import logger from '../utils/logger';

export class SyncEngine {
  private db: DatabaseService;
  private network: NetworkService;
  private tokenStore: TokenStorage;
  private outbox: OutboxService;
  private conflicts: ConflictService;
  private pushHandler: PushSyncHandler;
  private pullHandler: PullSyncHandler;

  private isSyncRunning = false;
  private currentStatus: SyncStatus = 'SYNCED';
  private debounceTimer: any = null;
  private listeners = new Set<SyncStateListener>();

  constructor(
    db?: DatabaseService,
    network?: NetworkService,
    tokenStore?: TokenStorage,
    outbox?: OutboxService,
    conflicts?: ConflictService,
    pushHandler?: PushSyncHandler,
    pullHandler?: PullSyncHandler
  ) {
    this.db = db || databaseService;
    this.network = network || networkService;
    this.tokenStore = tokenStore || tokenStorage;
    this.outbox = outbox || outboxService;
    this.conflicts = conflicts || conflictService;
    this.pushHandler = pushHandler || pushSyncHandler;
    this.pullHandler = pullHandler || pullSyncHandler;

    this.initNetworkListener();
  }

  private initNetworkListener(): void {
    this.network.addListener((isConnected: boolean) => {
      if (isConnected) {
        logger.info('SyncEngine', 'Network restored. Scheduling debounced auto-sync...');
        this.scheduleDebouncedSync(1500);
      } else {
        logger.warn('SyncEngine', 'Network disconnected. Setting status to OFFLINE.');
        this.setStatus('OFFLINE');
      }
    });
  }

  private scheduleDebouncedSync(delayMs = 1500): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.sync().catch((err) => {
        logger.error('SyncEngine', 'Debounced sync failed', err);
      });
    }, delayMs);
  }

  // --- MAIN SYNCHRONIZATION RUNNER ---
  async sync(options: SyncOptions = {}): Promise<SyncSessionReport | null> {
    // 1. Check Sync Lock: Only one sync session at a time
    if (this.isSyncRunning) {
      logger.warn('SyncEngine', 'Sync already active. Skipping duplicate concurrent sync trigger.');
      return null;
    }

    // 2. Check Network Connectivity
    if (!this.network.getIsConnected()) {
      logger.info('SyncEngine', 'Cannot sync while offline.');
      await this.setStatus('OFFLINE');
      return null;
    }

    // 3. Check Authentication
    const token = await this.tokenStore.getToken();
    if (!token) {
      logger.info('SyncEngine', 'User is not logged in. Sync paused until authentication.');
      return null;
    }
    const currentUser = await this.tokenStore.getUser();
    const currentUserId = currentUser?.id;

    // 4. Acquire Sync Lock
    this.isSyncRunning = true;
    await this.setStatus('SYNCING');

    const sessionId = `sync-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const startedAt = new Date().toISOString();

    let pushCount = 0;
    let successCount = 0;
    let failedCount = 0;
    let conflictCount = 0;
    let pullCount = 0;
    let sessionError: string | null = null;
    let sessionStatus: 'COMPLETED' | 'FAILED' = 'COMPLETED';

    try {
      // Create session in database
      await this.db.execute(`
        INSERT INTO sync_sessions (session_id, started_at, status)
        VALUES (?, ?, 'RUNNING')
      `, [sessionId, startedAt]);

      // 5. Recover stale SYNCING records (app restart recovery)
      await this.pushHandler.recoverStaleSyncingRecords(60000);

      // 6. Execute PUSH Sync (scoped to current authenticated user)
      const pushResult = await this.pushHandler.pushPendingMutations(50, currentUserId);
      pushCount = pushResult.processed;
      successCount = pushResult.successes;
      failedCount = pushResult.failures;
      conflictCount = pushResult.conflicts;

      // 7. Execute PULL Sync (scoped to current authenticated user cursor)
      try {
        const pullResult = await this.pullHandler.pullServerChanges(100, currentUserId);
        pullCount = pullResult.pulledCount;
      } catch (pullErr: any) {
        logger.error('SyncEngine', 'Pull sync encountered an error', pullErr);
        // Do not fail the whole session if only pull failed, but log it
        sessionError = pullErr.message || 'Lỗi khi tải dữ liệu từ máy chủ';
      }

      // Reinforce Master Data: Ensure categories and products are always populated into SQLite
      try {
        const { default: catRepo } = await import('../repository/CategoryRepository');
        const { default: prodRepo } = await import('../repository/ProductRepository');
        await catRepo.getAll(true);
        await prodRepo.getAll(true);
      } catch (masterDataErr) {
        logger.warn('SyncEngine', 'Could not refresh master data directly', masterDataErr);
      }

      logger.info('SyncEngine', `Sync session ${sessionId} completed: push=${pushCount} (ok:${successCount}, fail:${failedCount}, conf:${conflictCount}), pull=${pullCount}`);
    } catch (err: any) {
      sessionStatus = 'FAILED';
      sessionError = err.message || 'Lỗi không xác định trong quá trình đồng bộ';
      logger.error('SyncEngine', `Sync session ${sessionId} failed: ${sessionError}`, err);
    } finally {
      const completedAt = new Date().toISOString();

      // Update sync session record
      try {
        await this.db.execute(`
          UPDATE sync_sessions
          SET completed_at = ?,
              status = ?,
              push_count = ?,
              pull_count = ?,
              success_count = ?,
              failed_count = ?,
              conflict_count = ?,
              error = ?
          WHERE session_id = ?
        `, [
          completedAt,
          sessionStatus,
          pushCount,
          pullCount,
          successCount,
          failedCount,
          conflictCount,
          sessionError,
          sessionId,
        ]);
      } catch (dbErr) {
        logger.error('SyncEngine', 'Failed to update sync_sessions table', dbErr);
      }

      // 8. Release Sync Lock
      this.isSyncRunning = false;

      // 9. Recompute overall status
      await this.refreshStatus();
    }

    return {
      sessionId,
      startedAt,
      completedAt: new Date().toISOString(),
      status: sessionStatus,
      pushCount,
      pullCount,
      successCount,
      failedCount,
      conflictCount,
      error: sessionError,
    };
  }

  // Determine current status based on Outbox & Conflict states
  async refreshStatus(): Promise<SyncStatus> {
    if (!this.network.getIsConnected()) {
      return this.setStatus('OFFLINE');
    }

    if (this.isSyncRunning) {
      return this.setStatus('SYNCING');
    }

    const conflicts = await this.conflicts.getConflictCount();
    if (conflicts > 0) {
      return this.setStatus('CONFLICT');
    }

    const queueStats = await this.outbox.getQueueStats();
    if (queueStats.failed > 0) {
      return this.setStatus('FAILED');
    }

    if (queueStats.pending > 0 || queueStats.retry > 0) {
      return this.setStatus('PENDING');
    }

    return this.setStatus('SYNCED');
  }

  private async setStatus(status: SyncStatus): Promise<SyncStatus> {
    this.currentStatus = status;
    const pendingCount = await this.outbox.getPendingCount();
    const conflictCount = await this.conflicts.getConflictCount();

    for (const listener of this.listeners) {
      try {
        listener(this.currentStatus, { pendingCount, conflictCount });
      } catch (err) {
        logger.error('SyncEngine', 'Listener error', err);
      }
    }
    return this.currentStatus;
  }

  getStatus(): SyncStatus {
    return this.currentStatus;
  }

  getIsSyncRunning(): boolean {
    return this.isSyncRunning;
  }

  addListener(listener: SyncStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const syncEngine = new SyncEngine();
export default syncEngine;
