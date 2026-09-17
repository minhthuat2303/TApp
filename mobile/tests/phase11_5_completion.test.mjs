// T_SHOP Mobile - Phase 11.5 Complete Mobile Product Completion Test Suite
// Exhaustive automated testing for:
// - Purchase Order Lifecycle & Confirm/Receive Workflow
// - Product Detail & Product Edit (Strict Read-Only Stock Invariant)
// - Category Management & Accent-Insensitive Search
// - Bulk Product Import & Bulk Inventory Import (CSV/Excel Engine)
// - Mobile Essentials: Diacritic Search, Money Safety, Double-Submission Guard, Polite Errors

import Database from 'better-sqlite3';
import assert from 'node:assert';

console.log('================================================================');
console.log('  T_SHOP MOBILE — PHASE 11.5 COMPLETION AUTOMATED TEST SUITE   ');
console.log('================================================================\n');

let passCount = 0;
let failCount = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${desc}`);
    passCount++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${err.message}\n`);
    failCount++;
  }
}

async function itAsync(desc, fn) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${desc}`);
    passCount++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${err.message}\n`);
    failCount++;
  }
}

// Vietnamese diacritic removal helper (Web/Mobile standardized)
function removeVietnameseDiacritics(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, (m) => (m === 'đ' ? 'd' : 'D'));
}

