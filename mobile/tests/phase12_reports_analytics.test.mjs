// T_SHOP Mobile — Phase 12 Comprehensive Automated Reports & Performance Analytics Tests
import Database from 'better-sqlite3';

console.log('================================================================');
console.log('    T_SHOP MOBILE — PHASE 12 REPORTS & PERFORMANCE TESTS        ');
console.log('================================================================\n');

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

// Schemas v1 - v9
const schemaSql = `
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
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS product_types (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    sku TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    product_type_id INTEGER NOT NULL REFERENCES product_types(id),
    current_cost_price REAL NOT NULL DEFAULT 0 CHECK (current_cost_price >= 0),
    current_selling_price REAL NOT NULL DEFAULT 0 CHECK (current_selling_price >= 0),
    current_stock INTEGER NOT NULL DEFAULT 0,
    min_stock_alert INTEGER NOT NULL DEFAULT 5,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sales_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_order_id TEXT UNIQUE NOT NULL,
    order_code TEXT UNIQUE NOT NULL,
    sale_date TEXT NOT NULL,
    total_amount REAL NOT NULL CHECK (total_amount >= 0),
    total_discount REAL NOT NULL DEFAULT 0 CHECK (total_discount >= 0),
    final_amount REAL NOT NULL CHECK (final_amount >= 0),
    total_items INTEGER NOT NULL CHECK (total_items > 0),
    payment_method TEXT NOT NULL DEFAULT 'CASH',
    status TEXT NOT NULL DEFAULT 'COMPLETED',
    sync_status TEXT NOT NULL DEFAULT 'PENDING',
    note TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sales_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_transaction_id TEXT UNIQUE NOT NULL,
    server_id INTEGER,
    order_id INTEGER REFERENCES sales_orders(id) ON DELETE CASCADE,
    client_order_id TEXT,
    transaction_code TEXT UNIQUE NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id),
    sale_date TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_at_sale REAL NOT NULL CHECK (unit_price_at_sale >= 0),
    cost_price_at_sale REAL NOT NULL CHECK (cost_price_at_sale >= 0),
    discount REAL NOT NULL DEFAULT 0 CHECK (discount >= 0),
    total_revenue REAL NOT NULL CHECK (total_revenue >= 0),
    total_cost REAL NOT NULL CHECK (total_cost >= 0),
    profit REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'COMPLETED',
    sync_status TEXT NOT NULL DEFAULT 'PENDING',
    cancel_reason TEXT,
    cancelled_at TEXT,
    cancelled_by INTEGER REFERENCES users(id),
    note TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_import_id TEXT UNIQUE NOT NULL,
    server_id INTEGER,
    import_code TEXT UNIQUE NOT NULL,
    supplier_id INTEGER REFERENCES suppliers(id),
    import_date TEXT NOT NULL,
    total_amount REAL NOT NULL CHECK (total_amount >= 0),
    total_items INTEGER NOT NULL CHECK (total_items > 0),
    status TEXT NOT NULL DEFAULT 'COMPLETED',
    sync_status TEXT NOT NULL DEFAULT 'PENDING',
    note TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS import_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_record_id TEXT UNIQUE NOT NULL,
    server_id INTEGER,
    import_id INTEGER REFERENCES imports(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price REAL NOT NULL CHECK (unit_price >= 0),
    total_amount REAL NOT NULL CHECK (total_amount >= 0),
    status TEXT NOT NULL DEFAULT 'COMPLETED',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS inventory_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    import_record_id INTEGER REFERENCES import_records(id),
    lot_code TEXT,
    quantity_imported INTEGER NOT NULL CHECK (quantity_imported > 0),
    quantity_remaining INTEGER NOT NULL CHECK (quantity_remaining >= 0),
    unit_cost REAL NOT NULL CHECK (unit_cost >= 0),
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEPLETED', 'EXPIRED')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sale_cost_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_record_id INTEGER NOT NULL REFERENCES sales_records(id) ON DELETE CASCADE,
    inventory_lot_id INTEGER NOT NULL REFERENCES inventory_lots(id),
    quantity_taken INTEGER NOT NULL CHECK (quantity_taken > 0),
    unit_cost REAL NOT NULL CHECK (unit_cost >= 0),
    allocated_cost REAL NOT NULL CHECK (allocated_cost >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

// Helper test logic simulating AnalyticsService functions
function calculateMetricComparison(current, previous) {
  const diff = current - previous;
  if (previous === 0) {
    return {
      diff,
      pctChange: current > 0 ? 100 : 0,
      direction: current > 0 ? 'up' : 'neutral',
    };
  }
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
  return {
    diff,
    pctChange: Math.abs(pct),
    direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral',
  };
}

function calculateMarginComparison(currentMargin, previousMargin) {
  const ppDiff = Math.round((currentMargin - previousMargin) * 100) / 100;
  return {
    ppDiff,
    direction: ppDiff > 0 ? 'up' : ppDiff < 0 ? 'down' : 'neutral',
  };
}

async function runTests() {
  const db = new NodeTestSqliteDriver();
  await db.execAsync(schemaSql);

  console.log('--- 1. Database & Schema Initialization ---');
  assert(db.isOpen(), 'Test SQLite database initialized in-memory');

  // Insert Users
  await db.runAsync(`INSERT INTO users (id, username, full_name, role) VALUES (1, 'admin', 'Quản Trị Viên', 'ADMIN')`);
  await db.runAsync(`INSERT INTO users (id, username, full_name, role) VALUES (2, 'staff1', 'Nguyễn Văn Thuật', 'STAFF')`);
  await db.runAsync(`INSERT INTO users (id, username, full_name, role) VALUES (3, 'staff2', 'Trần Thị B', 'STAFF')`);

  // Insert Categories
  await db.runAsync(`INSERT INTO categories (id, code, name) VALUES (1, 'CAT01', 'Thời Trang')`);
  await db.runAsync(`INSERT INTO categories (id, code, name) VALUES (2, 'CAT02', 'Đồ Chơi')`);
  await db.runAsync(`INSERT INTO categories (id, code, name) VALUES (3, 'CAT03', 'Phụ Kiện')`);

  // Insert Product Types
  await db.runAsync(`INSERT INTO product_types (id, category_id, code, name) VALUES (1, 1, 'TYPE01', 'Áo Quần')`);
  await db.runAsync(`INSERT INTO product_types (id, category_id, code, name) VALUES (2, 2, 'TYPE02', 'Lego')`);
  await db.runAsync(`INSERT INTO product_types (id, category_id, code, name) VALUES (3, 3, 'TYPE03', 'Mũ Nón')`);

  // Insert Products
  // Product 1: High Rev, High Profit (Star)
  await db.runAsync(`INSERT INTO products (id, sku, name, category_id, product_type_id, current_cost_price, current_selling_price, current_stock, min_stock_alert) 
    VALUES (1, 'SKU-001', 'Áo Sơ Mi Nam Cao Cấp', 1, 1, 100000, 300000, 50, 5)`);
  // Product 2: High Rev, Low Margin (Cash Cow / Fast volume, low margin)
  await db.runAsync(`INSERT INTO products (id, sku, name, category_id, product_type_id, current_cost_price, current_selling_price, current_stock, min_stock_alert) 
    VALUES (2, 'SKU-002', 'Đồ Chơi Xếp Hình Lego', 2, 2, 180000, 200000, 100, 10)`);
  // Product 3: Low Rev, High Margin (Potential)
  await db.runAsync(`INSERT INTO products (id, sku, name, category_id, product_type_id, current_cost_price, current_selling_price, current_stock, min_stock_alert) 
    VALUES (3, 'SKU-003', 'Mũ Vành Đi Biển', 3, 3, 30000, 120000, 20, 5)`);
  // Product 4: Low Rev, Low Margin (Low Performer)
  await db.runAsync(`INSERT INTO products (id, sku, name, category_id, product_type_id, current_cost_price, current_selling_price, current_stock, min_stock_alert) 
    VALUES (4, 'SKU-004', 'Tất Thể Thao Nam', 1, 1, 15000, 18000, 2, 5)`);
  // Product 5: Dead stock (no sales, high stock)
  await db.runAsync(`INSERT INTO products (id, sku, name, category_id, product_type_id, current_cost_price, current_selling_price, current_stock, min_stock_alert) 
    VALUES (5, 'SKU-005', 'Dây Lưng Cũ Tồn Kho', 3, 3, 50000, 100000, 40, 5)`);

  // Insert Inventory Lots
  await db.runAsync(`INSERT INTO inventory_lots (id, product_id, lot_code, quantity_imported, quantity_remaining, unit_cost) 
    VALUES (1, 1, 'LOT-01-A', 50, 40, 100000)`);
  await db.runAsync(`INSERT INTO inventory_lots (id, product_id, lot_code, quantity_imported, quantity_remaining, unit_cost) 
    VALUES (2, 2, 'LOT-02-A', 100, 70, 180000)`);
  await db.runAsync(`INSERT INTO inventory_lots (id, product_id, lot_code, quantity_imported, quantity_remaining, unit_cost) 
    VALUES (3, 3, 'LOT-03-A', 20, 18, 30000)`);
  await db.runAsync(`INSERT INTO inventory_lots (id, product_id, lot_code, quantity_imported, quantity_remaining, unit_cost) 
    VALUES (4, 4, 'LOT-04-A', 10, 2, 15000)`);
  await db.runAsync(`INSERT INTO inventory_lots (id, product_id, lot_code, quantity_imported, quantity_remaining, unit_cost) 
    VALUES (5, 5, 'LOT-05-A', 40, 40, 50000)`);

  console.log('--- 2. Sales Orders & Records Invariants ---');
  // Order 1: Current period, Completed, Staff 1
  // Product 1: 10 units @ 300,000 = 3,000,000. Discount = 200,000. Net Rev = 2,800,000. COGS = 1,000,000. Profit = 1,800,000.
  await db.runAsync(`INSERT INTO sales_orders (id, client_order_id, order_code, sale_date, total_amount, total_discount, final_amount, total_items, payment_method, status, created_by, created_at)
    VALUES (1, 'ORD-001', 'HD-001', '2026-09-15', 3000000, 200000, 2800000, 10, 'CASH', 'COMPLETED', 2, '2026-09-15 09:15:00')`);
  await db.runAsync(`INSERT INTO sales_records (id, client_transaction_id, order_id, client_order_id, transaction_code, product_id, sale_date, quantity, unit_price_at_sale, cost_price_at_sale, discount, total_revenue, total_cost, profit, status, created_by, created_at)
    VALUES (1, 'TX-001', 1, 'ORD-001', 'TRX-001', 1, '2026-09-15', 10, 3000000/10, 100000, 200000, 2800000, 1000000, 1800000, 'COMPLETED', 2, '2026-09-15 09:15:00')`);
  await db.runAsync(`INSERT INTO sale_cost_allocations (sale_record_id, inventory_lot_id, quantity_taken, unit_cost, allocated_cost)
    VALUES (1, 1, 10, 100000, 1000000)`);

  // Order 2: Current period, Completed, Staff 2
  // Product 2: 30 units @ 200,000 = 6,000,000. Discount = 0. Net Rev = 6,000,000. COGS = 5,400,000. Profit = 600,000.
  await db.runAsync(`INSERT INTO sales_orders (id, client_order_id, order_code, sale_date, total_amount, total_discount, final_amount, total_items, payment_method, status, created_by, created_at)
    VALUES (2, 'ORD-002', 'HD-002', '2026-09-15', 6000000, 0, 6000000, 30, 'BANK_TRANSFER', 'COMPLETED', 3, '2026-09-15 14:30:00')`);
  await db.runAsync(`INSERT INTO sales_records (id, client_transaction_id, order_id, client_order_id, transaction_code, product_id, sale_date, quantity, unit_price_at_sale, cost_price_at_sale, discount, total_revenue, total_cost, profit, status, created_by, created_at)
    VALUES (2, 'TX-002', 2, 'ORD-002', 'TRX-002', 2, '2026-09-15', 30, 200000, 180000, 0, 6000000, 5400000, 600000, 'COMPLETED', 3, '2026-09-15 14:30:00')`);
  await db.runAsync(`INSERT INTO sale_cost_allocations (sale_record_id, inventory_lot_id, quantity_taken, unit_cost, allocated_cost)
    VALUES (2, 2, 30, 180000, 5400000)`);

  // Order 3: Current period, Completed, Staff 2
  // Product 3: 2 units @ 120,000 = 240,000. Discount = 10,000. Net Rev = 230,000. COGS = 60,000. Profit = 170,000.
  await db.runAsync(`INSERT INTO sales_orders (id, client_order_id, order_code, sale_date, total_amount, total_discount, final_amount, total_items, payment_method, status, created_by, created_at)
    VALUES (3, 'ORD-003', 'HD-003', '2026-09-15', 240000, 10000, 230000, 2, 'CASH', 'COMPLETED', 3, '2026-09-15 19:45:00')`);
  await db.runAsync(`INSERT INTO sales_records (id, client_transaction_id, order_id, client_order_id, transaction_code, product_id, sale_date, quantity, unit_price_at_sale, cost_price_at_sale, discount, total_revenue, total_cost, profit, status, created_by, created_at)
    VALUES (3, 'TX-003', 3, 'ORD-003', 'TRX-003', 3, '2026-09-15', 2, 120000, 30000, 10000, 230000, 60000, 170000, 'COMPLETED', 3, '2026-09-15 19:45:00')`);
  await db.runAsync(`INSERT INTO sale_cost_allocations (sale_record_id, inventory_lot_id, quantity_taken, unit_cost, allocated_cost)
    VALUES (3, 3, 2, 30000, 60000)`);

  // Order 4: CANCELLED order - MUST BE EXCLUDED from financial metrics
  await db.runAsync(`INSERT INTO sales_orders (id, client_order_id, order_code, sale_date, total_amount, total_discount, final_amount, total_items, payment_method, status, created_by, created_at)
    VALUES (4, 'ORD-004', 'HD-004', '2026-09-15', 5000000, 500000, 4500000, 10, 'CASH', 'CANCELLED', 2, '2026-09-15 10:00:00')`);
  await db.runAsync(`INSERT INTO sales_records (id, client_transaction_id, order_id, client_order_id, transaction_code, product_id, sale_date, quantity, unit_price_at_sale, cost_price_at_sale, discount, total_revenue, total_cost, profit, status, created_by, created_at)
    VALUES (4, 'TX-004', 4, 'ORD-004', 'TRX-004', 1, '2026-09-15', 10, 500000, 100000, 500000, 4500000, 1000000, 3500000, 'CANCELLED', 2, '2026-09-15 10:00:00')`);

  // Order 5: Previous Period (Yesterday: 2026-09-14), Completed
  // Product 1: 5 units @ 300,000 = 1,500,000. Discount = 50,000. Net Rev = 1,450,000. COGS = 500,000. Profit = 950,000.
  await db.runAsync(`INSERT INTO sales_orders (id, client_order_id, order_code, sale_date, total_amount, total_discount, final_amount, total_items, payment_method, status, created_by, created_at)
    VALUES (5, 'ORD-005', 'HD-005', '2026-09-14', 1500000, 50000, 1450000, 5, 'CASH', 'COMPLETED', 2, '2026-09-14 11:00:00')`);
  await db.runAsync(`INSERT INTO sales_records (id, client_transaction_id, order_id, client_order_id, transaction_code, product_id, sale_date, quantity, unit_price_at_sale, cost_price_at_sale, discount, total_revenue, total_cost, profit, status, created_by, created_at)
    VALUES (5, 'TX-005', 5, 'ORD-005', 'TRX-005', 1, '2026-09-14', 5, 300000, 100000, 50000, 1450000, 500000, 950000, 'COMPLETED', 2, '2026-09-14 11:00:00')`);

  console.log('--- 3. Financial & KPI Calculations Proof ---');
  // Query Current Period (2026-09-15)
  const currentSummary = await db.getFirstAsync(`
    SELECT 
      COALESCE(SUM(quantity * unit_price_at_sale), 0) as gross_sales,
      COALESCE(SUM(discount), 0) as total_discount,
      COALESCE(SUM(total_revenue), 0) as net_revenue,
      COALESCE(SUM(total_cost), 0) as total_cogs,
      COALESCE(SUM(profit), 0) as gross_profit,
      COALESCE(SUM(quantity), 0) as total_units,
      COUNT(DISTINCT order_id) as total_orders
    FROM sales_records
    WHERE sale_date = '2026-09-15' AND status = 'COMPLETED'
  `);

  // Expected for 2026-09-15:
  // Order 1: Gross 3,000,000, Disc 200,000, Net 2,800,000, COGS 1,000,000, Profit 1,800,000, Units 10
  // Order 2: Gross 6,000,000, Disc 0,       Net 6,000,000, COGS 5,400,000, Profit 600,000,   Units 30
  // Order 3: Gross   240,000, Disc 10,000,  Net   230,000, COGS    60,000, Profit 170,000,   Units 2
  // Totals:
  // Gross = 9,240,000
  // Discount = 210,000
  // Net = 9,030,000
  // COGS = 6,460,000
  // Gross Profit = 2,570,000
  // Margin = (2,570,000 / 9,030,000) * 100 = 28.4606866...% -> ~28.46%
  // Orders = 3
  // Units = 42
  // AOV = 9,030,000 / 3 = 3,010,000
  // Units per Order = 42 / 3 = 14

  assert(currentSummary.gross_sales === 9240000, `Gross Sales matches expected: 9,240,000đ (got ${currentSummary.gross_sales})`);
  assert(currentSummary.total_discount === 210000, `Total Discount matches expected: 210,000đ (got ${currentSummary.total_discount})`);
  assert(currentSummary.net_revenue === 9030000, `Net Revenue matches expected: 9,030,000đ (got ${currentSummary.net_revenue})`);
  assert(currentSummary.total_cogs === 6460000, `COGS matches expected: 6,460,000đ (got ${currentSummary.total_cogs})`);
  assert(currentSummary.gross_profit === 2570000, `Gross Profit matches expected: 2,570,000đ (got ${currentSummary.gross_profit})`);
  assert(currentSummary.total_orders === 3, `Completed Orders count matches expected: 3 (got ${currentSummary.total_orders})`);
  assert(currentSummary.total_units === 42, `Completed Units count matches expected: 42 (got ${currentSummary.total_units})`);

  const margin = Math.round((currentSummary.gross_profit / currentSummary.net_revenue) * 10000) / 100;
  assert(margin === 28.46, `Margin % matches expected: 28.46% (got ${margin})`);

  const aov = Math.round(currentSummary.net_revenue / currentSummary.total_orders);
  assert(aov === 3010000, `AOV matches expected: 3,010,000đ (got ${aov})`);

  const unitsPerOrder = Math.round((currentSummary.total_units / currentSummary.total_orders) * 10) / 10;
  assert(unitsPerOrder === 14, `Units per Order matches expected: 14 (got ${unitsPerOrder})`);

  console.log('--- 4. Period Comparison & Percentage Points Engine ---');
  // Query Previous Period (2026-09-14)
  const prevSummary = await db.getFirstAsync(`
    SELECT 
      COALESCE(SUM(total_revenue), 0) as net_revenue,
      COALESCE(SUM(profit), 0) as gross_profit,
      COALESCE(SUM(quantity), 0) as total_units,
      COUNT(DISTINCT order_id) as total_orders
    FROM sales_records
    WHERE sale_date = '2026-09-14' AND status = 'COMPLETED'
  `);
  // Prev: Net = 1,450,000; Profit = 950,000; Margin = (950,000 / 1,450,000)*100 = 65.517% -> 65.52%
  const prevMargin = Math.round((prevSummary.gross_profit / prevSummary.net_revenue) * 10000) / 100;
  
  const revComp = calculateMetricComparison(currentSummary.net_revenue, prevSummary.net_revenue);
  // Growth: (9030000 - 1450000) / 1450000 = +522.8%
  assert(revComp.direction === 'up', `Revenue comparison direction is UP`);
  assert(revComp.pctChange === 522.8, `Revenue % growth is +522.8% (got ${revComp.pctChange})`);

  const marginComp = calculateMarginComparison(margin, prevMargin);
  // Margin change in percentage points: 28.46 - 65.52 = -37.06 percentage points
  assert(marginComp.direction === 'down', `Margin comparison direction is DOWN`);
  assert(marginComp.ppDiff === -37.06, `Margin percentage points change is -37.06 pp (got ${marginComp.ppDiff})`);

  console.log('--- 5. BCG Profitability Matrix Quadrants ---');
  const productsPerf = await db.getAllAsync(`
    SELECT 
      p.id,
      p.name,
      p.sku,
      SUM(sr.quantity) as total_quantity,
      SUM(sr.total_revenue) as total_revenue,
      SUM(sr.total_cost) as total_cost,
      SUM(sr.profit) as gross_profit,
      ROUND((SUM(sr.profit) * 1.0 / NULLIF(SUM(sr.total_revenue), 0)) * 100, 2) as margin_pct
    FROM sales_records sr
    JOIN products p ON sr.product_id = p.id
    WHERE sr.sale_date = '2026-09-15' AND sr.status = 'COMPLETED'
    GROUP BY p.id
  `);

  const avgRev = productsPerf.reduce((s, p) => s + p.total_revenue, 0) / productsPerf.length;
  const avgProfit = productsPerf.reduce((s, p) => s + p.gross_profit, 0) / productsPerf.length;

  const stars = [];
  const cashCows = [];
  const potentials = [];
  const needReview = [];

  productsPerf.forEach(p => {
    const highRev = p.total_revenue >= avgRev;
    const highProfit = p.gross_profit >= avgProfit;
    if (highRev && highProfit) stars.push(p);
    else if (highRev && !highProfit) cashCows.push(p);
    else if (!highRev && highProfit) potentials.push(p);
    else needReview.push(p);
  });

  // Product 1 (Áo sơ mi): Rev 2,800,000 (< avg 3,010,000), Profit 1,800,000 (> avg 856,667) -> POTENTIAL (high profit, below avg rev)
  assert(potentials.length === 1 && potentials[0].id === 1, `BCG: Product 1 classified as POTENTIAL (Quad C: high profit, high margin)`);
  // Product 2 (Lego): Rev 6,000,000 (> avg 3.01M), Profit 600,000 (< avg 856k) -> CASH COW / FAST SELLER LOW MARGIN
  assert(cashCows.length === 1 && cashCows[0].id === 2, `BCG: Product 2 classified as CASH COW / HIGH REV LOW PROFIT`);
  // Product 3 (Mũ vành): Rev 230,000, Profit 170,000 -> Low revenue & profit < avg -> needReview/quadrant D
  assert(needReview.length === 1 && needReview[0].id === 3, `BCG: Product 3 classified into NEED REVIEW (Quad D: low rev, low profit)`);

  console.log('--- 6. Category Performance Analysis ---');
  const catPerf = await db.getAllAsync(`
    SELECT 
      c.name as category_name,
      SUM(sr.total_revenue) as net_revenue,
      SUM(sr.total_cost) as total_cogs,
      SUM(sr.profit) as gross_profit,
      ROUND((SUM(sr.profit) * 1.0 / NULLIF(SUM(sr.total_revenue), 0)) * 100, 2) as margin_pct,
      SUM(sr.quantity) as total_units
    FROM sales_records sr
    JOIN products p ON sr.product_id = p.id
    JOIN categories c ON p.category_id = c.id
    WHERE sr.sale_date = '2026-09-15' AND sr.status = 'COMPLETED'
    GROUP BY c.id
    ORDER BY net_revenue DESC
  `);

  assert(catPerf.length === 3, `Category analysis returns exact 3 active categories`);
  assert(catPerf[0].category_name === 'Đồ Chơi', `Top category by revenue is Đồ Chơi (6,000,000đ)`);
  assert(catPerf[1].category_name === 'Thời Trang', `Second category is Thời Trang (2,800,000đ)`);
  assert(catPerf[2].category_name === 'Phụ Kiện', `Third category is Phụ Kiện (230,000đ)`);

  console.log('--- 7. Hourly & Weekday Time Performance ---');
  // Hourly query
  const hourlyData = await db.getAllAsync(`
    SELECT 
      CAST(strftime('%H', created_at) AS INTEGER) as hour,
      COUNT(DISTINCT order_id) as orders_count,
      SUM(total_revenue) as net_revenue,
      SUM(profit) as gross_profit
    FROM sales_records
    WHERE sale_date = '2026-09-15' AND status = 'COMPLETED'
    GROUP BY hour
    ORDER BY hour ASC
  `);
  // Hours recorded: 9 (09:15), 14 (14:30), 19 (19:45)
  assert(hourlyData.length === 3, `Hourly performance detected 3 active hour buckets (9h, 14h, 19h)`);
  assert(hourlyData[0].hour === 9 && hourlyData[0].net_revenue === 2800000, `Hour 9 revenue is 2,800,000đ`);
  assert(hourlyData[1].hour === 14 && hourlyData[1].net_revenue === 6000000, `Hour 14 revenue is 6,000,000đ`);
  assert(hourlyData[2].hour === 19 && hourlyData[2].net_revenue === 230000, `Hour 19 revenue is 230,000đ`);

  console.log('--- 8. Employee Performance & Account Isolation ---');
  const staffPerf = await db.getAllAsync(`
    SELECT 
      u.id as user_id,
      u.full_name,
      COUNT(DISTINCT sr.order_id) as total_orders,
      SUM(sr.total_revenue) as net_revenue,
      SUM(sr.profit) as gross_profit,
      SUM(sr.quantity) as total_units
    FROM sales_records sr
    JOIN users u ON sr.created_by = u.id
    WHERE sr.sale_date = '2026-09-15' AND sr.status = 'COMPLETED'
    GROUP BY u.id
    ORDER BY net_revenue DESC
  `);
  // Staff 2 (Trần Thị B): 2 orders (Order 2 + Order 3), Net = 6,230,000
  // Staff 1 (Nguyễn Văn Thuật): 1 order (Order 1), Net = 2,800,000
  assert(staffPerf.length === 2, `Staff performance returns 2 active staff sellers`);
  assert(staffPerf[0].full_name === 'Trần Thị B' && staffPerf[0].total_orders === 2, `Staff 2 generated 2 orders`);
  assert(staffPerf[1].full_name === 'Nguyễn Văn Thuật' && staffPerf[1].net_revenue === 2800000, `Staff 1 generated 2,800,000đ`);

  // Staff Account Isolation check
  const staff1Only = await db.getAllAsync(`
    SELECT COUNT(*) as cnt FROM sales_records WHERE created_by = 2 AND status = 'COMPLETED'
  `);
  assert(staff1Only[0].cnt === 2, `Staff 1 has exact 2 completed sales (1 today, 1 yesterday)`);

  console.log('--- 9. Inventory Capital & Valuation Analysis ---');
  const invSummary = await db.getFirstAsync(`
    SELECT 
      COALESCE(SUM(current_stock), 0) as total_units,
      COALESCE(SUM(current_stock * current_cost_price), 0) as total_cost_value,
      COALESCE(SUM(current_stock * current_selling_price), 0) as total_retail_value,
      COALESCE(SUM(CASE WHEN current_stock <= min_stock_alert AND current_stock > 0 THEN 1 ELSE 0 END), 0) as low_stock_count,
      COALESCE(SUM(CASE WHEN current_stock = 0 THEN 1 ELSE 0 END), 0) as out_of_stock_count
    FROM products
    WHERE status = 'ACTIVE'
  `);
  // Product 1: 50 * 100k = 5,000,000 (Retail: 50 * 300k = 15,000,000)
  // Product 2: 100 * 180k = 18,000,000 (Retail: 100 * 200k = 20,000,000)
  // Product 3: 20 * 30k = 600,000 (Retail: 20 * 120k = 2,400,000)
  // Product 4: 2 * 15k = 30,000 (Retail: 2 * 18k = 36,000) -> Low stock (2 <= 5)
  // Product 5: 40 * 50k = 2,000,000 (Retail: 40 * 100k = 4,000,000)
  // Total units = 50 + 100 + 20 + 2 + 40 = 212
  // Total cost value = 5,000,000 + 18,000,000 + 600,000 + 30,000 + 2,000,000 = 25,630,000đ
  // Total retail value = 15M + 20M + 2.4M + 36k + 4M = 41,436,000đ
  assert(invSummary.total_units === 212, `Total inventory units is 212 (got ${invSummary.total_units})`);
  assert(invSummary.total_cost_value === 25630000, `Total cost capital is 25,630,000đ (got ${invSummary.total_cost_value})`);
  assert(invSummary.total_retail_value === 41436000, `Total retail valuation is 41,436,000đ (got ${invSummary.total_retail_value})`);
  assert(invSummary.low_stock_count === 1, `Low stock products count is 1 (SKU-004 stock 2 <= min 5)`);

  // Top capital heavy product
  const topCapital = await db.getFirstAsync(`
    SELECT sku, name, (current_stock * current_cost_price) as capital_value
    FROM products
    ORDER BY capital_value DESC
    LIMIT 1
  `);
  assert(topCapital.sku === 'SKU-002' && topCapital.capital_value === 18000000, `Product with most tied capital is Lego (18,000,000đ)`);

  console.log('--- 10. Drilldown Capabilities Proof ---');
  // Drill-down 1: Date -> Orders
  const dateOrders = await db.getAllAsync(`
    SELECT so.id, so.order_code, so.final_amount, so.total_discount, so.payment_method
    FROM sales_orders so
    WHERE so.sale_date = '2026-09-15' AND so.status = 'COMPLETED'
    ORDER BY so.created_at DESC
  `);
  assert(dateOrders.length === 3, `Date drill-down returns exact 3 completed orders for 2026-09-15`);

  // Drill-down 2: Product -> FIFO Lots
  const productLots = await db.getAllAsync(`
    SELECT id, lot_code, quantity_imported, quantity_remaining, unit_cost
    FROM inventory_lots
    WHERE product_id = 1
    ORDER BY received_at ASC
  `);
  assert(productLots.length === 1, `Product 1 drill-down returns 1 FIFO lot`);
  assert(productLots[0].quantity_remaining === 40, `Lot 1 remaining quantity is 40`);

  console.log('--- 11. Edge Cases & Zero Division Protection ---');
  // Division by zero guard: Period with 0 sales
  const emptySummary = await db.getFirstAsync(`
    SELECT 
      COALESCE(SUM(total_revenue), 0) as net_revenue,
      COALESCE(SUM(profit), 0) as gross_profit,
      COUNT(DISTINCT order_id) as total_orders,
      COALESCE(SUM(quantity), 0) as total_units
    FROM sales_records
    WHERE sale_date = '2020-01-01' AND status = 'COMPLETED'
  `);
  const safeAov = emptySummary.total_orders > 0 ? Math.round(emptySummary.net_revenue / emptySummary.total_orders) : 0;
  const safeMargin = emptySummary.net_revenue > 0 ? (emptySummary.gross_profit / emptySummary.net_revenue) * 100 : 0;
  const safeUnitsPerOrder = emptySummary.total_orders > 0 ? (emptySummary.total_units / emptySummary.total_orders) : 0;

  assert(safeAov === 0, `Zero orders safely evaluates AOV to 0 without throwing`);
  assert(safeMargin === 0, `Zero revenue safely evaluates Margin to 0 without throwing`);
  assert(safeUnitsPerOrder === 0, `Zero orders safely evaluates Units/Order to 0 without throwing`);

  // Comparison against zero baseline
  const zeroComp = calculateMetricComparison(1000000, 0);
  assert(zeroComp.pctChange === 100 && zeroComp.direction === 'up', `Comparison with 0 previous safely evaluates to +100% up`);

  // Comparison with both zero
  const bothZeroComp = calculateMetricComparison(0, 0);
  assert(bothZeroComp.pctChange === 0 && bothZeroComp.direction === 'neutral', `Both zero comparison safely evaluates to 0 neutral`);

  console.log('\n================================================================');
  console.log(`  PHASE 12 REPORTS & ANALYTICS TEST SUITE: ${passedTests} PASSED / ${failedTests} FAILED`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution failed with error:', err);
  process.exit(1);
});
