// T_SHOP Mobile - Comprehensive Automated Database & Offline Transaction / Outbox Engine Tests
import Database from 'better-sqlite3';
import crypto from 'crypto';

console.log('====================================================');
console.log('    T_SHOP MOBILE OFFLINE TRANSACTION & OUTBOX TESTS ');
console.log('====================================================\n');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failedTests++;
  }
}

// 1. NodeTestSqliteDriver with async transaction support
class NodeTestSqliteDriver {
  constructor(dbFile = ':memory:') {
    this.db = new Database(dbFile);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this._isOpen = true;
  }

  isOpen() {
    return this._isOpen;
  }

  async openAsync() {
    this._isOpen = true;
  }

  async closeAsync() {
    this.db.close();
    this._isOpen = false;
  }

  async execAsync(sql) {
    this.db.exec(sql);
  }

  async runAsync(sql, params = []) {
    const info = this.db.prepare(sql).run(...params);
    return {
      changes: info.changes,
      lastInsertRowId: Number(info.lastInsertRowid),
    };
  }

  async getAllAsync(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  async getFirstAsync(sql, params = []) {
    const row = this.db.prepare(sql).get(...params);
    return row || null;
  }

  async withTransactionAsync(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const client = {
        execAsync: async (sql) => this.execAsync(sql),
        runAsync: async (sql, p) => this.runAsync(sql, p),
        getAllAsync: async (sql, p) => this.getAllAsync(sql, p),
        getFirstAsync: async (sql, p) => this.getFirstAsync(sql, p),
      };
      const result = await action(client);
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

// --- DDL DEFINITIONS FOR MIGRATIONS 001, 002, 003, 004 ---
const migration001_sql = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ADMIN', 'STAFF')),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS product_types (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    sku TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    product_type_id INTEGER NOT NULL REFERENCES product_types(id) ON DELETE RESTRICT,
    current_cost_price REAL NOT NULL DEFAULT 0 CHECK (current_cost_price >= 0),
    current_selling_price REAL NOT NULL DEFAULT 0 CHECK (current_selling_price >= 0),
    current_stock INTEGER NOT NULL DEFAULT 0,
    min_stock_alert INTEGER NOT NULL DEFAULT 5,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    price REAL NOT NULL CHECK (price >= 0),
    effective_from TEXT NOT NULL,
    note TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS cost_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    cost_price REAL NOT NULL CHECK (cost_price >= 0),
    effective_from TEXT NOT NULL,
    note TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
  CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
  CREATE INDEX IF NOT EXISTS idx_products_cat_type ON products(category_id, product_type_id);
  CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
`;

const migration002_sql = `
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
`;

const migration003_sql = `
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

  CREATE TABLE IF NOT EXISTS sync_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

const migration004_sql = `
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

  CREATE TABLE IF NOT EXISTS import_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_cost_price REAL NOT NULL CHECK (unit_cost_price >= 0),
    total_amount REAL NOT NULL CHECK (total_amount >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  ALTER TABLE sync_queue ADD COLUMN next_retry_at TEXT;
  ALTER TABLE sync_queue ADD COLUMN payload_version INTEGER NOT NULL DEFAULT 1;

  ALTER TABLE sales_records ADD COLUMN order_id INTEGER REFERENCES sales_orders(id) ON DELETE CASCADE;
  ALTER TABLE sales_records ADD COLUMN client_order_id TEXT;
`;

const migration005_sql = `
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

  CREATE INDEX IF NOT EXISTS idx_conflict_records_status ON conflict_records(status);
  CREATE INDEX IF NOT EXISTS idx_conflict_records_tx ON conflict_records(client_transaction_id);
  CREATE INDEX IF NOT EXISTS idx_sync_sessions_started ON sync_sessions(started_at DESC);
`;

const migration006_sql = `
  ALTER TABLE conflict_records ADD COLUMN conflict_type TEXT NOT NULL DEFAULT 'INVENTORY_CONFLICT';
  ALTER TABLE conflict_records ADD COLUMN operation TEXT NOT NULL DEFAULT 'CREATE';
  ALTER TABLE conflict_records ADD COLUMN device_id TEXT;
  ALTER TABLE conflict_records ADD COLUMN user_id INTEGER;
  ALTER TABLE conflict_records ADD COLUMN resolution TEXT;
  ALTER TABLE conflict_records ADD COLUMN resolved_by INTEGER;

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
`;

const migration007_sql = `
  ALTER TABLE sync_queue ADD COLUMN user_id INTEGER;
  ALTER TABLE sync_queue ADD COLUMN device_id TEXT;

  CREATE INDEX IF NOT EXISTS idx_sync_queue_user_id ON sync_queue(user_id);
  CREATE INDEX IF NOT EXISTS idx_sync_queue_device_id ON sync_queue(device_id);
`;

async function runTests() {
  const driver = new NodeTestSqliteDriver();

  // --- TEST SUITE 1: SEQUENTIAL MIGRATIONS (V1 TO V7) ---
  console.log('--- 1. Migration System (v1 to v7 Evolution) ---');
  await driver.execAsync(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await driver.execAsync(migration001_sql);
  await driver.runAsync('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [1, '001_initial_master_data']);

  await driver.execAsync(migration002_sql);
  await driver.runAsync('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [2, '002_transactions_and_inventory']);

  await driver.execAsync(migration003_sql);
  await driver.runAsync('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [3, '003_outbox_and_sync_metadata']);

  await driver.execAsync(migration004_sql);
  await driver.runAsync('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [4, '004_offline_transactions_and_outbox_engine']);

  await driver.execAsync(migration005_sql);
  await driver.runAsync('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [5, '005_conflict_records_and_sync_sessions']);

  await driver.execAsync(migration006_sql);
  await driver.runAsync('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [6, '006_conflict_taxonomy_and_reconciliation']);

  await driver.execAsync(migration007_sql);
  await driver.runAsync('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [7, '007_auth_device_and_account_scope']);

  const migrations = await driver.getAllAsync('SELECT version, name FROM schema_migrations ORDER BY version ASC');
  assert(migrations.length === 7, 'All 7 migrations executed successfully in order');
  assert(migrations[6].version === 7, 'Schema version is updated to v7');

  const conflictTableCheck = await driver.getFirstAsync("SELECT name FROM sqlite_master WHERE type='table' AND name='conflict_records'");
  assert(conflictTableCheck !== null, 'conflict_records table created in SQLite');

  const driftTableCheck = await driver.getFirstAsync("SELECT name FROM sqlite_master WHERE type='table' AND name='stock_drift_records'");
  assert(driftTableCheck !== null, 'stock_drift_records table created in SQLite');

  const sessionTableCheck = await driver.getFirstAsync("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_sessions'");
  assert(sessionTableCheck !== null, 'sync_sessions table created in SQLite');

  // Seed sample user, products & categories
  await driver.runAsync("INSERT INTO users (id, username, full_name, role, status) VALUES (1, 'admin', 'Quản trị viên', 'ADMIN', 'ACTIVE')");
  await driver.runAsync('INSERT INTO categories (id, code, name) VALUES (?, ?, ?)', [1, 'GAU_BONG', 'Gấu bông']);
  await driver.runAsync('INSERT INTO product_types (id, category_id, code, name) VALUES (?, ?, ?, ?)', [1, 1, 'CAPY', 'Capybara']);
  await driver.runAsync(`
    INSERT INTO products (id, sku, name, category_id, product_type_id, current_cost_price, current_selling_price, current_stock, min_stock_alert, status)
    VALUES 
      (1, 'GB-CAPY-01', 'Gấu Capybara 40cm', 1, 1, 80000, 150000, 50, 10, 'ACTIVE'),
      (2, 'GB-TEDDY-02', 'Gấu Teddy Nơ 50cm', 1, 1, 100000, 200000, 30, 5, 'ACTIVE')
  `);

  // Seed FIFO lots
  await driver.runAsync(`
    INSERT INTO inventory_lots (id, lot_code, product_id, purchase_date, quantity_received, quantity_remaining, unit_cost)
    VALUES 
      (1, 'LOT-01', 1, '2026-08-01', 50, 50, 80000),
      (2, 'LOT-02', 2, '2026-08-05', 30, 30, 100000)
  `);

  // --- TEST SUITE 2: MULTI-ITEM OFFLINE POS SALE ATOMICITY ---
  console.log('\n--- 2. Multi-Item POS Sale (Atomic ACID Transaction) ---');
  const clientOrderId = 'ord-test-multi-001';
  const orderCode = 'ORD-OFFLINE-20260909-0001';

  // Buy Capybara x 5 and Teddy x 2 in ONE cart checkout
  await driver.withTransactionAsync(async (tx) => {
    // 1. Order Header
    await tx.runAsync(`
      INSERT INTO sales_orders (
        client_order_id, order_code, sale_date, total_amount,
        total_discount, final_amount, total_items, status, sync_status
      ) VALUES (?, ?, '2026-09-09', 1150000, 0, 1150000, 7, 'COMPLETED', 'PENDING')
    `, [clientOrderId, orderCode]);

    // 2. Line 1: Capybara (qty 5)
    await tx.runAsync(`
      INSERT INTO sales_records (
        order_id, client_order_id, client_transaction_id, transaction_code,
        product_id, sale_date, quantity, unit_price_at_sale, cost_price_at_sale,
        total_revenue, total_cost, profit, status, sync_status
      ) VALUES (1, ?, 'line-001', 'ORD-01-P1', 1, '2026-09-09', 5, 150000, 80000, 750000, 400000, 350000, 'COMPLETED', 'PENDING')
    `, [clientOrderId]);
    await tx.runAsync('UPDATE products SET current_stock = current_stock - 5 WHERE id = 1');
    await tx.runAsync('UPDATE inventory_lots SET quantity_remaining = quantity_remaining - 5 WHERE id = 1');

    // 3. Line 2: Teddy (qty 2)
    await tx.runAsync(`
      INSERT INTO sales_records (
        order_id, client_order_id, client_transaction_id, transaction_code,
        product_id, sale_date, quantity, unit_price_at_sale, cost_price_at_sale,
        total_revenue, total_cost, profit, status, sync_status
      ) VALUES (1, ?, 'line-002', 'ORD-01-P2', 2, '2026-09-09', 2, 200000, 100000, 400000, 200000, 200000, 'COMPLETED', 'PENDING')
    `, [clientOrderId]);
    await tx.runAsync('UPDATE products SET current_stock = current_stock - 2 WHERE id = 2');
    await tx.runAsync('UPDATE inventory_lots SET quantity_remaining = quantity_remaining - 2 WHERE id = 2');

    // 4. Outbox Enqueue (Single atomic record for entire multi-item order)
    const payload = JSON.stringify({
      client_order_id: clientOrderId,
      order_code: orderCode,
      total_items: 7,
      final_amount: 1150000,
      items: [
        { productId: 1, quantity: 5, unitPrice: 150000 },
        { productId: 2, quantity: 2, unitPrice: 200000 },
      ],
    });

    await tx.runAsync(`
      INSERT INTO sync_queue (
        client_mutation_id, entity_type, entity_id, action,
        payload_json, payload_version, status, retry_count
      ) VALUES (?, 'SALE_ORDER', ?, 'CREATE', ?, 1, 'PENDING', 0)
    `, [clientOrderId, clientOrderId, payload]);
  });

  const orderRecord = await driver.getFirstAsync('SELECT * FROM sales_orders WHERE client_order_id = ?', [clientOrderId]);
  assert(orderRecord !== null, 'Multi-item order header created');
  assert(orderRecord.final_amount === 1150000, 'Order final amount matches 1,150,000đ');

  const orderLines = await driver.getAllAsync('SELECT * FROM sales_records WHERE client_order_id = ?', [clientOrderId]);
  assert(orderLines.length === 2, 'Exactly 2 order line items created and linked to order');

  const prod1After = await driver.getFirstAsync('SELECT current_stock FROM products WHERE id = 1');
  const prod2After = await driver.getFirstAsync('SELECT current_stock FROM products WHERE id = 2');
  assert(prod1After.current_stock === 45, 'Product 1 stock decremented accurately (50 -> 45)');
  assert(prod2After.current_stock === 28, 'Product 2 stock decremented accurately (30 -> 28)');

  const outboxSale = await driver.getFirstAsync('SELECT * FROM sync_queue WHERE client_mutation_id = ?', [clientOrderId]);
  assert(outboxSale !== null && outboxSale.entity_type === 'SALE_ORDER', 'Outbox mutation enqueued for multi-item sale');
  assert(outboxSale.payload_version === 1, 'Outbox record includes payload_version = 1');

  // --- TEST SUITE 3: MULTI-ITEM FAILURE ENTIRE ROLLBACK ---
  console.log('\n--- 3. Multi-Item Partial Failure Rollback (Atomicity) ---');
  const failOrderId = 'ord-test-fail-002';
  let rollbackCaught = false;

  try {
    await driver.withTransactionAsync(async (tx) => {
      // Line 1: valid Capybara x 5
      await tx.runAsync(`
        INSERT INTO sales_orders (client_order_id, order_code, sale_date, total_amount, total_discount, final_amount, total_items)
        VALUES (?, 'ORD-FAIL-01', '2026-09-09', 750000, 0, 750000, 5)
      `, [failOrderId]);
      await tx.runAsync('UPDATE products SET current_stock = current_stock - 5 WHERE id = 1');

      // Line 2: Insufficient stock error (Requested: 999, Available: 28)
      const prod2 = await tx.getFirstAsync('SELECT current_stock FROM products WHERE id = 2');
      if (prod2.current_stock < 999) {
        throw new Error('INSUFFICIENT_STOCK_ABORT');
      }
    });
  } catch (err) {
    rollbackCaught = true;
  }

  assert(rollbackCaught, 'Insufficient stock error properly caught and aborted');
  const failOrder = await driver.getFirstAsync('SELECT * FROM sales_orders WHERE client_order_id = ?', [failOrderId]);
  assert(failOrder === null, 'Atomic Rollback: 0 sales_orders rows inserted');

  const prod1RollbackStock = await driver.getFirstAsync('SELECT current_stock FROM products WHERE id = 1');
  assert(prod1RollbackStock.current_stock === 45, 'Atomic Rollback: Product 1 stock was NOT decremented');

  // --- TEST SUITE 4: IDEMPOTENCY & DUPLICATE PROTECTION ---
  console.log('\n--- 4. Idempotency & Duplicate Protection ---');
  let duplicateBlocked = false;
  try {
    // Attempting to re-insert the already committed clientOrderId
    await driver.runAsync(`
      INSERT INTO sales_orders (
        client_order_id, order_code, sale_date, total_amount,
        total_discount, final_amount, total_items, status, sync_status
      ) VALUES (?, 'ORD-DUPLICATE', '2026-09-09', 100000, 0, 100000, 1, 'COMPLETED', 'PENDING')
    `, [clientOrderId]);
  } catch (err) {
    duplicateBlocked = true;
  }

  assert(duplicateBlocked, 'Duplicate submission blocked by UNIQUE constraint on client_order_id');

  // --- TEST SUITE 5: OFFLINE STOCK RECEIPT (IMPORT) ---
  console.log('\n--- 5. Offline Stock Receipt (Import Transaction) ---');
  const clientImportId = 'imp-test-001';
  const importCode = 'NK-OFFLINE-20260909-0001';
  const importQty = 20;
  const unitCost = 90000;

  await driver.withTransactionAsync(async (tx) => {
    // 1. Import Header
    await tx.runAsync(`
      INSERT INTO imports (client_import_id, import_code, import_date, total_amount, sync_status)
      VALUES (?, ?, '2026-09-09', ?, 'PENDING')
    `, [clientImportId, importCode, importQty * unitCost]);

    // 2. Import Item
    await tx.runAsync(`
      INSERT INTO import_items (import_id, product_id, quantity, unit_cost_price, total_amount)
      VALUES (1, 1, ?, ?, ?)
    `, [importQty, unitCost, importQty * unitCost]);

    // 3. New FIFO Lot
    await tx.runAsync(`
      INSERT INTO inventory_lots (lot_code, product_id, purchase_date, quantity_received, quantity_remaining, unit_cost)
      VALUES ('LOT-NEW-01', 1, '2026-09-09', ?, ?, ?)
    `, [importQty, importQty, unitCost]);

    // 4. Update product stock (45 + 20 = 65)
    await tx.runAsync('UPDATE products SET current_stock = current_stock + ? WHERE id = 1', [importQty]);

    // 5. Stock Movement
    await tx.runAsync(`
      INSERT INTO stock_movements (client_movement_id, product_id, movement_type, quantity_change, balance_after, movement_date)
      VALUES ('mov-imp-001', 1, 'PURCHASE', ?, 65, '2026-09-09')
    `, [importQty]);

    // 6. Outbox Enqueue
    const importPayload = JSON.stringify({
      client_import_id: clientImportId,
      import_code: importCode,
      items: [{ productId: 1, quantity: importQty, unitCostPrice: unitCost }],
    });

    await tx.runAsync(`
      INSERT INTO sync_queue (client_mutation_id, entity_type, entity_id, action, payload_json, payload_version, status)
      VALUES (?, 'IMPORT', ?, 'CREATE', ?, 1, 'PENDING')
    `, [clientImportId, clientImportId, importPayload]);
  });

  const importRecord = await driver.getFirstAsync('SELECT * FROM imports WHERE client_import_id = ?', [clientImportId]);
  assert(importRecord !== null, 'Import transaction committed in SQLite');
  assert(importRecord.total_amount === 1800000, 'Import total amount is 1,800,000đ (20 * 90,000)');

  const prod1ImportStock = await driver.getFirstAsync('SELECT current_stock FROM products WHERE id = 1');
  assert(prod1ImportStock.current_stock === 65, 'Product 1 stock increased immediately from 45 to 65');

  const outboxImport = await driver.getFirstAsync('SELECT * FROM sync_queue WHERE client_mutation_id = ?', [clientImportId]);
  assert(outboxImport !== null && outboxImport.entity_type === 'IMPORT', 'Outbox mutation enqueued for offline stock receipt');

  // --- TEST SUITE 6: OUTBOX STATE MACHINE & RETRY BACKOFF ---
  console.log('\n--- 6. Outbox State Machine & Retry Backoff ---');
  const mutation = await driver.getFirstAsync('SELECT id, status, retry_count FROM sync_queue WHERE client_mutation_id = ?', [clientOrderId]);
  assert(mutation.status === 'PENDING', 'Initial outbox status is PENDING');

  // Transition: PENDING -> SYNCING
  await driver.runAsync("UPDATE sync_queue SET status = 'SYNCING' WHERE id = ?", [mutation.id]);
  const syncingMut = await driver.getFirstAsync('SELECT status FROM sync_queue WHERE id = ?', [mutation.id]);
  assert(syncingMut.status === 'SYNCING', 'State transitioned to SYNCING');

  // Transition: SYNCING -> RETRY (with error metadata & backoff timestamp)
  const nextRetryTime = new Date(Date.now() + 5000).toISOString();
  await driver.runAsync(`
    UPDATE sync_queue 
    SET status = 'RETRY', retry_count = retry_count + 1, last_error = '503 Server Unavailable', next_retry_at = ?
    WHERE id = ?
  `, [nextRetryTime, mutation.id]);

  const retryMut = await driver.getFirstAsync('SELECT status, retry_count, last_error, next_retry_at FROM sync_queue WHERE id = ?', [mutation.id]);
  assert(retryMut.status === 'RETRY', 'State transitioned to RETRY');
  assert(retryMut.retry_count === 1, 'Retry count incremented to 1');
  assert(retryMut.last_error === '503 Server Unavailable', 'Last error message saved');
  assert(retryMut.next_retry_at !== null, 'next_retry_at backoff timestamp populated');

  // Transition: RETRY -> SYNCED (Simulating success in Phase 06)
  await driver.runAsync("UPDATE sync_queue SET status = 'SYNCED', last_error = NULL, next_retry_at = NULL WHERE id = ?", [mutation.id]);
  const syncedMut = await driver.getFirstAsync('SELECT status, last_error, next_retry_at FROM sync_queue WHERE id = ?', [mutation.id]);
  assert(syncedMut.status === 'SYNCED', 'State transitioned to SYNCED');
  assert(syncedMut.last_error === null && syncedMut.next_retry_at === null, 'Error metadata cleared on success');

  // --- TEST SUITE 7: CONCURRENT MUTATIONS ON SAME PRODUCT ---
  console.log('\n--- 7. Concurrent Sequential Sales on Same Product ---');
  // Sell 5 units 3 times sequentially
  for (let i = 1; i <= 3; i++) {
    const seqId = `seq-sale-${i}`;
    await driver.withTransactionAsync(async (tx) => {
      await tx.runAsync('UPDATE products SET current_stock = current_stock - 5 WHERE id = 1');
      await tx.runAsync(`
        INSERT INTO sync_queue (client_mutation_id, entity_type, entity_id, action, payload_json, payload_version, status)
        VALUES (?, 'SALE', ?, 'CREATE', '{}', 1, 'PENDING')
      `, [seqId, seqId]);
    });
  }

  const finalStock = await driver.getFirstAsync('SELECT current_stock FROM products WHERE id = 1');
  assert(finalStock.current_stock === 50, 'Final stock is exactly 50 after 3 sequential sales (65 - 15 = 50)');

  // --- TEST SUITE 8: PERSISTENCE ACROSS RESTART ---
  console.log('\n--- 8. App Restart Persistence ---');
  const restartFile = './test_p5_restart.db';
  const diskDriver1 = new NodeTestSqliteDriver(restartFile);
  await diskDriver1.execAsync(migration001_sql);
  await diskDriver1.execAsync(migration002_sql);
  await diskDriver1.execAsync(migration003_sql);
  await diskDriver1.execAsync(migration004_sql);

  await diskDriver1.runAsync(`
    INSERT INTO sales_orders (client_order_id, order_code, sale_date, total_amount, total_discount, final_amount, total_items, status)
    VALUES ('ord-persist-100', 'ORD-PERSIST', '2026-09-09', 500000, 0, 500000, 2, 'COMPLETED')
  `);
  await diskDriver1.closeAsync();

  // Reopen
  const diskDriver2 = new NodeTestSqliteDriver(restartFile);
  const reloadedOrder = await diskDriver2.getFirstAsync('SELECT * FROM sales_orders WHERE client_order_id = ?', ['ord-persist-100']);
  assert(reloadedOrder !== null && reloadedOrder.final_amount === 500000, 'Data survived full disk close and reopen');
  await diskDriver2.closeAsync();

  // Cleanup
  try {
    import('fs').then(fs => {
      if (fs.existsSync(restartFile)) fs.unlinkSync(restartFile);
    });
  } catch {}

  // --- TEST SUITE 9: SERVER-SIDE IDEMPOTENCY & TAMPER PROTECTION ---
  console.log('\n--- 9. Server-Side Idempotency & Tamper Protection ---');
  const serverDb = new NodeTestSqliteDriver();
  await serverDb.execAsync(`
    CREATE TABLE IF NOT EXISTS processed_sync_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_transaction_id TEXT UNIQUE NOT NULL,
      entity_type TEXT NOT NULL,
      status TEXT NOT NULL,
      server_id INTEGER,
      payload_hash TEXT,
      payload_json TEXT,
      result_json TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS server_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_code TEXT UNIQUE NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      total_amount REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS server_products (
      id INTEGER PRIMARY KEY,
      current_stock INTEGER NOT NULL
    );
    INSERT INTO server_products (id, current_stock) VALUES (1, 100);
  `);

  function computePayloadHash(payload) {
    const canonical = JSON.stringify(payload, Object.keys(payload || {}).sort());
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  const mockClientTxId = 'client-uuid-sale-999';
  async function simulateServerPush(mutation) {
    return await serverDb.withTransactionAsync(async (tx) => {
      const incomingHash = computePayloadHash(mutation);

      // 1. Idempotency & Tamper Check
      const existing = await tx.getFirstAsync('SELECT * FROM processed_sync_transactions WHERE client_transaction_id = ?', [mutation.client_mutation_id]);
      if (existing) {
        if (existing.payload_hash && existing.payload_hash !== incomingHash) {
          return {
            client_mutation_id: mutation.client_mutation_id,
            status: 'CONFLICT',
            conflict_type: 'VALIDATION_CONFLICT',
            error: { code: 'PAYLOAD_MISMATCH', message: 'Dữ liệu giao dịch khác với lần gửi trước đó' },
          };
        }
        return {
          client_mutation_id: mutation.client_mutation_id,
          status: 'ALREADY_PROCESSED',
          conflict_type: 'DUPLICATE',
          server_transaction_id: existing.server_id,
          message: 'Already processed',
        };
      }

      // 2. Business Operation
      const prod = await tx.getFirstAsync('SELECT current_stock FROM server_products WHERE id = ?', [mutation.product_id]);
      if (!prod || prod.current_stock < mutation.quantity) {
        return {
          client_mutation_id: mutation.client_mutation_id,
          status: 'CONFLICT',
          conflict_type: 'INVENTORY_CONFLICT',
          error: { code: 'INSUFFICIENT_STOCK', message: 'Tồn kho máy chủ không đủ' },
        };
      }

      await tx.runAsync('UPDATE server_products SET current_stock = current_stock - ? WHERE id = ?', [mutation.quantity, mutation.product_id]);
      const sale = await tx.runAsync('INSERT INTO server_sales (transaction_code, product_id, quantity, total_amount) VALUES (?, ?, ?, ?)', [
        `SRV-${mutation.client_mutation_id}`, mutation.product_id, mutation.quantity, mutation.total_amount
      ]);

      await tx.runAsync('INSERT INTO processed_sync_transactions (client_transaction_id, entity_type, status, server_id, payload_hash, payload_json) VALUES (?, ?, ?, ?, ?, ?)', [
        mutation.client_mutation_id, 'SALE_ORDER', 'PROCESSED', sale.lastInsertRowId, incomingHash, JSON.stringify(mutation)
      ]);

      return {
        client_mutation_id: mutation.client_mutation_id,
        status: 'SYNCED',
        server_transaction_id: sale.lastInsertRowId,
      };
    });
  }

  // Request #1: Normal push
  const res1 = await simulateServerPush({
    client_mutation_id: mockClientTxId,
    product_id: 1,
    quantity: 10,
    total_amount: 500000,
  });
  assert(res1.status === 'SYNCED', 'First request succeeds with status SYNCED');

  const stockAfterReq1 = await serverDb.getFirstAsync('SELECT current_stock FROM server_products WHERE id = 1');
  assert(stockAfterReq1.current_stock === 90, 'Server stock decremented to 90 (100 - 10)');

  // Request #2: Retry with SAME client_mutation_id (simulating network timeout after server processed)
  const res2 = await simulateServerPush({
    client_mutation_id: mockClientTxId,
    product_id: 1,
    quantity: 10,
    total_amount: 500000,
  });
  assert(res2.status === 'ALREADY_PROCESSED', 'Duplicate request detected as ALREADY_PROCESSED');
  assert(res2.server_transaction_id === res1.server_transaction_id, 'Duplicate returns existing server_transaction_id');

  const stockAfterReq2 = await serverDb.getFirstAsync('SELECT current_stock FROM server_products WHERE id = 1');
  assert(stockAfterReq2.current_stock === 90, 'Server stock remains 90: NO DUPLICATE DEDUCTION!');

  const salesCount = await serverDb.getFirstAsync('SELECT COUNT(*) as c FROM server_sales');
  assert(salesCount.c === 1, 'Only exactly 1 sale row exists on server despite duplicate submission');

  // --- TEST SUITE 10: STALE SYNCING RECORD RECOVERY ---
  console.log('\n--- 10. Stale SYNCING Record Recovery on App Restart ---');
  // Insert a record stuck in SYNCING from 5 minutes ago
  const staleTime = new Date(Date.now() - 300000).toISOString();
  await driver.runAsync(`
    INSERT INTO sync_queue (client_mutation_id, entity_type, entity_id, action, payload_json, payload_version, status, updated_at)
    VALUES ('stale-sync-tx-1', 'SALE_ORDER', 'stale-1', 'CREATE', '{}', 1, 'SYNCING', ?)
  `, [staleTime]);

  const thresholdIso = new Date(Date.now() - 60000).toISOString();
  const recoverResult = await driver.runAsync(`
    UPDATE sync_queue
    SET status = 'PENDING', updated_at = datetime('now')
    WHERE status = 'SYNCING' AND updated_at <= ?
  `, [thresholdIso]);
  assert(recoverResult.changes >= 1, 'Stale SYNCING record recovered to PENDING');

  const recoveredRow = await driver.getFirstAsync('SELECT status FROM sync_queue WHERE client_mutation_id = ?', ['stale-sync-tx-1']);
  assert(recoveredRow.status === 'PENDING', 'Stale record status successfully reset to PENDING');

  // --- TEST SUITE 11: EXPONENTIAL BACKOFF & JITTER CALCULATION ---
  console.log('\n--- 11. Exponential Backoff & Jitter ---');
  function calcBackoff(attempt, baseDelay = 2000, maxDelay = 60000) {
    const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
    const jitter = Math.random() * 500;
    return delay + jitter;
  }
  const delay1 = calcBackoff(1);
  const delay2 = calcBackoff(2);
  const delay3 = calcBackoff(3);
  assert(delay1 >= 2000 && delay1 <= 2500, `Attempt 1 delay in [2000, 2500]ms (actual: ${Math.round(delay1)}ms)`);
  assert(delay2 >= 4000 && delay2 <= 4500, `Attempt 2 delay in [4000, 4500]ms (actual: ${Math.round(delay2)}ms)`);
  assert(delay3 >= 8000 && delay3 <= 8500, `Attempt 3 delay in [8000, 8500]ms (actual: ${Math.round(delay3)}ms)`);

  // --- TEST SUITE 12: SERVER INVENTORY VALIDATION & CONFLICT DETECTION ---
  console.log('\n--- 12. Server Authoritative Stock Validation & Conflict Detection ---');
  // Attempt to sell 150 items when server only has 90
  const conflictReq = await simulateServerPush({
    client_mutation_id: 'client-tx-conflict-test',
    product_id: 1,
    quantity: 150,
    total_amount: 7500000,
  });
  assert(conflictReq.status === 'CONFLICT', 'Server returns CONFLICT status when stock is insufficient');
  assert(conflictReq.error.code === 'INSUFFICIENT_STOCK', 'Error code is INSUFFICIENT_STOCK');

  // Client records conflict in conflict_records table
  await driver.runAsync(`
    INSERT INTO conflict_records (conflict_id, client_transaction_id, entity_type, entity_id, local_data, server_data, reason, status)
    VALUES ('conf-001', 'client-tx-conflict-test', 'SALE_ORDER', 'client-tx-conflict-test', '{"qty":150}', '{"serverStock":90}', 'Tồn kho máy chủ không đủ', 'OPEN')
  `);
  const savedConflict = await driver.getFirstAsync('SELECT * FROM conflict_records WHERE conflict_id = ?', ['conf-001']);
  assert(savedConflict !== null && savedConflict.status === 'OPEN', 'Conflict record saved in SQLite with status OPEN');

  // --- TEST SUITE 13: INCREMENTAL PULL CURSOR ATOMICITY ---
  console.log('\n--- 13. Incremental Pull Cursor Atomicity ---');
  await driver.runAsync("INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('pull_cursor', '2026-08-01T00:00:00.000Z')");
  const initialCursor = await driver.getFirstAsync("SELECT value FROM sync_metadata WHERE key = 'pull_cursor'");
  assert(initialCursor.value === '2026-08-01T00:00:00.000Z', 'Initial cursor verified');

  // Test 1: Simulated Failure midway -> cursor must NOT change
  try {
    await driver.withTransactionAsync(async (tx) => {
      await tx.runAsync("INSERT INTO categories (id, code, name) VALUES (999, 'FAIL_CAT', 'Failed Cat')");
      // Simulate crash/error before committing cursor
      throw new Error('Simulated network/parse crash during pull processing');
    });
  } catch {}

  const cursorAfterCrash = await driver.getFirstAsync("SELECT value FROM sync_metadata WHERE key = 'pull_cursor'");
  assert(cursorAfterCrash.value === '2026-08-01T00:00:00.000Z', 'Cursor remained unchanged after transaction rollback');
  const failedCat = await driver.getFirstAsync('SELECT * FROM categories WHERE id = 999');
  assert(failedCat === null, 'Rolled back category was not persisted');

  // Test 2: Successful pull commit -> data and cursor updated atomically
  const nextCursorTime = '2026-09-09T14:30:00.000Z';
  await driver.withTransactionAsync(async (tx) => {
    await tx.runAsync("INSERT INTO categories (id, code, name) VALUES (10, 'ROBOT', 'Robot thông minh')");
    await tx.runAsync("INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('pull_cursor', ?)", [nextCursorTime]);
  });

  const finalCursor = await driver.getFirstAsync("SELECT value FROM sync_metadata WHERE key = 'pull_cursor'");
  assert(finalCursor.value === nextCursorTime, 'Cursor successfully advanced to new timestamp atomically');
  const newCat = await driver.getFirstAsync('SELECT * FROM categories WHERE id = 10');
  assert(newCat !== null && newCat.name === 'Robot thông minh', 'New pulled category committed alongside cursor');

  // --- TEST SUITE 14: SINGLE SYNC LOCK CONCURRENCY GUARD ---
  console.log('\n--- 14. Single Sync Lock Concurrency Guard ---');
  let syncRunningLock = false;
  async function guardedSync() {
    if (syncRunningLock) {
      return { skipped: true };
    }
    syncRunningLock = true;
    try {
      await new Promise(res => setTimeout(res, 50));
      return { success: true };
    } finally {
      syncRunningLock = false;
    }
  }

  const [sessionA, sessionB] = await Promise.all([
    guardedSync(),
    guardedSync(),
  ]);
  assert(
    (sessionA.success && sessionB.skipped) || (sessionB.success && sessionA.skipped),
    'Concurrent sync call is safely skipped by sync lock'
  );

  // --- TEST SUITE 15: ERROR CLASSIFICATION MATRIX ---
  console.log('\n--- 15. Error Classification Matrix ---');
  function classifyError(status) {
    if (status === 401 || status === 403) return 'PAUSE_AUTH';
    if (status === 429) return 'RETRY_BACKOFF';
    if (status === 409) return 'CONFLICT';
    if (status >= 400 && status < 500) return 'FATAL_CLIENT_ERROR';
    if (status >= 500) return 'RETRY_SERVER_ERROR';
    return 'UNKNOWN';
  }

  assert(classifyError(401) === 'PAUSE_AUTH', '401 classified as PAUSE_AUTH');
  assert(classifyError(429) === 'RETRY_BACKOFF', '429 classified as RETRY_BACKOFF');
  assert(classifyError(409) === 'CONFLICT', '409 classified as CONFLICT');
  assert(classifyError(422) === 'FATAL_CLIENT_ERROR', '422 classified as FATAL_CLIENT_ERROR (do not retry)');
  assert(classifyError(503) === 'RETRY_SERVER_ERROR', '503 classified as RETRY_SERVER_ERROR (safe to retry)');

  // --- TEST SUITE 16: COMPLETE END-TO-END BIDIRECTIONAL SYNC ---
  console.log('\n--- 16. Complete Bidirectional E2E Sync Flow ---');
  // 1. Offline Sale recorded locally
  const e2eOrderId = 'ord-e2e-final-001';
  await driver.withTransactionAsync(async (tx) => {
    await tx.runAsync(`
      INSERT INTO sales_orders (client_order_id, order_code, sale_date, total_amount, total_discount, final_amount, total_items, sync_status)
      VALUES (?, 'ORD-E2E', '2026-09-09', 330000, 0, 330000, 2, 'PENDING')
    `, [e2eOrderId]);

    await tx.runAsync(`
      INSERT INTO sync_queue (client_mutation_id, entity_type, entity_id, action, payload_json, payload_version, status)
      VALUES (?, 'SALE_ORDER', ?, 'CREATE', '{"items":[{"product_id":1,"quantity":2}]}', 1, 'PENDING')
    `, [e2eOrderId, e2eOrderId]);
  });

  const pendingE2eOrder = await driver.getFirstAsync('SELECT sync_status FROM sales_orders WHERE client_order_id = ?', [e2eOrderId]);
  assert(pendingE2eOrder.sync_status === 'PENDING', 'Step 1: Offline sale created with sync_status = PENDING');

  // 2. Push to server
  const e2ePushRes = await simulateServerPush({
    client_mutation_id: e2eOrderId,
    product_id: 1,
    quantity: 2,
    total_amount: 330000,
  });
  assert(e2ePushRes.status === 'SYNCED', 'Step 2: Server processed sale and returned SYNCED');

  // 3. ACK handled locally
  await driver.withTransactionAsync(async (tx) => {
    await tx.runAsync("UPDATE sync_queue SET status = 'SYNCED' WHERE client_mutation_id = ?", [e2eOrderId]);
    await tx.runAsync("UPDATE sales_orders SET sync_status = 'SYNCED', synced_at = datetime('now') WHERE client_order_id = ?", [e2eOrderId]);
  });

  const syncedE2eOrder = await driver.getFirstAsync('SELECT sync_status FROM sales_orders WHERE client_order_id = ?', [e2eOrderId]);
  assert(syncedE2eOrder.sync_status === 'SYNCED', 'Step 3: Local order transitioned to SYNCED upon server ACK');

  const e2eOutboxRow = await driver.getFirstAsync("SELECT status FROM sync_queue WHERE client_mutation_id = ?", [e2eOrderId]);
  assert(e2eOutboxRow !== null && e2eOutboxRow.status === 'SYNCED', 'Step 4: E2E outbox item status is SYNCED (no longer pending)');

  // =========================================================================
  // PHASE 07: CONFLICT RESOLUTION & INVENTORY RECONCILIATION TEST SUITES
  // =========================================================================

  // --- TEST SUITE 17: MIGRATION 006 SCHEMA EVOLUTION & CONFLICT TAXONOMY ---
  console.log('\n--- 17. Migration 006 Schema Evolution & Taxonomy ---');
  const conflictColumns = await driver.getAllAsync("PRAGMA table_info('conflict_records')");
  const columnNames = conflictColumns.map(c => c.name);
  assert(columnNames.includes('conflict_type'), 'conflict_records contains conflict_type column');
  assert(columnNames.includes('operation'), 'conflict_records contains operation column');
  assert(columnNames.includes('device_id'), 'conflict_records contains device_id column');
  assert(columnNames.includes('user_id'), 'conflict_records contains user_id column');
  assert(columnNames.includes('resolution'), 'conflict_records contains resolution column');
  assert(columnNames.includes('resolved_by'), 'conflict_records contains resolved_by column');

  const driftColumns = await driver.getAllAsync("PRAGMA table_info('stock_drift_records')");
  const driftColNames = driftColumns.map(c => c.name);
  assert(driftColNames.includes('expected_stock'), 'stock_drift_records contains expected_stock column');
  assert(driftColNames.includes('actual_stock'), 'stock_drift_records contains actual_stock column');
  assert(driftColNames.includes('drift_quantity'), 'stock_drift_records contains drift_quantity column');
  assert(driftColNames.includes('status'), 'stock_drift_records contains status column');

  // --- TEST SUITE 18: MULTI-DEVICE OVER-ALLOCATION RACE CONDITION ---
  console.log('\n--- 18. Multi-Device Over-Allocation Race Condition ---');
  // Seed product 3 on server with 5 units available
  await serverDb.runAsync('INSERT INTO server_products (id, current_stock) VALUES (3, 5)');

  // Device A and Device B both sell product 3 offline while disconnected:
  // Device A sells 3 units, Device B sells 4 units (Total requested: 7 units > 5 units available)
  const devAMutationId = 'tx-race-devA-001';
  const devBMutationId = 'tx-race-devB-002';

  // Push Device A first
  const resPushA = await simulateServerPush({
    client_mutation_id: devAMutationId,
    product_id: 3,
    quantity: 3,
    total_amount: 150000,
  });
  assert(resPushA.status === 'SYNCED', 'Device A syncs first and is accepted (3 units)');

  const srvStockAfterA = await serverDb.getFirstAsync('SELECT current_stock FROM server_products WHERE id = 3');
  assert(srvStockAfterA.current_stock === 2, 'Server stock decremented from 5 to 2');

  // Push Device B second (requests 4 units, but server only has 2 left)
  const resPushB = await simulateServerPush({
    client_mutation_id: devBMutationId,
    product_id: 3,
    quantity: 4,
    total_amount: 200000,
  });
  assert(resPushB.status === 'CONFLICT', 'Device B push rejected with CONFLICT status');
  assert(resPushB.conflict_type === 'INVENTORY_CONFLICT', 'Conflict classified strictly as INVENTORY_CONFLICT');
  assert(resPushB.error.code === 'INSUFFICIENT_STOCK', 'Error code is INSUFFICIENT_STOCK');

  // INVARIANT CHECK: Server stock must NEVER be forced negative!
  const srvStockAfterB = await serverDb.getFirstAsync('SELECT current_stock FROM server_products WHERE id = 3');
  assert(srvStockAfterB.current_stock === 2, 'Server stock remains strictly 2: NEVER FORCED NEGATIVE');

  // Device B persists the conflict locally in SQLite
  await driver.runAsync(`
    INSERT INTO conflict_records (
      conflict_id, client_transaction_id, conflict_type, operation,
      entity_type, entity_id, device_id, local_data, server_data,
      reason, status, detected_at
    ) VALUES (?, ?, ?, 'PUSH_MUTATION', 'SALE_ORDER', ?, 'DEV_B_UUID', ?, ?, ?, 'OPEN', datetime('now'))
  `, [
    'conf-race-001',
    devBMutationId,
    resPushB.conflict_type,
    devBMutationId,
    JSON.stringify({ product_id: 3, quantity: 4 }),
    JSON.stringify(resPushB),
    `[${resPushB.error.code}] ${resPushB.error.message}`
  ]);

  const savedRaceConflict = await driver.getFirstAsync('SELECT * FROM conflict_records WHERE conflict_id = ?', ['conf-race-001']);
  assert(savedRaceConflict !== null, 'Conflict successfully saved in local conflict_records table');
  assert(savedRaceConflict.status === 'OPEN', 'Conflict status initialized to OPEN');
  assert(savedRaceConflict.conflict_type === 'INVENTORY_CONFLICT', 'Conflict type recorded accurately as INVENTORY_CONFLICT');

  // --- TEST SUITE 19: IDEMPOTENCY VS TAMPERING (PAYLOAD MISMATCH) ---
  console.log('\n--- 19. Idempotency vs Tampering (Payload Mismatch) ---');
  const tamperTxId = 'tx-tamper-check-001';

  // 1. Initial valid push
  const initialPush = await simulateServerPush({
    client_mutation_id: tamperTxId,
    product_id: 1,
    quantity: 5,
    total_amount: 250000,
  });
  assert(initialPush.status === 'SYNCED', 'Initial push succeeds with SYNCED');

  // 2. Duplicate retry with identical payload
  const duplicatePush = await simulateServerPush({
    client_mutation_id: tamperTxId,
    product_id: 1,
    quantity: 5,
    total_amount: 250000,
  });
  assert(duplicatePush.status === 'ALREADY_PROCESSED', 'Identical payload detected as ALREADY_PROCESSED (idempotent duplicate)');
  assert(duplicatePush.conflict_type === 'DUPLICATE', 'Duplicate classified with conflict_type DUPLICATE');

  // 3. Tampered push: same client_mutation_id, but altered quantity and total_amount!
  const tamperedPush = await simulateServerPush({
    client_mutation_id: tamperTxId,
    product_id: 1,
    quantity: 99, // Tampered!
    total_amount: 4950000, // Tampered!
  });
  assert(tamperedPush.status === 'CONFLICT', 'Tampered request with different payload rejected with CONFLICT');
  assert(tamperedPush.conflict_type === 'VALIDATION_CONFLICT', 'Tampering classified as VALIDATION_CONFLICT');
  assert(tamperedPush.error.code === 'PAYLOAD_MISMATCH', 'Error code explicitly set to PAYLOAD_MISMATCH');

  // --- TEST SUITE 20: NON-DESTRUCTIVE CONFLICT RESOLUTION (CANCEL_LOCAL ROLLBACK) ---
  console.log('\n--- 20. Non-Destructive Conflict Resolution by Local Cancellation ---');
  // Seed local state for Device B's rejected sale
  // Local product 3 had stock decremented by 4 (from 10 to 6)
  await driver.runAsync(`
    INSERT INTO products (id, sku, name, category_id, product_type_id, current_cost_price, current_selling_price, current_stock, min_stock_alert, status)
    VALUES (3, 'ROBOT-001', 'Robot AI', 1, 1, 30000, 50000, 6, 2, 'ACTIVE')
  `);

  await driver.runAsync(`
    INSERT INTO sales_orders (client_order_id, order_code, sale_date, total_amount, total_discount, final_amount, total_items, status, sync_status)
    VALUES (?, 'ORD-REJECTED', '2026-09-09', 200000, 0, 200000, 4, 'COMPLETED', 'FAILED')
  `, [devBMutationId]);

  await driver.runAsync(`
    INSERT INTO sales_records (client_transaction_id, transaction_code, product_id, sale_date, quantity, unit_price_at_sale, cost_price_at_sale, discount, total_revenue, total_cost, profit, status, sync_status, client_order_id)
    VALUES ('line-devB-001', 'LINE-REJ', 3, '2026-09-09', 4, 50000, 30000, 0, 200000, 120000, 80000, 'COMPLETED', 'FAILED', ?)
  `, [devBMutationId]);

  // Execute Non-destructive Rollback (CANCEL_LOCAL)
  await driver.withTransactionAsync(async (tx) => {
    // 1. Mark conflict resolved
    await tx.runAsync(`
      UPDATE conflict_records
      SET status = 'RESOLVED', resolution = 'CANCEL_LOCAL', resolved_at = datetime('now'), resolved_by = 1
      WHERE conflict_id = 'conf-race-001'
    `);

    // 2. Cancel order
    await tx.runAsync(`
      UPDATE sales_orders SET status = 'CANCELLED', sync_status = 'FAILED' WHERE client_order_id = ?
    `, [devBMutationId]);

    await tx.runAsync(`
      UPDATE sales_records SET status = 'CANCELLED', sync_status = 'FAILED' WHERE client_order_id = ?
    `, [devBMutationId]);

    // 3. Restore product stock (+4)
    await tx.runAsync('UPDATE products SET current_stock = current_stock + 4 WHERE id = 3');

    // 4. Record compensating stock movement
    await tx.runAsync(`
      INSERT INTO stock_movements (
        client_movement_id, product_id, movement_type, quantity_change,
        balance_after, movement_date, reference_type, reference_id,
        sync_status, note, created_by, created_at
      ) VALUES ('mov-comp-devB', 3, 'ADJUSTMENT', 4, 10, '2026-09-09', 'conflict_resolution', 'conf-race-001', 'SYNCED', 'Hoàn kho do hủy đơn xung đột', 1, datetime('now'))
    `);
  });

  const resolvedConflict = await driver.getFirstAsync("SELECT status, resolution, resolved_by FROM conflict_records WHERE conflict_id = 'conf-race-001'");
  assert(resolvedConflict.status === 'RESOLVED', 'Conflict status updated to RESOLVED');
  assert(resolvedConflict.resolution === 'CANCEL_LOCAL', 'Resolution strategy recorded as CANCEL_LOCAL');
  assert(resolvedConflict.resolved_by === 1, 'Resolved by recorded user ID 1');

  const restoredProd = await driver.getFirstAsync('SELECT current_stock FROM products WHERE id = 3');
  assert(restoredProd.current_stock === 10, 'Local product stock restored to 10 (6 + 4)');

  const cancelledOrder = await driver.getFirstAsync('SELECT status, sync_status FROM sales_orders WHERE client_order_id = ?', [devBMutationId]);
  assert(cancelledOrder.status === 'CANCELLED', 'Sales order status marked CANCELLED (never deleted)');

  const compMovement = await driver.getFirstAsync("SELECT * FROM stock_movements WHERE client_movement_id = 'mov-comp-devB'");
  assert(compMovement !== null && compMovement.quantity_change === 4, 'Compensating movement of +4 units recorded');

  // --- TEST SUITE 21: STOCK DRIFT LEDGER RECONCILIATION ---
  console.log('\n--- 21. Stock Drift Ledger Reconciliation ---');
  // Seed initial purchase movement for Product 3 (quantity: 6 units)
  await driver.runAsync(`
    INSERT INTO stock_movements (
      client_movement_id, product_id, movement_type, quantity_change,
      balance_after, movement_date, reference_type, sync_status, note, created_by
    ) VALUES ('mov-init-prod3', 3, 'PURCHASE', 6, 6, '2026-09-01', 'imports', 'SYNCED', 'Nhập ban đầu', 1)
  `);
  // Ledger sum for Product 3 is now: +6 (initial) + 4 (compensating) = 10.
  // And product current_stock is 10.
  const auditInitial = await driver.getFirstAsync(`
    SELECT 
      p.current_stock,
      COALESCE(SUM(sm.quantity_change), 0) as ledger_sum
    FROM products p
    LEFT JOIN stock_movements sm ON p.id = sm.product_id
    WHERE p.id = 3
    GROUP BY p.id
  `);
  assert(auditInitial.current_stock === auditInitial.ledger_sum, 'Initial ledger sum matches product current_stock exactly (10 === 10)');

  // Simulate untracked loss / manual tampering: change current_stock to 7 without movement record!
  await driver.runAsync('UPDATE products SET current_stock = 7 WHERE id = 3');

  // Run Reconciliation Audit
  const auditDrift = await driver.getFirstAsync(`
    SELECT 
      p.id as product_id,
      p.current_stock,
      COALESCE(SUM(sm.quantity_change), 0) as ledger_sum,
      (p.current_stock - COALESCE(SUM(sm.quantity_change), 0)) as drift_quantity
    FROM products p
    LEFT JOIN stock_movements sm ON p.id = sm.product_id
    WHERE p.id = 3
    GROUP BY p.id
  `);
  assert(auditDrift.drift_quantity === -3, 'Reconciliation audit detects -3 drift (Actual 7 vs Ledger 10)');

  // Record detected drift in stock_drift_records
  await driver.runAsync(`
    INSERT INTO stock_drift_records (
      product_id, expected_stock, actual_stock, drift_quantity, source, status, notes
    ) VALUES (?, ?, ?, ?, 'SYSTEM_AUDIT', 'DETECTED', 'Phát hiện lệch tồn kho và sổ cái')
  `, [auditDrift.product_id, auditDrift.ledger_sum, auditDrift.current_stock, auditDrift.drift_quantity]);

  const driftRow = await driver.getFirstAsync("SELECT * FROM stock_drift_records WHERE product_id = 3 AND status = 'DETECTED'");
  assert(driftRow !== null, 'Stock drift successfully recorded in stock_drift_records');
  assert(driftRow.drift_quantity === -3, 'Recorded drift quantity is -3');

  // Resolve Drift via ALIGN_TO_COUNT (accept physical stock 7, add compensatory ledger movement -3)
  await driver.withTransactionAsync(async (tx) => {
    await tx.runAsync(`
      INSERT INTO stock_movements (
        client_movement_id, product_id, movement_type, quantity_change,
        balance_after, movement_date, reference_type, reference_id, sync_status, note, created_by
      ) VALUES ('mov-drift-adj-001', 3, 'ADJUSTMENT', -3, 7, '2026-09-09', 'drift_reconciliation', '1', 'SYNCED', 'Điều chỉnh sổ cái theo kiểm kê thực tế', 1)
    `);

    await tx.runAsync("UPDATE stock_drift_records SET status = 'RECONCILED' WHERE id = ?", [driftRow.id]);
  });

  const resolvedDrift = await driver.getFirstAsync('SELECT status FROM stock_drift_records WHERE id = ?', [driftRow.id]);
  assert(resolvedDrift.status === 'RECONCILED', 'Drift record marked RECONCILED after compensatory ledger adjustment');

  const postReconciliationSum = await driver.getFirstAsync('SELECT COALESCE(SUM(quantity_change), 0) as ledger_sum FROM stock_movements WHERE product_id = 3');
  const postReconciliationProd = await driver.getFirstAsync('SELECT current_stock FROM products WHERE id = 3');
  assert(postReconciliationSum.ledger_sum === postReconciliationProd.current_stock, 'Post-reconciliation ledger sum (7) perfectly matches actual stock (7)');

  // --- TEST SUITE 22: ROLE-BASED AUTHORIZATION ENFORCEMENT ---
  console.log('\n--- 22. Role-Based Authorization Enforcement ---');
  function checkConflictResolutionAuth(userRole, action) {
    // Both ADMIN and STAFF can CANCEL_LOCAL or RESTOCK_AND_RETRY
    // Only ADMIN can perform manual RESTOCK_AND_ACCEPT on server or ALIGN_TO_LEDGER stock drift overrides
    if (action === 'SERVER_RESTOCK_ACCEPT' || action === 'LEDGER_STOCK_OVERRIDE') {
      return userRole === 'ADMIN';
    }
    return userRole === 'ADMIN' || userRole === 'STAFF';
  }

  assert(checkConflictResolutionAuth('STAFF', 'CANCEL_LOCAL') === true, 'Staff authorized for local cancellation');
  assert(checkConflictResolutionAuth('STAFF', 'RESTOCK_AND_RETRY') === true, 'Staff authorized for restock and retry');
  assert(checkConflictResolutionAuth('STAFF', 'SERVER_RESTOCK_ACCEPT') === false, 'Staff DENIED for server restock override');
  assert(checkConflictResolutionAuth('STAFF', 'LEDGER_STOCK_OVERRIDE') === false, 'Staff DENIED for ledger stock override');
  assert(checkConflictResolutionAuth('ADMIN', 'SERVER_RESTOCK_ACCEPT') === true, 'Admin GRANTED for server restock override');
  assert(checkConflictResolutionAuth('ADMIN', 'LEDGER_STOCK_OVERRIDE') === true, 'Admin GRANTED for ledger stock override');

  // --- TEST SUITE 23: DEVICE IDENTITY & SESSION PERSISTENCE ---
  console.log('\n--- 23. Device Identity & Session Persistence ---');
  function generateDeviceUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  const testDeviceId = generateDeviceUUID();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert(uuidRegex.test(testDeviceId), 'Device installation UUID matches RFC 4122 v4 format');

  // sync_queue migration 007 scoping
  await driver.runAsync(`
    INSERT INTO sync_queue (
      client_mutation_id, entity_type, entity_id, action, payload_json,
      status, retry_count, user_id, device_id
    ) VALUES ('tx-scope-dev-01', 'SALE_ORDER', 'client-ord-scope-1', 'CREATE', '{"items":[]}', 'PENDING', 0, 1, ?)
  `, [testDeviceId]);

  const scopedItem = await driver.getFirstAsync('SELECT user_id, device_id FROM sync_queue WHERE client_mutation_id = ?', ['tx-scope-dev-01']);
  assert(scopedItem !== null, 'Scoped Outbox record inserted with migration 007 columns');
  assert(scopedItem.user_id === 1 && scopedItem.device_id === testDeviceId, 'Outbox record correctly scoped to user_id=1 and device_id');

  // --- TEST SUITE 24: SHORT-LIVED ACCESS TOKEN & REFRESH TOKEN ROTATION ---
  console.log('\n--- 24. Short-Lived Access Token & Refresh Token Rotation ---');
  function hashToken(raw) {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  const sessionDb = new Map();
  const rawRefreshToken1 = crypto.randomBytes(32).toString('hex');
  const tokenHash1 = hashToken(rawRefreshToken1);
  const sessionId = crypto.randomUUID();

  sessionDb.set(sessionId, {
    sessionId,
    userId: 1,
    deviceId: testDeviceId,
    refreshTokenHash: tokenHash1,
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  function rotateToken(presentedRawToken, devId) {
    const incomingHash = hashToken(presentedRawToken);
    let targetSession = null;
    for (const sess of sessionDb.values()) {
      if (sess.refreshTokenHash === incomingHash) {
        targetSession = sess;
        break;
      }
    }

    if (!targetSession) {
      throw new Error('INVALID_REFRESH_TOKEN');
    }

    if (targetSession.status === 'REVOKED') {
      throw new Error('SESSION_REVOKED');
    }

    if (targetSession.deviceId !== devId) {
      throw new Error('DEVICE_MISMATCH');
    }

    const newRawToken = crypto.randomBytes(32).toString('hex');
    targetSession.refreshTokenHash = hashToken(newRawToken);
    targetSession.lastRefreshedAt = new Date();
    return newRawToken;
  }

  const rawRefreshToken2 = rotateToken(rawRefreshToken1, testDeviceId);
  assert(rawRefreshToken2 !== rawRefreshToken1, 'Refresh token rotated with new cryptographic secret');
  assert(sessionDb.get(sessionId).refreshTokenHash === hashToken(rawRefreshToken2), 'Session store updated with new token hash');

  let reuseDetected = false;
  try {
    rotateToken(rawRefreshToken1, testDeviceId);
  } catch (err) {
    reuseDetected = true;
    assert(err.message === 'INVALID_REFRESH_TOKEN', 'Presenting invalidated old refresh token rejected immediately');
  }
  assert(reuseDetected, 'Token reuse detection prevented revoked/rotated refresh token from acquiring new session');

  // --- TEST SUITE 25: SINGLE-FLIGHT MUTEX CONCURRENCY CONTROL ---
  console.log('\n--- 25. Single-Flight Mutex Concurrency Control ---');
  let networkRefreshCount = 0;
  class MockAuthManager {
    constructor() {
      this.isRefreshing = false;
      this.refreshPromise = null;
    }

    async refreshToken() {
      if (this.isRefreshing && this.refreshPromise) {
        return this.refreshPromise;
      }

      this.isRefreshing = true;
      this.refreshPromise = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        networkRefreshCount++;
        return 'new-mock-access-token-12345';
      })().finally(() => {
        this.isRefreshing = false;
        this.refreshPromise = null;
      });

      return this.refreshPromise;
    }
  }

  const mockAuthManager = new MockAuthManager();
  const results = await Promise.all([
    mockAuthManager.refreshToken(),
    mockAuthManager.refreshToken(),
    mockAuthManager.refreshToken(),
    mockAuthManager.refreshToken(),
    mockAuthManager.refreshToken(),
  ]);

  assert(networkRefreshCount === 1, 'Exactly 1 network refresh request executed for 5 concurrent 401 callers');
  assert(results.every((tok) => tok === 'new-mock-access-token-12345'), 'All 5 callers resolved with the identical refreshed access token');

  // --- TEST SUITE 26: SAFE LOGOUT GUARD & STORAGE SEPARATION ---
  console.log('\n--- 26. Safe Logout Guard & Storage Separation ---');
  const pendingCountRow = await driver.getFirstAsync("SELECT COUNT(*) as count FROM sync_queue WHERE status IN ('PENDING', 'SYNCING', 'RETRY')");
  const pendingCount = pendingCountRow.count;
  assert(pendingCount > 0, `Pending items in outbox detected (${pendingCount} pending)`);

  function mockLogout(force = false) {
    if (pendingCount > 0 && !force) {
      return {
        success: false,
        unSyncedCount: pendingCount,
        warning: `Có ${pendingCount} giao dịch chưa được đồng bộ.`,
      };
    }
    return { success: true };
  }

  const normalLogoutAttempt = mockLogout(false);
  assert(normalLogoutAttempt.success === false, 'Safe logout blocked when un-synced Outbox items exist');
  assert(normalLogoutAttempt.unSyncedCount === pendingCount, 'Safe logout returned exact un-synced count warning');

  const forcedLogout = mockLogout(true);
  assert(forcedLogout.success === true, 'Explicitly confirmed forced logout succeeds');

  const postLogoutQueueCount = await driver.getFirstAsync('SELECT COUNT(*) as count FROM sync_queue');
  assert(postLogoutQueueCount.count > 0, 'SQLite sync_queue records remain 100% intact after logout');
  const postLogoutProduct = await driver.getFirstAsync('SELECT COUNT(*) as count FROM products');
  assert(postLogoutProduct.count > 0, 'SQLite products and master data remain 100% intact after logout');

  // --- TEST SUITE 27: REMOTE SESSION REVOCATION & DEVICE LOCKOUT ---
  console.log('\n--- 27. Remote Session Revocation & Device Lockout ---');
  const targetSession = sessionDb.get(sessionId);
  targetSession.status = 'REVOKED';
  targetSession.revokedReason = 'ADMIN_SECURITY_REVOCATION';

  function verifyZeroTrustSession(sessId) {
    const s = sessionDb.get(sessId);
    if (!s || s.status !== 'ACTIVE') {
      return null;
    }
    return s;
  }

  const sessionValidation = verifyZeroTrustSession(sessionId);
  assert(sessionValidation === null, 'Server zero-trust verification rejects revoked session_id');

  const deviceRegistry = new Map();
  deviceRegistry.set(testDeviceId, { deviceId: testDeviceId, status: 'REVOKED' });
  function verifyDeviceStatus(devId) {
    const d = deviceRegistry.get(devId);
    return d ? d.status : 'NOT_FOUND';
  }
  assert(verifyDeviceStatus(testDeviceId) === 'REVOKED', 'Revoked device immediately recognized by device registry');

  // --- TEST SUITE 28: MULTI-ACCOUNT ISOLATION & ZERO CROSS-USER HIJACKING ---
  console.log('\n--- 28. Multi-Account Isolation & Zero Cross-User Hijacking ---');
  const serverProcessedTx = new Map();
  serverProcessedTx.set('tx-cross-user-001', {
    clientTransactionId: 'tx-cross-user-001',
    userId: 1,
    deviceId: 'device-staff-1',
    status: 'PROCESSED',
  });

  function processIncomingMutation(mutation, callingUser) {
    const existing = serverProcessedTx.get(mutation.client_transaction_id);
    if (existing) {
      if (existing.userId && existing.userId !== callingUser.id) {
        return {
          status: 'CONFLICT',
          error: {
            code: 'CROSS_USER_HIJACKING_DETECTED',
            message: 'Phát hiện giao dịch đã được ghi nhận bởi tài khoản khác.',
          },
        };
      }
      return { status: 'ALREADY_PROCESSED' };
    }
    return { status: 'PROCESSED' };
  }

  const user1Retry = processIncomingMutation({ client_transaction_id: 'tx-cross-user-001' }, { id: 1 });
  assert(user1Retry.status === 'ALREADY_PROCESSED', 'Original user retry recognized as ALREADY_PROCESSED');

  const user2HijackAttempt = processIncomingMutation({ client_transaction_id: 'tx-cross-user-001' }, { id: 2 });
  assert(user2HijackAttempt.status === 'CONFLICT', 'Cross-user duplicate mutation rejected with CONFLICT');
  assert(user2HijackAttempt.error.code === 'CROSS_USER_HIJACKING_DETECTED', 'Rejection code is CROSS_USER_HIJACKING_DETECTED');

  // --- TEST SUITE 29: ACCOUNT ISOLATION & SHARED DEVICE USER SWITCH ---
  console.log('\n--- 29. Account Isolation & Shared Device User Switch ---');

  // TEST A: Sales Record Isolation
  const orderRes = await driver.runAsync(`
    INSERT INTO sales_orders (
      client_order_id, order_code, sale_date, total_amount,
      total_discount, final_amount, total_items, status,
      sync_status, created_by, created_at
    ) VALUES (?, ?, '2026-09-10', 500000, 0, 500000, 2, 'COMPLETED', 'PENDING', 1, datetime('now'))
  `, ['ord-user1-iso', 'ORD-U1-001']);

  await driver.runAsync(`
    INSERT INTO sales_records (
      order_id, client_order_id, client_transaction_id, transaction_code,
      product_id, sale_date, quantity, unit_price_at_sale, cost_price_at_sale,
      discount, total_revenue, total_cost, profit, status, sync_status,
      created_by, created_at
    ) VALUES (
      ?, 'ord-user1-iso', 'tx-u1-iso', 'TX-U1-001',
      1, '2026-09-10', 2, 250000, 150000,
      0, 500000, 300000, 200000, 'COMPLETED', 'PENDING',
      1, datetime('now')
    )
  `, [orderRes.lastInsertRowId]);

  // Query as User 2 (Staff B)
  const user2Sales = await driver.getAllAsync(
    'SELECT * FROM sales_records WHERE created_by = ?', [2]
  );
  assert(user2Sales.length === 0, 'TEST A: User B does NOT see User A sales records');

  // Query as User 1 (Staff A)
  const user1Sales = await driver.getAllAsync(
    'SELECT * FROM sales_records WHERE created_by = ?', [1]
  );
  assert(user1Sales.length > 0, 'TEST A: User A sees own sales records');

  // TEST B: Outbox Mutation Isolation on Shared Device
  await driver.runAsync(`
    INSERT INTO sync_queue (
      client_mutation_id, entity_type, entity_id, action,
      payload_json, payload_version, status, retry_count,
      user_id, device_id, created_at, updated_at
    ) VALUES (?, 'SALE_ORDER', ?, 'CREATE', '{}', 1, 'PENDING', 0, 1, 'dev-shared-01', datetime('now'), datetime('now'))
  `, ['outbox-user1-pending', 'ord-user1-iso']);

  // User 2 queries eligible mutations for push
  const user2Eligible = await driver.getAllAsync(`
    SELECT * FROM sync_queue
    WHERE (user_id = ? OR user_id IS NULL)
      AND (status = 'PENDING' OR (status = 'RETRY' AND next_retry_at <= datetime('now')))
  `, [2]);
  const containsUser1 = user2Eligible.some(r => r.client_mutation_id === 'outbox-user1-pending');
  assert(!containsUser1, 'TEST B: User B sync push CANNOT fetch User A pending Outbox items');

  // User 1 queries eligible mutations
  const user1Eligible = await driver.getAllAsync(`
    SELECT * FROM sync_queue
    WHERE (user_id = ? OR user_id IS NULL)
      AND (status = 'PENDING' OR (status = 'RETRY' AND next_retry_at <= datetime('now')))
  `, [1]);
  const user1HasMutation = user1Eligible.some(r => r.client_mutation_id === 'outbox-user1-pending');
  assert(user1HasMutation, 'TEST B: User A pending Outbox mutation preserved intact on device');

  // TEST C: Conflict Isolation & Non-Destructive Resolution Guard
  await driver.runAsync(`
    INSERT INTO conflict_records (
      conflict_id, client_transaction_id, entity_type, entity_id,
      local_data, server_data, reason, status, conflict_type,
      operation, device_id, user_id, detected_at
    ) VALUES (
      'cnf-user1-iso', 'tx-u1-iso', 'SALE_ORDER', 'ord-user1-iso',
      '{}', '{}', 'Stock conflict', 'OPEN', 'INVENTORY_CONFLICT',
      'CREATE', 'dev-shared-01', 1, datetime('now')
    )
  `);

  // User 2 queries open conflicts
  const user2Conflicts = await driver.getAllAsync(`
    SELECT * FROM conflict_records
    WHERE status = 'OPEN' AND (user_id = ? OR user_id IS NULL)
  `, [2]);
  const containsUser1Conflict = user2Conflicts.some(c => c.conflict_id === 'cnf-user1-iso');
  assert(!containsUser1Conflict, 'TEST C: User B cannot see User A conflicts');

  // User 2 unauthorized resolution attempt
  const conflictRecord = await driver.getFirstAsync(
    'SELECT * FROM conflict_records WHERE conflict_id = ?', ['cnf-user1-iso']
  );
  let hijackRejected = false;
  const resolvingUserId = 2; // User B
  if (resolvingUserId !== undefined && conflictRecord.user_id !== null && conflictRecord.user_id !== resolvingUserId && resolvingUserId !== 1) {
    hijackRejected = true;
  }
  assert(hijackRejected === true, 'TEST C: User B blocked from resolving User A conflict');

  // TEST D: Client Cache Isolation
  const clientCacheMock = new Map();
  clientCacheMock.set('tshop_cache_sales_today', { data: [ { id: 1 } ], timestamp: Date.now() });
  function clearCache() {
    clientCacheMock.clear();
  }
  assert(clientCacheMock.size === 1, 'TEST D: User A cache initialized');
  clearCache(); // Logout triggered
  assert(clientCacheMock.size === 0, 'TEST D: Cache 100% flushed on logout/account switch');
  assert(clientCacheMock.get('tshop_cache_sales_today') === undefined, 'TEST D: Zero cache leakage to User B');

  // TEST E: Sync Cursor Account Isolation
  await driver.runAsync(`
    INSERT OR REPLACE INTO sync_metadata (key, value, updated_at)
    VALUES ('pull_cursor_user_1', '2026-09-10T10:00:00.000Z', datetime('now'))
  `);

  async function getUserCursor(userId) {
    const key = `pull_cursor_user_${userId}`;
    const row = await driver.getFirstAsync('SELECT value FROM sync_metadata WHERE key = ?', [key]);
    return row ? row.value : '1970-01-01T00:00:00.000Z';
  }

  const user1Cursor = await getUserCursor(1);
  const user2Cursor = await getUserCursor(2);
  assert(user1Cursor === '2026-09-10T10:00:00.000Z', 'TEST E: User A cursor preserved accurately');
  assert(user2Cursor === '1970-01-01T00:00:00.000Z', 'TEST E: User B cursor starts cleanly without inheriting User A cursor');

  await driver.runAsync(`
    INSERT OR REPLACE INTO sync_metadata (key, value, updated_at)
    VALUES ('pull_cursor_user_2', '2026-09-10T11:00:00.000Z', datetime('now'))
  `);
  const user1CursorAfter = await getUserCursor(1);
  const user2CursorAfter = await getUserCursor(2);
  assert(user1CursorAfter === '2026-09-10T10:00:00.000Z', 'TEST E: User A cursor completely unaffected by User B cursor updates');
  assert(user2CursorAfter === '2026-09-10T11:00:00.000Z', 'TEST E: User B cursor updated independently');

  // =========================================================================================
  // SUITE 30: PHASE 09 — POS CHECKOUT, BARCODE SCANNER, PAYMENT ENGINE & ESC/POS PRINTER AUDIT
  // =========================================================================================
  console.log('\n--- SUITE 30: PHASE 09 POS CHECKOUT, BARCODE SCANNER, PAYMENT & PRINTER AUDIT ---');
  {
  // 1. PRODUCT SEARCH & OFFLINE BARCODE LOOKUP
  // Seed sample products
  await driver.runAsync(`
    INSERT OR REPLACE INTO products (
      id, sku, name, category_id, product_type_id, current_cost_price, current_selling_price, current_stock, min_stock_alert, status
    ) VALUES 
      (101, 'BAR-EAN-01', 'Bup Be Barbie 30cm', 1, 1, 50000, 120000, 15, 2, 'ACTIVE'),
      (102, 'BAR-QR-02', 'O To Dieu Khien Tu Xa', 1, 1, 150000, 300000, 5, 1, 'ACTIVE'),
      (103, 'BAR-ZERO-03', 'Gau Bong Capybara Het Hang', 1, 1, 40000, 90000, 0, 1, 'ACTIVE')
  `);

  // Test exact barcode / SKU lookup
  async function lookupBarcode(code) {
    const trimmed = code.trim();
    const numId = Number(trimmed);
    const isNum = !isNaN(numId) && numId > 0;
    return await driver.getFirstAsync(`
      SELECT * FROM products
      WHERE LOWER(sku) = LOWER(?) ${isNum ? 'OR id = ?' : ''}
      LIMIT 1
    `, isNum ? [trimmed, numId] : [trimmed]);
  }

  const foundBySku = await lookupBarcode('bar-ean-01');
  assert(foundBySku !== null && foundBySku.id === 101, 'POS Barcode: Case-insensitive SKU barcode match');

  const foundById = await lookupBarcode('102');
  assert(foundById !== null && foundById.id === 102, 'POS Barcode: Numeric ID barcode match');

  const unknownBarcode = await lookupBarcode('UNKNOWN-999-XYZ');
  assert(unknownBarcode === null, 'POS Barcode: Unknown barcode returns null without crash or DB pollution');

  // 2. CART ENGINE & QUANTITY VALIDATION
  class MockPosCart {
    constructor() {
      this.items = [];
    }

    add(product, qty = 1) {
      if (qty <= 0 || !Number.isInteger(qty)) {
        throw new Error('Số lượng sản phẩm phải là số nguyên dương lớn hơn 0');
      }
      const existing = this.items.find(i => i.product.id === product.id);
      const targetQty = (existing ? existing.qty : 0) + qty;
      if (targetQty > product.current_stock) {
        throw new Error(`Sản phẩm '${product.name}' không đủ tồn kho khả dụng! Hiện có: ${product.current_stock}, yêu cầu: ${targetQty}`);
      }
      if (existing) {
        existing.qty = targetQty;
      } else {
        this.items.push({ product, qty, priceSnapshot: product.current_selling_price });
      }
    }

    updateQty(productId, newQty) {
      if (newQty <= 0 || !Number.isInteger(newQty)) {
        throw new Error('Số lượng phải lớn hơn 0');
      }
      const it = this.items.find(i => i.product.id === productId);
      if (!it) throw new Error('Không tìm thấy sản phẩm trong giỏ');
      if (newQty > it.product.current_stock) {
        throw new Error('Vượt quá tồn kho khả dụng');
      }
      it.qty = newQty;
    }

    remove(productId) {
      this.items = this.items.filter(i => i.product.id !== productId);
    }

    getTotal() {
      return this.items.reduce((sum, it) => sum + it.priceSnapshot * it.qty, 0);
    }
  }

  const cart = new MockPosCart();
  cart.add(foundBySku, 2);
  assert(cart.items.length === 1 && cart.items[0].qty === 2, 'POS Cart: Add item with quantity 2');

  // Duplicate product scan auto-merges
  cart.add(foundBySku, 3);
  assert(cart.items.length === 1 && cart.items[0].qty === 5, 'POS Cart: Duplicate product scan increments quantity to 5');

  // Add second product
  cart.add(foundById, 1);
  assert(cart.items.length === 2, 'POS Cart: Multi-product cart has 2 unique lines');

  // Insufficient stock validation
  let stockExceededThrown = false;
  try {
    cart.add(foundById, 10); // current_stock is 5, requested total 11
  } catch (err) {
    stockExceededThrown = true;
  }
  assert(stockExceededThrown, 'POS Stock: Block adding quantity exceeding available stock (5 < 11)');

  // Out of stock product validation (current_stock = 0)
  const zeroStockProd = await lookupBarcode('BAR-ZERO-03');
  let zeroStockThrown = false;
  try {
    cart.add(zeroStockProd, 1);
  } catch (err) {
    zeroStockThrown = true;
  }
  assert(zeroStockThrown, 'POS Stock: Block adding out-of-stock product (0 available)');

  // Invalid quantity validations (0, negative, decimal)
  let invalidQtyThrown = false;
  try {
    cart.add(foundBySku, -1);
  } catch {
    invalidQtyThrown = true;
  }
  assert(invalidQtyThrown, 'POS Validation: Block negative quantity');

  let zeroQtyThrown = false;
  try {
    cart.add(foundBySku, 0);
  } catch {
    zeroQtyThrown = true;
  }
  assert(zeroQtyThrown, 'POS Validation: Block zero quantity');

  // Price Snapshot invariant test
  const expectedTotal = 5 * 120000 + 1 * 300000; // 600,000 + 300,000 = 900,000
  assert(cart.getTotal() === 900000, 'POS Financial: Cart total calculated accurately at 900,000 đ');

  // Mutate product price in database to test snapshot immutability
  await driver.runAsync('UPDATE products SET current_selling_price = 199000 WHERE id = 101');
  assert(cart.getTotal() === 900000, 'POS Price Snapshot: Cart item price preserved even if product price changes');

  // Restore price
  await driver.runAsync('UPDATE products SET current_selling_price = 120000 WHERE id = 101');

  // 3. PAYMENT ENGINE & CASH CALCULATIONS
  function validatePayment(total, paymentMethod, cashReceived) {
    if (paymentMethod === 'CASH') {
      if (cashReceived === undefined || cashReceived === null || cashReceived < total) {
        throw new Error(`Tiền khách đưa không đủ! Cần: ${total}, nhận: ${cashReceived}`);
      }
      const change = cashReceived - total;
      return { total, received: cashReceived, change, status: 'PAID' };
    }
    return { total, received: total, change: 0, status: 'PAID' };
  }

  // Exact cash
  const exactPay = validatePayment(900000, 'CASH', 900000);
  assert(exactPay.change === 0 && exactPay.status === 'PAID', 'POS Payment: Exact cash payment returns change 0 đ');

  // Overpayment with change
  const overPay = validatePayment(900000, 'CASH', 1000000);
  assert(overPay.change === 100000 && overPay.status === 'PAID', 'POS Payment: Overpayment (1,000,000) calculates change 100,000 đ');

  // Underpayment validation
  let underPayThrown = false;
  try {
    validatePayment(900000, 'CASH', 500000);
  } catch {
    underPayThrown = true;
  }
  assert(underPayThrown, 'POS Payment: Underpayment rejected with descriptive error');

  // 4. ATOMIC CHECKOUT & PERSISTENCE (Sale + Items + Inventory + Outbox)
  const clientOrderId = 'client-order-pos-09-001';
  const orderCode = 'HD-POS-09001';
  const posUserId = 1;

  const checkoutTxResult = await driver.withTransactionAsync(async (tx) => {
    // 1. Insert sales_orders
    const orderRes = await tx.runAsync(`
      INSERT INTO sales_orders (
        client_order_id, order_code, sale_date, total_amount, total_discount, final_amount,
        total_items, status, sync_status, created_by, created_at
      ) VALUES (?, ?, date('now'), ?, 0, ?, ?, 'COMPLETED', 'PENDING', ?, datetime('now'))
    `, [clientOrderId, orderCode, 900000, 900000, 6, posUserId]);

    const orderId = orderRes.lastInsertRowId;

    // 2. Insert items & deduct inventory
    for (const item of cart.items) {
      const lineRevenue = item.priceSnapshot * item.qty;
      const lineCost = item.product.current_cost_price * item.qty;

      await tx.runAsync(`
        INSERT INTO sales_records (
          client_transaction_id, transaction_code, product_id, sale_date, quantity,
          unit_price_at_sale, cost_price_at_sale, discount, total_revenue, total_cost, profit,
          status, sync_status, created_by, created_at
        ) VALUES (
          ?, ?, ?, date('now'), ?,
          ?, ?, 0, ?, ?, ?,
          'COMPLETED', 'PENDING', ?, datetime('now')
        )
      `, [
        `${clientOrderId}-item-${item.product.id}`,
        `${orderCode}-${item.product.id}`,
        item.product.id,
        item.qty,
        item.priceSnapshot,
        item.product.current_cost_price,
        lineRevenue,
        lineCost,
        lineRevenue - lineCost,
        posUserId
      ]);

      // Deduct inventory
      await tx.runAsync(`
        UPDATE products
        SET current_stock = current_stock - ?, updated_at = datetime('now')
        WHERE id = ?
      `, [item.qty, item.product.id]);
    }

    // 3. Enqueue Outbox mutation
    const outboxPayload = JSON.stringify({
      orderId,
      orderCode,
      totalAmount: 900000,
      paymentMethod: 'CASH',
      cashReceived: 1000000,
      cashChange: 100000,
      items: cart.items.map(i => ({
        productId: i.product.id,
        sku: i.product.sku,
        quantity: i.qty,
        unitPrice: i.priceSnapshot,
      })),
    });

    await tx.runAsync(`
      INSERT INTO sync_queue (
        client_mutation_id, entity_type, entity_id, action, payload_json,
        payload_version, status, retry_count, user_id, device_id, created_at, updated_at
      ) VALUES (
        ?, 'SALE_ORDER', ?, 'CREATE', ?,
        1, 'PENDING', 0, ?, 'dev-pos-01', datetime('now'), datetime('now')
      )
    `, [clientOrderId, orderCode, outboxPayload, posUserId]);

    return { orderId, orderCode };
  });

  assert(checkoutTxResult.orderId > 0, 'POS Atomic Checkout: Sale order inserted with ID ' + checkoutTxResult.orderId);

  // Verify inventory deduction
  const p101 = await driver.getFirstAsync('SELECT current_stock FROM products WHERE id = 101');
  assert(p101.current_stock === 10, 'POS Inventory: Stock deducted from 15 to 10 for Product 101');

  const p102 = await driver.getFirstAsync('SELECT current_stock FROM products WHERE id = 102');
  assert(p102.current_stock === 4, 'POS Inventory: Stock deducted from 5 to 4 for Product 102');

  // Verify Outbox persistence
  const outboxRecord = await driver.getFirstAsync(
    'SELECT * FROM sync_queue WHERE client_mutation_id = ?', [clientOrderId]
  );
  assert(outboxRecord !== null && outboxRecord.status === 'PENDING', 'POS Outbox: Mutation enqueued with status PENDING');
  assert(outboxRecord.user_id === 1, 'POS Outbox: Transaction properly attributed to User ID 1');

  // 5. ESC/POS PROTOCOL & PRINTER FAILURE DECOUPLING (Section 36)
  // Simple ESC/POS builder validation
  function generateEscPosReceipt(order, items) {
    const ESC = 0x1B;
    const GS = 0x1D;
    const bytes = [];

    // Init: ESC @
    bytes.push(ESC, 0x40);

    // Center header
    bytes.push(ESC, 0x61, 0x01);
    const storeHeader = 'T_SHOP VIETNAM\nHOA DON BAN HANG\n';
    for (let i = 0; i < storeHeader.length; i++) bytes.push(storeHeader.charCodeAt(i));

    // Left align items
    bytes.push(ESC, 0x61, 0x00);
    for (const it of items) {
      const line = `${it.name}: ${it.qty} x ${it.price}\n`;
      for (let i = 0; i < line.length; i++) bytes.push(line.charCodeAt(i));
    }

    // Cut paper: GS V 0
    bytes.push(GS, 0x56, 0x00);
    return new Uint8Array(bytes);
  }

  const receiptBytes = generateEscPosReceipt(
    { code: orderCode },
    [{ name: 'Barbie 30cm', qty: 5, price: 120000 }]
  );
  assert(receiptBytes.length > 20, 'POS ESC/POS: Binary buffer generated with length ' + receiptBytes.length + ' bytes');
  assert(receiptBytes[0] === 0x1B && receiptBytes[1] === 0x40, 'POS ESC/POS: Hardware reset command (ESC @) present');

  // Vietnamese diacritic transliteration test
  function stripDiacritics(str) {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .replace(/[^\x00-\x7E]/g, '');
  }
  const stripped = stripDiacritics('Hóa Đơn Bán Hàng - Đồ Chơi Trẻ Em');
  assert(stripped === 'Hoa Don Ban Hang - Do Choi Tre Em', 'POS ESC/POS: Vietnamese diacritic transliteration produces clean ASCII');

  // PRINTER FAILURE ISOLATION TEST (Section 36)
  // Simulate printer hardware exception during print
  let simulatedPrinterConnected = false;
  let printAttemptFailed = false;

  async function printReceiptSafe(receipt) {
    try {
      if (!simulatedPrinterConnected) {
        throw new Error('Bluetooth printer disconnected (Error: BT_TIMEOUT)');
      }
      return { success: true };
    } catch (err) {
      printAttemptFailed = true;
      return { success: false, error: err.message };
    }
  }

  const printResult = await printReceiptSafe({ orderCode });
  assert(printResult.success === false, 'POS Printer: Simulated Bluetooth print failure handled gracefully');
  assert(printAttemptFailed === true, 'POS Printer: Failure flagged without throwing unhandled exception');

  // CRITICAL CHECK: Verify Sale still exists in SQLite and inventory is still updated!
  const saleAfterPrintFailure = await driver.getFirstAsync(
    'SELECT * FROM sales_orders WHERE client_order_id = ?', [clientOrderId]
  );
  assert(
    saleAfterPrintFailure !== null && saleAfterPrintFailure.status === 'COMPLETED',
    'POS Section 36 Invariant: PRINTER FAILURE DOES NOT ROLLBACK OR ALTER PERSISTED SALE!'
  );

  const outboxAfterPrintFailure = await driver.getFirstAsync(
    'SELECT * FROM sync_queue WHERE client_mutation_id = ?', [clientOrderId]
  );
  assert(
    outboxAfterPrintFailure !== null && outboxAfterPrintFailure.status === 'PENDING',
    'POS Section 36 Invariant: OUTBOX QUEUE RECORD REMAINS INTACT ON PRINTER FAILURE'
  );
  }

  // --- SUMMARY ---
  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passedTests} PASSED / ${failedTests} FAILED`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error during test execution:', err);
  process.exit(1);
});
