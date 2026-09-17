import { Migration, ITransactionClient } from '../types';

export const migration003: Migration = {
  version: 3,
  name: '003_outbox_and_sync_metadata',
  up: async (db: ITransactionClient): Promise<void> => {
    await db.execAsync(`
      -- Outbox Sync Queue (Foundation for Phase 05 Sync Engine)
      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_mutation_id TEXT UNIQUE NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE')),
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'RETRY')),
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Sync Metadata (Server cursor, last_synced_at, device_id)
      CREATE TABLE IF NOT EXISTS sync_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Indexes for fast outbox polling & idempotency checking
      CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_sync_queue_mutation_id ON sync_queue(client_mutation_id);
    `);
  },
  down: async (db: ITransactionClient): Promise<void> => {
    await db.execAsync(`
      DROP TABLE IF EXISTS sync_metadata;
      DROP TABLE IF EXISTS sync_queue;
    `);
  },
};
