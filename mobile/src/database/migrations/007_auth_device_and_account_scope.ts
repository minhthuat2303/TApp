import { Migration, ITransactionClient } from '../types';

export const migration007: Migration = {
  version: 7,
  name: '007_auth_device_and_account_scope',
  up: async (db: ITransactionClient): Promise<void> => {
    await db.execAsync(`
      -- Add user_id and device_id to sync_queue for multi-account and multi-device scoping
      ALTER TABLE sync_queue ADD COLUMN user_id INTEGER;
      ALTER TABLE sync_queue ADD COLUMN device_id TEXT;

      CREATE INDEX IF NOT EXISTS idx_sync_queue_user_id ON sync_queue(user_id);
      CREATE INDEX IF NOT EXISTS idx_sync_queue_device_id ON sync_queue(device_id);
    `);
  },
  down: async (_db: ITransactionClient): Promise<void> => {
    // Down migration intentionally non-destructive
  },
};
