import databaseService, { DatabaseService } from '../database/DatabaseService';
import { ITransactionClient } from '../database/types';
import { DuplicateError, AppServiceError } from './types';
import logger from '../utils/logger';

export class OfflineTransactionService {
  private db: DatabaseService;
  // In-memory mutex for in-flight transaction IDs to prevent rapid double-taps
  private inFlightLocks: Set<string> = new Set();

  constructor(db?: DatabaseService) {
    this.db = db || databaseService;
  }

  // Execute an atomic offline transaction with duplicate protection
  async executeAtomic<T>(
    clientTransactionId: string,
    action: (tx: ITransactionClient) => Promise<T>,
    duplicateCheckQuery?: { sql: string; params: unknown[] }
  ): Promise<T> {
    // 1. Check in-flight lock
    if (this.inFlightLocks.has(clientTransactionId)) {
      logger.warn('OfflineTransactionService', `In-flight lock collision for ${clientTransactionId}`);
      throw new DuplicateError(clientTransactionId, 'Thao tác đang được xử lý, vui lòng không bấm liên tiếp.');
    }

    this.inFlightLocks.add(clientTransactionId);
    logger.info('OfflineTransactionService', `Transaction START: ${clientTransactionId}`);

    try {
      // 2. Check if already committed in database
      if (duplicateCheckQuery) {
        const existing = await this.db.queryOne(duplicateCheckQuery.sql, duplicateCheckQuery.params);
        if (existing) {
          logger.warn('OfflineTransactionService', `Duplicate rejected: ${clientTransactionId} already exists`);
          throw new DuplicateError(clientTransactionId, 'Giao dịch này đã được ghi nhận thành công trước đó.');
        }
      }

      // 3. Execute atomic transaction
      const result = await this.db.withTransaction<T>(async (tx) => {
        return await action(tx);
      });

      logger.info('OfflineTransactionService', `Transaction COMMITTED: ${clientTransactionId}`);
      return result;
    } catch (err: unknown) {
      logger.error('OfflineTransactionService', `Transaction ROLLED BACK: ${clientTransactionId}`, err);
      if (err instanceof AppServiceError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : 'Lỗi giao dịch dữ liệu cục bộ';
      throw new AppServiceError('TRANSACTION_ERROR', message, err);
    } finally {
      this.inFlightLocks.delete(clientTransactionId);
    }
  }

  // Utility to generate unique, stable client transaction IDs
  generateId(prefix = 'tx'): string {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 10);
    const counter = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${timestamp}-${randomPart}-${counter}`;
  }
}

export const offlineTransactionService = new OfflineTransactionService();
export default offlineTransactionService;
