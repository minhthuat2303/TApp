import { Migration, ITransactionClient } from '../types';

export const migration004: Migration = {
  version: 4,
  name: '004_offline_transactions_and_outbox_engine',
  up: async (db: ITransactionClient): Promise<void> => {
    await db.execAsync(`
      -- Multi-item Sales Orders (POS Cart Header)
      CREATE TABLE IF NOT EXISTS sales_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_order_id TEXT UNIQUE NOT NULL,
        order_code TEXT UNIQUE NOT NULL,
        sale_date TEXT NOT NULL,
        total_amount REAL NOT NULL CHECK (total_amount >= 0),
        total_discount REAL NOT NULL DEFAULT 0 CHECK (total_discount >= 0),
        final_amount REAL NOT NULL CHECK (final_amount >= 0),
        total_items INTEGER NOT NULL CHECK (total_items > 0),
        status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'CANCELLED')),
        sync_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (sync_status IN ('PENDING', 'SYNCING', 'SYNCED', 'FAILED')),
        note TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        synced_at TEXT
      );

      -- Imports (Offline Stock Receipts Header)
      CREATE TABLE IF NOT EXISTS imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_import_id TEXT UNIQUE NOT NULL,
        server_id INTEGER,
        import_code TEXT UNIQUE NOT NULL,
        supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        import_date TEXT NOT NULL,
        total_amount REAL NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
        note TEXT,
        sync_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (sync_status IN ('PENDING', 'SYNCING', 'SYNCED', 'FAILED')),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        synced_at TEXT
      );

      -- Import Items (Stock Receipt Details)
      CREATE TABLE IF NOT EXISTS import_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_cost_price REAL NOT NULL CHECK (unit_cost_price >= 0),
        total_amount REAL NOT NULL CHECK (total_amount >= 0),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Add retry and payload version columns to sync_queue
      ALTER TABLE sync_queue ADD COLUMN next_retry_at TEXT;
      ALTER TABLE sync_queue ADD COLUMN payload_version INTEGER NOT NULL DEFAULT 1;

      -- Add order linking to sales_records
      ALTER TABLE sales_records ADD COLUMN order_id INTEGER REFERENCES sales_orders(id) ON DELETE CASCADE;
      ALTER TABLE sales_records ADD COLUMN client_order_id TEXT;

      -- Indexes for fast query and sync polling
      CREATE INDEX IF NOT EXISTS idx_sales_orders_client_id ON sales_orders(client_order_id);
      CREATE INDEX IF NOT EXISTS idx_sales_orders_code ON sales_orders(order_code);
      CREATE INDEX IF NOT EXISTS idx_sales_orders_sync ON sales_orders(sync_status);
      CREATE INDEX IF NOT EXISTS idx_sales_orders_date ON sales_orders(sale_date);

      CREATE INDEX IF NOT EXISTS idx_imports_client_id ON imports(client_import_id);
      CREATE INDEX IF NOT EXISTS idx_imports_code ON imports(import_code);
      CREATE INDEX IF NOT EXISTS idx_imports_sync ON imports(sync_status);

      CREATE INDEX IF NOT EXISTS idx_sales_records_order ON sales_records(order_id);
      CREATE INDEX IF NOT EXISTS idx_sales_records_client_order ON sales_records(client_order_id);

      CREATE INDEX IF NOT EXISTS idx_sync_queue_retry ON sync_queue(status, next_retry_at);
    `);
  },
  down: async (db: ITransactionClient): Promise<void> => {
    await db.execAsync(`
      DROP TABLE IF EXISTS import_items;
      DROP TABLE IF EXISTS imports;
      DROP TABLE IF EXISTS sales_orders;
    `);
  },
};
