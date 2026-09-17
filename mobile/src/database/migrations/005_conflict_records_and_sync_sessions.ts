import { Migration, ITransactionClient } from '../types';

export const migration005: Migration = {
  version: 5,
  name: '005_conflict_records_and_sync_sessions',
  up: async (db: ITransactionClient): Promise<void> => {
    await db.execAsync(`
      -- Conflict Records Table (Phase 06 Conflict Detection & Logging)
      CREATE TABLE IF NOT EXISTS conflict_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conflict_id TEXT UNIQUE NOT NULL,
        client_transaction_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        local_data TEXT NOT NULL,
        server_data TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'IGNORED')),
        detected_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT
      );

      -- Sync Sessions Table (Audit & Monitoring for Mobile Sync Sessions)
      CREATE TABLE IF NOT EXISTS sync_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT UNIQUE NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
        push_count INTEGER NOT NULL DEFAULT 0,
        pull_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        conflict_count INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );

      -- Indexes for fast query
      CREATE INDEX IF NOT EXISTS idx_conflict_records_status ON conflict_records(status);
      CREATE INDEX IF NOT EXISTS idx_conflict_records_tx ON conflict_records(client_transaction_id);
      CREATE INDEX IF NOT EXISTS idx_sync_sessions_started ON sync_sessions(started_at DESC);
    `);
  },
  down: async (db: ITransactionClient): Promise<void> => {
    await db.execAsync(`
      DROP TABLE IF EXISTS sync_sessions;
      DROP TABLE IF EXISTS conflict_records;
    `);
  },
};
