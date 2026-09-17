import { Migration, ITransactionClient } from '../types';

export const migration006: Migration = {
  version: 6,
  name: '006_conflict_taxonomy_and_reconciliation',
  up: async (db: ITransactionClient): Promise<void> => {
    await db.execAsync(`
      -- Enhance conflict_records with taxonomy, device audit, and resolution details
      ALTER TABLE conflict_records ADD COLUMN conflict_type TEXT NOT NULL DEFAULT 'INVENTORY_CONFLICT';
      ALTER TABLE conflict_records ADD COLUMN operation TEXT NOT NULL DEFAULT 'CREATE';
      ALTER TABLE conflict_records ADD COLUMN device_id TEXT;
      ALTER TABLE conflict_records ADD COLUMN user_id INTEGER;
      ALTER TABLE conflict_records ADD COLUMN resolution TEXT;
      ALTER TABLE conflict_records ADD COLUMN resolved_by INTEGER;

      -- Stock Drift Ledger Records (Inventory Reconciliation)
      CREATE TABLE IF NOT EXISTS stock_drift_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        expected_stock INTEGER NOT NULL,
        actual_stock INTEGER NOT NULL,
        drift_quantity INTEGER NOT NULL,
        detected_at TEXT NOT NULL DEFAULT (datetime('now')),
        source TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DETECTED' CHECK (status IN ('DETECTED', 'RECONCILED', 'IGNORED')),
        notes TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_conflict_records_type ON conflict_records(conflict_type);
      CREATE INDEX IF NOT EXISTS idx_stock_drift_product ON stock_drift_records(product_id);
      CREATE INDEX IF NOT EXISTS idx_stock_drift_status ON stock_drift_records(status);
    `);
  },
  down: async (db: ITransactionClient): Promise<void> => {
    await db.execAsync(`
      DROP TABLE IF EXISTS stock_drift_records;
    `);
  },
};