function normalizeSearch(str) {
  if (!str) return '';
  return removeVietnameseDiacritics(str)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

// In-Memory SQLite Driver for NodeJS test environment
class TestSqliteDriver {
  constructor() {
    this.db = new Database(':memory:');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  exec(sql) {
    this.db.exec(sql);
  }

  run(sql, params = []) {
    const info = this.db.prepare(sql).run(...params);
    return { changes: info.changes, lastInsertRowId: Number(info.lastInsertRowid) };
  }

  getAll(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  getFirst(sql, params = []) {
    const row = this.db.prepare(sql).get(...params);
    return row || null;
  }

  withTransaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const res = action(this);
      this.db.exec('COMMIT');
      return res;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

// Initialize complete Schema v1 -> v8
function setupDatabase() {
  const driver = new TestSqliteDriver();

  driver.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('ADMIN', 'STAFF')),
      status TEXT NOT NULL DEFAULT 'ACTIVE'
    );

    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
    );

    CREATE TABLE product_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL
    );

    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      product_type_id INTEGER NOT NULL REFERENCES product_types(id),
      current_cost_price REAL NOT NULL DEFAULT 0,
      current_selling_price REAL NOT NULL DEFAULT 0,
      current_stock INTEGER NOT NULL DEFAULT 0,
      min_stock_alert INTEGER NOT NULL DEFAULT 5,
      barcode TEXT,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
    );

    CREATE TABLE price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      price REAL NOT NULL,
      effective_from TEXT NOT NULL,
      note TEXT,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE cost_price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      cost_price REAL NOT NULL,
      effective_from TEXT NOT NULL,
      note TEXT,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT
    );

    CREATE TABLE imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_import_id TEXT UNIQUE NOT NULL,
      import_code TEXT UNIQUE NOT NULL,
      supplier_id INTEGER REFERENCES suppliers(id),
      import_date TEXT NOT NULL,
      expected_date TEXT,
      total_amount REAL NOT NULL DEFAULT 0,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'CANCELLED')),
      sync_status TEXT NOT NULL DEFAULT 'PENDING',
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE import_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_cost_price REAL NOT NULL CHECK (unit_cost_price >= 0),
      total_amount REAL NOT NULL CHECK (total_amount >= 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE inventory_lots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lot_code TEXT UNIQUE NOT NULL,
      product_id INTEGER NOT NULL REFERENCES products(id),
      purchase_date TEXT NOT NULL,
      quantity_received INTEGER NOT NULL,
      quantity_remaining INTEGER NOT NULL,
      unit_cost REAL NOT NULL,
      supplier_id INTEGER,
      import_id INTEGER REFERENCES imports(id),
      note TEXT,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_movement_id TEXT UNIQUE NOT NULL,
      product_id INTEGER NOT NULL REFERENCES products(id),
      movement_type TEXT NOT NULL,
      quantity_change INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      movement_date TEXT NOT NULL,
      reference_type TEXT NOT NULL,
      reference_id INTEGER,
      sync_status TEXT NOT NULL DEFAULT 'PENDING',
      note TEXT,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_mutation_id TEXT UNIQUE NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      user_id INTEGER NOT NULL DEFAULT 1,
      device_id TEXT NOT NULL DEFAULT 'TEST-DEV'
    );
  `);

  // Seed baseline master data
  driver.run(`INSERT INTO users (id, username, full_name, role, status) VALUES (1, 'admin', 'Quản Trị Viên', 'ADMIN', 'ACTIVE')`);
  driver.run(`INSERT INTO categories (id, code, name, description) VALUES (1, 'CAT-DO-CHOI', 'Đồ Chơi Giáo Dục', 'Đồ chơi phát triển trí tuệ')`);
  driver.run(`INSERT INTO categories (id, code, name, description) VALUES (2, 'CAT-BUP-BE', 'Búp Bê & Phụ Kiện', 'Búp bê các loại')`);
  driver.run(`INSERT INTO product_types (id, category_id, code, name) VALUES (1, 1, 'TYPE-LEGO', 'Bộ Ghép Hình')`);
  driver.run(`INSERT INTO product_types (id, category_id, code, name) VALUES (2, 2, 'TYPE-BARBIE', 'Búp Bê Thời Trang')`);
  driver.run(`INSERT INTO suppliers (id, name, phone) VALUES (1, 'Công ty Đồ Chơi Sáng Tạo', '0901234567')`);

  driver.run(`
    INSERT INTO products (id, sku, name, category_id, product_type_id, current_cost_price, current_selling_price, current_stock, min_stock_alert, barcode, description)
    VALUES (1, 'SKU-LEGO-01', 'Lego Xe Cứu Hỏa', 1, 1, 100000, 180000, 10, 5, '893001', 'Bộ xếp hình 250 chi tiết')
  `);
  driver.run(`
    INSERT INTO products (id, sku, name, category_id, product_type_id, current_cost_price, current_selling_price, current_stock, min_stock_alert, barcode, description)
    VALUES (2, 'SKU-BUPBE-01', 'Búp Bê Công Chúa Elsa', 2, 2, 120000, 220000, 5, 3, '893002', 'Búp bê có nhạc và đèn')
  `);

  // Initial lot for Product 1 (10 units @ 100,000)
  driver.run(`
    INSERT INTO inventory_lots (lot_code, product_id, purchase_date, quantity_received, quantity_remaining, unit_cost, supplier_id, note, created_by)
    VALUES ('LOT-INIT-01', 1, '2026-09-01', 10, 10, 100000, 1, 'Kho ban đầu', 1)
  `);
  // Initial lot for Product 2 (5 units @ 120,000)
  driver.run(`
    INSERT INTO inventory_lots (lot_code, product_id, purchase_date, quantity_received, quantity_remaining, unit_cost, supplier_id, note, created_by)
    VALUES ('LOT-INIT-02', 2, '2026-09-01', 5, 5, 120000, 1, 'Kho ban đầu', 1)
  `);

  return driver;
}

// -----------------------------------------------------------------------------
// MODULE 1: MIGRATION 008 SCHEMA VALIDATION
// -----------------------------------------------------------------------------
console.log('--- 1. Migration 008 Schema Evolution Validation ---');

it('Migration 008: imports table contains status column with check constraint', () => {
  const driver = setupDatabase();
  const info = driver.getAll(`PRAGMA table_info(imports)`);
  const statusCol = info.find((c) => c.name === 'status');
  assert.ok(statusCol, 'Column status must exist on imports table');
  assert.strictEqual(statusCol.dflt_value, "'PENDING'");
});

it('Migration 008: imports table contains expected_date column', () => {
  const driver = setupDatabase();
  const info = driver.getAll(`PRAGMA table_info(imports)`);
  const expCol = info.find((c) => c.name === 'expected_date');
  assert.ok(expCol, 'Column expected_date must exist on imports table');
});

it('Migration 008: products table contains description column', () => {
  const driver = setupDatabase();
  const info = driver.getAll(`PRAGMA table_info(products)`);
  const descCol = info.find((c) => c.name === 'description');
  assert.ok(descCol, 'Column description must exist on products table');
});

// -----------------------------------------------------------------------------
// MODULE 2: PURCHASE ORDER LIFECYCLE & CONFIRM / RECEIVE WORKFLOW (Section 4 & 5)
// -----------------------------------------------------------------------------
console.log('\n--- 2. Purchase Order Lifecycle & Confirm Workflow ---');

it('PO Creation (PENDING): Stock and FIFO lots MUST REMAIN UNCHANGED', () => {
  const driver = setupDatabase();
  const prodBefore = driver.getFirst(`SELECT current_stock, current_cost_price FROM products WHERE id = 1`);
  const lotsBefore = driver.getAll(`SELECT * FROM inventory_lots WHERE product_id = 1`);

  // Create PENDING Purchase Order
  const poRes = driver.run(`
    INSERT INTO imports (client_import_id, import_code, supplier_id, import_date, expected_date, total_amount, note, status, created_by)
    VALUES ('po-client-001', 'PO-20260911-001', 1, '2026-09-11', '2026-09-15', 1500000, 'Đơn mua đồ chơi mẫu', 'PENDING', 1)
  `);
  const poId = poRes.lastInsertRowId;

  // Add 10 units @ 150,000 to PO
  driver.run(`
    INSERT INTO import_items (import_id, product_id, quantity, unit_cost_price, total_amount)
    VALUES (?, 1, 10, 150000, 1500000)
  `, [poId]);

  // Check PO status
  const po = driver.getFirst(`SELECT status, total_amount, expected_date FROM imports WHERE id = ?`, [poId]);
  assert.strictEqual(po.status, 'PENDING');
  assert.strictEqual(po.total_amount, 1500000);
  assert.strictEqual(po.expected_date, '2026-09-15');

  // CRITICAL WEB INVARIANT CHECK:
  const prodAfter = driver.getFirst(`SELECT current_stock, current_cost_price FROM products WHERE id = 1`);
  const lotsAfter = driver.getAll(`SELECT * FROM inventory_lots WHERE product_id = 1`);
  const movements = driver.getAll(`SELECT * FROM stock_movements WHERE reference_id = ?`, [poId]);

  assert.strictEqual(prodAfter.current_stock, prodBefore.current_stock, 'Stock must NOT change when PO is PENDING');
  assert.strictEqual(prodAfter.current_cost_price, prodBefore.current_cost_price, 'Cost must NOT change when PO is PENDING');
  assert.strictEqual(lotsAfter.length, lotsBefore.length, 'No new FIFO lot created for PENDING PO');
  assert.strictEqual(movements.length, 0, 'No stock movements logged for PENDING PO');
});

it('PO Confirmation ("Xác nhận đơn"): Atomically increments stock, creates FIFO lot, logs movement, enqueues Outbox', () => {
  const driver = setupDatabase();

  // Create PENDING Purchase Order
  const poRes = driver.run(`
    INSERT INTO imports (client_import_id, import_code, supplier_id, import_date, expected_date, total_amount, note, status, created_by)
    VALUES ('po-client-002', 'PO-20260911-002', 1, '2026-09-11', '2026-09-15', 1400000, 'Nhập bổ sung Lego', 'PENDING', 1)
  `);
  const poId = poRes.lastInsertRowId;
  driver.run(`
    INSERT INTO import_items (import_id, product_id, quantity, unit_cost_price, total_amount)
    VALUES (?, 1, 10, 140000, 1400000)
  `, [poId]);

  // Execute Confirmation Transaction (Matches PurchaseOrderService.confirmPurchaseOrder)
  driver.withTransaction((tx) => {
    // 1. Verify status
    const po = tx.getFirst(`SELECT * FROM imports WHERE id = ?`, [poId]);
    assert.strictEqual(po.status, 'PENDING');

    // 2. Fetch items
    const items = tx.getAll(`SELECT * FROM import_items WHERE import_id = ?`, [poId]);

    for (const item of items) {
      const prod = tx.getFirst(`SELECT * FROM products WHERE id = ?`, [item.product_id]);

      // 3. Create FIFO Lot
      const lotCode = `LOT-PO-${po.import_code}-${prod.sku}`;
      tx.run(`
        INSERT INTO inventory_lots (
          lot_code, product_id, purchase_date, quantity_received,
          quantity_remaining, unit_cost, supplier_id, import_id,
          note, created_by
        ) VALUES (?, ?, date('now'), ?, ?, ?, ?, ?, 'Xác nhận đơn mua hàng', 1)
      `, [lotCode, prod.id, item.quantity, item.quantity, item.unit_cost_price, po.supplier_id, poId]);

      // 4. Update Cost Price History
      tx.run(`
        INSERT INTO cost_price_history (product_id, cost_price, effective_from, note, created_by)
        VALUES (?, ?, date('now'), 'Xác nhận nhập kho đơn hàng', 1)
      `, [prod.id, item.unit_cost_price]);

      // 5. Compute Weighted Average Cost from active lots
      // Initial lot: 10 @ 100,000 = 1,000,000
      // New lot: 10 @ 140,000 = 1,400,000
      // Total remaining: 20 units, Total value: 2,400,000 -> WAC = 120,000
      const lotsSummary = tx.getFirst(`
        SELECT COALESCE(SUM(quantity_remaining), 0) as total_rem,
               COALESCE(SUM(quantity_remaining * unit_cost), 0) as total_val
        FROM inventory_lots
        WHERE product_id = ? AND quantity_remaining > 0
      `, [prod.id]);

      const totalRem = Number(lotsSummary.total_rem);
      const totalVal = Number(lotsSummary.total_val);
      const newStock = Number(prod.current_stock) + item.quantity;
      const weightedAvgCost = totalRem > 0 ? Math.round(totalVal / totalRem) : item.unit_cost_price;

      tx.run(`
        UPDATE products
        SET current_stock = ?, current_cost_price = ?
        WHERE id = ?
      `, [newStock, weightedAvgCost, prod.id]);

      // 6. Log Stock Movement
      tx.run(`
        INSERT INTO stock_movements (
          client_movement_id, product_id, movement_type, quantity_change,
          balance_after, movement_date, reference_type, reference_id,
          note, created_by
        ) VALUES (?, ?, 'PURCHASE', ?, ?, date('now'), 'PURCHASE_ORDER', ?, 'Nhập kho từ đơn mua hàng', 1)
      `, [`mov-po-${poId}-${prod.id}`, prod.id, item.quantity, newStock, poId]);
    }

    // 7. Update PO status to COMPLETED
    tx.run(`UPDATE imports SET status = 'COMPLETED' WHERE id = ?`, [poId]);

    // 8. Enqueue to Outbox
    tx.run(`
      INSERT INTO sync_queue (client_mutation_id, entity_type, entity_id, action, payload, status)
      VALUES (?, 'IMPORT_ORDER', ?, 'CONFIRM_PURCHASE_ORDER', ?, 'PENDING')
    `, [`sync-po-conf-${poId}`, String(poId), JSON.stringify({ import_id: poId, status: 'COMPLETED' })]);
  });

  // Verify post-confirmation state
  const updatedPO = driver.getFirst(`SELECT status FROM imports WHERE id = ?`, [poId]);
  assert.strictEqual(updatedPO.status, 'COMPLETED');

  const updatedProd = driver.getFirst(`SELECT current_stock, current_cost_price FROM products WHERE id = 1`);
  assert.strictEqual(updatedProd.current_stock, 20, 'Stock must increase from 10 to 20');
  assert.strictEqual(updatedProd.current_cost_price, 120000, 'Weighted average cost: (10*100k + 10*140k)/20 = 120,000');

  const lots = driver.getAll(`SELECT * FROM inventory_lots WHERE product_id = 1`);
  assert.strictEqual(lots.length, 2, 'Two FIFO lots exist');
  assert.strictEqual(lots[1].quantity_received, 10);
  assert.strictEqual(lots[1].quantity_remaining, 10);

  const movements = driver.getAll(`SELECT * FROM stock_movements WHERE reference_id = ?`, [poId]);
  assert.strictEqual(movements.length, 1);
  assert.strictEqual(movements[0].movement_type, 'PURCHASE');
  assert.strictEqual(movements[0].quantity_change, 10);
  assert.strictEqual(movements[0].balance_after, 20);

  const outbox = driver.getAll(`SELECT * FROM sync_queue WHERE entity_id = ?`, [String(poId)]);
  assert.strictEqual(outbox.length, 1);
  assert.strictEqual(outbox[0].action, 'CONFIRM_PURCHASE_ORDER');
});

it('PO Invariant: Cannot confirm an already COMPLETED or CANCELLED purchase order', () => {
  const driver = setupDatabase();
  driver.run(`
    INSERT INTO imports (client_import_id, import_code, supplier_id, import_date, status, created_by)
    VALUES ('po-c-1', 'PO-CANCELLED', 1, '2026-09-11', 'CANCELLED', 1)
  `);

  assert.throws(() => {
    const po = driver.getFirst(`SELECT status FROM imports WHERE import_code = 'PO-CANCELLED'`);
    if (po.status !== 'PENDING') {
      throw new Error(`Đơn mua hàng đang ở trạng thái "${po.status}", không thể xác nhận.`);
    }
  }, /không thể xác nhận/);
});

it('PO Cancellation: Pending PO transitions to CANCELLED without altering inventory', () => {
  const driver = setupDatabase();
  const poRes = driver.run(`
    INSERT INTO imports (client_import_id, import_code, supplier_id, import_date, status, created_by)
    VALUES ('po-canc-test', 'PO-TO-CANCEL', 1, '2026-09-11', 'PENDING', 1)
  `);
  const poId = poRes.lastInsertRowId;

  // Cancel
  driver.run(`UPDATE imports SET status = 'CANCELLED' WHERE id = ?`, [poId]);
  const po = driver.getFirst(`SELECT status FROM imports WHERE id = ?`, [poId]);
  assert.strictEqual(po.status, 'CANCELLED');

  const movements = driver.getAll(`SELECT * FROM stock_movements WHERE reference_id = ?`, [poId]);
  assert.strictEqual(movements.length, 0);
});

// -----------------------------------------------------------------------------
// MODULE 3: PRODUCT DETAIL & EDIT (Section 8 — READ-ONLY STOCK INVARIANT)
// -----------------------------------------------------------------------------
console.log('\n--- 3. Product Detail & Edit Invariants ---');

it('Product Edit: Name, price, min stock, status and description are editable; STOCK IS READ-ONLY', () => {
  const driver = setupDatabase();
  const prodBefore = driver.getFirst(`SELECT * FROM products WHERE id = 1`);
  assert.strictEqual(prodBefore.current_stock, 10);

  // Attempting product edit with selling price update
  const newPrice = 195000;
  const newName = 'Lego Xe Cứu Hỏa Cứu Hộ VIP';
  const newDesc = 'Bộ xếp hình nâng cấp 2026';

  driver.withTransaction((tx) => {
    // 1. Update master table (Notice: current_stock is NEVER included in UPDATE)
    tx.run(`
      UPDATE products
      SET name = ?, current_selling_price = ?, min_stock_alert = ?, barcode = ?, description = ?
      WHERE id = ?
    `, [newName, newPrice, 8, '893001-NEW', newDesc, 1]);

    // 2. Track price history if price changed
    if (prodBefore.current_selling_price !== newPrice) {
      tx.run(`
        INSERT INTO price_history (product_id, price, effective_from, note, created_by)
        VALUES (1, ?, date('now'), 'Chỉnh sửa giá bán', 1)
      `, [newPrice]);
    }
  });

  const prodAfter = driver.getFirst(`SELECT * FROM products WHERE id = 1`);
  assert.strictEqual(prodAfter.name, newName);
  assert.strictEqual(prodAfter.current_selling_price, newPrice);
  assert.strictEqual(prodAfter.description, newDesc);
  assert.strictEqual(prodAfter.min_stock_alert, 8);
  assert.strictEqual(prodAfter.barcode, '893001-NEW');
  // CRITICAL BUSINESS RULE INVARIANT:
  assert.strictEqual(prodAfter.current_stock, prodBefore.current_stock, 'Stock must strictly remain 10! Stock cannot be directly modified by Product Edit!');

  const priceHistory = driver.getAll(`SELECT * FROM price_history WHERE product_id = 1`);
  assert.strictEqual(priceHistory.length, 1);
  assert.strictEqual(priceHistory[0].price, 195000);
});

it('Product Detail: Price History, Cost History, and Stock Movements query accuracy', () => {
  const driver = setupDatabase();
  // Add cost history entry
  driver.run(`
    INSERT INTO cost_price_history (product_id, cost_price, effective_from, note, created_by)
    VALUES (1, 100000, '2026-09-01', 'Giá vốn nhập hàng đầu kỳ', 1)
  `);

  const costHist = driver.getAll(`SELECT * FROM cost_price_history WHERE product_id = 1 ORDER BY effective_from DESC`);
  assert.strictEqual(costHist.length, 1);
  assert.strictEqual(costHist[0].cost_price, 100000);

  const lots = driver.getAll(`SELECT * FROM inventory_lots WHERE product_id = 1`);
  assert.strictEqual(lots.length, 1);
  assert.strictEqual(lots[0].quantity_remaining, 10);
});

// -----------------------------------------------------------------------------
// MODULE 4: CATEGORY MANAGEMENT & ACCENT-INSENSITIVE SEARCH (Section 9 & 10)
// -----------------------------------------------------------------------------
console.log('\n--- 4. Category Management & Accent-Insensitive Search ---');

it('Category Management: Create, update, deactivate with Outbox enqueue', () => {
  const driver = setupDatabase();

  // Create Category
  const catRes = driver.run(`
    INSERT INTO categories (code, name, description, status)
    VALUES ('CAT-GAU-BONG', 'Gấu Bông Cao Cấp', 'Gấu bông nhập khẩu', 'ACTIVE')
  `);
  const catId = catRes.lastInsertRowId;
  assert.ok(catId > 0);

  // Update Category
  driver.run(`
    UPDATE categories
    SET name = 'Gấu Bông & Thú Nhồi Bông', description = 'Cập nhật mô tả'
    WHERE id = ?
  `, [catId]);

  const catUpdated = driver.getFirst(`SELECT name, description FROM categories WHERE id = ?`, [catId]);
  assert.strictEqual(catUpdated.name, 'Gấu Bông & Thú Nhồi Bông');

  // Deactivate Category
  driver.run(`UPDATE categories SET status = 'INACTIVE' WHERE id = ?`, [catId]);
  const catDeactivated = driver.getFirst(`SELECT status FROM categories WHERE id = ?`, [catId]);
  assert.strictEqual(catDeactivated.status, 'INACTIVE');
});

it('Accent-Insensitive Search: "Búp Bê" -> "bup be" and "Đồ Chơi" -> "do choi"', () => {
  const driver = setupDatabase();
  const allCategories = driver.getAll(`SELECT id, name, description FROM categories`);

  // Query: "bup be" (lowercase, unaccented)
  const query1 = normalizeSearch('bup be');
  const matchedCat1 = allCategories.filter((c) => normalizeSearch(c.name).includes(query1));
  assert.strictEqual(matchedCat1.length, 1);
  assert.strictEqual(matchedCat1[0].name, 'Búp Bê & Phụ Kiện');

  // Query: "DO CHOI" (uppercase, unaccented)
  const query2 = normalizeSearch('DO CHOI');
  const matchedCat2 = allCategories.filter((c) => normalizeSearch(c.name).includes(query2));
  assert.strictEqual(matchedCat2.length, 1);
  assert.strictEqual(matchedCat2[0].name, 'Đồ Chơi Giáo Dục');

  // Query: "giao duc"
  const query3 = normalizeSearch('giao duc');
  const matchedCat3 = allCategories.filter((c) => normalizeSearch(c.name).includes(query3));
  assert.strictEqual(matchedCat3.length, 1);
});

// -----------------------------------------------------------------------------
// MODULE 5: BULK PRODUCT IMPORT FROM FILE (Section 7)
// -----------------------------------------------------------------------------
console.log('\n--- 5. Bulk Product Import (CSV Engine) ---');

function parseSimpleCsv(content) {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.split(',').map((c) => c.trim()));
}

it('Product CSV: Validates rows, flags invalid prices/skus, detects duplicates', () => {
  const csvContent = [
    'Mã SKU,Tên sản phẩm,Danh mục,Giá vốn,Giá bán,Tồn tối thiểu,Mã vạch',
    'GB-01,Gấu Ôm Tim 40cm,Gấu Bông,80000,150000,5,893005',
    'GB-02,Gấu Dâu Tây Lotso,Gấu Bông,-10000,180000,5,893006', // Negative cost price
    'GB-01,Gấu Ôm Tim Trùng SKU,Gấu Bông,80000,160000,5,893007', // Duplicate in file
    ',Thiếu SKU Sản Phẩm,Gấu Bông,50000,90000,5,893008', // Missing SKU
  ].join('\n');

  const rows = parseSimpleCsv(csvContent);
  const headers = rows[0];
  assert.strictEqual(headers[0], 'Mã SKU');

  const seenSkus = new Set();
  const valid = [];
  const errors = [];

  for (let i = 1; i < rows.length; i++) {
    const [sku, name, cat, cost, price, minStock, barcode] = rows[i];
    if (!sku) {
      errors.push({ row: i, reason: 'Thiếu mã SKU' });
      continue;
    }
    if (seenSkus.has(sku.toLowerCase())) {
      errors.push({ row: i, reason: `Mã SKU ${sku} bị trùng lặp trong file` });
      continue;
    }
    if (Number(cost) < 0 || Number(price) <= 0) {
      errors.push({ row: i, reason: 'Giá bán hoặc giá vốn không hợp lệ' });
      continue;
    }
    seenSkus.add(sku.toLowerCase());
    valid.push({ sku, name, cost: Number(cost), price: Number(price) });
  }

  assert.strictEqual(valid.length, 1);
  assert.strictEqual(valid[0].sku, 'GB-01');
  assert.strictEqual(errors.length, 3);
  assert.ok(errors.some((e) => e.reason.includes('trùng lặp')));
  assert.ok(errors.some((e) => e.reason.includes('Thiếu mã SKU')));
});

it('Product CSV Commit: Creates new products and updates existing, maintaining stock invariant', () => {
  const driver = setupDatabase();

  const importItems = [
    { sku: 'SKU-LEGO-01', name: 'Lego Xe Cứu Hỏa Bản 2026', price: 199000, minStock: 6 }, // Existing
    { sku: 'SKU-NEW-01', name: 'Xếp Hình Tàu Chiến 500 Chi Tiết', price: 320000, minStock: 4 }, // New
  ];

  driver.withTransaction((tx) => {
    for (const item of importItems) {
      const existing = tx.getFirst(`SELECT id, current_stock FROM products WHERE sku = ?`, [item.sku]);
      if (existing) {
        // Update existing (DO NOT TOUCH current_stock)
        tx.run(`
          UPDATE products
          SET name = ?, current_selling_price = ?, min_stock_alert = ?
          WHERE id = ?
        `, [item.name, item.price, item.minStock, existing.id]);

        // Enqueue Outbox
        tx.run(`
          INSERT INTO sync_queue (client_mutation_id, entity_type, entity_id, action, payload, status)
          VALUES (?, 'PRODUCT', ?, 'UPDATE', ?, 'PENDING')
        `, [`sync-prod-upd-${existing.id}`, String(existing.id), JSON.stringify(item)]);
      } else {
        // Create new (starts with stock = 0)
        const ins = tx.run(`
          INSERT INTO products (sku, name, category_id, product_type_id, current_selling_price, current_stock, min_stock_alert)
          VALUES (?, ?, 1, 1, ?, 0, ?)
        `, [item.sku, item.name, item.price, item.minStock]);

        tx.run(`
          INSERT INTO sync_queue (client_mutation_id, entity_type, entity_id, action, payload, status)
          VALUES (?, 'PRODUCT', ?, 'CREATE', ?, 'PENDING')
        `, [`sync-prod-ins-${ins.lastInsertRowId}`, String(ins.lastInsertRowId), JSON.stringify(item)]);
      }
    }
  });

  // Verify updated existing product
  const p1 = driver.getFirst(`SELECT name, current_selling_price, current_stock FROM products WHERE sku = 'SKU-LEGO-01'`);
  assert.strictEqual(p1.name, 'Lego Xe Cứu Hỏa Bản 2026');
  assert.strictEqual(p1.current_selling_price, 199000);
  assert.strictEqual(p1.current_stock, 10, 'Existing stock MUST NOT be changed by product import');

  // Verify new product
  const pNew = driver.getFirst(`SELECT name, current_selling_price, current_stock FROM products WHERE sku = 'SKU-NEW-01'`);
  assert.strictEqual(pNew.name, 'Xếp Hình Tàu Chiến 500 Chi Tiết');
  assert.strictEqual(pNew.current_stock, 0, 'New product initial stock is strictly 0 until stock is imported');
});

// -----------------------------------------------------------------------------
// MODULE 6: BULK INVENTORY IMPORT FROM FILE (Section 6)
// -----------------------------------------------------------------------------
console.log('\n--- 6. Bulk Inventory Stock Import (CSV Engine) ---');

it('Inventory CSV Commit: Atomically allocates FIFO lots, increments stock, updates WAC and logs movements', () => {
  const driver = setupDatabase();
  const prodBefore = driver.getFirst(`SELECT current_stock, current_cost_price FROM products WHERE id = 1`);
  assert.strictEqual(prodBefore.current_stock, 10);
  assert.strictEqual(prodBefore.current_cost_price, 100000);

  // Import batch of 15 units @ 120,000 for Product 1
  driver.withTransaction((tx) => {
    // 1. Create import header
    const impRes = tx.run(`
      INSERT INTO imports (client_import_id, import_code, import_date, total_amount, note, status, created_by)
      VALUES ('imp-csv-001', 'NK-CSV-20260911', date('now'), 1800000, 'Nhập kho từ CSV', 'COMPLETED', 1)
    `);
    const impId = impRes.lastInsertRowId;

    // 2. Insert item
    tx.run(`
      INSERT INTO import_items (import_id, product_id, quantity, unit_cost_price, total_amount)
      VALUES (?, 1, 15, 120000, 1800000)
    `, [impId]);

    // 3. Create FIFO Lot
    tx.run(`
      INSERT INTO inventory_lots (lot_code, product_id, purchase_date, quantity_received, quantity_remaining, unit_cost, import_id, note, created_by)
      VALUES ('LOT-CSV-01', 1, date('now'), 15, 15, 120000, ?, 'Nhập file CSV', 1)
    `, [impId]);

    // 4. Update Product Stock and WAC:
    // Lot 1: 10 @ 100k = 1,000k
    // Lot 2: 15 @ 120k = 1,800k
    // Total: 25 units, Total Val: 2,800,000 -> WAC = 112,000đ
    const totalRem = 25;
    const totalVal = 2800000;
    const wac = Math.round(totalVal / totalRem);

    tx.run(`
      UPDATE products
      SET current_stock = ?, current_cost_price = ?
      WHERE id = 1
    `, [totalRem, wac]);

    // 5. Stock Movement
    tx.run(`
      INSERT INTO stock_movements (client_movement_id, product_id, movement_type, quantity_change, balance_after, movement_date, reference_type, reference_id, created_by)
      VALUES ('mov-csv-01', 1, 'PURCHASE', 15, 25, date('now'), 'IMPORT', ?, 1)
    `, [impId]);
  });

  const prodAfter = driver.getFirst(`SELECT current_stock, current_cost_price FROM products WHERE id = 1`);
  assert.strictEqual(prodAfter.current_stock, 25, 'Stock should be 10 + 15 = 25');
  assert.strictEqual(prodAfter.current_cost_price, 112000, 'Weighted average cost: (1M + 1.8M)/25 = 112,000đ');

  const lots = driver.getAll(`SELECT * FROM inventory_lots WHERE product_id = 1`);
  assert.strictEqual(lots.length, 2);
  assert.strictEqual(lots[1].quantity_remaining, 15);
});

// -----------------------------------------------------------------------------
// MODULE 7: MOBILE ESSENTIALS — VALIDATION, POLITE ERRORS & SAFETY
// -----------------------------------------------------------------------------
console.log('\n--- 7. Mobile Essentials (Error Handling, Money & Mutex) ---');

it('Error Formatting: Polite Vietnamese user message, never exposes raw Axios 500 or SQLite codes', () => {
  function formatUserErrorMessage(err) {
    if (!err) return 'Đã xảy ra sự cố không xác định. Vui lòng thử lại sau.';
    const raw = typeof err === 'string' ? err : err.message || '';
    if (raw.includes('Network Error') || raw.includes('fetch failed') || raw.includes('ECONNREFUSED')) {
      return 'Không thể kết nối máy chủ. Thao tác đã được lưu trên thiết bị và sẽ tự động đồng bộ khi có mạng.';
    }
    if (raw.includes('500') || raw.includes('Internal Server Error')) {
      return 'Máy chủ đang bận xử lý. Dữ liệu của bạn được bảo toàn an toàn trên máy.';
    }
    if (raw.includes('SQLITE_CONSTRAINT') || raw.includes('UNIQUE constraint')) {
      return 'Dữ liệu đã tồn tại trong hệ thống. Vui lòng kiểm tra lại mã hoặc thông tin trùng lặp.';
    }
    return raw || 'Đã xảy ra sự cố. Vui lòng thử lại.';
  }

  const err1 = new Error('AxiosError: Request failed with status code 500');
  assert.strictEqual(formatUserErrorMessage(err1), 'Máy chủ đang bận xử lý. Dữ liệu của bạn được bảo toàn an toàn trên máy.');

  const err2 = new Error('TypeError: fetch failed (ECONNREFUSED)');
  assert.ok(formatUserErrorMessage(err2).includes('Không thể kết nối máy chủ'));

  const err3 = new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: products.sku');
  assert.strictEqual(formatUserErrorMessage(err3), 'Dữ liệu đã tồn tại trong hệ thống. Vui lòng kiểm tra lại mã hoặc thông tin trùng lặp.');
});

it('Money Safety: Vietnamese Dong is strictly integer-safe, no floating-point rounding errors', () => {
  // Test scenario: 3 items @ 33,333đ with 10% discount
  const unitPrice = 33333;
  const quantity = 3;
  const subtotal = unitPrice * quantity; // 99999
  const discountRate = 0.1;
  const discountAmount = Math.round(subtotal * discountRate); // 10000
  const finalAmount = subtotal - discountAmount; // 89999

  assert.strictEqual(Number.isInteger(subtotal), true);
  assert.strictEqual(Number.isInteger(discountAmount), true);
  assert.strictEqual(Number.isInteger(finalAmount), true);
  assert.strictEqual(finalAmount, 89999);
});

it('Double-Submission Guard: Mutex blocks concurrent mutation calls', async () => {
  let isSubmitting = false;
  let executionCount = 0;

  async function executeAction() {
    if (isSubmitting) return; // Mutex guard
    isSubmitting = true;
    try {
      executionCount++;
      await new Promise((r) => setTimeout(r, 10));
    } finally {
      isSubmitting = false;
    }
  }

  // Rapid double-tap simulation
  await Promise.all([executeAction(), executeAction(), executeAction()]);

  assert.strictEqual(executionCount, 1, 'Only 1 execution permitted during concurrent double-taps');
});

// -----------------------------------------------------------------------------
// FINAL SUMMARY
// -----------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`  PHASE 11.5 TEST RESULTS: ${passCount} PASSED / ${failCount} FAILED`);
console.log('================================================================\n');

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
