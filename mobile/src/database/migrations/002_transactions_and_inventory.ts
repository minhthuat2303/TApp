import { Migration, ITransactionClient } from '../types';

export const migration002: Migration = {
  version: 2,
  name: '002_transactions_and_inventory',
  up: async (db: ITransactionClient): Promise<void> => {
    await db.execAsync(`
      -- Suppliers
      CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        phone TEXT,
        address TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Sales Records (Offline-ready with client_transaction_id)
      CREATE TABLE IF NOT EXISTS sales_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_transaction_id TEXT UNIQUE NOT NULL,
        server_id INTEGER,
        transaction_code TEXT UNIQUE NOT NULL,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        sale_date TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price_at_sale REAL NOT NULL CHECK (unit_price_at_sale >= 0),
        cost_price_at_sale REAL NOT NULL CHECK (cost_price_at_sale >= 0),
        discount REAL NOT NULL DEFAULT 0 CHECK (discount >= 0),
        total_revenue REAL NOT NULL CHECK (total_revenue >= 0),
        total_cost REAL NOT NULL CHECK (total_cost >= 0),
        profit REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'CANCELLED')),
        sync_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (sync_status IN ('PENDING', 'SYNCING', 'SYNCED', 'FAILED')),
        cancel_reason TEXT,
        cancelled_at TEXT,
        cancelled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        note TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        synced_at TEXT
      );

      -- Stock Movements (Append-only audit trail)
      CREATE TABLE IF NOT EXISTS stock_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_movement_id TEXT UNIQUE NOT NULL,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        movement_type TEXT NOT NULL CHECK (movement_type IN ('SALE', 'PURCHASE', 'DAMAGE', 'LOSS', 'GIFT', 'RETURN', 'ADJUSTMENT')),
        quantity_change INTEGER NOT NULL,
        balance_after INTEGER NOT NULL,
        movement_date TEXT NOT NULL,
        reference_type TEXT,
        reference_id TEXT,
        sync_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (sync_status IN ('PENDING', 'SYNCED')),
        note TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Inventory Lots (FIFO Purchase Tracking)
      CREATE TABLE IF NOT EXISTS inventory_lots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lot_code TEXT UNIQUE NOT NULL,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        purchase_date TEXT NOT NULL,
        quantity_received INTEGER NOT NULL CHECK (quantity_received > 0),
        quantity_remaining INTEGER NOT NULL CHECK (quantity_remaining >= 0),
        unit_cost REAL NOT NULL CHECK (unit_cost >= 0),
        supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        import_id INTEGER,
        note TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Indexes for fast transaction, sync and balance lookups
      CREATE INDEX IF NOT EXISTS idx_sales_records_client_id ON sales_records(client_transaction_id);
      CREATE INDEX IF NOT EXISTS idx_sales_records_code ON sales_records(transaction_code);
      CREATE INDEX IF NOT EXISTS idx_sales_records_date ON sales_records(sale_date);
      CREATE INDEX IF NOT EXISTS idx_sales_records_sync ON sales_records(sync_status);
      CREATE INDEX IF NOT EXISTS idx_sales_records_prod ON sales_records(product_id);
      CREATE INDEX IF NOT EXISTS idx_stock_movements_client_id ON stock_movements(client_movement_id);
      CREATE INDEX IF NOT EXISTS idx_stock_movements_prod ON stock_movements(product_id, movement_date);
      CREATE INDEX IF NOT EXISTS idx_inventory_lots_fifo ON inventory_lots(product_id, purchase_date ASC, id ASC);
    `);
  },
  down: async (db: ITransactionClient): Promise<void> => {
    await db.execAsync(`
      DROP TABLE IF EXISTS inventory_lots;
      DROP TABLE IF EXISTS stock_movements;
      DROP TABLE IF EXISTS sales_records;
      DROP TABLE IF EXISTS suppliers;
    `);
  },
};
